Stacked on [saffy420/sat-question-bank#9](https://github.com/saffy420/sat-question-bank/pull/9) (free-02), which is stacked on [saffy420/sat-question-bank#8](https://github.com/saffy420/sat-question-bank/pull/8) (free-01). Brief: `docs/perf/FREE-PLAN-BRIEF.md` §5 free-03. Report: `docs/perf/free-plan-budget.md`, section "free-03: guardrails".

## Summary
- **Budget tests in the normal suite.** `tests/test_budget_flows.cjs` runs every measured flow once through the real Worker, Durable Objects and Miniflare D1, then checks each flow against `tests/budget_limits.cjs`: worst queries per invocation (a batch counts as one), largest batch, rows read and written, Worker requests and DO events. Each limit is the post-free-02 value + 20%, rounded down. Three full runs gave identical numbers. A deliberate regression (no chunking; one extra scan) failed 4 tests.
- **Quota-safe lesson flush.** D1 daily-limit and overload errors are recognised from Cloudflare's documented messages. Results wait in the room's storage; a daily-limit failure retries with backoff (up to 1 h) and always at 00:01 UTC; overload and other errors back off to 5 min. The self-paced write-back goes out in batches of ≤ 500 statements (whole students), landed students are recorded, every statement is idempotent, and one flush runs at a time per room.
- **Admin banner:** "Lesson results saved locally, will sync after <time>." Rooms report to a new `LessonSync` Durable Object (no D1); `GET /api/admin/lesson-sync` is admin-only. Students see nothing new.
- **Test-only fault flag** `D1_FAULT_INJECTION`: set by no config; the route works only on loopback with `E2E_TEST_MODE`, never on staging or production (tested).

## Before → after (self-paced end, 25 × 20) [local]
| | free-02 | free-03 |
|---|---|---|
| Largest batch | 1,526 | 488 (4 batches) |
| Worst D1 queries in one invocation | 26 | 29 (target ≤ 35) |
| D1 rows written | 4,542 | 4,542 |
| D1 daily-limit error mid write-back | whole write-back waits, 5 s retries forever | landed batches stay; rest waits; retries back off and run after the reset; lands once |

Heavy-day totals are unchanged by free-03. The regenerated tables come from one full run, which corrects free-02's merged partial runs: D1 rows read 32.7% (was reported as 31.6%), all caps ≤ 50%.

## Tests
- Unit: `npm test` 143/143, including budget tests 17/17 and the quota-recovery e2e: during the injected limit 160/500 rows landed; after it cleared all 500 responses and 500 attempts landed exactly once, progress moved once each.
- Unit (DO on real SQLite): chunking, retry schedule through midnight, eviction mid-retry, full replay changes nothing, concurrent flushes (fails without the guard), fault flag inert.
- Playwright: 33/33 twice, including 2 new banner specs.

## Staging
free-03 used no staging quota. The free-02 staging run is scheduled for 2026-09-28 00:10 UTC; the staging Worker `roadto1600-staging` is deleted after it (this PR will be updated to record that).

## Manual check before merge
- [ ] Merge order: #8, then #9, then this PR.
- [ ] Deploy runs the new Durable Object migration `lesson-sync-v1` (`LessonSync`); confirm `npm run deploy` succeeds.
- [ ] Admin dashboard shows no banner on a normal day.
- [ ] D1 dashboard daily row metrics (rows read / written) for a week after merging stay under 50% of the caps.
- [ ] The staging Worker `roadto1600-staging` is gone (`npx wrangler deployments list --name roadto1600-staging` fails, or the dashboard shows no such Worker). Staging D1 databases are kept unless you say otherwise.
- [ ] `npm test` locally (needs free ports 8791/9240; about two minutes longer than before).

🤖 Generated with [Claude Code](https://claude.com/claude-code)

https://claude.ai/code/session_017wYNUgoaRnF6osh29dh1e5
