# Task 11a handoff — lessons-11a-bugfixes

## Status
Complete. Unit 144/144, typecheck clean, full e2e **40/40**. Every checkpoint in `tests/e2e/lessons-11a.spec.js` fails with the fix reverted (`e2e.md`).

## For lessons-11d: the elimination gate

Every instructor elimination a client receives goes through **one function**, and live changes use **one message type**:

- **`Room.sharedEliminations(s, questionId, role)`** in `src/lesson-room.js` returns the letters a socket of `role` may see. It is called by:
  - the instructor-paced `snapshot()` (`eliminations` field; join, connect, resync and every broadcast);
  - `reviewPayload()` (self-paced review mode);
  - `broadcastEliminations()`.

  It currently returns `s.eliminations[questionId]` for every role. **11d gates it here**, e.g. `role === 'student'` and not revealed → `[]`. That covers snapshots, reconnects and live updates in one place.
- **`Room.broadcastEliminations(s, questionId)`** is the only sender of the server → client message **`{ type: 'eliminations', questionId, letters }`**. It sends to every socket and computes the letters per socket through `sharedEliminations`.
- **Client → server:** the admin-only action **`{ type: 'eliminate', questionId, letter, on }`** (`public/shared/lesson.js` `ADMIN_ACTIONS`/`validAction`).
  - Accepted for the current question in READY, ANSWERING and REVEALED (instructor-paced), or in self-paced review mode.
  - Stored in `s.eliminations[questionId]` (DO storage), sorted, idempotent.
- **History:** at Next and at End session (REVEALED only, like annotations), `reviewLayer()` appends one `{ type:'eliminate', id:'eliminate:<L>', nodeId:'c:<L>' }` mark per letter to `session_question_review.annotations_json`. My Lessons (`History.tsx`) reads them back into `eliminated`. No migration.
  - If 11d must also keep pre-reveal eliminations out of history for students, history is already REVEALED-only.

## Shipped

- **A1 Eliminations reach students.**
  - The instructor's ⊖ / ABC cross-outs are now room state, shared over the lesson socket.
  - Students render them as `.stage-choice.eliminated`, which looks the same as their own cross-out, with a "Crossed out by your instructor" title.
  - Students' own cross-outs stay private and memory-only, as before. They never reach the room, and the student's ⊖ buttons toggle only their own.
  - The instructor's `struck` list now comes from the room, so it survives the instructor's reload too.
  - Reconnect, review mode and My Lessons history are covered.
  - The Strikethrough tool on choice text already worked; it is now covered by a real mouse-drag test.
- **A2 Strikethrough indicator.**
  - Each tool sets its own `tool-<name>` class on the stage.
  - Strikethrough has its own cursor: the lucide Strikethrough icon over the stage (and over figures and tables), and the I-beam over text.
  - Pen, eraser and laser keep their crosshair (asserted by `ui-admin-dashboard`). Highlight is unchanged.
  - The toolbar is not touched.
- **A3 Laser on the wrong word.**
  - The room's 25 ms laser floor dropped frames that arrived in a burst, often the one the pointer came to rest on.
  - It now holds the newest frame of a burst and sends it when the floor opens.
  - Word mapping itself was verified correct for all 116 words at 1366, at 110% browser zoom and at 110% CSS zoom.
- **A4 Builder filter panels.**
  - `.filter-bar input { width: 100% }` was stretching the checkboxes inside the option panels.
  - Checkboxes are now 17 px at the left, with the label wrapping beside them.
  - Panels are at least as wide as their trigger (`min-width: 100%`), capped at `100vw - 32px`, with no horizontal overflow.
- **A5 End session releases students.**
  - `lessonEnded()` in `public/index.html` closes the lesson view on `/app`, through the same path as Leave, which also reloads the record and My Lessons. It runs on any of:
    - an ENDED snapshot;
    - a 410 from the reconnect loop (offline or mid-reconnect students, and anyone reconnecting later);
    - an `ended` error.
  - Answers are saved by the room exactly as before; nothing changed server-side for saving.
  - Also fixed: My Lessons now redraws when the record reload lands. A student who opened it right after release saw "No finished lessons yet".

## Files
- **Room and protocol:**
  - `src/lesson-room.js`: eliminate action, `sharedEliminations`, `broadcastEliminations`, `reviewLayer`, laser floor;
  - `public/shared/lesson.js`: `eliminate` action.
- **Student:**
  - `public/index.html`: `eliminations` message, `lessonLeave` / `lessonEnded`, the 410 and ENDED paths, My Lessons redraw;
  - `lesson-ui/Stage.tsx`: `eliminated` prop;
  - `lesson-ui/index.tsx`, `lesson-ui/History.tsx`, `lesson-ui/types.ts`;
  - `lesson-ui/lesson.css`: `.eliminated`, `.tool-strike`, pen/erase/laser crosshair.
- **Instructor:** `admin-ui/Live.tsx`. Only the message handler, the InstructorStage `struck`/`onStrike` props and the tool-cursor class toggling. No layout changes.
- **Builder:** `admin-ui/admin.css`, the `.options` rules only.
- **Tests:**
  - `tests/e2e/lessons-11a.spec.js` (new);
  - `tests/test_lesson_room.cjs` (laser floor);
  - specs 07, 08 and 09: "Session ended." → back on /app.
- **Seed:** `tools/e2e_core.sql`. `e2e-unused` is now a passage + prompt question and `e2e-used-other` a figure question, with the same IDs and taxonomy.
- **Screenshots:** `docs/lessons/11a/` (16 PNGs, index in its README).

## Parallel-work notes (11b / 11c)
- **11b (instructor layout):** Live.tsx edits are confined to the lines listed above. The strike-mode state line near the top of `Live()` changed (`struck` state removed).
- **11c (student Desmos):** no calculator or Try-it-yourself code touched. `lesson-ui/index.tsx` changed on one line (the `eliminated` prop on `<Stage>`).

## Open items (non-blocking)
- **Laser fix text.** The brief's A3 fix was a placeholder. Compare the fix you meant to paste with the one above.
- **Pre-reveal eliminations.** In 11a, eliminations made during ANSWERING reach students immediately. That is 11d's gate.
- **Clear all** clears shared annotations only, not eliminations. The instructor restores each choice with ⊖ Undo.
- **Leftover student states.** Students no longer see the self-paced "Session ended." notice or an ENDED phase; they are released. Both states are left in the components as defensive fallbacks.
