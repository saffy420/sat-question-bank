# Task 11d handoff: lessons-11d-private-annotations

## Status
Complete. Results, commands and revert checks are in `e2e.md`; decisions are in `state.md`.

## Shipped: D1, private until reveal

- **The gate:** `Room.hidden(s)` in `src/lesson-room.js`. It is true for an instructor-paced question in
  READY or ANSWERING. While it is true:
  - `annotate` (pen, highlight, strikethrough, erase, clear) and `laser` are accepted from the instructor
    during a live session. They go to admin sockets only; the lobby still gets "invalid phase".
  - `eliminations` go to admin sockets only (`broadcastEliminations`), and `sharedEliminations` returns
    `[]` for students. That covers snapshots, reconnects and HTTP `GET /api/lessons/:id`.
  - Student snapshots carry `annotations: []`. Admin snapshots now carry the layer in every phase, so an
    instructor reload keeps the private marks.
  - When the presenter disconnects, students get no laser hide.
  - `move()` drops a laser frame held by the 25 ms floor, so a frame for the old question cannot follow Next.
- **Reveal:** the existing reveal broadcast (`advance()` → REVEALED, from the timer alarm or End now) sends
  each student one snapshot with the full layer and eliminations. From then on the layer is live, as before.
  - **Revisits** (11b) are REVEALED: they show the published layer and stay live.
  - **Self-paced review** is REVEALED too, so nothing changed there.
- **Laser at the reveal (`admin-ui/Live.tsx`):**
  - The presenter keeps the pointer's resting position over the stage across the phase change and
    resends it when the tool effect restarts.
  - A dot resting on a word when the timer hits 0 therefore appears on students at once, instead of
    waiting for the next pointer move.
  - Found by 11a A3 in the first full run.
- **Instructor UI:**
  - The tools are enabled in READY and ANSWERING of a live question. They were disabled before the
    reveal (11b deviation 3).
  - `#live-tools` shows a **"Hidden until reveal"** pill (`.live-hidden`, EyeOff) while the layer is
    private.
- **Leak helper** (`tests/e2e/lessons-00b-e2e-harness/leaks.js`):
  - With `phaseAware`, each student socket now tracks the phase of its latest snapshot. Before REVEALED,
    any `annotate`, `laser` or `eliminations` frame is a violation, and so is a snapshot with a non-empty
    `annotations` or `eliminations`.
  - `layerLeaks(parsed, phase)` is exported and unit-tested in the 11d spec.
  - Every existing phase-aware capture (specs 04, 06, 11b) now checks this too.

## Tests
- New: `tests/e2e/lessons-11d.spec.js` (3 tests):
  - the leak helper;
  - the timer checkpoint, with reconnects before and after the reveal and the laser resting through it;
  - End now, the next question going private again, and a revisit staying live.
- New unit test in `tests/test_lesson_room.cjs`: the whole gate, at the room level.
- **Rewritten:**
  - 11a A1 (the spec that really asserted live-during-question sharing; spec 05 never did);
  - 11b layout and ui-admin-dashboard "live presenter states" (pen disabled → enabled + indicator);
  - one unit assertion.

  Details are in `state.md` §Tests rewritten.

## Not done / for later
- **"When everyone has submitted"**: instructor-paced lessons have no automatic reveal when all students
  lock in. The gate follows the phase, so an automatic reveal added later would publish the layer with no
  further change. I didn't add one: it would change the lesson's contract.
- **Clear all** still clears marks only, not eliminations (11a open item, unchanged).
- The 11b open item about a stray `laser hide` after Next no longer produces an error: a hide sent from the
  new READY question is accepted privately.

## Manual checks for you
- **Instructor, 1920×1080:**
  - Start a question, highlight a phrase, cross out a choice, draw and point with the laser.
  - The "Hidden until reveal" pill shows.
  - A student Chromebook shows none of it until 0 or End now, then all of it at once.
- **Reload a student mid-question:** they still see nothing. After the reveal, they see everything.
