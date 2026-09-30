# figure-viewer — E2E report

Command: `PW_CHROMIUM_PATH=/opt/pw-browsers/chromium npx playwright test` (local wrangler dev, seeded by `npm run e2e:seed`).
Artifacts: `.omp/pipeline/figure-viewer/e2e/` (gitignored); screenshots committed to `docs/lessons/figure-viewer/`.

## Runs
| Run | Result |
|---|---|
| Baseline, clean worktree of main `c25143b` | 71/72. The one failure was `free-03 banner.spec` "students: no banner request". It timed out on `networkidle` in this sandbox and passes in later runs. |
| Task branch, first full run (`ba9d632`) | 68/74. The 6 failures were test bugs: 4 harness C1/C2/offline/leak specs and 2 admin inventory specs pinned the seeded bank at 8 questions. Fixed in `04069a4`, `7a268e2`. |
| Task branch, final (`7a268e2` + docs) | **74/74 passed** (12.1 min) |
| `npm test` | 154/156. The 2 failures are the same ones as on main: `test_grade.cjs` needs `git.exe`, and `test_lesson_flush` "daily limit" depends on the time of day. |
| `npm run typecheck` | clean |

## Checkpoint map (`tests/e2e/figure-viewer/viewer.spec.js`)
| Checkpoint | Test | Result |
|---|---|---|
| A in the bank (frame between the text blocks, centred, toolbar order, fitted, no left pane) | bank practice | pass |
| B in the bank (125 %: frame unchanged, image 1.25×, centre fixed, clamp-aware drag) | bank practice | pass |
| Panning at 200 % (drag, both clamps, touch drag via CDP) | bank practice | pass |
| C tooltip | bank practice and lessons | pass |
| D overlay (modal, dimmed, covers the viewport, larger and centred, toolbar top right, 200 %, pan at 300 %) | bank practice and lessons | pass |
| Esc closes full screen (focus returns to Full Screen), X closes, frame zoom unchanged | bank practice and lessons | pass |
| Keyboard: tab order, `+`/`-`/`=`, limit buttons stay focusable, arrows pan | bank practice and lessons | pass |
| No extra requests (request log empty; image route hit once) | bank practice | pass (found the clone re-request, fixed in `78154f6`) |
| No socket traffic from the viewer (student sends only pings) | lessons | pass |
| First choice on screen at 1366×768 (bank pane / lesson footer) | both | pass |
| A–D in the lesson student view | lessons | pass |
| Instructor viewer and local zoom; history viewer with the saved stroke | lessons | pass |
| Instructor stroke on the figure (`i:0`) on two students at 100 % (1366×768, 1536×864) and on the instructor | lessons | pass |
| Stroke follows a 200 % zoom and pan, clipped to the frame; other student unchanged; Reset restores | lessons | pass |
| Toolbar never a text anchor, not selectable | lessons | pass |
| Inline SVG figure wraps in place (audit regression) | bank practice | pass |
| Dark theme plate | bank practice | pass |

## Failure classification
- **Test bugs:**
  - drag expectations ignored the pan clamp; so did the clamp formula (min/max swapped);
  - the Section filter click toggled the wrong section;
  - the instructor card selector was wrong (`#lesson-card` instead of `#live-card`);
  - the order check read KaTeX text;
  - existing specs pinned the bank at 8 questions.
- **App bugs** (fixed in `fix(…)` commits):
  - full screen re-requested the image;
  - the figure's 100 % cap pushed the first choice under the footer at 1366×768;
  - inline SVG figures crashed (found by the audit);
  - toolbar glyph anchors (review R1).
