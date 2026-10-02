# figure-viewer screenshots

Written by `tests/e2e/figure-viewer/viewer.spec.js` (local E2E stack, seeded question `e2e-fig-math`, 1366×768), to
compare with the Bluebook references A–D in the task:

| File | Bluebook | What it shows |
|---|---|---|
| `bank-A-100.png`, `lesson-student-A-100.png` | A | The figure at 100 % in its frame, centred between the intro and the question, with the toolbar: zoom in, zoom out, %, Reset, divider, Full Screen. |
| `bank-B-125.png`, `lesson-student-B-125.png` | B | 125 % after a drag: the frame keeps its size and the figure is clipped. |
| `bank-C-tooltip.png`, `lesson-student-C-tooltip.png` | C | The "Full Screen" tooltip. |
| `bank-D-fullscreen-200.png`, `lesson-student-D-fullscreen-200.png` | D | The full-screen overlay at 200 %: the app dimmed, the figure centred, the toolbar top right with a close X. |
| `bank-figure-light.png` | — | The figure keeps its white plate under a light toolbar. |
| `lesson-stroke-student-1-100.png`, `lesson-stroke-student-2-100.png` | — | An instructor stroke on the figure, seen by two students at 100 % (1366×768 and 1536×864). |
| `lesson-stroke-student-1-200.png` | — | The same stroke after student 1 zooms to 200 % and pans: it follows the figure and is clipped to the frame. |
