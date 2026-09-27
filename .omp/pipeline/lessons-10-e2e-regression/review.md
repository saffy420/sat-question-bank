# lessons-10-e2e-regression — review

**Diff reviewed:** `git diff claude/lessons-09-history-stats...HEAD` (through `219823fb`), against `spec.md` and BRIEF §12.6. The e2e results are in `e2e.md`.

## Findings (listed before fixing)

| # | Severity | Where | Finding |
|---|---|---|---|
| R1 | Non-blocking (decision, checked) | `lesson-ui/index.tsx` status effect | The effect depends on `[status, s.questionId]`, so in self-paced **review mode** it also runs when the instructor moves to another question: the student's view goes to that question's answer block (`nearest`). Considered narrowing it to `[status]`, but the stage remounts inside the same `#lesson-live` scroller, so without the effect a new question simply keeps the previous question's scroll offset, which is arbitrary. Showing the reveal of the question under review is the more useful default, and Follow me then moves to the instructor's marks. Kept. |
| N1 | Non-blocking (decision) | same | The scroll also happens when **Follow me** is off. Follow me governs the instructor's annotation scrolling; the lock notice is the student's own action, and reveal and class results are phase events every student should see. `block: 'nearest'` moves the view only when the status is not already visible. |
| N2 | Non-blocking (observation) | instructor live view at 1366 wide | Typing in the instructor's Desmos scrolls the short math question out of the card while the keypad is open. The instructor's device is 1080p (§13), where both are visible. Listed as a manual check, not fixed. |
| N3 | Non-blocking | `tools/e2e_tour_compress.cjs` | Uses `sharp` from wrangler → miniflare, not a direct dependency. A wrangler upgrade that drops it breaks only this tool, which fails loudly. Recorded rather than adding a dependency (CLAUDE.md: no new dependencies without need). |

## §12.6 checklist

- **(a) Rule 5: PASS.** No payload changed. The tour runs phase-aware `captureLeaks` on every student in both modes: frames present, `violations() == []`.
- **(b) Rule 4: PASS.** The fix is client-side scrolling only. The grace test shows the server refuses a raw `select` after `endsAt + 750 ms`.
- **(c) Rule 6: PASS.** No server change.
- **(d) Rule 2: PASS.** No stat logic touched.
- **(e) Rule 7: PASS.** Task 10 is the last task. The fix is limited to the bug found.
- **(f) PASS.**
  - Every spec checkpoint 1–6 has asserting steps (e2e.md "Checkpoints").
  - Each tour shot asserts its state first.
  - The on-screen assertions check the element's position between header and footer, not only DOM presence.
- **(g) PASS.** No `.skip`, `.only` or `fixme`. No earlier spec was edited.
- **(h) PASS.**
  - Waits are conditions: text, attributes, `expect.poll` on the room state, on elapsed outage time and on `Date.now() > endsAt + 750`, and the scroll-settled check.
  - There is no fixed sleep. The only timer is a 150 ms comparison window inside the scroll-settle probe, the same pattern task 05 uses.
- **(i) PASS.**
  - `219823fb` touches only `tests/e2e/lessons-10-e2e-regression/`, `tools/e2e_tour_compress.cjs` and `docs/lessons/tour/`.
  - The fix is its own commit, `f6db6d7c`.
- **(j) PASS.** `e2e.md` records full-suite runs.
- **(k) PASS.** Only task 10 work.
- **Task item: `e2e.md` covers both modes end to end. PASS.** The tour runs an instructor-paced class and a self-paced class, each from lobby to end, plus My Lessons.

**Verdict: PASS.** No blockers. Repair round 1 fixed the B1 app bug found in the test round (see `e2e.md`); its diff (`f6db6d7c`, 3 lines + 1 CSS property) was re-reviewed above as part of the whole task diff. Open non-blocking items: R1, N1, N2, N3.
