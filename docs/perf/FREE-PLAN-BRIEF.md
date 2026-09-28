# Brief: Fit roadto1600.org inside the Cloudflare Workers Free plan

**Run context:** Claude Code (cloud). One session, three tasks in order, one branch and one PR per task. The Live Lessons brief (`docs/lessons/BRIEF.md` §0–§11) still governs the app; this brief adds a budget constraint and changes no feature behavior.

**First action, before anything else:** create branch `claude/free-01-measure`, save this entire prompt verbatim as `docs/perf/FREE-PLAN-BRIEF.md`, check that every heading §0–§7 is present, and commit it. From then on, that file is the only copy of these instructions you rely on. The pasted prompt will not survive compaction.

**Base branch:** `main` if all `lessons-*` PRs are merged; otherwise the tip of the lessons stack (the latest `claude/lessons-*` branch). Record which in `state.md`.

---

## 0. Goal

The account is on **Workers Free** and staying there. Exceeding a daily D1 limit makes queries fail with errors, not bill, so running out mid-lesson means lost data. Make every flow fit the limits with headroom. Then prove it with tests that fail if a future change blows the budget, and make quota failures lose nothing.

## 1. Limits

Verified from Cloudflare docs (Sept 2026):

| Limit | Free plan |
|---|---|
| D1 queries per Worker invocation | 50 |
| D1 rows written | 100,000 / day (account-wide, resets 00:00 UTC) |
| D1 rows read | 5,000,000 / day (account-wide) |
| D1 max database size | 500 MB |
| D1 bound parameters per query | 100 |
| D1 query duration (also applies to a whole `batch()`) | 30 s |
| D1 simultaneous connections per invocation | 6 |
| Worker requests | 100,000 / day |
| Worker CPU time | 10 ms per invocation |

Each index adds one extra row written when a write touches the indexed column. Rows read counts rows scanned, not rows returned.

**Verify before relying on these (task free-01 research):**
- Durable Objects on Free: requests/day, duration (GB-s)/day, the required storage backend, and how incoming WebSocket messages and alarms count as requests.
- Whether each statement inside `db.batch()` counts toward the 50-queries-per-invocation limit, or the batch counts as one. Community reports say one; Cloudflare's docs don't say. Settle it empirically on staging (§4).
- Whether the per-invocation query limit applies inside Durable Object fetch, alarm, and WebSocket handlers, and whether each alarm is a fresh invocation.
- Whether the 10 ms CPU limit applies per DO event.

Record verified values with doc URLs in `docs/perf/free-plan-budget.md`. If a value differs from the table above, the verified value wins; note the difference.

## 2. Ground rules

1. No feature changes. Everything in `docs/lessons/BRIEF.md` §0 still holds, especially:
   - rule 2: no duplicated stat logic;
   - rule 5: nothing a student isn't allowed to see yet reaches their browser (applies to caching too — never cache lesson payloads, and never widen what a cached response contains);
   - rule 6: no per-event D1 writes.
2. Never load-test production or production data. Remote measurement uses a separate staging Worker and staging D1 (§4).
3. Free limits are **account-wide**: staging traffic eats production's daily quota. Keep total staging usage under **10% of each daily cap per day**, and log what each run used.
4. Measured numbers beat estimates. Every number in the report says whether it was measured (and where: local or staging) or estimated.

## 3. Execution model

- You do all work in the main session: research, instrumentation, tests, optimization, review, docs, git, PRs.
- The only subagent is `lessons-researcher` (already in `.claude/agents/`, Sonnet, low effort). Use at most 2 per task, in parallel, for independent questions only.
- **Per-task flow:** start → research (optional) → spec → implement → test round → review round → repair rounds (max 5) → docs → PR. These steps work the same way as `docs/lessons/BRIEF.md` §12.3, with two changes:
  - the review checklist adds §6 below;
  - the spec lives at `.omp/pipeline/<task>/spec.md`.
- **PRs:** stacked, `claude/free-0N-<name>`, titled `free-0N: <name>`. If `gh` is unavailable, write the body to `.omp/pipeline/<task>/pr.md` and print the compare URL.
- **Hard stops (end the turn and wait for me):**
  - the Cloudflare API token or network access for staging is missing;
  - a flow can't fit the budget without changing the lessons architecture (e.g. moving data off D1). Report the options with numbers;
  - a verified limit contradicts this brief in a way that changes the plan.

### Checkpoints and compaction

After every step, overwrite the checkpoint block at the top of `.omp/pipeline/<task>/state.md` and commit it:

```text
Task: free-0N-<name>
Branch: claude/free-0N-<name>   Base: <branch>
Last completed step: <n>   Commit: <sha>
Next step: <exact next action>
Open blockers: <none | list>
Decisions made this task: <short list>
Staging quota used today: <rows written / rows read / requests>
Instructions: docs/perf/FREE-PLAN-BRIEF.md — re-read §0–§7
```

After any compaction, before doing anything else:
1. Re-read `docs/perf/FREE-PLAN-BRIEF.md`.
2. Re-read `state.md` and the current task's spec/e2e/review files.
3. Continue from `Next step`.

Never work from a summary's paraphrase of these instructions.

After each task's PR, end your turn with:

`CHECKPOINT free-0N done — PR <url>. Run: /compact Keep only: tasks completed so far, and that after compaction you must re-read docs/perf/FREE-PLAN-BRIEF.md and .omp/pipeline/<next-task>/state.md before acting — then send "continue".`

## 4. Measurement setup

**Local instrumentation** (runs in unit tests and e2e):
- A thin wrapper around the D1 binding. It is active only when `BUDGET_TRACE=1` and is a no-op otherwise.
- It records, per invocation: number of `prepare().run/all/first` calls, number of `batch()` calls, statements per batch, and summed `meta.rows_read` / `meta.rows_written`.
- It writes these to a per-request trace readable by tests.
- Apply it at the binding, not per call site, so nothing can bypass it.

**Staging** (for what local can't show: CPU time, batch counting semantics, real write latency):
- Separate `[env.staging]` in `wrangler.toml` with its own Worker name and its own D1 database (`roadto1600-staging`). Seed it with the e2e seed script plus a realistic-size copy of the *question* tables only — no user data.
- The test sign-in route is enabled on staging only behind an extra `STAGING_TEST_TOKEN` header check. Delete the staging Worker when free-03 finishes and record that in the PR.
- Needs `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` as cloud environment variables, and network access to `api.cloudflare.com` and the staging `*.workers.dev` host. If either is missing: hard stop, and say exactly what to add.
- Read CPU time from `wrangler tail` (or Workers observability) and D1 usage from query `meta` plus the D1 dashboard/GraphQL metrics.

**Batch semantics test (free-01, staging):** one invocation that runs a single `batch()` of 200 small inserts, then another that runs 60 separate queries. Record whether the first succeeds and whether the second fails at query 51. The result decides how free-02 chunks writes.

## 5. Tasks

### free-01-measure — instrumentation, staging, baseline report

- Build §4.
- Measure every flow below with local traces. Measure the ones marked ★ on staging too.

  | Flow | What to record |
  |---|---|
  | Student sign-in + first page load | per-invocation queries, rows read |
  | Question bank load + filter change (incl. `usedInLesson` and the 3-option lesson filter) ★ | queries, rows read, CPU |
  | Answer one practice question (attempt write) | queries, rows written |
  | Admin students list, 30 students ★ | queries, rows read, CPU |
  | Admin student detail, every tab ★ | queries, rows read, CPU |
  | Lesson builder search + save | queries, rows read/written |
  | Instructor-paced lesson, per question, 25 students (end-of-question flush) | DO requests, queries, rows written |
  | Self-paced end, 25 students × 20 questions: write-back to practice tables + `session_responses` + usage rows ★ | queries per invocation, statements per batch, rows written, duration |
  | Poll + review | DO requests, rows written |
  | My Lessons list + one session | queries, rows read |

- **Daily model.** Default heavy club day: 30 students × 40 practice questions, plus 2 lessons (one of each mode) at 25 students × 20 questions, plus 20 admin dashboard views. Put these numbers in one config block in the report so I can change them. Compute each daily total as a % of the free cap. For each per-invocation limit, report the worst single invocation.
- **Output:** `docs/perf/free-plan-budget.md` containing:
  - verified limits;
  - the batch-semantics result;
  - a per-flow table;
  - the daily model;
  - a ranked list of problems. Anything over **50% of a daily cap on the heavy day** or over **70% of a per-invocation limit** is a problem.
- **No optimizations in this task.**

### free-02-optimize — fix the ranked problems

Targets on the heavy-day model:
- every daily total ≤ 50% of its cap;
- every invocation ≤ 35 D1 queries and ≤ 7 ms CPU (measured on staging for ★ flows);
- every `batch()` ≤ 10 s measured.

Work the ranked list top-down. Measure after each change and stop a line of work once its target is met. Expected levers — verify each with numbers; don't apply one blindly:
- **Self-paced write-back:**
  - chunked `batch()` sized from the free-01 semantics result;
  - if statements count individually, spread chunks across DO alarm invocations (one chunk per alarm);
  - fewer statements per attempt;
  - multi-row `INSERT`s kept under 100 bound parameters.
- **Rows read:**
  - targeted indexes on hot filters, weighing each index's extra row-write cost in the report;
  - no `SELECT *` or full scans on hot paths;
  - `usedInLesson` computed with one grouped query, not per question.
- **Static question data:** serve the question bank's static content via the Cache API or a static asset instead of D1 on every load — only if that doesn't change what a student can see (§2 rule 1).
- **CPU:** paginate admin tables and cache computed stats per student with invalidation on new attempts. Reuse the shared stat module (no second copy of any stat).
- **DO:** confirm hibernation is actually used, and that throttles (responses ≤ 4/s, laser ~20/s, Desmos 150 ms, unchanged-state skip) hold under the trace.

Every optimization keeps the full e2e suite green. Update the report with before/after numbers per change.

### free-03-guardrails — budget tests + quota-failure safety

- **Budget tests (local, run with the normal suite):** one test per flow in the free-01 table. Each asserts queries per invocation, statements per batch, and rows written/read stay at or below the post-free-02 value + 20%. Budget constants live in one file with a comment linking the report. A future change that blows a budget fails CI.
- **Quota-failure safety:**
  - Detect D1 daily-limit and overload errors distinctly from other errors.
  - When a lesson flush or write-back fails for those reasons, the Durable Object keeps the unflushed data in its own storage. It retries with backoff, and also after the next 00:00 UTC reset. Writes are idempotent (unique key + `INSERT OR IGNORE`, or a flushed-set in DO storage), so retries never duplicate attempts.
  - Nothing is lost if the DO is evicted mid-retry.
- **Visible warning:** a small admin-dashboard banner when a flush is pending or failed ("Lesson results saved locally, will sync after <time>"). Students see nothing new.
- **Tests:**
  - unit tests for chunking, idempotency, and retry scheduling;
  - an e2e test that simulates a D1 limit error during self-paced write-back (inject via a test-only fault flag gated like `E2E_TEST_MODE`), then clears it and asserts every attempt lands exactly once.
- **Cleanup:** delete the staging Worker (keep the staging D1 only if I say so) and record it in the PR.

## 6. Review checklist additions (every task)

- (a) No feature or UI behavior changed except the free-03 admin banner.
- (b) `BUDGET_TRACE` and the fault-injection flag are inert in production config, with a test proving it.
- (c) No cached response contains anything a student isn't allowed to see yet; no lesson payload is cached.
- (d) No duplicated stat logic; no per-event D1 writes.
- (e) Every number in the report is labeled measured-local, measured-staging, or estimated.
- (f) Staging usage stayed under 10% of each daily cap; the log is in `state.md`.
- (g) No `.skip`, `.only`, loosened assertions, or raised budget constants to force a pass.

## 7. Done when

- `docs/perf/free-plan-budget.md` shows the heavy-day model at ≤ 50% of every daily cap and every per-invocation limit within target, with before/after numbers.
- Budget tests run in the normal suite and fail on regression.
- A simulated quota failure during a 25 × 20 self-paced write-back loses nothing and duplicates nothing after recovery.
- Three PRs are open (free-01, free-02, free-03), each with a **Manual check before merge** list. That list includes: check the D1 dashboard's daily row metrics for a week after merging, and confirm the staging Worker is gone.
