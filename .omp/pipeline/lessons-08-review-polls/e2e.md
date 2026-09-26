# lessons-08-review-polls — e2e

**Spec:** `tests/e2e/lessons-08-review-polls/review.spec.js` (1 test).

**Setup:**
- Local `wrangler dev` with local D1/DO (00b harness), seeded with `npm run e2e:seed`.
- Browser: the preinstalled Chromium via `PW_CHROMIUM_PATH=/opt/pw-browsers/chromium`.
- Students at 1366×768; instructor at 1920×1080.

**Lesson:** created through the admin API: `e2e-core-rw` 10 s, `e2e-core-math` 5 s, `e2e-core-spr` 5 s, `e2e-ai-rw` 15 s (notes `E2E_NOTES_MARKER_REVIEW`). That makes a 35 s shared clock.

**Students:**
- Students 1–3 join in the lobby.
- Student 4 joins right after start and is fitted a subset. That subset always includes Q4 (AI) and never Q3 (SPR, which only fits with the full clock), so per-question denominators differ.
- Everyone submits, so the set finishes early with no waiting.

The expected ranking, denominators, mean and median are computed in the spec from the answers each student entered and the set the server reported for the late joiner.

## Commands (round 0, commit 9a45c15a)

- **Task:** `npm run e2e:seed && PW_CHROMIUM_PATH=/opt/pw-browsers/chromium npx playwright test tests/e2e/lessons-08-review-polls`: **1 passed** (34 s).
- **Full suite:** `npm run e2e:seed && PW_CHROMIUM_PATH=/opt/pw-browsers/chromium npm run test:e2e`: **24 passed** (2.6 min), i.e. 23 existing + 1 new. Desmos latency in the same run: 252–281 ms.
- **Unit:** `npm test` with the `git.exe` → `git` shim: **89/89**. `npm run typecheck` is clean.

Artifacts (gitignored): `.omp/pipeline/lessons-08-review-polls/e2e/01-overview … 09-review-not-in-set.png`.

## Checkpoints

| # | Checkpoint | Result | Assertion |
|---|---|---|---|
| 1 | Overview ranks most-missed correctly with per-question denominators | PASS | The `#review-missed` rows match the expected ranking. Text is exactly `Qn — wrong of assigned wrong (pct)`, with RW assigned to 4 and SPR to 3. Row 1 is `… · Central Ideas and Details · Hard`. The mean, median and "4 of 4" completed values match the computed scores. The late joiner's score is x / their set size, with Late join "yes". The student drill-down shows Student 2's SPR answer "4" ✗. Sorting by score puts Student 2 first. The most-missed row opens the card with "answered 4/4 assigned". |
| 2 | The poll closes early when all students vote | PASS | After 3 of 4 votes the instructor sees "Votes 3 of 4 connected" and the room is still `POLL`. The 4th vote brings "Reviewing Q4" on all four students and the instructor. The close time (`pollResult.endsAt − 3 s`) is more than 10 s before the poll deadline. |
| 3 | Option 2 requires a dropdown pick | PASS | With option 2 and no pick, Vote is disabled and the status reads "Pick a question from the list for your vote to count." The instructor count stays at 0. A picked vote shows "Vote counted: Q1." The dropdown labels read Q1 ✓, Q2 ✓, Q3 ✓, Q4 ✗ for Student 1 and "Q3 not in your set" for the late joiner. The server-side refusal of an unpicked option 2 is covered by unit tests. |
| 4 | A split vote resolves to most-missed | PASS | The 2–2 split (two picks of Q1 against two most-missed votes) gives `pollResult = {questionId: AI, winner: 1, one: 2, two: 2}` and "Reviewing Q4". |
| 5 | Review mode syncs annotations | PASS | An instructor highlight made through the real toolbar ("The team practiced every day") appears as `[data-ann-mark]` on all four students. |
| 6 | A reviewed question disappears from the next poll | PASS | Next returns to the launcher; the most-missed list shows Q4 "reviewed". In the second poll, most-missed is the next-ranked question with its count, and the dropdown is exactly Q1, Q2, Q3 (no Q4). All four vote, and the room reviews that question. |
| 7 (added) | Review shows own answer / Not in your set, correct answer and explanation; no notes; leak helper clean | PASS | The phase label reads REVIEW. The page shows "Correct answer: A", "Your answer: B" (late joiner "A"), and choice A `.right`. The explanation marker appears only under review. The instructor drawer has the notes and the student never does. On SPR the late joiner sees "Not in your set". `captureLeaks` (phase-aware, peers) on all four students gives `violations() == []` with frames present. |
| 8 (added) | Reviews change no data | PASS | During review the choices are disabled and there is no Submit button. After two polls and one direct review, the admin `overview` deep-equals the one captured before the first poll. `grid[user][q][0]` equals every recorded answer, and `reviewed = [Q4, next, SPR]`. |
| 9 (added) | Review a specific question skips the poll; Next → launcher; End session ends | PASS | `goto` SPR puts every student straight into REVIEW with no poll screen. Next shows the overview again. End session shows "SESSION ENDED" to the instructor and "Session ended." to every student. |
| 10 (added) | Full existing suite green | PASS | 24/24. Tasks 00b–07 and the UI suites are unchanged. |

## Failures and classification

No spec failed. Reviewing the screenshots found one **app bug** (for repair round 1):

| ID | Screenshot | Expected | Actual |
|---|---|---|---|
| A1 | 06, 09 (student review) | No clock in review mode, since review is untimed | The header shows the finished set's countdown ("0:26", "0:21") with a Hide button. The review snapshot keeps the set's `endsAt`, which is still in the future when the set finished early. |

## Environment notes

- The workerd `SSLV3_ALERT_CERTIFICATE_UNKNOWN` lines are the known self-signed local TLS noise.
- There are no fixed sleeps. The 3 s result wait is a condition on the REVIEW phase label, and the early-close check compares server timestamps.
