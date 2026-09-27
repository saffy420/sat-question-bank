# free-03-guardrails — spec

Brief: `docs/perf/FREE-PLAN-BRIEF.md` §5 free-03, §6, §7. Base: `claude/free-02-optimize` (PR #9, stacked on #8).

## Current state (read from code, 2026-09-27)
- `LessonRoom.flush()` keeps the unflushed work in DO storage (`pending`, plus `nextPending` for one queued boundary) and deletes it only after D1 accepted it, so eviction already loses nothing.
- On any failure it arms an alarm 5 s out; `alarm()` retries. Messages retry inline and answer `persistence unavailable`. The room waits (no new boundary) while `pending` is stuck, so at most two flush payloads ever exist.
- Idempotent SQL already: `session_responses … ON CONFLICT DO NOTHING`; lesson attempts `INSERT OR IGNORE` on `attempts_lesson (lesson_session_id,user_id,question_id)` with a fixed `ts` (`writeBack.at` stored in `pending`); the progress move is skipped when that lesson attempt exists (`progressStatement(…, onlyOnce)`); `finished_at … IS NULL`; status updates are guarded; usage `INSERT OR IGNORE`; review upsert.
- The self-paced end is one atomic 1,526-statement batch (25 × 20) [local]. D1 batches are transactions (research.md).
- Nothing distinguishes a quota error; retries run every 5 s forever; admins see nothing.

## Changes

### 1. Failure classes and retry schedule — `src/flush.js` (new, pure)
- `d1Failure(e)` → `'quota'` for `daily row (read|write) limit` (doc-stated messages, research.md); `'overload'` for the doc-stated overload/transient/reset messages; else `'other'`.
- `nextReset(now)` → next 00:00 UTC.
- `retryAt(kind, failures, now)`:
  - `other`: `now + 5 s` (unchanged behavior);
  - `overload`: `now + min(5 s · 2^(n−1), 5 min)`;
  - `quota`: `min(now + min(5 s · 2^(n−1), 1 h), nextReset(now) + 1 min)` — backoff probes, and always a retry just after the reset.
- `chunkGroups(groups, max)`: packs whole per-student groups, in order, into chunks of ≤ `max` statements (a larger group goes alone). `FLUSH_CHUNK = 500` statements.

### 2. LessonRoom flush
- Rows (and self-paced `finished`) are grouped per student. Students already in `pending.done` are skipped. Each chunk is one `batch()`: that chunk's `session_responses`, `finished_at`, and (self-paced) the write-back statements for those students only (`lessonWriteBack` reads progress for the chunk's students). The `status='review'` update rides in the last chunk (or alone when every student is done). After each chunk except the last, `pending.done` is saved to DO storage. Then the existing review upsert, end batch, `delete('pending')`, `nextPending` promotion.
- Query cost: 25 progress SELECTs + ⌈statements / 500⌉ batches (4 for 25 × 20) instead of 1 batch. Worst invocation 26 → ~29, ≤ 35 target.
- Failure: `flushFailed(e)` classifies, and — when no retry is already scheduled, or when the alarm itself is retrying — stores `flushRetry {kind, failures, since, at}`, arms the alarm at `retryAt`, reports to the sync registry, rethrows. Message-driven failures while a retry is scheduled leave the schedule alone (no DO write per message).
- Success after failure: delete `flushRetry`, clear the registry entry.
- `alarm()` catch: re-arm at the stored retry time if it is still ahead, else 5 s (unchanged fallback).

### 3. Sync registry — `LessonSync` DO (new class, `src/lesson-sync.js`)
- One object (`getByName('all')`), internal header only. `POST {sessionId, at, kind, since}` stores, `POST {sessionId, clear:true}` deletes, `GET` lists. No D1, so it works while D1 is out.
- Bound as `LESSON_SYNC` with migration tag `lesson-sync-v1` (`new_sqlite_classes`) in `wrangler.toml`, both e2e configs and `[env.staging]`.
- A registry failure never breaks a flush (caught).

### 4. Admin banner
- `GET /api/admin/lesson-sync` (admin-only, behind the existing admin check) → `{ pending: [{ sessionId, at, kind, since }] }`, `private, no-store`.
- Admin shell (`admin-ui/index.tsx`) fetches it on load, on section change, and every 5 minutes; when non-empty shows one small banner above the page: "Lesson results saved locally, will sync after <time>." (latest `at`, local time). Students see nothing new (student SPA and lesson UI untouched).

### 5. Fault injection (test-only)
- `faultInjection(Base)` in `src/fault.js`, composed into `LessonRoom`. Inert unless `env.D1_FAULT_INJECTION === '1'` (then prototype methods are the base ones, and the fault route answers 404 as today).
- When on: `X-Lesson-Internal: fault` `POST {kind: 'quota'|'overload'|null, after?: n}` sets an in-memory fault; while set, `DB.batch()` and `.run()` reject with the doc-stated write-limit (or overload) message after `after` successful batches; reads pass.
- Worker route `POST /api/e2e/d1-fault {sessionId, kind, after}` in `src/index.e2e.js` only: `E2E_TEST_MODE === '1'`, `D1_FAULT_INJECTION === '1'`, loopback only (never staging), same origin/body checks as `/api/e2e/login`.

### 6. Budget tests (normal suite)
- `tools/budget_measure.cjs` becomes requirable: `measure({ target: 'local', port, persist, warm, only, faultInjection })` → results; CLI unchanged.
- `tests/budget_limits.cjs`: one constant block per flow (warm variants included) — worst D1 queries in one invocation, largest batch, flow rows read, flow rows written, Worker and DO invocation counts — each the post-free-02 value + 20% (ceil). Where free-03 lowers a value by design (self-paced largest batch, chunked), the lower value + 20% is pinned. Comment links `docs/perf/free-plan-budget.md`.
- `tests/test_budget_flows.cjs`: one `test()` per flow over a single local run (port 8791, `.wrangler/state-budget-test`), plus the e2e quota test below.

### 7. Tests
- Unit (`tests/test_flush.cjs`): classification of every doc-stated string; `retryAt` schedule (doubling, caps, reset bound); `nextReset`; `chunkGroups` (order, bounds, oversized group, empty).
- Unit (`tests/test_lesson_room.cjs`, real SQLite D1 shim with transactional batch): quota failure keeps `pending` and schedules per policy; message failures don't reschedule; a failure on chunk k keeps chunks < k and lands the rest once on retry; a rerun of a fully landed pending duplicates nothing; eviction mid-retry (new object over the same storage) lands everything once; registry reported/cleared.
- Inert: fault wrapper and route absent/404 without the flag; `wrangler.toml` and `wrangler.e2e-production.toml` set neither `BUDGET_TRACE` nor `D1_FAULT_INJECTION`; production entry has no `/api/e2e/*` route.
- e2e (in `test_budget_flows.cjs`, real Worker + DO + Miniflare D1, budget seed): 25 students × 20 questions self-paced; fault `quota` with `after: 1` (first chunk lands, the rest fail) before `submitAll`; assert partial landing, `pending` visible via `/api/admin/lesson-sync` with `at ≤ next reset + 1 min`; clear the fault; wait for the retry alarm; assert exactly 500 `session_responses`, one lesson attempt per scorable row, each progress row moved once, registry empty.
- Playwright: admin banner shows for a pending entry and not for an empty list (response routed in the page).

## Out of scope / unchanged
- The room still blocks new boundaries while a flush is stuck (lesson architecture, brief §3 hard stop otherwise).
- Instructor-paced flush payloads are unchanged (≤ 500 rows → one chunk).
- No change to student-visible payloads or caching.

## Success criteria
- `npm test` green, including budget tests; a deliberately inflated flow (local experiment, not committed) fails its budget test.
- e2e quota test green; full Playwright suite green.
- Report updated: free-03 section, chunk result, before/after for self-paced batch size and queries.
- Staging Worker deleted after the 2026-09-28 free-02 staging run; recorded in the PR.
