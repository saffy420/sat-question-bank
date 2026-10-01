# bank-bluebook — e2e

Environment: local `wrangler dev` (https, local D1 + DO) from `npm run e2e:seed` on a clean `.wrangler/state-e2e`;
`PW_CHROMIUM_PATH=/opt/pw-browsers/chromium-1194/chrome-linux/chrome`; student contexts 1366×768 and 1920×1080.
Screenshots: `docs/lessons/bank-bluebook/` (README lists them).

## Baseline on main (50cb6bc), before any change — 70/80
10 failures, none involving the practice player:
- 8 × `lessons-11-ui-polish` layout (6) and shapes (2): the question bar's `Report` control (added by report-and-suggest) is an
  outlined box; the lessons-11 "no boxed buttons" sweeps flag it. The two merged tasks were never run together. Classified:
  **test conflict** (screenshot B draws Report boxed), resolved by exempting `.stage-report` in the sweeps.
- `free-03-guardrails/banner.spec` "no banner request" (networkidle timeout, known sandbox flake, noted in figure-viewer state) and
  `ui-admin-dashboard/admin.spec` 1920×1080 sessions list: both passed on the next full run (flakes).
Unit: `npm test` 150/152 on main (`test_grade.cjs` spawns `git.exe`; `test_lesson_flush.cjs` "daily limit" is time-of-day).

## Result — `npx playwright test`: **94 passed, 0 failed** (12.3 min). Unit: `npm test` 186/188 (same 2 pre-existing); `npm run typecheck` clean.

| Checkpoint | Spec | Result |
|---|---|---|
| C1 bank beside B, 1366×768 and 1920×1080: header/footer/dashes, type sizes, tool row, pill, primary, column, question bar, choice rows, no sideways scroll | `bank.spec.ts` C1 ×2 | pass |
| C2 right answer: `Next` → `Check` → `Next`, green choice, explanation, one attempt; both sizes | C2 ×2 | pass |
| C3 wrong MC marked red + disabled, retried, then right; no `.right`, reveal, explanation text, "Correct answer" or export content before close; one first-try attempt, progress +1 Red; both sizes | C3 ×2 | pass |
| C4 SPR `Show answer` only after 3 wrong Checks; attempt stays wrong; both sizes | C4 ×2 | pass |
| C4b SPR right after 2 misses (Enter checks): one wrong attempt | C4b | pass |
| C5 leave mid-retry (Next, navigator, Back): first-try result kept, retry resumes; results first-try, Corrected pill, result click reopens bank screen; Mistakes lists it | C5 | pass |
| C6 Annotate (no choice picked), cross-out, Mark for Review, Notes + saved note, calculator dock, Hide/Pause, dark theme (footer stays pinned), 390 px | C6 | pass |
| C7 keyboard 1–4 / arrows / Dashboard confirm | C7 | pass |
| C8 note typed then left by Next before the debounce is saved to its own question | C8 | pass (fails with the bug re-introduced) |
| C9 practice exam still on the old screen: no Check, answers saved, Save & quit | C9 | pass |
| Unit: first Check records once, time to first Check, Show answer, unscorable, switches, history bound, exam path | `tests/test_bank_record.ts` 13 tests | pass (4 fail when `if (first)` is mutated to `if (true)`) |
| Updated specs on the new screen | practice (lessons-01), harness (00b), report-and-suggest R1–R6, figure-viewer bank test, lessons-11 layout/shapes | pass |

Failures during development, classified:
- C1 pill height 38 vs 36 px: **app bug** (button reset beat the pill's padding/font); fixed in `bank.css`.
- C5 Mistakes text: **test bug** (asserted a choice word the list does not show).
- C8 first version passed with the bug present: **test bug** (a blur saved the note before navigation; stale note from an earlier
  run); fixed with a DOM click and a unique note text, then shown to fail against the re-introduced bug.
- Dark theme filter on `#bank-live` made the fixed footer scroll away: **app bug**, found by viewing, fixed (filter on the parts).
