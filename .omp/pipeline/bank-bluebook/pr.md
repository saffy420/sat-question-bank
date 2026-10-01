## Summary
Practice questions now play on the lesson-ui student screen (screenshot B): same header, tools, column, choice rows and footer, in React + TypeScript, mounted like lesson-ui. The footer button reads Next → Check → Next. A wrong Check marks the pick red and disables it, with no answer or explanation until the question is solved; the attempt is recorded once at the first Check (first-try result, time to it). SPR offers Show answer after 3 wrong Checks. Math figures use the figure viewer. The record path moved to `lesson-ui/record.ts`, with unit tests.

Exams and exam review keep the old screen. Links: `.omp/pipeline/bank-bluebook/` spec.md, e2e.md, review.md, handoff.md; screenshots `docs/lessons/bank-bluebook/`.

## E2E
94/94 (main was 70/80 before any change; see e2e.md). `npm test` 186/188 (the 2 failures are on main). Typecheck clean.

## Review
PASS after one repair round (note saved to wrong question; dark-theme filter broke fixed footer).

## Deviations / behaviour changes
See handoff.md: practice only (exams unchanged), Retry-mode setting removed, grid-in accepts `-0-9./`, Copy for AI omits the answer until closed, z-index changes.

## Manual check before merge
Chromebook run (MC/SPR/figure, retry, Show answer), dark theme, real Desmos calculator dock, a practice exam.
