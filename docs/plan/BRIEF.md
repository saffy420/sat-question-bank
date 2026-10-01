# Brief: Study Plan (Leon method)

> Saved verbatim from the user's brief (2026-10-01). Everything above **§7 Pipeline** is the user's text and the
> source of truth for behavior. §7–§9 were added by the Architect to split it into pipeline tasks; they follow the
> conventions of the Live Lessons pipeline (`docs/roadto1600-lessons-prompt.md` §12.1 tiers, as used by
> `docs/lessons/BRIEF.md`'s later tasks). If the two ever disagree, the user's text wins and the conflict is a STOP.

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

<!-- Everything below was added by the Architect (2026-10-01). -->

## 7. Pipeline

### 7.1 Session model
- **One task per top-level session.** A session finishes its task (through Documentation) and stops; the next task
  starts in a new session that rebuilds context from this brief, `docs/plan/PLAN.md` (written by plan-00),
  `docs/plan/STATUS.md`, the previous `handoff.md` and its own `state.md`, never from an earlier conversation.
- **Tiers** (definitions: `docs/roadto1600-lessons-prompt.md` §12.1). At session start the Architect confirms the task
  is the next incomplete one in §8, picks exactly one tier (the table's tier is a recommendation; escalate only
  upward), and writes at the top of `.omp/pipeline/<task>/state.md`:
  ```text
  Task: <task>
  Tier: 1 | 2 | 3
  Tier rationale: <1–3 sentences>
  Branch: <branch>   Base: <branch or main>
  Last completed step: <stage>   Commit: <sha>
  Next step: <exact next action>
  Open blockers: <none | list>
  Session scope: this task only
  Instructions: docs/plan/BRIEF.md (§7–§9 + this task's brief sections) and docs/plan/PLAN.md
  ```
  - Tier 1: spec → Developer → Test Developer → Reviewer (LIGHT) → Documentation. No Researcher.
  - Tier 2: one Researcher → spec → Developer → Test Developer → Reviewer (NORMAL) → Documentation.
  - Tier 3: up to two parallel Researchers (A = current code/ownership, B = tests/invariants/data) → spec →
    Developer → Test Developer → Reviewer (DEEP) → Documentation.
- **Fresh subagents.** Every stage is a brand-new `Agent` spawn; never `SendMessage` a previous stage's agent, including
  repairs and rechecks. Agents share state only through repo files. Researchers use `.claude/agents/plan-researcher.md`
  (plan-00 creates it, copying `lessons-researcher.md` but pointing at this brief); other roles are fresh
  `general-purpose` agents given their role rules below and explicit file paths.
- **Developer** implements `spec.md` plus the unit tests it calls for (TypeScript `tests/test_*.ts`, per CLAUDE.md).
  No Playwright.
- **Test Developer** is always a separate fresh agent that never edits app code: its diff is limited to
  `tests/e2e/`, fixtures and seeds. It drives every checkpoint in `spec.md` with Playwright at 1366×768, commits each as
  a spec under `tests/e2e/<task>/`, runs those specs **and the full existing suite**, and writes `e2e.md`
  (checkpoint → pass/fail, command, artifacts, each failure classed test bug / app bug).
- **Reviewer** is read-only: implementation diff, test diff, `e2e.md`, §7.3 and the task's own items. Writes
  `review.md`: PASS, or blockers with file:line.
- **Repair loop:** Architect → fresh Developer (blocker only) → fresh Test Developer (task specs + full suite) → fresh
  Reviewer RECHECK. Max 5 rounds; a blocker that survives 2 rounds means re-examine the spec or raise a decision.
- **Documentation** (fresh agent) writes `handoff.md` and appends a dated entry to `docs/plan/STATUS.md`: what shipped,
  tier, e2e summary, deviations, manual checks.
- No task reaches Documentation with a failing, skipped or missing checkpoint unless the user approves it at a gate.
- Commit per stage on the session's branch; push the branch; open a PR only when the user asks. Base each task on the
  previous task's branch if it is unmerged, else `main`. Never deploy or touch remote D1 (CLAUDE.md).

### 7.2 Gates
- **STOP (end the session, report, wait for the user):** the §8 STOP column; a missing dependency (plan-00); research
  contradicting this brief; a choice that changes architecture or the D1 schema beyond PLAN.md; a checkpoint that
  can't pass within the repair limit. **[DEFAULT]** items are not gates: build them as written, each behind one
  constant or function.
- After a STOP, later tasks don't start until the user resolves it.

### 7.3 Reviewer checks (every task, plus the task's own)
- **Code:** (a) one shared record path for attempts/progress (bank-bluebook's `lesson-ui/record.ts` + Worker
  handlers); no second recorder; (b) no second copy of a stat (lifetime skill accuracy, mistake predicate, level
  mapping come from the existing shared code); (c) D1 writes batched and small (one log = bounded writes; no per-tick
  or per-selection writes); (d) identity from the token, `WHERE user_id = ?` on every new table; (e) during a set no
  correct answer or explanation appears anywhere (screen, More menu, Copy for AI, network payload built for the set)
  until results; (f) the pool never offers a question mapped to a test the student hasn't logged; (g) nothing from a
  later task.
- **Tests:** (h) every `spec.md` checkpoint has a spec that asserts it; (i) no `.skip`/`.only`/`fixme`, loosened
  assertions or inflated timeouts; (j) condition waits, not sleeps (timer tests use a test-only clock/limit constant
  from the local e2e entry, never a production flag, per CLAUDE.md); (k) Test Developer commits touch no app code;
  (l) `e2e.md` shows the full suite ran.

## 8. Tasks

| # | Task | Brief scope | Rec. tier | Research focus | Reviewer must verify | Gate |
|---|---|---|---|---|---|---|
| 0 | `plan-00-audit` | Research only → `docs/plan/PLAN.md` | 3 (research-only flow) | §9 list | PLAN.md answers every §9 item with file:line evidence; gates stated, none silently decided | **STOP** (user approves PLAN.md) |
| 1 | `plan-01-cycle-engine` | §2, §6 transitions, §4 pool selection, as pure TypeScript with unit tests. No UI, no D1 | 2 | Shared stats for lifetime skill accuracy; level/difficulty helpers | Rules match §2/§6 exactly; slows constant; pool exclusions; no copied stat | — |
| 2 | `plan-02-test-log` | §1, §6 storage + recompute; plan migration; "no plan yet" home button as the entry point; plan list (read-only) after logging | 3 | Progress/mistake/attempt write path; D1 batch caps; map delivery to runtime | Writes per log bounded; map resolution exact; <5-day warning; isolation | **STOP** (user logs a real test) |
| 3 | `plan-03-set-player` | §4: drill / consolidation / maintenance sets in the bank player, no per-question check, two-segment timer (soft default, hard constant), overtime stored, attempts tagged with plan step via the shared path, step completion | 3 | bank-bluebook player/record internals; exam-style no-check mode | Pool exclusions hold in the served set; overtime recorded; tag on attempts; no answer leak during set | **STOP** (timed set on a real Chromebook) |
| 4 | `plan-04-review` | §5: results (score, time vs limit), drill misses via retry-until-correct then explanation, then original test misses the same way | 2 | Retry flow reuse; how original misses are found | Order drill misses → test misses; retries don't re-record first-try results | — |
| 5 | `plan-05-home` | §3: plan as first screen after login, "Start practicing" follows plan order, open any step, step progress, overtime shown on plan, "Take practice test N+1" with recommended date | 2 | Login landing/routing in `index.html` | Button follows order and advances; opening a step out of order doesn't move it | — |
| 6 | `plan-06-e2e-regression` | Tests only: two-cycle walkthrough at 1366×768 + full suite; screenshot tour committed to `docs/plan/tour/` | 1 | — | `e2e.md` covers two full cycles, incl. maintenance entry and return | **STOP** (user looks through the tour) |

**E2E checkpoints** (copy the task's list into `spec.md`; add, never drop). Brief checkpoints are tagged ✦.

- **00:** none (research only). Unit suite baseline recorded.
- **01:** unit tests only: ✦ plan order incl. slows tie-break, then lifetime-accuracy tie-break; ✦ maintenance entry
  after two clean tests; ✦ maintenance + 2 misses → drilling; ✦ maintenance + 1 miss → stays, streak reset, due;
  every-other maintenance schedule; slows-as-misses constant flips the result; ✦ pool excludes attempted, lesson-seen
  and untaken-test questions; fallback to least-recently-seen right answers; shrink when still short; step order
  drills → consolidation → maintenance → next test (+7 days).
- **02:** log a seeded test with Wrong/Slow marks across modules; ✦ the plan's order matches (incl. a slows
  tie-break); the test's questions show as done and misses appear in the mistake log; a second log under 5 days warns
  but saves; logging two clean tests puts a skill in maintenance; signed-out/other-account reads 401/isolated.
- **03:** a drill serves 10 medium then 5 hard in one skill; ✦ no seen or untaken-test question appears (assert IDs
  against the seed); no correctness during the set (leak check); ✦ letting a segment run out turns the clock red and
  records overtime; hard-cutoff constant ends the segment instead; attempts carry the plan-step tag and show in
  stats; short pool → smaller set with a notice.
- **04:** ✦ review shows score and time vs limit, then drill misses (retry until correct, then explanation), then the
  original test miss(es) for that skill; consolidation/maintenance use the same review.
- **05:** after login the plan is the first screen; with no plan only "Log a Bluebook practice test"; ✦ "Start
  practicing" launches the next incomplete step with its filters and advances after each step completes; opening a
  later step directly doesn't change what the button launches; overtime shows on the plan.
- **06:** ✦ two full cycles at 1366×768 (log → drills → consolidation → maintenance → log next test), including a skill
  entering maintenance and one returning to drilling; entire suite green; tour PNGs committed.

## 9. plan-00-audit: what it must establish

Research-only flow: Researcher A (code) ∥ Researcher B (data/tests) → Architect writes `docs/plan/PLAN.md` →
fresh Reviewer → Documentation (`STATUS.md`, handoff) → **STOP**. No feature code, migrations or seeds.

1. **Dependencies (STOP if missing; report exactly what is missing):**
   - *Mapping.* What exists: `tools/ptmap/practice-test-map.json` (generated, tracked) and how complete it is per
     test/module (unmapped positions, unexported module-2 blocks). Whether any **app feature** uses it, i.e. the
     "mapping feature's behavior" §1 reuses (mark the test's questions done, misses to the mistake log). Architect's
     preliminary grep (2026-10-01) found no reader in `src/`, `public/`, `lesson-ui/`: if confirmed, that is a
     missing dependency and plan-00 STOPs with the options (build it as a task here, or wait for it).
   - *bank-bluebook.* Merged in PR #20 (`f6013e3`): confirm the Check/retry flow and `lesson-ui/record.ts` first-try
     rule, and whether the player can run a no-check timed set (exams still use the old `#view-test`).
2. **Map at runtime:** how the Worker/SPA gets the map (it lives under `tools/`, outside `ASSETS`), how a student
   picks which module 2 (easy/hard) they took, and what happens to unmapped positions or unexported modules.
3. **"Marked done" and the mistake log:** the exact existing semantics (progress row? attempt?), what a logged Wrong
   and Slow write, write count per logged test vs the D1 Free-plan budget and the 200/500 batch caps.
4. **Seen questions:** every source of "attempted" (bank attempts/progress, self-paced lesson attempts,
   instructor-paced `session_responses`, lessons the student attended) and of "last seen + right" for the fallback.
5. **Skill and level:** the stored skill field for core and AI rows; what "medium" and "hard" select (core
   Medium/Hard; AI rows are `difficulty='Hard'`, levels 4–5) and whether AI questions belong in drills.
6. **Lifetime bank accuracy per skill:** which shared function supplies it (no new copy).
7. **Plan storage:** proposed tables (test logs, per-skill cycle state, steps/sets with overtime) and migration number
   (next free core number at audit time; recheck), with expected writes per action.
8. **Recording a set:** how attempts get the plan-step tag (precedent: `attempts.lesson_session_id`), when they are
   written (end of set), and how review retries stay out of first-try stats.
9. **Timers and tests:** how a 10:00/7:30 timer is tested without real waits (local e2e entry constant), what the
   e2e seed needs (≥15 medium+hard questions per drilled skill, a fixture practice-test map whose IDs exist in the
   seed), and the existing suite baseline.
10. **Open decisions for the user**, each with options and a recommendation (e.g. whether logged test answers count
    as attempts, the timer limit for 5-hard-only sets (7:30 assumed), where the engine runs: client or Worker).
