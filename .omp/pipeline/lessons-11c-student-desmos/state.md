```text
Task: lessons-11c-student-desmos
Tier: 2
Tier rationale: Multi-file client change plus a two-field addition to the self-paced student snapshot; the Desmos, renderer and snapshot code paths were already mapped by tasks 06 and 10, so one focused read of them was enough. No auth, D1 or timing changes.
Session scope: this task only
Branch: claude/sleepy-cori-x82ubx   Base: main (5cf11e6)
Parallel: lessons-11a (bug fixes), lessons-11b (instructor layout; removes the split-pane divider). This task does not touch the divider, the instructor layout or annotation sync.
Last completed step: implementation + tests + docs; pushed
Open blockers: none
```

Execution note: run in one Claude Code session without subagent delegation (no fresh Developer / Test Developer / Reviewer spawns). The e2e specs were written and run in the same session.
