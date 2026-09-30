```text
Task: figure-viewer
Tier: 2
Branch: claude/awesome-sagan-hevd96   Base: main (c25143b)
Last completed step: 9 (docs, review PASS, full suite 74/74). Pushed.
Next step: none (no PR requested); manual checks in handoff.md.
Open blockers: none
Decisions made this task:
- The figure keeps its authored place in the question column (above the text in 180, between intro and question in 141);
  the 2 figures authored after all the text move above it.
- Math stems only; R&W figures, choice pictures, explanation crops and math tables keep their current rendering.
- 100 % = natural size capped by the column and clamp(150px, 28vh, 440px); fitFigures shrinks it (floor 140 px)
  so the first choice's first line stays on screen.
- Overlay = modal <dialog>. Its 100 % = half the window fit, starting at 100 % independent of the frame. It moves the
  loaded element (no re-request).
- Figure ink follows each client's zoom (same i:<n> anchor read through the transform), clipped to the frame.
  i:<n> lists framed and pane images first, keeping the old numbering.
PR: not requested
Instructions: docs/lessons/BRIEF.md — re-read §0, §12, §13 + .omp/pipeline/figure-viewer/spec.md
Preflight: a fresh container needs `npm run e2e:seed`. The baseline on main was 71/72: banner.spec "students: no banner
request" timed out on networkidle in this sandbox, and passed on later runs.
```
