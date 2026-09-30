# figure-viewer handoff

## Status
Complete. Spec: `spec.md`. Results: `e2e.md`. Bank audit: `audit.md`. Review and repair round: `review.md`.
Screenshots at 1366×768: `docs/lessons/figure-viewer/`.

## Shipped
- **One component, `public/shared/figure.js`:**
  - a Bluebook-style frame with Zoom in, Zoom out, the current %, Reset, a divider and Full Screen;
  - **[DEFAULT]** `ZOOM = { min: 1, max: 3, step: 0.25 }`;
  - zoom keeps the point at the frame's centre fixed;
  - the frame keeps its size: the figure is clipped and pans by mouse drag, touch drag or the arrow keys, clamped so no
    gap opens;
  - Reset returns to 100 %, centred;
  - Full Screen is a modal `<dialog>`: a dimmed backdrop over the whole app, the figure centred, the toolbar top right
    with a close X, the same zoom and pan code, closed by Esc or X, focus back on Full Screen;
  - every control is a focusable `<button>`, and the limit buttons use `aria-disabled` so they stay focusable;
  - `+`/`=` and `-` work anywhere in the frame;
  - the "Full Screen", "Zoom in" and "Zoom out" tooltips show on hover and on keyboard focus (C);
  - it injects its own stylesheet once per document (CSP allows inline styles), with id-level specificity so page-wide
    `button` rules don't restyle it.
- **Placement, math stems only.** `Renderer.mathStem` wraps every math `.qfig` image and authored inline SVG graph
  in a frame, **in the question column**. The frame keeps the figure's authored place (above the text in 180 questions,
  between intro and question in 141). The 2 figures authored after all the text move above the last text block.
  Math tables still go to the left pane. This replaces the old figure-in-the-left-pane split, and the bank's inline
  fallback when Desmos is open.
- **Where it runs:**
  - bank practice player, and the Browse/admin previews (`previewHTML`);
  - admin question viewer;
  - every lesson Stage: student instructor-paced, self-paced, the instructor live view, admin self-paced cards, and
    My Lessons history/review.
- **100 % size:** natural size, capped by the column width and `--fv-h: clamp(150px, 28vh, 440px)`. `fitFigures`
  shrinks that cap for one stem when its text plus figures would still push the first line of the first choice below
  the footer (lesson) or out of the pane (bank). It never goes below 140 px and re-fits on resize.
- **Network:** nothing new is fetched. Full screen moves the loaded element into the overlay and leaves a same-size,
  src-less `<img>` in the frame. A clone with a `src` re-requested the image (found by the network checkpoint).
- **Old lightbox:** kept for Reading & Writing figures only. It never opens on a math frame.

## Lessons: what is local, and what a zoomed student sees
- Zoom, pan and full screen are local to each browser. They are never sent over the socket: the spec asserts that
  the student sends no frames other than `ping` while using the viewer, and the wire format is unchanged.
- Instructor strokes stay card-normalized (BRIEF §7.1). A stroke that starts on a figure is stored with the figure
  anchor `i:<n>` and points as fractions of that figure image, as before. Each client reads that image's box **with
  its own zoom and pan applied**, so a fraction always names the same point of the figure's content.
- **What a student sees when the instructor draws on a figure the student has zoomed:**
  - the stroke is drawn on the zoomed figure, over the same points of the graph;
  - it grows with the zoom and moves when the student pans;
  - it is clipped to the frame, so the parts of the stroke over parts of the figure panned out of view are hidden;
  - a laser dot on a panned-out part is hidden.
  - After Reset, the stroke is back exactly where it was at 100 %.
  - Pen width stays 3 px: only positions scale, not line thickness.
- **At 100 % nothing changes:** the same anchor, the same box, the same pixels. The two-student checkpoint (1366×768
  and 1536×864) and the instructor all show the stroke over the same figure points.
- **The instructor's own zoom** is also local. Fractions are taken through the instructor's transform, so a stroke
  drawn while the instructor is zoomed still lands on the right graph point for students at 100 %. Pan is off while
  pen, laser or eraser is the active tool (the drag belongs to the pen); the zoom buttons still work while drawing.
- **Full screen shows the clean figure.** Ink stays on the card underneath and reappears on close. A stroke made
  while a student is in full screen shows on their card when they close it.
- **Strokes that start on text** (glyph anchors) are unchanged. If one crosses a zoomed figure, it stays where the
  text is and does not follow the zoom.
- **AI inline-SVG graphs (3 questions)** have no `i:` image anchor, so a stroke over one uses the question-pane
  anchor. It matches at 100 %, but it doesn't follow a zoom.
- **Saved history marks:** `i:<n>` now counts framed and pane images first. That reproduces the old numbering
  (figures used to be in the left pane, ahead of the stem's notation crops). No bank question has both a figure and
  a table, so every saved figure stroke lands on the same image as before.

## Tests
- Unit: `tests/test_figure_viewer.cjs` (the steps, centre-fixed zoom and the pan clamp, lifted from `figure.js`), and a
  `/shared/figure.js` serve check in `tests/test_admin.cjs`.
- E2E: `tests/e2e/figure-viewer/viewer.spec.js`, 2 tests:
  - bank: A–D, the 200 % clamps, touch, the overlay, Esc/X, keyboard, no requests, dark theme, the inline-SVG
    regression;
  - lessons: student A–D, no socket frames, the instructor viewer, the stroke on two students and under one
    student's 200 % zoom, history.
- New seed `e2e-fig-math`: its image is served by the spec from `tests/e2e/figure-viewer/scatter.svg`, so requests can
  be counted. The bank now has 9 seeded questions (the practice and builder specs were updated).

## Not done / for you
- The content defects listed in `audit.md` need re-extraction or hand repair:
  - 12 garbled rotated axis titles;
  - about 9 stems with figure labels detached from the crop;
  - 3 crops with a sliver of a neighbouring table;
  - `b544a348`, whose figure appears to show the worked solution.
- 8 bank / 21 lesson questions still put the first choice below the fold at 1366×768, even with the figure at its
  140 px floor (two figures, very long stems or extraction debris). They scroll as before.
- Reading & Writing figures keep the old lightbox (the task says math only).

## Manual checks for you
- On a real Chromebook at 1366×768:
  - touch-drag a zoomed figure;
  - press `+`/`-` on a focused frame;
  - open full screen and close it with Esc.
- Live lesson: zoom a figure on one student Chromebook to 200 % while you draw on it from the laptop, and watch the
  stroke follow the zoom; a second Chromebook at 100 % shows the stroke unchanged.
- Spot-check `b544a348` and two garbled-axis questions against the PDFs.
