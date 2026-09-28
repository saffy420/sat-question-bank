Measurement only — no optimizations, no feature change (brief: `docs/perf/FREE-PLAN-BRIEF.md` §4, §5 free-01).

## Summary
- **D1 trace wrapper** (`src/budget.js`) at the binding for every Worker invocation and DO event, counting queries, batches, statements per batch, rows read/written, and DO storage ops. Active only with `BUDGET_TRACE=1`.
- **Staging** `[env.staging]` (Worker `roadto1600-staging`, own D1s), test sign-in gated by `STAGING_TEST_TOKEN`; limit probes in `src/budget-probe.js`.
- **Tools**: `budget_seed.cjs` (synthetic club), `budget_measure.cjs` (drives every flow locally and on staging), `budget_report.cjs`.
- **Report**: `docs/perf/free-plan-budget.md`.

## Findings
| | Result |
|---|---|
| D1 queries / invocation | **1,000** verified on staging (brief said 50); Worker and DO alike |
| `batch()` | counts as **1** query (1,500-statement batch ok, ~180 ms) [staging] |
| DO alarms / events | each gets a fresh query budget [staging] |
| CPU 10 ms | enforced with burst allowance: admin students list 235 ms → **killed (1102)**; admin detail killed; `/api/questions` 114 ms [staging] |
| Heavy day, worst daily cap | D1 rows read 34.9% [local × model] |
| Worst invocation | 65 queries (admin students list) |

Ranked problems: #1 CPU on admin stat routes (over), #2 CPU on whole-bank reads (over); rows read/written, per-invocation queries and DO caps below threshold.

## Links
- Spec: `.omp/pipeline/free-01-measure/spec.md`
- E2E: `.omp/pipeline/free-01-measure/e2e.md` — full suite **31/31** (one pre-existing lessons-09 race fixed in a test-only commit)
- Review: `.omp/pipeline/free-01-measure/review.md` — **PASS**
- Handoff: `.omp/pipeline/free-01-measure/handoff.md`

## Deviations
- Query target uses the verified 1,000/invocation (confirmed with owner); CPU target stays ≤ 7 ms.
- Question bank on staging/local is synthetic [est]; production was not read or load-tested.
- The staging self-paced ★ run (≈4.6k rows written) moves to the next UTC day to keep staging < 10% of the daily write cap; it is recorded in free-02 as the "before" number.
- Staging usage 2026-09-27: ~8,102 rows written (8.1%), ~70k rows read (1.4%), ~400 requests (0.4%).

## Manual check before merge
- [ ] Check the D1 dashboard's daily row metrics for a week after merging.
- [ ] Confirm the staging Worker `roadto1600-staging` is gone (deleted at the end of free-03).
- [ ] Production config carries no `BUDGET_TRACE` / `BUDGET_PROBE` / `STAGING_TEST_TOKEN` (`tests/test_budget.cjs` asserts it).
- [ ] Open the production admin dashboard: an intermittent 503 on the students list is finding #1.

🤖 Generated with [Claude Code](https://claude.com/claude-code)

https://claude.ai/code/session_017wYNUgoaRnF6osh29dh1e5
