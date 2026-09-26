# Brief: Live Lessons ("Pear Deck" mode) for roadto1600.org

**To the Architect:** this is the user brief for a multi-task feature. Keep a copy in the repo at `docs/lessons/BRIEF.md` so every subagent can read the same source of truth. Run the remaining work as the ordered pipeline tasks in §12.

**Current progress:** `lessons-00-audit`, `lessons-00b-e2e-harness`, and `lessons-01-admin-dashboard` are already complete. **Do not rerun them.** Read their existing handoffs, `docs/lessons/PLAN.md`, `docs/lessons/STATUS.md`, and pipeline artifacts when later tasks depend on their results.

**Session boundary:** every remaining numbered task is a separate top-level OpenCode session. A session may finish only its current task; it must not begin the next numbered task. The next task starts in a brand-new Architect session and reconstructs context from the brief, status/plan docs, prior handoffs, and pipeline files—not from the previous session's conversation context.

At the start of each task session, the Architect must choose exactly one of the three execution tiers in §12.1, record the chosen tier and a 1–3 sentence rationale in `.omp/pipeline/<task-name>/state.md`, and then follow that tier's flow. Every delegated stage uses a **fresh subagent session**. A separate **Test Developer** still runs the task's Playwright checkpoints between the Developer and Reviewer for every implementation task.

The app is my fork of `sat-question-bank`, deployed at roadto1600.org.
Stack: Cloudflare Worker (`src/index.js`) + static SPA (`public/index.html`) + D1 (user data and questions) + Supabase (auth only). Users are students in my school's SAT club; I am the instructor/admin. Students use slow school Chromebooks (1366×768) on slow school Wi-Fi. That constraint drives most decisions below: **send small events, never video or screenshots.**

Items marked **[DEFAULT]** are already decided. Build them as written; they are not user-decision gates. Keep each one isolated (a config constant or a single function) so it can be flipped later.

---

## 0. Ground rules (apply to every task)

1. **Research gate already satisfied.** `lessons-00-audit` is complete and `docs/lessons/PLAN.md` has already been approved. Do not rerun task 00. For each remaining task, use the tier rules in §12.1 to decide how much fresh research is needed before implementation.
2. **Reuse, don't re-implement.** The platform already computes per-student: question history, mistake log, weak spots, accuracy by domain/skill, accuracy by difficulty, pacing, traps fallen for, and second-guessing (answer changes). Find that code and call it. If it only runs client-side for the logged-in user, refactor it into a shared module the Worker can run for any student. Never write a second copy of any stat.
3. **Reuse the existing question renderer** (Bluebook-style layout, math rendering, figure crops, SPR/grid-in input and SPR answer checking). Lesson views wrap it; they don't replace it.
4. **The server is the authority** for timers, answer locks, reveals, and late-join question sets. The client only displays what the server decided.
5. **Never send correct answers, explanations, or my notes to a student's browser before they are allowed to see them.** School Chromebooks block DevTools, but students can sign in from personal devices. Student payloads are built server-side with those fields stripped.
6. D1 has an account-wide daily row-write cap. Live traffic (answer selections, time deltas, annotations, Desmos state) stays in the Durable Object and is flushed to D1 in batches at question end or session end, never per event.
7. Don't build ahead. Each task implements only its own section; later sections are context.

---

## 1. Architecture

### Realtime: one Durable Object per live lesson session
- `LessonRoom` Durable Object, keyed by session ID. Use the WebSocket Hibernation API so idle connections cost nothing.
- It holds the full live state in memory + DO storage: roster, per-student assigned question set, current question, phase, timers, every selection/lock, per-student time-on-question, annotation layer, Desmos state, poll state.
- Timers use DO alarms. When `endsAt` arrives, the alarm locks answers and reveals (instructor-paced) or ends the set (self-paced), even if my laptop disconnected.
- Clients connect via `wss://roadto1600.org/api/lessons/:sessionId/ws`. The Worker verifies the Supabase JWT and attaches `{userId, role}` before handing the socket to the DO.
- On every (re)connect the DO sends a full `snapshot` for that user's role, so a Chromebook that drops Wi-Fi resumes exactly where it was, with its assigned set, selections, annotations and Desmos state intact.
- One live socket per student: a new connection from the same user closes the old one.

### Clock sync
- Server messages carry `serverNow`. Client keeps `offset = serverNow − Date.now()` (re-measured on each message; keep the lowest-latency sample) and renders countdowns from `endsAt − (Date.now() + offset)`.
- Server accepts answer changes until `endsAt + 750ms` to absorb in-flight messages; anything later is rejected.

### Roles
- Add `role` (`student` | `admin`) to the user record. I'm the only admin for now; seed from env var `ADMIN_EMAILS`. Every `/api/admin/*` route and every instructor socket action checks role server-side.

---

## 2. Data model (D1)

Adapt names to existing conventions found in task 00.

```
lessons                -- reusable template ("the deck")
  id, title, mode ('instructor'|'self'), created_by, created_at, updated_at

lesson_questions       -- ordered items in a template
  lesson_id, position, question_id,
  time_limit_sec,      -- per-question time I set
  notes TEXT           -- my notes: instructor-only during the live session,
                       -- student-facing breakdown in lesson history afterwards (§9.1)

lesson_sessions        -- one run of a template
  id INTEGER PRIMARY KEY AUTOINCREMENT,  -- displayed zero-padded to 5 digits: 1 → "00001"
  lesson_id, join_code, status ('lobby'|'live'|'review'|'ended'),
  created_at, started_at, ends_at, ended_at,
  snapshot_json        -- frozen copy of the template at start,
                       -- so editing the template later doesn't rewrite history

session_participants
  session_id, user_id, joined_at, left_at, finished_at,
  assigned_question_ids_json   -- full set, or the late-join subset (§8.2)

session_responses      -- one row per student per ASSIGNED question per session
  session_id, user_id, question_id,
  final_answer, is_correct,
  locked_early BOOLEAN,        -- used the "double checked?" submit
  time_spent_ms,               -- accumulated, see §8.5
  answer_changes INT,          -- second-guessing count
  answer_history_json          -- [{answer, atMs}] for trap/second-guess analysis

session_question_review -- what I did while reviewing (for student history)
  session_id, question_id, annotations_json, desmos_state_json

session_polls
  session_id, poll_index, options_json, votes_json, winner_question_id

question_lesson_usage  -- source of usedInLesson
  question_id, session_id, used_at
```

### usedInLesson
- When a session ends, insert one `question_lesson_usage` row per question actually shown in that session.
- Expose it on question objects returned to the client as `usedInLesson: ["00001", "00004"]`: the zero-padded session IDs, oldest first. It's an array because a reused lesson puts the same question in several sessions. Empty array = never used.

---

## 3. Admin dashboard (`/admin`)

Layout: left sidebar (collapsible) with **Students · Lessons · Live · Question Bank**. Main area fills the rest. Designed for a laptop and legible on a projector.

### 3.1 Students list
Sortable, searchable table, one row per club member:

| Name | Questions done | Overall accuracy | Weakest skill | Avg pace vs target | Second-guess rate | Last active |

Click a row → student detail.

### 3.2 Student detail
Header: name, email, total questions, overall accuracy, last active.
Tabs, each rendering the existing stat from rule 2:

- **Overview** — accuracy by domain (bar per domain, R&W and Math grouped), accuracy by difficulty (E/M/H), weak spots list.
- **By skill** — every skill: attempted, accuracy, avg time, sparkline trend. Sorted by accuracy ascending.
- **Mistakes** — the mistake log, filterable by domain/skill/difficulty. Click a question → read-only view with their answer, correct answer, explanation. Self-paced lesson mistakes appear here with a "Lesson 00003" source tag.
- **Traps** — trap categories they fall for, with counts and example questions.
- **Pacing** — time per question vs. target, by section and difficulty.
- **Second-guessing** — how often they change answers; right→wrong vs wrong→right.
- **History** — every question attempted, newest first, paginated.
- **Lessons** — sessions they attended: session ID, title, mode, score, and whether it counted toward stats (self-paced) or not (instructor-paced).

---

## 4. Lesson builder (`/admin/lessons/new`, `/admin/lessons/:id/edit`)

Three-column layout:

```
┌──────────────┬──────────────────────────────┬────────────────────────────┐
│ FILTERS      │ RESULTS                      │ LESSON (ordered)           │
│ Section      │ [+] Q-id  skill  diff  00003 │ Title: ________________    │
│ Domain  [×]  │ [+] ...                      │ Mode: (•)Instructor ( )Self│
│ Skill   [×]  │ [+] ...                      │ Total time: 14:30          │
│ Difficulty   │ (click row = preview)        │ ≡ 1. Q-id  0:30  ✎         │
│ Lesson qs ▾  │                              │ ≡ 2. Q-id  1:30  ✎         │
│ Search text  │ [Add all on page]            │ ...  drag to reorder       │
└──────────────┴──────────────────────────────┴────────────────────────────┘
```

- **Filters:** multi-select domains, then multi-select skills limited to the chosen domains (use the official College Board domain → skill taxonomy exactly as the question bank stores it), difficulty checkboxes, the lesson-questions filter from §9.2 (in the builder, "hide all lesson questions" is the useful option), free-text search.
- **Results:** paginated; each row shows ID, skill, difficulty, and the session IDs from `usedInLesson` if any. Click → preview pane (the real renderer, with answer + explanation visible to me). `+` adds it. No limit on lesson length.
- **Lesson column:** drag to reorder, remove with ×. Live total time = sum of per-question times (the self-paced time limit).
- **Per-question editor** (✎ opens a drawer over the right column):
  - Time limit: chips `30s · 45s · 1m · 1m30 · 2m · 3m` + custom mm:ss. Default for new items **[DEFAULT]**: 1m for R&W, 1m30 for Math.
  - **Notes**: one markdown field with the same math rendering as the question bank, plus live preview. Label it "Notes (you see these during the lesson; students see them as the breakdown when reviewing afterwards)."
  - Preview of the question with answer + explanation for reference while writing.
- Autosave drafts. Buttons: **Save**, **Save & start session**.

### Lesson library (`/admin/lessons`)
Card grid: title, mode, # questions, total time, times run, last run. Actions: **Start session**, **Edit**, **Duplicate**, **View past sessions** (each with its session ID and results page). Starting a session never modifies the template.

---

## 5. Joining with a code

- Creating a session generates a 6-character code from `ABCDEFGHJKMNPQRSTUVWXYZ23456789` (no 0/O/1/I/L). Unique among non-ended sessions.
- The code works from creation through the whole session, including after I start, and dies when the session ends.
- **Student side:** a persistent **Join lesson** button in the main nav. It opens a modal with a 6-box code input (auto-uppercase, auto-advance, paste-friendly). Wrong code → inline error, no page change.
- **Lobby (before start):** student sees lesson title, "Waiting for the instructor to start…", and a count of joined students. I see the code in huge type (projector-readable), the join URL, and names appearing live. I can remove a student (×) and toggle **Lock joining** (default off).
- **Late join, instructor-paced:** lands on the current question with the time that's left. If the question is already revealed, they see the reveal and their response is recorded as blank.
- **Late join, self-paced:** see §8.2.

---

## 6. Instructor-paced lessons

Instructor-paced results are stored in `session_responses` only. They never enter the mistake log or any other platform stat (§10).

### 6.1 Per-question state machine (server-side)
```
READY ──(Start question)──► ANSWERING ──(timer hits 0, or End now)──► REVEALED ──(Next)──► next READY
```
- **Start lesson** immediately starts question 1 **[DEFAULT]**. **Next** from REVEALED moves to the next question's READY state.
- While ANSWERING I also have **+15s** and **End now**.
- At 0 the server locks every answer. A student's currently selected (unsubmitted) answer becomes final; no selection = blank.
- REVEALED fires immediately at 0 for everyone.

### 6.2 Student view
Uses the existing Bluebook-style renderer. Top bar replaces the normal header:

```
┌───────────────────────────────────────────────────────────────┐
│ Lesson title          Q 3 / 12           ⏱ 0:42     (●) live  │
├───────────────────────────────────────────────────────────────┤
│  [passage / figure]          │  [question stem]               │
│                              │  ○ A  ○ B  ○ C  ○ D            │
│                              │                  [Submit]      │
└───────────────────────────────────────────────────────────────┘
```

- Timer turns amber at 10s, red at 5s.
- Selecting an answer is not final; they can change it freely until time ends.
- **Submit** (early) opens a modal: **"Have you double checked your answer and made sure it's right?"** with **Yes, submit** and **Go back**. Yes → answer locked; the view shows "Answer locked in. Waiting for time to end…" and **does not** reveal correctness.
- **REVEALED:** correct choice turns green; their choice turns red if wrong; the official explanation appears below the question, collapsed. My notes are **not** shown here; they appear in lesson history after the session (§9.1). Students see only their own result, never names or others' answers.
- If I toggle **Show class results** (§6.3), an anonymous distribution bar chart appears for students too.
- Instructor annotations and the synced Desmos panel appear in this state (§7).
- Connection indicator: green dot when connected; on disconnect, a thin banner "Reconnecting…". Selections are held locally and re-sent on reconnect, subject to the server's lock time.

### 6.3 Instructor live view (`/admin/live/:sessionId`)

```
┌──────────────────────────────────────────────────────────────────────────────┐
│ CODE: K7QX2M   Joined 24   Q 3/12   ⏱ 0:42  [+15s] [End now] [Next ▶] [End]  │
├──────────────────────────────────────────────┬───────────────────────────────┤
│ QUESTION (same renderer, answer shown)       │ RESPONSES          18/24 in   │
│  ...                                         │ ● Ava    B ✓ locked           │
│  ✓ Correct: B                                │ ◐ Ben    C ✗ selecting        │
│                                              │ ○ Cam    —                    │
│ ┌ Annotation toolbar (REVEALED only) ──────┐ │ ...  sort: name / status      │
│ │ ✎ pen  ▭ highlight  ⌫ erase  ⊘ clear  ◉ laser │                           │
│ └──────────────────────────────────────────┘ ├───────────────────────────────┤
│                                              │ DISTRIBUTION (after 0)        │
│ ▸ Explanation   ▸ My notes                   │ A ██ 2   B ████████ 14 ✓      │
│ [Desmos ▸] (math only, opens side panel)     │ C ████ 6   D █ 2   blank 0    │
│                                              │ [Show class results]          │
└──────────────────────────────────────────────┴───────────────────────────────┘
```

- **Responses panel** (live during ANSWERING): every student with status icon (○ nothing, ◐ selected not locked, ● locked), their current choice, and ✓/✗ color. Header "18/24 in" counts locked + selected. Server batches these updates to ≤ 4/sec.
- **Distribution** (after 0): bars per choice with counts, correct bar marked. Click a bar → popover listing names who chose it and their time on the question. For SPR questions, group responses by normalized value using the existing SPR checker and show the top values + "other".
- Explanation and my notes are always visible to me, collapsed by default.

---

## 7. Review sync without screen sharing

My browser sends **what I did** as small JSON events; every student's browser **redraws it locally** on top of the same question. No video, no screenshots. Events are tens to hundreds of bytes.

### 7.1 Annotations (all question types)
- Available to me in REVEALED state and in review mode (§8.7). Tools: pen, highlighter (text), eraser, clear-all, laser pointer.
- **Text highlights** are anchored to content, not pixels: `{type:'highlight', nodeId, startOffset, endOffset, color}` where `nodeId` identifies a stable block in the rendered question (passage paragraph, stem, choice). This survives different screen sizes, zoom levels, and reflow.
- **Pen strokes** are drawn on a canvas overlay sized to the question card. Points are normalized to the card (`x, y ∈ [0,1]`) so they land on the same spot on any screen. Send strokes in chunks while drawing (every ~50ms) so students see them appear live; smooth on the receiving end.
- **Laser pointer:** ephemeral dot, throttled to ~20 updates/sec, not persisted.
- **Follow me:** when I highlight or draw outside a student's visible area (long passages), their view scrolls it into view. Students can toggle Follow off.
- Students cannot draw on the shared layer. They keep their own private highlighter layer, like Bluebook.
- The DO keeps the full annotation layer per question so late joiners and reconnects get it in the snapshot. At question end it's saved to `session_question_review` for lesson history.

### 7.2 Desmos sync (math)
Replace the iframe embed in lesson views with the **Desmos API** (`Desmos.GraphingCalculator`). Requires a Desmos API key: demo key in development, real key in an env var.

- **Instructor:** Desmos side panel in my live view. On `calculator.observeEvent('change', …)`, throttle to ~150ms trailing, call `getState()`, send `{type:'desmos', state}`. Also observe `graphpaperBounds` so pans/zooms sync if they don't trigger `change`. Skip sending if the serialized state equals the last one sent.
- **Students:** matching panel that opens automatically when I first use Desmos on a question. Calls `setState(state)` on each update. Read-only by default (no expression editing, zoom disabled so their view matches mine).
- **Try it yourself:** a student button that forks their panel into an editable copy from the current state; **Back to instructor view** resumes following.
- The DO stores the latest state per question (snapshot + `session_question_review`).
- Load the Desmos script only when a lesson contains math questions. Update CSP for the Desmos API script and assets.

---

## 8. Self-paced lessons

Self-paced results **count toward all platform stats, including the mistake log** (§10).

### 8.1 Rules
- One **shared clock** for the whole session: `ends_at = started_at + sum(all question times)`. Everyone finishes at the same moment.
- Students move freely: Next/Back, a question navigator grid, and **Flag for review** (mirror Bluebook).
- No correctness, explanations, or notes are shown until the session ends **[DEFAULT]**.
- Finishing early → **Review page** (grid of answered/unanswered/flagged, like Bluebook) → **Submit all** → the same modal: "Have you double checked your answer and made sure it's right?" Yes = locked, then "Submitted. Waiting for the session to end."
- At `ends_at`, every current selection is locked and submitted automatically. The session ends early if every joined student has submitted, or when I press **End session**.

### 8.2 Late join: shorter set, hardest questions first
A student who joins after start gets only the time left on the shared clock, and a subset of questions that fits it. The server computes the subset once, at join time, stores it in `session_participants.assigned_question_ids_json`, and never recomputes it (reconnects keep it).

Selection, with `R` = seconds remaining on the shared clock at join:
1. Sort the lesson's questions by `time_limit_sec` descending (longer = harder). Break ties by difficulty (Hard > Medium > Easy), then by original lesson position.
2. Walk that list; add each question whose time still fits in the remaining budget, subtracting its time. Skip any that don't fit and keep walking, so leftover budget is filled by shorter questions.
3. Present the chosen questions in their original lesson order.
4. If nothing fits, show "Not enough time left to join this set — you can join the review when it starts." Keep them in the session so they can take part in polls and review.

Required unit tests (exact cases):
- 4 × 30s + 10 × 60s, R = 8:00 → eight 60s questions.
- 4 × 45s + 6 × 30s + 5 × 60s, R = 8:00 → all five 60s + all four 45s, none of the 30s.
- Same lesson, R = 8:30 → the nine above + one 30s question.

The student's top bar shows "Q x / (their set size)". All per-question stats in §8.4 and §8.6 use as denominator only the students who were assigned that question.

### 8.3 Student view
```
┌────────────────────────────────────────────────────────────┐
│ Lesson title        Q 5 / 20   ⚑        ⏱ 11:52 remaining  │
├────────────────────────────────────────────────────────────┤
│  question (existing renderer)                              │
├────────────────────────────────────────────────────────────┤
│ [◀ Back]    [ Question 5 of 20 ▴ ] (opens navigator)  [Next ▶] │
└────────────────────────────────────────────────────────────┘
```

### 8.4 Instructor live view
```
┌──────────────────────────────────────────────────────────────────────────┐
│ CODE K7QX2M   Joined 24   Submitted 9   ⏱ 12:10 left   [End session]     │
├──────────────────────────────────────────────────────────────────────────┤
│ GRID: rows = students, cols = Q1..Q20                                    │
│  Ava  ■■■□■■◆·····   ■ right  □ wrong  ◆ currently on  · not reached     │
│  Ben  ■□■◆········   ░ not assigned (late join)                          │
│  → click a column header to open that question's card                    │
├──────────────────────────────────────────────────────────────────────────┤
│ QUESTION CARD (Q4)  answered 17/22 assigned  accuracy 59%                │
│                     avg time 1:12 (set 1:30)                             │
│  A █ 3   B ███████ 10 ✓   C ██ 2   D █ 2                                 │
│  click a choice → list: name · time spent on Q4                          │
│  ▸ question + explanation + my notes                                     │
└──────────────────────────────────────────────────────────────────────────┘
```
- Grid colors reflect locked-in or currently selected answers, graded server-side.
- "Avg time" only counts students who have visited the question, using accumulated time (§8.5).

### 8.5 Time-on-question must accumulate (known bug to avoid)
Time on a question is the **sum of every visit**, never reset on revisit.
- Client: on entering question Q record `enteredAt`. On leaving (Next/Back/navigator/submit), on `visibilitychange` to hidden, and on socket close, add `now − enteredAt` to Q and send `{type:'time', questionId, deltaMs}`. Resume the segment on return or when visible again.
- Server: `time_spent_ms += deltaMs`, rejecting any delta larger than the time elapsed since that student's previous event (stops a bad client inflating time).
- Unit test: Q1 for 10s → Q2 for 5s → Q1 for 7s ⇒ Q1 = 17s, Q2 = 5s.
- Instructor-paced uses the same mechanism (question start → lock).

### 8.6 Post-session overview (when the shared clock ends)
- **Class summary:** average score (as % of each student's assigned set), median, completion count.
- **Student table:** name, score (x / assigned), time used, submitted early?, late join?, sortable. Click → that student's per-question answers.
- **Most-missed:** questions ranked by number of students who got them wrong, highest first, e.g. `Q7 — 14 of 22 wrong (64%) · skill · difficulty`. Click → question card with distribution.
- Buttons: **Start review poll**, **Review a specific question** (skip the poll), **End session**.

### 8.7 Review polls
- **Start review poll** opens a 30-second poll on every student screen:
  1. **Most-missed question**, labeled with the actual question, e.g. "Q7 (14 people missed it)".
  2. **A question I choose**, which reveals a dropdown of every lesson question, each labeled ✓ / ✗ / "not in your set". A dropdown pick is required for the vote to count.
- Poll closes at 30s or as soon as every connected student has voted.
- **Winner:** majority between options 1 and 2. If option 2 wins, review the question picked most often in the dropdowns. Ties: most-missed wins; ties among dropdown picks go to the one more students got wrong.
- Show the result on every screen for 3 seconds, then move everyone to that question in **review mode**: identical to instructor-paced REVEALED (§6.2, §6.3, §7), except each student sees their own recorded answer (or "not in your set").
- Already-reviewed questions are excluded from both options in later polls.
- After a review, pressing **Next** brings the poll launcher back. I can also end the review.
- Reviews don't change any recorded answer or stat.

---

## 9. After the session: history, reuse, question bank

### 9.1 Student lesson history
- New page **My Lessons** in the student nav: sessions attended (session ID, title, date, mode, their score).
- Opening one shows each question with: their answer, the correct answer, the official explanation, **my notes presented as "Breakdown"**, and, if I reviewed it live, my saved annotations and final Desmos state (read-only).
- Available as soon as the session ends, for both modes.

### 9.2 Question bank filter
- Questions with a non-empty `usedInLesson` show a small badge listing the session IDs.
- Add one control to the student question bank filter bar, **Lesson questions**, with three options:
  - **Show all** **[DEFAULT]**
  - **Hide questions from lessons I attended**: hides a question if any of its `usedInLesson` IDs is a session the student has a `session_participants` row for.
  - **Hide all lesson questions**: hides any question with a non-empty `usedInLesson`.
- A single three-option control avoids the confusing state where both toggles are on. It works the same in the admin builder filter (§4).

---

## 10. Stats: which sessions count

| Mode | Mistake log | Accuracy, weak spots, pacing, traps, second-guessing | `session_responses` / Lessons tab |
|---|---|---|---|
| Instructor-paced | No | No | Yes |
| Self-paced | **Yes** | **Yes** | Yes |

- **Self-paced write-back:** when a self-paced session ends, write one attempt per student per *assigned* question into the existing practice-attempt tables, using the same code path the question bank uses to record an attempt, so every existing stat picks it up unchanged. Carry over answer, correctness, `time_spent_ms`, answer changes, and tag the attempt with its source (`lesson_session_id`) so the Mistakes tab can show "Lesson 00003".
- **Unanswered assigned questions:** record them the way the platform already records a timed-out or skipped question. Task 00 must find that convention; if none exists, raise it as a decision gate.
- **Questions not assigned** to a late joiner are not recorded at all.
- **Instructor-paced isolation:** nothing from an instructor-paced session reaches the practice-attempt tables. Add a test proving an instructor-paced answer changes no existing stat, and a test proving a self-paced answer shows up in the mistake log.

---

## 11. Realtime message contract

Define in one shared module used by both the Worker/DO and the client. All JSON; every server message includes `serverNow`.

**Student → server:** `select {questionId, answer}` · `lock {questionId}` · `time {questionId, deltaMs}` · `navigate {questionId}` (self-paced) · `submitAll` · `vote {option, questionId?}` · `ping`

**Instructor → server (role-checked):** `start` · `startQuestion` · `addTime {sec}` · `endNow` · `next` · `goto {questionId}` · `annotate {op}` · `laser {x,y}` · `desmos {state}` · `toggleClassResults` · `startPoll` · `endSession` · `kick {userId}` · `lockJoin {bool}`

**Server → clients:** `snapshot` (role-specific full state, incl. the student's assigned set) · `phase {questionId, phase, endsAt}` · `reveal {questionId, correct, explanation, distribution?}` (student payload only at REVEALED; never includes notes) · `responses` (instructor only, ≤ 4/sec) · `annotate` · `laser` · `desmos` · `poll {options, endsAt}` · `pollResult` · `roster` (instructor only) · `ended`

---

## 12. Pipeline

### 12.1 Per-task flow — choose exactly one tier per task

Each numbered task is its **own top-level OpenCode session**. Never complete one task and continue directly into the next task in the same Architect session.

At the start of a task session:

1. Read `docs/lessons/BRIEF.md`, `docs/lessons/PLAN.md`, `docs/lessons/STATUS.md`, and the most recent relevant handoff(s).
2. Confirm the current task is the next incomplete task in §12.5.
3. Create or open `.omp/pipeline/<task-name>/state.md`.
4. Choose **exactly one** execution tier below.
5. Write at the top of `state.md`:

```text
Task: <task-name>
Tier: 1 | 2 | 3
Tier rationale: <1–3 sentences tied to the criteria below>
Session scope: this task only
```

The tier is chosen for the **task**, not separately for each substage. The Architect may escalate the task upward (1 → 2 → 3) if new risk or uncertainty is discovered, but it must record the escalation and reason in `state.md`. Do not downgrade a task mid-session just to save time.

#### Fresh-subagent rule — mandatory in every tier

Every delegation uses a **brand-new child session**. Never resume or reuse a prior Researcher, Developer, Test Developer, Reviewer, or Documentation session.

```text
Developer #1
  → Test Developer #1
  → Reviewer #1 finds an app bug
  → Developer #2 (fresh)
  → Test Developer #2 (fresh)
  → Reviewer #2 (fresh recheck)
```

Agents share state only through repository files, explicit paths, and compact result summaries. The filesystem is the durable source of truth; child-agent context is disposable.

#### Tier 1 — contained / low uncertainty

Choose Tier 1 only when the task is well-specified by this brief and prior completed work, the relevant code paths are already known, and there is no material architecture/security/data-integrity uncertainty beyond the task's already-decided requirements.

Flow:

```text
Architect writes concise spec.md
  → fresh Developer
  → fresh Test Developer
  → fresh Reviewer (LIGHT)
      ├─ PASS → fresh Documentation → task complete
      └─ FAIL/app bug → fresh Developer fix → fresh Test Developer rerun → fresh Reviewer RECHECK
```

Tier 1 rules:
- **No Researcher by default.** The Architect may use the completed audit/plan/handoffs as context.
- The Developer may do small direct lookups needed to implement the known spec.
- Reviewer uses a **LIGHT** review: task requirements, standing safety rules, implementation diff, test diff, and `e2e.md`; do not re-investigate the subsystem from scratch.
- Test Developer remains mandatory and still runs every checkpoint required for the task plus the full existing e2e suite as specified below.
- Documentation is mandatory because the next numbered task starts in a new top-level session.

#### Tier 2 — normal implementation / focused research

Choose Tier 2 when the task is meaningful or multi-file and one focused research pass will materially reduce implementation uncertainty, but the task does not require broad architectural investigation.

Flow:

```text
fresh Researcher
  → Architect writes spec.md
  → fresh Developer
  → fresh Test Developer
  → fresh Reviewer (NORMAL)
      ├─ PASS → fresh Documentation → task complete
      └─ FAIL/app bug → fresh Developer fix → fresh Test Developer rerun → fresh Reviewer RECHECK
```

Tier 2 rules:
- Use exactly **one focused Researcher** unless a STOP/user gate interrupts the task.
- Research only the code paths, invariants, and external docs needed for this task; do not re-audit the whole project.
- Reviewer performs the standing §12.4 checks plus the task-specific checks, but avoids unrelated architecture review.
- Documentation is mandatory at task end.

#### Tier 3 — high-risk / architectural / uncertain

Choose Tier 3 when the task materially touches one or more of:
- security/auth boundaries;
- server-authoritative realtime state or timing;
- Durable Object lifecycle/reconnect semantics;
- D1 schema/migrations or write-integrity rules;
- cross-session data/stat correctness;
- concurrency/race conditions;
- external APIs with version-sensitive behavior;
- broad cross-cutting changes;
- ambiguous ownership/implementation path;
- a prior task/handoff contradiction;
- a user-decision STOP whose resolution affects architecture.

Flow:

```text
fresh Researcher A ─┐
                    ├→ Architect merges findings + writes spec.md
fresh Researcher B ─┘
                    → fresh Developer
                    → fresh Test Developer
                    → fresh Reviewer (DEEP)
                        ├─ PASS → fresh Documentation → task complete
                        └─ FAIL/app bug → fresh Developer fix
                                           → fresh Test Developer rerun
                                           → fresh Reviewer RECHECK
```

Tier 3 rules:
- Use up to **two fresh Researcher sessions in parallel** when their questions are independent. Good split: (A) code ownership/current implementation; (B) tests/invariants/version-specific external docs.
- Do not create more research agents just because the task is large.
- Reviewer performs a **DEEP** review of the implementation diff, test diff, `e2e.md`, standing §12.4 checks, and task-specific invariants.
- Documentation is mandatory at task end.

#### Developer / Test Developer / Reviewer rules shared by all tiers

- **Developer** implements `spec.md` and writes the unit tests the spec calls for (for example §8.2 late-join cases and §8.5 accumulated-time test). It does **not** write Playwright tests.
- **Test Developer** is always a separate **fresh Developer spawn**, never the instance that implemented or repaired the app. It **never edits app code**; its diff is limited to `tests/e2e/`, e2e fixtures, and seed data. For each task it:
  1. starts the local environment (§12.2) and uses the **Playwright CLI skill** to drive the site through every e2e checkpoint in `spec.md`, capturing screenshots at 1366×768;
  2. turns each checkpoint into a committed Playwright Test spec under `tests/e2e/<task-name>/` so it becomes permanent regression coverage;
  3. runs that task's specs **and the full existing e2e suite** (earlier tasks must not regress);
  4. writes `.omp/pipeline/<task-name>/e2e.md`: each checkpoint → pass/fail, command run, screenshot/trace paths, and every failure classified as:
     - **test bug** → Test Developer fixes its own test and reruns;
     - **app bug** → stop and report repro steps, expected vs. actual, and the failing spec.
- **Reviewer** stays read-only and writes no tests. It may run tests/read-only validation. It reviews the implementation diff, test diff, `e2e.md`, §12.4, and the task's own requirements.
- **Documentation** writes `handoff.md` and appends the required dated entry to `docs/lessons/STATUS.md` before the session is considered complete.

#### Repair loop

App bugs and blocking review findings route:

```text
Architect
  → fresh Developer (fix only the blocker)
  → fresh Test Developer (rerun required task specs + full existing e2e suite)
  → fresh Reviewer (RECHECK)
```

A RECHECK verifies the prior blocker, the repair diff, and regressions caused by the repair; it does not blindly repeat unrelated research. **Never resume the agents from the previous round.**

These repair rounds still count toward the existing **5-round repair limit**. If the same blocker survives repeatedly, stop blind looping and determine whether the spec or a user decision is the real issue.

A task cannot reach Documentation with a failing, skipped, or missing e2e checkpoint unless I approve it at a gate.

### 12.2 E2E environment

- Run against local `wrangler dev` with local D1 and Durable Objects, seeded by a script. **Never run e2e against production roadto1600.org or production data.**
- **Test sign-in (decided in `PLAN.md`, which I approve at the task 00 STOP):** Google OAuth can't be automated. The proposal to evaluate: a dev-only sign-in route that creates a session for seeded accounts (`e2e-admin`, `e2e-student-1` … `e2e-student-4`), active only when `E2E_TEST_MODE=1` is set in `.dev.vars`. The Worker refuses the route when the flag is unset, production config never sets it, and a test proves the route 404s without it. Task 00 compares this against alternatives (e.g. Supabase test users) and the Architect picks one.
- **Seeded lessons** use **5–10 second** time limits. Timers live in the Durable Object, so the browser can't fast-forward them; short real timers keep the suite fast. Include: an instructor-paced lesson and a self-paced lesson, each with R&W + Math questions and at least one SPR question; a self-paced lesson with mixed time limits for late-join checks.
- **Multi-user tests:** one browser context per user (instructor + 2–4 students) inside the same test.
- **Chromebook profile:** student contexts at 1366×768. Slow Wi-Fi via CDP `Network.emulateNetworkConditions` (Chromium). Disconnects via `context.setOffline(true/false)`.
- **Leak capture helper:** records every HTTP response body and WebSocket frame on a student context (`page.on('response')`, `page.on('websocket')` → `framereceived`) and searches them for the current question's correct answer, explanation, and my notes.
- Wait on conditions (a selector, a WS message, a timer reaching 0), not fixed sleeps.
- Screenshots and traces go to `.omp/pipeline/<task-name>/e2e/` (gitignored), not the repo.

### 12.3 Standing rules for every task

- **Session isolation:** one numbered task per top-level Architect session. Never begin the next task in the same session. At task completion, stop after Documentation/handoff/status update.
- **Completed tasks:** `lessons-00-audit`, `lessons-00b-e2e-harness`, and `lessons-01-admin-dashboard` are complete. Do not rerun or reimplement them. Their outputs are inputs to later tasks.
- **Tier selection:** at the beginning of every remaining task, choose exactly one Tier 1/2/3 from §12.1 and record it plus rationale in `state.md`. Escalation is allowed only upward and must be recorded.
- **Fresh agents:** every delegation is a brand-new subagent session, including Developer repairs, Test Developer reruns, Reviewer rechecks, and Documentation. Never resume a prior child session.
- **Researcher:** when the selected tier includes research, read `docs/lessons/BRIEF.md` for context but research only what that task's spec needs. Use Context7 for Cloudflare Durable Objects / WebSocket Hibernation, the Desmos API, and Playwright when those version-specific facts are relevant.
- **Documentation:** write `handoff.md` as usual and append a dated entry to `docs/lessons/STATUS.md` with what shipped, selected tier, e2e result summary, and any deviation from this brief.
- **User-decision gates:** every **STOP** below; any research finding that contradicts this brief; the unanswered-question convention in §10 if none exists; any e2e checkpoint that can't pass. **[DEFAULT]** items are not gates.

### 12.4 Reviewer checks (every task, in addition to the task's own list)

- **Code:** (a) no answer, explanation, or note reaches a student payload before it's allowed (rule 5); (b) timers/locks decided server-side (rule 4); (c) no per-event D1 writes (rule 6); (d) no duplicated stat logic (rule 2); (e) nothing built from a later task (rule 7).
- **Tests:** (f) every checkpoint in `spec.md` has a spec that actually asserts it; (g) no `.skip`, `.only`, `fixme`, loosened assertions, or inflated timeouts added to force a pass; (h) no fixed sleeps where a condition wait works; (i) the Test Developer's diff touches no app code; (j) `e2e.md` shows the full suite ran, not only the new specs.

### 12.5 Tasks and e2e checkpoints

| Task | Status | Tier | Scope | Research focus | Reviewer must verify | Gate |
|---|---|---|---|---|---|---|
| `lessons-00-audit` | **COMPLETE — do not rerun** | — | Research only. Architect writes `docs/lessons/PLAN.md` from `research.md`. | Historical output only; use existing audit/plan. | Historical; do not rerun. | Completed |
| `lessons-00b-e2e-harness` | **COMPLETE — do not rerun** | — | Developer: test sign-in route + seed script. Test Developer: fixtures, multi-context helper, leak capture helper, Chromebook/throttle/offline helpers. | Historical output from 00. | Historical; do not rerun. | Completed |
| `lessons-01-admin-dashboard` | **COMPLETE — do not rerun** | — | §1 Roles, §3 | Historical stat-module findings from 00. | Historical; do not rerun. | Completed |
| `lessons-02-builder` | Pending — **next task** | **Architect chooses 1/2/3 at session start** | §2 migrations, §4 | Existing filter/query code to reuse | Migrations number cleanly; template edits never touch past sessions | **STOP** |
| `lessons-03-realtime-core` | Pending | **Architect chooses 1/2/3 at session start** | §1 DO + clock sync, §5, §11, reconnect/snapshot | Context7: DO WebSocket Hibernation, alarms | One socket per student; snapshot restores full state; late answers rejected after `endsAt + 750ms` | — |
| `lessons-04-instructor-paced` | Pending | **Architect chooses 1/2/3 at session start** | §6 | Existing renderer + SPR checker hooks | Reveal only at 0/End now; early submit hides correctness; notes never sent to students | **STOP** (I test on real Chromebooks) |
| `lessons-05-annotations` | Pending | **Architect chooses 1/2/3 at session start** | §7.1 | How the renderer structures text nodes | Highlights anchored by node + offsets, strokes normalized; snapshot includes layer | **STOP** |
| `lessons-06-desmos` | Pending | **Architect chooses 1/2/3 at session start** | §7.2 | Context7: Desmos API version, key, events, CSP | Student calculators read-only unless forked; unchanged states not resent | **STOP** |
| `lessons-07-self-paced` | Pending | **Architect chooses 1/2/3 at session start** | §8.1–8.5 | — | §8.2 and §8.5 unit tests pass exactly; subset never recomputed | **STOP** |
| `lessons-08-review-polls` | Pending | **Architect chooses 1/2/3 at session start** | §8.6–8.7 | — | Early close, tie rules, reviewed-question exclusion; reviews change no data | **STOP** |
| `lessons-09-history-stats` | Pending | **Architect chooses 1/2/3 at session start** | §9, §10 | Attempt-recording path from 00 | Self-paced writes via existing path with source tag; instructor-paced writes nothing; all three filter options | **STOP** |
| `lessons-10-e2e-regression` | Pending | **Architect chooses 1/2/3 at session start** | Test Developer only: full suite + an exploratory Playwright CLI pass through both lesson modes as I would run them in class | — | `e2e.md` covers both modes end to end | **STOP** |

**E2E checkpoints** (for pending tasks, the Architect copies the current task's list into `spec.md`; the Test Developer may add more but not drop any. Checkpoints for completed tasks 00b and 01 are historical and are not rerun merely because a new session starts):

- **00b:** admin and a student sign in through the test route; question bank loads for both; the test route 404s with `E2E_TEST_MODE` unset.
- **01:** admin sees the student list and every detail tab renders data for a seeded student; a student gets redirected from `/admin` and 403 from `/api/admin/*`.
- **02:** build a lesson using domain + skill filters; add, reorder by drag, remove; set custom times; write notes with math and see the preview; save, reload, everything persists; total time updates; "Hide all lesson questions" works in the builder; **Save & start session** produces a join code.
- **03:** join through the nav modal (wrong code shows inline error; lowercase and pasted codes work); instructor lobby shows names live; joining after start works; student offline for 20s then back restores question, time, and selection; opening a second tab as the same student closes the first; **Lock joining** blocks new joins.
- **04:** full lesson with instructor + 3 students: responses panel updates live (○/◐/● states); early-submit modal's **Go back** keeps editing, **Yes, submit** locks and hides correctness; at 0 an unsubmitted selection becomes final; reveal colors are correct; distribution counts match and clicking a bar lists the right names; **Show class results** toggles the student chart; **+15s** and **End now** work; SPR responses group by normalized value; leak helper finds no answer/explanation/notes before reveal and no notes at all during the session.
- **05:** instructor highlights at 1920×1080; students at 1366×768 and at 110% zoom have the same text highlighted (compare the highlighted string); pen strokes and laser appear live; Follow me scrolls a long passage; a student who reconnects sees existing annotations; students can't draw on the shared layer.
- **06:** an expression typed in the instructor's Desmos appears in student panels, measured under Slow 3G throttling (target ≤ 0.5s, record the measured value); students can't edit; **Try it yourself** edits don't propagate; **Back to instructor view** resyncs.
- **07:** full self-paced run: Next/Back/navigator/flag; review page; submit-all modal; auto-submit at the shared end for a student who didn't submit; no correctness, explanation, or notes shown during the set (leak helper); visiting a question twice shows accumulated time in the instructor card; a late joiner gets a smaller set whose times fit the remaining time the server reported, and the instructor grid shows ░ for their unassigned questions.
- **08:** overview ranks most-missed correctly with per-question denominators; poll closes early when all vote; option 2 requires a dropdown pick; a split vote resolves to most-missed; review mode syncs annotations; a reviewed question disappears from the next poll.
- **09:** My Lessons shows each question with the student's answer, explanation, my notes as "Breakdown", and saved annotations/Desmos state; questions show padded session IDs; each of the three filter options hides exactly the right questions; a self-paced mistake appears in the mistake log tagged with its session; an instructor-paced wrong answer does not.
- **10:** entire suite green; screenshot tour of both modes at 1366×768 (lobby, answering, locked, reveal, annotations, Desmos, self-paced grid, overview, poll, review, My Lessons) saved for me to look through.

## 13. Acceptance checks

Unit-level checks are the Developer's; browser-level checks are covered by the Test Developer's Playwright specs in §12.5.

- A student can't find the correct answer, explanation, or my notes in any network response or JS state before they're allowed to see them, on a personal (non-managed) browser.
- Killing Wi-Fi on a student device for 20s mid-question, then restoring it: they rejoin with the correct question, remaining time, their selection, their assigned set, and all annotations.
- An answer change sent after `endsAt + 750ms` is rejected; the UI already showed it locked.
- Early submit shows the modal; after Yes, changes are impossible and correctness stays hidden until reveal.
- A highlight made on my 1080p laptop lands on the same words on a 1366×768 Chromebook at 110% zoom.
- Desmos edits appear on a student Chromebook within ~0.5s under DevTools "Slow 3G" throttling.
- The three late-join cases in §8.2 and the time test in §8.5 pass.
- Poll closes early when all connected students vote; ties resolve per §8.7.
- Reusing a lesson creates a new session with a new code and a new session ID; old results are unchanged.
- A finished session adds its padded ID to `usedInLesson` on every question shown; each filter option in §9.2 hides exactly the right questions.
- Self-paced answers appear in the mistake log tagged with their session; instructor-paced answers change no stat.
