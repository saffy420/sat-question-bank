# lessons-07-self-paced — review

Diff reviewed: `git diff claude/lessons-06-desmos...HEAD` (through 817dc642 + e2e report), against `spec.md` and BRIEF §12.6.

## Findings (listed before fixing)

| # | Severity | Where | Finding |
|---|---|---|---|
| B1 (A4) | Blocker | `src/lesson-room.js` start / join | `positions` is set only by a student `navigate`. So at start (everyone on Q1) and right after a late join, the instructor grid shows no ◆ until the client's reconnect `navigate` arrives. §8.4 needs ◆ = currently on. |
| B2 (A1) | Blocker | `admin-ui/Live.tsx` footer | "Show class results" is still visible in self-paced mode (`hidden` is overridden by `.toggle { display:flex }`). §8.4 has no class chart, so the control is dead there. |
| B3 (A2) | Blocker | `admin-ui/SelfLive.tsx` card | The card's "Question, explanation & notes" reuses `.instructor-drawer` (the instructor-paced vertical rail), so it renders as a 38 px sideways strip. The question and notes are unreadable. |
| B4 (A3) | Blocker | `admin-ui/admin.css` `#self-grid tbody th` | `display:flex` on a table header cell breaks table layout: the name column is misaligned and over-wide. |
| B5 (A5) | Blocker | `lesson-ui/Self.tsx` header | The student's "Hide/Show" timer button stays visible after the set, when there is no clock. |
| B6 | Blocker (brief constraint: small events on slow Wi-Fi) | `selfSnapshot` admin projection | The throttled (≤ 4/s) instructor refresh is 56,520 bytes for 25 students × 20 questions (measured: `.wrangler/size07.mjs`), because each card's `groups[].users` repeats every student's name and time already in `grid` + `roster`. Send student IDs in the groups and resolve names/times on the laptop from `roster`/`grid`. |
| N1 | Non-blocking (decision) | student UI | Flags stay in the student's page (spec decision 6). They survive Wi-Fi drops (no reload) but not a page reload. Listed for the PR. |
| N2 | Non-blocking (decision) | §8.5 instructor-paced | Instructor-paced keeps its server-measured single segment (question start → lock/end); spec decision 5. No behaviour change for task 04. |
| N3 | Non-blocking, pre-existing | `initialize` | If DO storage were lost mid-session, the room re-initializes from D1 at `phase: READY` with no clock (same as instructor-paced since task 03). Not widened here. |
| N4 | Note | student payloads | Student full snapshot: 21.7 KB (whole 20-question set, once per join/connect/start). Acks: 582 bytes. |

## §12.6 checklist

- (a) Rule 5: self-paced student snapshots use `lessonQuestion(q)` without reveal, contain only the student's own set, selections and position, and no grades, explanations, notes or peer names. The server sends nothing revealing in 07. Unit test + e2e leak capture (now also `questions[].answer`) + DOM checks. PASS.
- (b) Rule 4: the shared clock, completion (deadline + grace, all submitted, End session), late-join fitting and time bounds are all computed in the DO; the client only displays them and freezes at its local deadline. PASS.
- (c) Rule 6: selections, navigation and time are DO storage only (unit: zero D1 writes across time events). D1 writes happen at join (participant row, already existing), start (status + `ends_at`), completion (one batch: responses + finished_at + status) and final end. PASS.
- (d) Rule 2: grading via `isRight`; distribution via `responseGroups`; no new stat helpers. PASS.
- (e) Rule 7: no overview/polls/review mode (08), no attempts write-back or My Lessons (09). After the set the instructor keeps the §8.4 grid. PASS.
- (f) Every spec checkpoint has an asserting spec (e2e.md table, 1–10). PASS.
- (g) No `.skip/.only/fixme`, no loosened assertions. The only explicit timeout is bounded by the room's own `endsAt` (+5 s), and the late-join poll by the reported remaining time. PASS.
- (h) No fixed sleeps: dwelling waits on the student's countdown ticking. PASS.
- (i) The `test(lessons-07)` commit touches only `tests/e2e/`. PASS.
- (j) e2e.md shows the full suite (23/23). PASS.
- (k) The diff contains only task 07 work. PASS.
- Task items: §8.2 three exact cases and §8.5 17 s/5 s pass exactly (unit). Subset never recomputed: unit (re-join and later clock) + e2e checkpoint 8. PASS.

Verdict before repairs: **6 blockers (B1–B6)** → repair round 1.

## Repair round 1 (`f3c29388` fix; tests `636a1155`, `5e1de1c8`)

- B1: the room sets `positions[user]` to the first assigned question at start and at a live late join. Unit: "self-paced start puts every lobby student on their first question" + late-join position assertion. E2E: ◆ on Q1 for both students right after Start, and on the late joiner's first question.
- B2: the class-results toggle is not rendered for self-paced rooms.
- B3: the card's question/explanation/notes use their own `.self-card-details` collapsible section (screenshot 10: normal row, opens in place).
- B4: grid name cells stay table cells (badges inline).
- B5: the student timer Hide/Show button renders only while the set clock runs (screenshot 11).
- B6: compact instructor projection: `grid[user][q] = [answer, correct, ms]`, card groups list indexes into `students`, and the unused `assigned` map is dropped. 25 students × 20 questions: lite refresh **56,520 → 23,133 bytes** (full 78,694 → 45,307). Unit asserts cards carry no repeated names.
- Reran: unit **85/85**, typecheck clean, task specs 2/2, full suite **23/23** (2.4 min; Desmos latency 272–285 ms in the same run).
- Re-review of the repair diff: changes are limited to the six findings. The e2e spec only changed to read the new cell shape and to assert ◆. No regression in instructor-paced (task 04/05/06 specs green) and no new student payload fields.

Verdict after round 1: **PASS**.
