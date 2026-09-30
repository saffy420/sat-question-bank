# Handoff — lessons-11-ui-polish

## Status
Implemented, tested locally, reviewed (PASS after repair round 1). Pushed to `claude/loving-volta-n524ml`. No PR opened (not requested).
Files: `spec.md`, `state.md`, `e2e.md`, `review.md`; screenshots in `docs/lessons/11-ui-polish/` (README lists them).

## What shipped
1–3. **Student view** (`lesson-ui/lesson.css`, `index.tsx`, `Self.tsx` unchanged markup except the header title block):
- Two clamp()ed tokens drive everything: `--u` (chrome, 16 px at Bluebook A) and `--fs` (question type); header/footer heights from `vh`.
  Tokens live on `#lesson-live` **and** `#admin-root` so the instructor's stage uses the same scale.
- Measured (student, math question), before → after: column 800 px fixed (59 % at 1366, 73 % at 125 % zoom) → **46 % at every size**
  (628 px at 1366, 707 at 1536, 883 at 1920, 503 at 1093 = 125 % zoom); type 20 px → 17.5 / 18.0 / 19.2 / 16.6 px; header 102 → 69 px,
  footer 80 → 54 px at 1366×768; the separate 26 px phase row is gone (phase label sits under the title). No horizontal scroll at any size.
- Header: title (+phase) | timer + Hide | icon-over-label tools; no fill, no border; active = accent colour + 2 px underline. Follow me keeps `#lesson-follow` (invisible checkbox over the tool).
- **Buttons have no outline box and no circle** (user request during the task): Hide, ABC, Back, Select, dialog cancel/back, navigator and history numbers are plain text;
  only Next/Submit/Yes-submit/Replace and the `Question X of N` pill are solid pills. The cross-out control is the letter with a strike line, no circle.
  Choice rows (rounded) with the letter circle inside, inputs, selects and poll rows stay rounded boxes as in Bluebook A — say if those should be flat too.
- Cross-out control sits outside the row on the right; its space is always reserved (no reflow when the tool is switched on).
- **Calculator docks left** (`Calculator.tsx`): fixed between header and footer, width `clamp(300px, 28vw, 440px)`, adjustable from a handle on its right edge
  (280 px … `innerWidth − 528 − follower dock`); `.lesson-main.with-calc` pads by `--dock-l`. **The floating drag/corner-resize window is gone**; specs 06 and 11c were rewritten for it
  (state, Try it yourself and no-payload assertions unchanged). The instructor-graph follower docks right (`--dock-r`); both together never overlap the column.
4. **Pen/laser** (`public/shared/annotations.js`, `lesson.js`, `admin-ui/Live.tsx`, `lesson-ui/Stage.tsx`):
- Finding: on the instructor's own screen the pen already started under the pointer and the laser sat under it at 80–150 % (probe: ink within the 3 px line width of the path; emulation, see limits).
  The drift is between screens: glyph anchors stored offsets in **CSS px**, only valid while every client has the same type size; item 3 makes type fluid.
  Demonstrated by running the old anchor code on the new layout: a stroke over "seedling growing in deep shade" drawn at 125 % covered "…deep" only on the 110 % student.
- Fix: new additive anchor form `node~offset` with x/y in **em of the block's font size**; old `node@px` marks still validate and paint. Each ~50 ms pen chunk re-anchors to the glyph under
  its first point (falls back to the previous anchor when no text is within 3 em × 2 em; a stroke that starts on a figure keeps its figure anchor), so a stroke that wraps on one screen still covers the same words.
  Pen width follows the block's type size. Canvas: CSS 100 % of the card, backing store `round(w × dpr)` with an exact context scale, repaint on window resize and devicePixelRatio change (plus the existing ResizeObserver).
  Wire format otherwise unchanged (`stroke {points, a}`, `laser {x,y,a}`); `src/lesson-room.js` untouched.
5. **Instructor Desmos width**: drag handle `#live-desmos-handle` (mouse, touch pointer events, arrows ±20, Shift ±60, Home/End); width in `localStorage["lessons.desmosWidth"]` (admin page only, try/catch);
   clamp `[280, min(720, stage − 360)]`; survives close/reopen, next question and reload; Desmos is told to `resize()` when it changes. No protocol change.

## E2E / unit
- New: `tests/e2e/lessons-11-ui-polish/{layout,shapes,docking,ink,desmos-width}.spec.js` (23 tests). Updated: `annotations.spec.js` (anchor form, em comparison), `lessons-11c.spec.js`, `lessons-06-desmos/desmos.spec.js` (docked calculator; follower click at the row's left edge because the Desmos trial badge covers the row in a docked panel).
- Full suite 72/72 (before the repair round; re-run result in `e2e.md`). Unit: `npm test` 150/152 — the 2 failures pre-date this task on main (`test_grade.cjs` spawns `git.exe`; `test_lesson_flush.cjs` "daily limit" depends on the time of day). New `tests/test_annotation_anchors.cjs` 4/4. Typecheck clean.

## Deviations / limits
- Process: Tier 3 with fresh Test Developer and Reviewer subagents, as the task text asked; the repo BRIEF §12.1 says main-session only.
- spec.md's planned unit tests for em round-trip and canvas rounding are e2e (`ink.spec.js`) because they need a DOM; the unit file covers validation only.
- Browser zoom is **emulated** (CSS viewport 1366/z × 768/z with deviceScaleFactor z), as in earlier tasks. Real Ctrl+/− on a Chromebook has not been tried.
- A phase change (the reveal) while the presenter is mid-stroke ends that stroke (pre-existing; the pen effect depends on `s.phase`).
- A student tab still running the previous bundle draws no ink/laser for `~` anchors until it reloads.
- Touch drag of the Desmos handles is not covered by a spec.

## Manual checks for you
- Chromebook at 100 %, 110 % and 125 % browser zoom: the student view vs Bluebook (header/footer size, column width), calculator dock and instructor graph together.
- Instructor at 125 % zoom draws over a phrase and a figure; watch a Chromebook student at 100 % and 110 %; laser at 80 % and 150 %.
- Drag the instructor Desmos handle, reload, go to the next math question.
