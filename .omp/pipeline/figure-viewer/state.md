```text
Task: figure-viewer
Tier: 2
Branch: claude/awesome-sagan-hevd96   Base: main (c25143b)
Last completed step: 3 (spec)
Next step: 4 implement public/shared/figure.js + call sites + seeds
Open blockers: none
Decisions made this task:
- Figure keeps its authored position (between intro and question sentence in 323/323 questions), in its own centred
  frame: that is "above the question stem" as in screenshot A.
- Math stems only; R&W figures, choice pictures, explanation crops and math tables keep their current rendering.
- 100 % = fitted (natural size capped by column width and clamp(160px, 36vh, 460px)).
- Overlay = modal <dialog>, starts at 100 % independent of the frame.
- Figure ink follows the student's zoom (same i:<n> anchor read through the transform), clipped to the frame.
PR: not requested
Instructions: docs/lessons/BRIEF.md — re-read §0, §12, §13 + .omp/pipeline/figure-viewer/spec.md
Preflight: fresh container needed `npm run e2e:seed` (first baseline run: sign-in 503 on every spec).
```
