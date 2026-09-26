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

## Repair round 1

**Fix commits:** `e5c7e2d2`, `04c8814d`. **Test commits:** `fa2097dd`, `64b35051`, `b827c5d0`.

- **B1:**
  - `/api/lesson-history` also returns `usage`: the padded session IDs of every question used in a session the student attended, from one query.
  - `loadProgress` merges it into `QS[].usedInLesson`. That covers sign-in, leaving a finished lesson and the reload after a lesson.
  - Unit tests: the usage map for a participant, and `{}` for a non-participant. E2E checkpoints 2 and 3 pass without a page reload.
- **B2:** history load errors show in `#lessons-error` on My Lessons. E2E: a routed 503 shows "Could not load this lesson." and no `#sync-bar`.
- **B3** (found in round-1 screenshots): while the history view is open, the empty live-lesson root is hidden. E2E: header and question `toBeInViewport()`; fails without the fix.
- **B4** (found in round-1 screenshots): `.dd-t > span:first-child { min-width: 0 }`, so a long dropdown value ellipsizes as `.dd-val` already intends. It affects only values that did not fit. E2E asserts the value stays inside its box; fails without the fix.
- **Re-review of the repair diff:**
  - The only new data is the usage map, which is public by §2.
  - The `.dd-t` rule changes nothing for values that fit.
  - No live-channel payload changed.
  - A scroll reset tried for question changes did nothing (the stage remounts), so it was removed. The e2e assertion for it stays.
- **Reruns:** unit 97/97; typecheck clean; task spec 1/1; full suite 24/25. **T10** is a test bug (fixture ID order in 00b), fixed in `b827c5d0`. After that: **25/25** twice.

## Repair round 2

**Fix commit:** `b5f96636`. **Test commit:** `6fedf87a`.

- **B6** (found in round-1 screenshots): a usage badge listing many sessions ran past the mistake card. `.tag.t-used` now wraps. E2E asserts the badge stays inside the card; fails without the fix.
- **Re-review:** a one-rule CSS change, scoped to `.t-used`.
- **Reruns:** unit 97/97; task spec 1/1; full suite **25/25**.

**Verdict after round 2: PASS.**
- Open non-blocking items: N1 (history shows the current bank row), N2 (unused `notesHTML` re-export in `lesson-ui/index.tsx`), N3 (two score functions over different inputs) and N4 (the D1 batch size at class scale is a manual check).
- No blocker survived two rounds.
