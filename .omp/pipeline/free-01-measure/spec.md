# free-01-measure — spec

Brief: docs/perf/FREE-PLAN-BRIEF.md §1, §4, §5 (free-01), §6. No optimizations.

## Deliverables
1. `src/budget.js` — D1 trace wrapper, active only when `env.BUDGET_TRACE === '1'`.
   - `traceEnv(env, label)` → `{ env, trace, done() }`; returns the *same* env object and a null trace when off.
   - Wraps every D1 binding (`DB`, `AI_DB`) at the binding: `prepare().bind().run/all/first/raw`, `batch()`, `exec()`.
     `first()` is served from `all()` (workerd's `first` runs the full query too — workerd d1-api `first()` → `_queryOrThrow`), so meta is captured.
   - Per invocation: `queries` (run/all/first/raw/exec calls), `batches`, `batchStatements[]`, `statements` (queries + Σ batch statements), `rowsRead`, `rowsWritten`, per-binding split, D1 wall ms, invocation wall ms.
   - Emits one stdout line `BUDGET_TRACE {json}` per invocation; Worker responses also carry `X-Budget-Trace` (not on 101).
   - `traceDurableObject(Class)` subclass wrapper: one trace per `fetch` / `alarm` / `webSocketMessage` / `webSocketClose` / `webSocketError` event. Caveat: D1 work interleaved across concurrent DO events is attributed to the event that started last (documented).
2. Apply at entry points only: `src/index.js` default fetch, `src/index.e2e.js` fetch, `LessonRoom` export.
3. Staging:
   - `[env.staging]` in `wrangler.toml`: name `roadto1600-staging`, `main = src/index.e2e.js`, `workers_dev = true`, no routes, D1 `roadto1600-staging` (DB) + `roadto1600-staging-ai` (AI_DB — second DB needed because both schemas define `questions`; deviation noted), vars `E2E_TEST_MODE=1`, `BUDGET_TRACE=1`, `ADMIN_EMAILS=e2e-admin@e2e.test`, `STAGING=1`; secret `STAGING_TEST_TOKEN`.
   - `src/index.e2e.js`: non-loopback hosts are allowed only when `env.STAGING_TEST_TOKEN` is set and header `X-Staging-Test-Token` matches (constant-time). Loopback behavior unchanged.
   - Probe route `/api/e2e/budget-probe` (e2e entry only, same gate): `batch` = one `batch()` of 200 inserts; `serial` = 60 separate queries, reporting where it fails; `do-*` variants run the same inside a probe DO fetch and alarm. Probe DO class `BudgetProbe` exists only in the staging env (its own migration tag under `[env.staging]`).
4. Local driver `tools/budget_measure.cjs` (+ `tools/budget_seed.cjs`): starts the e2e Worker on port 8790 with `BUDGET_TRACE=1` and separate state `.wrangler/state-budget`, seeds schema + e2e seed + a realistic question bank + 30 students with history, drives every §5 flow through Playwright (real browser, real Origin, cookie sign-in), and groups `BUDGET_TRACE` lines per flow into `docs/perf/budget-local.json`.
   Same driver runs against staging (`--target staging`), reading Worker traces from `X-Budget-Trace` and DO traces + CPU from `wrangler tail --format json`.
5. `docs/perf/free-plan-budget.md`: verified limits, batch-semantics result, per-flow table, daily model (one config block), ranked problems (>50% daily cap, >70% per-invocation limit). Every number labelled measured-local / measured-staging / estimated.

## Tests (unit, `npm test`)
- `tests/test_budget.cjs`: wrapper counts queries/batches/statements/rows with a fake D1; `first(col)` semantics preserved (null on no rows, throws on missing column); off ⇒ returns identical env object, emits nothing; production `wrangler.toml` top-level `[vars]` has no `BUDGET_TRACE`, and `src/index.js`'s production entry never enables it; staging gate rejects a missing/wrong token and non-loopback requests without a configured token.

## Review items (§6 + task)
(a) no feature/UI change; (b) BUDGET_TRACE and staging gate inert in production config, tested; (c) nothing cached; (d) no stat logic touched, no new D1 writes in app paths; (e) numbers labelled; (f) staging usage < 10% of each daily cap, logged in state.md; (g) no skips/loosened asserts.
Full e2e suite stays green.
