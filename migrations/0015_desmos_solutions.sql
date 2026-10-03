-- Apply once to existing core DBs; schema.sql already includes it for fresh DBs.
-- Community Desmos solutions (imported from Prepzy with permission by tools/desmos/import.cjs), at most
-- one per core question. Main DB only: AI questions have none. state_json is a Desmos getState() object.
CREATE TABLE IF NOT EXISTS desmos_solutions (
  question_id TEXT PRIMARY KEY,
  state_json TEXT NOT NULL,
  credit_name TEXT,
  source TEXT NOT NULL DEFAULT 'prepzy',
  source_fingerprint TEXT,
  imported_at TEXT
);
