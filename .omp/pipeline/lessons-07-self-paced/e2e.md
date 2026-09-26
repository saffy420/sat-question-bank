# lessons-07-self-paced — e2e

Spec: `tests/e2e/lessons-07-self-paced/self.spec.js` (2 tests). Local `wrangler dev` + local D1/DO (00b harness), seeded with `npm run e2e:seed`. Browser: preinstalled Chromium via `PW_CHROMIUM_PATH=/opt/pw-browsers/chromium`. Students 1366×768; instructor 1920×1080 in the main run.

Lessons are created through the admin API inside each test (as in tasks 04–06), so no seed changes were needed:
- Main run: `e2e-core-rw` 10 s (notes `E2E_NOTES_MARKER_SELF`), `e2e-core-math` 10 s, `e2e-core-spr` 5 s, `e2e-ai-rw` 10 s. The shared clock is 35 s and the limits are mixed, so the late-join fit is non-trivial.
- Early completion: `e2e-core-rw` 10 s + `e2e-core-spr` 10 s.

The 00b leak helper now also flags `questions[].answer` before reveal, because self-paced snapshots carry the whole set as `questions[]` (test-only change in `tests/e2e/lessons-00b-e2e-harness/leaks.js`).

## Commands (round 0, commit 817dc642)

- Task: `npm run e2e:seed && PW_CHROMIUM_PATH=/opt/pw-browsers/chromium npx playwright test tests/e2e/lessons-07-self-paced`: **2 passed** (1.0 min).
- Full suite: `npm run e2e:seed && PW_CHROMIUM_PATH=/opt/pw-browsers/chromium npm run test:e2e`: **23 passed** (2.4 min), i.e. 21 existing + 2 new.
- Unit: `npm test` (with the `git.exe` → `git` shim): **84/84**. Typecheck (`npm run typecheck`) clean.

Artifacts (gitignored): `.omp/pipeline/lessons-07-self-paced/e2e/01-lobby … 12-grid-finished.png`.

## Checkpoints

| # | Checkpoint | Result | Assertion |
|---|---|---|---|
| 1 | Next / Back / navigator / flag | PASS | Back is disabled on Q1. Next and Back move exactly one question, and the selections are still shown after moving back. Flag sets `aria-pressed`. The navigator shows answered, unanswered and flagged for each question, and jumping to Q4 lands there. The top bar reads "Q 1 / 4" and the footer "Question x of 4". |
| 2 | Review page | PASS | Next on the last question opens "Check your work", which shows "Answered 3 of 4". The flagged and unanswered tiles are marked, and a tile opens its question. |
| 3 | Submit-all modal | PASS | The modal text matches the brief. Go back closes it and editing still works (Q4 answered afterwards). Yes shows "Submitted. Waiting for the session to end.", the choices disappear, the instructor sees "Submitted 1" and the row is graded (■ ■ ■ □). |
| 4 | Auto-submit at the shared end | PASS | Student 2 never submitted. At the end they see "Time is up. Your answers were submitted automatically." Their grid cell stays D/wrong (`title` "D · …"), the room status is `review`, and `grid[student-2][rw].answer = 'D'`. The instructor badge reads "SET FINISHED" and the clock shows "—". |
| 5 | No correctness / explanation / notes during the set | PASS | `captureLeaks` (phase-aware, peers) on all three students: `violations() == []` with frames present. After selections, after submit and after the end, the DOM has no "Correct answer", explanation or notes markers, and no `.choice.right/.wrong/.stage-verdict`. |
| 6 | Visiting a question twice shows accumulated time in the instructor card | PASS | Q1 card → group A → Student 1 `data-ms`: ≥ 1000 after the first visit, then ≥ first + 1000 after the second. Each visit dwells two ticks of the student's own countdown. The card also shows "answered x/assigned", accuracy and avg time vs the set time. |
| 7 | Late joiner: smaller set fitting the reported time; ░ in the instructor grid | PASS | The join response gives `lateJoin: true` and `joinRemainingMs` R (> 12 s). The set is non-empty and smaller than 4, and Σ limits ≤ R. It is maximal: no unassigned question fits the leftover. It is in lesson order, and the top bar reads "Q 1 / k". Grid: every unassigned column is `unassigned` (░) and assigned ones are `unreached`, with a "late join" badge. |
| 8 (added) | Late set not recomputed on re-join | PASS | With ≤ 8 s left, Leave view and join again with the code. The set and `joinRemainingMs` are identical, even though `lateJoinSet(items, time left now)` would give a different set. The earlier selection is restored. |
| 9 (added) | Early completion when every joined student submitted | PASS | Student 4 submits; the set stays live ("Submitted 1"). Student 3 submits from the navigator's "Go to Review Page". Both see "Set finished…", the room is `review`, `endsAt − now > 5 s`, and the blank answer is `null`. |
| 10 (added) | Instructor-paced and earlier tasks unaffected | PASS | Full suite 23/23 (tasks 00b–06 plus the UI suites). |

## Failures and classification

No spec failed. Reviewing the screenshots found these **app bugs** (repair round 1):

| ID | Screenshot | Expected | Actual |
|---|---|---|---|
| A1 | 10, 12 (instructor) | Self-paced footer has no "Show class results" (§8.4 has no class chart) | The toggle is still visible: `hidden` on the label is overridden by `.toggle { display:flex }` |
| A2 | 10, 12 (card) | "Question, explanation & notes" is a normal collapsible section in the card | It reuses `.instructor-drawer`, the instructor-paced side-rail class, so the summary renders as a 38 px vertical strip |
| A3 | 10, 12 (grid) | Name column sized to the names; cells aligned | `#self-grid tbody th { display:flex }` takes the name cell out of table layout (wide, misaligned first column) |
| A4 | 10 (grid) | ◆ on each student's current question from the start (and on a late joiner's first question) | The room sets a position only on a `navigate` message, so a student who hasn't moved yet (everyone at start, a new late joiner) shows no ◆ until the client's reconnect `navigate` arrives |
| A5 | 11 (student) | No timer controls once the set is over | The "Hide" timer button stays visible with no clock |

## Environment notes

- The workerd `SSLV3_ALERT_CERTIFICATE_UNKNOWN` lines are the known self-signed local TLS noise.
- Dwelling on a question waits on the student's countdown ticking (a UI condition), not a fixed sleep. The final auto-submit wait is bounded by the room's own `endsAt` + 5 s.
