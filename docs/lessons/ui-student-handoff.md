# UI student player — handoff to admin dashboard redesign

Branch: `ui/student-player` (base `54984011`; do not merge/push/deploy).
Review: `docs/lessons/ui-student-diff-review.md`.

## Build setup

- `vite.config.ts`: entry `lesson-ui/index.tsx` → `public/lesson-ui/lesson.js` (+`lesson.css`), `es` lib format, minified; `publicDir: false`, `emptyOutDir: true`; `/shared/*` imports stay external (served from `public/shared`, never bundled).
- Worker serves the bundle via the static allowlist in `src/index.js`: `/lesson-ui/lesson.js`, `/lesson-ui/lesson.css` (only Worker change).
- Commands: `npm run build:lesson`, `npm run typecheck` (`tsconfig.lesson.json`, lesson-only), `npm run dev:lesson` (watch). Hooks: `predev`, `pretest:e2e`, `predeploy` all build first.
- `public/lesson-ui/` is gitignored build output; always rebuilt by the hooks. Never import from it except the two allowlisted paths.

## Island mount, auth, WebSocket

- Host: `#lesson-live > #lesson-content` in `public/index.html`; lesson CSS loads via `<link /lesson-ui/lesson.css>`.
- `mountLesson(root, bridge)` (`lesson-ui/index.tsx`) with `bridge: { mathify, select, lock, leave }`. Imperative handles: `update(model)`, `annotate(mark)` (sets follow target + repaints), `laser(point)` (auto-clears after 300 ms), `terminal(text)`, `reset()`, `destroy()`.
- Network/auth unchanged from the old inline module: REST join/reconnect use page Supabase `sbHeaders()`; the lesson WS carries `?client=<lessonClientId>` from the join response; server identity via `whoami()`. Socket/ping/reconnect logic lives in `public/index.html` (~lines 3690–3800), not in the island.
- Player state (`picked`, `lockPending`, `remaining`, `connected`, `name`, `error`) is computed in `lessonDraw()` and passed in; the island never fetches.

## `<Stage>` API (`lesson-ui/Stage.tsx`, shared by student + teacher)

- Props: `question`, `number`, `id?` (`lesson-card` student / `live-card` teacher), `picked?`, `active?`, `revealed?`, `marks?`, `privateMarks?`, `laser?`, `mathify`, `onSelect?`, `onReady?`, `onPrivate?`.
- `LOGICAL_WIDTH = 1240`. Render at 1240 px, `transform: scale(min(1, wrapperWidth/1240))`, `transform-origin: top left`; wrapper height synced; `ResizeObserver` repaints ink on resize. `getBoundingClientRect`/`getClientRects` therefore agree across viewports — this is what makes pen/laser drift-free.
- Question body rendered once per `question.id` into a ref container (React never reconciles it) via shared `Renderer.renderStem`/`splitContext`/`choiceHTML`; `Ink.blocks` then `Ink.paint(shared+private)` then `Ink.overlay(strokes+laser)` on `canvas.lesson-ink` (`pointer-events: none`). `el.dataset.ready = true` only after `document.fonts.ready` + image decode.
- Private annotate: Stage `pointerup` → `Ink.anchor` → `onPrivate` (student only). Grading overlay: choice effect toggles `sel`/`right`/`wrong` and clones hidden `#lesson-check-icon`/`#lesson-x-icon` SVGs into `.stage-verdict` before `.badge`.
- Instructor use (see `public/admin.js` `drawLive`): `mountStage(el, { question, number, id: 'live-card', marks, mathify })`. Teacher drawing/erasing still flows through the existing `card.onpointer*` handlers — untouched. To show the correct answer on a Stage, pass `revealed` (+ `picked` to mark a selection); the teacher mount currently relies on its separate `✓ Correct:` line instead.
- `followStage(card, mark)`: highlight/strike via `Ink.follow`; strokes scroll to last point. No-op for other ops.

## Tokens, fonts, icons, shared pieces (reuse these)

- Tokens (`lesson-ui/lesson.css`, scoped under `#lesson-live`): `--text:#171717 --dim:#555 --bg:#fff --bg2:#f4f4f4 --border:#777 --accent:#304fc5`; UI `16px/1.5 Lesson Sans`, stage body `20px/1.5 Lesson Serif`; `color-scheme: light`, white background (student stays light even in dark-mode browsers — E2E-asserted).
- Fonts: self-hosted WOFF2 via `@font-face` in `lesson.css` from `@fontsource/source-serif-4` / `@fontsource/roboto`. No CDN font requests.
- Icons: `lucide-react` only (`Check, X, Highlighter, Focus, EllipsisVertical, Circle, LogOut, Eraser, Users, LockKeyhole`); no emoji/text glyphs, no animation libs.
- Shared, not forked: `public/shared/{renderer,lesson,annotations,stats}.js` — import, don't copy. Shared component: `Stage`/`mountStage` exported from `lesson-ui/index.tsx`.

## Protocol

None. No new WS fields, no `validMark`/DO validation change (`src/lesson-room.js` untouched). Unit coverage for the wiring lives in `tests/test_lesson_room.cjs` (island mount string, `Renderer.choiceHTML` reuse, confirm copy).

## Selector/string changes

- `#lesson-connection`: was `● Connected` text, now `Connected` + visible `svg` (icon set). `realtime.spec.js` updated; meaning unchanged.
- `annotations.spec.js` erase step clicks the strike's first line-fragment center instead of the union-box center (the strike wraps on the narrower Stage; the old point could land on a neighbouring mark). Test-only; assertions unchanged.
- Everything else the specs use (`#lesson-card`, `[data-lesson-choice]`, `#lesson-lock`, `#lesson-confirm`, `#lesson-follow`, `#lesson-private`, `[data-ann-mark]`, `#lesson-code`, `#join-go`, all copy strings) is preserved — the unchanged specs passing is the proof.

## Counts, bundle, screenshots

- Unit: 73/73 (`npm test`). E2E: 15/15 (`npm run test:e2e -- --workers=2`; default 8 workers overloads this machine with connection-refused noise — unrelated to the change).
- Bundle: `lesson.js` 385.27 kB (gzip 89.32 kB), `lesson.css` 64.59 kB (gzip 45.04 kB).
- Screenshots (all 1366×768) in `.opencode/pipeline/ui-student-player/e2e/`: `01-lobby`, `02-answering-rw`, `03-selected`, `04-confirm`, `05-locked`, `06-revealed`, `07-answering-math`, `08-reconnecting`.
- Review: `docs/lessons/ui-student-diff-review.md`.

## Known issues / left undone

- Teacher erase still resolves by `e.target` hit-test: clicking the middle of a *wrapped* mark can hit a neighbour (pre-existing behavior, kept). E2E clicks on-mark.
- Grid-in keystroke-during-snapshot race has no E2E coverage (safe by construction, see review §c).
- No real-phone touch verification; no full-bank render sweep (3 fixture questions only).
- Untracked leftovers not part of this change: `.omp/`, `.serena/`, `nul`, root `chrome_*.png`, `docs/roadto1600-lessons-prompt.md`. `public/lesson-ui/` is ignored build output.
