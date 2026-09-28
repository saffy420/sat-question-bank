Task: free-02-optimize
Branch: claude/free-02-optimize   Base: claude/free-01-measure (PR #8 open, stacked)
Last completed step: 10 (staging day 2: ADMIN_STATS deployed, self-paced write-back and admin recompute measured on staging; report + PR #9 updated)   Commit: (this commit)
Next step: none in free-02; free-03 wrap-up merges this branch (see .omp/pipeline/free-03-guardrails/state.md)
Open blockers: none
Decisions made this task: stacked on free-01; Cache API for /api/questions and admin stats (1 h TTL for in-place edits); per-isolate memos keyed by max rowid; stats stamp = latest attempt time (batched index seek) with a 2-minute settle; json_remove not json_each (row billing); ID reads ≤ 50 params; rebuild invocations: user chose A (2026-09-27) — ADMIN_STATS self service binding, ≤ 30 calls per recompute, touched questions via json_each JOIN (billed once); 400-attempt per-call CPU on staging from the in-memory probe, not a 36k-row history load (10% rule)
Staging quota used today: 2026-09-27 8,105 rows written / 415,422 rows read / 776 requests (8.1% / 8.3% / 0.8%); 2026-09-28 8,532 rows written / ~22,100 rows read / ~2,060 requests incl. DO (8.5% / ≤ 0.5% / ≤ 2.1%)
Instructions: docs/perf/FREE-PLAN-BRIEF.md — re-read §0–§7

## Log
- 2026-09-27 17:40Z: baseline bench [local-node]: /api/questions 185 ms, admin questions 115–134 ms, admin students 3,061 ms, admin detail 125 ms.
- 2026-09-27 ~19:30Z: all optimizations in; unit 112/112, e2e 31/31 (x2), bench identical; staging untraced CPU sampled; report updated; review round 1 PASS.
- 2026-09-27 ~20:00Z: option A in (fan-out via ADMIN_STATS); unit 114/114; e2e A1 31/31, A2 30/31 (Desmos substring, analysed in e2e.md), A3 31/31; bench identical; review round 2 PASS; heavy day rows read 31.6%.
- 2026-09-28 00:12–00:20Z: staging deploy lists env.ADMIN_STATS (roadto1600-staging#adminStats); history loaded (1,501 rows); self-paced 25 × 20 write-back landed whole on staging (500 responses, ended), D1 SQL time ~0.1 s [D1 analytics]; admin recompute: 25 calls median 2 / p90 5 / max 8 ms CPU, route 17 ms [traced]; probe at 400 attempts per call median 3.5 / p90 7 / max 9 ms net; wrangler tail sampled the first run (no submitAll events), admin-students rerun captured all 26.
