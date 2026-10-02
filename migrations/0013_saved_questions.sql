-- Apply once to existing core DBs; schema.sql already includes it for fresh DBs.
-- Saved questions: the player's Mark for Review flag, kept per student so the Question Bank can
-- filter on it. One row per saved question; un-saving deletes the row.
CREATE TABLE IF NOT EXISTS saved_questions (
  user_id TEXT NOT NULL,
  question_id TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (user_id, question_id)
);
