Task: free-03-guardrails
Branch: claude/free-03-guardrails   Base: claude/free-02-optimize (PR #9, stacked on #8)
Last completed step: 10 (free-02 merged in, npm test 143/143, staging Worker deleted)   Commit: (this commit)
Next step: none — free-03 done; the owner runs the manual checks on PRs #8, #9, #10 and merges #8 → #9 → #10
Open blockers: none
Decisions made this task: failure classes from Cloudflare's documented messages (research.md); quota retry = backoff capped 1 h and never later than 00:01 UTC; overload 5 s doubling to 5 min; other errors back off like overload; per-student chunks ≤ 500 statements with a done-set in DO storage; LessonSync registry DO (no D1) for the admin banner; fault flag D1_FAULT_INJECTION local-only, in-memory fault per room; budget constants = post-free-02 full local run + 20% rounded down (self-paced batch pinned at chunked 488); queries per invocation counts batches as one query; staging D1 databases kept (brief default), staging Worker deleted
Staging quota used today: 2026-09-28 8,532 rows written / ~22,100 rows read / ~2,060 requests incl. DO (free-02 day 2; 8.5% / ≤ 0.5% / ≤ 2.1%); free-03 none
Instructions: docs/perf/FREE-PLAN-BRIEF.md — re-read §0–§7

## Log
- 2026-09-27 ~20:00Z: branch created from free-02 (f1ebb96). Research: D1 error strings (research.md).
- 2026-09-27 ~20:30Z: free-02 baseline, 3 full local runs (worktree at f1ebb96): identical numbers. The committed budget-local.json mixes partial runs (my-lessons 25 vs 28 queries in a full run).
- 2026-09-27 ~21:10Z: unit 123/123 (git.exe shim); test_budget_flows 17/17 in ~2 min; deliberate regression (unchunked + extra scan) fails 4 tests as expected, reverted.
- 2026-09-27 ~22:00Z: review fixes (flush guard, backoff) 76627f2; unit 143/143; Playwright 33/33 ×2; report regenerated from one full run; PR opened.
- 2026-09-28 ~00:23Z: merged claude/free-02-optimize (staging day 2) — conflict in the report resolved (free-03 local tables + free-02 staging rows), report regenerated; npm test 143/143 incl. budget flows.
- 2026-09-28 00:24Z: staging Worker roadto1600-staging deleted; API 10007 "does not exist", workers.dev 404, only `sat-question-bank` remains. Staging D1 databases kept.
