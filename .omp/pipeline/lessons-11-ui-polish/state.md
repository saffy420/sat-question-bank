```text
Task: lessons-11-ui-polish
Tier: 3
Branch: claude/loving-volta-n524ml   Base: main (cadec68)
Last completed step: 4 (implementation committed 5f1c1d4; unit 150/152 = 2 pre-existing env failures)
Next step: Test Developer subagent (running) writes tests/e2e/lessons-11-ui-polish/* and fixes specs 05/06/11c; then full suite,
           fresh Reviewer subagent on `git diff main...HEAD`, repair rounds, handoff.md, STATUS.md entry, push.
Open blockers: none
Decisions made this task:
- Root cause of pen/laser drift: glyph anchors used CSS px, valid only if every client has the same type size; item 3 makes type
  fluid => em-based anchor form `node~offset` (old `@` px form still valid), per-chunk re-anchoring, exact canvas rounding + DPR repaint.
  Instructor's own pen/laser was already under the pointer at 80-150% in emulation (probe), so that part is a regression guard.
- Student calculator: floating drag/resize window replaced by a left dock with a width handle (spec 06/11c rewritten).
- Instructor Desmos width: localStorage `lessons.desmosWidth`, clamp [280, min(720, body-360)].
- Instructor pane inset and student gutter both clamp(24px, 2.8vw, 56px) (11b test compares them).
PR: not requested (do not open)
Instructions: docs/lessons/BRIEF.md — re-read §0, §12, §13 + .omp/pipeline/lessons-11-ui-polish/spec.md
Pre-existing failures on main (not this task): tests/test_grade.cjs (spawns git.exe), tests/test_lesson_flush.cjs 'daily limit' (time-of-day).
```
