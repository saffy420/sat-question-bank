# Free-plan budget: roadto1600.org

Status: **free-01 baseline, before any optimization.** Brief: `docs/perf/FREE-PLAN-BRIEF.md`.
Labels: **[staging]** measured on the staging Worker; **[local]** measured on local `wrangler dev` (Miniflare D1 `meta`); **[est]** estimated; **[doc]** Cloudflare docs.

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
Measured [local] on 2026-09-27 with the seed in `tools/budget_seed.cjs` (3,000 core + 400 AI questions, 30 students × 400 attempts, 10 past lessons). CPU column [staging] (2026-09-27T05:21Z; staging history is smaller, see "Staging seed").

| Flow | Worker invocations | DO invocations | Worst invocation: D1 queries (batch = 1) | Largest batch (statements) | D1 rows read | D1 rows written | DO storage rows written | Max CPU per invocation |
|---|---|---|---|---|---|---|---|---|
| Student sign-in + first page load | 10 | 0 | 4 (worker GET /api/questions) | — | 10,983 | 1 | 0 | 114 ms (GET /api/questions) [staging] |
| Question bank load + filter change (builder search, 3 usage options) ★ | 4 | 0 | 6 (worker GET /api/admin/questions) | — | 15,228 | 0 | 0 | 114 ms (GET /api/admin/questions) [staging] |
| Answer one practice question | 2 | 0 | 6 (worker POST /api/attempts) | 1 | 412 | 7 | 0 | — (not a ★ flow) |
| Admin students list, 30 students ★ | 1 | 0 | 65 (worker GET /api/admin/students) | — | 24,523 | 0 | 0 | **killed: /api/admin/students (exceededCpu, 235 ms)** [staging] |
| Admin student detail, every tab ★ | 2 | 0 | 9 (worker GET /api/admin/students/e2e-budget-01) | — | 9,809 | 0 | 0 | **killed: /api/admin/students/e2e-budget-01 (exceededCpu, 10 ms)** [staging] |
| Lesson builder search + save | 4 | 0 | 5 (worker GET /api/admin/questions) | 22 | 4,280 | 143 | 0 | — (not a ★ flow) |
| Instructor-paced lesson, 25 students × 20 questions | 52 | 1,677 (1,580 WS msgs) | 25 (do.fetch upgrade) | 25 | 354 | 1,136 | 2,416 | — (not a ★ flow) |
| Self-paced, 25 × 20, through end + write-back ★ | 52 | 1,702 (1,651 WS msgs) | 26 (do.webSocketMessage submitAll) | 1526 | 9,425 | 4,542 | 1,731 | — (not a ★ flow) |
| Poll + review (after the self-paced set) | 0 | 58 (31 WS msgs) | 1 (do.webSocketMessage next) | 21 | 3 | 43 | 41 | — (not a ★ flow) |
| My Lessons list + one session | 2 | 0 | 28 (worker GET /api/lesson-history/920012) | — | 8,007 | 0 | 0 | — (not a ★ flow) |

Flow details [local]:
- Student boot: `/api/questions` alone reads 3,801 rows (full scans of both banks + `question_lesson_usage`); `/api/lesson-history` reads 6,470.
- Practice answer: 7 rows written and 412 read per Check; `POST /api/attempts` counts the student's whole log (`SELECT COUNT(*)`), so its reads grow with history.
- Admin students list: one invocation runs 65 queries (2 per student + bank) and reads 24,523 rows.
- Builder: create = batch of 20 + 21 statements; one autosave (PUT) writes 81 rows.
- Instructor-paced: per question the end-of-question flush writes 25 D1 rows on average; 1,580 WS messages for the lesson; 20 alarms; DO storage: get 5,122, put 1,316, setAlarm 1,040, delete 59, deleteAlarm 1.
- Self-paced end: the finishing `submitAll` runs 25 separate queries (one progress SELECT per student) + one batch of 1,526 statements, writing 4,487 rows in 1,283 ms [local]; DO storage: get 5,108, put 1,729, setAlarm 1, delete 1.
- My Lessons: the session view runs 28 queries (one question lookup per item); the list reads 7,722 rows.
- Largest bound-parameter count on any statement: 13 (limit 100).
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

<!-- daily:start -->
| Part of the day | Count | Worker requests | D1 rows read | D1 rows written | DO requests | DO storage rows written |
|---|---|---|---|---|---|---|
| Student boots | 30 | 600 | 329,490 | 30 | 0 | 0 |
| Practice answers | 1,200 | 3,000 | 495,000 | 8,400 | 0 | 0 |
| Admin dashboard views (list + detail) | 20 | 60 | 686,640 | 0 | 0 | 0 |
| Lessons built | 1 | 27 | 21,464 | 1,682 | 0 | 0 |
| Instructor-paced lessons | 1 | 52 | 354 | 1,136 | 1,677 | 2,416 |
| Self-paced lessons (+ poll/review) | 1 | 52 | 9,428 | 4,585 | 1,760 | 1,772 |
| My Lessons views | 25 | 50 | 200,175 | 0 | 0 | 0 |
| **Total** | | **3,841** | **1,742,551** | **15,833** | **3,437** | **4,188** |

| Daily cap | Heavy day | % of cap | Basis |
|---|---|---|---|
| Worker requests (100,000) | 3,841 | 3.8% | measured-local flows + estimated static assets/crops |
| D1 rows read (5,000,000) | 1,742,551 | 34.9% | measured-local × model |
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
| D1 queries (1,000 verified; brief assumed 50) | 65 — admin-students: worker GET /api/admin/students [local] | 6.5% (130.0% of 50) |
| Statements in one batch | 1526 — self-paced-end: do.webSocketMessage submitAll [local] | counts as 1 query; per-statement limits apply |
| Bound parameters per statement (100) | 13 — self-paced-end: do.webSocketMessage submitAll [local] | 13.0% |
| CPU (10 ms) | 235 ms — admin-students: /api/admin/students (exceededCpu) [staging] | 2350.0% |
| Batch duration (30 s) | 1,283 ms whole invocation incl. the 1,526-statement write batch [local]; 177–187 ms for a 1,500-statement read batch [staging] | 4.3% |
<!-- per-invocation:end -->

## Ranked problems

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
| 2026-09-27 | 8,097 (seed) + ~5 (flows) | ~70,000 | ~400 | schema + e2e seed (252), AI bank (800), core bank (6,800), accounts (121), live lessons (124); batch/ceiling probes (read-only); ★ bank, boot and admin flows |

Caps: 10% = 10,000 rows written, 500,000 rows read and 10,000 requests per UTC day.
