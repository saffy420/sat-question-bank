-- Apply once to existing core DBs; schema.sql already includes these tables for
-- fresh DBs. Never replay this file on a database created from the current
-- snapshot - it fails loudly rather than silently skipping (see dual-path test).

CREATE TABLE lessons (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
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
-- A code only has to be unique while its session is still running; ended
-- sessions keep their code for history.
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
