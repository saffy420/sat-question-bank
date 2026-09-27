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
Measured [local] on 2026-09-27 with the seed in `tools/budget_seed.cjs` (3,000 core + 400 AI questions, 30 students × 400 attempts, 10 past lessons). CPU column [staging] (2026-09-27T18:00Z; staging history is smaller, see "Staging seed").

| Flow | Worker invocations | DO invocations | Worst invocation: D1 queries (batch = 1) | Largest batch (statements) | D1 rows read | D1 rows written | DO storage rows written | Max CPU per invocation |
|---|---|---|---|---|---|---|---|---|
| Student sign-in + first page load | 10 | 0 | 8 (worker GET /api/questions) | — | 10,987 | 1 | 0 | 6 ms (GET /api/notes) [staging] |
| Question bank load + filter change (builder search, 3 usage options) ★ | 4 | 0 | 9 (worker GET /api/admin/questions) | — | 3,640 | 0 | 0 | 58 ms (GET /api/admin/questions) [staging] |
| Answer one practice question | 2 | 0 | 6 (worker POST /api/attempts) | 1 | 412 | 7 | 0 | — (not a ★ flow) |
| Admin students list, 30 students ★ | 1 | 0 | 10 (worker GET /api/admin/students) | 30 | 24,614 | 0 | 0 | 38 ms (GET /api/admin/students) [staging] |
| Admin student detail, every tab ★ | 2 | 0 | 13 (worker GET /api/admin/students/e2e-budget-01) | 1 | 6,610 | 0 | 0 | 18 ms (GET /api/admin/students/e2e-budget-01) [staging] |
| Lesson builder search + save | 4 | 0 | 9 (worker GET /api/admin/questions) | 22 | 3,933 | 143 | 0 | — (not a ★ flow) |
| Instructor-paced lesson, 25 students × 20 questions | 52 | 1,677 (1,580 WS msgs) | 25 (do.fetch upgrade) | 25 | 354 | 1,136 | 2,416 | — (not a ★ flow) |
| Self-paced, 25 × 20, through end + write-back ★ | 52 | 1,702 (1,651 WS msgs) | 26 (do.webSocketMessage submitAll) | 1526 | 9,425 | 4,542 | 1,731 | — (not a ★ flow) |
| Poll + review (after the self-paced set) | 0 | 58 (31 WS msgs) | 1 (do.webSocketMessage next) | 21 | 3 | 43 | 41 | — (not a ★ flow) |
| My Lessons list + one session | 2 | 0 | 25 (worker GET /api/lesson-history/920010) | — | 6,714 | 0 | 0 | — (not a ★ flow) |

Flow details [local]:
- Student boot: `/api/questions` reads 3,805 rows when it rebuilds the cached body (full scans of both banks + `question_lesson_usage`) and 4 when served from the cache; `/api/lesson-history` reads 6,470.
- Practice answer: 7 rows written and 412 read per Check; `POST /api/attempts` counts the student's whole log (`SELECT COUNT(*)`), so its reads grow with history.
- Admin students list: 10 queries and 24,614 rows read when every student is recomputed; 6 queries and 96 rows from the stats cache (the per-student stamps are one batch).
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
| Admin dashboard views (list + detail), recomputed | 10 | 30 | 312,240 | 0 | 0 | 0 |
| Admin dashboard views (list + detail), cached | 10 | 30 | 60,040 | 0 | 0 | 0 |
| Lessons built | 1 | 27 | 19,729 | 1,682 | 0 | 0 |
| Instructor-paced lessons | 1 | 52 | 354 | 1,136 | 1,677 | 2,416 |
| Self-paced lessons (+ poll/review) | 1 | 52 | 9,428 | 4,585 | 1,760 | 1,772 |
| My Lessons views | 25 | 50 | 167,850 | 0 | 0 | 0 |
| **Total** | | **3,841** | **1,310,629** | **15,833** | **3,437** | **4,188** |

| Daily cap | Heavy day | % of cap | Basis |
|---|---|---|---|
| Worker requests (100,000) | 3,841 | 3.8% | measured-local flows + estimated static assets/crops |
| D1 rows read (5,000,000) | 1,310,629 | 26.2% | measured-local × model |
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

| Measure | free-01 | free-02 | Label |
|---|---|---|---|
| CPU `GET /api/questions` | 114 ms | cached: median 2 ms, max 7 ms; rebuild (once per key per location): 172 ms | [staging]; cached [staging, untraced] |
| CPU `GET /api/admin/questions` (builder, 4 filter variants) | 59–114 ms | median 3–5 ms, p90 5–7 ms, max 10 ms (n = 14–25 each); first request per isolate 33–58 ms | [staging, untraced]; first [staging] |
| CPU `GET /api/admin/students` | **killed** (235 ms, exceededCpu) | cached: median 4 ms, p90 5 ms, max 7 ms; recompute on staging's small history: 38–46 ms | [staging, untraced]; recompute [staging] |
| CPU `GET /api/admin/students/:id` | **killed** | cached: median 4 ms, max 5 ms; recompute: 18–35 ms | [staging, untraced]; recompute [staging] |
| CPU of recomputing all 30 students at 400 attempts each | — | 95–260 ms (in-memory probe `cpu-list`, same shared stats) | [staging] |
| D1 queries, admin students list | 65 | 12 recompute / 6 cached | [local] |
| Worst D1 queries in any invocation | 65 | 26 (self-paced `submitAll`, unchanged) | [local] |
| D1 rows read, `/api/questions` | 3,805 | 4 cached | [local] |
| D1 rows read, builder (4 searches) | 15,228 | 3,640 first / 240 later | [local] |
| D1 rows read, admin list / detail | 24,523 / 9,809 | 24,614 / 6,610 recompute; 96 / 5,908 cached | [local] |
| Heavy day, D1 rows read | 34.9% | 26.2% | [local] × model |
| Heavy day, every other daily cap | ≤ 15.8% | unchanged (≤ 15.8%) | [local] × model |
| Worst bound parameters | 13 | 50 | [local] |

**Targets (brief §5 free-02):**
- Daily totals ≤ 50%: **met**, worst 26.2% (D1 rows read).
- ≤ 35 D1 queries per invocation: **met**, worst 26.
- ≤ 7 ms CPU for ★ flows: **met for requests served from the caches and memos** (every ★ route's median and p90 ≤ 7 ms [staging, untraced]; single samples reach 9–10 ms). **Not met for the invocations that rebuild them**: the `/api/questions` rebuild (~170 ms, once per bank/usage change per location, and hourly), the builder index build (33–58 ms, once per isolate per hour), and the admin stats recompute (≈ 1–8 ms per student who practised since the last view; the whole club at 400 attempts each is 95–260 ms, near the 235 ms that was killed). See "Open: rebuild invocations".
- `batch()` ≤ 10 s: **met locally** (the 1,526-statement self-paced write-back runs in under 1 s [local]); the staging measurement runs on 2026-09-28 (next UTC day, 10% rule).

### Open: rebuild invocations

Cloudflare kills an invocation over 10 ms CPU once its burst allowance is used up; the allowance depends on recent use (free-01: probes up to 380 ms passed, while a 235 ms admin request was killed [staging]). A killed rebuild stores nothing, so the next request is the same rebuild again. The admin stats recompute is the one at risk: its cost grows with every student's history, and the whole club's first view after a session recomputes everyone. Options, all outside this task's levers:

- **A. Fan the recompute out.** The list asks the Worker itself, through a service binding, for stats in chunks of a few students. Each call is its own invocation with its own CPU budget, costing about 6–30 extra Worker requests per recomputed view (< 0.1% of the daily cap). Needs a `[[services]]` self-binding in `wrangler.toml`.
- **B. Recompute off the request path.** A Durable Object alarm recomputes one student per alarm after they practise. Each alarm is a fresh invocation [staging, free-01]. It adds DO requests (≈ 1 per practice session) and a new DO class.
- **C. Accept the risk** until histories grow: on staging's history the recompute is 38–46 ms and passes.

The `/api/questions` rebuild (the pre-free-02 cost, now paid once per change instead of on every boot) and the builder index build are the same kind of invocation, but they don't grow with use.

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
7. Batch duration: the self-paced invocation takes 1.3 s [local]. The staging write-latency measurement is pending (next UTC day).

## Staging seed and runs

- Staging Worker `roadto1600-staging` (workers.dev), with D1 `roadto1600-staging` and `roadto1600-staging-ai`. Seeded with `schema.sql` / `schema_ai.sql`, the e2e seed, and `tools/budget_seed.cjs --staging`: the same 3,000 + 400 question bank as local, 30 test students, and a smaller practice history (30 attempts / 20 progress rows each) so the writes fit the 10% rule. No production data was read.
- The self-paced ★ run needs about 4,600 rows written. It runs after the 00:00 UTC reset, because day 1 had already spent about 8,100 rows on the bank seed.

## Staging usage log

| Date (UTC) | Rows written | Rows read | Worker requests | What |
|---|---|---|---|---|
| 2026-09-27 | 8,097 (seed) + ~5 (flows) | ~70,000 | ~400 | free-01: schema + e2e seed (252), AI bank (800), core bank (6,800), accounts (121), live lessons (124); batch/ceiling probes (read-only); ★ bank, boot and admin flows |
| 2026-09-27 (whole day, Cloudflare analytics) | 8,105 | 415,422 | 776 | free-01 above plus free-02: CPU probes (in-memory), `json_each`/`json_remove` row-count checks, ★ boot/builder/admin flows cold + warm, untraced CPU samples. 8.1% / 8.3% / 0.8% of the caps |

Caps: 10% = 10,000 rows written, 500,000 rows read and 10,000 requests per UTC day.
