# lessons-11-ui-polish screenshots

Palette-compressed PNGs (regenerated after commit 83a172f: buttons have no box or circle) from `tests/e2e/lessons-11-ui-polish/` (local E2E stack, seeded questions only). The uncompressed
originals are written by the specs to `.omp/pipeline/lessons-11-ui-polish/e2e/` (gitignored). "z125" etc. means browser zoom on a
1366x768 screen (CSS viewport 1366/z x 768/z, device scale factor z), as in `tests/e2e/lessons-11c.spec.js`.

## Student view at every size (layout.spec.js)

For each size `<s>` in `1366x768`, `1536x864`, `1920x1080`, `z90`, `z110`, `z125`:

- `student-<s>-math.png`: instructor-paced math question, answering, cross-out mode on (strike controls visible right of each row).
- `student-<s>-passage.png`: reading question with a passage (split layout).
- `student-<s>-gridin.png`: grid-in question.

## Docked calculator and instructor graph (docking.spec.js), at 1366x768 and z125

- `student-<s>-calculator.png`: the student's own calculator docked left, the column reflowed right of it.
- `student-<s>-calculator-wide.png`: the dock dragged to its widest; the column narrows instead of being covered.
- `student-<s>-both-docks.png`: own calculator (left) and the instructor's graph follower (right) after the reveal.
- `student-<s>-instructor-graph.png`: the instructor's graph alone, docked right.

## Instructor Desmos panel width (desmos-width.spec.js)

- `instructor-desmos-wide.png`: dragged to the 720 px maximum (1920x1080 window).
- `instructor-desmos-narrow.png`: dragged to the 280 px minimum.
- `instructor-desmos-narrow-window.png`: 1024 px window, minimum width.

## Pen and laser (ink.spec.js)

- `ink-z125-*.png` and `ink-1920-*.png`: the same phrase underlined on the instructor's screen (125 % zoom / 1920x1080) and on the
  1366x768 and 110 % students (`-instructor`, `-student-1366`, `-student-z110`).
- `ink-pen-start-z80|z100|z110|z125|z150.png`: clipped view of a stroke starting under the pointer at each zoom.
- `ink-laser-z80-*.png`, `ink-laser-z150-*.png`: presenter's laser dot at 80 % / 150 % zoom and a student's view.
- `ink-refit-*.png`: a student after a mid-question zoom change (strokes kept, canvas re-fitted).

## Other screens swept for the shape rule (shapes.spec.js)

`shapes-lock-confirm.png`, `shapes-history.png` (My Lessons), `shapes-navigator.png`, `shapes-review-page.png`,
`shapes-submit-modal.png`, `shapes-poll.png`.
