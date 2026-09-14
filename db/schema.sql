CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS kana_catalog (
  id integer PRIMARY KEY,
  kana_type text NOT NULL CHECK (kana_type IN ('hiragana','katakana')),
  kana text NOT NULL,
  answers text[] NOT NULL,
  group_key text NOT NULL,
  category text NOT NULL CHECK (category IN ('main','dakuten','combo')),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (kana_type, kana)
);

CREATE TABLE IF NOT EXISTS profiles (
  user_id text PRIMARY KEY,
  display_name text NOT NULL CHECK (char_length(display_name) BETWEEN 1 AND 80),
  avatar_url text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  last_active_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS admins (
  user_id text PRIMARY KEY,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS kana_progress (
  user_id text NOT NULL,
  kana_id integer NOT NULL REFERENCES kana_catalog(id) ON DELETE CASCADE,
  total_attempts integer NOT NULL DEFAULT 0 CHECK (total_attempts >= 0),
  correct_attempts integer NOT NULL DEFAULT 0 CHECK (correct_attempts >= 0),
  wrong_attempts integer NOT NULL DEFAULT 0 CHECK (wrong_attempts >= 0),
  mastery_score numeric(6,3) NOT NULL DEFAULT 0 CHECK (mastery_score BETWEEN 0 AND 100),
  current_streak integer NOT NULL DEFAULT 0 CHECK (current_streak >= 0),
  best_streak integer NOT NULL DEFAULT 0 CHECK (best_streak >= 0),
  last_seen_at timestamptz,
  last_correct_at timestamptz,
  last_wrong_at timestamptz,
  next_review_at timestamptz,
  review_flag boolean NOT NULL DEFAULT false,
  review_step smallint NOT NULL DEFAULT 0 CHECK (review_step BETWEEN 0 AND 5),
  weak_level smallint NOT NULL DEFAULT 0 CHECK (weak_level BETWEEN 0 AND 3),
  weak_correct_streak smallint NOT NULL DEFAULT 0 CHECK (weak_correct_streak BETWEEN 0 AND 5),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, kana_id)
);

ALTER TABLE kana_progress ADD COLUMN IF NOT EXISTS review_flag boolean NOT NULL DEFAULT false;
ALTER TABLE kana_progress ADD COLUMN IF NOT EXISTS review_step smallint NOT NULL DEFAULT 0 CHECK (review_step BETWEEN 0 AND 5);
ALTER TABLE kana_progress ADD COLUMN IF NOT EXISTS weak_level smallint NOT NULL DEFAULT 0 CHECK (weak_level BETWEEN 0 AND 3);
ALTER TABLE kana_progress ADD COLUMN IF NOT EXISTS weak_correct_streak smallint NOT NULL DEFAULT 0 CHECK (weak_correct_streak BETWEEN 0 AND 5);

CREATE TABLE IF NOT EXISTS learning_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id text NOT NULL,
  started_at timestamptz NOT NULL DEFAULT now(),
  ended_at timestamptz,
  correct_count integer NOT NULL DEFAULT 0,
  wrong_count integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS answer_events (
  event_id uuid PRIMARY KEY,
  user_id text NOT NULL,
  kana_id integer NOT NULL REFERENCES kana_catalog(id) ON DELETE RESTRICT,
  kana_type text NOT NULL,
  kana text NOT NULL,
  answer_text text NOT NULL DEFAULT '',
  is_correct boolean NOT NULL,
  response_ms integer NOT NULL CHECK (response_ms BETWEEN 0 AND 600000),
  meaningful_weight numeric(5,2) NOT NULL DEFAULT 0,
  mastery_before numeric(6,3) NOT NULL,
  mastery_after numeric(6,3) NOT NULL,
  progress_delta numeric(10,4) NOT NULL DEFAULT 0,
  recovery_delta numeric(10,4) NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS leaderboard_scores (
  user_id text NOT NULL,
  period_start date NOT NULL,
  progress_score numeric(12,4) NOT NULL DEFAULT 0,
  study_score numeric(12,4) NOT NULL DEFAULT 0,
  recovery_bonus numeric(12,4) NOT NULL DEFAULT 0,
  meaningful_reviews numeric(12,2) NOT NULL DEFAULT 0,
  unique_kana integer NOT NULL DEFAULT 0,
  ranking_score numeric(12,4) NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, period_start)
);

CREATE TABLE IF NOT EXISTS abuse_flags (
  id bigserial PRIMARY KEY,
  user_id text NOT NULL,
  event_id uuid,
  reason text NOT NULL,
  severity text NOT NULL DEFAULT 'low' CHECK (severity IN ('low','medium','high')),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open','reviewed','dismissed')),
  detected_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS admin_audit_log (
  id bigserial PRIMARY KEY,
  admin_user_id text NOT NULL,
  target_user_id text,
  action text NOT NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_progress_user_due ON kana_progress(user_id, next_review_at);
CREATE INDEX IF NOT EXISTS idx_events_user_created ON answer_events(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_events_user_kana_created ON answer_events(user_id, kana_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_leaderboard_period_rank ON leaderboard_scores(period_start, ranking_score DESC);
CREATE INDEX IF NOT EXISTS idx_flags_user_detected ON abuse_flags(user_id, detected_at DESC);

CREATE OR REPLACE FUNCTION nihongo_study_score(p_reviews numeric, p_unique integer)
RETURNS numeric
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT (10.0 * ln(1.0 + greatest(coalesce(p_reviews,0),0)) + 0.8 * greatest(coalesce(p_unique,0),0))::numeric;
$$;

CREATE OR REPLACE FUNCTION nihongo_ranking_score(p_progress numeric, p_study numeric, p_recovery numeric)
RETURNS numeric
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  v_pn numeric;
  v_sn numeric;
  v_base numeric;
BEGIN
  v_pn := 100.0 * (1.0 - exp(-greatest(coalesce(p_progress,0),0) / 120.0));
  v_sn := 100.0 * (1.0 - exp(-greatest(coalesce(p_study,0),0) / 55.0));
  IF v_pn <= 0 OR v_sn <= 0 THEN
    v_base := 0;
  ELSE
    v_base := power(v_pn, 0.65) * power(v_sn, 0.35);
  END IF;
  RETURN (v_base + least(greatest(coalesce(p_recovery,0),0), v_base * 0.10))::numeric;
END;
$$;

CREATE OR REPLACE FUNCTION nihongo_submit_answer(
  p_user_id text,
  p_event_id uuid,
  p_kana_type text,
  p_kana text,
  p_answer_text text,
  p_response_ms integer
)
RETURNS jsonb
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
  v_kana_id integer;
  v_answers text[];
  v_answer text;
  v_is_correct boolean;
  v_now timestamptz := clock_timestamp();
  v_total integer := 0;
  v_correct integer := 0;
  v_wrong integer := 0;
  v_mastery numeric := 0;
  v_streak integer := 0;
  v_best integer := 0;
  v_last_seen timestamptz;
  v_last_wrong timestamptz;
  v_review_flag boolean := false;
  v_review_step integer := 0;
  v_weak_level integer := 0;
  v_weak_streak integer := 0;
  v_weak_target integer := 0;
  v_next_review timestamptz;
  v_mastery_after numeric;
  v_retention numeric := 1;
  v_difficulty numeric := 1;
  v_meaningful numeric := 1;
  v_progress numeric := 0;
  v_recovery numeric := 0;
  v_period date;
  v_reviews numeric;
  v_unique integer;
  v_study numeric;
  v_rank numeric;
  v_last_event timestamptz;
  v_existing record;
BEGIN
  IF p_user_id IS NULL OR length(p_user_id) = 0 THEN
    RAISE EXCEPTION 'missing_user';
  END IF;
  IF p_event_id IS NULL THEN
    RAISE EXCEPTION 'missing_event_id';
  END IF;
  IF p_response_ms IS NULL OR p_response_ms < 0 OR p_response_ms > 600000 THEN
    RAISE EXCEPTION 'invalid_response_ms';
  END IF;
  IF char_length(coalesce(p_answer_text,'')) > 32 THEN
    RAISE EXCEPTION 'answer_too_long';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(p_event_id::text, 0));

  SELECT ae.is_correct, ae.mastery_after, ae.progress_delta, ae.recovery_delta
  INTO v_existing
  FROM answer_events ae
  WHERE ae.event_id = p_event_id AND ae.user_id = p_user_id;
  IF FOUND THEN
    RETURN jsonb_build_object(
      'duplicate', true,
      'correct', v_existing.is_correct,
      'mastery', v_existing.mastery_after,
      'progressDelta', v_existing.progress_delta,
      'recoveryDelta', v_existing.recovery_delta
    );
  END IF;

  SELECT id, answers INTO v_kana_id, v_answers
  FROM kana_catalog
  WHERE kana_type = p_kana_type AND kana = p_kana;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'unknown_kana';
  END IF;

  v_answer := lower(regexp_replace(trim(coalesce(p_answer_text,'')), E'\\s+', '', 'g'));
  v_is_correct := v_answer <> '' AND v_answer = ANY(v_answers);

  PERFORM pg_advisory_xact_lock(hashtextextended(p_user_id || ':' || v_kana_id::text, 0));

  SELECT total_attempts, correct_attempts, wrong_attempts, mastery_score,
         current_streak, best_streak, last_seen_at, last_wrong_at,
         review_flag, review_step, weak_level, weak_correct_streak
  INTO v_total, v_correct, v_wrong, v_mastery, v_streak, v_best, v_last_seen, v_last_wrong,
       v_review_flag, v_review_step, v_weak_level, v_weak_streak
  FROM kana_progress
  WHERE user_id = p_user_id AND kana_id = v_kana_id
  FOR UPDATE;

  IF NOT FOUND THEN
    v_total := 0; v_correct := 0; v_wrong := 0; v_mastery := 0;
    v_streak := 0; v_best := 0; v_last_seen := NULL; v_last_wrong := NULL;
    v_review_flag := false; v_review_step := 0; v_weak_level := 0; v_weak_streak := 0;
  END IF;

  SELECT max(created_at) INTO v_last_event
  FROM answer_events
  WHERE user_id = p_user_id;

  IF v_last_seen IS NOT NULL THEN
    IF v_now - v_last_seen < interval '30 seconds' THEN v_meaningful := 0;
    ELSIF v_now - v_last_seen < interval '5 minutes' THEN v_meaningful := 0.25;
    ELSIF v_now - v_last_seen < interval '1 hour' THEN v_meaningful := 0.5;
    ELSIF v_now - v_last_seen < interval '1 day' THEN v_meaningful := 1;
    ELSE v_meaningful := 1.5;
    END IF;
  END IF;

  IF p_response_ms < 300 THEN v_meaningful := 0; END IF;
  IF v_last_event IS NOT NULL AND v_now - v_last_event < interval '800 milliseconds' THEN v_meaningful := 0; END IF;

  IF v_last_seen IS NOT NULL THEN
    IF v_now - v_last_seen < interval '5 minutes' THEN v_retention := 1;
    ELSIF v_now - v_last_seen < interval '1 hour' THEN v_retention := 1.05;
    ELSIF v_now - v_last_seen < interval '1 day' THEN v_retention := 1.15;
    ELSIF v_now - v_last_seen < interval '3 days' THEN v_retention := 1.4;
    ELSIF v_now - v_last_seen < interval '7 days' THEN v_retention := 1.6;
    ELSE v_retention := 1.8;
    END IF;
  END IF;

  IF v_mastery < 40 THEN v_difficulty := 0.8;
  ELSIF v_mastery < 70 THEN v_difficulty := 1;
  ELSIF v_mastery < 85 THEN v_difficulty := 1.25;
  ELSIF v_mastery < 95 THEN v_difficulty := 1.6;
  ELSE v_difficulty := 2;
  END IF;

  IF v_is_correct THEN
    v_mastery_after := least(100, greatest(0, v_mastery + 4 * v_retention * greatest(0.55, 1.15 - v_mastery * 0.006)));
    v_progress := greatest(0, v_mastery_after - v_mastery) * v_difficulty * v_meaningful;
    IF v_last_wrong IS NOT NULL AND v_now - v_last_wrong <= interval '7 days' AND v_meaningful > 0 THEN
      v_recovery := least(2, v_progress * 0.25);
    END IF;
    v_streak := v_streak + 1;
    v_best := greatest(v_best, v_streak);

    IF v_weak_level > 0 THEN
      v_weak_streak := v_weak_streak + 1;
      v_weak_target := CASE v_weak_level WHEN 1 THEN 3 WHEN 2 THEN 4 ELSE 5 END;
      IF v_weak_streak >= v_weak_target THEN
        v_weak_level := 0;
        v_weak_streak := 0;
      END IF;
    END IF;

    IF v_review_flag THEN
      IF v_review_step >= 5 THEN
        v_review_flag := false;
        v_review_step := 0;
        v_next_review := v_now + CASE WHEN v_mastery_after < 25 THEN interval '2 minutes'
                                      WHEN v_mastery_after < 45 THEN interval '10 minutes'
                                      WHEN v_mastery_after < 65 THEN interval '1 hour'
                                      WHEN v_mastery_after < 80 THEN interval '12 hours'
                                      WHEN v_mastery_after < 92 THEN interval '2 days'
                                      ELSE interval '5 days' END;
      ELSE
        v_review_step := v_review_step + 1;
        v_next_review := v_now + CASE v_review_step
                                   WHEN 1 THEN interval '2 minutes'
                                   WHEN 2 THEN interval '5 minutes'
                                   WHEN 3 THEN interval '15 minutes'
                                   WHEN 4 THEN interval '1 hour'
                                   ELSE interval '1 day' END;
      END IF;
    ELSE
      v_next_review := v_now + CASE WHEN v_mastery_after < 25 THEN interval '2 minutes'
                                    WHEN v_mastery_after < 45 THEN interval '10 minutes'
                                    WHEN v_mastery_after < 65 THEN interval '1 hour'
                                    WHEN v_mastery_after < 80 THEN interval '12 hours'
                                    WHEN v_mastery_after < 92 THEN interval '2 days'
                                    ELSE interval '5 days' END;
    END IF;
  ELSE
    v_mastery_after := greatest(0, v_mastery - (5 + CASE WHEN v_last_wrong IS NOT NULL AND v_now - v_last_wrong < interval '5 minutes' THEN 1 ELSE 0 END));
    v_streak := 0;
    v_review_flag := true;
    v_review_step := 0;
    v_weak_level := least(3, v_weak_level + 1);
    v_weak_streak := 0;
    v_next_review := v_now + interval '45 seconds';
  END IF;

  INSERT INTO answer_events(event_id,user_id,kana_id,kana_type,kana,answer_text,is_correct,response_ms,
                            meaningful_weight,mastery_before,mastery_after,progress_delta,recovery_delta,created_at)
  VALUES(p_event_id,p_user_id,v_kana_id,p_kana_type,p_kana,v_answer,v_is_correct,p_response_ms,
         v_meaningful,v_mastery,v_mastery_after,v_progress,v_recovery,v_now);

  INSERT INTO kana_progress(user_id,kana_id,total_attempts,correct_attempts,wrong_attempts,mastery_score,
                            current_streak,best_streak,last_seen_at,last_correct_at,last_wrong_at,next_review_at,
                            review_flag,review_step,weak_level,weak_correct_streak,updated_at)
  VALUES(
    p_user_id,v_kana_id,1,CASE WHEN v_is_correct THEN 1 ELSE 0 END,CASE WHEN v_is_correct THEN 0 ELSE 1 END,
    v_mastery_after,v_streak,v_best,v_now,CASE WHEN v_is_correct THEN v_now END,CASE WHEN NOT v_is_correct THEN v_now END,
    v_next_review,v_review_flag,v_review_step,v_weak_level,v_weak_streak,v_now
  )
  ON CONFLICT(user_id,kana_id) DO UPDATE SET
    total_attempts = kana_progress.total_attempts + 1,
    correct_attempts = kana_progress.correct_attempts + CASE WHEN v_is_correct THEN 1 ELSE 0 END,
    wrong_attempts = kana_progress.wrong_attempts + CASE WHEN v_is_correct THEN 0 ELSE 1 END,
    mastery_score = v_mastery_after,
    current_streak = v_streak,
    best_streak = v_best,
    last_seen_at = v_now,
    last_correct_at = CASE WHEN v_is_correct THEN v_now ELSE kana_progress.last_correct_at END,
    last_wrong_at = CASE WHEN NOT v_is_correct THEN v_now ELSE kana_progress.last_wrong_at END,
    next_review_at = v_next_review,
    review_flag = v_review_flag,
    review_step = v_review_step,
    weak_level = v_weak_level,
    weak_correct_streak = v_weak_streak,
    updated_at = v_now;

  IF p_response_ms < 250 THEN
    INSERT INTO abuse_flags(user_id,event_id,reason,severity,metadata)
    VALUES(p_user_id,p_event_id,'fast_answer',CASE WHEN p_response_ms < 100 THEN 'high' ELSE 'low' END,
           jsonb_build_object('response_ms',p_response_ms));
  END IF;
  IF v_last_event IS NOT NULL AND v_now - v_last_event < interval '300 milliseconds' THEN
    INSERT INTO abuse_flags(user_id,event_id,reason,severity,metadata)
    VALUES(p_user_id,p_event_id,'event_burst','medium',jsonb_build_object('gap_ms',extract(epoch FROM (v_now-v_last_event))*1000));
  END IF;

  v_period := date_trunc('week', v_now AT TIME ZONE 'UTC')::date;
  INSERT INTO leaderboard_scores(user_id,period_start,progress_score,recovery_bonus,updated_at)
  VALUES(p_user_id,v_period,v_progress,v_recovery,v_now)
  ON CONFLICT(user_id,period_start) DO UPDATE SET
    progress_score = leaderboard_scores.progress_score + excluded.progress_score,
    recovery_bonus = leaderboard_scores.recovery_bonus + excluded.recovery_bonus,
    updated_at = v_now;

  SELECT coalesce(sum(meaningful_weight),0), count(DISTINCT kana_id)::integer
  INTO v_reviews, v_unique
  FROM answer_events
  WHERE user_id = p_user_id AND created_at >= v_period::timestamptz AND meaningful_weight > 0;

  v_study := nihongo_study_score(v_reviews, v_unique);
  SELECT nihongo_ranking_score(progress_score, v_study, recovery_bonus)
  INTO v_rank FROM leaderboard_scores WHERE user_id=p_user_id AND period_start=v_period;

  UPDATE leaderboard_scores
  SET meaningful_reviews=v_reviews, unique_kana=v_unique, study_score=v_study, ranking_score=v_rank, updated_at=v_now
  WHERE user_id=p_user_id AND period_start=v_period;

  RETURN jsonb_build_object(
    'duplicate', false,
    'correct', v_is_correct,
    'answer', v_answers[1],
    'mastery', round(v_mastery_after,3),
    'totalAttempts', v_total + 1,
    'correctAttempts', v_correct + CASE WHEN v_is_correct THEN 1 ELSE 0 END,
    'wrongAttempts', v_wrong + CASE WHEN v_is_correct THEN 0 ELSE 1 END,
    'currentStreak', v_streak,
    'bestStreak', v_best,
    'reviewFlag', v_review_flag,
    'reviewStep', v_review_step,
    'weakLevel', v_weak_level,
    'weakCorrectStreak', v_weak_streak,
    'nextReviewAt', v_next_review,
    'progressDelta', round(v_progress,4),
    'recoveryDelta', round(v_recovery,4),
    'meaningfulWeight', v_meaningful,
    'rankingScore', round(v_rank,4)
  );
END;
$$;
