```text
Task: lessons-11a-bugfixes
Tier: 2
Tier rationale: Five contained bug fixes across known code paths (room protocol, Stage, instructor view,
  builder CSS, student bridge). A1 touches the realtime contract (one new admin action and one new
  server message), so each bug was reproduced before fixing and every checkpoint fails with the fix reverted.
Session scope: this task only
Branch: claude/keen-fermi-tv16p3   Base: main (5cf11e6)
Parallel: lessons-11b (instructor layout), lessons-11c (student Desmos) from the same main; 11d follows this PR.
Status: complete. Unit 144/144, typecheck clean, full e2e 40/40.
Open blockers: none.
```

## Decisions

1. **A3 laser fix text was a placeholder.** The brief said "Apply this fix: [PASTE LASER FIX HERE]", with no fix pasted.
   I diagnosed it myself (see `e2e.md` A3); the user should compare this with the fix they meant to paste.
2. **Eliminations are live in every question phase.** Instructor eliminations sync in READY, ANSWERING and REVEALED,
   and in self-paced review mode. The brief says 11d will gate them to stay private until reveal, so 11a sends them
   whenever the instructor makes them. The single gate point is `Room.sharedEliminations` (see handoff).
3. **Fixture questions reuse existing IDs.** The laser checkpoint needs a passage question and a figure question.
   Adding rows would change the "7 questions" bank counts that specs 00b, 01, 02 and ui-admin assert. So
   `e2e-unused` became a passage + prompt question and `e2e-used-other` a figure question. IDs, taxonomy and answers
   are unchanged. The 11a laser spec never ends its session, so their usage rows (task 09's filter fixtures) don't change.
4. **Specs 07, 08 and 09 updated.** They asserted the old behaviour: after End session, a self-paced student stays in
   the lesson view and sees "Session ended." A5 replaces that, so they now assert the student is back on /app.
   Specs 04, 05 and 06 are untouched.
5. **A2 kept the crosshair for pen, eraser and laser.** Only Strikethrough showed the wrong indicator (the highlighter).
   The ui-admin spec asserts the pen crosshair, so the change is limited to Strikethrough's own cursor.
