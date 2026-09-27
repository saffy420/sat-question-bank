Task: free-02-optimize
Branch: claude/free-02-optimize   Base: claude/free-01-measure (PR #8 open, stacked)
Last completed step: 9b (option A implemented, tested, reviewed; PR #9 body updated)   Commit: (this commit)
Next step: 2026-09-28 00:10Z scheduled run (trig_01G1EfDybRAgZPKzHTgvbE2Y): deploy staging with ADMIN_STATS; load .wrangler/budget-staging/budget_history.sql; node tools/budget_measure.cjs staging self-paced-end,poll-review,admin-students,admin-student-detail --warm; per-call CPU via cpu-list probe (students=1, attempts=400); node tools/budget_report.cjs; update report, usage log (< 10% caps), PR #9. Then CHECKPOINT → free-03.
Open blockers: none (staging confirmation of per-call CPU pending)
Decisions made this task: stacked on free-01; Cache API for /api/questions and admin stats (1 h TTL for in-place edits); per-isolate memos keyed by max rowid; stats stamp = latest attempt time (batched index seek) with a 2-minute settle; json_remove not json_each (row billing); ID reads ≤ 50 params; rebuild invocations: user chose A (2026-09-27) — ADMIN_STATS self service binding, ≤ 30 calls per recompute, touched questions via json_each JOIN (billed once)
Staging quota used today: 2026-09-27 8,105 rows written / 415,422 rows read / 776 requests (Cloudflare analytics; 8.1% / 8.3% / 0.8%); none added by option A work
Instructions: docs/perf/FREE-PLAN-BRIEF.md — re-read §0–§7

## Log
- 2026-09-27 17:40Z: baseline bench [local-node]: /api/questions 185 ms, admin questions 115–134 ms, admin students 3,061 ms, admin detail 125 ms.
- 2026-09-27 ~19:30Z: all optimizations in; unit 112/112, e2e 31/31 (x2), bench identical; staging untraced CPU sampled; report updated; review round 1 PASS.
- 2026-09-27 ~20:00Z: option A in (fan-out via ADMIN_STATS); unit 114/114; e2e A1 31/31, A2 30/31 (Desmos substring, analysed in e2e.md), A3 31/31; bench identical; review round 2 PASS; heavy day rows read 31.6%.
