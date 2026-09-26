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

## Repair round 1 (fix e5c7e2d2, 04c8814d; tests fa2097dd, 64b35051, b827c5d0)

- **Task spec:** 1/1 after the B1/B2 fix. Checkpoints 2, 3 and 7 now run and pass.
- **Screenshot review** found two more app bugs:
  - **A2 (B3):** the history overlay opened blank. The empty live-lesson root kept its full-height box above the history view.
  - **A3 (B4):** the "Lesson questions" value overflowed its dropdown box at 1366×768.
- **New assertions** (fail without the fix, pass with it; both verified by reverting the fix):
  - history header and question `toBeInViewport()`;
  - the dropdown value's right edge stays inside its box.
- A question change starting at the top is also asserted. It already held without a fix: the stage remounts, so no fix was kept.
- **Full suite rerun:** 24 passed, 1 failed (00b C2).
  - **T10**, test bug: the harness walks the practice set in fixture-ID order, and the new fixture IDs were listed after the AI row rather than in bank order (core rows, then AI).
  - After fixing the ID order (b827c5d0): **25/25**, twice in a row (2.7 min each). Desmos latency in those runs was 257–377 ms.

## Repair round 2 (fix b5f96636; test 6fedf87a)

- **A4 (B6):** on a mistake card, a question reused in many sessions pushed its usage badge past the card edge.
  - **Fix:** the badge wraps.
  - **New assertion:** the badge stays inside the card. Verified to fail without the fix.
- **Reruns:** unit **97/97**; task spec 1/1; full suite **25/25** (2.8 min).

## Checkpoints (final)

| # | Checkpoint | Result | Assertion |
|---|---|---|---|
| 1 | My Lessons shows each question with the student's answer, explanation, notes as "Breakdown", saved annotations and Desmos | PASS | The row opens the history overlay, with header and question on screen. It shows "Your answer: A", "Correct answer: C", C `.right` and A `.wrong`, the explanation marker, and a Breakdown heading with the notes marker and **Add** rendered as `<strong>`. The saved highlight "What is" is painted, and the read-only Desmos lists 4242 with no fork button. Q2: "Your answer: B" and "No breakdown for this question." |
| 2 | Questions show padded session IDs | PASS | `/api/questions` `usedInLesson` ends with the two new padded IDs. The Browse badge equals `Lesson <all IDs>`; the fixture shows `Lesson 900003`; the unused question has no badge. My Lessons rows and mistake tags use padded IDs. |
| 3 | Each of the three filter options hides exactly the right questions | PASS | For each option: the label is shown and the "N matching questions" count equals the set computed from `/api/questions` plus `/api/lesson-history` attended. The topic rows equal exactly the computed skills. The fixtures show Transitions / Rhetorical Synthesis / Boundaries = 0/1/1 (hide attended), 0/0/1 (hide all) and 1/1/1 (show all). |
| 4 | A self-paced mistake appears in the mistake log tagged with its session | PASS | Written at set completion: `[RW, B, 0]`, `[SPR, 3, 1]` with `lesson_session_id`. After Leave view, with no page reload, the mistake card for RW shows `Lesson <id>` and Incorrect. The progress marker is Red. |
| 5 | An instructor-paced wrong answer does not | PASS | Student 6's `/api/progress` and `/api/attempts` deep-equal the values from before the instructor-paced lesson, in which both answers were wrong. No attempt carries that session. |
| 6 (added) | History refused before the end; live channels clean | PASS | `/api/lesson-history/<id>` returns 404 while live and in review, and 200 once ended. `captureLeaks` (phase-aware) on student 6 across both lessons gives `violations() == []` with frames present. A failed load shows inline on My Lessons with no save banner. |
| 7 (added) | Admin Lessons tab and Mistakes tag | PASS | Admin → Student 6 → Mistakes: the RW row shows `Lesson <id>`. Lessons: the self row reads `Self-paced · 1 / 2 (50%) · Yes`; the paced row reads `Instructor-paced · 0 / 2 (0%) · No`. |
| 8 (added) | Full existing suite green | PASS | 25/25, including tasks 00b–08 and the UI suites. |

Artifacts (gitignored): `.omp/pipeline/lessons-09-history-stats/e2e/01-mistakes-lesson-tag … 07-admin-lessons.png`.

## Environment notes

- The workerd `SSLV3_ALERT_CERTIFICATE_UNKNOWN` lines are the known self-signed local TLS noise.
- The isolated E2E state is cumulative across runs. Since task 09, ended live sessions record usage and self-paced sets write stats. So:
  - the builder's usage check runs on the fixed-usage fixtures;
  - the self-paced specs use student 6, not student 1, whose seeded stats the dashboard specs pin.
- **Incident during this task.** A leftover `git.exe` shim from an earlier session was a symlink to `/usr/bin/git`. Rewriting the shim went through the link and replaced the git binary with a recursive script.
  - The binary was restored from the identical `/usr/lib/git-core/git`, and `dpkg -V git` is clean. `git fsck` is clean.
  - Two empty junk files that the runaway processes created in the repo root were deleted.
  - The shim is now a plain script that calls `/usr/bin/git` directly.
