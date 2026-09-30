```text
Task: report-and-suggest
Branch: claude/eloquent-sagan-5340sj   Base: main (cadec68)
Last completed step: 3 (spec written)   Commit: pending
Next step: step 4 - implement src/reports.js, migration 0011, wiring in src/index.js, then client + admin UI
Open blockers: none
Decisions made this task: see spec.md "Decisions"
PR: not requested (user did not ask for one)
Instructions: docs/lessons/BRIEF.md - re-read §0, §12, §13 + this task's spec.md
```

## Baseline (before any change)
- `npm test`: 146/148. Both failures are environmental and unrelated:
  - `tests/test_grade.cjs` spawns `git.exe` (Windows checkout; absent on this Linux sandbox).
  - `tests/test_lesson_flush.cjs` "daily limit mid write-back" hard-codes 2026-09-28 and the sandbox clock is 2026-09-30.
- E2E harness works here (`PW_CHROMIUM_PATH=/opt/pw-browsers/chromium-1194/chrome-linux/chrome`), `ui-student-player` passes.
