-- Apply once to existing core DBs; schema.sql already includes both columns for fresh DBs.
ALTER TABLE users ADD COLUMN role TEXT NOT NULL DEFAULT 'student' CHECK (role IN ('student', 'admin'));
ALTER TABLE attempts ADD COLUMN answer_history_json TEXT;
