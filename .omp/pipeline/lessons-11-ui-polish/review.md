# lessons-11-ui-polish: review

Reviewed `git diff cadec68..HEAD` (5 commits) against `spec.md`, BRIEF section 12.6 and the task text.
Evidence run by the reviewer: `npm run typecheck` clean; `npm test` 150/152 (the two failures are the known pre-existing ones,
`test_grade.cjs` needs `git.exe`, `test_lesson_flush.cjs` "daily limit" is time-of-day; neither file nor anything it imports is in the diff);
focused e2e `ink.spec.js -g "instructor at 125"` passes (phrase words 26..34 wrap on the 110 % student and are covered identically on all three screens).
Screenshots `student-1366x768-math.png` and `student-z125-both-docks.png` inspected: header/footer/column/rows/strike control match the brief.

## Verdict: PASS (no blockers). Four should-fix items and several nits; none blocks merge.

## Findings (all listed before judging)

### Should-fix

1. **should-fix, a11y regression: keyboard focus on "Follow me" is invisible.** `lesson-ui/lesson.css:47` makes the checkbox `opacity:0` and it covers the tool;
   the only focus style is `#lesson-live input:focus-visible { outline }` (line ~28), and an outline on an `opacity:0` element is invisible. Before this change the checkbox was visible.
   Fix: `.lesson-follow-tool:has(input:focus-visible){ outline:3px solid #156fd1; outline-offset:4px; }`. Same class of problem:
   `lesson-ui/lesson.css:203` `#lesson-live .self-grid button[aria-current=step]{ outline:0 }` (specificity 1,2,1) beats the focus-visible rule, so the focused current navigator cell shows no focus ring.
   Fix: drop `outline:0` there (the underline already marks the current step) or add a `:focus-visible` rule after it.
2. **should-fix, layout: student calculator max width ignores the instructor follower dock.** `lesson-ui/Calculator.tsx:17-18` clamps to `innerWidth - 480 - 48` as if the calculator were alone.
   With the follower open too (`.lesson-main.with-desmos` adds `--dock-r` = 28vw + 24), at 1093 px the widest calculator (565 px, `--dock-l` 589) plus the follower (330) plus two 31 px gutters leaves about 113 px
   for the question column (computed from the CSS; `docking.spec.js` tests the wide dock and both docks separately, never both with the wide dock). Nothing overlaps, but the column is unusable.
   Fix: in `maxWidth()` subtract the follower dock when `.with-desmos` is present (e.g. read `--follow-w` from the root, or keep `MIN_COLUMN` against `innerWidth - followerWidth - GUTTERS`), and add a both-docks-wide assertion to `docking.spec.js`.
3. **should-fix, item 4 completeness: a pen gesture that starts away from any glyph never upgrades to a glyph anchor.** `admin-ui/Live.tsx:1040`
   `glyphMode = !!anchor && /[@~]/.test(anchor)` means a stroke that begins more than 3 em x 2 em from text (page margin, gap between paragraphs: anchor `P`, `Q`, `s:n` block or none) stays in pane/block/card fractions for the whole gesture,
   even when it then runs across words. Those fractions scale with each student's pane box and reflow height, so that stroke lands on different words per viewport (the exact symptom of item 4). Figure-started gestures should keep their figure anchor (as spec says), but not these.
   Fix: `glyphMode = !anchor || !anchor.startsWith('i:')`; `convert()` already switches `anchor` to the first chunk that finds a glyph and `limits()` follows `anchor`. Add a spec that starts a stroke in the margin and crosses a phrase.
4. **should-fix (spec vs delivery): unit tests promised in spec.md are only half there.** spec.md "Unit tests" lists `tests/test_annotations.cjs` with em round-trip across two font sizes and canvas-size rounding.
   Delivered: `tests/test_annotation_anchors.cjs` covering `validMark`/`validAction` only. Round-trip and canvas rounding are covered by e2e (`ink.spec.js`, good), but no cheap unit level. Either add a jsdom-free pure-math test
   (extract the em conversion into a small pure helper) or note the deviation in `handoff.md`.

### Nits

5. **nit, keyboard handle unreachable.** `lesson-ui/Calculator.tsx:~304` `#lesson-calc-resize` has `tabIndex={-1}`, so the `onKeyDown` arrow-key nudge (`nudge`) can only run after a mouse click focused it. Give it `tabIndex={0}` + `role="separator"` + aria-value attributes like the instructor handle in `Desmos.tsx`.
6. **nit, hover tint shapes.** `#lesson-live button:not(:disabled):hover{background:#f1f1f1}` (lesson.css:~24) also tints the `.self-grid` cells (radius 0: a grey rectangle on hover) and the 10 px `.lesson-calc-resize` strip. The user said "no boxes"; add both to the no-hover-tint overrides.
7. **nit, localStorage write on every pointermove.** `admin-ui/Live.tsx:923` writes synchronously per move during a drag. Persist on pointer end (or in the same rAF) instead; behaviour is otherwise correct (try/catch present, clamped, lazy read once).
8. **nit, pen chunk conversion is deferred up to 50 ms on client coordinates.** `admin-ui/Live.tsx` `flush()` converts stored client px at flush time; a scroll of the stage between the pointer event and the flush (wheel while drawing) would map the tail of the chunk to different content. Store `[clientX, clientY, scrollTop]` or convert on move when cheap. Low likelihood.
9. **nit, deploy skew.** A student tab running the previous bundle receives `s:0~12`-style anchors it cannot parse (`anchorElement` gets the whole string) and simply draws no ink or laser until reload. Server accepts both forms, so nothing breaks; worth one line in the handoff (reload students after deploy).
10. **nit, canvas box.** `annotations.js:156` sizes the backing store from the card's border-box (`getBoundingClientRect`) while the canvas CSS box is the padding box; identical today (no card border/padding) but silently wrong if one is added. Use `card.clientWidth/clientHeight / s` or `rect - border`.
11. **nit, panel space in the instructor view.** `admin-ui/Live.tsx` `desmosMax = bodyWidth - 360` treats all of `.live-body` as stage; if a side panel (`{children}`) is open the stage can drop below 360 px. Subtract the children's width or measure `#live-stage` instead.
12. **nit, phone widths.** Below 750 px `.lesson-calc` (lesson.css:186) becomes a full-width overlay with `--dock-l:0`, so it covers the question. Out of scope (Chromebook target), pre-existing behaviour class.
13. **nit, spec text.** spec.md says choice-row radius "at least 12" in one bullet and "10" in another; CSS gives 0.8u = 11.2 px at 1366. Tests assert 10 (matches screenshot A). Fix the spec wording.

### Checked and clean

- **Server/protocol (rule 5, 6, 4):** `src/lesson-room.js` untouched; it relays `a` opaquely and persists strokes in DO storage with the existing 512-mark / 64 KB caps, no D1 write per event, no answer/explanation/notes fields touched. `validMark`/`anchored` (`public/shared/lesson.js:45-57`) accept `~` (+-400 em) and `@` (+-4000 px), reject malformed (`s:3~`, `s:3~1~2`, `~5`, `c:E~1`, 6-digit offsets); laser uses the same `anchored`. Length cap 16 is enough (`p:9999~99999` = 12). `npm test` covers it.
- **annotations.js:** em math (`k = fontPx(el)`, `toCard` = origin + x*k, `fromClient` inverse) is consistent; legacy `@` stays k=1; `scaleOf` treats sub-1.5 px width differences as scale 1; canvas backing store `round(w*dpr*s)` with exact transform, cleared per paint, size assignment guarded; laser goes through `frame(...).toCard` so em anchors work; `locateGlyph` window 3 em x 2 em replaces the 60x40 px window.
- **Live.tsx pen:** chunk continuity holds (last point carried over as first raw point of the next chunk and re-located), figure anchors kept, clamps follow the anchor kind (`limits`), erase uses `scaleOf` + `strokePoints`, listeners removed in cleanup, interval cleared.
- **Stage.tsx:** `resize` and dppx `matchMedia` listeners are removed in the effect cleanup (same `paint` closure), matchMedia re-armed after each change.
- **Calculator.tsx:** `--calc-w` set/removed by a layout effect with cleanup on unmount, `null` width uses the CSS clamp, window resize re-clamps, calculator instance (state) is untouched by width changes, pointer capture used.
- **Desmos.tsx handle:** pointer capture, touch-action none, keyboard (arrows, Shift, Home/End), role=separator with aria values, storage wrapped in try/catch, clamp `[280, min(720, body-360)]` with the stored value kept as chosen but drawn clamped.
- **CSS:** every `.lesson-submit`, `#lesson-lock`, `#self-next`, `#history-next`, `#poll-vote`, `#self-submit`, confirm and replace button has an explicit hover that keeps the solid pill (no white-on-grey); `.lesson-position` is a span in the footer and has its own hover; dialogs, poll, history, self-paced and instructor-shared rules keep working (screenshots and shapes.spec sweep ~25 screens); `overflow-x:hidden` on `#lesson-live` does not hide overflow from the tests (they compare `scrollWidth - clientWidth`); `--u/--fs/--gutter/--column/--head/--foot` do not collide with admin.css or `public/index.html`; light-plate/dark-mode rules not touched (lesson is `color-scheme:light`); legacy `.choices{max-width:680px}` leak fixed by `.lesson-stage .choices{max-width:none}`.
- **Tests (f-i):** each of the six spec.md checkpoints has a real spec (layout x6 sizes + max width, shapes sweep with positive control, docking at 1366 and 1093, pen phrase/multi-line at 125 % and 1920, pen-start at 5 zooms, laser at 80/150, refit via CDP DSF/size/setViewportSize, Desmos handle drag/clamp/reopen/next/reload/narrow). No `.skip`/`.only`/`fixme` anywhere; `setTimeout` values (120-240 s) are per-test and match existing specs; the only fixed sleep is the 16 ms pointer cadence in `trace()` (simulates a 60 Hz mouse, documented). Changes to existing specs are legitimate consequences of the intentional UI change: 05 tightens 2 px to 0.1 em and adds start-in-word and different-font-size assertions; 11c rewrites drag/resize for the dock but keeps state/Try-it-yourself assertions; 06 and 11c click the follower's new-expression row at `{x:6,y:8}` to avoid Desmos's trial-key badge (typed text is still asserted not to land). The test commit `70313cb` touches no app code (app fix `83a172f` is its own commit). Sensitivity: with px anchors the phrase test fails by construction (a 9-word run spans different words at 17.5/19/21 px type and the phrase wraps on a student but not the presenter) and the 05 spec asserts that teacher and student font sizes differ, so the comparison in em cannot pass by accident.
- **Scope (d):** diff = app files for items 1-5, their tests, screenshots, this task's `.omp` notes and one docs README. The `admin.css` `--pane-inset` change (2.5vw to 2.8vw, cap 56) is a deliberate match to the student gutter (state.md); acceptable.

### Claims in e2e.md vs reality

14. **nit.** The result table says the full suite passed 72/72 after `83a172f`, but the "Commands run" block still lists "full suite: 71 pass, 1 fail" and "final run: 27 pass, 1 fail" and no post-fix full-suite command. The header still says "No application code was changed. Nothing was committed". The reviewer did not re-run the 14-minute suite (as instructed); update the block so 12.6(j) evidence is unambiguous.
15. Otherwise the claims spot-checked hold: screenshot count 53 / 1.6 MB, legacy `public/index.html:448` `.choices{max-width:680px}`, 5 focused updated specs, and the 125 % phrase test output.

## Repair round 1 (main session, after the review)
- Finding 1: `.lesson-follow-tool:has(input:focus-visible)` outline added; `outline:0` removed from the current navigator cell.
- Finding 2: `Calculator.tsx` `maxWidth()` now subtracts the instructor-graph dock (`.lesson-desmos` width + 24) when it is open.
- Finding 3: `Live.tsx` `glyphMode = !anchor?.startsWith("i:")` (only a stroke that starts on a figure keeps one anchor).
- Finding 4: spec.md corrected: unit test covers validation; em round-trip / canvas rounding are asserted in `ink.spec.js`. Recorded as a deviation in the handoff.
- Nit 5 already fixed (the handle has no `tabIndex={-1}` since the first commit; the reviewer read an older build). Nit 6: hover tint removed on nav cells, history numbers and the resize strip.
- Not changed (accepted, listed in the handoff): nits 7–11 (localStorage write per move is a few bytes; stale-bundle tabs redraw after reload; canvas box equals card box today; desmosMax ignores the open notes/navigator drawers, which overlay).
- Re-run after the repair: 11-ui-polish + 11c + 05 specs 26/26; full suite: see e2e.md.
