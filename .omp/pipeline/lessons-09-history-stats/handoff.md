# Task 09 handoff — lessons-09-history-stats

## Status
Complete locally, and the PR is open (see state.md). Review PASS after 2 repair rounds. Blockers fixed:
- stale lesson usage after a lesson;
- the history error sent to the save banner;
- the history view opening blank;
- dropdown label overflow;
- usage badge overflow.

## Shipped (BRIEF §9, §10; §2 usedInLesson; §3.2 Lessons tab, deferred by G4)

**Self-paced write-back (§10, G3, G6)**
- **When:** set completion adds one attempt per assigned **scorable** question for each student.
- **Attempt fields:**
  - `ts` = completion time;
  - `correct` from `isRight`;
  - `picked` = the final answer, or null for a blank;
  - `time_taken_ms` = accumulated time;
  - `changes`;
  - `answer_history_json`;
  - `lesson_session_id`.
- **Progress:** each question moves through the shared marker rule. Blank means Red.
- **Excluded:** unscorable and unassigned questions get nothing.
- **Atomicity:** the write-back rides the same D1 batch as `session_responses`, so it is all or nothing.
- **Exactly once:**
  - migration `0010_lesson_attempts.sql` adds `attempts.lesson_session_id` and a partial unique index `(lesson_session_id, user_id, question_id)`;
  - each progress upsert is guarded by `NOT EXISTS(that lesson attempt)` and runs before the attempt insert.
  - A replayed batch changes nothing (real-SQLite unit test).

**Shared path (rule 2)**
- `public/shared/stats.js` `nextProgress` / `attemptRow`: the SPA's `recordProgress` / `recordAttempt` now call them, and so does the room.
- `src/record.js` `progressStatement` / `attemptStatement`: the only progress and attempt SQL, used by `POST /api/progress`, `POST /api/attempts` and the write-back.

**Instructor-paced isolation**
- Nothing on the instructor-paced path writes attempts or progress (unit + e2e deep-equal).

**Usage (§2)**
- The final End session batch inserts `question_lesson_usage` for the questions shown:
  - instructor-paced: items `0..index` after leaving the lobby;
  - self-paced: the union of assigned sets.
- `/api/questions` carries `usedInLesson` (padded, oldest first).
- `/api/lesson-history` also returns the usage of attended sessions' questions, so the page refreshes badges and the filter after a lesson.

**Bank filter (§9.2)**
- **Where:** a **Lesson questions** dropdown in the practice filter bar.
- **Options:**
  - Show all (the default);
  - Hide questions from lessons I attended (based on `session_participants`);
  - Hide all lesson questions.
- **Shared logic:** `lessonUsageVisible` in `shared/lesson.js` serves both the bank and the builder. The builder's third option is "Hide questions from lessons I ran": sessions of lessons the admin created.
- **Badges:** usage badges appear in Browse and on Mistakes cards.

**My Lessons (§9.1)**
- **List:** a new nav tab showing session, title, date, mode and score (`lessonScore` = right ÷ scorable).
- **Opening a session:** it opens a read-only history overlay (`lesson-ui/History.tsx`), one question at a time. Each question shows:
  - the real Stage with the saved annotations;
  - "Your answer" / "Correct answer", or "Not in your set" / "No response recorded";
  - the explanation;
  - **Breakdown** (the notes via `notesHTML`, now in `lesson-ui/notes.ts`);
  - the saved final Desmos state, read-only with no fork.
- **API:** `GET /api/lesson-history/:id` returns 404 until the session is `ended`, and for non-participants (G6).

**Tags and the admin Lessons tab**
- **Mistakes tag:** a card shows "Lesson 00003" when the question's latest attempt came from a lesson. Admin Mistakes and History rows show the same tag.
- **Admin Lessons tab:** session, title, mode, date, score, and whether it counts toward stats (self-paced Yes).

## Evidence
- Unit **97/97**. New `tests/test_lesson_history.cjs` covers:
  - the marker rule;
  - the filter, score and shown sets;
  - the 0010 upgrade versus the fresh snapshot;
  - exactly-once write-back on real SQLite;
  - instructor-paced isolation;
  - usage at end;
  - the history API and its gates;
  - bank usage, source tags and the admin Lessons data.
- E2E task spec 1/1. Full suite **25/25** (three consecutive green runs across repair rounds). Screenshots are in `.omp/pipeline/lessons-09-history-stats/e2e/` (gitignored).

## Deviations / decisions (spec.md "Decisions")
1. **Write-back happens at set completion** (G6), not at the final end.
2. **"The existing path"** means shared helpers per layer: the browser rule in `stats.js`, the Worker SQL in `record.js`. The DO does not call its own HTTP API.
3. **Unscorable questions record nothing** (as practice does). Blank scorable questions are recorded as wrong (G3).
4. **Usage is written at the final end**, for the questions shown. A session ended in the lobby records none.
5. **History uses its own path** (`/api/lesson-history`), off the live leak-scanned channel, and shows the **current** bank question body. Notes, answers and review marks come from the session.
6. **Builder third option** is "Hide questions from lessons I ran".
7. **E2E fixtures:**
   - `e2e-student-6` takes the self-paced specs (07/08/09), because student 1's seeded stats are pinned by the dashboard specs. This needed one line in the local-only `src/index.e2e.js` allowlist.
   - Three fixed-usage filter questions. The bank fixture count is 7 and the members count is 6.

## Open items / next tasks
- **Task 10:** full regression plus a screenshot tour. `webSocketClose` still calls `ws.close(1006)` (known since task 06).
- **Non-blocking:**
  - N2: an unused `notesHTML` re-export in `lesson-ui/index.tsx`;
  - N3: two score functions over different inputs (live state versus stored `is_correct`).
- **Manual:** D1 batch size at class scale (25 × 20 ≈ 1,500 statements in the completion batch).

## Manual checks for you
- **Spot-check stats after a real self-paced lesson.** The student's mistake log should show "Lesson NNNNN", and the dashboard accuracy, pacing and second-guessing should include the lesson answers. An instructor-paced lesson should change none of them.
- **Check My Lessons on a Chromebook:** the Breakdown formatting, saved highlights, the final graph, and the filter options.
- **Before deploying:** apply `migrations/0010_lesson_attempts.sql` to the production core DB.
