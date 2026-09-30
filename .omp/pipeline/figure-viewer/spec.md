# figure-viewer — spec

Source: the user's task text and four Bluebook screenshots (A: frame at 100 %; B: 125 %, clipped and draggable;
C: the Full Screen tooltip; D: the full-screen overlay at 200 %). BRIEF §7.1 (annotations), §12 (pipeline).

## Tier
Tier 2. One new shared component and a layout change on every math figure, plus a small change to how figure-anchored
ink is painted. No wire-format change. Main session only (BRIEF §12.1); no subagents.

## Baseline (measured, not assumed)
- Recovered bank (`https://helpmeaceit.page/api/questions`, 4,170 rows, read only): 2,025 Math, **323 with a figure**
  (330 `<div class="qfig"><img></div>`, 7 questions with two), 3 AI questions with an inline `<svg role="img">`,
  104 math tables, 220 math questions with picture choices. Figure position in the stem: above all text in 180,
  between intro and question in 141, after all text in 2. (Corrected during the audit: the first count treated a
  half-stripped `<div class="` as text and reported 323 of 323 in the middle.)
- Crops: 330 WebP, width p10/p50/p90 = 364/731/807 px (max 1,743), height 269/611/801 px (max 930).
- Current rendering: `splitContext` pulls every `.qfig/.qtable/.qimg` out of the stem into a left pane (bank practice,
  lesson Stage, admin viewer, Browse preview); the bank drops back to inline when Desmos is open. The click opens
  `openLightbox` (bank only; free wheel zoom 1–8×).

## Scope
### The component — `public/shared/figure.js` (new)
- `wrapFigures(root)`: replace each `.qfig` holding an image, and each top-level `svg[role=img]`, in a **math stem** with
  one viewer, in place. A figure authored after all the text moves above the last text block ("above the question stem"). `install(document)`: delegated listeners + the stylesheet, once per document (flag on
  `<html>`, so two module copies never double-bind).
- Markup: `.fv` > `.fv-bar[role=toolbar]` (Zoom in, Zoom out, `NNN%`, Reset, divider, Full Screen) + `.fv-view[tabindex=0]`
  > `.fv-content` > the original `<img>`/`<svg>` (moved, not re-created — no new request).
- **[DEFAULT] zoom:** `ZOOM = { min: 1, max: 3, step: 0.25 }` (one constant). 100 % = the figure fitted in the frame:
  natural size, capped by the column width and a height cap `--fv-h: clamp(160px, 36vh, 460px)`. The frame keeps its
  size; the frame is the figure's width (min width fits the toolbar), centred in its own block.
- Zoom keeps the point at the frame centre fixed: `t' = t · z'/z`, then clamp so no gap opens
  (`|tx| ≤ max(0, (z·w − W)/2)`, same for y).
- Pan: mouse or touch drag on the view when zoomed (pointer capture, `touch-action:none` only while zoomed so a phone
  still scrolls the page at 100 %). Arrow keys pan by 10 % while the view has focus.
- Reset: 100 %, centred.
- Keyboard: every control is a `<button>`; limits use `aria-disabled`, not `disabled`, so they stay focusable. `+`/`=` and
  `-`/`_` zoom while focus is anywhere in the frame; the handler runs in the capture phase and stops propagation of
  keys it uses (the admin viewer's ←/→ question stepping must not fire while panning).
- Full screen: a modal `<dialog class="fv-overlay">` (top layer, so it also covers the admin question viewer, which is a
  modal dialog), dimmed `::backdrop`, the figure large and centred (fitted to the window, may upscale), toolbar top
  right with a close X instead of Full Screen. Esc (dialog `cancel`) and X close it; focus returns to the Full Screen button.
  Same zoom/pan code; starts at 100 % independent of the frame (screenshot C shows the frame at 125 % under an overlay at 100 %).
  The overlay figure is a clone of the loaded element with the same `src` (memory cache).
- Tooltip (C): dark pill label above a toolbar button on hover and keyboard focus (`data-tip`).
- Theme: the figure sits on a white plate in both themes (the existing dark-mode rule for coloured figures);
  toolbar/frame colours follow `:root[data-theme="dark"]`.
- Emits a bubbling `fv:change` event after every zoom/pan/reset.

### Where it is used (math stems only; one call site each, via `Renderer.mathStem`)
- Bank practice player (`public/index.html` `renderPanes`) and Browse preview (`previewHTML`).
- Lesson student view, instructor live view, self-paced, history/review: all through `lesson-ui/Stage.tsx`.
- Admin question viewer (`admin-ui/QuestionViewer.tsx`) and admin previews (`previewHTML`).
- Math tables still go to the left pane; only figures move into the column. R&W figures, picture choices and
  explanation crops are unchanged (R&W keeps the old lightbox; the task says math only).

### Annotations (BRIEF §7.1)
- Wire format unchanged. Figure strokes already use the `i:<n>` anchor (fractions of that image's box). The box is now
  read **with** the viewer's transform, so a fraction means the same point of the figure's content at any zoom.
- Ink/laser on a figure anchor are clipped to that frame's view; a laser point panned out of view is hidden.
- `locate()` only takes a figure anchor inside the visible part of its frame.
- Toolbar text (`100%`, `Reset`) is excluded from annotation text offsets (it differs per client).
- The Stage repaints ink on `fv:change` (rAF-throttled, canvas + laser only).
- Instructor: pan is off while pen/laser/erase is the active tool (the pen owns the drag); the pen ignores pointerdowns on
  the figure toolbar so zoom buttons still work while drawing.
- Zoom/pan/full screen are never sent over the socket.
- To document in handoff: what a zoomed student sees; full screen shows the clean figure (no ink); AI inline SVGs have no
  `i:` anchor, so a stroke over one uses the question-pane anchor and does not follow that student's zoom.

## Unit tests (`tests/test_figure_viewer.cjs`, node:test)
Pure math lifted from `figure.js`: step/clamp to [1, 3] in 0.25 steps; centre-fixed zoom (`t·z'/z`); pan clamp at 100 %
(0), at 125 % and 200 %; reset.

## E2E checkpoints (`tests/e2e/figure-viewer/`), screenshots at 1366×768 to `docs/lessons/figure-viewer/`
1. **A (bank + lesson student):** a math figure question shows one `.fv` between intro and question sentence, centred in
   the column; toolbar order zoom in, zoom out, `100%`, Reset, divider, Full Screen; figure fits the frame; no `.qfig`
   left; no left figure pane.
2. **B (bank + lesson student):** Zoom in → `125%`; the frame's box is unchanged; the image box grows 1.25× and is clipped;
   the content point at the frame centre is unchanged (±1 px); drag moves it; Reset → `100%`, centred.
3. **Panning at 200 %:** drag right/down moves the figure by the drag distance until the clamp; a drag past the edge stops
   at `(z·w − W)/2`; touch drag (CDP touch events) pans too.
4. **C:** hovering / focusing Full Screen shows the "Full Screen" tooltip.
5. **D (bank + lesson student):** Full Screen opens a modal overlay covering the viewport with a dimmed backdrop, the figure
   larger than in the frame and centred, toolbar at the top right with a close X; zoom to 200 % and pan inside; screenshot.
6. **Esc closes full screen**, focus returns to Full Screen; X closes too; frame zoom unchanged by overlay zoom.
7. **Keyboard:** Tab reaches all five buttons and the view; `+`/`-` on the focused frame change the %; arrow keys pan when zoomed;
   limit buttons stay focusable at 100 % and 300 %.
8. **Network:** zoom, pan, full screen and Reset issue no requests (request log during the interactions is empty) and send no
   WebSocket frames from the student.
9. **Instructor stroke on a figure, two students at 100 %:** the stroke lands on the same figure point on both students
   (and the instructor), anchored `i:0`. Then one student zooms to 200 % and pans: the stroke follows the content point and
   is clipped to the frame; the other student is unchanged.
10. **1366×768 at 100 %:** in the lesson student view and the bank player, the first answer choice of the seeded figure
    question is fully visible without scrolling.
11. Instructor live view and history/review render the viewer (one `.fv` each); zoom works in both.
12. Dark theme (bank): the figure keeps a white plate; toolbar readable.

Full suite must stay green (baseline recorded in `e2e.md`).

## Audit (`.omp/pipeline/figure-viewer/audit.mjs` → `audit.md`)
Every math question with a figure (323 + 3 SVG), in the real bank player and the real lesson Stage, at 1366×768, with
`/api/questions` and `/qimg/*` served from a local read-only copy by Playwright routing (no DB writes, no production calls
from the app). Per question: frame count == figure count; no stray `.qfig`; image decoded; image inside the frame and not
wider than the column; no horizontal page scroll; toolbar present; figure between intro and question sentence;
first choice visible. Report every failure with ID and screenshot.

## Seeds
`e2e-fig-math`: a math MC question with an intro sentence, a scatterplot `data:` SVG in `.qfig`, and a question sentence.
Lesson 900020 (instructor-paced, e2e-fig-math, 8 s). Not used by other specs.

## Task review items
No wire change; nothing new on the socket; strokes at 100 % identical to before (same anchor, same box); no extra requests;
old R&W and choice figure paths untouched; e2e specs not loosened.
