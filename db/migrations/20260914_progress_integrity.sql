-- Progress integrity hardening.
-- This migration is idempotent and is intentionally executed outside the application build.

CREATE TABLE IF NOT EXISTS leaderboard_kana_credit (
  user_id text NOT NULL,
  period_start date NOT NULL,
  kana_id integer NOT NULL REFERENCES kana_catalog(id) ON DELETE CASCADE,
  high_water_mastery numeric(6,3) NOT NULL DEFAULT 0 CHECK (high_water_mastery BETWEEN 0 AND 100),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, period_start, kana_id)
);

CREATE INDEX IF NOT EXISTS idx_leaderboard_kana_credit_period
  ON leaderboard_kana_credit(period_start, user_id);

CREATE TABLE IF NOT EXISTS progress_reset_markers (
  user_id text NOT NULL,
  kana_type text NOT NULL CHECK (kana_type IN ('hiragana','katakana')),
  reset_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, kana_type)
);

ALTER TABLE answer_events
  ADD COLUMN IF NOT EXISTS client_answered_at timestamptz;

-- The existing six-argument nihongo_submit_answer remains the learning-state implementation.
-- The app calls this hardened entry point, which atomically clamps competitive credit afterwards.
CREATE OR REPLACE FUNCTION nihongo_submit_answer_hardened(
  p_user_id text,
  p_event_id uuid,
  p_kana_type text,
  p_kana text,
  p_answer_text text,
  p_response_ms integer,
  p_client_answered_at timestamptz
)
RETURNS jsonb
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
  v_kana_id integer;
  v_period date;
  v_reset_at timestamptz;
  v_mastery_before numeric := 0;
  v_high_water numeric := 0;
  v_result jsonb;
  v_event record;
  v_difficulty numeric := 1;
  v_credit_gain numeric := 0;
  v_allowed_progress numeric := 0;
  v_allowed_recovery numeric := 0;
  v_rank numeric := 0;
  v_review_flag_before boolean := false;
  v_review_step_before integer := 0;
  v_next_review_before timestamptz;
  v_weak_level_before integer := 0;
BEGIN
  IF p_user_id IS NULL OR length(p_user_id) = 0 THEN
    RAISE EXCEPTION 'missing_user';
  END IF;

  SELECT id INTO v_kana_id
  FROM kana_catalog
  WHERE kana_type = p_kana_type AND kana = p_kana;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'unknown_kana';
  END IF;

  SELECT reset_at INTO v_reset_at
  FROM progress_reset_markers
  WHERE user_id = p_user_id AND kana_type = p_kana_type;

  IF v_reset_at IS NOT NULL
     AND (p_client_answered_at IS NULL OR p_client_answered_at <= v_reset_at) THEN
    RETURN jsonb_build_object(
      'duplicate', false,
      'stale', true,
      'reason', 'answered_before_progress_reset'
    );
  END IF;

  -- Serialize scoring work for the same user/kana. The base function takes the same lock again safely.
  PERFORM pg_advisory_xact_lock(hashtextextended(p_user_id || ':' || v_kana_id::text, 0));
  v_period := date_trunc('week', clock_timestamp() AT TIME ZONE 'UTC')::date;

  SELECT mastery_score, review_flag, review_step, next_review_at, weak_level
  INTO v_mastery_before, v_review_flag_before, v_review_step_before, v_next_review_before, v_weak_level_before
  FROM kana_progress
  WHERE user_id = p_user_id AND kana_id = v_kana_id;
  v_mastery_before := coalesce(v_mastery_before, 0);
  v_review_flag_before := coalesce(v_review_flag_before, false);
  v_review_step_before := coalesce(v_review_step_before, 0);
  v_weak_level_before := coalesce(v_weak_level_before, 0);

  INSERT INTO leaderboard_kana_credit(user_id, period_start, kana_id, high_water_mastery, updated_at)
  VALUES(p_user_id, v_period, v_kana_id, v_mastery_before, now())
  ON CONFLICT(user_id, period_start, kana_id) DO NOTHING;

  SELECT high_water_mastery INTO v_high_water
  FROM leaderboard_kana_credit
  WHERE user_id = p_user_id AND period_start = v_period AND kana_id = v_kana_id
  FOR UPDATE;

  v_result := nihongo_submit_answer(
    p_user_id, p_event_id, p_kana_type, p_kana, p_answer_text, p_response_ms
  );

  -- Idempotent retries were fully processed on their first submission.
  IF coalesce((v_result->>'duplicate')::boolean, false) THEN
    RETURN v_result;
  END IF;

  SELECT is_correct, mastery_before, mastery_after, meaningful_weight,
         progress_delta, recovery_delta
  INTO v_event
  FROM answer_events
  WHERE event_id = p_event_id AND user_id = p_user_id;

  IF NOT FOUND THEN
    RETURN v_result;
  END IF;

  -- "Chưa thuộc" is a short repair drill and may intentionally surface before
  -- the spaced-review timer is due. An early correct answer may advance the
  -- weak streak, but it must not consume the 45s → 2m → 5m → ... review chain.
  IF v_event.is_correct
     AND v_weak_level_before > 0
     AND v_review_flag_before
     AND v_next_review_before IS NOT NULL
     AND v_next_review_before > clock_timestamp() THEN
    UPDATE kana_progress
    SET review_flag = v_review_flag_before,
        review_step = v_review_step_before,
        next_review_at = v_next_review_before,
        updated_at = now()
    WHERE user_id = p_user_id AND kana_id = v_kana_id;

    v_result := v_result || jsonb_build_object(
      'reviewFlag', v_review_flag_before,
      'reviewStep', v_review_step_before,
      'nextReviewAt', v_next_review_before
    );
  END IF;

  IF v_event.mastery_before < 40 THEN v_difficulty := 0.8;
  ELSIF v_event.mastery_before < 70 THEN v_difficulty := 1;
  ELSIF v_event.mastery_before < 85 THEN v_difficulty := 1.25;
  ELSIF v_event.mastery_before < 95 THEN v_difficulty := 1.6;
  ELSE v_difficulty := 2;
  END IF;

  IF v_event.is_correct THEN
    -- Only mastery above this week's already-credited peak earns leaderboard progress.
    -- Wrong answers, resets, or non-meaningful spam can never lower this watermark.
    v_credit_gain := greatest(0, v_event.mastery_after - greatest(v_high_water, v_event.mastery_before));
    v_allowed_progress := v_credit_gain * v_difficulty * v_event.meaningful_weight;
    IF v_event.recovery_delta > 0 AND v_allowed_progress > 0 THEN
      v_allowed_recovery := least(2, v_allowed_progress * 0.25);
    END IF;
  END IF;

  UPDATE leaderboard_kana_credit
  SET high_water_mastery = greatest(high_water_mastery, v_event.mastery_after),
      updated_at = now()
  WHERE user_id = p_user_id AND period_start = v_period AND kana_id = v_kana_id;

  UPDATE answer_events
  SET progress_delta = v_allowed_progress,
      recovery_delta = v_allowed_recovery,
      client_answered_at = p_client_answered_at
  WHERE event_id = p_event_id AND user_id = p_user_id;

  UPDATE leaderboard_scores
  SET progress_score = greatest(0, progress_score - v_event.progress_delta + v_allowed_progress),
      recovery_bonus = greatest(0, recovery_bonus - v_event.recovery_delta + v_allowed_recovery),
      updated_at = now()
  WHERE user_id = p_user_id AND period_start = v_period;

  SELECT nihongo_ranking_score(progress_score, study_score, recovery_bonus)
  INTO v_rank
  FROM leaderboard_scores
  WHERE user_id = p_user_id AND period_start = v_period;

  UPDATE leaderboard_scores
  SET ranking_score = coalesce(v_rank, 0), updated_at = now()
  WHERE user_id = p_user_id AND period_start = v_period;

  RETURN v_result || jsonb_build_object(
    'stale', false,
    'progressDelta', round(v_allowed_progress, 4),
    'recoveryDelta', round(v_allowed_recovery, 4),
    'rankingScore', round(coalesce(v_rank, 0), 4)
  );
END;
$$;

CREATE OR REPLACE FUNCTION nihongo_reset_progress(p_user_id text, p_scope text)
RETURNS jsonb
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
  v_now timestamptz := clock_timestamp();
  v_deleted integer := 0;
BEGIN
  IF p_user_id IS NULL OR length(p_user_id) = 0 THEN
    RAISE EXCEPTION 'missing_user';
  END IF;
  IF p_scope NOT IN ('hiragana','katakana','all') THEN
    RAISE EXCEPTION 'invalid_scope';
  END IF;

  IF p_scope = 'all' THEN
    INSERT INTO progress_reset_markers(user_id, kana_type, reset_at)
    VALUES (p_user_id, 'hiragana', v_now), (p_user_id, 'katakana', v_now)
    ON CONFLICT(user_id, kana_type) DO UPDATE SET reset_at = excluded.reset_at;

    DELETE FROM kana_progress WHERE user_id = p_user_id;
    GET DIAGNOSTICS v_deleted = ROW_COUNT;
  ELSE
    INSERT INTO progress_reset_markers(user_id, kana_type, reset_at)
    VALUES (p_user_id, p_scope, v_now)
    ON CONFLICT(user_id, kana_type) DO UPDATE SET reset_at = excluded.reset_at;

    DELETE FROM kana_progress p
    USING kana_catalog c
    WHERE p.kana_id = c.id
      AND p.user_id = p_user_id
      AND c.kana_type = p_scope;
    GET DIAGNOSTICS v_deleted = ROW_COUNT;
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'deletedProgressRows', v_deleted,
    'historyPreserved', true,
    'resetAt', v_now
  );
END;
$$;
