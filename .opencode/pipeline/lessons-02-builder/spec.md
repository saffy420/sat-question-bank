# lessons-02-builder — spec

## Goal
Admin-only lesson templates (§4) backed by clean D1 migration(s): filter/add/reorder/remove questions, per-question time + notes, autosave, library, frozen session row + join code. No live DO/realtime, no student lesson UI, no stats/history write-back.

## Requirements
- Migration `migrations/0008_lessons.sql` + `schema.sql` snapshot update. Tables in core DB only:
  - `lessons(id INTEGER PK AUTOINCREMENT, title TEXT NOT NULL, mode TEXT NOT NULL CHECK(mode IN ('instructor','self')), created_by TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT(datetime('now')), updated_at TEXT NOT NULL DEFAULT(datetime('now')))`
  - `lesson_questions(lesson_id INTEGER NOT NULL REFERENCES lessons(id) ON DELETE CASCADE, position INTEGER NOT NULL, question_id TEXT NOT NULL, time_limit_sec INTEGER NOT NULL CHECK(time_limit_sec BETWEEN 5 AND 10800), notes TEXT NOT NULL DEFAULT '', UNIQUE(lesson_id, position), UNIQUE(lesson_id, question_id))`
  - `lesson_sessions(id INTEGER PK AUTOINCREMENT, lesson_id INTEGER NOT NULL REFERENCES lessons(id), join_code TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'lobby' CHECK(status IN ('lobby','live','review','ended')), created_at TEXT NOT NULL DEFAULT(datetime('now')), started_at TEXT, ends_at TEXT, ended_at TEXT, snapshot_json TEXT NOT NULL)` + partial unique `CREATE UNIQUE INDEX lesson_sessions_join_code_active ON lesson_sessions(join_code) WHERE status != 'ended'`
  - `question_lesson_usage(question_id TEXT NOT NULL, session_id INTEGER NOT NULL, used_at TEXT NOT NULL DEFAULT(datetime('now')), PRIMARY KEY(question_id, session_id))`
- Join code: 6 chars from `ABCDEFGHJKMNPQRSTUVWXYZ23456789`, retry on collision (max 10 attempts → 503), unique among non-ended sessions only. `padSessionId(id)` → 5-digit zero-padded display helper shared by server/client where needed.
- Admin API inside existing `src/index.js` role gate (DB-derived role, student 403, unauth 401, unknown admin path 404, invalid 400, DB failure 503). No student route touches lesson tables. Endpoints:
  - `GET /api/admin/questions?section=&domain=&skill=&difficulty=&lessonUsage=hide-all|show-all&search=&page=` — reuse `bank()` + `normalizeQuestion` ordering via `cbSort`; paginated (PAGE_SIZE 25); each row includes `usedInLesson: ["00001",...]` oldest-first from `question_lesson_usage`. Bounded/validated params; read-only, no `touchUser`.
  - `GET/POST /api/admin/lessons`, `GET/PUT/DELETE /api/admin/lessons/:id` (PUT replaces ordered items transactionally, rejects duplicate `question_id`, unknown question IDs via `questions`+`ai_ids` guard, invalid time/notes/mode/title → 400).
  - `POST /api/admin/lessons/:id/duplicate`, `POST /api/admin/lessons/:id/sessions` (creates `lesson_sessions` with frozen `snapshot_json` = template title/mode/items at start; never mutates `lessons`/`lesson_questions`; returns `{sessionId, paddedId, joinCode}`).
  - `GET /api/admin/lessons/:id/sessions` (past sessions: id/padded/code/status/times).
- Builder UI in existing `/admin` shell (`public/admin.html`, `public/admin.js`): Lessons section replaces "unavailable" placeholder; three columns Filters/Results/Lesson; library card grid above or behind builder with Start/Edit/Duplicate/View past sessions.
  - Filters reuse `DOM_ORDER`/`SKILL_ORDER`/`cbSort`; skills limited to chosen domains; difficulty checkboxes; lesson-questions select Show all / Hide all lesson questions; free-text search across id/skill/stem text.
  - Results paginated, row: ID, skill, difficulty, `usedInLesson` badges; click → `previewHTML` (answer + explanation visible, admin-only); `+` adds (duplicate → inline error); `Add all on page`.
  - Lesson column: title input, mode radio (Instructor default), live total time mm:ss sum; drag reorder (HTML5 DnD + keyboard up/down for a11y), × remove; per-question ✎ drawer: time chips 30s/45s/1m/1m30/2m/3m + custom mm:ss, notes textarea with safe preview (escape HTML, bounded `**bold**`, `*italic*`, ``code``, lists, paragraphs + KaTeX `\(...\)`/`\[...\]` via existing `mathify`; no raw HTML/script), question `previewHTML` reference.
  - Defaults for new items: R&W 60s, Math 90s (`TARGET_MS`-consistent; single constant).
  - Autosave drafts (debounced PUT, status text Saved/Saving/Error+Retry); Save + Save & start session (creates session, shows code + join URL large-type, does not navigate away from template).
- Security: all builder payloads admin-only; notes stored raw server-side but preview escaped; student `/api/questions` unchanged (G1-A). No answers/notes leak to new student routes (none added). Escape all interpolated output.
- Non-goals: Live lobby/WS/DO, student join/lesson views, polls/review/history, stats write-back, Desmos, annotations, session start/live/review/ended transitions beyond row creation.

## Validation
- Developer: `rtk npm test` (new `tests/test_lessons_builder.cjs`); `rtk node --check src/index.js public/admin.js`; `rtk git.exe diff --check`; dual-path migration check (fresh `schema.sql` apply + 0008 upgrade on pre-0008 schema).
- Unit tests must cover: join-code charset/collision retry; duplicate question-ID rejection; total-time sum + mm:ss parse/format; default times by section; `padSessionId`; frozen snapshot (template edit after session creation leaves `snapshot_json` unchanged); `usedInLesson` oldest-first mapping; invalid payload 400s.
- Test Developer (fresh session, Playwright CLI skill, 1366×768): every checkpoint below as committed specs under `tests/e2e/lessons-02-builder/` + full suite `rtk npm run test:e2e`; writes `.opencode/pipeline/lessons-02-builder/e2e.md` with pass/fail, commands, screenshot paths, failure classification (test bug fix/rerun; app bug stop + repro).

## E2E checkpoints (exact §12.5 task02 list, none dropped)
Build a lesson using domain + skill filters; add, reorder by drag, remove; set custom times; write notes with math and see the preview; save, reload, everything persists; total time updates; "Hide all lesson questions" works in the builder; Save & start session produces a join code.

## Reviewer must verify
Migrations number cleanly (0008, snapshot/upgrade dual path); template edits never touch past sessions (frozen `snapshot_json` + no template mutation on session create); admin-only writes (role/401/403/404/400/503 matrix); no later-task surface (no DO/WS/student lesson/poll/history); §12.4 standard checks (no student payload leak, no per-event D1, no duplicated stats, test diff app-code-free, no skips/sleeps, full suite evidence).
