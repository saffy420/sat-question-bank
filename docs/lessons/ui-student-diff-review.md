# UI student player — diff review vs `54984011`

Branch: `ui/student-player`. Base: `54984011 feat: add live lesson annotations`.
Method: `git diff --ignore-cr-at-eol` (checkout is CRLF, blobs are LF; the 8 touched
tracked files were converted back to LF so the diff shows content only).

## (a) Old lesson behavior map

Old locations are `HEAD:public/index.html` lines. New locations are worktree files.

| Old behavior (HEAD `public/index.html`) | New location | Status |
|---|---|---|
| `lessonSend` — select/lock/ping JSON send (`:3747`) | `public/index.html` `lessonSend` (unchanged) | preserved |
| Snapshot receive + pending/lockPending reconciliation (`:3766-3771`) | `public/index.html` socket handler (verbatim) | preserved |
| Annotate receive: clear/erase/push layer (`:3772-3776`) | `public/index.html` handler (same ops) → `lessonDraw` + `lessonUI.annotate` | preserved |
| Annotation repaint `Ink.blocks/paint/overlay` (`:3722`,`:3777`) | `lesson-ui/Stage.tsx` mount effect + `paint` effect (same shared module) | preserved |
| Follow scroll `Ink.follow` on annotate when follow on (`:3777`) | `lessonUI.annotate` → `followMark` → `followStage` (`lesson-ui/Stage.tsx`); stroke branch uses last-point math equivalent to `Ink.follow` | preserved |
| Laser overlay + 300 ms clear (`:3778-3779`) | `mountLesson().laser` (`lesson-ui/index.tsx`): same `Ink.overlay`, same 300 ms | preserved |
| Error receive: clear pending/lockPending, show text (`:3780`) | Same logic in `public/index.html`; text via island `#lesson-error` (same id/role) | preserved |
| Ping + best-RTT offset (`:3759-3764`) | Verbatim in `public/index.html` | preserved |
| Reconnect: `Reconnecting…`, 1500 ms GET retry, terminal strings for 4001/4002/409/403/410 (`:3782-3795`) | Same flow in `public/index.html`; banner is island `.lesson-reconnect`, terminals via `lessonUI.terminal` with identical strings | preserved |
| 1 s clock + ping interval (`:3805`) | Unchanged in `lessonJoin` | preserved |
| Clock text `m:ss`, red ≤5 s `#bd2424`, orange ≤10 s `#b56a00`, disable-all at 0 (`:3740-3745`, fmt `:3345`) | Rendered by island from `remaining` prop (`lesson-ui/index.tsx`); format, thresholds, colors identical; deadline-disable via `active` prop | preserved |
| Select guard + pending + send (`:3748-3751`) | `lessonSelect` in `public/index.html` (verbatim); immediate DOM tweak replaced by island re-render (same `aria-pressed`/`sel` outcome, E2E-asserted) | preserved |
| Lock: Submit → confirm modal → guards → send pending + lock (`:3714-3718`) | `bridge.lock` + island `<dialog>`; same strings, same `#lesson-confirm`/`#lesson-back` ids, same guards | preserved (modal host changed, justification 1) |
| Reveal line, explanation + `mathify`, class results (`:3707-3708`) | Island `lesson-reveal` section; same data; explanation effect runs `mathify`; results use bar divs instead of `█` text | preserved + verdict icon added (redesign) |
| Choice classes `sel`/`right`/`wrong` via `choiceHTML` (`:3705`) | Same `Renderer.choiceHTML` + same class toggles (`Stage.tsx` choice effect) | preserved |
| Grid-in select + live `/^[-\d./]{1,32}$/` validation (`:3712-3713`) | Stage `click`/`input` handlers → `bridge.select`; same regex; added answer-preview `<output>` (redesign) | preserved |
| Grid-in focus/caret restore (`:3700`,`:3738`) | Removed: Stage never rewrites a focused grid (value set only when unfocused), so no clobber by construction | changed (justification 2) |
| Private highlight toggle/`aria-pressed`/anchor/color `#75dbaa`/clear (`:3727-3735`) | Island `privateOn`/`privateMarks` state; `onPrivate` → `Ink.anchor` + same color; clear resets state | preserved |
| Private/follow toolbar rendered only when revealed (`:3701`) | Toolbar always in island header | changed (justification 3) |
| ResizeObserver re-overlay on card resize (`:3723`) | Stage `ResizeObserver` on wrapper + card; repaint on resize | preserved |
| Leave view teardown (`:3710`) | `bridge.leave`: same clears + `lessonUI.reset()` (unmount) | preserved |
| Join modal + 6-box code + paste (`:3808-3814`) | Untouched in `public/index.html` | preserved |
| Connection text `● Connected` (`:3701`) | Lucide `Circle` icon + screen-reader text `Connected` | changed (justification 4) |
| Header `Q x/y`, joined count; `#lesson-live` fixed overlay + `.panel` | Bluebook header/footer/lobby (same data: title, position, count, name) | changed (redesign, task requirement) |
| Timer Hide/Show, More menu, lobby art | New island chrome | added (redesign, task requirement) |
| `data-ready` gate (`fonts.ready` + `img.decode`) | New in `Stage.tsx`; required for drift-free geometry assertions | added (E2E requirement) |
| Fixed 1240 logical width + `scale()` transform | New in `Stage.tsx`; fixes pen/laser drift across viewports/zoom | added (core requirement) |

Justifications:
1. Native `<dialog>` keeps focus/modal semantics the custom divs lacked; strings, ids, guards, and flow identical; covered by `student.spec.js` 04-confirm.
2. Old caret restore existed because full `innerHTML` redraws wiped the input each second. The island never touches a focused grid, removing the need. No E2E types during a snapshot race (see (c)).
3. Annotate/Follow must work during ANSWERING (new `student.spec.js` does exactly that); revealed-only tools would fail the new spec.
4. Icon-set requirement (`lucide-react`, no text glyphs); `tests/e2e/lessons-03-realtime-core/realtime.spec.js` now asserts text + visible `svg`.

Removed with no replacement: `lessonResize`/`lessonLaser`/`lessonPrivate*`/`lessonFollow` module vars (state moved into island/closures); `import * as Ink` in `index.html` (island imports the same shared module); `#lesson-pick` wiring (inside Stage).

## (b) Files outside the lesson UI

- `package.json` / `package-lock.json`: `build:lesson`, `typecheck`, `dev:lesson`, `predev`, `pretest:e2e`, `predeploy` chain; deps `react`, `react-dom`, `lucide-react`, `@fontsource/*`, `vite`, `typescript`, `@types/*`. Reason: island build/typecheck.
- `.gitignore`: ignore `public/lesson-ui/` (generated bundle, rebuilt by hooks). Reason: keep minified output out of review.
- `src/index.js`: allowlist `+ /lesson-ui/lesson.js`, `/lesson-ui/lesson.css`. Reason: Worker must serve the built island; nothing else in the Worker changed.
- `public/index.html`: `mountLesson` bridge, simplified `#lesson-live`/`#lesson-content` containers, lesson.css link. Reason: host wiring for the island; join modal, practice code, auth untouched.
- `public/admin.js`: `mountStage` into `#live-stage` for the instructor card. Reason: teacher/student share one Stage; teacher pen/erase/clear/laser handlers untouched.
- `vite.config.ts`, `tsconfig.lesson.json` (new): island build to `public/lesson-ui`, `/shared/*` external, lesson-only typecheck.
- `tests/e2e/lessons-03-realtime-core/realtime.spec.js`: connection assertion per justification 4.
- `tests/e2e/lessons-05-annotations/annotations.spec.js`: smooth-scroll settle poll (assertion unchanged), word-relative stroke geometry check (<2 px, E2E requirement), strike erase clicks first line fragment (old union-center sat on a neighbouring mark once the strike wraps; assertion unchanged).
- `tests/test_lesson_room.cjs`: asserts `mountLesson(lessonRoot` wiring, `Renderer.choiceHTML(` reuse, confirm string in island.
- `tests/e2e/ui-student-player/student.spec.js` (new): island states, private marks, stable body, light theme, 8 screenshots.
- Line endings: the 8 touched tracked files converted CRLF→LF to match repo blobs (checkout-wide CRLF is pre-existing; unrelated files untouched, unstaged).

No protocol change: `src/lesson-room.js` untouched, no new WS fields, no validation change.

## (c) Could not confirm preserved

- Grid-in keystroke race (typing while a snapshot lands): safe by construction (focused input never rewritten) but no E2E types during a snapshot. Low risk.
- Real-phone touch: pointer paths unchanged, but no touch device exercised (per standing rules, not claimed).
- Full-bank sweep: E2E covers 3 fixture questions (RW, Math SPR/choice, AI RW); all render through the same Stage path, but not every section/difficulty is individually exercised.
