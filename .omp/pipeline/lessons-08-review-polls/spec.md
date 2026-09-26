# lessons-08-review-polls — spec

Scope: BRIEF §8.6–8.7 (context: §6.2–6.3 REVEALED, §7 annotations/Desmos, §8.2 denominators, §11 contract; AMENDMENTS G1, G3, G6).
Research: skipped (§12.7 research focus "—"; the task 07 handoff and the code answer every question).

## Decisions (no user gate; recorded for the PR)

1. **Review sub-phases.** After set completion (`status=review`), the room moves through phases:
   - `FINISHED`: overview and poll launcher;
   - `POLL`: 30 s vote;
   - `POLL_RESULT`: result shown for 3 s;
   - `REVEALED`: review mode on one question, with `s.index` pointing at it.

   Review mode deliberately reuses the instructor-paced `REVEALED` phase, so the existing annotation, laser and Desmos gates (REVEALED + current question) apply unchanged. The alarm drives every deadline. Deadlines are also re-checked on each message and connect.
2. **"Wrong" and denominators.** A question's wrong count covers only students assigned it whose final answer is not right by `isRight`.
   - A blank on a scorable question counts as wrong (G3).
   - An unscorable question is never wrong.
   - The denominator is the number of students assigned the question (§8.2).
   - Most-missed ranking breaks ties by lesson order. That is PLAN's recommended deterministic fallback.
3. **Class summary.**
   - A student's score is right ÷ scorable assigned questions.
   - The mean and median cover only students with a non-empty set (G6).
   - "Completed" counts students who answered every assigned question. The UI labels it that way.
4. **Poll rules (§8.7).**
   - **Clock:** 30 s. Votes are accepted until `endsAt + 750 ms`, the same grace as answers (G2).
   - **Voters:** the students connected when the poll is checked, including zero-assignment students (G6). A student may change their vote until the poll closes.
   - **Option 2** counts only with a dropdown pick from the poll's list.
   - **Early close:** as soon as every connected student has a counted vote.
   - **Winner:** option 2 needs strictly more votes than option 1. Otherwise (including ties and zero votes) the most-missed question wins.
   - **Option 2's question:** the pick chosen most often. Ties go to the question more students got wrong, then to lesson order.
   - **Exclusions:** reviewed questions are excluded from both options. The most-missed question also appears in the dropdown.
   - **Nothing left:** a poll with no unreviewed question is refused ("Every question has been reviewed").
5. **Launcher actions.**
   - **Start review poll.**
   - **Review a specific question** (`goto`): skips the poll and marks the question reviewed.
   - **End session** (unchanged: ends the session).
   - **Next** in review mode returns everyone to the launcher. It flushes that question's annotations and Desmos state to `session_question_review`, as instructor-paced `next` does.
   - **Ending the review:** "I can also end the review" means **End session**, which stays available in every review phase.
6. **Lesson numbering in polls and review.** Poll labels are shared, so polls and review use lesson positions ("Q7"). A late joiner's own set numbering applies only during the set.
7. **Contract (§11).**
   - **New actions:** instructor `startPoll` and `goto {questionId}`; student `vote {option, questionId?}`.
   - **`poll` / `pollResult` delivery:** they ride in role-specific snapshots as `poll` / `pollResult` fields, not as separate message types. Snapshots already carry every phase change in this room. The student's poll options carry their own ✓ / ✗ / "not in your set" marks and nothing about peers.
8. **Student review view.** This is the instructor-paced REVEALED `Player`. It shows:
   - the correct answer, the student's own recorded answer (or **"Not in your set"**) and the collapsed explanation;
   - live annotations and Desmos;
   - the anonymous class chart when the instructor turns it on, counting assigned students only.

   Notes are never sent: they unlock in My Lessons after `ended` (G6, task 09). Other questions' answers are never sent.
9. **Reviews change no data.** During review, `select`, `lock`, `navigate`, `time` and `submitAll` are rejected, and nothing writes `session_responses`. The only D1 writes in this task are `session_question_review` rows at Next / End session.
10. **Guard fix.** Instructor-paced students sending self-paced-only actions (`navigate`, `time`, `submitAll`, `vote`) now get `invalid action`. Before, they fell through to the lock branch. This matters now that `vote` exists.

## Files

- `public/shared/lesson.js`:
  - `startPoll`, `goto` and `vote` validation;
  - `setResults()`: per-student right / scorable / assigned / answered / ms, and per-question assigned / wrong. It uses `isRight`;
  - `mostMissed()` and `pollWinner()`.
- `src/lesson-room.js`:
  - add `skill` to the frozen question load;
  - admin snapshot adds `overview` in review, a review-mode question payload, and `poll` tallies;
  - student snapshot adds poll options / vote / result and a review-mode payload;
  - handlers for `startPoll`, `vote`, `goto`, `next` in review, and `classResults` in review;
  - poll deadlines in `advance()`.
- `lesson-ui/Poll.tsx` (new): student poll and result screens. Also `lesson-ui/index.tsx` (route review mode to `Player`, poll phases to the poll screens), `Self.tsx` (launcher wait notice), `types.ts`, `lesson.css`.
- `public/index.html` bridge: `vote`.
- `admin-ui/Review.tsx` (new):
  - overview (class summary, sortable student table with per-question drill-down, most-missed list opening the question card);
  - launcher (Start review poll, Review a specific question, End session);
  - instructor poll and result panels.
- `admin-ui/Live.tsx`: route self-paced review phases, reuse the instructor-paced REVEALED layout for review mode, and add the Next and class-results controls.
- `admin-ui/SelfLive.tsx`: export `QuestionCard`.
- `admin-ui/admin.css`.
- `tests/test_lesson_room.cjs`: unit tests below. `tests/e2e/lessons-08-review-polls/`: e2e spec.

## Required unit tests

- `setResults`/`mostMissed`:
  - denominators are assigned students only;
  - blank scorable counts wrong, unscorable never does;
  - ranking ties go to lesson order;
  - reviewed questions are excluded;
  - mean and median exclude zero-assignment students.
- `pollWinner` tie rules:
  - option 2 needs strictly more votes;
  - 1–1 goes to most-missed;
  - 0–0 goes to most-missed;
  - a pick tie goes to the pick with more wrong, then to lesson order.
- Room:
  - startPoll only from FINISHED in self mode;
  - option 2 without a pick is rejected and not counted;
  - early close when every connected student has voted (a disconnected student doesn't block it);
  - the 30 s deadline closes the poll with no votes to most-missed;
  - the result lasts 3 s, then REVEALED on the winner;
  - the reviewed question is excluded from the next poll;
  - `next` returns to FINISHED;
  - `goto` skips the poll.
- Reviews change no data:
  - no `session_responses` writes during poll and review;
  - student select/submit rejected;
  - recorded answers unchanged.
- Payload secrecy:
  - student poll/result snapshots carry no answers, explanations, notes or peer names;
  - a review-mode student snapshot carries only the current question's answer and explanation, plus their own answer or `notInSet`.
- Instructor-paced students' `vote` / `navigate` no longer lock.

## E2E checkpoints (§12.7, copied; may add, never drop)

1. The overview ranks most-missed correctly with per-question denominators (a late joiner makes denominators differ).
2. The poll closes early when all students vote.
3. Option 2 requires a dropdown pick.
4. A split vote resolves to most-missed.
5. Review mode syncs annotations (instructor highlight → student).
6. A reviewed question disappears from the next poll.
7. (added) Review mode shows each student their own recorded answer or "Not in your set", with the correct answer and explanation; no notes; the leak helper stays clean on every student.
8. (added) Reviews change no data: the student can't change answers, and the overview and grid scores are unchanged after the reviews.
9. (added) **Review a specific question** skips the poll; **Next** returns to the launcher; **End session** ends it.
10. (added) The full existing suite is green.

Student screenshots at 1366×768 in `.omp/pipeline/lessons-08-review-polls/e2e/`.

## Task review items (§12.7 + §12.6)

- Early close, tie rules, reviewed-question exclusion; reviews change no data.
- Rule 5: students get no answer, explanation or notes in the overview/poll/result phases. They get only the reviewed question's answer and explanation in review mode, and never peers' names.
- Rule 4: poll timing, winner and review transitions are decided in the DO (alarm-driven).
- Rule 6: votes stay in DO storage. D1 writes happen only at Next / End session (review annotations and Desmos).
- Rule 2: scoring uses `isRight`, and distributions use `responseGroups`. `setResults` is the single source for the overview and the poll's most-missed.
- Rule 7: no My Lessons, no attempts write-back, no filter (task 09).
