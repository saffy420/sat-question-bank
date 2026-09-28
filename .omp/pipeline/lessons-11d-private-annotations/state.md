```text
Task: lessons-11d-private-annotations
Tier: 2
Tier rationale: one server gate in the room (who receives the instructor layer, and when) plus a
small instructor toolbar change. It touches the leak rules, so it gets a spec that checks the wire,
not only the screen.
Session scope: this task only
Branch: claude/nice-brahmagupta-tszns2   Base: main (ae6640c)
Last completed step: implementation, unit + full e2e green, docs written
Open blockers: none
```

## How this session ran

One Claude Code session did the research, implementation, tests and docs. It didn't use separate
Researcher, Developer, Test Developer or Reviewer subagents. The Reviewer's checks were made by reading
the diff before commit. `e2e.md` records the revert checks.

## Decisions

1. **One gate, keyed to the phase.** `Room.hidden(s)` is true for an instructor-paced question in READY
   or ANSWERING. When it is true, the room does four things:
   - it sends `annotate`, `laser` and `eliminations` to admin sockets only;
   - student snapshots carry `annotations: []` and `eliminations: []`;
   - admin snapshots carry the full layer;
   - the presenter-disconnect laser hide is not sent.

   Any path that sets REVEALED publishes through the reveal's own snapshot broadcast. That covers the
   timer alarm and End now, and End session while ANSWERING, because it reveals first.
2. **The instructor can now annotate before the reveal.** Until now the room rejected `annotate` and
   `laser` outside REVEALED, and the toolbar was disabled (11b deviation 3). D1 needs these tools
   while students work, so they are accepted in READY and ANSWERING of a live session, privately.
   They stay rejected in the lobby.
3. **Indicator.** A "Hidden until reveal" pill (EyeOff icon, amber) sits in `#live-tools` next to the
   swatches whenever `hidden` is true, with a tooltip explaining it.
4. **"When everyone has submitted".** Instructor-paced lessons have no automatic reveal when every
   student has locked in; only the timer and End now reveal. Because the gate follows the phase, an
   automatic reveal added later would publish the layer too. I didn't add one: it would change the
   lesson's contract.
5. **Held laser frames.** `move()` cancels a laser frame held by the 25 ms rate floor, so a frame for the
   question being left cannot reach students after Next.
6. **Desmos** was already REVEALED-only and is unchanged.
7. **Self-paced review** is REVEALED, so the gate never applies there.
8. **The resting laser publishes at the reveal.** The first full run failed 11a A3. The instructor's
   pointer came to rest on "chart" during the End-now grace period, while the laser was private. After
   the reveal nothing re-sent it, because the presenter sends only on movement or a 2.5 s heartbeat of an
   already-sent frame, and the phase change reset that. The presenter now keeps the resting position
   (`resting` ref) and resends it when the tool effect restarts on the phase change. Covered by the 11d
   timer checkpoint and by 11a A3.

## Tests rewritten (not loosened)

- The brief says spec 05 asserts that annotations are live during the question. It doesn't: spec 05 ends
  the question (End now) before its first annotation, and every assertion in it runs in REVEALED. Those
  assertions still hold, so spec 05 is unchanged.
- The spec that asserted live-during-question sharing was **11a's A1** (eliminations during ANSWERING).
  It is rewritten:
  - During ANSWERING, students see no instructor cross-out.
  - At End now, both students see B.
  - The reconnect scenario (D crossed out and B restored while offline, reload, instructor reload) now
    runs after the reveal, where eliminations are live.
  - Every earlier assertion is kept, moved to the phase where it now applies.
- **11b layout** and **ui-admin-dashboard "live presenter states"** asserted the pen was disabled during
  ANSWERING. They now assert it is enabled and that the toolbar shows "Hidden until reveal".
- The **unit** test "annotation protocol gates role, shape, sizes and phase" asserted that a pre-reveal
  annotate got "invalid phase". Now the lobby is rejected, and a live pre-reveal mark echoes to the
  instructor and never reaches the student.
