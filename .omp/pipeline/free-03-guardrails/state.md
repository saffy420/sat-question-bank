Task: free-03-guardrails
Branch: claude/free-03-guardrails   Base: claude/free-02-optimize (PR #9, stacked on #8)
Last completed step: 9 (PR opened)   Commit: (this commit)
Next step: after the 2026-09-28 00:10Z free-02 staging run: merge claude/free-02-optimize into this branch, rerun npm test, delete the staging Worker (npx wrangler delete --env staging), record it in the PR and the report, then CHECKPOINT free-03.
Open blockers: none
Decisions made this task: failure classes from Cloudflare's documented messages (research.md); quota retry = backoff capped 1 h and never later than 00:01 UTC; overload 5 s doubling to 5 min; other errors unchanged 5 s; per-student chunks ≤ 500 statements with a done-set in DO storage; LessonSync registry DO (no D1) for the admin banner; fault flag D1_FAULT_INJECTION local-only, in-memory fault per room; budget constants = post-free-02 full local run + 20% rounded down (self-paced batch pinned at chunked 488); queries per invocation counts batches as one query.
Staging quota used today: 2026-09-27 8,105 rows written / 415,422 rows read / 776 requests (free-01/02); free-03 none so far
Instructions: docs/perf/FREE-PLAN-BRIEF.md — re-read §0–§7

Pending outside this task: 2026-09-28 00:10Z scheduled free-02 staging run (trig_01G1EfDybRAgZPKzHTgvbE2Y) works on claude/free-02-optimize; merge free-02 into this branch afterwards. Delete the staging Worker only after that run.

## Log
- 2026-09-27 ~20:00Z: branch created from free-02 (f1ebb96). Research: D1 error strings (research.md).
- 2026-09-27 ~20:30Z: free-02 baseline, 3 full local runs (worktree at f1ebb96): identical numbers. The committed budget-local.json mixes partial runs (my-lessons 25 vs 28 queries in a full run).
- 2026-09-27 ~21:10Z: unit 123/123 (git.exe shim); test_budget_flows 17/17 in ~2 min; deliberate regression (unchunked + extra scan) fails 4 tests as expected, reverted.
- 2026-09-27 ~22:00Z: review fixes (flush guard, backoff) 76627f2; unit 143/143; Playwright 33/33 ×2; report regenerated from one full run; PR opened.
