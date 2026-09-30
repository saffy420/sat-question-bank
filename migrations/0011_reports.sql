-- Apply once to existing core DBs; schema.sql already includes it for fresh DBs.
-- Question reports, their AI triage outcomes and feature suggestions (src/reports.js).
CREATE TABLE question_reports (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  question_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  category TEXT NOT NULL CHECK(category IN ('formatting','wrong_answer','typo','other')),
  note TEXT NOT NULL DEFAULT '',
  seen_in TEXT NOT NULL CHECK(seen_in IN ('bank','lesson','history')),
  context_json TEXT NOT NULL DEFAULT '{}',
  html TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'open' CHECK(status IN ('open','closed')),
  created_at TEXT NOT NULL DEFAULT(datetime('now')),
  closed_at TEXT
);
-- One open report per user per question; the daily limit reads (user_id, created_at).
CREATE UNIQUE INDEX question_reports_open ON question_reports(user_id, question_id) WHERE status='open';
CREATE INDEX question_reports_user ON question_reports(user_id, created_at);
CREATE INDEX question_reports_question ON question_reports(question_id) WHERE status='open';
-- One row per Claude call (called=1) or per escalation raised without one (called=0).
CREATE TABLE question_triage (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  question_id TEXT NOT NULL,
  kind TEXT CHECK(kind IN ('fix','escalation')),
  reason TEXT NOT NULL DEFAULT '',
  patch_json TEXT,
  called INTEGER NOT NULL DEFAULT 0 CHECK(called IN (0,1)),
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('running','pending','applied','dismissed','superseded')),
  last_report_id INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT(datetime('now')),
  decided_at TEXT
);
CREATE INDEX question_triage_question ON question_triage(question_id, created_at);
CREATE INDEX question_triage_calls ON question_triage(created_at) WHERE called=1;
CREATE INDEX question_triage_applied ON question_triage(id) WHERE status='applied';
CREATE TABLE feature_suggestions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL,
  area TEXT CHECK(area IN ('bank','lessons','plan','other')),
  body TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'new' CHECK(status IN ('new','done','dismissed')),
  created_at TEXT NOT NULL DEFAULT(datetime('now'))
);
CREATE INDEX feature_suggestions_user ON feature_suggestions(user_id, created_at);
