Task: free-02-optimize
Branch: claude/free-02-optimize   Base: claude/free-01-measure (PR #8 open, stacked)
Last completed step: 8 (docs/handoff)   Commit: ee0dde7
Next step: 9 — push and open PR "free-02: optimize" (body .omp/pipeline/free-02-optimize/pr.md); then HARD STOP for the rebuild-invocation decision (A/B/C). 2026-09-28 00:10Z: staging day 2 (history load + self-paced ★ + admin recompute) appended to the free-02 report/PR.
Open blockers: decision needed — CPU of rebuild invocations (admin stats recompute grows with history); options in docs/perf/free-plan-budget.md "Open: rebuild invocations"
Decisions made this task: stacked on free-01; Cache API for /api/questions and admin stats (1 h TTL for in-place edits); per-isolate memos keyed by max rowid; stats stamp = latest attempt time (batched index seek) with a 2-minute settle; json_remove not json_each (row billing); ID reads ≤ 50 params
Staging quota used today: 2026-09-27 8,105 rows written / 415,422 rows read / 776 requests (Cloudflare analytics; 8.1% / 8.3% / 0.8%)
Instructions: docs/perf/FREE-PLAN-BRIEF.md — re-read §0–§7

## Log
- 2026-09-27 17:40Z: baseline bench [local-node]: /api/questions 185 ms, admin questions 115–134 ms, admin students 3,061 ms, admin detail 125 ms.
- 2026-09-27 ~19:30Z: all optimizations in; unit 112/112, e2e 31/31 (x2), bench identical; staging untraced CPU sampled; report updated; review round 1 PASS.
