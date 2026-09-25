# Task03 Handoff — lessons-03-realtime-core

## Status
Complete

## Goal
Working instructor-paced lobby + minimal live answering lifecycle on authenticated, persistent per-session Durable Object; student join/reconnect via real UI. Complete task03 only; task04 owns full reveal/player/distribution UX.

## Changed

### New files
- `src/lesson-room.js` — `LessonRoom` Durable Object class (220 lines): state/save/broadcast/snapshot/initialize/flush/advance/alarm/fetch/webSocketMessage lifecycle; per-session SQLite-backed DO; server-authoritative GRACE_MS=750; D1 writes only at join/finalization boundaries; one socket per student with 4001 replacement; late select rejected after grace; stable response identity with idempotent finalize retry
- `public/shared/lesson.js` — Shared lesson protocol module: `GRACE_MS=750`, `CODE`, `ADMIN_ACTIONS`, `STUDENT_ACTIONS`, `MAX_FRAME=2048`, `validAction(m,role)`, `lessonQuestion(q,reveal)` (strips rationale/trap/notes from student projection; reveals on REVEALED/ENDED or admin)
- `tests/test_lesson_room.cjs` — 8 unit tests (10 assertions): origin/upgrade gate, role action allowlist, student projection excludes answers/notes/traps/peers, server grace and durable finalize once + late select rejection after reconnect, join locked/ended + existing reconnect + unknown session, explicit join replaces existing tab + stale reconnect cannot retake ownership, one live socket replacement closes old transport + lock/selection persist across wake
- `tests/e2e/lessons-03-realtime-core/realtime.spec.js` — Full BRIEF §12.5 browser checkpoint spec (1 test, 6 checkpoints): nav join wrong-code inline + lowercase/pasted, instructor lobby names live, after-start admission, physical 20s WS outage recovery with real upstream close, second-tab replacement, join lock blocks new joins
- `wrangler.e2e.toml` — Added `[[durable_objects.bindings]]` LESSON_ROOM + `[[migrations]]` lesson-room-v1
- `wrangler.e2e-production.toml` — Added `[[durable_objects.bindings]]` LESSON_ROOM + `[[migrations]]` lesson-room-v1

### Modified files (task03 scope)
- `src/index.js` — Added `validLessonUpgrade()`, `lessonAccess()`, `lessonRoutes()`, `lessonDetail()`; `handleRequest` dispatches `/api/lessons/:id/ws` WS upgrade and `/api/lessons/join` POST through `env.LESSON_ROOM.fetch()`; `handleRequest` exports `LessonRoom` via `export { LessonRoom } from './lesson-room.js'`; DO binding referenced in production config
- `src/index.e2e.js` — Added `export { LessonRoom } from './lesson-room.js'` (1 line); retains local-only identity seam (`E2E_TEST_MODE` + loopback guard), never ships E2E auth in production
- `wrangler.toml` — Added `[[durable_objects.bindings]]` LESSON_ROOM + `[[migrations]]` lesson-room-v1

## Validation
- `rtk npm test` — PASS 64/64 unit tests (up from 55/55 baseline; 9 new task03 unit tests in `test_lesson_room.cjs`)
- `rtk npx playwright test tests/e2e/lessons-03-realtime-core/realtime.spec.js --workers=1` — PASS 1/1 (task03 focused E2E, ~71s including deliberate 20s offline)
- `rtk npm run test:e2e` — PASS 12/12 full E2E suite (11 pre-existing + 1 task03)
- `rtk git diff --check` — passed

## Review
PASS (Reviewer PASS confirmed). All BRIEF §12.5 task03 checkpoints verified:
1. Nav modal wrong code inline error; lowercase and pasted codes normalize to uppercase → PASS
2. Instructor lobby shows names live (Student 1, 2, 3) → PASS
3. Joining after start sees current question + nonempty clock → PASS
4. Student offline 20s restores question/time/selection via real WS close (code 1000) + physical offline → PASS
5. Second tab same account closes first WS, `Opened in another tab` → PASS
6. Lock joining blocks new joins (`joining locked` inline), incumbent stays Connected → PASS

## App repairs (task03 E2E discovered)
- **503 membership scoping**: `lessonAccess()` checks membership status before DO dispatch; `env.DB` availability verified (503 when DB absent)
- **Admin WS client**: admin role sends WS messages (`start`, `startQuestion`, `addTime`, `endNow`, `next`, `endSession`, `kick`, `lockJoin`) through `env.LESSON_ROOM.fetch()` with `X-Lesson-Internal: room` header
- **Second-tab replacement**: explicit join (`post('alice',true,newId)`) closes old socket with code 4001; stale reconnect with old clientId returns 409 even when `lockedJoin=true`; `active()` check prevents old tab from re-entering
- **Playwright test repair**: added clock restoration assertion (`clockAfterRecovery` must be ≤ `clockBeforeDrop - offlineMs/1000 + 2`); replaced CDP-flag-only offline with real `upstream.close({code:1000})` + `setOffline()` — browser `WebSocket.isClosed()` and `Reconnecting…` UI confirmed; condition waits replace fixed sleeps

## Caveats / next session
- Local E2E only; no production deploy, no D1 migration applied to production
- Practice-bank G1 exception: `/api/questions` answer exposure explicitly exempt from lesson-channel secrecy assertions; scope leak assertions limited to lesson channels only
- Task04 NOT started — requires fresh top-level session per one-numbered-task-per-top-level-session rule
- `public/shared/lesson.js` and `src/lesson-room.js` are new source files; `tests/test_lesson_room.cjs` uses `WebSocketPair` stub and `node:test` to test DO class without real Miniflare
- `src/index.js` lesson route additions are integrated into existing `handleRequest` dispatch chain; no separate lesson server
- `wrangler.toml` DO binding uses class_name `LessonRoom` matching the exported class; migration tag `lesson-room-v1` with `new_sqlite_classes`
- Screenshots at `.opencode/pipeline/lessons-03-realtime-core/e2e/` (gitignored, local only)
- No commit/push/deploy performed
