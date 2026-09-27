Task: free-02-optimize
Branch: claude/free-02-optimize   Base: claude/free-01-measure (PR #8 open, stacked)
Last completed step: 3 (spec)   Commit: pending
Next step: 4 implement — lean stats inputs for admin students list/detail
Open blockers: none
Decisions made this task: stacked on free-01; Cache API for /api/questions (1 h TTL for content edits); bench in Node as a ranking proxy, staging for CPU
Staging quota used today: 2026-09-27 ~8,102 rows written / ~70,000 rows read / ~400 requests (carried from free-01)
Instructions: docs/perf/FREE-PLAN-BRIEF.md — re-read §0–§7

## Log
- 2026-09-27 17:40Z: baseline bench [local-node]: /api/questions 185 ms, admin questions 115–134 ms, admin students 3,061 ms, admin detail 125 ms.
