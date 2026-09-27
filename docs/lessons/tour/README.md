# Live Lessons screenshot tour

Captured by `tests/e2e/lessons-10-e2e-regression/tour.spec.js` against local `wrangler dev` with seeded test data, then compressed with `node tools/e2e_tour_compress.cjs`.
- Students: 1366×768 (school Chromebook).
- Instructor: 1920×1080 (instructor laptop, BRIEF §13), plus one 1366×768 grid shot.

Both runs also pass the leak check on every student (`captureLeaks(...).violations() == []`).

## Instructor-paced class

| # | Screen |
|---|---|
| 01 | Student lobby: waiting, join count |
| 02 | Instructor lobby: join code, roster |
| 03 | Student answering, B selected |
| 04 | Submit confirmation dialog |
| 05 | Locked: disabled choices, "Answer locked in", no correctness |
| 06 | Instructor during answering: responses with lock state, no correctness to students |
| 07 | Reveal: right/wrong choices, correct answer, verdict |
| 08 | Class results chart, on screen below the passage (fixed in this task) |
| 09 | Instructor reveal: distribution, per-student marks |
| 10–11 | Shared highlight and strikethrough, student (Follow me) and instructor |
| 12–13 | Desmos: instructor's graph read-only in the student panel after reveal |

## Self-paced class

| # | Screen |
|---|---|
| 14 | Student lobby |
| 15 | Answering inside the set, flagged |
| 16 | Question navigator |
| 17 / 17b | Instructor set grid at 1920 and 1366 (◆ current, ░ not assigned to the late joiner) |
| 18 | "Check your work" review page |
| 19 | Submit all modal |
| 20 | Set finished, waiting for review |
| 21 | Instructor overview: average, median, completion, students, most-missed |
| 22–23 | Review poll: student vote with dropdown pick, instructor tally |
| 24–25 | Review mode with synced highlight, student and instructor |
| 26 | My Lessons list |
| 27–28 | Session history: question 1, then the missed question with explanation, Breakdown and saved highlight |
