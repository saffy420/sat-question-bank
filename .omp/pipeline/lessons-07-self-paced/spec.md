# lessons-07-self-paced — spec

Scope: BRIEF §8.1–8.5 (context: §1, §5 late join, §8.6–8.7 and §11 message contract; AMENDMENTS G2, G3, G5, G6).
Research: skipped (§12.7 research focus "—"; tasks 03–06 handoffs and the code answer every question).

## Decisions (no user gate; recorded for the PR)

1. **One room, two modes.** `LessonRoom` accepts frozen `mode: 'self'` sessions. Instructor-paced paths are unchanged.
2. **Set lifecycle (G6).** Start → `status=live`, `phase=ANSWERING`, `endsAt = startedAt + Σ time_limit_sec` (also written to `lesson_sessions.ends_at`). The set completes once, when the first of these happens: the alarm at `endsAt + 750 ms` (G2 grace), every joined student with a non-empty set has submitted, or the instructor presses **End session**. Completion finalizes every assigned response to D1 in one batch and sets `status=review`, `phase=FINISHED`. A second **End session** (from review) sets `status=ended`. The overview (§8.6) and polls (§8.7) are task 08; in 07 the instructor keeps the final grid and the End session button.
3. **Nothing revealed in 07.** Students see no correctness, explanation or notes during the set or after it. Review mode (08) and My Lessons (09) are where answers appear.
4. **Late join (§8.2).** `lateJoinSet(items, remainingMs, difficultyOf)` lives in `public/shared/lesson.js`. It is computed once, at the student's first join after start, using the server's `endsAt − now`. The result is stored in `session_participants.assigned_question_ids_json` and room state, and it is never recomputed: reconnects and re-joins reuse it. Lobby joins get the full set. Joining during review (G6) is review-only, with an empty set and the message "The set has finished — you can join the review when it starts." Empty fit shows "Not enough time left to join this set — you can join the review when it starts." Zero-assignment students stay in the roster and are excluded from the "everyone submitted" test (G6).
5. **Time accumulation (§8.5 + G5).** New student message `time {questionId, deltaMs, seq}`. The server keeps a per-student boundary (set start, the student's late-join time, or the last accepted time message) and a `timeSeq`. A message with `seq ≤ timeSeq` is a replay and is ignored. Otherwise the server adds `min(deltaMs, min(now, endsAt+grace) − boundary)`: the excess over elapsed server time is rejected, so a client can never be credited more than wall-clock time. It then moves the boundary to now and sets `timeSeq = seq`. Snapshots carry `timeSeq`, so a reconnecting client resends only the unaccepted deltas. Instructor-paced keeps its existing server-measured single segment (question start → lock/end), which is the same mechanism with one visit.
6. **Contract extension (§11).** Student: `navigate {questionId}`, `time {questionId, deltaMs, seq}`, `submitAll` (all listed in §11; `seq` is the G5 replay key). Flags stay on the student's page (Bluebook-style aid, not sent to the server or instructor).
7. **Payload size (slow Wi-Fi).** A student's full self-paced snapshot (join, connect, HTTP resync) carries their assigned questions once, without answers or explanations. Selection acknowledgements carry the snapshot without `questions`, and the client keeps the question list it already has. The instructor's full snapshot carries every question with answer, explanation and notes. The throttled (≤ 4/s) roster refreshes omit the question bodies.
8. **Server grading for the grid.** The admin snapshot carries `grid[userId][questionId] = {answer, correct, ms}`, graded with `isRight`, plus `assigned`, `positions` and `submitted`. It also carries per-question `cards` built with the shared `responseGroups` (users + ms) over assigned students only. No new stat helpers are added.

## Files

- `public/shared/lesson.js`: `lateJoinSet`; new student actions and fields (`navigate`, `time` with `seq`, `submitAll`); validation.
- `src/lesson-room.js`: self mode (initialize with difficulty; start; join assignment; select/navigate/time/submitAll; completion and finalize; alarm; snapshots; review → ended).
- `lesson-ui/Self.tsx` (new): student self-paced view (top bar, Stage, Back/Next, navigator, flag, review page, Submit all modal, submitted/finished/no-fit states); `lesson-ui/index.tsx` routes `mode === 'self'`; `lesson-ui/types.ts`; `lesson-ui/lesson.css`.
- `public/index.html` bridge: self-mode selections, navigation, visit/time tracking (leave on navigate/submit/hidden/socket close/deadline; resume on return/visible/reconnect), outbox resend by `timeSeq`, `submitAll`.
- `admin-ui/Live.tsx` (+ `admin.css`): self-paced instructor view: header (code, Joined, Submitted, timer, End session), student × question grid (■ right, □ wrong, ◆ current, · not reached, ░ not assigned), column header → question card (answered x/assigned, accuracy, avg time of visitors vs set time, distribution with click → names · time, question + explanation + notes collapsed).
- `tests/test_lesson_room.cjs`: unit tests below. `tests/e2e/lessons-07-self-paced/`: e2e spec. Seeds only if needed (extra owned questions for a larger grid).

## Required unit tests (exact)

- §8.2 late join: 4×30 s + 10×60 s, R = 8:00 → eight 60 s; 4×45 s + 6×30 s + 5×60 s, R = 8:00 → all five 60 s + all four 45 s, no 30 s; same lesson, R = 8:30 → those nine + one 30 s. Output in original lesson order; tie-break by difficulty, then position.
- §8.5: Q1 10 s → Q2 5 s → Q1 7 s ⇒ Q1 = 17 s, Q2 = 5 s exactly (fake clock). Plus: replayed seq ignored; an inflated delta is cut to elapsed server time.
- Subset never recomputed: a late joiner's set survives reconnect/re-join and a later time.
- Student self snapshot: no answer, explanation, notes, trap or peer names; only assigned questions; no `questions` on selection acks.
- Completion: auto at `endsAt + grace` finalizes current selections (locked_early 0) and submitted ones (locked_early 1), one row per assigned question (blank = null answer, `is_correct` 0 for scorable), none for unassigned; once only (re-alarm writes nothing); early completion when all non-empty-set students submitted; `select` after submit/after completion rejected; End session from review → ended.

## E2E checkpoints (§12.7, copied; may add, never drop)

1. Full self-paced run: Next / Back / navigator / flag work.
2. Review page (answered / unanswered / flagged).
3. Submit-all modal ("Have you double checked your answer and made sure it's right?"; Go back keeps editing; Yes locks, shows "Submitted. Waiting for the session to end.").
4. Auto-submit at the shared end for a student who didn't submit (their current selection becomes final; the grid shows it).
5. No correctness, explanation, or notes shown during the set (leak helper on every student context; DOM check).
6. Visiting a question twice shows accumulated time in the instructor card.
7. A late joiner gets a smaller set whose times fit the remaining time the server reported, and the instructor grid shows ░ for their unassigned questions.
8. (added) Late joiner's set is unchanged after a reconnect (not recomputed).
9. (added) Early completion: the set ends as soon as every joined student has submitted.
10. (added) Instructor-paced regression: full existing suite green.

Student screenshots at 1366×768 in `.omp/pipeline/lessons-07-self-paced/e2e/`.

## Task review items (§12.7 + §12.6)

- §8.2 and §8.5 unit tests pass exactly; subset never recomputed.
- Rule 5: no answer/explanation/notes/grades in any student payload during the set (self mode reveals nothing in 07).
- Rule 4: clock, completion, assignment and time bounds decided in the DO.
- Rule 6: selections/time/navigation stay in DO storage; D1 writes only at join (participant row), start (status/ends_at), completion (one batch) and end.
- Rule 2: grid/card use `isRight` and `responseGroups`; no new stat copies.
- Rule 7: no overview/poll/review mode (08), no attempts write-back or My Lessons (09).
