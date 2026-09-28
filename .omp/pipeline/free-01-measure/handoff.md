# free-01 handoff — measure

## Status
Complete except one staging ★ run (self-paced end at 25 × 20 on staging). It writes ~4,600 rows and would take day-1 staging usage past 10% of the write cap, so it moves to the next UTC day and is recorded as the free-02 "before" number. Review round 1 PASS. Full e2e 31/31. Unit tests pass except `tests/test_grade.cjs` (fails on `main` too: spawns Windows `git.exe`).

## Shipped
- `src/budget.js`: D1 trace wrapper at the binding (`DB`, `AI_DB`), per Worker invocation and per DO event, plus DO storage counters. Inert unless `BUDGET_TRACE=1`.
- `[env.staging]` in `wrangler.toml` (Worker `roadto1600-staging`, D1 `roadto1600-staging` + `roadto1600-staging-ai`); staging sign-in gated by `STAGING_TEST_TOKEN`, HMAC-signed stateless test tokens.
- `src/budget-probe.js`: limit probes (staging only).
- `tools/budget_seed.cjs`, `tools/budget_measure.cjs`, `tools/budget_report.cjs`: synthetic club seed, flow driver (local + staging), report generator.
- `docs/perf/free-plan-budget.md`: verified limits, batch semantics, per-flow table, daily model (one config block), ranked problems.

## Measured findings
- Verified limits differ from the brief: **1,000** D1 queries per invocation (not 50); a `batch()` counts as **one** query; each DO event and alarm gets a fresh budget; 10 ms CPU is enforced with a burst allowance.
- Heavy day: every daily cap ≤ 34.9% (rows read highest). Worst invocation 65 queries (6.5%).
- Over threshold: CPU. Admin students list 235 ms → killed (1102); admin detail killed; `/api/questions` 114 ms and builder search 59–114 ms pass only on burst allowance [staging].

## Deviations
1. Query target measured against the verified 1,000 (user confirmed); CPU target stays ≤ 7 ms.
2. Two staging D1 databases (both schemas define `questions`).
3. Question bank is synthetic (3,000 cloned core + 400 real AI items) [est]; production reads were not allowed.
4. Staging runs split over two UTC days to keep each day < 10% of caps.

## Manual checks for you
- D1 dashboard daily row metrics for a week after merging.
- Staging Worker `roadto1600-staging` is deleted at the end of free-03.
- Open the real admin dashboard in production: if the students list intermittently 503s, that is finding #1.
