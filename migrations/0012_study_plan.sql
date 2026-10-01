-- Apply once to existing core DBs; schema.sql already includes both for fresh DBs.
-- Study Plan (docs/plan/BRIEF.md): one row per student holding the logged practice tests,
-- the per-skill cycle state and the current plan as JSON, so logging a test or finishing a
-- set costs one row write. `rev` makes a stale tab's save fail instead of overwriting.
CREATE TABLE IF NOT EXISTS study_plans (
  user_id TEXT PRIMARY KEY,
  state TEXT NOT NULL,
  rev INTEGER NOT NULL DEFAULT 1,
  updated_at INTEGER NOT NULL
);
-- The plan step an attempt belongs to ('test:PT6', a drill set's step ID), so stats include
-- plan work and it can be told apart.
ALTER TABLE attempts ADD COLUMN plan_step TEXT;
