-- One JSON blob per exam or review session. Read as a whole, rewritten as a whole;
-- purged 30 days after its last write on the next read.
CREATE TABLE IF NOT EXISTS sessions (
  user_id TEXT NOT NULL,
  id TEXT NOT NULL,
  kind TEXT NOT NULL,
  state TEXT NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, id)
);
