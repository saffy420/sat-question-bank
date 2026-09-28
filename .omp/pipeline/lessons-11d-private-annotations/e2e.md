# lessons-11d-private-annotations: e2e

**Spec:** `tests/e2e/lessons-11d.spec.js` (3 tests). **Unit:** `tests/test_lesson_room.cjs`, one new test and one rewritten assertion.

**Setup:**
- Local `wrangler dev` with local D1 and Durable Objects (00b harness), seeded with `npm run e2e:seed`.
- Bundles rebuilt with `npm run build:lesson`.
- Browser: the preinstalled Chromium (`PW_CHROMIUM_PATH=/opt/pw-browsers/chromium`).
- Screens: instructor at 1920×1080, students at 1366×768.

**Commands:**
- `npm test`: unit, **148/148**. `test_grade.cjs` calls Windows `git.exe`, so on Linux a `git.exe → git` shim goes on `PATH`.
- `npm run typecheck`: clean.
- `npm run e2e:seed && PW_CHROMIUM_PATH=/opt/pw-browsers/chromium npx playwright test`: full suite.

## Checkpoints

| # | Checkpoint | Result | Assertion |
|---|---|---|---|
| D1 | **Checkpoint:** the instructor highlights text and strikes a choice while the timer runs; students see neither; at 0 both appear on every student on the same text at 1366×768 | PASS | The lesson has a 40 s timer, and the reveal is the alarm, not End now. During ANSWERING the instructor adds a highlight on "Careful readers compare evidence" in paragraph 2, ⊖ B, a pen stroke and the laser. After an ordering barrier (below), both students have 0 `[data-ann-mark]`, no `.eliminated`, no ink pixels and a hidden laser dot, and their sockets received no instructor frame. At 0, both show `[highlighted]` in the **same paragraph index** as the instructor's mark, `eliminated = [B]` and the ink. The first instructor payload on each socket is the REVEALED snapshot, carrying highlight + stroke + `[B]`, so one snapshot published everything. |
| D1 | Covers pen, highlight, strikethrough, eliminations and laser | PASS | Highlight, stroke, ⊖ and laser: timer test. Strikethrough uses the same `annotate` path (unit test: a `strike` op before the reveal echoes only to the instructor). |
| D1 | Indicator "Hidden until reveal" | PASS | Shown in ANSWERING (timer test) and in READY of the next question (End-now test). Gone after the reveal and on a revisit. All six tools are enabled before the reveal. |
| D1 | Reconnect before the reveal gets nothing; after it, the full set | PASS | Student 2 reloads and rejoins mid-question: no marks, no eliminations, no frames. After the reveal, student 1 reloads: both highlights, `[B, D]` and the ink. |
| D1 | From the reveal on, live | PASS | A new highlight and ⊖ D reach both students without a reload. The laser dot follows live. |
| D1 | Laser resting through the reveal | PASS | The pointer rests on the stage with the laser on while the timer runs, and student 1 has no dot. At 0, both students show the dot. When the pointer leaves, it hides. |
| D1 | End now publishes; the next question is private again | PASS | Q1: highlight + ⊖ C during ANSWERING. End now → `[highlight]`, `[C]`. Q2: ⊖ A in READY and a pen stroke in ANSWERING stay private, then End now → `[A]` + ink. |
| D1 | Revisited questions (11b navigator) | PASS | ‹ back to Q1 shows the published highlight and `[C]`. A new highlight and ⊖ D on the revisit arrive live. |
| D1 | Self-paced review unchanged | PASS | Existing 11a "A1 eliminations sync in self-paced review mode" and spec 08 pass unchanged. |
| D1 | Leak helper extended | PASS | With `phaseAware`, `captureLeaks` tracks each student socket's phase. `annotate`, `laser` and `eliminations` frames, and snapshots with a non-empty `annotations` or `eliminations`, are violations before REVEALED. The 11d spec unit-tests `layerLeaks`, and both e2e tests assert `violations() = []` before and after the reveal. Specs 04, 06 and 11b now also run this check, and still pass. |

**Ordering barrier:** "students see nothing" is not a fixed wait.
- The room handles one message at a time and sends each socket's frames in order.
- Once the instructor's own card shows the room's echo, the test has a student select a choice and waits for that selection's acknowledging snapshot on the student's socket.
- Every frame the instructor's actions produced for that student must have arrived before it.

## Rewritten specs (for the new behaviour, not loosened)

- **Spec 05 is unchanged.** The brief says it asserts that annotations are live during the question. It doesn't: it clicks End now before its first annotation, so every assertion runs in REVEALED, where they still hold.
- **11a A1** asserted that instructor eliminations reach students during ANSWERING. It now asserts:
  - they don't reach students during ANSWERING, and a student's own C stays private;
  - at End now both students see `[B]` at 50% opacity;
  - the offline/restore/reload/instructor-reload scenario (D crossed out, B restored) runs after the reveal, where it is live;
  - the choice-text Strikethrough and My Lessons steps are unchanged.
- **11b layout** and **ui-admin-dashboard live presenter states:** `pen toBeDisabled()` in ANSWERING became `toBeEnabled()`, plus the "Hidden until reveal" text.
- **Unit "annotation protocol gates…":**
  - a pre-reveal annotate used to get "invalid phase";
  - now a lobby annotate gets "invalid phase";
  - a live pre-reveal mark echoes to the instructor and is absent from every student frame.

## Reproduced before fixing, and verified by reverting

- **Room gate reverted** (`src/lesson-room.js` from main; client, tests and seed kept):
  - the timer checkpoint fails: the room rejects the pre-reveal highlight, so the instructor's card has no mark;
  - the End-now test fails: `layerFrames` on the student socket contains the `eliminations` frame for C.
- **Unit tests on the reverted room:** the new 11d test and the rewritten protocol test fail; with the fix, 34/34 in `test_lesson_room.cjs`.
- **Resting laser:** the first full run on the gate-only code failed **11a A3**, the figure question.
  - The pointer came to rest on "chart" during the End-now grace period, when the laser was private.
  - After the reveal, students got no dot until the pointer moved.
  - With the `resting` fix in `Live.tsx`, A3 passes, and so does the new resting-laser assertion in the timer test.

## Full suite runs

| Run | Result | Time |
|---|---|---|
| 1 | 48 passed, 1 failed: 11a A3 (the resting laser; see above) | 11.7 min |
| — | `Live.tsx` resends the resting laser position when the phase changes; the 11d timer test asserts it | — |
| 2 | **49 passed** | 11.6 min |

Screenshots are in `.omp/pipeline/lessons-11d-private-annotations/e2e/` (gitignored), with compressed copies in `docs/lessons/11d/`.
