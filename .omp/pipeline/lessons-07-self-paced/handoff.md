# Task 07 handoff — lessons-07-self-paced

## Status
Complete locally; PR open (see state.md). Review PASS after 1 repair round (6 blockers, all UI/payload).

## Shipped (BRIEF §8.1–8.5)
- **Protocol** (`public/shared/lesson.js`): student `navigate {questionId}`, `time {questionId, deltaMs, seq}`, `submitAll`. `lateJoinSet(items, remainingMs, difficultyOf)` implements §8.2 (longest first; ties Hard > Medium > Easy, then position; skip what doesn't fit; lesson order).
- **Room** (`src/lesson-room.js`), self mode:
  - **Start:** `endsAt = start + Σ limits` (written to `lesson_sessions.ends_at`); every student is placed on Q1.
  - **Late join:** fitted once to the server's `endsAt − now`, stored in `session_participants.assigned_question_ids_json` and the room, and never recomputed. Joins during review get an empty set (G6).
  - **Select / navigate / time:** kept in DO storage only. Time is the sum of visits, bounded by server time elapsed since the last accepted boundary, and replay-safe by `seq` (G5).
  - **Completion, once:** at `endsAt + 750 ms`, when every student with a non-empty set has submitted, or on the first **End session**. One D1 batch writes every assigned response (blank = null, `is_correct` 0 when scorable; `locked_early` = used Submit all), `finished_at`, and `status='review'`. A second **End session** ends the session.
- **Student** (`lesson-ui/Self.tsx`, bridge in `public/index.html`):
  - **Layout:** top bar "Q x / set size", ⚑ flag, and the remaining clock.
  - **Footer:** Back, a navigator (answered/unanswered/flagged, Go to Review Page) and Next.
  - **Finishing:** Next on the last question opens the review page, which has **Submit all** and the brief's modal. After that it shows "Submitted. Waiting for the session to end.", auto-submit/finished notices, the no-fit and review-only messages, and "Session ended."
  - **Time tracking:** a visit segment ends on navigation, submit, a hidden tab, a closed socket or the deadline, and resumes on return. Unaccepted segments are resent after reconnect.
  - Nothing is revealed.
- **Instructor** (`admin-ui/SelfLive.tsx`, `Live.tsx`):
  - **Header:** code, Joined, Submitted, clock, End session.
  - **Grid:** student × question (■ right, □ wrong, ◆ current, · not reached, ░ not assigned), graded by the room, with late-join and submitted badges.
  - **Column header → card:** answered x/assigned, accuracy, avg time of visitors vs the set time, and a distribution whose bars list name · accumulated time. Question, explanation and notes are collapsed.

## Evidence
- Unit **85/85**, including the three exact §8.2 cases and §8.5 Q1 17 s / Q2 5 s. They also cover replay/inflation, never-recomputed sets, payload secrecy, completion once, early completion and End session twice.
- E2E task 2/2; full suite **23/23** (twice). Screenshots in `.omp/pipeline/lessons-07-self-paced/e2e/` (gitignored).
- Payload sizes (25 students × 20 questions): student full snapshot 21.7 KB (once per join/connect/start), student ack 582 B, instructor refresh 23.1 KB (≤ 4/s).

## Deviations / decisions (spec.md "Decisions")
1. **End session twice (G6):** during the set, End session finishes the set (status review); pressing it again ends the session. The overview (§8.6) and polls (§8.7) arrive in task 08.
2. **Time bound:** a delta larger than server-elapsed time is cut to the elapsed time rather than dropped whole, so network jitter can't erase a real visit. Totals still can't exceed wall-clock time. `seq` is the G5 replay key (a §11 contract extension).
3. **Flags stay on the student's page.** They survive a Wi-Fi drop but not a page reload, and the instructor doesn't see them.
4. **Instructor-paced time is unchanged:** a server-measured single segment (question start → lock/end).
5. **Late join during review:** the student joins review-only with an empty set (G6). A student with no set is excluded from the "everyone submitted" check.

## Open items / next tasks
- Task 08 builds the overview/polls/review mode on `status='review'`/`phase='FINISHED'`. Per-question denominators are already in `cards[q].assigned` (assigned students only). Review mode must reuse the REVEALED gate for annotations/Desmos.
- Task 09 does the self-paced write-back into attempts/progress from the finalized `session_responses` (rows exist for every assigned question, with `time_spent_ms`, `answer_changes` and `answer_history_json`).
- Pre-existing (task 03): if DO storage is lost mid-session, the room re-initializes at READY with no clock; and `webSocketClose` throws on 1006 (still open, candidate for task 10).

## Manual checks for you
- A self-paced run on real Chromebooks (school Wi-Fi): navigation speed, navigator and review page at 1366×768, Submit all, auto-submit at the end.
- Join one Chromebook late and check that its set fits the time left and that ░ appears in your grid.
- Leave one Chromebook on a question, return to it later, and check that its time adds up in the card.
