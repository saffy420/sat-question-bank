# lessons-09-history-stats — e2e

**Spec:** `tests/e2e/lessons-09-history-stats/history.spec.js` (1 test).

**Setup:**
- Local `wrangler dev` with local D1/DO (00b harness). `npm run e2e:seed` upgrades the isolated state with 0010.
- Browser: the preinstalled Chromium (`PW_CHROMIUM_PATH=/opt/pw-browsers/chromium`).
- Student 6 at 1366×768; instructor at 1920×1080.

**Fixtures (seed, test commit):**
- `e2e-student-6` (approved) takes the self-paced lessons.
- Three usage-filter questions, one per skill:
  - `e2e-used-mine` (Transitions): used in ended session 900003, which student 6 attended;
  - `e2e-used-other` (Rhetorical Synthesis): used in 900004, which student 2 attended;
  - `e2e-unused` (Boundaries): never used.

## Round 0 (after feat 9a7a5ce9 + 89c1d72f; tests 443f7e57)

**Commands:**
- `npm run e2e:seed && PW_CHROMIUM_PATH=/opt/pw-browsers/chromium npx playwright test tests/e2e/lessons-09-history-stats`
- `npm run e2e:seed && PW_CHROMIUM_PATH=/opt/pw-browsers/chromium npm run test:e2e` (full suite)

**Full suite, first run:** 16 passed, 9 failed. Classification:

| # | Spec | Class | Cause | Action |
|---|---|---|---|---|
| T1–T4 | 00b harness C1, C2, offline, leak scope | test bug | They expect exactly 4 bank IDs; the task 09 seed adds 3 filter fixtures. | Fixture list is now 7 (test commit 443f7e57). |
| T5 | 01 admin C2, Lessons tab | test bug | The new populated-tab assertion assumed student 1 has only instructor-paced sessions. Earlier local runs of 07/08 left self-paced sessions for student 1. | Assert the "Counts toward stats" column against each listed session's mode. |
| T6 | 02 builder | test bug | Expects 4 builder results; the bank now has 7. | Count updated. The usage-badge / hide-all check now runs on the fixed fixtures, because every ended live session now records usage for the core questions. |
| T8, T9 | ui-admin inventory at 1920 and 1366 | test bug | Expects 4 builder results. | Count updated (both places). |
| A1 | 09 history, checkpoint 2 (badges) | **app bug** | See below. | Repair round 1. |

### A1 details

- **Repro:**
  1. Student 6 opens `/app`, joins a self-paced lesson, finishes it, and the instructor ends it.
  2. The student uses Leave view, then opens Browse.
- **Expected:** `e2e-core-rw` shows every session it was used in, including the one just ended: `/api/questions` lists it.
- **Actual:** the badge misses the just-ended session. The same stale `usedInLesson` would also let **Hide questions from lessons I attended** keep showing a question from the lesson just attended until a page reload.
- **Cause:** `usedInLesson` rides only on the bank download at page load. Leaving a finished lesson reloads progress, attempts and lesson history, but not usage.
- **Failing assertion:** `history.spec.js:183`.

Checkpoints 1, 4, 5 and 6 passed in this round, before the spec stopped at A1. Checkpoints 2 (Browse), 3 and 7 did not run.
