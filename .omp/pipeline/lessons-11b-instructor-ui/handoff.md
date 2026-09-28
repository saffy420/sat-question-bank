# Task 11b handoff — lessons-11b-instructor-ui

## Status
Complete:
- full e2e suite 37/37 on two consecutive runs;
- unit 145/145;
- typecheck clean.

Screenshots are in `docs/lessons/11b/`. Details are in `e2e.md`; decisions are in `state.md`.

## Shipped
- **B1:** the Stage has a fixed 50/50 split on both views, with a plain rule between the panes. The divider,
  its |← <> →| controls and `splitAt` are gone.
- **B2 instructor layout (`admin-ui/Live.tsx`, `admin-ui/admin.css`):**
  - The question fills the space right of the sidebar, down to a fixed bottom bar.
  - The toolbar row holds Pen … Laser, Desmos (math) and the swatches.
  - The join code is a fixed top-right box.
  - The Responses popup, the Notes drawer and the navigator drawer all overlay the question.
  - The sidebar collapses once at session start.
  - The correct choice is marked on the instructor's card in every phase.
- **B3 navigator:** the bar holds `‹ Question n of N ›`, and a drawer lists every question. See the state
  model below.

## For lessons-11d: how a revisited question is marked in state
The room (`src/lesson-room.js`, instructor-paced only) stores:
- `s.index`: the question on screen.
- `s.reached`: the furthest lesson index opened (the frontier).
- `s.played`: the number of questions revealed so far. Items `0 … played-1` are done.

A question is a **revisit** when `s.index < s.reached`.

On a revisit:
- `s.phase` is `'REVEALED'`, `s.endsAt` is `null`, and nothing reopens.
- `select` and `lock` get "question closed", and `startQuestion` / `addTime` / `endNow` are refused.

The frontier question itself has `s.index === s.reached`:
- `'READY'` if it hasn't been played (`played === reached`);
- `'REVEALED'` if it has (`played === reached + 1`).

Every snapshot (both roles) carries `revisit: boolean`. Admin snapshots also carry:
- `reached` and `played`;
- on full snapshots, `outline: [{ questionId, snippet }]`.

Rooms saved before 11b have neither field. `frontier(s)` derives them as `reached = index`, and
`played = index + 1` if the phase is REVEALED or ENDED, otherwise `index`.

Moves all go through `move(s, to)`:
- `next` is `to = index + 1`;
- `goto {questionId}` is the index of that question.

A move is allowed only while `status === 'live'` and the phase is READY or REVEALED, and only to
`to <= played`. It does the following:
1. Queues the left question's annotations and graph for `session_question_review` (merged by question in
   `nextPending`).
2. Stores the graph under `desmos:<questionId>` and loads the target's graph into `desmos`.
3. Sets `reached = max(reached, to)`.
4. Sets phase to REVEALED if `to < played`, otherwise READY.

`advance()` (the reveal) sets `reached = index` and `played = index + 1`. §2 usage uses `reached`.

## Deviations
1. Navigation is disabled while a question is ANSWERING.
2. Revisits show no clock rather than 0:00.
3. The annotation tools are visible but disabled before the reveal, so the toolbar row is never empty.
4. The self-paced grid, poll and overview screens are unchanged. Self-paced review uses the new layout with
   its own Next.
5. New seed fixture `e2e-split-rw`, a passage + prompt question. The bank goes to 8, and the fixed counts
   in five specs were updated.
6. Spec 04 was rewritten for the popup (see `e2e.md`), and spec 06's timestamp flake was fixed.

## Open items (non-blocking)
- `docs/lessons/tour/` (task 10) still shows the old instructor layout. Regenerate it with
  `tools/e2e_tour_compress.cjs` after a tour run if you want it current. It was left alone here to avoid a
  binary conflict with 11a/11c.
- `desmos:<questionId>` keys stay in the ended room's DO storage, like the old single `desmos` key did.
- Pre-existing, 11a's area, not touched: when the instructor leaves a question with the laser on, the
  cleanup may send a `laser hide` for the old question. The room then answers "invalid phase", which can
  flash in the error line.
- Pre-existing: a student joining during REVEALED writes `pending` directly. It can overwrite a pending
  flush. That is now also possible on a revisit.

## Manual checks for you
- On the 1920×1080 laptop and a 1366-wide screen, run a lesson:
  - go back two questions and forward again;
  - check the join code box, the popup and both drawers.
- On a Chromebook, check the fixed split, and that a revisit shows your saved answer.
