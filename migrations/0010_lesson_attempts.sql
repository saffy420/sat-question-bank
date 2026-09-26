-- Apply once to existing core DBs; schema.sql already includes both for fresh DBs.
-- Self-paced lesson write-back (BRIEF §10): an attempt's source session, and one
-- attempt per session/student/question so a retried write-back adds nothing.
ALTER TABLE attempts ADD COLUMN lesson_session_id INTEGER;
CREATE UNIQUE INDEX attempts_lesson ON attempts (lesson_session_id, user_id, question_id) WHERE lesson_session_id IS NOT NULL;
