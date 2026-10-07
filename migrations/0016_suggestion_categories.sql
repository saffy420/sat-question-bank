ALTER TABLE feature_suggestions ADD COLUMN category TEXT CHECK(category IN ('teaching','app','other'));
ALTER TABLE feature_suggestions ADD COLUMN session_id INTEGER;
UPDATE feature_suggestions SET category='app';
CREATE UNIQUE INDEX feature_suggestions_session ON feature_suggestions(user_id, session_id, category) WHERE session_id IS NOT NULL;
