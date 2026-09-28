# lessons-11b — instructor screen cleanup + question navigator

Source: the user's 11b brief (B1–B3), `docs/roadto1600-lessons-prompt.md` rules. Ownership: the instructor
layout and the split-pane divider on both views. Not touched: annotation/elimination sync, laser, lesson
builder, end-session handling (11a); student calculator, Try it yourself (11c).

## B1 fixed split (both views)
- `lesson-ui/Stage.tsx`: divider element, its three controls, drag/keyboard handlers and the remembered
  `splitAt` removed. The ResizeObserver only repaints ink now.
- `lesson-ui/lesson.css`: `stage-split` is `1fr 1fr` (Bluebook's 50/50); a 2px rule on the question pane
  replaces the divider line. There were no sync messages for the split.

## B2 layout (instructor)
- Deleted: the header row (badge, title, code, joined, Q n/N, timer), the question rail, the meta strip
  (`QUESTION n · id`, `Correct: X`), the Responses panel, and the vertical notes tab.
- The question area (`.live-area`) is fixed from the top of the viewport to the bottom bar, right of the sidebar.
  Row 1 is the annotation toolbar (Pen … Laser, Desmos for math, swatches). Row 2 is the stage, with the
  Desmos panel on the right.
- Pane inset: `clamp(24px, 2.5vw, 48px)` inside each pane, the student view's `.lesson-main` inset.
- The sidebar collapses once when the session leaves the lobby; `#collapse` still expands it.
- The join code is a fixed box in the top-right, `rgba(0,0,0,.74)`, 29px monospace. The toolbar reserves
  its width, so it covers nothing.
- The correct choice is marked on the instructor's own card in every phase: admin snapshots already carry the
  answer. Student payloads are unchanged.
- Bottom bar, left to right: `‹ Question n of N ›`, then the timer (Start lesson / Start question / +15s / End now),
  then `n of N responses`, then Notes, then the connection, then End session.
- Responses popup `#live-responses-popup` (role=dialog) opens above the bar. Esc, a click outside, or the
  button close it. It holds the roster with sort, the joined count, the distribution with clickable bars
  (`#live-group`), Show class results, and Manage students with Lock joining. It re-renders from each
  snapshot.
- Notes drawer `#live-notes-drawer`: slides from the right over the question and below the toolbar. It never
  covers the bar. It shows the explanation and the notes through the existing `HTML` + `mathify`.

## B3 navigator
- Server (`src/lesson-room.js`): `reached` (furthest index opened), `played` (count revealed; 0..played-1 done).
  `move(s, to)`: allowed only in READY/REVEALED while live, and only for `to <= played`. On a move:
  - the review of the question being left is queued;
  - the graph is swapped per question;
  - phase becomes REVEALED if `to < played`, else READY;
  - `endsAt` becomes null.
  `next` means `move(index + 1)` and `goto {questionId}` means `move(index of questionId)`. Snapshots carry
  `revisit` for both roles, plus `reached`, `played`, and on full snapshots `outline` [{questionId, snippet}]
  for the admin only.
- Client: ‹ and › buttons, and a drawer `#live-nav-drawer` from the left. The drawer rows show number,
  snippet, ID and the response count; the current row has `aria-current`; later rows are disabled; the
  list scrolls.

## Checkpoints (e2e, `tests/e2e/lessons-11b.spec.js`)
1. Layout at 1920×1080 and 1366×768, with the student at 1366×768:
   - no divider on either view, and the 50/50 split;
   - text at least 24px inside its pane, the same as the student inset at 1366;
   - no blank bands; the removed pieces are absent;
   - sidebar auto-collapse and re-expand;
   - join code box: style and corner, with no control under it (checked in ANSWERING, REVEALED and
     Desmos);
   - correct answer marked in ANSWERING, READY and REVEALED, and absent on the student;
   - bottom-bar order;
   - popup: position, contents, live update, and each way to close it;
   - distribution, class results, notes drawer and math, Desmos in the toolbar;
   - leak check.
2. Navigator: play Q1–Q3, back to Q1 through the drawer, forward with ›.
   - Revisit: own answer, reveal colours, shared highlight and Desmos graph; answering stays closed; no
     clock; the pill follows.
   - Room `responses` deep-equal before, during and after; the Q3 distribution is unchanged; › on the
     furthest question advances.
   - Leak check.
3. The drawer scrolls for a long lesson.
Unit (`tests/test_lesson_room.cjs`): revisit rules and reachability, a Desmos round trip, one review flush on
leave, usage from `reached`, the outline only on full admin snapshots, and the `nextPending` merge.
