# lessons-11b e2e results

## Environment
- Local `wrangler dev` (00b harness), local D1 and Durable Objects, reseeded with `npm run e2e:seed` before each run.
- Bundles rebuilt with `npm run build:lesson` before each run, which is what `pretest:e2e` does.
- Browser: the preinstalled Chromium (`PW_CHROMIUM_PATH=/opt/pw-browsers/chromium`).
- Screenshots go to `.omp/pipeline/lessons-11b-instructor-ui/e2e/` (gitignored). Compressed copies for the PR
  are in `docs/lessons/11b/`.
- Commands:
  - `npm run e2e:seed && npm run build:lesson && PW_CHROMIUM_PATH=/opt/pw-browsers/chromium npx playwright test tests/e2e/lessons-11b.spec.js`
  - the same with `npx playwright test` for the full suite.

## Baseline (main 5cf11e6, before any change)
Full suite **33/33**. Two earlier attempts in this sandbox failed on the environment:
- wrangler's proxy worker exited at startup with "Network connection lost";
- then a run with unbuilt bundles.
Neither was an app failure.

## Checkpoints (`tests/e2e/lessons-11b.spec.js`)

| # | Checkpoint | Result | Where |
|---|---|---|---|
| B1 | No divider or \|← <> →\| controls on the instructor or student view; passage and question panes equal width (±2px) and touching | PASS 1920, 1366 | layout test |
| B2 | Header row, rail, meta strip (`Correct:`), Responses panel, vertical notes tab gone; title absent | PASS | layout test |
| B2 | Margins: passage text ≥24px inside its pane; choices ≥24px from the pane's right edge; instructor inset = student inset at 1366 (±1px) | PASS | layout test |
| B2 | Sidebar collapses on start, re-expands on click, stays expanded through later snapshots | PASS | layout test |
| B2 | Join code: black `rgba(0,0,0,<1)` box, monospace ≥24px, top-right corner. No visible control intersects it in ANSWERING, REVEALED (swatches enabled) or with Desmos open | PASS | layout test |
| B2 | Desmos button inside `#live-tools` with the annotation tools | PASS | layout test |
| B2 | Correct choice marked on the instructor card in ANSWERING, READY and REVEALED; never on the student before reveal (+ leak helper) | PASS | layout test |
| B2 | Bottom bar left→right: ‹, Question n of N, ›, timer, +15s, End now, "n of N responses", Notes, connection, End session | PASS | layout test |
| B2 | Responses popup: role=dialog, above the bar; sort, rows, joined count, class results, Manage students + Lock joining; a student's change shows while open; closes on Esc, outside click, button | PASS | layout test |
| B2 | Distribution bars clickable (names popover); Esc closes the popover first; Show class results reaches the student | PASS | layout test |
| B2 | Notes drawer: right edge at the viewport, above the bar, below the toolbar; explanation + notes; KaTeX renders | PASS | layout test |
| B2 | No blank bands: area top 0; toolbar at 0; stage from toolbar to bar top; bar at viewport bottom; toolbar never empty | PASS | layout test |
| B3 | Drawer lists every question with number, snippet, ID and response count; current highlighted; later ones disabled; only played + next unplayed clickable | PASS | navigator test |
| B3 | Drawer overlays the question from the left, not the bar | PASS | navigator test |
| B3 | Drawer scrolls for a long lesson | PASS | long-lesson test |
| B3 | Checkpoint: play Q1–Q3, back to Q1 (drawer), forward (›). Each student sees their own answer, reveal colours, the shared highlight (Q1) and the Desmos graph (Q2). Choices and Submit disabled; no clock; pill follows | PASS | navigator test |
| B3 | Room `responses` byte-identical before the revisit, during it, after returning, and after › advances; Q3 distribution text identical | PASS | navigator test |
| B3 | › on the furthest question = Next (advances to READY with Start question) | PASS | navigator + layout tests |
| — | Leak helper: no answer/explanation before reveal, no notes, no peer names | PASS | all three tests |

Unit (`npm test`, `tests/test_lesson_room.cjs`, 2 new tests):
- The revisit: REVEALED, `endsAt` null, `revisit` flag, own selection, annotations, and Desmos restored.
  `select` gets "question closed"; `startQuestion` is refused.
- Reachability, including during ANSWERING.
- The graph archived to `desmos:q`.
- One review flush on leaving a revisit, and none for a question with no layer.
- Usage counts `reached`.
- `outline` only on full admin snapshots.
- `nextPending` merges by question.
- Mutation-checked: forcing READY on a revisit, or dropping the graph archive, fails the test.

## Existing specs changed (and why)

- **04 (`paced.spec.js`), rewritten for the popup, as the task requires.** Every assertion is kept and only
  moved:
  - "Responses · n/3 in" becomes the bar's "n of 3 responses";
  - rows, distribution, `#live-group` and class results are read inside the popup, reopened after bar
    clicks;
  - the notes and Manage-students "closed by default" checks become the notes drawer hidden and the popup's
    `details` closed;
  - the notes marker is read in the opened drawer;
  - `#body` REVEALED becomes `.live-view[data-phase]`, and ENDED becomes "Session ended".
- **03, 08, 09, 10 tour, ui-student-player:** open the popup, or read the notes drawer, where they read the
  panel, `.response-row`, `#live-roster` or Lock joining after the start.
- **05:** `#body` REVEALED becomes `.live-view[data-phase=REVEALED]`.
- **ui-admin-dashboard presenter:**
  - "no `#live-tools` before reveal" becomes "`[data-tool=pen]` disabled before reveal". The toolbar now
    carries Desmos in every phase.
  - The popup is opened for rows and distribution, the notes drawer replaces the old drawer, and ENDED
    becomes "Session ended".
- **00b harness, 01 practice, 02 builder, ui-admin inventory:** the bank goes from 7 to 8 questions because of
  the new `e2e-split-rw` seed fixture (IDs list, "8 questions", `#home-stats`, `[data-add]`, `[data-preview]`).
- **06:** a test bug, not an app bug. The "fork edits never go out" check grepped every raw frame for `3131`.
  During full run 2 the clock reached 1790559313xxx, so `serverNow` itself contained `3131`. The check now
  drops `serverNow` and `sentAt` and still inspects everything else. It passed on the rerun and on both
  full runs below.

## Full suite runs (after the change)
| Run | Result | Notes |
|---|---|---|
| full1 | 28/37 | Expected fallout: bank-count fixtures (7→8) and 05's `#body` REVEALED. Fixed. |
| full2 | 35/37 | 00b practice order: the new fixture sorts before `e2e-ai-rw`, a fixture fix. 06: the timestamp test bug above. |
| rerun 00b + 06 | 8/8 | |
| full3 | **37/37** | |
| full4 | **37/37** | consecutive |

Unit: 145/145 (`npm test`). `tests/test_grade.cjs` calls Windows `git.exe`, so this Linux sandbox ran it with a
`git.exe → git` shim on PATH. Without the shim it's the only failure, and it fails the same way on main.
Typecheck clean (`npm run typecheck`).

## §12.4 self-check
- (a) Student payloads:
  - revisit snapshots only exist in REVEALED;
  - `outline`, `reached` and `played` are admin-only;
  - notes stay admin-only;
  - the leak helper passes on every student.
- (b) Timers, locks and reachability are decided in the room; the client only disables buttons.
- (c) No per-event D1 writes. Leaving a revealed question upserts at most one `session_question_review` row,
  as Next did.
- (d) No new stat logic; the response counts come from the existing `responses` map.
- (e) Nothing from 11a, 11c or 11d.
- (g) No `.skip`, `.only` or `fixme`. Timeouts are unchanged.
- (h) Waits are on conditions; the drawer position is polled rather than slept.
- (j) The full suite ran twice.
