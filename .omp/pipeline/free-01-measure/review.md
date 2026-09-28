# free-01 review

Diff reviewed: `git diff main...claude/free-01-measure` (app code: src/index.js, src/lesson-room.js, src/index.e2e.js, src/budget.js, src/budget-probe.js; config: wrangler.toml; tools + tests + docs).

## Round 1 — PASS

Brief §6:
- (a) No feature/UI change. Production `fetch` still calls `handleRequest(req, env)` with the same env object when `BUDGET_TRACE` is not `'1'` (`traceEnv` returns it untouched; `withTrace` returns the same Response). `LessonRoom` is now a pass-through subclass; each event calls the original method with the original arguments when tracing is off. Unit tests (test_lesson_room, test_lesson_history) and the full e2e suite exercise the room through it.
- (b) Inert in production: `tests/test_budget.cjs` asserts that top-level `wrangler.toml` [vars] and both e2e configs carry no BUDGET_TRACE / BUDGET_PROBE / STAGING_TEST_TOKEN, that `src/index.js` never sets them and never imports the probe, and that the production worker answers the probe path 404 with no trace header. The staging gate and signed tokens exist only in `src/index.e2e.js`, which production does not import (existing bundle test in test_e2e_auth.cjs). The staging gate requires a ≥ 32-char secret, compared in constant time; without it nothing off loopback is served (tested).
- (c) Nothing is cached; no response gained content (the trace header carries counts only, and only on staging/local).
- (d) No stat logic touched; no new D1 writes on app paths (the probe writes only to `budget_probe` on staging).
- (e) Every number in the report is labelled [local] / [staging] / [est] / [doc].
- (f) Staging usage 2026-09-27: ~8,102 rows written (8.1%), ~70k rows read (1.4%), ~400 Worker requests (0.4%) — logged in state.md and the report.
- (g) No skips, `.only`, loosened assertions or budget constants.

Task items:
- Wrapper sits at the binding (env.DB / env.AI_DB) for the Worker entry points and per DO event; no call site is instrumented individually.
- `first()` served from `all()` preserves D1 semantics (null on no rows; D1_COLUMN_NOTFOUND on a missing column) — workerd's own `first()` also runs the full query, so counts are unchanged.
- Known limitation, documented in src/budget.js: D1 work from two interleaved events on one DO object is attributed to the later event.

Notes (not blockers):
- `tests/test_grade.cjs` fails on main and on this branch in Linux (spawns Windows `git.exe`); pre-existing and environmental.
- `docs/perf/budget-local.json` is 1.3 MB of raw traces; kept as the evidence the report and the free-03 budget tests are generated from.
