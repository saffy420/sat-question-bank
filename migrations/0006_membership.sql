CREATE TABLE IF NOT EXISTS membership (
  user_id TEXT PRIMARY KEY NOT NULL,
  email TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('approved', 'pending', 'denied')),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  reviewed_at TEXT
);
