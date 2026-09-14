-- Per-user fixed-window API rate limits.
-- One row per user/action keeps storage bounded while advisory locks make increments atomic.

CREATE TABLE IF NOT EXISTS api_rate_limit_windows (
  user_id text NOT NULL,
  action text NOT NULL CHECK (char_length(action) BETWEEN 1 AND 64),
  window_started_at timestamptz NOT NULL DEFAULT now(),
  request_count integer NOT NULL DEFAULT 0 CHECK (request_count >= 0),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, action)
);

CREATE OR REPLACE FUNCTION nihongo_take_rate_limit(
  p_user_id text,
  p_action text,
  p_limit integer,
  p_window_seconds integer
)
RETURNS jsonb
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
  v_now timestamptz := clock_timestamp();
  v_started timestamptz;
  v_count integer;
  v_retry integer := 0;
BEGIN
  IF p_user_id IS NULL OR length(p_user_id) = 0 THEN
    RAISE EXCEPTION 'missing_user';
  END IF;
  IF p_action IS NULL OR length(p_action) < 1 OR length(p_action) > 64 THEN
    RAISE EXCEPTION 'invalid_rate_action';
  END IF;
  IF p_limit IS NULL OR p_limit < 1 OR p_limit > 10000 THEN
    RAISE EXCEPTION 'invalid_rate_limit';
  END IF;
  IF p_window_seconds IS NULL OR p_window_seconds < 1 OR p_window_seconds > 86400 THEN
    RAISE EXCEPTION 'invalid_rate_window';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended('rate:' || p_user_id || ':' || p_action, 0));

  SELECT window_started_at, request_count
  INTO v_started, v_count
  FROM api_rate_limit_windows
  WHERE user_id = p_user_id AND action = p_action;

  IF NOT FOUND THEN
    INSERT INTO api_rate_limit_windows(user_id, action, window_started_at, request_count, updated_at)
    VALUES(p_user_id, p_action, v_now, 1, v_now);
    RETURN jsonb_build_object('allowed', true, 'retryAfter', 0, 'remaining', p_limit - 1);
  END IF;

  IF v_now >= v_started + make_interval(secs => p_window_seconds) THEN
    UPDATE api_rate_limit_windows
    SET window_started_at = v_now, request_count = 1, updated_at = v_now
    WHERE user_id = p_user_id AND action = p_action;
    RETURN jsonb_build_object('allowed', true, 'retryAfter', 0, 'remaining', p_limit - 1);
  END IF;

  IF v_count >= p_limit THEN
    v_retry := greatest(1, ceil(extract(epoch FROM ((v_started + make_interval(secs => p_window_seconds)) - v_now)))::integer);
    RETURN jsonb_build_object('allowed', false, 'retryAfter', v_retry, 'remaining', 0);
  END IF;

  UPDATE api_rate_limit_windows
  SET request_count = request_count + 1, updated_at = v_now
  WHERE user_id = p_user_id AND action = p_action;

  RETURN jsonb_build_object('allowed', true, 'retryAfter', 0, 'remaining', greatest(0, p_limit - v_count - 1));
END;
$$;
