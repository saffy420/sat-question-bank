CREATE TABLE IF NOT EXISTS membership (
  user_id TEXT PRIMARY KEY NOT NULL,
  email TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('approved', 'pending', 'denied')),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  reviewed_at TEXT
);

CREATE TABLE IF NOT EXISTS questions (
  id TEXT PRIMARY KEY,
  external_id TEXT,
  section TEXT,
  domain TEXT,
  difficulty TEXT,
  skill TEXT,
  stem_html TEXT,
  choices_json TEXT,
  correct_answer TEXT,
  explanation_html TEXT,
  source TEXT,
  source_page INTEGER,
  has_figure INTEGER DEFAULT 0,
  stem_text TEXT DEFAULT ''
);
CREATE TABLE IF NOT EXISTS progress (
  user_id TEXT NOT NULL,
  question_id TEXT NOT NULL,
  attempts INTEGER DEFAULT 0,
  corrects INTEGER DEFAULT 0,
  marker TEXT DEFAULT 'Red',
  last_reviewed TEXT,
  time_taken_ms INTEGER,
  stars INTEGER DEFAULT 0,
  PRIMARY KEY (user_id, question_id)
);
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  email TEXT,
  name TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  role TEXT NOT NULL DEFAULT 'student' CHECK (role IN ('student', 'admin'))
);
-- One row per answer. `progress` keeps only the latest state of a question, so a
-- re-drill overwrote the date it was last seen and any per-day history with it.
-- This is the history: it is append-only and nothing rewrites a past row.
CREATE TABLE IF NOT EXISTS attempts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL,
  question_id TEXT NOT NULL,
  ts TEXT NOT NULL,
  correct INTEGER NOT NULL DEFAULT 0,
  time_taken_ms INTEGER DEFAULT 0,
  picked TEXT,
  changes INTEGER DEFAULT 0,
  answer_history_json TEXT,
  lesson_session_id INTEGER,
  -- 0012_study_plan.sql: the Study Plan step this answer was given in, if any.
  plan_step TEXT,
  UNIQUE (user_id, question_id, ts)
);
CREATE INDEX IF NOT EXISTS attempts_user_ts ON attempts (user_id, ts);
-- 0010_lesson_attempts.sql: a self-paced lesson writes one attempt per session/student/question.
CREATE UNIQUE INDEX IF NOT EXISTS attempts_lesson ON attempts (lesson_session_id, user_id, question_id) WHERE lesson_session_id IS NOT NULL;

-- 0012_study_plan.sql: the Study Plan, one JSON row per student (logged tests, per-skill
-- cycle state, current plan). `rev` rejects a save made from a stale copy.
CREATE TABLE IF NOT EXISTS study_plans (
  user_id TEXT PRIMARY KEY,
  state TEXT NOT NULL,
  rev INTEGER NOT NULL DEFAULT 1,
  updated_at INTEGER NOT NULL
);

-- One JSON blob per account. These settings change shape often and are read as a
-- whole; a column per toggle would be a migration for every new preference.
CREATE TABLE IF NOT EXISTS settings (
  user_id TEXT PRIMARY KEY,
  json TEXT NOT NULL DEFAULT '{}',
  updated_at TEXT
);

-- One note per question per user, free text, edited in place. Bounded by its own
-- primary key once question_id has to name a real question, exactly as `progress`
-- is - so no per-account row ceiling is needed here.
CREATE TABLE IF NOT EXISTS notes (
  user_id TEXT NOT NULL,
  question_id TEXT NOT NULL,
  body TEXT NOT NULL DEFAULT '',
  updated_at TEXT,
  PRIMARY KEY (user_id, question_id)
);

-- The ids of the AI bank, whose rows live in a second D1 database. D1 cannot join
-- across databases, so this registry is what lets the progress/attempts/notes write
-- guards stay exact for a question `questions` has never heard of.
CREATE TABLE IF NOT EXISTS ai_ids (id TEXT PRIMARY KEY);

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

-- 0008_lessons.sql: fresh core DB snapshot (do not replay migration on this snapshot).
CREATE TABLE lessons (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  archived INTEGER NOT NULL DEFAULT 0 CHECK(archived IN (0,1)),
  title TEXT NOT NULL,
  mode TEXT NOT NULL CHECK(mode IN ('instructor','self')),
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT(datetime('now')),
  updated_at TEXT NOT NULL DEFAULT(datetime('now'))
);
CREATE TABLE lesson_questions (
  lesson_id INTEGER NOT NULL REFERENCES lessons(id) ON DELETE CASCADE,
  position INTEGER NOT NULL,
  question_id TEXT NOT NULL,
  time_limit_sec INTEGER NOT NULL CHECK(time_limit_sec BETWEEN 5 AND 10800),
  notes TEXT NOT NULL DEFAULT '',
  UNIQUE(lesson_id, position),
  UNIQUE(lesson_id, question_id)
);
CREATE TABLE lesson_sessions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  lesson_id INTEGER NOT NULL REFERENCES lessons(id),
  join_code TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'lobby' CHECK(status IN ('lobby','live','review','ended')),
  created_at TEXT NOT NULL DEFAULT(datetime('now')),
  started_at TEXT,
  ends_at TEXT,
  ended_at TEXT,
  snapshot_json TEXT NOT NULL
);
CREATE UNIQUE INDEX lesson_sessions_join_code_active ON lesson_sessions(join_code) WHERE status != 'ended';
CREATE TABLE session_participants (
  session_id INTEGER NOT NULL REFERENCES lesson_sessions(id),
  user_id TEXT NOT NULL,
  joined_at TEXT NOT NULL DEFAULT(datetime('now')),
  left_at TEXT,
  finished_at TEXT,
  assigned_question_ids_json TEXT NOT NULL,
  PRIMARY KEY(session_id, user_id)
);
CREATE TABLE session_responses (
  session_id INTEGER NOT NULL,
  user_id TEXT NOT NULL,
  question_id TEXT NOT NULL,
  final_answer TEXT,
  is_correct INTEGER CHECK(is_correct IN (0, 1)),
  locked_early INTEGER NOT NULL DEFAULT 0 CHECK(locked_early IN (0, 1)),
  time_spent_ms INTEGER NOT NULL DEFAULT 0 CHECK(time_spent_ms >= 0),
  answer_changes INTEGER NOT NULL DEFAULT 0 CHECK(answer_changes >= 0),
  answer_history_json TEXT,
  PRIMARY KEY(session_id, user_id, question_id),
  FOREIGN KEY(session_id, user_id) REFERENCES session_participants(session_id, user_id)
);
CREATE TABLE session_question_review (
  session_id INTEGER NOT NULL REFERENCES lesson_sessions(id),
  question_id TEXT NOT NULL,
  annotations_json TEXT,
  desmos_state_json TEXT,
  PRIMARY KEY(session_id, question_id)
);
CREATE TABLE session_polls (
  session_id INTEGER NOT NULL REFERENCES lesson_sessions(id),
  poll_index INTEGER NOT NULL,
  options_json TEXT NOT NULL,
  votes_json TEXT NOT NULL,
  winner_question_id TEXT,
  PRIMARY KEY(session_id, poll_index)
);
CREATE TABLE question_lesson_usage (
  question_id TEXT NOT NULL,
  session_id INTEGER NOT NULL,
  used_at TEXT NOT NULL DEFAULT(datetime('now')),
  PRIMARY KEY(question_id, session_id)
);

-- Question reports, their AI triage outcomes and feature suggestions (src/reports.js; migrations/0011).
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
