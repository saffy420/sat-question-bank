# lessons-09-history-stats — spec

**Scope:**
- BRIEF §9.1 (My Lessons), §9.2 (bank filter), §10 (stats write-back and isolation);
- the §2 `usedInLesson` / `question_lesson_usage` writer;
- the §3.2 admin **Lessons** tab and the Mistakes "Lesson 00003" tag. Both were deferred here by G4; PLAN task 09 includes "complete populated admin Lessons tab".
- **Context:** AMENDMENTS G1, G3 and G6.

**Research:** `research.md`, done inline with no subagent.

## Decisions (no user gate; recorded for the PR)

1. **Write-back happens at set completion (G6), not at the final end.**
   - `completeSet` already puts every assigned response in one D1 batch.
   - Attempts and progress join that same batch. It is atomic, so responses and stats land together or not at all.
   - G6 ("write-back via shared path at this point") overrides §10's "when a self-paced session ends". Results are immutable during review, so the data is the same either way.
2. **"The same code path" is one shared helper per layer.**
   - **Browser and DO:** `nextProgress(prev, ok, now, ms)` holds the marker rule. The SPA's `recordProgress` calls it and so does the write-back. `attemptRow(...)` builds the attempt shape.
   - **Worker:** the `POST /api/progress` and `POST /api/attempts` SQL moves into `src/record.js` (`progressStatement`, `attemptStatement`). The HTTP handlers and the DO write-back both use it, so the question-exists guards and column handling are shared.
3. **Mapping per assigned question** (self-paced only):
   - **Scorable:** one attempt with:
     - `ts` = set completion time (ISO, fixed across retries);
     - `correct` from `isRight`;
     - `picked` = the final answer or null;
     - `time_taken_ms` = accumulated `time_spent_ms`;
     - `changes`;
     - `answer_history_json` = the recorded history, or null when blank;
     - `lesson_session_id`.

     Also one progress update through `nextProgress`.
   - **Blank scorable:** `picked=null`, `correct=0`, marker Red (G3).
   - **Unscorable** (`isRight` null): no attempt and no progress. This matches `grade()`, which records nothing for `ok === null`.
   - **Unassigned:** nothing.
4. **Exactly once.**
   - **Schema (migration `0010_lesson_attempts.sql`):** `attempts.lesson_session_id INTEGER` (the source tag), plus a partial unique index on `(lesson_session_id, user_id, question_id)`.
   - **Progress guard:** each progress statement carries `AND NOT EXISTS(the lesson attempt)` and runs before that attempt's `INSERT OR IGNORE` in the same batch.
   - **Result:** a retried batch, after a crash between D1 commit and pending delete, changes nothing.
   - **Freshness:** progress is read afresh on every flush attempt.
5. **Instructor-paced isolation:**
   - Nothing on the instructor-paced path calls the write-back.
   - The instructor-paced flush builds no attempt or progress statements. A unit test asserts this, and e2e does too.
6. **Usage rows (§2 `usedInLesson`).**
   - **When:** the final End session writes `question_lesson_usage` (`INSERT OR IGNORE`) in the same batch as `status='ended'`.
   - **Which questions count as "shown":**
     - instructor-paced: items `0..index` once the session left the lobby;
     - self-paced: the union of assigned sets once started.
   - **A session ended in the lobby** records none.
   - **Where it appears:** `/api/questions` adds `usedInLesson` (padded IDs, oldest first) to every question, and so does `/api/admin/questions` (already there).
7. **One shared usage filter.**
   - `lessonUsageVisible(used, mode, attended)` in `public/shared/lesson.js`, with modes `show-all` (default) / `hide-attended` / `hide-all`.
   - Both the student bank filter and the admin builder filter use it.
   - **Student "attended":** sessions where they have a `session_participants` row.
   - **Admin "attended":** sessions of lessons they created, since they ran them. The builder gets the third option too (§9.2 "works the same in the admin builder filter").
8. **Student history API** (post-end only, off the live leak-scanned `/api/lessons/*` channel):
   - **`GET /api/lesson-history`:**
     - Returns `{ attended: [paddedId…], sessions: [...] }`.
     - `attended` covers every session they have a participant row for.
     - `sessions` lists **ended** ones only, newest first. Each entry has `sessionId`, `paddedId`, `title`, `mode`, `date`, `score {right, scorable}`.
   - **`GET /api/lesson-history/:id`:**
     - Refused with 404 unless the session is `ended` and they have a participant row (G6: notes unlock at `ended`).
     - Returns the questions shown, in lesson order and numbering. Each has the question (answer and explanation included), `notes` (Breakdown), their final answer, correctness, `inSet` (for self-paced late joiners), saved `annotations`, saved `desmos` state, and a `desmosKey`.
     - For instructor-paced, a question they have no row for (they joined later) reads "No response recorded".
   - **Score:** `lessonScore(rows)` in shared `lesson.js` = right ÷ scorable over their `session_responses`. The same function feeds the admin Lessons tab.
9. **My Lessons UI.**
   - **Entry point:** a new SPA nav tab, **My Lessons**, with a table (Session, Title, Date, Mode, Score).
   - **Opening a session** mounts a lesson-ui `LessonHistory` view. It shows one question at a time, with a numbered navigator and Prev/Next (one Desmos instance at a time, for Chromebooks). Each question shows:
     - the question on the real `Stage`, with the saved annotations painted read-only;
     - "Your answer" / "Correct answer" / verdict, or "Not in your set";
     - the official explanation;
     - **Breakdown** (the notes through the same `notesHTML` renderer, moved from `admin-ui/helpers.ts` to `lesson-ui` and re-exported);
     - a read-only Desmos with the final state and **no fork button**.
10. **Badge and tag.**
    - **Badge:** questions with `usedInLesson` show a small "Lesson 00001, 00004" badge in the Browse table and on Mistakes cards.
    - **Tag:** a Mistakes card whose latest attempt came from a lesson shows a "Lesson 00003" tag. The admin Mistakes tab and admin History rows show the same tag.
    - `/api/attempts` GET and the admin history return `lesson_session_id`.
11. **Stale browser state.** When a student leaves a lesson view that reached review or ended, the SPA reloads account progress and attempts if no local writes are pending, so the new mistakes show without a reload.
12. **Admin Lessons tab** (§3.2):
    - **Columns:** session ID, title, mode, date, score (via `lessonScore`), and "Counts toward stats" (Yes for self-paced, No for instructor-paced).
    - **Source:** the `attendedSessions` helper that also serves My Lessons.
    - **Status:** ended and in-review sessions are both listed, with their status.

## Files

- `migrations/0010_lesson_attempts.sql` (new). `schema.sql` gets the snapshot column and index. `tools/e2e_seed.cjs` gets the 0010 upgrade step.
- `src/record.js` (new): `progressStatement`, `attemptStatement`, `lessonWriteBack`, `attendedSessions`, `lessonHistory`.
- `src/index.js`:
  - use `record.js` in the progress and attempts handlers;
  - add `usedInLesson` to `/api/questions`;
  - add the history routes;
  - admin: Lessons data, tags, and the `hide-attended` builder filter;
  - GET attempts returns `lesson_session_id`.
- `src/lesson-room.js`: write-back in the completion flush, usage rows at end, and a `shown` list.
- `public/shared/stats.js`: `nextProgress`, `attemptRow`.
- `public/shared/lesson.js`: `lessonUsageVisible`, `lessonScore`, `usedIds`.
- `public/index.html`:
  - `recordProgress` / `recordAttempt` call the shared helpers;
  - the My Lessons tab;
  - the Lesson questions filter;
  - badges and tags;
  - `attended` loading;
  - the reload after leaving a lesson.
- `lesson-ui/History.tsx` (new), `lesson-ui/notes.ts` (`notesHTML` moved here), `lesson-ui/Desmos.tsx` (a `readOnly` follower without the fork), `lesson-ui/index.tsx` (export `mountHistory`), `lesson-ui/types.ts`, `lesson.css`.
- `admin-ui/helpers.ts` (re-export `notesHTML`), `Students.tsx` (Lessons tab and tags), `Builder.tsx` (third filter option).
- `tests/test_lesson_room.cjs`, `tests/test_worker_sql.cjs` or a new `tests/test_lesson_history.cjs`, and `tests/e2e/lessons-09-history-stats/`.

## Required unit tests

- **`nextProgress` marker rule:**
  - first wrong → Red;
  - Red then right → Orange;
  - right → Green;
  - `attempts` and `corrects` counts.
- **The SPA `recordProgress` is the shared helper,** asserted from the source-block markers.
- **Write-back rows:**
  - a self-paced completion produces attempts only for assigned scorable questions, with blanks as `picked=null` and `correct=0`;
  - `time_taken_ms` = accumulated ms, `changes` carried, `lesson_session_id` set;
  - unassigned and unscorable questions get none.
- **Exactly once:** a real SQLite (`node:sqlite`) run of the write-back batch twice leaves one attempt and progress `attempts +1`, not +2. It uses schema.sql plus the actual statements.
- **Progress through the marker rule:**
  - a previously Red question answered right → Orange;
  - a blank → Red;
  - an existing Green answered wrong → Red.
- **Instructor-paced isolation:** a full instructor-paced question finalize and end writes no `attempts`/`progress` statements.
- **Usage rows at end:**
  - instructor-paced: items `0..index`;
  - self-paced: the union of assigned sets;
  - lobby end: none;
  - `INSERT OR IGNORE`.
- **`lessonUsageVisible`:** all three modes, including a question used in an attended session plus a non-attended one, and an empty usage.
- **`lessonScore`:** right ÷ scorable, with unscorable (null) excluded.
- **History routes:**
  - 404 before `ended`;
  - 404 for a non-participant;
  - an ended session returns notes, the answer and the saved review;
  - the list reports `attended`;
  - 0010 applies on the upgrade path and the fresh snapshot matches.

## E2E checkpoints (§12.7, copied; may add, never drop)

1. My Lessons shows each question with the student's answer, the explanation, my notes as "Breakdown", and saved annotations/Desmos state.
2. Questions show padded session IDs.
3. Each of the three filter options hides exactly the right questions.
4. A self-paced mistake appears in the mistake log tagged with its session.
5. An instructor-paced wrong answer does not.
6. (added) My Lessons history is refused before the session ends (404), and live lesson channels stay clean (leak helper).
7. (added) The admin Lessons tab lists the student's sessions with score and "counts toward stats" Yes/No, and the admin Mistakes tab shows the "Lesson 00003" tag.
8. (added) The full existing suite is green.

Student screenshots at 1366×768 go in `.omp/pipeline/lessons-09-history-stats/e2e/`.

## Task review items (§12.7 + §12.6)

- Self-paced writes use the existing path (the shared helpers) with the source tag. Instructor-paced writes nothing. All three filter options work.
- **Exactly once:** the write-back is idempotent under a retried batch.
- **Rule 5:** notes and explanations appear only in `/api/lesson-history/:id` after `ended`. Live snapshots are unchanged.
- **Rule 6:** no per-event D1 writes. The write-back rides the existing completion batch, and usage rides the end batch.
- **Rule 2:** marker, score and filter logic each exist once.
- **Rule 7:** nothing from task 10.
