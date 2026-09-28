# free-02-optimize — spec

Brief: docs/perf/FREE-PLAN-BRIEF.md §2, §5 free-02, §6. Base: claude/free-01-measure (stacked; PR #8 open).

## Targets (heavy-day model, report config block)
- every daily total ≤ 50% of its cap — already met in free-01 (worst: D1 rows read 34.9%); keep it met;
- every invocation ≤ 35 D1 queries (worst today: admin students list, 65) and ≤ 7 ms CPU (★ flows measured on staging);
- every `batch()` ≤ 10 s measured (self-paced end: 1.3 s local; staging run on the next UTC day).

## Ranked problems (from free-01) and planned levers
1. **Admin students list** (killed, 235 ms staging; 65 queries).
   - Lean question input: stats need id/section/domain/skill/difficulty/level/source + choice letter/trap + answer, not stem/explanation/choice HTML. Choices reduced in SQL with json_each (same `normalizeQuestion` still runs on what comes back). Explanation fetched only for the rare grid-in whose answer normalizes to empty (the only case `normalizeQuestion` reads it).
   - Only the questions the listed students touched: `breakdown()` walks the bank only to count per-skill totals (`n`) that the list never shows; every field the list shows is keyed by progress/attempt question IDs, so the same `breakdown()` over the touched subset gives identical values. Proved by a unit test comparing old vs new output.
   - One roster query for progress and one for attempts (grouped in JS) instead of 2 per student; list attempts omit `answer_history_json` (only `direction()` reads it, and the list does not use directions).
2. **Admin student detail** (killed after the list). Same lean bank (full bank rows needed only for the Mistakes tab questions: fetched by ID). `tally().n` counts need the whole bank's taxonomy, so the lean read stays whole-bank.
3. **Whole-bank reads**: `/api/questions` (114 ms) — the response is identical for every signed-in user (whole bank + global usedInLesson), so it is cached whole in a named Cache API cache after auth. Key = code version + both banks' max rowid + a usage stamp, so a new question or a lesson ending changes the key; content edits (UPDATE) show within the entry's TTL (1 h). The client response keeps `private, no-store`. Nothing is added to what a student already receives (§2 rule 1(5)); no lesson payload is involved. On workers.dev the Cache API is a no-op (hits can only be proved on the custom domain: CPU of a hit measured on staging via an equivalent pass-through probe, labelled as a proxy).
   `/api/admin/questions` (59–114 ms): filter and sort on the lean rows; fetch full rows only for the 25-row page; search reads stem_html (the only extra column it needs).
4. Rows read / written, queries per invocation, DO caps: below threshold. Opportunistic only if a lever above already touches them; no new indexes unless a target needs one.
5. DO: confirm hibernation (`acceptWebSocket`) and throttles from the free-01 traces; no change expected.

## Tests
- Unit: old-vs-new equivalence for admin students list and detail on a fixture with MC, grid-in (incl. empty-answer grid-in that needs the explanation), AI rows, traps and unknown-question attempts; `/api/questions` cache: second request served from cache with identical body, key changes when usage or bank changes, 401/403 still before cache; `/api/admin/questions` output unchanged for every filter/usage/search combination on the fixture.
- Full e2e suite green. `tests/test_budget.cjs` still proves trace flags inert.
- Bench: `tools/budget_bench.cjs` (Node, [local-node]) before/after; staging CPU for ★ flows.

## Review items
§6 (a)–(g); plus: stats module unchanged or changed only in shared code used by both client and Worker; cache key cannot collide across bank/usage states; no user-specific data enters the cache.

## Addendum 2026-09-27 — rebuild invocations, option A (owner's decision)
- `/api/admin/students` sends stale students to the `adminStats` named entrypoint through an `ADMIN_STATS` self service binding (`wrangler.toml` production + staging, both local e2e configs). At most 30 calls per view (`FANOUT`), ⌈stale / 30⌉ students each; each call is its own invocation and CPU budget.
- A call reads that group's progress and attempts, then only their touched questions (`leanBank(env, ids)`: one JSON-array parameter, `json_each` joined so D1 bills it once), and runs the unchanged `breakdown` via `listRows`. The route keeps roster, stamps, stats cache and sort. No binding (Node tests, tools) → same `listRows` inline.
- A failed call fails the request (503 via the catch-all); nothing partial is cached. The entrypoint validates its body (≤ 50 string IDs, string bank key) and is unreachable from the internet (named entrypoints are binding-only). Trace: `traceEnv` label `admin-stats chunk`, inert unless `BUDGET_TRACE=1`.
- Success: list/detail bodies byte-identical (bench vs pre-change code, fan-out vs inline); unit test for fan-out equivalence, per-student calls, no recompute when held, failure → rejection, entrypoint validation; e2e 31/31 with the binding live under `wrangler dev`; per-call CPU median/p90 ≤ 7 ms [local-node], confirmed on staging with the 400-attempt history (2026-09-28 run).
- Student detail is not fanned out: it is one student over the whole bank, and stays as reported.
