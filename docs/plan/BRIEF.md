# Brief: Study Plan (Leon method)

> Saved verbatim from the user's brief (2026-10-01); it is the source of truth for behavior. The user later dropped the
> tiered pipeline split and asked for the whole feature in one session; **§7 Implementation** (below the line) records
> how it was built. If the two disagree, the brief wins.

To the Architect: save this as docs/plan/BRIEF.md and split it into ordered pipeline tasks, plan-00-audit first. Follow the conventions in docs/lessons/BRIEF.md: one task per session, §12.1 tiers, fresh subagents, Test Developer, Reviewer, STOP gates.
Dependencies:
- the Bluebook practice-test → bank-ID mapping;
- bank-bluebook (its Check/retry flow).
If either is missing, plan-00 STOPs and reports what's missing.

## The method (source of truth)
A cycle: full Bluebook practice test → log errors → drill weak skills → consolidate → next test.
- Log every missed question, and every question answered correctly but noticeably slowly.
- Drill skills in order, most misses first. A drill is 15 unseen questions in one skill: 10 medium, then 5 hard. Limits: 10:00 for the 10 medium and 7:30 for the 5 hard.
- When every missed skill has been drilled, do 5 hard questions in each drilled skill.
- Then take the next test. Tests should be 5–7 days apart, and drilling should take about a week.
- A skill with zero misses on two consecutive tests goes to maintenance: 5 hard questions every other cycle instead of a drill.
- A maintenance skill with 2+ misses on a later test goes back to drilling.
"Skill" means the College Board skill as the bank stores it.

## 1. Logging a test
- The student picks the test and the date, then sees a grid for each module (question numbers, like Bluebook's review page). They mark each question Wrong or Slow. Everything unmarked counts as right.
- The mapping resolves each question to a bank ID and a skill. Reuse the mapping feature's behavior: the test's questions are marked done, and misses go to the mistake log.
- [DEFAULT] If a test is logged less than 5 days after the previous one, warn but allow it.

## 2. Building the plan
- Per skill, count this test's misses and slows.
- Drill list: every non-maintenance skill with at least 1 miss, plus every maintenance skill with at least 2 misses (those move back to drilling).
- Order: most misses first; ties go to more slows, then to lower lifetime bank accuracy.
- [DEFAULT] Slows appear on the plan and break ties, but never create a drill on their own. One constant can make slows count as misses.
- A maintenance skill with exactly 1 miss stays in maintenance. Its zero-miss streak resets, and it is due this cycle regardless of the every-other schedule.
- Step order: drills → consolidation (5 hard in each drilled skill) → maintenance (5 hard in each maintenance skill that is due) → "Take practice test N+1", with a recommended date of previous test + 7 days.

## 3. Home screen
- The plan is the first thing a student sees after login. With no plan yet, show a single button: "Log a Bluebook practice test".
- One primary button, "Start practicing", launches the next incomplete step with its filters applied. Steps are listed with progress. Students may open any step, but the button always follows the plan order.

## 4. Drill sets
- The set is a 15-question mini test in the bank's Bluebook-style player: 10 medium, then 5 hard, all in one skill.
- There is no per-question checking during a drill; results come at the end.
- Question pool:
  - questions this student has never attempted, in the bank or in lessons;
  - excluding every question mapped to a Bluebook test the student hasn't logged yet (don't spoil future tests);
  - if the pool is short, fill it with the least-recently-seen questions they got right; if it is still short, shrink the set and tell the student.
- Timer: two segments, 10:00 for medium, then 7:30 for hard.
  - [DEFAULT] Soft limit: at 0:00 the clock turns red and counts overtime.
  - Overtime for each segment is recorded and shown on the plan.
  - One constant switches this to a hard cutoff.
- Answers are recorded as normal bank attempts through the shared record path, tagged with the plan step, so all stats include them.

## 5. End-of-skill review
After a drill, the student sees:
1. score, and time against the limit;
2. the questions missed in the drill, using the retry-until-correct flow and then the explanation;
3. the original practice-test question(s) they missed in that skill, re-attempted the same way.
Consolidation and maintenance sets use the same player and review.

## 6. Cycle state (per student, per skill)
Track: status (drilling / maintenance / none), the count of consecutive zero-miss tests, and the last test's misses and slows. Recompute when a test is logged. Keep D1 writes small (Free plan).

## Checkpoints
- Plan order after logging a test, including the slows tie-break.
- Maintenance entry after two clean tests.
- A maintenance skill with 2 misses goes back to drilling; one with 1 miss stays in maintenance and is due.
- The drill pool never includes seen questions or questions from untaken tests.
- Soft-timer overtime is recorded.
- The review shows drill misses, then the original test miss.
- "Start practicing" advances correctly.
- A full two-cycle walkthrough at 1366×768.

---

## 7. Implementation (2026-10-01)

Built in one session; see `docs/plan/STATUS.md` for test results and what is left.

| Piece | Where |
|---|---|
| Practice-test map in the app | `tools/ptmap/build-ptmap.cjs` also writes `public/practice-tests.json` (bank IDs per module, display order; `null` = unmapped position or unexported module). Served only to signed-in members, like `exams.json`. Re-run the builder when new exports arrive. |
| Storage | `migrations/0012_study_plan.sql`: `study_plans` (one JSON row per student, `rev` for stale-write protection) and `attempts.plan_step`. `GET/POST /api/plan` in `src/index.js`. |
| Rules | `lesson-ui/plan.ts` (pure, unit tested in `tests/test_plan.ts`): log resolution, cycle state, plan order, steps, set pool, segments, scoring. The [DEFAULT] switches are the constants at its top: `SLOWS_COUNT_AS_MISSES`, `HARD_CUTOFF`, `MIN_DAYS_BETWEEN_TESTS`. |
| Screens | `public/index.html`: Study Plan tab (first screen after login), test-log form, step list, results, review. Sets play on the bank screen (`lesson-ui/Bank.tsx`, `set` mode: no Check, segment clock, end-of-section confirm). |
| Recording | A logged test: progress + attempt per mapped question through the shared recorder, dated the test day, tagged `test:<PT>`; Wrong is Red (mistake log, tagged with the test), Slow and unmarked are right. A set: one progress + attempt per answered question at the end, tagged with the step ID; review attempts are tagged `<step>.r`. |

Decisions taken where the brief was open:
- **Maintenance timing.** A skill entering maintenance is not due that cycle; it is due on the next, then every other.
  Any skill (drilled or not) with two consecutive clean tests enters maintenance.
- **Skills a test did not cover** keep their state.
- **Set pool.** Unseen official questions before unseen AI ones (AI rows are all `Hard`); fallback is least-recently-seen
  questions whose current record is right. Unscorable questions are never served. A short segment shrinks its limit
  (1:00 per medium, 1:30 per hard); consolidation and maintenance are 5 hard in 7:30.
- **Blank answers in a set** count as misses on the score and appear in the review, but write no attempt (the practice-exam
  rule).
- **Review** is a practice session (retry until correct; the explanation opens when each question closes), kept in
  History. Its first Checks are recorded like any practice, so a drill miss solved in review turns Orange.
- **A test can be logged once.** There is no undo; logged answers are recorded on save.
- **Next test** is the lowest-numbered unlogged mapped test after this one, else N + 1.
