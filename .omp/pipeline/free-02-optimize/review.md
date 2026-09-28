# free-02 review

Diff reviewed: `git diff claude/free-01-measure...claude/free-02-optimize` (src/index.js, public/shared/stats.js, src/budget-probe.js, tests/test_free_budget.cjs, tools/budget_{bench,cpu,measure,report}.cjs, docs/perf/*).

## Round 1 — findings (listed before fixing)
1. (minor, fixed) Students list used `stale.includes()` inside loops — O(n²) at the 500-student ceiling. Now a Set.
2. (docs, fixed) Deletion of an existing question behaves like an in-place edit (visible when the 1-hour entry expires; the builder rebuilds at once if a page row is missing). Comments and report said "edit" only.
3. (limitation, documented) The stats stamp and the two-minute settle rule use the attempt `ts`, which comes from the student's clock. A device clock running behind that student's earlier attempts leaves their admin entry in place until it expires (1 h). Exact alternatives need an index (user_id, id) on attempts (+1 row written per attempt); left as is.

## Round 1 — verdict: PASS (after fixes 1–2; unit 112/112, e2e 31/31, bench identical)

Brief §6:
- (a) No feature or UI change. Every optimized route's body is byte-identical to free-01 (bench, 15 variants; unit tests vs the pre-change computation). Freshness: new questions, lesson usage and every new attempt move the cache keys at once; in-place question edits/deletions and the clock-skew case above show within 1 hour (documented in code and report; PR manual check).
- (b) Inert in production: no new flags. `BUDGET_TRACE`/probe gating unchanged; `tests/test_budget.cjs` still passes; the new probe kinds live in `src/budget-probe.js`, reachable only through `src/index.e2e.js` with `E2E_TEST_MODE=1`, `BUDGET_PROBE=1` and the probe DO binding.
- (c) Cached content: `/api/questions` body is identical for every signed-in user (whole bank + global usedInLesson, already sent to every student), cached only after the membership checks, and still sent `private, no-store`. Admin stats entries are opened only after the admin role check (test: a student's 403 touches no cache). Named caches with `.internal` keys; nothing reachable by URL. No lesson payload is cached.
- (d) No duplicated stat logic: the Worker calls the same `breakdown`/`normalizeQuestion`/`direction`; the only stats-module change is two exact fast paths shared with the client. No new D1 writes on any path.
- (e) Report numbers labelled [staging], [staging, untraced], [local], [local-node], [est], [doc].
- (f) Staging 2026-09-27: 8,105 rows written (8.1%), 415,422 rows read (8.3%), 776 requests (0.8%) — Cloudflare analytics; logged in state.md and the report.
- (g) No `.skip`/`.only`, loosened assertions or budget constants.

Task items:
- Targets: daily ≤ 50% met (26.2% worst); ≤ 35 queries met (26); ≤ 7 ms CPU met for cached/memoized requests (median and p90), not for rebuild invocations — reported as open with options (hard stop per brief §3: the fix changes architecture).
- Every `batch()` ≤ 10 s: met locally; staging self-paced run pending (2026-09-28).

## Round 2 — option A (admin stats fan-out) — verdict: PASS
Diff: `src/index.js` (`listRows`, `staleRows`, `adminStats` entrypoint, `leanBank(env, ids)`), `src/index.e2e.js` (re-export), `ADMIN_STATS` in `wrangler.toml` (production + staging) and both local e2e configs, `tests/test_free_budget.cjs` (+2), `tests/test_admin.cjs` (AI_DB stub gains `bind`), `tools/budget_bench.cjs` (per-call timing, recompute row), report.

Brief §6:
- (a) No feature change: list and detail bodies byte-identical to the pre-change code (bench, 15 variants) and fan-out ≡ inline (bench dump diff); unit test pins fan-out rows to the whole-bank reference. Failure mode unchanged: any error → catch-all 503, nothing partial cached.
- (b) Inert in production: `adminStats` traces through `traceEnv`, a no-op unless `BUDGET_TRACE=1`; no new flags.
- (c) Cache contents unchanged (same rows, same admin-only named cache, written only by the route after the admin check). The entrypoint is binding-only (named entrypoints get no public traffic) and validates its body.
- (d) Stat logic moved, not copied: `listRows` holds the only copy of the list-row derivation and calls the shared `breakdown`. No D1 writes.
- (e) New numbers labelled [local-node], [local], [local] × model; staging confirmation pending and labelled so.
- (f) No staging usage in this round (deploy + measurement scheduled 2026-09-28 00:10Z).
- (g) No skips or loosened assertions; the `test_admin.cjs` stub change adds `bind` so the fake matches D1's API.

Checked adversarially:
- Stamp read before the calls, as before the change: an attempt landing mid-recompute leaves the entry unsettled or stamped older, so the next view recomputes. Same race window as round 1.
- `json_each` has its own `id` column: the join aliases the array (`value AS wanted`) so `id` binds to `questions`. Rows billed: 569 core + 331 AI for a 300-question student vs 869 + 631 with `IN (SELECT …)` [local, scratch Worker].
- Subrequests: ≤ 30 binding calls + cache match/put + identity fetch, under Free's 50 per invocation.
- Club > 30: ⌈n/30⌉ students per call, ≤ 17 for the 500-student ceiling, within the entrypoint's 50-ID check.
- Student detail not fanned out (one student, whole bank); reported as still over 7 ms and not growing with the club.
