-- Public leaderboard names must identify one learner unambiguously.
-- The API normalizes whitespace and enforces a 2-24 character display-name policy.
CREATE UNIQUE INDEX IF NOT EXISTS idx_profiles_display_name_ci
  ON profiles (lower(display_name));
