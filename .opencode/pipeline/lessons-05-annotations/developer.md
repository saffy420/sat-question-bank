# Task05 Developer — lessons-05-annotations

## Status
App code + unit tests complete. Awaiting Test Developer (E2E) and Reviewer.

## Scope owned
Own app code and unit tests only. No Playwright/E2E seed or fixture edits, no docs/lessons/STATUS edit, no commit/push/deploy.

## Implemented

### New file
- `public/shared/annotations.js` — shared text/ink helpers: `blocks()` assigns stable `nodeId`s (`p:i`/`s:i`/`c:X`) to authored blocks; `anchor()` converts a selection to nodeId + character offsets over authored text nodes only (TreeWalker rejects `.katex,script,style,canvas`); `paint()` re-applies highlight/strike marks by unwrapping `[data-ann-mark]` spans and re-wrapping via `Range`/`createElement` (no HTML interpolation of annotation data); `overlay()` normalized-stroke canvas (`position:absolute`, DPR-scaled) + laser dot; `follow()` scrolls an offscreen annotated block/stroke into view inside `#lesson-live`.

### `public/shared/lesson.js`
- `annotate` and `laser` added to `ADMIN_ACTIONS` (students cannot send them); per-type field allowlists; `validMark()` gates op type, field names (rejects `html`/notes), color allowlist (`#ffe066/#ff7676/#75dbaa`), stroke point count ≤32 with finite `[0,1]` pairs, text anchors (`nodeId` pattern, integer offsets, `endOffset ≤ 20000`); `laser` requires unit-bounded `x/y`.

### `src/lesson-room.js` (LessonRoom DO)
- Role `admin` + phase `REVEALED` + current-question identity checked on every annotate/laser op; `invalid phase`/`invalid anchor`/`layer full`/`unknown mark` rejections; layer bounded at 512 marks and 64 KB JSON; anchor sanity against question `stem_html`/choice content.
- Annotate persists to DO storage (`save`) before broadcast; broadcast is a small op fan-out (no full snapshot per event). Laser broadcast only — never stored, server rate limit 50 ms (~20/s).
- Snapshot: `annotations` for current question included only when phase is REVEALED/ENDED, same projection for both roles (marks only — no notes/answers).
- Boundary write: `session_question_review.annotations_json` upserted from the DO outbox (`pending`/`nextPending` → `flush`, `ON CONFLICT DO UPDATE`) at `next`/`endSession`; alarm retries failed flush (5 s). No per-event D1 write.
- Fix this session: `next` now uses `nextPending` when a `pending` already exists (mirrors `endSession`), so a failed flush stays retryable instead of being clobbered (also protects `session_responses` rows).
- Frame gate now measures UTF-8 bytes (`TextEncoder`) against `MAX_FRAME=2048`.

### `public/admin.js` (instructor)
- REVEALED toolbar: pen / highlight / strikethrough / erase / clear all / laser. Pen: normalized points, 50 ms chunks capped at 32 points, live repaint from broadcast. Laser client-throttled to 50 ms. Erase targets mark span or nearest stroke within 12 px. Canvas/ink re-applied after snapshot re-render and on `ResizeObserver`; math (KaTeX) runs before ink re-apply.

### `public/index.html` (student)
- `#lesson-card` reuses `shared/renderer.js` output wrapped in `.lesson-stem`; shared layer painted after `mathify()`; `Follow me` checkbox (default on, per-device, in-memory); private highlighter (client-local only, never sent, cleared on question change/reconnect/leave); `annotate`/`laser` live handlers repaint marks/canvas only (no full question re-render); `Ink.follow` applied when Follow is on.

## Unit tests (`tests/test_lesson_room.cjs`, 15/15)
- Anchors retain exact offsets across 320 px vs 1366 px reflow and reject KaTeX-rooted selections.
- Protocol: student rejection, invalid ops (extra `html` field, `endOffset` 20001, 33 points, non-finite point, bad color), incorrect phase, wrong question id; oversize frame (>2048 bytes) closes 1008.
- Strike/highlight/erase/clear persist to DO; role-safe snapshot excludes annotations pre-reveal and never carries notes; laser broadcast with no persistence and no D1 write; outbox flushes once at boundary, retries after injected D1 failure, and endSession flushes again.

## Validation
- `rtk node --test tests/test_lesson_room.cjs` — PASS 15/15.
- `rtk npm test` — PASS 72/72 (0 fail, 0 skip).
- `rtk proxy node --check src/lesson-room.js public/shared/lesson.js public/shared/annotations.js public/admin.js tests/test_lesson_room.cjs` — OK.
- `rtk git.exe diff --check` — OK (CRLF warnings only, pre-existing checkout behavior).

## Remaining checkpoints (not this stage)
- Test Developer: all BRIEF §12.5 task05 E2E checkpoints incl. cross-viewport/cross-zoom highlighted-string equality, strikethrough, pen/laser liveness, Follow scroll, reconnect, students blocked from shared layer; writes `tests/e2e/lessons-05-annotations/` + `e2e.md`.
- Deep Reviewer: diff, leak, boundary persistence, scope.
- Risks: pen geometry is card-relative (spec tradeoff — strokes approximate across layouts, text ops are exact); `c:[A-D]` limits choice anchors to 4-choice items; server anchor bound vs rendered offsets is a loose upper bound (exactness is client/renderer-side, verified by E2E string compare); local-only validation, no production/real-device claim.
