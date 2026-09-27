# lessons-09-history-stats — research

Research focus (§12.7): "Attempt-recording path from 00". The research was done inline by reading the code, without a researcher subagent: the questions sit in four files and the task 00 and 01 handoffs already name the paths.

## Attempt-recording path (the "existing path")

- **Client** (`public/index.html`, `// --- grade`):
  - `recordProgress(q, ok, now, ms)`:
    - increments `attempts`, adds 1 to `corrects` when right;
    - sets the marker: right after Red → Orange, right otherwise → Green, wrong → Red;
    - sets `last_reviewed = now` and `time_taken_ms = ms`;
    - then `saveProgress([p])` → `POST /api/progress`.
  - `recordAttempt(q, ok, now, ms, picked, changes)` builds `{question_id, ts, correct, time_taken_ms, picked, changes, answer_history_json?}` and calls `saveLog` → `POST /api/attempts`.
  - `grade()` calls `recordProgress` only on the first Check. It returns early for `ok === null` (unscorable), so nothing is written.
  - The exam scorer calls both functions for answered questions only.
- **Worker** (`src/index.js`):
  - **`POST /api/progress`** upserts the full row the client computed: `INSERT … SELECT … WHERE EXISTS(question) ON CONFLICT DO UPDATE`.
  - **`POST /api/attempts`** runs `INSERT OR IGNORE` guarded by the same EXISTS check. `UNIQUE(user_id, question_id, ts)` makes a replay a no-op.
  - Both are inline in `handleRequest`. No server-side attempt writer exists.
- **Conventions:**
  - No timeout or skip writer exists (G3).
  - A blank assigned scorable question is written as `picked=null, correct=0` (G3).
  - Unscorable questions are excluded.
- **Reading the data:**
  - The mistake log comes from `progress.marker` (Red or Orange), in both the SPA `wrongSet` and the admin `mistakes`.
  - Accuracy, weak spots, pacing, traps and second-guessing come from `progress` and `attempts` through `public/shared/stats.js` (`breakdown`, `tally`, …) and `direction()` for answer history.
  - So a write-back must update **both** `progress` (through the same marker rule) and `attempts`.

## Lesson data today

- **`question_lesson_usage`** exists (0008) but nothing writes it. Only `/api/admin/questions` reads it: it adds `usedInLesson` and supports `lessonUsage=show-all|hide-all`.
- **`/api/questions`** (the student bank) has no `usedInLesson`.
- **`session_responses`**:
  - self-paced: written once at set completion (`completeSet` → `pending.review` batch);
  - instructor-paced: written per question at finalize.
- **`session_question_review`** is written at Next and End session (tasks 05, 06, 08).
- **Session end** (`pending.end`): `lesson_sessions.status='ended'`. Nothing else happens at end.
- **What students were shown:**
  - Instructor-paced: from `status=live`, the current item's body travels in every snapshot, READY included, so items `0..s.index` were shown.
  - Self-paced: every assigned id's body travels in the full snapshot, so the set shown is the union of assigned sets.
- **Admin student detail:** the Lessons tab is a placeholder (task 01, G4). Mistakes come from markers plus the latest attempt's `picked`.
- **Notes markdown:** `notesHTML` is in `admin-ui/helpers.ts` (escape first, then paragraphs, lists and inline code/bold/em). `mathify` runs afterwards.
- **Rendering pieces to reuse:** Stage (annotation paint) and DesmosFollower (read-only follow plus an optional fork) are in `lesson-ui`. The SPA mounts `lesson-ui/lesson.js`.
- **Leak helper scope** is `/api/lessons/*`. Post-end history should therefore sit on its own path (`/api/lesson-history…`), so the live-channel leak scan keeps meaning "live session".
- **Unit test fixture:** the D1 mock (`tests/test_lesson_room.cjs` `fixture()`) records `prepare().bind().run()` only. A progress read needs `.all()`, which will be added to the fixture.
- **E2E seed** upgrades isolated state step by step (0007 → 0008 → 0009). A 0010 step is needed.

## Open risks

- **Stale progress in open tabs.** Progress rows are computed in the browser from in-memory `PROG`. After a server-side write-back, a tab that was already open holds stale `PROG` for those questions until it reloads. The next practice answer on the same question would post a row computed from the stale state. The fix is to reload account data when the student leaves a finished lesson.
- **D1 batch size.** A 25 × 20 class writes about 1,500 statements in one batch (responses, progress and attempts). This follows the existing 500-row batches, and the D1 per-invocation query limit is not measured here. It is recorded as a manual check.
