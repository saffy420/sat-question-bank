# free-02 handoff — optimize

## Status
Optimizations shipped; review PASS; unit 112/112; e2e 31/31. One target is only partly met (CPU on rebuild invocations) and needs a decision — see Open.

## Shipped
- Admin stats read lean rows (no HTML; `json_remove`, not `json_each`), compute each student over the questions they touched, read progress/attempts once per roster, full rows only for Mistakes.
- Exact fast paths in `public/shared/stats.js` (`demoji`, `normalizeQuestion`).
- `/api/questions` cached whole in the Cache API after auth (key: banks' + usage max rowid; 1 h TTL).
- Per-student admin stats cache (stamp: latest attempt time, one batched index seek per student; not kept within 2 min of the latest attempt).
- Builder: per-isolate pre-sorted index, SQL-narrowed search (proven superset), memoized usage map and lean stat bank.
- ID reads bind ≤ 50 parameters.
- Tools: `budget_bench.cjs` (Node CPU proxy + response equivalence), `budget_cpu.cjs` (staging CPU sampler), `budget_measure.cjs --warm`; probe kinds `cpu-*`, `d1-all/raw`, `cache`.

## Measured
- CPU [staging, untraced], cached/memoized: `/api/questions` median 2 ms; builder median 3–5, p90 5–7; admin list median 4, p90 5; detail median 4. Before: 114 ms, 59–114 ms, killed, killed.
- Rebuilds: `/api/questions` ~172 ms; builder index 33–58 ms; admin recompute 38–46 ms on staging's small history, 95–260 ms for 30 × 400 attempts (probe).
- Heavy day D1 rows read 34.9% → 26.2%; worst queries per invocation 65 → 26.

## Open (hard stop: needs your decision)
Rebuild invocations exceed 7 ms; the admin stats recompute grows with history and can be killed once histories are long (and a killed rebuild stores nothing, so it repeats). Options A (self service binding fan-out), B (DO alarm recompute), C (accept for now) — numbers in the report, "Open: rebuild invocations".

## Pending
- 2026-09-28 staging: load history, run self-paced ★ (batch duration) and admin recompute with history; append to the report and this PR.

## Manual checks for you
- D1 dashboard daily row metrics for a week after merging.
- The staging Worker is deleted at the end of free-03.
- After deploying: edit a question in place → it shows in the app within an hour (or bump `BANK_CACHE` `v1` → `v2` in `src/index.js` to show it at once).
- Admin dashboard after a club session: first load recomputes; a 503 there is the open item.
