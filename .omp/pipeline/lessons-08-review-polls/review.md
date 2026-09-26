# lessons-08-review-polls — review

Diff reviewed: `git diff claude/lessons-07-self-paced...HEAD` (through 9a45c15a + e2e report), against `spec.md` and BRIEF §12.6.

## Findings (listed before fixing)

| # | Severity | Where | Finding |
|---|---|---|---|
| B1 (A1) | Blocker | `src/lesson-room.js` `reviewPayload` | The student review snapshot keeps the set's `endsAt`. After an early finish that time is still ahead, so the student `Player` shows a running "0:26 / Hide" clock during an untimed review. That misleads students (§8.7: review is instructor-paced REVEALED, which has no clock). |
| B2 | Blocker (§8.7 / §13 "closes early when all connected students vote") | `src/lesson-room.js` `webSocketClose` | Early close is checked only on a vote, a kick or the deadline. If the last student who hasn't voted drops off, everyone still connected has voted, but the poll waits out the full 30 s. |
| N1 | Non-blocking (decision) | poll | Poll/result travel in snapshots (`poll`, `pollResult` fields) rather than separate §11 message types (spec decision 7). Every phase change in this room already travels by snapshot. |
| N2 | Non-blocking (decision) | student poll | The dropdown shows the student's own ✓ / ✗ for questions not yet reviewed. The brief requires this; it reveals no correct answers or peers. |
| N3 | Non-blocking | `admin-ui/Live.tsx` review mode | The review-mode response list (and its Manage students roster) shows only students assigned the question, so a zero-assignment student can't be removed from that screen. The overview and poll screens list everyone. |
| N4 | Non-blocking, pre-existing | `webSocketClose` | `ws.close(code)` throws on 1006 (known since task 06; task 10 candidate). The B2 fix must run before that call. |

## §12.6 checklist

- **(a) Rule 5: PASS.**
  - Student FINISHED/POLL/POLL_RESULT snapshots carry no answers, explanations, notes or names. The poll options carry only lesson numbers and the student's own marks.
  - Review mode sends the current question's answer and explanation, which is REVEALED-equivalent, and never notes (G6).
  - Unit tests cover this, and so does e2e `captureLeaks` (phase-aware, peers) on 4 students.
- **(b) Rule 4: PASS.** The poll deadline, early close, winner, the 3 s result and the move to review are all DO decisions (alarm plus re-check on message/connect). Clients only display them.
- **(c) Rule 6: PASS.**
  - Votes, reviewed questions and poll state stay in DO storage.
  - D1 writes happen only on Next / End session (`session_question_review`, as instructor-paced) and at the final end.
  - Unit test: zero `session_responses` writes during poll and review.
- **(d) Rule 2: PASS.** `setResults` (using `isRight`) is the single source for the overview, the most-missed ranking and the poll's most-missed. Distributions use `responseGroups`. Nothing is duplicated.
- **(e) Rule 7: PASS.** No My Lessons, write-back or bank filter.
- **(f) PASS.** Every spec checkpoint 1–10 has an asserting step (`e2e.md`).
- **(g) PASS.** No `.skip`/`.only`/`fixme`, and no inflated timeouts (the 180 s test timeout covers a 35 s set plus two polls).
- **(h) PASS.** No fixed sleeps.
- **(i) PASS.** The `test(lessons-08)` commit touches only `tests/e2e/`.
- **(j) PASS.** `e2e.md` shows the full suite (24/24).
- **(k) PASS.** The diff contains only task 08 work. The instructor-paced guard (spec decision 10) is needed for `vote`.
- **Task items: PASS.**
  - Early close: unit + e2e.
  - Tie rules: `pollWinner` unit tests for split, zero votes, pick ties by wrong count, then order.
  - Reviewed-question exclusion: unit + e2e.
  - Reviews change no data: unit + e2e (overview deep-equal, grid answers, disabled choices).

Verdict before repairs: **2 blockers (B1, B2)**, leading to repair round 1.
