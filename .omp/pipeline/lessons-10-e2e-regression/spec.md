# lessons-10-e2e-regression — spec

**Scope (BRIEF §12.7):** tests only.
- The full e2e suite, green.
- An exploratory Playwright pass through both lesson modes, run the way the instructor runs them in class.
- A screenshot tour at 1366×768, committed as compressed PNGs to `docs/lessons/tour/`.
- App bugs found here go through repair rounds in `fix(lessons-10): …` commits.

**Context:** BRIEF §13 acceptance checks (all must hold by the end of this task), AMENDMENTS G1–G6. §6–§10 as context for what the tour must show.

**Research:** none (§12.7 research focus "—"; prior handoffs 00b–09 describe every surface).

## §13 coverage map (before this task)

| §13 check | Existing evidence | Gap closed here |
|---|---|---|
| 1. No answer / explanation / notes before allowed (lesson channels, G1) | `captureLeaks` phase-aware in 04, 06, 07, 08, 09 | Tour runs `captureLeaks` on every student in both modes |
| 2. 20 s Wi-Fi drop mid-question → question, remaining time, selection, assigned set, annotations | 03: question, time, selection (instructor-paced). 05: annotation reconnect (short) | **A2**: self-paced 20 s drop (assigned set, question position, selection, clock); instructor-paced 20 s drop during REVEALED with annotations made while offline |
| 3. Change after `endsAt + 750 ms` rejected; UI already locked | Unit only (`test_lesson_room.cjs` grace tests) | **A1**: e2e — UI frozen at 0:00, raw `select` sent over the real socket after the grace window gets `question closed`, stored answer unchanged |
| 4. Early submit modal; no changes after Yes; correctness hidden | 07 | Tour shows the modal |
| 5. Highlight lands on the same words at 1080p vs 1366×768 @110% | 05 | — |
| 6. Desmos ≤ ~0.5 s under Slow 3G | 06 (measured) | — |
| 7. §8.2 late-join cases, §8.5 time test | Unit (`test_lesson_*`), 07 e2e | — |
| 8. Poll early close; ties per §8.7 | 08 | — |
| 9. Reusing a lesson → new session, new code, new ID; old results unchanged | Not asserted end to end | **A3**: two runs of one lesson; distinct IDs and codes; the first run's history deep-equal before and after the second |
| 10. `usedInLesson` on every shown question; three filter options | 09 | — |
| 11. Self-paced mistakes tagged; instructor-paced changes no stat | 09 | — |

## Files to touch

- `tests/e2e/lessons-10-e2e-regression/tour.spec.js` — the two class runs with tour screenshots.
- `tests/e2e/lessons-10-e2e-regression/acceptance.spec.js` — A1, A2, A3.
- `tools/tour_compress.cjs` — palette-quantizes the tour PNGs into `docs/lessons/tour/` (uses `sharp`, already present through wrangler → miniflare; no new dependency).
- `docs/lessons/tour/*.png` + `docs/lessons/tour/README.md` (index of shots).
- Seeds only if a flow needs more (not expected).
- No app code unless a repair round needs it.

## Required unit tests

None new (tests-only task). `npm test` must stay green.

## E2E checkpoints (§12.7 task 10; may add, never drop)

1. **Entire suite green** (all prior task specs + UI suites + this task's specs).
2. **Screenshot tour of both modes at 1366×768**, student view unless noted:
   - instructor-paced: lobby, answering, locked, reveal, annotations, Desmos;
   - self-paced: answering in the set, instructor self-paced grid (1920 and 1366 shots), submit-all modal, overview (instructor), poll, review;
   - My Lessons (list and one history view).
   Committed compressed to `docs/lessons/tour/`.
3. (added, §13.3 / A1) Grace window rejection end to end.
4. (added, §13.2 / A2) 20 s outage restores question, remaining time, selection, assigned set and annotations.
5. (added, §13.9 / A3) Lesson reuse gives a new session/code/ID and leaves old results unchanged.
6. (added, §13.1) No leak on any tour student (`captureLeaks(...).violations() == []`, frames present).

## Task review items

- `e2e.md` covers both modes end to end (§12.7).
- Test commits touch only `tests/e2e/`, fixtures, seeds, the tour tool and tour images.
- Every §13 check has a named passing test (unit or e2e) in `e2e.md`.
