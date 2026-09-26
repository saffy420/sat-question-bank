# Task05 Handoff — lessons-05-annotations

## Status
Complete

## Goal
Implement BRIEF §7.1 shared instructor annotations in instructor-paced REVEALED, plus user-requested shared **strikethrough** on selected text. Scope task05 only; no Desmos, self-paced, polls, or student lesson history UI (task09). User cleared task04 Chromebook STOP and requested shared strikethrough as additional text tool.

## Changed

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

### App repair (fresh Developer, task04 spec regression)
- `/shared/annotations.js` returned 404 under Worker static allowlist (`src/index.js:412`). Updated `src/index.js` to allow `/shared/annotations.js` and updated `tests/test_admin.cjs` accordingly.

### Test repair (fresh Test Developer)
- `tests/e2e/lessons-05-annotations/annotations.spec.js` — permanent focused E2E spec written (Test Developer stage, no app edits).
- `tools/e2e_core.sql` — added long local passage seed for cross-viewport string comparison.
- Initial spec failures (wrong lexical sort order, reload not rejoining, sorted expected array order) corrected in spec only, not app.

## Validation
- `rtk node --test tests/test_lesson_room.cjs` — PASS 15/15 (Developer).
- `rtk npm test` — PASS 72/72 (Developer).
- `rtk npx playwright test tests/e2e/lessons-05-annotations/annotations.spec.js --workers=1` — PASS 1/1 focused E2E (Test Developer).
- `rtk npm run test:e2e` — PASS 14/14 full suite (Test Developer).
- `rtk node --test tests/test_lesson_room.cjs` — PASS 15/15 (Reviewer independently re-ran).
- `rtk npm test` — PASS 72/72 (Reviewer independently re-ran).
- 12 E2E screenshots at `.opencode/pipeline/lessons-05-annotations/e2e/`.
- `rtk git.exe diff --check` — OK (CRLF warnings only, pre-existing checkout behavior).

## Review
PASS (Reviewer deep read-only, no blockers). All BRIEF §12.5 task05 E2E checkpoints verified:
1. Instructor highlights at 1920×1080; students at 1366×768 and 110% zoom see identical string — PASS
2. Strikethrough: cross-viewport string and live reception — PASS
3. Pen strokes and laser appear live — PASS
4. Follow me scrolls long passage — PASS
5. Reconnecting student sees highlights, strike, ink — PASS
6. Students cannot draw on shared layer — PASS
7. Targeted erase and clear-all — PASS

## Nonblocking review notes (Reviewer caveats)
- **Server anchor bounds permissive HTML-length vs decoded text**: server bound is a loose upper bound (exactness is client/renderer-side, verified by E2E string compare); client validates; no observed break.
- **Choice anchor `c:[A-D]`**: SAT-shaped (4-choice items only); longer choice sets not anchored (documented limitation).
- **Laser throttle shared across admin tabs**: single throttle rate applies to all open instructor tabs; not per-tab.
- Local-only E2E, no deployed/physical-device test, no commit/push/deploy/remote writes.

## Deviations from spec/BRIEF
None. Strikethrough was user-requested addition explicitly allowed by the task gate.

## Limits
Local-only browser validation; no production/real-device claim. Practice-bank G1-A exception: `/api/questions` answer exposure remains approved exception; lesson-channel secrecy assertions limited to lesson channels only. No production D1 migration applied. Screenshots gitignored, local only. Pen geometry is card-relative (spec tradeoff — strokes approximate across layouts, text ops are exact). `c:[A-D]` limits choice anchors to 4-choice items. Server anchor bound is a loose upper bound.

## Caveats / next session
- **STOP now for user validation** before task06. No task06 (Desmos), task07 (self-paced), or task09 (history) started.
- No commit, push, deploy, or remote data mutation without explicit user authorization.
- Real Chromebook testing remains pending (carried from task04 user STOP).
- Local E2E only; no production D1 migration applied.
- Local self-signed TLS generates noisy `SSLV3_ALERT_CERTIFICATE_UNKNOWN` workerd log lines during teardown; test results pass.

## App repairs (task05 E2E discovered)
- **Missing static allowlist entry**: `/shared/annotations.js` 404 under Worker static allowlist — fresh Developer updated `src/index.js` + `tests/test_admin.cjs`.

## Test repairs
- Task05 focused spec initial failures corrected in spec only (sort order, reconnect join, expected array order). No app changes from test fixes.
