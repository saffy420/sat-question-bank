# figure-viewer — review

## Round 0: diff `c25143b...HEAD` against spec.md and BRIEF §12.6 (after the test round)

Findings, listed before any fix:

| # | Finding | Where | Severity |
|---|---|---|---|
| R1 | A laser pointer over the toolbar's "100%" in a stem without `<p>` blocks got a glyph anchor. Its offset was computed with the toolbar text excluded, so it pointed at the wrong character. The pen was not affected (it ignores toolbar pointerdowns). | `public/shared/annotations.js` `locateGlyph` | blocker (wrong shared ink) |
| R2 | Toolbar text was selectable, so a student's private highlighter could select "100%". | `public/shared/figure.js` `.fv-bar` | minor |
| R3 | The `splitContext` alias in the SPA is dead since math uses `mathStem`. The dead code was created by this change. | `public/index.html` | cleanup (CLAUDE.md) |
| R4 | The `mathStem` comment said figures sit "between the intro and the question"; 180 of 323 are above all the text. | `public/shared/renderer.js` | doc |

BRIEF §12.6 checklist:
- **(a)** No answer, explanation or note reaches a student payload before it's allowed: the viewer adds no payload.
  The seed's explanation carries `E2E_EXPL_MARKER_FIG`, and the lesson spec runs during ANSWERING with the student
  sending only pings. The existing phase-aware leak specs (04, 06, 11b, 11d) are in the full suite. **Pass.**
- **(b)** Timers and locks unchanged. **Pass.**
- **(c)** No per-event D1 writes. Zoom and pan are not sent at all. **Pass.**
- **(d)** No duplicated stat logic. **Pass.**
- **(e)** Nothing built for a later task. The fit pass and the trailing-figure move answer the task's own 1366×768
  and "above the question stem" requirements. **Pass.**
- **(f)** Every checkpoint in `spec.md` has an asserting spec (map in `e2e.md`). **Pass.**
- **(g)** No `.skip`, `.only` or `fixme`, and no inflated timeouts. A 150 s test budget was added once and then removed,
  because the test runs in 14 s. The count and ID-list edits in other specs follow the new seeded question (8 → 9); no
  assertion was loosened. **Pass.**
- **(h)** No fixed sleeps: condition waits and `expect.poll` only. The pen trace's 16 ms per-move pacing is copied from
  the ink spec. **Pass.**
- **(i)** `test(…)` commits touch only `tests/` and `tools/e2e_core.sql`. **Pass.**
- **(j)** `e2e.md` records full-suite runs. **Pass.**
- **(k)** The diff is only this task's work. **Pass.**

Task review items:
- **No wire change:** `validMark` and the room are untouched; the anchors are the same forms.
- **Strokes at 100 % are identical to before:** the same `i:<n>` image (`images()` keeps the old numbering) and the
  same box.
- **No extra requests:** the network checkpoint found the clone re-request, fixed in `78154f6`.
- **The R&W figure, picture choice and explanation paths are untouched:** `splitContext` still serves R&W, and the
  lightbox still opens for R&W `.qfig`.

## Repair round 1 (`33e6ba9`, tests `7a268e2`)
- **R1:** `locateGlyph` rejects caret nodes inside `.fv-bar`. The new assertion in the lesson spec: `locateGlyph` over
  "100%" returns `null`.
- **R2:** `.fv-bar { user-select: none }`, asserted in the same spec.
- **R3:** the alias is removed. `test_lesson_room.cjs` asserted the literal `SharedRenderer.splitContext(` as proof that
  the SPA uses the shared renderer. It now asserts `SharedRenderer.mathStem(`, which keeps the same intent.
- **R4:** comment corrected. `spec.md`'s baseline position counts are corrected too.

Re-review of the repair diff: 4 app lines, no behaviour change outside the toolbar. Unit tests 154/156 (the same 2
failures as on main). Figure-viewer, harness and admin-dashboard specs green; the full suite result is in `e2e.md`.

**Verdict: PASS.**
