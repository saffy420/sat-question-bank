Stacked on [#8](https://github.com/saffy420/sat-question-bank/pull/8) (free-01). Optimizations from the free-01 ranked list; no feature change (brief: `docs/perf/FREE-PLAN-BRIEF.md` §5 free-02).

## Summary
- **Admin stats** read only what the shared stats use (no HTML; `json_remove`, since D1 bills every `json_each` row as a row read). The students list computes each student over the questions they touched and reads progress and attempts once for the roster. The Mistakes tab reads full rows only for its questions.
- **Exact fast paths** in `public/shared/stats.js` (`demoji`, `normalizeQuestion`), shared with the client.
- **`/api/questions`** is cached whole in the Cache API, after the membership checks. Its key is both banks' and the usage table's max rowid, with a 1 h expiry. Clients still get `private, no-store`.
- **Per-student admin stats cache.** The stamp is the latest attempt time: one index seek per student, batched. An entry isn't kept within 2 min of a new attempt.
- **Builder search** keeps a pre-sorted index per isolate and narrows search in SQL (a proven superset, then the unchanged exact test). The usage map and lean bank are also memoized per isolate.
- **ID reads** bind at most 50 parameters.

## Before → after
| | free-01 | free-02 |
|---|---|---|
| CPU `/api/questions` | 114 ms | median 2 ms cached; about 172 ms to rebuild |
| CPU builder search | 59–114 ms | median 3–5 ms, p90 5–7 ms; first request per isolate 33–58 ms |
| CPU admin students list | **killed** (235 ms) | median 4 ms, p90 5 ms cached; recompute 38–46 ms |
| CPU admin student detail | **killed** | median 4 ms cached; recompute 18–35 ms |
| D1 queries, worst invocation | 65 | 26 |
| Heavy day, D1 rows read | 34.9% | 26.2% |
| Other daily caps | ≤ 15.8% | unchanged |

CPU figures are [staging, untraced] (the same code path as production) or [staging]; D1 figures are [local]. Full table: `docs/perf/free-plan-budget.md`, section "free-02: before and after".

## Targets
- Daily totals ≤ 50%: **met** (26.2%).
- ≤ 35 queries per invocation: **met** (26).
- `batch()` ≤ 10 s: **met locally** (under 1 s). The staging run is on 2026-09-28 because of the 10% rule.
- ≤ 7 ms CPU: **met for cached and memoized requests** (median and p90). **Not met for the invocations that rebuild them.** The admin stats recompute grows with history: 95–260 ms for 30 students × 400 attempts. There are three options (fan-out through a self service binding, a DO alarm, or accept for now). They are in the report under "Open: rebuild invocations" and **need a decision**.

## Links
- Spec: `.omp/pipeline/free-02-optimize/spec.md`
- E2E: `.omp/pipeline/free-02-optimize/e2e.md` — **31/31** twice. Every optimized route's response is byte-identical to free-01, cached or not (15 variants).
- Review: `.omp/pipeline/free-02-optimize/review.md` — **PASS** after round 1.
- Handoff: `.omp/pipeline/free-02-optimize/handoff.md`

## Deviations
- In-place edits or deletions of questions show within 1 hour. A question added, a lesson ending, or a new attempt shows at once.
- A student whose device clock runs behind their own earlier attempts can see stale admin stats for up to 1 hour.
- Staging usage 2026-09-27 (Cloudflare analytics): 8,105 rows written (8.1%), 415,422 rows read (8.3%), 776 requests (0.8%).

## Manual check before merge
- [ ] Check the D1 dashboard's daily row metrics for a week after merging.
- [ ] Confirm the staging Worker `roadto1600-staging` is gone (deleted at the end of free-03).
- [ ] After deploying, edit a question in place and check it appears within an hour. To show it at once, bump `BANK_CACHE` `v1` → `v2` in `src/index.js`.
- [ ] Load the admin dashboard right after a club session. The first load recomputes everyone; a 503 there is the open CPU item.
- [ ] Decide A / B / C for the rebuild invocations (report, "Open: rebuild invocations").

🤖 Generated with [Claude Code](https://claude.com/claude-code)

https://claude.ai/code/session_017wYNUgoaRnF6osh29dh1e5
