```text
Task: lessons-11b-instructor-ui
Tier: 3
Tier rationale: B3 changes server-authoritative realtime state (which question is current, what a
revisit shows, what gets flushed to D1 and when); B1/B2 are broad UI changes that ripple through
most existing e2e specs.
Session scope: this task only
Branch: claude/exciting-archimedes-3eudpf   Base: main (5cf11e6)
Last completed step: implementation, unit + e2e green, docs written
Open blockers: none
Parallel work: 11a (bug fixes) and 11c (student Desmos) branch from the same main; 11d follows this PR.
```

## How this session ran

One Claude Code session did the research, implementation, tests and docs. It didn't use separate
Researcher, Developer, Test Developer or Reviewer subagents. The checks the Reviewer would make are
in `e2e.md` (§12.4 list) and were rechecked by reading the diff before commit.

## Decisions

1. **"Next" at the furthest question** sends the existing `next` message; every other move sends
   `goto {questionId}`. Both go through one server function (`move`). In READY, › is disabled, so
   the instructor uses "Start question" in the timer slot (no extra reveal step).
2. **No navigating while a question is open for answers** (ANSWERING). The timer and End now stay
   the only controls, so a running question can't be left half-open.
3. **Revisits show no clock** (`endsAt: null`): the instructor timer shows "—" and the student clock
   is blank. The saved per-student times are unchanged.
4. **Desmos per question:** leaving a question stores its graph under `desmos:<questionId>` (DO
   storage). Arriving loads that key into `desmos`, the current-question key the room already used.
   Self-paced review keeps its old behaviour: Next clears the graph.
5. **Leaving any revealed question** queues its annotations and graph for `session_question_review`,
   as Next always did. Queued review work now merges by question in `nextPending` instead of
   replacing it.
6. **Usage (§2)** counts questions up to the furthest one opened (`reached`), not the current index.
7. **Annotation tools stay visible before the reveal, but disabled.** The toolbar row therefore
   always holds controls, and the Desmos button sits in it for math.
8. **Self-paced grid, poll and overview screens are unchanged.** Self-paced review mode, which uses
   the question layout, gets the new layout with its own Next button. Its header, footer and
   Manage students section keep working.
9. **Test fixture `e2e-split-rw`:** a passage + prompt question added to the e2e seed, because no
   seeded question rendered both panes. Fixed bank counts in five specs went from 7 to 8.
