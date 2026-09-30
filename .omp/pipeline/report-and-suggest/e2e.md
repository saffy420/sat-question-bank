# E2E: report-and-suggest

Environment: local `wrangler dev` (local D1 + DOs), 1366×768 student contexts, Anthropic API replaced by
`tools/e2e_anthropic_mock.cjs` on 127.0.0.1:8790 (the e2e entry only ever passes a loopback address; unit-tested).
`PW_CHROMIUM_PATH=/opt/pw-browsers/chromium-1194/chrome-linux/chrome`. Screenshots: `.omp/pipeline/report-and-suggest/e2e/` (gitignored).

Command: `npx playwright test tests/e2e/report-and-suggest` (6/6, ~45 s). Full suite: `npx playwright test`.

| Checkpoint | Spec | Result |
|---|---|---|
| R1 report from the bank: button directly after Mark for Review, 4 categories + optional note, payload keys exactly `question_id, category, note, seen_in, viewport, zoom, dpr, html` (no image data), reply 200, "Thanks", mock received report + stored fields + rendered HTML | `report.spec.js` R1 | pass |
| R2 report from a live lesson (`seen_in: lesson`, session id, no explanation in the HTML) and from My Lessons history (`seen_in: history`) | R2 | pass |
| R3 mocked valid fix → pending in Reports, real-renderer before (literal `$`) / after (KaTeX), nothing written until Approve, Approve closes reports, student sees the fix in `/api/questions` and the player, can report again | R3 | pass |
| R4 mocked fix changing `correct_answer` and one reordering choices → escalations with the validator's reason, no Approve button, nothing written, Close works | R4 | pass |
| R5 duplicate open report (message in modal), second student inside 24 h makes no second Claude call, 10/day then 429 (message in modal), monthly cap → escalation without a call | R5 | pass |
| R6 suggestion from bank More menu and lesson More menu, admin tab newest first, done / dismiss / show handled, 6th refused, student 403 on the admin list | R6 | pass |

Full suite (this branch, 16.6 min): **52 passed, 3 failed**. The same 3 fail identically on the untouched base commit `cadec68`
(clean worktree): they are not caused by this work.

| Spec | Failure | Class |
|---|---|---|
| `free-03-guardrails/banner.spec.js` "students: no banner request…" | `waitForLoadState('networkidle')` times out at 30 s | environment (fails on base) |
| `lessons-06-desmos/desmos.spec.js` Desmos sync | 3 min timeout, needs the live Desmos API script | environment (fails on base) |
| `lessons-11c.spec.js` instructor-paced calculator | same | environment (fails on base) |

After the last code change (hiding-content check) the report specs and the harness specs were re-run: 12/12.
Unit: `npm test` 165/167; the 2 failures are the baseline ones (`test_grade.cjs` needs `git.exe`; `test_lesson_flush.cjs` hard-codes 2026-09-28).

## Test bugs found and fixed (test commits touch only tests/)
- Playwright `response.json()` on the page's own POST to `/api/reports` or `/api/suggestions` hangs here; the reply body is asserted via API requests instead (R5, R6).
- R6 navigated a tab with a running practice session (beforeunload prompt) → the lesson now opens in its own tab.
- R5's first loop counted 409s; rewritten as 9 × (report, close).
- No app bugs were found by the e2e round. `test_e2e_auth` (unit) found one: production source named an E2E flag; fixed, see review.md.
