-- Apply once to existing core DBs; schema.sql already includes it for fresh DBs.
-- Session results: per-question instructor timing ({ questionId: { explainMs, answerMs } }),
-- written by the lesson room in the same UPDATE that ends the session. NULL for older sessions.
ALTER TABLE lesson_sessions ADD COLUMN timing_json TEXT;
