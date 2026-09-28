# Free-plan budget: roadto1600.org

Status: **free-02 optimized** (the generated tables below are post-free-02). The free-01 baseline numbers are kept in "free-02: before and after" and in "Ranked problems (free-01 baseline)". Brief: `docs/perf/FREE-PLAN-BRIEF.md`.
Labels: **[staging]** measured on the staging Worker; **[staging, untraced]** the same with `BUDGET_TRACE` off (production's code path), sampled with `tools/budget_cpu.cjs`; **[local]** measured on local `wrangler dev` (Miniflare D1 `meta`); **[local-node]** `tools/budget_bench.cjs`, a Node proxy used only to rank changes; **[est]** estimated; **[doc]** Cloudflare docs.

Reproduce: `node tools/budget_measure.cjs local` (fresh state on :8790), then `node tools/budget_measure.cjs staging [flows]`, then `node tools/budget_report.cjs` to regenerate the tables below.

## Verified limits (2026-09-27)

| Limit | Brief §1 | Verified | Source |
|---|---|---|---|
| D1 queries per invocation (Worker) | 50 | **1,000** separate queries; query 1,001 fails with "Too many API requests by single Worker invocation" [staging] | probe `worker-ceiling` |
| D1 queries per invocation (DO fetch) | — | **1,000**, same error [staging] | probe `do-ceiling` |
| D1 queries per DO alarm | — | 60 ok in one alarm and 45 more in a chained second alarm: **each alarm is a fresh invocation** [staging] | probe `do-alarm` |
| Worker + DO in one request | — | Worker 45 + DO 45 both succeed: **the DO has its own budget** [staging] | probe `chain` |
| `batch()` counting | unknown | **One batch counts as one query.** A 200-statement batch followed by 60 separate queries succeeds, and so does a 1,500-statement batch [staging] | probes `worker-mix`, `worker-big`, `do-big` |
| Worker CPU per invocation | 10 ms | **Enforced, with burst tolerance.** Probes of 21–41 ms (and one DO event of 380 ms) passed. With the realistic bank, `/api/questions` passes at 114 ms, but `/api/admin/students` was killed at 235 ms and, right after, `/api/admin/students/:id` was killed at 10 ms: **503 "Worker exceeded resource limits"** (Error 1102, outcome `exceededCpu`) [staging] | `wrangler tail` |
| D1 rows written / day | 100,000 | 100,000, resets 00:00 UTC; errors, not billing, when exceeded [doc] | https://developers.cloudflare.com/d1/platform/pricing/ |
| D1 rows read / day | 5,000,000 | 5,000,000 [doc] | same |
| Rows written per indexed insert | "+1 per index" | Confirmed: 400 questions → 800 rows written (row + primary-key index) [staging] | seed log |
| D1 DB size / bound params / query duration | 500 MB / 100 / 30 s | 500 MB / 100 / 30 s; 10 databases per account [doc] | https://developers.cloudflare.com/d1/platform/limits/ |
| Worker requests / day | 100,000 | 100,000, Error 1027 [doc] | https://developers.cloudflare.com/workers/platform/limits/ |
| Subrequests per invocation | — | 50 (fetch) / **1,000 to internal services** [doc]; the 1,000 D1 ceiling matches this (Paid would be 10,000) | same |
| DO requests / day | not in brief | **100,000**, "Includes HTTP requests, RPC sessions, WebSocket messages, and alarm invocations"; the 20:1 WebSocket ratio is stated for billing only, so this report counts messages 1:1 [doc] | https://developers.cloudflare.com/durable-objects/platform/pricing/ |
| DO duration / day | not in brief | **13,000 GB-s** (128 MB per active object ⇒ about 28 active object-hours a day) [doc] | same |
| DO SQLite storage (KV API) | not in brief | 5 M rows read / 100,000 rows written per day; each `put()` / `delete()` / `setAlarm()` is a row written [doc] | same |
| DO storage backend on Free | — | SQLite only (the app already declares `new_sqlite_classes`) [doc] | same |

Differences from the brief's table (the verified value wins):
- **Queries per invocation: 1,000, not 50.** Cloudflare's D1 limits page still says 50 (Free). On this account (Workers Free, confirmed by the owner) the D1 binding behaves like the 1,000 internal-services subrequest limit.
- **Batch semantics: one `batch()` = one query**, so free-02 can size batches by per-statement limits and duration instead of query count.
- **CPU is the binding per-invocation limit.** Cloudflare lets short bursts over 10 ms through, then kills. Every server-side stat computation over the whole bank is over the limit (see problems).
- The brief did not list the Durable Object daily caps. They are included in the daily model.

## Batch-semantics result (drives free-02 chunking)

- One `batch()` counts once against the per-invocation query limit, whatever its statement count [staging].
- Per-statement limits still apply inside a batch: 100 bound parameters, 100 KB of SQL, and 30 s for the whole batch [doc].
- A 1,500-statement read batch took 177–187 ms [staging]. Write latency for the real self-paced flush is measured in the ★ run (see "Staging runs").
- Each DO alarm and each DO request gets a fresh 1,000-query budget [staging]. Spreading work across alarms therefore buys query headroom and CPU headroom.

## Per-flow table

<!-- per-flow:start -->
Measured [local] on 2026-09-27 with the seed in `tools/budget_seed.cjs` (3,000 core + 400 AI questions, 30 students × 400 attempts, 10 past lessons). CPU column [staging] (2026-09-28T00:17Z; staging history is smaller, see "Staging seed").

| Flow | Worker invocations | DO invocations | Worst invocation: D1 queries (batch = 1) | Largest batch (statements) | D1 rows read | D1 rows written | DO storage rows written | Max CPU per invocation |
|---|---|---|---|---|---|---|---|---|
| Student sign-in + first page load | 10 | 0 | 8 (worker GET /api/questions) | — | 10,987 | 1 | 0 | 6 ms (GET /api/notes) [staging] |
| Question bank load + filter change (builder search, 3 usage options) ★ | 4 | 0 | 9 (worker GET /api/admin/questions) | — | 3,640 | 0 | 0 | 58 ms (GET /api/admin/questions) [staging] |
| Answer one practice question | 2 | 0 | 6 (worker POST /api/attempts) | 1 | 412 | 7 | 0 | — (not a ★ flow) |
| Admin students list, 30 students ★ | 31 | 0 | 6 (worker GET /api/admin/students) | 30 | 48,154 | 0 | 0 | 17 ms (GET /api/admin/students) [staging] |
| Admin student detail, every tab ★ | 2 | 0 | 15 (worker GET /api/admin/students/e2e-budget-01) | 1 | 10,010 | 0 | 0 | 49 ms (GET /api/admin/students/e2e-budget-01) [staging] |
| Lesson builder search + save | 4 | 0 | 9 (worker GET /api/admin/questions) | 22 | 3,933 | 143 | 0 | — (not a ★ flow) |
| Instructor-paced lesson, 25 students × 20 questions | 52 | 1,677 (1,580 WS msgs) | 25 (do.fetch upgrade) | 25 | 354 | 1,136 | 2,416 | — (not a ★ flow) |
| Self-paced, 25 × 20, through end + write-back ★ | 52 | 1,702 (1,651 WS msgs) | 26 (do.webSocketMessage submitAll) | 1526 | 9,425 | 4,542 | 1,731 | 10 ms (POST /api/admin/lessons/910002/sessions) [staging] |
| Poll + review (after the self-paced set) | 0 | 58 (31 WS msgs) | 1 (do.webSocketMessage next) | 21 | 3 | 43 | 41 | 10 ms (next) [staging] |
| My Lessons list + one session | 2 | 0 | 25 (worker GET /api/lesson-history/920010) | — | 6,714 | 0 | 0 | — (not a ★ flow) |

Flow details [local]:
- Student boot: `/api/questions` reads 3,805 rows when it rebuilds the cached body (full scans of both banks + `question_lesson_usage`) and 4 when served from the cache; `/api/lesson-history` reads 6,470.
- Practice answer: 7 rows written and 412 read per Check; `POST /api/attempts` counts the student's whole log (`SELECT COUNT(*)`), so its reads grow with history.
- Admin students list: 6 queries and 48,154 rows read when every student is recomputed; 6 queries and 96 rows from the stats cache (the per-student stamps are one batch).
- Builder: create = batch of 20 + 21 statements; one autosave (PUT) writes 81 rows.
- Instructor-paced: per question the end-of-question flush writes 25 D1 rows on average; 1,580 WS messages for the lesson; 20 alarms; DO storage: get 5,122, put 1,316, setAlarm 1,040, delete 59, deleteAlarm 1.
- Self-paced end: the finishing `submitAll` runs 25 separate queries (one progress SELECT per student) + one batch of 1,526 statements, writing 4,487 rows in 945 ms [local]; DO storage: get 5,108, put 1,729, setAlarm 1, delete 1.
- My Lessons: the session view runs 25 queries (one question lookup per item); the list reads 6,470 rows.
- Largest bound-parameter count on any statement: 50 (limit 100).
<!-- per-flow:end -->

## Daily model

The heavy club day. Edit this block and rerun `node tools/budget_report.cjs`. Lesson costs scale linearly from the measured 25 × 20 run when `lessonStudents` or `lessonQuestions` change [est].

<!-- model-config -->
```json
{
  "practiceStudents": 30,
  "practiceQuestionsPerStudent": 40,
  "bootsPerStudent": 1,
  "staticAssetsPerBoot": 10,
  "figureCropsPerPracticeQuestion": 0.5,
  "adminViews": 20,
  "adminColdViews": 10,
  "bankCacheMisses": 8,
  "lessonsBuilt": 1,
  "builderSearchesPerLesson": 5,
  "builderAutosavesPerLesson": 20,
  "instructorLessons": 1,
  "selfPacedLessons": 1,
  "lessonStudents": 25,
  "lessonQuestions": 20,
  "lessonMinutes": 45,
  "myLessonsViews": 25
}
```

Assumptions [est]:
- **`staticAssetsPerBoot`:** `run_worker_first = true` sends every static file through the Worker, and each costs a Worker request.
- **`figureCropsPerPracticeQuestion`:** each `/qimg` crop also costs one D1 membership read.
- **`adminViews`:** each "dashboard view" is one students-list load plus one student detail.
- **`adminColdViews`** (free-02): views that recompute every student's stats because all of them practised since the last view; the rest are served from the stats cache. Half is a conservative guess for a club day.
- **`bankCacheMisses`** (free-02): boots that rebuild the `/api/questions` body: one per lesson that ends (usage rows change the key) plus one per hour of use as entries expire, per Cloudflare location.

<!-- daily:start -->
| Part of the day | Count | Worker requests | D1 rows read | D1 rows written | DO requests | DO storage rows written |
|---|---|---|---|---|---|---|
| Student boots, bank cache miss | 8 | 160 | 87,896 | 8 | 0 | 0 |
| Student boots, bank cache hit | 22 | 440 | 158,092 | 22 | 0 | 0 |
| Practice answers | 1,200 | 3,000 | 495,000 | 8,400 | 0 | 0 |
| Admin dashboard views (list + detail), recomputed | 10 | 330 | 581,640 | 0 | 0 | 0 |
| Admin dashboard views (list + detail), cached | 10 | 30 | 60,040 | 0 | 0 | 0 |
| Lessons built | 1 | 27 | 19,729 | 1,682 | 0 | 0 |
| Instructor-paced lessons | 1 | 52 | 354 | 1,136 | 1,677 | 2,416 |
| Self-paced lessons (+ poll/review) | 1 | 52 | 9,428 | 4,585 | 1,760 | 1,772 |
| My Lessons views | 25 | 50 | 167,850 | 0 | 0 | 0 |
| **Total** | | **4,141** | **1,580,029** | **15,833** | **3,437** | **4,188** |

| Daily cap | Heavy day | % of cap | Basis |
|---|---|---|---|
| Worker requests (100,000) | 4,141 | 4.1% | measured-local flows + estimated static assets/crops |
| D1 rows read (5,000,000) | 1,580,029 | 31.6% | measured-local × model |
| D1 rows written (100,000) | 15,833 | 15.8% | measured-local × model |
| DO requests (100,000; WS messages 1:1) | 3,437 | 3.4% | measured-local × model |
| DO duration (13,000 GB-s) | 1–675 GB-s | 0.0%–5.2% | estimated: event wall time (floor) to object active for the whole lesson (ceiling) |
| DO storage rows read (5,000,000) | 10,382 | 0.2% | measured-local call counts, 1 row per key [est] |
| DO storage rows written (100,000) | 4,188 | 4.2% | measured-local call counts, 1 row per key [est] |
<!-- daily:end -->

## Worst single invocation per limit

<!-- per-invocation:start -->
| Per-invocation limit | Worst single invocation | % of limit |
|---|---|---|
| D1 queries (1,000 verified; brief assumed 50) | 26 — self-paced-end: do.webSocketMessage submitAll [local] | 2.6% (52.0% of 50) |
| Statements in one batch | 1526 — self-paced-end: do.webSocketMessage submitAll [local] | counts as 1 query; per-statement limits apply |
| Bound parameters per statement (100) | 50 — admin-student-detail: worker GET /api/admin/students/e2e-budget-01 [local] | 50.0% |
| CPU (10 ms) | 58 ms — bank-filter: GET /api/admin/questions (ok) [staging] | 580.0% |
| Batch duration (30 s) | 945 ms whole invocation incl. the 1,526-statement write batch [local]; 177–187 ms for a 1,500-statement read batch [staging] | 3.1% |
<!-- per-invocation:end -->

## free-02: before and after

What changed (all responses byte-identical to free-01 on the budget seed, cached and uncached; `tools/budget_bench.cjs` and `tests/test_free_budget.cjs` check it):

1. **Admin stats read only what the shared stats use.** Taxonomy, answer and each choice's letter and trap; choice HTML is dropped in SQL with `json_remove` (not `json_each`, which D1 bills as one row read per choice: 26,823 vs 3,006 rows for the bank [staging]). The students list computes each student over only the questions they touched (every list field is keyed by their own rows), reads progress and attempts once for the roster instead of twice per student, and the Mistakes tab reads full rows only for its questions.
2. **Exact fast paths in the shared stats module.** `demoji` returns text with no mojibake lead character unchanged; `normalizeQuestion` skips `JSON.parse` for answers that cannot be JSON (it threw once per question). Normalizing the lean bank: ~30 ms → 4 ms [local-node].
3. **`/api/questions` is cached whole** in a named Cache API cache after the membership checks. The body is the same for every signed-in user (both banks + global `usedInLesson`). Key: both banks' max rowid + the insert-only usage table's max rowid, so a new question or a lesson ending changes it; an in-place edit or a deletion shows when the 1-hour entry expires (the builder rebuilds at once if a page row is missing). Clients still get `private, no-store`. The Cache API works on workers.dev (probe: stored and matched) [staging].
4. **Admin stats are cached per student** (named cache, admin-only, opened only behind the admin check) under a stamp of the bank and the student's latest attempt time: one index seek per student, in one batch. An entry computed within two minutes of the latest attempt is not kept, because a first Check's progress row and attempt arrive as separate requests. Attempt times come from the student's device clock; a clock running behind that student's earlier attempts leaves their entry in place until it expires (1 hour).
5. **Builder search** keeps the bank's light rows per isolate, pre-sorted in the builder's order (cbSort is one fixed order, so every filtered subset is already sorted), rebuilt when a bank's max rowid moves, after 1 hour, or when a page row is missing. Receiving those rows from D1 alone costs 5–11 ms CPU (4–5 ms with `raw()`) [staging]. Search first narrows in SQL to rows whose raw text holds every piece of the term (a proven superset, including U+0130/U+212A), then runs the unchanged exact test.
6. **The global usage map** is kept per isolate under the usage table's max rowid (exact: rows are only inserted), and the lean stat bank shares the builder index's key and expiry.
7. **ID reads bind at most 50 parameters** (half of D1's 100).
8. **Durable Objects: no change needed.** `LessonRoom` uses the hibernation API (`ctx.acceptWebSocket`, `webSocketMessage`), and its throttles (roster refresh at most 4/s, 250 ms flush timer, Desmos de-duplication) are unchanged; the traces show 1,580 / 1,651 WS messages for a 25 × 20 lesson, 3.4% of the DO request cap on the heavy day [local × model].
9. **Admin stats recompute fanned out (option A, chosen 2026-09-27).** The students list sends its stale students to the Worker's own `adminStats` named entrypoint through the `ADMIN_STATS` self service binding, split into at most 30 calls (one student per call for a club of up to 30). Each call is its own invocation with its own CPU limit, reads that student's progress and attempts plus only the questions they touched (one JSON-array parameter, joined so D1 bills the array once), and returns the same row the route computed before. The route keeps the roster, the stamps, the cache and the sort. A failed call fails the request (503) rather than showing partial stats, and nothing is cached. Only service bindings reach a named entrypoint; public traffic reaches the default export alone. Without the binding (Node tests, tools) the route computes the same rows inline.

| Measure | free-01 | free-02 | Label |
|---|---|---|---|
| CPU `GET /api/questions` | 114 ms | cached: median 2 ms, max 7 ms; rebuild (once per key per location): 172 ms | [staging]; cached [staging, untraced] |
| CPU `GET /api/admin/questions` (builder, 4 filter variants) | 59–114 ms | median 3–5 ms, p90 5–7 ms, max 10 ms (n = 14–25 each); first request per isolate 33–58 ms | [staging, untraced]; first [staging] |
| CPU `GET /api/admin/students` | **killed** (235 ms, exceededCpu) | cached: median 4 ms, p90 5 ms, max 7 ms [staging, untraced]. Full recompute (30 × 400 attempts), fanned out: route median 2.5 ms, max 8 ms; each call median 3.3 ms, p90 4.7 ms, max 12 ms [local-node]. Inline, the same recompute is 83–131 ms [local-node]. On staging (2026-09-28, traced, 25 stale students with the 30-attempt staging history): route 17 ms, each call median 2 ms, p90 5 ms, max 8 ms (n = 25). Per call at 400 attempts (probe `cpu-list` − `cpu-gen`, one student, bank the size of the touched set, n = 20): median 3.5 ms, p90 7 ms, max 9 ms [staging] | see cell |
| CPU `GET /api/admin/students/:id` | **killed** | cached: median 4 ms, max 5 ms; recompute: 18–49 ms | [staging, untraced]; recompute [staging] |
| CPU of recomputing all 30 students at 400 attempts each | — | 95–260 ms (in-memory probe `cpu-list`, same shared stats) | [staging] |
| D1 queries, admin students list | 65 | recompute: route 5 + a batch of 30 stamps, each of the 30 calls 4; cached: 5 + the batch | [local] |
| Worst D1 queries in any invocation | 65 | 26 (self-paced `submitAll`, unchanged) | [local] |
| D1 rows read, `/api/questions` | 3,805 | 4 cached | [local] |
| D1 rows read, builder (4 searches) | 15,228 | 3,640 first / 240 later | [local] |
| D1 rows read, admin list / detail | 24,523 / 9,809 | 48,154 (96 route + 30 × 1,602) / 10,010 recompute; 96 / 5,908 cached. Before the fan-out: 24,614 / 6,610 (the detail now builds the lean bank the list used to warm) | [local] |
| Heavy day, D1 rows read | 34.9% | 31.6% (26.2% before the fan-out) | [local] × model |
| Heavy day, every other daily cap | ≤ 15.8% | unchanged (≤ 15.8%) | [local] × model |
| Worst bound parameters | 13 | 50 | [local] |

**Targets (brief §5 free-02):**
- Daily totals ≤ 50%: **met**, worst 31.6% (D1 rows read; the fan-out added 5.4 points: each call reads its own student's touched questions).
- ≤ 35 D1 queries per invocation: **met**, worst 26.
- ≤ 7 ms CPU for ★ flows: **met for requests served from the caches and memos** (every ★ route's median and p90 ≤ 7 ms [staging, untraced]; single samples reach 9–10 ms). **Admin students recompute: met by the fan-out on median and p90 [local-node]** (route 2.5 ms; each call 3.3 ms median, 4.7 ms p90 at 400 attempts; single calls reach 12 ms). **Confirmed on staging 2026-09-28**: each call median 2 ms, p90 5 ms, max 8 ms (traced, 30-attempt staging history); at 400 attempts the probe gives median 3.5 ms, p90 7 ms, max 9 ms per call, net of generating the rows [staging]. The p90 at 400 attempts is at the target, not under it: a student with a much longer history pushes their own call past 7 ms (the call still gets its own burst allowance and grows with that one student only). The full 400-attempt history was not loaded on staging (≈ 36,000 rows written, over the 10% rule); the probe stands in for it. **Still over 7 ms, and not growing with use**: the `/api/questions` rebuild (~170 ms, once per bank/usage change per location, and hourly), the builder index build (33–58 ms, once per isolate per hour), and the student-detail recompute (18–49 ms [staging]; one student over the whole bank, so its cost follows that student's history and the bank size, not the club). See "Rebuild invocations".
- `batch()` ≤ 10 s: **met** (the 1,526-statement self-paced write-back runs in under 1 s [local]). On staging (2026-09-28) the write-back landed whole (500 `session_responses`, session ended), and D1 analytics put its statements' summed SQL time at about 0.1 s, each statement ≤ 0.3 ms at p99 [staging, D1 analytics, sampled]. The flush invocation's own wall time was not captured: `wrangler tail` sampled out that event (see "Staging seed and runs").

### Rebuild invocations

Cloudflare kills an invocation over 10 ms CPU once its burst allowance is used up; the allowance depends on recent use (free-01: probes up to 380 ms passed, while a 235 ms admin request was killed [staging]). A killed rebuild stores nothing, so the next request is the same rebuild again. The admin students recompute was the one at risk: its cost grew with every student's history, and the first view after a session recomputed the whole club in one invocation (95–260 ms at 400 attempts each [staging probe]).

Options put to the owner: **A.** fan the recompute out through a self service binding; **B.** recompute in a Durable Object alarm after each practice session; **C.** accept the risk. **A was chosen** (2026-09-27) and is change 9 above. Cost of A [local] × model: each recomputed list view is 30 extra invocations and about 23,500 extra D1 rows read (every call reads its own student's touched questions, where the inline recompute read the lean bank once); on the heavy day (10 recomputed views) that is +300 Worker requests (+0.3 points) and +5.4 points of D1 rows read. Per call: 4 D1 queries, 1 bound parameter. The route makes at most 30 service-binding calls, within the free plan's 50 subrequests per invocation. A club over 30 students puts ⌈n / 30⌉ students in each call.

Not changed, because none of them grows with the club's use: the `/api/questions` rebuild (the pre-free-02 cost, now paid once per change instead of on every boot), the builder index build, and the student-detail recompute (one student; it grows only with that student's own history).

## Ranked problems (free-01 baseline)

Threshold (brief §5): more than 50% of a daily cap on the heavy day, or more than 70% of a per-invocation limit.

**Over threshold**

1. **CPU on admin stat routes: killed on Free.** On a 3,400-question bank, `GET /api/admin/students` used 235 ms and ended `exceededCpu`, so the students list returns 503 [staging]. `GET /api/admin/students/:id` was killed as well (it ran right after, with no burst allowance left). Cause: `adminData()` normalizes the whole bank and runs `breakdown()` over it once per student (`src/index.js` `/api/admin/students`, 30 × full-bank stats), and once for the detail. Impact: the dashboard fails intermittently to always, depending on burst allowance. No data is lost, but the page doesn't load.
2. **CPU on whole-bank reads: 6–11× over.** `GET /api/questions` (student boot) 114 ms and `GET /api/admin/questions` (builder search, all three usage options) 59–114 ms passed during the burst allowance [staging]. They are next in line for 1102 errors on a busy day. Cause: every request re-reads, maps and serializes the whole bank (~6 MB JSON for the synthetic bank [est]). For the student it's a failed app load, not lost data.

**Below threshold, ranked by headroom**

3. D1 rows read, 34.9% of the daily cap. The four largest parts [local × model]:
   - admin views: 686,640 rows (24,523 per students list; per-student progress + attempts scans for 30 students);
   - practice answers: 495,000 rows (`POST /api/attempts` runs `SELECT COUNT(*)` over the student's whole log on every Check, so this grows linearly with history);
   - student boots: 329,490 rows (full bank scans);
   - My Lessons: 200,175 rows (`attendedSessions` reads every `session_responses` row of the student with no `user_id` index: 6,470 rows per list, growing with every lesson).

   The attempts and My Lessons parts grow over the school year, so this line is the one most likely to cross 50%.
4. D1 rows written, 15.8% of the daily cap. Largest parts:
   - practice answers: 7 rows per Check;
   - self-paced write-back: 4,542 rows in one invocation and one 1,526-statement batch. The batch is atomic, so a daily-cap error mid-batch loses the whole lesson's write-back unless the DO keeps it (free-03 safety work);
   - builder autosave: 81 rows per PUT, because it deletes and re-inserts every item.
5. Per-invocation D1 queries, 6.5% of 1,000. Worst: the admin students list at 65, which is 2 per student and reaches 1,000 at about 490 students. Next come the My Lessons session view at 28 (one lookup per item) and the self-paced end at 26 (one progress SELECT per student). All three exceed the brief's assumed 50-query budget only in the students-list case.
6. DO requests (3.4%), DO duration (≤ 5.2% even if both lesson objects stay awake all lesson), and DO storage writes (4.2%). The instructor-paced room calls `setAlarm` on every student select/lock (1,040 of its 2,416 storage writes). Harmless at this size.
7. Batch duration: the self-paced invocation takes 1.3 s [local]. (Staging, 2026-09-28: see free-02 targets.)

## Staging seed and runs

- Staging Worker `roadto1600-staging` (workers.dev), with D1 `roadto1600-staging` and `roadto1600-staging-ai`. Seeded with `schema.sql` / `schema_ai.sql`, the e2e seed, and `tools/budget_seed.cjs --staging`: the same 3,000 + 400 question bank as local, 30 test students, and a smaller practice history (30 attempts / 20 progress rows each) so the writes fit the 10% rule. No production data was read.
- The self-paced ★ run needs about 4,600 rows written. It runs after the 00:00 UTC reset, because day 1 had already spent about 8,100 rows on the bank seed.
- 2026-09-28 (free-02 day 2): redeployed staging with the `ADMIN_STATS` binding (listed as `roadto1600-staging#adminStats` in the deploy output), loaded the staging practice history (1,501 rows), then `budget_measure.cjs staging self-paced-end,poll-review,admin-students,admin-student-detail --warm`. `wrangler tail` sampled that run: it kept 150 of 500 `navigate` and 171 of 625 `select` events, none of the 25 `submitAll` events, and none of the first `admin-students` run. The flows' responses and D1 contents are complete (the `X-Budget-Trace` headers and a 500-row check). `admin-students` was run again after the write-back (25 students stale), and tail kept all 26 invocations; the table's CPU column comes from that run. The 400-attempt per-call CPU comes from the in-memory probe, 20 samples each of `cpu-list` and `cpu-gen`. With the whole 3,400-question bank in the probe, the difference is median 14 ms, p90 19 ms. That is an upper bound: it includes parsing the 1.1 MB bank JSON, which a real call never reads.

## Staging usage log

| Date (UTC) | Rows written | Rows read | Worker requests | What |
|---|---|---|---|---|
| 2026-09-27 | 8,097 (seed) + ~5 (flows) | ~70,000 | ~400 | free-01: schema + e2e seed (252), AI bank (800), core bank (6,800), accounts (121), live lessons (124); batch/ceiling probes (read-only); ★ bank, boot and admin flows |
| 2026-09-27 (whole day, Cloudflare analytics) | 8,105 | 415,422 | 776 | free-01 above plus free-02: CPU probes (in-memory), `json_each`/`json_remove` row-count checks, ★ boot/builder/admin flows cold + warm, untraced CPU samples. 8.1% / 8.3% / 0.8% of the caps |
| 2026-09-28 (Cloudflare analytics at 00:20Z) | 8,532 | 16,700 (+ ~5,400 from the admin-students rerun, not yet in analytics [est]) | 228 Worker + 1,760 DO (+ ~70 [est]) | free-02 day 2: practice history (3,909 rows written), self-paced 25 × 20 write-back, poll + review, admin list ×3 and detail ×2, 80 CPU probe calls. 8.5% / ≤ 0.5% / ≤ 2.1% of the caps; free-03 used no staging quota |

Caps: 10% = 10,000 rows written, 500,000 rows read and 10,000 requests per UTC day.
