Task: free-01-measure
Branch: claude/free-01-measure   Base: main (all lessons-* PRs merged; no claude/lessons-* branches remain on origin)
Last completed step: 4 (implement, partial: trace wrapper + staging + batch probe done; local flow driver not started)   Commit: see git log
Next step: after the user answers the hard stop — write tools/budget_seed.cjs + tools/budget_measure.cjs (local, port 8790, .wrangler/state-budget), measure every §5 flow locally, then ★ flows on staging, then fill docs/perf/free-plan-budget.md
Open blockers: HARD STOP — (1) verified limits contradict brief §1: D1 per-invocation ceiling is 1,000 (not 50), batch counts once, 10 ms CPU not enforced at 21–380 ms; free-02 targets need the user's call. (2) Production reads (question-bank size/copy) were denied by the session's permission classifier; need the user to allow them or supply the bank size.
Decisions made this task: base = main; staging uses two D1 DBs (roadto1600-staging + roadto1600-staging-ai) because both schemas define `questions`; staging entry = src/index.e2e.js behind X-Staging-Test-Token; BudgetProbe DO exists only in [env.staging]; token kept in ignored .e2e.staging.env
Staging quota used today: 2026-09-27 ~252 rows written / ~122 rows read / ~30 requests (GraphQL d1AnalyticsAdaptiveGroups + workersInvocationsAdaptive)
Instructions: docs/perf/FREE-PLAN-BRIEF.md — re-read §0–§7

## Staging resources (delete Worker at end of free-03)
- Worker roadto1600-staging → https://roadto1600-staging.sat-question-bank-leon.workers.dev
- D1 roadto1600-staging ddf84754-c66a-4d6b-9f67-2042408556b3; roadto1600-staging-ai 7b006611-ec20-40c5-8c4e-07aba4d3992a
- Secret STAGING_TEST_TOKEN (value in .e2e.staging.env, gitignored)

## Log
- 2026-09-27: brief saved; env vars were missing → hard stop; user added them; verified token, workers.dev and GraphQL reachable.
- 2026-09-27: research.md, spec.md; src/budget.js + tests/test_budget.cjs (6 pass). npm test: test_grade.cjs fails on main too (spawns Windows git.exe) — pre-existing, environmental.
- 2026-09-27: staging created and seeded; probes: 1,000-query ceiling (Worker and DO), batch = 1 query, alarms fresh, DO own budget, 1,500-stmt batch ~180 ms, CPU 21–380 ms all ok.
