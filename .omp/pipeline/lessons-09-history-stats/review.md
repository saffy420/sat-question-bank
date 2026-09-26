# lessons-09-history-stats — review

**Diff reviewed:** `git diff claude/lessons-08-review-polls...HEAD` (through 443f7e57), against `spec.md` and BRIEF §12.6. The e2e round 0 results are in `e2e.md`.

## Findings (listed before fixing)

| # | Severity | Where | Finding |
|---|---|---|---|
| B1 (A1) | Blocker (§9.2 badges and filter) | `public/index.html` `loadProgress` / `leave()` | `usedInLesson` is loaded only with the bank at page load. After a lesson ends, badges miss that session, and **Hide questions from lessons I attended** keeps showing its questions until the page is reloaded. Leaving a finished lesson refreshes `attended` but not usage, so the filter is wrong exactly when the student returns from class. |
| B2 | Blocker (UX correctness) | `public/index.html` `openLessonHistory` | A failed history load goes through `warnSync`. That sets the sticky `readWarn` in the save-status banner, so "Could not load this lesson" stays on every later banner ("… answers not saved yet") until reload. The error belongs inline on the My Lessons page. |
| N1 | Non-blocking (decision) | `src/record.js` `lessonHistory` | History renders the question's **current** bank row. Question bodies are frozen only in the DO; D1 keeps the frozen items (ids, times, notes), not the stems. Notes, answers and review marks come from the session. Recorded for the PR. |
| N2 | Non-blocking | `lesson-ui/index.tsx` | `export { notesHTML }` is unused (admin re-exports it from `lesson-ui/notes.ts`). Harmless. |
| N3 | Non-blocking (decision) | `shared/lesson.js` `lessonScore` / `setResults` | Two score computations over different inputs: the room's live state versus stored `is_correct`. Both are right ÷ scorable, and `is_correct` was itself graded by `isRight`. Not a second copy of a stat definition, but noted. |
| N4 | Manual check | `record.js` `lessonWriteBack` | A 25 × 20 completion is about 1,500 statements in one D1 batch. This follows the existing batch pattern but is not measured against D1's per-invocation query limit. |

## §12.6 checklist

- **(a) Rule 5: PASS.**
  - Live snapshots are unchanged.
  - Notes and explanations appear only in `/api/lesson-history/:id`, which is off the leak-scanned live channel and returns 404 until `ended` or for non-participants (unit + e2e).
  - `captureLeaks` (phase-aware) on student 6 across both lessons: `violations() == []`.
- **(b) Rule 4: PASS.** No timer, lock or phase logic changed.
- **(c) Rule 6: PASS.** The write-back rides the existing completion batch, and usage rides the end batch. No per-event writes.
- **(d) Rule 2: PASS.**
  - `nextProgress` / `attemptRow` hold the client's record rule, now called by the SPA and the room.
  - `progressStatement` / `attemptStatement` are the single SQL writer for the practice API and the write-back.
  - `lessonUsageVisible` is the single filter for the bank and the builder.
- **(e) Rule 7: PASS.** Nothing from task 10.
- **(f) PASS.** Every spec checkpoint 1–8 has an asserting step. Checkpoints 2 (Browse), 3 and 7 are blocked by A1 in round 0.
- **(g) PASS.** No `.skip`, `.only` or `fixme`.
  - The earlier-spec edits change fixture counts (bank 4 → 7, members 5 → 6).
  - The builder usage check moves to fixtures with fixed usage, still asserting the exact badge text and the exact hide-all result.
  - The 01 Lessons tab is asserted exactly against the page's own response.
- **(h) PASS.** No fixed sleeps. History readiness uses `expect.poll`.
- **(i) PASS.** `443f7e57` touches only `tests/e2e/` and `tools/e2e_core.sql`. The account allowlist change (`src/index.e2e.js`, local test entry) is a separate feat commit.
- **(j) PASS.** `e2e.md` records the full-suite run.
- **(k) PASS.** Only task 09 work.
- **Task items:**
  - Self-paced write-back through the shared path with `lesson_session_id`, exactly once: unit test on real SQLite, replaying the batch.
  - Instructor-paced writes nothing: unit + e2e (progress and attempts deep-equal before and after).
  - Three filter options: unit; e2e blocked by B1.

**Verdict before repairs: 2 blockers (B1, B2)**, leading to repair round 1.
