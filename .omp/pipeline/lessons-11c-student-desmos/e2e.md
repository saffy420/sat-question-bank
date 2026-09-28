# lessons-11c-student-desmos — e2e

**Specs:**
- New: `tests/e2e/lessons-11c.spec.js` (2 tests).
- Rewritten: `tests/e2e/lessons-06-desmos/desmos.spec.js` (Try it yourself section).

**Setup:** local `wrangler dev` with local D1/DO (00b harness), seeded with `npm run e2e:seed`, preinstalled Chromium (`PW_CHROMIUM_PATH=/opt/pw-browsers/chromium`). A `git.exe` → `git` shim is on `PATH` for `npm test` on Linux.

**Profiles:**
- Students at 1366×768.
- 110% zoom as Chrome applies it on that screen: a 1242×698 CSS viewport at deviceScaleFactor 1.1.
- The instructor at 1920×1080.

**Commands:**
- `npm test`
- `npm run typecheck`
- `npm run e2e:seed && PW_CHROMIUM_PATH=/opt/pw-browsers/chromium npx playwright test tests/e2e/lessons-11c.spec.js` (after `npm run build:lesson`)
- `npm run e2e:seed && PW_CHROMIUM_PATH=/opt/pw-browsers/chromium npm run test:e2e` (full suite; its pretest builds the bundle)

## Checkpoints

| Checkpoint | Test | Assertion | Result |
|---|---|---|---|
| C1 drag works | 11c test 1 | Title-bar drag of (+300, +40) moves the window by exactly that; its size is unchanged. | pass |
| C1 resize works | 11c test 1 | Corner drag of (+120, −100) changes the size by exactly that; the top-left corner stays put. Shrinking stops at 300×260. | pass |
| C1 stays inside the viewport | 11c tests 1, 2 | Drags of ±4000 px pin the window to the viewport corners. Resizing +4000 stops at the viewport size. Every box sits inside `innerWidth` × `innerHeight`. | pass |
| C1 the question stays visible at the default position | 11c test 1 (1366×768: MC Q1, grid-in Q3), test 2 (110% zoom) | The stem, every choice and the grid-in are inside the viewport and don't intersect the window. The window sits below the phase label and above the footer. `.lesson-main` has `with-calc` only while the window is open. | pass |
| C1 math questions only | 11c tests 1, 2 | No button in the lobby or on the R&W question, and the window is hidden there. The button and window are back on the next math question. | pass |
| C1 expressions kept after the next question | 11c test 1 (instructor-paced Q1 → R&W Q2 → Q3), test 2 (self-paced Next/Next/Back/Back) | `y=1111x` / `y=4242x` still listed. The window keeps its last position and size. | pass |
| C1 kept when closed and reopened | 11c test 1 | Close hides the window and removes the shift; reopening shows `1111`. | pass |
| C1 one lesson view only (shared Chromebook) | 11c test 2 | After Leave view and a rejoin, the calculator opens empty (no `4242`). | pass |
| C1 no calculator payloads leave the student's client | 11c tests 1, 2 | Every WebSocket `framesent` and every HTTP request body from both students is free of the student rows (`y=1111x`, `y=3131`, `y=6161`, `y=4242x`), `"desmos"` and `expressions`. Instructor-received frames and bodies are free of the student rows. The student leak capture has no violations. Positive control: the instructor's `"y=2468x"` does appear in the frames students receive, so the latex format is the one a leak would carry. | pass |
| C2 empty path | 11c test 1 (student 3), spec 06 (student 2) | No dialog is shown. The calculator opens with the instructor's graph, and its expression rows (latex, in order) equal the instructor's. | pass |
| C2 non-empty path, Cancel | 11c test 1 (student 2) | The dialog text is exactly "This will delete everything in your calculator and replace it with your instructor's graph.", with buttons [Cancel, Replace]. Cancel leaves the window closed, `1111` still there, and none of the instructor's rows. | pass |
| C2 non-empty path, Replace | 11c test 1 | The expression rows equal the instructor's; `1111` is gone. | pass |
| C2 instructor panel read-only and still syncing | 11c test 1, spec 06 | The follower stays `data-mode=follow`; `#lesson-desmos-back` is absent. A new instructor row (`5757` / `2468`) reaches every follower but not the student's own calculator. Typing into the follower changes nothing. | pass |

## Spec 06 rewrite (old Try it yourself / Back to instructor view flow)

| Old assertion | New assertion |
|---|---|
| Fork: `data-mode=fork`, and typing `3131` into the panel works | Try it yourself opens `#lesson-calc` with the instructor's graph (`7777`, `9085`) and no dialog (empty path). The panel stays `data-mode=follow` with no Back button. Typing `3131` into the student's own calculator works. |
| While forked, `2468` is held back from the forked panel | `2468` reaches **both** followers (the panel keeps syncing) and not the student's own calculator. |
| `3131` never reaches the instructor, the other student or any frame | Unchanged. |
| Back resyncs and re-locks; typing `6161` changes nothing | The follower is still read-only after Try it yourself. With focus moved off the own calculator, typing `6161` into the follower changes neither panel. |

Everything else in spec 06 is unchanged: reveal gate, Slow 3G latency ≤ 500 ms, read-only follower, scrolling, reconnect, CSP, and the non-math test. No assertion was removed without a replacement, and no timeout was raised.

## Runs

| Run | Unit | Typecheck | E2E |
|---|---|---|---|
| Baseline (main, before changes) | 143/143 | clean | 32/33. `free-03-guardrails/banner.spec.js:57` timed out on `networkidle`; it passed alone on main (2/2), so it is load-sensitive and pre-existing. |
| Full run 1 (changes) | — | — | 34/35. **App bug:** spec 03 expected `#lesson-content` to read exactly "Opened in another tab.", but the always-mounted calculator confirm dialog added its text. Fixed: the dialog mounts only while asking. The dialog checks were tightened to `toHaveCount(0)`. |
| Full run 2 | — | clean | **35/35** |
| Full run 3 | **144/144** | clean | **35/35**. Desmos under Slow 3G: 376, 269, 260, 262, 274 ms (target 500). |
| Change after run 3 | — | — | Removed the in-memory carry-over across Leave view / rejoin (shared-Chromebook privacy) and added its check. 11c test 1 then failed once: the bare-digit markers matched a 13-digit timestamp. **Test bug**, not a leak; it passed on rerun. The markers are now the latex rows, with a positive control. |
| Full run 4 (final code) | **144/144** | clean | **35/35**. Desmos: 264, 275, 295, 277, 401 ms. |
| Full run 5 (final code) | — | — | **35/35**. Desmos: 380, 390, 300, 298, 272 ms. |

**Test bugs fixed while writing 11c:**
- the Q2 → Q3 phase sequence;
- `x^2-5` typed the `-5` into the exponent;
- keystrokes aimed at the follower went to the still-focused own calculator;
- CSS `zoom` replaced by a real 110% zoom profile;
- bare-digit leak markers replaced by latex rows.

## Screenshots
- **Raw** (gitignored): `.omp/pipeline/lessons-11c-student-desmos/e2e/`.
- **Compressed for the PR:** `docs/lessons/11c/` (10 PNGs, 328 KiB). 01–08 are at 1366×768, and 09–10 at 110% zoom.
