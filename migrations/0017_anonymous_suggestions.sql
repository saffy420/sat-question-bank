ALTER TABLE feature_suggestions ADD COLUMN is_anonymous INTEGER NOT NULL DEFAULT 0 CHECK(is_anonymous IN (0,1));
CREATE TABLE feature_suggestion_daily_limits (
  user_id TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT(datetime('now'))
);
CREATE INDEX feature_suggestion_daily_limits_user ON feature_suggestion_daily_limits(user_id, created_at);
CREATE TABLE feature_suggestion_session_limits (
  user_id TEXT NOT NULL,
  session_id INTEGER NOT NULL,
  category TEXT NOT NULL CHECK(category IN ('teaching','app','other')),
  PRIMARY KEY(user_id, session_id, category)
);
INSERT INTO feature_suggestion_daily_limits (user_id, created_at)
  SELECT user_id, created_at FROM feature_suggestions WHERE session_id IS NULL;
INSERT INTO feature_suggestion_session_limits (user_id, session_id, category)
  SELECT DISTINCT user_id, session_id, category FROM feature_suggestions WHERE session_id IS NOT NULL AND category IS NOT NULL;
