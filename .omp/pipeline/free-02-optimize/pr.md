Stacked on [#8](https://github.com/saffy420/sat-question-bank/pull/8) (free-01). Optimizations from the free-01 ranked list; no feature change (brief: `docs/perf/FREE-PLAN-BRIEF.md` §5 free-02).

## Summary
- **Admin stats** read only what the shared stats use (no HTML; `json_remove`, since D1 bills every `json_each` row as a row read). The students list computes each student over the questions they touched and reads progress and attempts once for the roster. The Mistakes tab reads full rows only for its questions.
- **Exact fast paths** in `public/shared/stats.js` (`demoji`, `normalizeQuestion`), shared with the client.
- **`/api/questions`** is cached whole in the Cache API, after the membership checks. Its key is both banks' and the usage table's max rowid, with a 1 h expiry. Clients still get `private, no-store`.
- **Per-student admin stats cache.** The stamp is the latest attempt time: one index seek per student, batched. An entry isn't kept within 2 min of a new attempt.
- **Builder search** keeps a pre-sorted index per isolate and narrows search in SQL (a proven superset, then the unchanged exact test). The usage map and lean bank are also memoized per isolate.
- **ID reads** bind at most 50 parameters.
- **Admin stats recompute is fanned out (option A).** The students list sends stale students to the Worker's own `adminStats` entrypoint through a new `ADMIN_STATS` self service binding. It makes up to 30 calls, one student each for a club of 30, so each call gets its own CPU limit. Only service bindings can reach the entrypoint. A failed call returns 503 and caches nothing.

## Before → after
| | free-01 | free-02 |
|---|---|---|
| CPU `/api/questions` | 114 ms | median 2 ms cached; about 172 ms to rebuild |
| CPU builder search | 59–114 ms | median 3–5 ms, p90 5–7 ms; first request per isolate 33–58 ms |
| CPU admin students list | **killed** (235 ms) | median 4 ms, p90 5 ms cached. Full recompute at 400 attempts: route 2.5 ms, each call median 3.3 ms, p90 4.7 ms [local-node]; 83–131 ms inline |
| CPU admin student detail | **killed** | median 4 ms cached; recompute 18–35 ms |
| D1 queries, worst invocation | 65 | 26 |
| Heavy day, D1 rows read | 34.9% | 31.6% |
| Other daily caps | ≤ 15.8% | unchanged |

CPU figures are [staging, untraced] (the same code path as production) or [staging]; D1 figures are [local]. Full table: `docs/perf/free-plan-budget.md`, section "free-02: before and after".

## Targets
- Daily totals ≤ 50%: **met** (31.6%; the fan-out added 5.4 points, because each call reads its own student's questions).
- ≤ 35 queries per invocation: **met** (26).
- `batch()` ≤ 10 s: **met locally** (under 1 s). The staging run is on 2026-09-28 because of the 10% rule.
- ≤ 7 ms CPU: **met for cached and memoized requests** (median and p90), and **for the admin students recompute after the fan-out** (median and p90 [local-node]; the staging check with a 400-attempt probe is scheduled for 2026-09-28). **Still over 7 ms, and not growing with use:** the `/api/questions` rebuild (~170 ms per change), the builder index build (33–58 ms per isolate), and one student's detail recompute (18–35 ms). See the report, "Rebuild invocations".

## Links
- Spec: `.omp/pipeline/free-02-optimize/spec.md`
- E2E: `.omp/pipeline/free-02-optimize/e2e.md` — **31/31** twice before option A. With option A: 31/31, 30/31, then 31/31. The one failure was a raw `3131` substring check in the Desmos spec; free-02 doesn't touch lesson code, and the spec passed 6/6 when repeated (analysis in e2e.md). Every optimized route's response is byte-identical to free-01, cached or not (15 variants), and the fan-out matches the inline path.
- Review: `.omp/pipeline/free-02-optimize/review.md` — **PASS** after round 1 and round 2 (option A).
- Handoff: `.omp/pipeline/free-02-optimize/handoff.md`

## Deviations
- In-place edits or deletions of questions show within 1 hour. A question added, a lesson ending, or a new attempt shows at once.
- A student whose device clock runs behind their own earlier attempts can see stale admin stats for up to 1 hour.
- Adds an `ADMIN_STATS` self service binding to `wrangler.toml` (production and staging) and to both local e2e configs.
- Staging usage 2026-09-27 (Cloudflare analytics): 8,105 rows written (8.1%), 415,422 rows read (8.3%), 776 requests (0.8%).

## Manual check before merge
- [ ] Check the D1 dashboard's daily row metrics for a week after merging.
- [ ] Confirm the staging Worker `roadto1600-staging` is gone (deleted at the end of free-03).
- [ ] After deploying, edit a question in place and check it appears within an hour. To show it at once, bump `BANK_CACHE` `v1` → `v2` in `src/index.js`.
- [ ] After deploying, check that the deploy output lists the `ADMIN_STATS` binding. Then load the admin dashboard right after a club session: the first load recomputes everyone through the fan-out, and the Workers logs should show one `adminStats` invocation per student who practised.

🤖 Generated with [Claude Code](https://claude.com/claude-code)

https://claude.ai/code/session_017wYNUgoaRnF6osh29dh1e5
