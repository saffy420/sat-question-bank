# lessons-10-e2e-regression — e2e

**Specs (this task):**
- `tests/e2e/lessons-10-e2e-regression/tour.spec.js` (2 tests): both lesson modes run as in class, with screenshots.
- `tests/e2e/lessons-10-e2e-regression/acceptance.spec.js` (4 tests): §13 checks no earlier spec covered end to end.

**Setup:**
- Local `wrangler dev` with local D1/DO (00b harness), seeded with `npm run e2e:seed`.
- Browser: the preinstalled Chromium (`PW_CHROMIUM_PATH=/opt/pw-browsers/chromium`).
- Students at 1366×768; the instructor at 1920×1080 (spec decision 1).

**Commands:**
- `npm run e2e:seed && PW_CHROMIUM_PATH=/opt/pw-browsers/chromium npx playwright test tests/e2e/lessons-10-e2e-regression`
- `npm run e2e:seed && PW_CHROMIUM_PATH=/opt/pw-browsers/chromium npm run test:e2e` (full suite)
- `node tools/e2e_tour_compress.cjs` (tour → `docs/lessons/tour/`, 29 shots, 2456 KiB → 957 KiB)

## Round 0 — exploratory pass and first tour run

The tour specs passed on the first run, but reviewing the screenshots found one app bug and three screenshot-only issues.

| # | Where | Class | Finding | Action |
|---|---|---|---|---|
| B1 | Student, instructor-paced, long passage at 1366×768 | **app bug** | See below. | Repair round 1 (`f6db6d7c`). |
| T1 | Tour shot 10 (annotations) | test bug | Taken while Follow me was still smooth-scrolling up to the marks, so no mark was in the picture. | Wait for the scroll to settle, then assert the last mark sits between header and footer. |
| T2 | Tour shot 12 (student Desmos) | test bug | Taken after the expression was listed but before Desmos plotted it (the row had no colour icon yet). A probe 3 s later showed the line plotted, so this was render timing, not a sync fault. | Wait for the row's `.dcg-colored-icon` on both students and the instructor. |
| T3 | Tour shot 15 (self-paced answering) | test bug | The chosen answer was scrolled off screen. | Scroll the chosen choice to the centre before the shot. |

### B1 details

- **Repro:**
  1. A student on the long seeded R&W passage selects an answer near the bottom of the passage, at 1366×768.
  2. The student locks the answer.
  3. The instructor ends the question, then turns on Show class results.
- **Expected:** the lock notice, the reveal verdict and the class results chart show on screen, between the sticky header and the fixed footer.
- **Actual:** measured geometry, with the footer top at 688 px:
  - "Answer locked in. Waiting for time to end…": 679–743 px, under the footer.
  - The "Your answer: B" verdict: 727–751 px, under the footer.
  - The class results chart: 845–1096 px, below the window.

  A student only saw the coloured choices. The correct-answer line, the verdict and the chart the instructor had just turned on stayed out of sight unless the student scrolled.
- **Why earlier specs missed it:** they asserted the text with `toContainText`, which also passes for content off screen.
- **Failing assertion:** tour.spec.js `onScreen(one.locator('.lesson-locked'))`. The element must sit between `.lesson-header` bottom and `.lesson-footer` top.
- **Fixed?** Verified to fail with the fix stashed and pass with it (see Repair round 1).

### Observation (not fixed, recorded for the instructor)

On a 1366-wide **instructor** screen, typing into the live Desmos panel scrolls the short math question out of the question card while the keypad is open. At 1920×1080, the instructor's laptop, the question and the calculator are both visible. This is not the target device, so it is not treated as a blocker; it is listed in the PR's manual checks.

## Repair round 1 (fix `f6db6d7c`; tests `219823fb`)

- **Fix:**
  - `#lesson-live` gets `scroll-padding: 102px 0 80px`, matching the sticky header and fixed footer.
  - When a status first appears (lock notice, reveal section, class results), the player scrolls it into view with `block: 'nearest'`.
- **Verified by reverting the fix:** with `lesson-ui` stashed, the instructor-paced tour fails at `onScreen(.lesson-locked)`. With the fix, it passes.
- **Reruns:**
  - Unit: **97/97**.
  - Typecheck: clean.
  - Task specs: **6/6**.
  - Full suite: **31/31** (3.4 min).

## Full suite runs

| Run | Result | Time |
|---|---|---|
| 1 (after round 1) | **31 passed** | 3.4 min |
| 2 | **31 passed** | 3.5 min |

Desmos latency (task 06 spec, Slow 3G relay, run 2): 253 / 271 / 295 / 287 / 276 ms against a 500 ms target; the ping round trip was 408–502 ms.

## Checkpoints

| # | Checkpoint | Result | Assertion |
|---|---|---|---|
| 1 | Entire suite green | PASS | 31/31: tasks 00b–10 plus the UI suites (see runs above). |
| 2 | Screenshot tour of both modes | PASS | 29 shots listed in `docs/lessons/tour/README.md`. Each shot asserts its state first. **Instructor-paced:** lobby text and roster; `aria-pressed` selection; the lock dialog; locked with disabled choices and no "Correct answer"; `.right`/`.wrong` choices and verdict; class results with no peer names; highlight and strike marks with a `line-through` style; Desmos line plotted in the read-only student panel. **Self-paced:** flag; navigator; ░ cell for the late joiner; "Answered 4 of 4"; submit modal; "Set finished"; most-missed "Q4 — n of n wrong"; the poll vote counted; REVIEW with the synced highlight; the My Lessons row `Self-paced · 3 / 4`; history verdicts, the explanation, Breakdown and the saved highlight. **On screen:** the lock notice, verdict, class results and annotation marks are asserted between header and footer. |
| 3 | §13.3 grace window (added) | PASS | Every student choice is disabled when the clock reads 0:00. Once `Date.now() > endsAt + 750 + 50`, a `select` written directly onto the student's real socket returns `{type:'error', error:'question closed'}`. The stored answer is still B, and the student sees REVEALED with "Your answer: B". |
| 4 | §13.2 20 s outage (added) | PASS | **Self-paced late joiner:** the server closes the socket and the browser goes offline for 20 s or more. After reconnecting, the student is on the same "Question 2 of N" with the same selection, and the Q1 answer is kept. The navigator IDs deep-equal the assigned set from the join response. The clock dropped by at least offline − 2 s. **Instructor-paced, REVEALED:** a strike added by the instructor while the student was offline is shown after reconnect along with the earlier highlight, plus the `.wrong` C choice and "Your answer: C". |
| 5 | §13.9 lesson reuse (added) | PASS | A second run of the same lesson gets a new session ID and join code. The admin sessions list shows exactly both, ended. The first run's `/api/lesson-history` deep-equals its value from before the second run, and the second run has its own answer. The old code gets 404 on join. |
| 6 | §13.1 no leaks in the tour (added) | PASS | `captureLeaks` (phase-aware, peers named) on every tour student in both modes: frames present, `violations() == []`. |

## §13 acceptance checks → passing tests

| §13 check | Test(s) |
|---|---|
| 1. No answer/explanation/notes before allowed (lesson channels, G1) | e2e `captureLeaks` in 04, 06, 07, 08, 09 and both tour runs (10) |
| 2. 20 s Wi-Fi drop → question, time, selection, set, annotations | e2e 03 (question/time/selection, instructor-paced); 10 acceptance (self-paced set; annotations made offline) |
| 3. Change after `endsAt + 750 ms` rejected; UI already locked | unit `server grace and durable finalize persist once, late select rejected after reconnect`; e2e 10 acceptance §13.3 |
| 4. Early submit modal; no changes after Yes; correctness hidden | e2e 04 (instructor-paced lock), 07 (Submit all); tour 04/19 |
| 5. Highlight lands on the same words, 1080p vs 1366×768 at 110% | e2e 05 |
| 6. Desmos ≤ ~0.5 s under Slow 3G | e2e 06 (measured, `latency.json`) |
| 7. §8.2 late-join cases, §8.5 time test | unit `self-paced late join: exact §8.2 cases…`, `self-paced time accumulates across visits: Q1 10s → Q2 5s → Q1 7s = 17s/5s…`, `…fitted once to the server clock and never recomputed`; e2e 07 |
| 8. Poll closes early when all vote; ties per §8.7 | unit `poll winner…`, `review poll: … early close …`; e2e 08 |
| 9. Reuse → new session/code/ID; old results unchanged | e2e 10 acceptance §13.9 |
| 10. `usedInLesson` on every shown question; three filter options | unit (task 09 usage at end); e2e 09 |
| 11. Self-paced mistakes tagged; instructor-paced changes no stat | unit (task 09 write-back, isolation); e2e 09 |

## Artifacts (gitignored except the tour)

- Tour sources: `.omp/pipeline/lessons-10-e2e-regression/e2e/tour/*.png`.
- Committed tour: `docs/lessons/tour/`.
- Acceptance shots: `.omp/pipeline/lessons-10-e2e-regression/e2e/A1-frozen-at-zero.png`, `A2-self-after-outage.png`, `A2-paced-annotations-after-outage.png`.

## Environment notes

- The workerd `SSLV3_ALERT_CERTIFICATE_UNKNOWN` lines are the known self-signed local TLS noise.
- The known `webSocketClose` → `ws.close(1006)` log noise from task 06 is still present and harmless.
