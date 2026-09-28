# free-01 e2e

Command: `PW_CHROMIUM_PATH=/opt/pw-browsers/chromium-1194/chrome-linux/chrome PLAYWRIGHT_OUTPUT_DIR=.omp/pipeline/free-01-measure/e2e/resultsN npx playwright test` (after `npm run e2e:seed`). Artifacts under `.omp/pipeline/free-01-measure/e2e/` (gitignored).

free-01 adds no checkpoints of its own (measurement only); the requirement is that the full existing suite stays green with the trace wrapper, the `LessonRoom` pass-through subclass and the staging gate in place.

| Run | Result | Classification |
|---|---|---|
| 1 | 30 passed, 1 failed: lessons-09 history.spec.js:196 `used[RW].slice(-2)` | **test bug** (pre-existing race): the other parallel worker also ends sessions on `e2e-core-rw`; the received list contained another spec's session (900015). Passes alone. Not affected by this branch (no change to session or usage ordering). |
| 2 (after fix 1) | 30 passed, 1 failed: history.spec.js:199 badge text vs a list fetched earlier | same race: a parallel spec ended session 900040 between fetch and render |
| 3 (fix 2, regex with `\d{5}`) | 30 passed, 1 failed | my regex assumed 5-digit IDs; IDs are 6 digits — fixed to `\d+` |
| 4 | 13 passed, 18 failed — 17 × `ERR_CONNECTION_REFUSED` on :8787 | **environment**: the three local e2e servers share `.wrangler/state-e2e`; one hit `SQLITE_BUSY: database is locked` and exited. No assertion failed on app behavior. |
| 5 | **31 passed** | green |

Test fix (test-only commit): history.spec.js now asserts the order of *its own* two sessions within `usedInLesson` and within the rendered badge instead of assuming no other spec used the same question. The assertion still fails if either session is missing or out of order.

Unit: `npm test` — all pass except `tests/test_grade.cjs`, which fails identically on `main` (spawns Windows `git.exe`).
