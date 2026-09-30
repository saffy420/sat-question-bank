# lessons-11-ui-polish — spec

Source: the user's task text (items 1–5, checkpoints), screenshot A (Bluebook at 100%, 2000 px wide window) and
B (our student view on a 1366×768 Chromebook). Repo BRIEF §7.1 (annotations), §12 (pipeline). Out of scope:
question bank, figure zoom viewer, message-contract changes beyond item 4.

## Tier
Tier 3. Item 4 changes the wire form of pen/laser anchors (additive), and items 1–3 restyle every student screen
that ~40 e2e specs drive. Roles: main session = spec + implementation; **fresh Test Developer subagent**
writes the checkpoint specs from this file (not from the diff); **fresh Reviewer subagent** reviews
`git diff main...HEAD` at the end. Deviation from BRIEF §12.1 (main-session only) is deliberate, per the task text.

## Measured baseline (before, `shots.spec.js`, student, instructor-paced math question)
Column 800 px fixed (59 % at 1366, 73 % at 125 % zoom), body 20 px fixed, header 102 px, footer 80 px, phase row 26 px.
Instructor pen/laser under the pointer at 80–150 % **already exact** in the current build (probe: ink bbox within 1.5 px
of the pointer path = the 3 px line width; laser dot == pointer; students land on the same word) — see e2e.md.

## A's proportions (window 2000 × ~1175 content)
Header 108 px (5.4 vw / 9.2 vh); question column 922 px = 46 % of the window; number bar 45 px high, 90 px below the header
rule; body ≈ 20 px / 32 px line; choice rows 70 px high, 22 px apart, radius 10, letter circle 34 px; strike control 37 px right of
the row, inside the column; footer 85 px; name 26 px; question pill and Next are pills.

## Item 1–3 — student view (lesson-ui/lesson.css, Stage.tsx, index.tsx, Self.tsx, Poll.tsx, History.tsx, Calculator.tsx, Desmos.tsx)
- Tokens on `#lesson-live`/`.lesson-stage`: `--u` (chrome unit), `--fs` (question type) via `clamp()` of `vw`; header/footer
  heights via `clamp()` of `vh`. Everything else in `calc(var(--u) * k)`.
  Targets: 1366×768 body ≈ 17.5 px, column 46 % (628 px); 1920×1080 ≈ 19 px, 46 %; 125 % zoom (1093×614) ≥ 16 px.
- Header: title (+ phase label under it, replacing the separate 26 px row) left; timer + Hide pill centre; icon-over-label tools
  right, no fill or border; active = accent colour + 2 px underline; Follow me keeps `#lesson-follow` (round, not a square box).
- Column: `min(100% − gutters, clamp(440px, 46vw, 960px))`, centred; generous top gap under the header and before the choices.
- Choice rows: full width of column minus a reserved strike gutter, radius ≥ 12, letter circle; the strike control is outside the
  row on the right.
- Footer: name left, black **pill** `Question X of N`, blue **pill** Next/Submit right.
- All buttons in the student view are pills (border-radius 999px) or rounded rows (≥ 10 px); inputs/selects/navigator cells ≥ 10 px.
  Unit-of-check: no visible `button/input/select/summary` in `#lesson-live` with a visible border and radius < 8 px (circles OK).
- Student Desmos calculator **docks left** (fixed between header and footer, width `clamp(300px, 28vw, 440px)`, resizable by a
  handle on its right edge). `.lesson-main` padding-left tracks the dock width, the instructor follower docks right and pads
  right; the column reflows (min-width 0), never overlaps, never horizontal scroll. Replaces the floating drag/corner-resize window (11c
  spec updated; state/Try-it-yourself behaviour unchanged).
- Fluid: at 1366×768, 1536×864, 1920×1080 and zoom 90/110/125 % at 1366×768 (CSS viewports 1518×853, 1242×698, 1093×614):
  `documentElement.scrollWidth == innerWidth`, `#lesson-live` no horizontal overflow, column 40–52 % of the window, header
  ≤ 12 % and footer ≤ 9 % of viewport height.

## Item 4 — pen and laser tracking
Root cause (found by design review of the fluid layout, confirmed in tests): glyph anchors (`node@offset`) carry **CSS px**
offsets, valid only while every client has the same font size. Item 3 makes the font size differ per viewport/zoom, so a
stroke or laser offset from its glyph scales wrongly (e.g. a 200 px underline drawn at 125 % zoom, 16.6 px type, covers 12 words;
on a 1920 px student with 19 px type it covers 10.5 words). Also the whole pen gesture was tied to one anchor, so a stroke that
wraps over two lines on the presenter lands on other words where the line breaks differ; and the canvas backing store was
`floor(w × dpr)` (truncated at fractional zoom), `scaleOf` used integer `offsetWidth`.
Fix (`public/shared/annotations.js`, `admin-ui/Live.tsx`, `public/shared/lesson.js`):
- New additive anchor form `node~offset`: glyph anchor whose x/y are in **em of that block's font size** (scale-free). Old `@` px
  anchors still validate/paint (saved history). Figure/pane/block anchors are already fractions.
- Pen: each 50 ms chunk re-anchors to the glyph under its first point (falls back to the previous anchor when no glyph is within
  3 em × 2 em); a stroke that started on a figure keeps its figure anchor for the whole gesture.
- Laser/pen thresholds in em; stroke width scales with the anchor block's font size.
- Canvas: backing store `round(w × dpr)`, context scaled by the exact ratio; `scaleOf` ignores sub-pixel rounding; repaint on window
  resize and on devicePixelRatio change in addition to ResizeObserver.
Wire format otherwise unchanged (`stroke {points, a}`, `laser {x,y,a}`); normalized-fraction anchors (`i:n`, `P`, `Q`, `p:n`, none) unchanged.

## Item 5 — instructor Desmos width
`DesmosLeader` panel (admin) gets a drag handle on its left edge (mouse/touch/keyboard ±20 px). Width clamped to
`[280, min(720, stageWidth − 360)]` so the question keeps ≥ 360 px; stored in `localStorage["lessons.desmosWidth"]` (admin origin
only, wrapped in try/catch), read on mount, so it survives close/reopen, next question and reload. Default 420. No protocol change.

## Unit tests
`tests/test_annotation_anchors.cjs` (new): `validMark`/laser validation of `~` and `@` anchors and malformed ones. The em round-trip across two type sizes and the canvas
rounding need a DOM, so they are asserted in `tests/e2e/lessons-11-ui-polish/ink.spec.js` (px anchors would fail it) rather than as unit tests. `tests/test_lesson_room.cjs` keeps passing.

## E2E checkpoints (each becomes a spec under tests/e2e/lessons-11-ui-polish/)
1. Student view at 1366×768, 1536×864, 1920×1080 and zoom 90/110/125 % (screenshots saved beside A in docs/lessons/11-ui-polish/):
   metrics from Items 1–3, no horizontal scroll, shape rule (no square bordered controls), header/footer structure (title left,
   timer+Hide centre, tools right without fill; pills), strike control right of the row.
2. Desmos docking: with the student calculator open on 1366×768 and 1093×614, no element of `.lesson-main` content intersects the
   dock; column narrower, no horizontal scroll; instructor follower docks right without overlap.
3. Instructor pen at 125 % lands on the same word for a student at 1366×768/100 % and a student at 110 %; multi-line stroke
   check (a stroke over words of two presenter lines covers the same words for both students).
4. Laser under the pointer on the instructor's own screen at 80 % and 150 % (dot centre within 2 px of the pointer) and on
   the same word for students.
5. Resize/zoom mid-question (setViewportSize + DSF) re-fits the canvas (canvas CSS size == card size, backing store ratio matches DPR) and keeps strokes.
6. Instructor Desmos drag handle: width changes, is clamped, survives close/reopen, next question, reload; students unaffected.

## Task review items
Wire compatibility (old marks still paint), no answer/notes leak change, no per-event D1 writes, e2e specs not loosened,
11c spec rewrite shows unchanged assertions on state/Try it yourself.
