# lessons-11-ui-polish: E2E report

Written by the Test Developer subagent from `spec.md` and the task text, not from the diff. No application code was changed.
Nothing was committed or pushed.

## Result (after commit 83a172f: no boxes or circles on buttons)

| Run | Result |
| --- | --- |
| New specs (`tests/e2e/lessons-11-ui-polish/`, 23 tests) | 23 pass |
| Updated existing specs (annotations, 11c, 06 desmos: 5 tests) | 5 pass |
| Full Playwright suite (72 tests, 12.4 min) | 72 pass |
| `npm test` (152 cases) | 150 pass, 2 fail: `tests/test_grade.cjs` (needs git.exe) and the time-of-day `daily limit` case in `tests/test_lesson_flush.cjs`; both pre-existing on main, ignored as instructed |

Before 83a172f the same specs gave 71 of 72 (APP BUG 1, now fixed). No flakiness seen over three full runs of the new specs.

## New user requirement: "no box around the buttons, not circles not boxes"

`helpers.noBoxReport` is applied on every screen `shapes.spec.js` sweeps (about 25 screens, pointer parked on empty header space so no hover tint) and on the answering screen of every size in `layout.spec.js`.
For every visible `button` in `#lesson-live` (Desmos internals and the choice-row buttons `[data-lesson-choice]`, whose box is the inner `.choice` row, excluded):
border width 0 on all four sides, except a bottom underline of at most 3 px on a header tool, the ABC toggle, a navigator/history number cell (`.lesson-tools`, `.stage-strike-toggle`, `.self-grid`, `.history-nav`);
no background fill except the solid pills (`#lesson-lock, #self-next, #history-next, #poll-vote, #self-submit, #lesson-confirm, #self-confirm, #lesson-calc-replace, .lesson-position`); no circle button;
the cross-out control (`.stage-strike`, `.stage-strike-letter`) has no border and no filled circle. Solid pills are asserted separately (filled, radius >= half height, no border); Hide, ABC, Back, Go back/Cancel, history Back, tools are asserted plain (no fill, no box).
The positive control injects a bordered square, a bordered rounded, a bordered circle and a filled probe button: all four must be flagged and nothing else.
Old assertions that expected the outlined Hide pill and pill-shaped ABC/Back/dialog buttons were replaced by the plain-button assertions above (the row, input, select, dialog and popup roundness checks are unchanged).
Note: the unanswered number cells keep a grey (#999) underline, so "transparent or accent colour" is not enforced for the underline colour; thickness and side are.

## Checkpoint map

| Checkpoint | Spec: test | Result |
| --- | --- | --- |
| Student view at 1366x768, metrics, structure, pills, strike control, no sideways scroll, screenshot | `layout.spec.js`: layout at 1366x768 | pass |
| Same at 1536x864 | `layout.spec.js`: layout at 1536x864 | pass |
| Same at 1920x1080 | `layout.spec.js`: layout at 1920x1080 | pass (was failing on APP BUG 1 before 83a172f; the width assertion is hard again) |
| Same at zoom 90 %, 110 %, 125 % (CSS viewports 1518x853, 1242x698, 1093x614, DSF 0.9/1.1/1.25) | `layout.spec.js`: layout at z90 / z110 / z125 | pass |
| Column has a max width | `layout.spec.js`: the column has a maximum width on a very wide window (2560 px: column <= 960, > 700, centred) | pass |
| Item 1 numbers: `scrollWidth == innerWidth`, `#lesson-live` overflow, column 40-52 % of window and centred, header <= 12 % and footer <= 9 % of height, type ~17.5 px at 1366 / ~19 px at 1920 / >= 16 px at z125 | inside each layout test | pass |
| Header: title left, phase label under it, timer + Hide (plain underlined text) centred, four tools right (Calculator, Annotate, Follow me, More) icon over label, transparent background, no border box (also while active), invisible Follow me checkbox | inside each layout test | pass |
| Footer: name left, dark question pill centred, blue Submit pill right, radius >= half height, fixed at the bottom | inside each layout test | pass |
| Choice rows: rounded (>= 10 px), letter in a circle, rows do not overlap, strike control right of the row, outside it, inside the column, level with the row, no overlap | inside each layout test | pass |
| Long-passage (split) and grid-in screens: no sideways scroll, rounded grid-in | inside each layout test | pass |
| Shape rule, instructor-paced lesson: lobby, answering, Annotate + cross-out mode + picked choice, crossed-out choice, More menu open, own calculator open, lock-in confirm dialog, locked, reveal with calculator + instructor graph, Try it yourself confirm dialog, explanation open, grid-in answering/answered/revealed, My Lessons history. Pills for Hide, question pill, Submit, ABC toggle, dialog buttons, history Back/Next. Positive control (a 3 px probe button is flagged; rounded and circle probes are not) | `shapes.spec.js`: shape rule on every screen of an instructor-paced lesson | pass |
| Shape rule, self-paced lesson: lobby, answering, picked + flagged, calculator open, navigator open, More menu, reading and grid-in questions, review page, submit-all modal, submitted notice, poll, poll dropdown, poll result, review mode. Pills for Hide, Back, question pill, Next, Submit all, modal buttons, Vote | `shapes.spec.js`: shape rule on every screen of a self-paced lesson | pass |
| Calculator docks LEFT, instructor graph docks RIGHT, column reflows between, no element of `.lesson-main` intersects a dock, no sideways scroll, at 1366x768 and 1093x614; wide dock narrows the column; both docks open on a math question after the reveal | `docking.spec.js`: docking at 1366x768 / docking at z125 | pass |
| Instructor stroke at 125 % lands on the same words for a 1366x768/100 % student and a 110 % student; the phrase sits on one line for the presenter and wraps for a student (found by measuring all three screens) | `ink.spec.js`: pen ... covers the same words on the instructor at 125% zoom ... | pass |
| Same with a 1920x1080 instructor (phrase wraps on both students) | `ink.spec.js`: pen ... on the instructor on a 1920x1080 screen ... | pass |
| Pen starts under the pointer (first stored point within 2 px, ink under the pointer along the whole path, ink box hugs the path) at 0.8 / 1 / 1.1 / 1.25 / 1.5 | `ink.spec.js`: pen: the stroke starts under the pointer ... at 80/100/110/125/150 % zoom | pass (5) |
| Laser: presenter's own dot centre within 2 px of the pointer, students' dots over the same word (1366x768 and 110 %), at 0.8 and 1.5 | `ink.spec.js`: laser ... at 80 % / 150 % zoom | pass (2) |
| Resize / zoom mid-question: DSF-only change, zoom to 125 %, 90 %, back to 100 % (CDP `Emulation.setDeviceMetricsOverride`), plus `page.setViewportSize`; canvas CSS size == card size, backing store == round(css x dpr), strokes still cover the same words | `ink.spec.js`: resize and zoom mid-question ... | pass |
| Desmos handle on the left edge; drag changes width (420 default, -150 -> 570, +70 -> 500); arrow keys +-20; clamp max min(720, stage - 360) and min 280; localStorage `lessons.desmosWidth` tracks the width; close/reopen keeps it; next question keeps it; reload (twice) and a new tab keep it; students' `#lesson-desmos` keeps its own width, receives the graph, nothing stored on students | `desmos-width.spec.js`: instructor Desmos panel: handle ... | pass |
| Narrow window: max is stage width - 360 (< 720), question keeps >= 360, stored 700 drawn clamped | `desmos-width.spec.js`: ... on a narrow window ... | pass |

## Updated existing specs (test bugs caused by the intended app change)

All assertions about state, Try it yourself and payload leaks are unchanged; none was loosened or removed.

- `tests/e2e/lessons-05-annotations/annotations.spec.js`: anchor is now `s:0~<glyph>` (regex updated). `wordOffset` now measures the stroke's first point relative to
  the first word in em of that block's font size (the anchor is scale-free), tolerance 0.1 em (about 1.7 px, tighter than the old 2 px). Added: the start point lies inside the word
  box on every client, and the teacher's and student's type sizes differ (so a px comparison could not have passed by accident).
- `tests/e2e/lessons-11c.spec.js`: home-position/drag/resize/clamp sections rewritten for the docked calculator: docked at the left edge, directly under the header and above
  the footer, `position: fixed`, column starts right of the dock, dragging the title bar moves nothing, `#lesson-calc-resize` drag changes the width by the pointer delta (top, bottom, left
  unchanged, vertical movement ignored), clamp to [280, innerWidth - 528] at both ends, question never intersects the dock, no sideways scroll, state kept across close/reopen and
  across questions at the last width, width restored by dragging back (within 1 px, since the width is stored rounded). The 110 % self-paced test is unchanged and passes.
- `tests/e2e/lessons-11c.spec.js` and `tests/e2e/lessons-06-desmos/desmos.spec.js`: the read-only follower is now docked between header and footer, so with five rows Desmos's own
  "Trial Key" badge sits over the middle of the new-expression row and Playwright's click waited for it until the 180 s test timeout. The click now targets the row's left edge
  (`position: { x: 6, y: 8 }`); the assertion that typing there changes nothing is unchanged. (11c has the same pattern; it was fixed there before it could bite.)
- `desmos.spec.js` has no drag/resize sections; only the click above changed.

## Test bugs found and fixed while writing (mine, not the app's)

- Pen tests drew before the room reached REVEALED: `endNow` returns before the reveal snapshot, and a phase change ends a stroke in progress (the pen effect depends on
  `s.phase`), which truncated my strokes. The room helper now waits for `.live-view[data-phase="REVEALED"]`.
- `next` does not exist on the last question (shapes spec); the wrong text was expected for the self-paced submitted notice; `devicePixelRatio` 0.9 reads back as 0.8999999761581421.
- A too tight `getBoundingClientRect` line test in the phrase search (buckets) was replaced by a spread test.

## APP BUG 1: fixed by commit 83a172f

Choice rows stopped at 680 px (legacy `public/index.html:448 .choices{max-width:680px}` leaking into the lesson stage), so at 1920x1080 they filled 71 % of the column. `.lesson-stage .choices{max-width:none}` fixes it; `layout.spec.js` at 1920x1080 now passes with the original hard assertion. No new app bugs found.

## Notes for the reviewer (no failing spec)

- spec.md is inconsistent about choice-row radius: "radius >= 12" in the Column bullet but "rounded rows (>= 10 px)" in the shapes bullet, and screenshot A has 10. The CSS gives
  0.8 x `--u` = about 10.5 px (z125) to 12.5 px (1920), so it is below 12 at 1366 (11.2 px). The test asserts >= 10, the task text's figure; nothing asserts 12.
- The shape sweep treats one case as allowed: a header tool, the ABC toggle or a number cell whose only border is a bottom underline (the active or answered state). Anything with a border on any other side and a
  radius under 8 px (not a circle) fails. Third-party Desmos widgets (`.lesson-calc-body`, `.lesson-desmos-calc`) are outside the sweep. Visibility checks leave out elements with `opacity < 0.05`
  (the invisible Follow me checkbox) and `visibility: hidden` (the strike controls while the tool is off).
- Pen strokes are paced at one pointer move per ~16 ms (a hand-speed cadence; Playwright's default burst puts a whole stroke into one 50 ms chunk and hides the per-chunk re-anchoring
  that item 4 is about). The pacing sleep is pointer simulation, not a wait for the app.
- Observation, not asserted: a phase change while the presenter is mid-stroke (for example the reveal landing about 750 ms after End now) silently ends that stroke, because the pen
  effect's dependencies include `s.phase`. Pre-existing behaviour; noted because the reveal grace window makes it easy to hit.
- Not covered: touch dragging of `#live-desmos-handle` (mouse and keyboard are), the old-build comparison (the ink specs were not run against the pre-change bundle, so their
  sensitivity to the old px anchors is by construction, not measured), Try it yourself was only re-run through the existing specs.

## Commands run

```
S=/tmp/claude-0/-home-user-sat-question-bank/5c89574d-bee1-51d1-80ea-8c6a3f495be9/scratchpad
$S/pw.sh tests/e2e/lessons-05-annotations tests/e2e/lessons-11c.spec.js tests/e2e/lessons-06-desmos     # baseline: 3 failing (expected fallout), then 5 pass after the edits
$S/pw.sh tests/e2e/lessons-11-ui-polish/<spec>                                                          # each new spec, repeatedly
PW_TIMEOUT=2400 $S/pw.sh                                                                                # full suite: 71 pass, 1 fail
npm test                                                                                                # 150 pass, 2 known failures
$S/pw.sh tests/e2e/lessons-11-ui-polish tests/e2e/lessons-05-annotations tests/e2e/lessons-11c.spec.js tests/e2e/lessons-06-desmos   # final run: 27 pass, 1 fail
node $S/compress.cjs      # palette-compress the screenshots into docs/lessons/11-ui-polish/ (sharp; tools/e2e_tour_compress.cjs is hard-wired to the lesson-10 tour)
```

(`$S/pwl.sh` is the same wrapper with `grep --line-buffered` so progress shows while a run is going.)

## Artifacts

- Specs: `tests/e2e/lessons-11-ui-polish/{helpers.js,layout.spec.js,shapes.spec.js,docking.spec.js,ink.spec.js,desmos-width.spec.js}`
- Updated: `tests/e2e/lessons-05-annotations/annotations.spec.js`, `tests/e2e/lessons-11c.spec.js`, `tests/e2e/lessons-06-desmos/desmos.spec.js`
- Screenshots: `docs/lessons/11-ui-polish/*.png` (53 files, 1.6 MB, index in that folder's `README.md`); uncompressed originals in `.omp/pipeline/lessons-11-ui-polish/e2e/` (gitignored)
- Playwright failure output (traces): `.opencode/pipeline/lessons-00b-e2e-harness/e2e/results/` (gitignored)
