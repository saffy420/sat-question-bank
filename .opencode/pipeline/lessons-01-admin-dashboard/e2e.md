# Test Developer e2e — lessons-01-admin-dashboard

Date: 2026-09-24. Status: **PASS after Developer repair round 2; ready for fresh independent Reviewer**. Local HTTPS `127.0.0.1:8787–8789` only; isolated `.wrangler/state-e2e`, owned test accounts, Chromium 1366×768. No production auth/data calls. Serena `initial_instructions` not exposed.

## Checkpoint map — final assertions

| Checkpoint | Result | Permanent spec and evidence |
|---|---|---|
| C1 roster/search/sort/zero activity | PASS | `tests/e2e/lessons-01-admin-dashboard/admin.spec.js` C1: seven named columns, five members including pending zero-activity `e2e-student-5`, ascending/descending numeric `Questions done`, email search. `e2e/C1-list.png`. |
| C2 eight tabs, real values/previews/pagination, inspection read-only | PASS | `admin.spec.js` C2: `e2e-student-1` four current questions, 50% accuracy, Overview 100% Algebra/0% Hard historical; By skill two Algebra questions and trends; four Red/Orange mistakes; domain/skill/difficulty filters incl. empty result; shared renderer Math MC four choices + KaTeX and disabled SPR grid-in with real answers/explanations; tagged trap count/example; pacing 35 timed attempts; first/final directions 1/1 and legacy unknown 32; history 25+10 rows, descending dates; Lessons honestly unavailable until task09. Student `GET /api/progress` and `GET /api/attempts` snapshots equal before/after entire admin inspection, including both previews and pagination. Screenshots `e2e/C2-overview.png`, `e2e/C2-mistake-MC.png`, `e2e/C2-mistake-SPR.png`. |
| C3 student/anonymous/admin route gates | PASS | `admin.spec.js` C3: student `/admin`, `/admin.html`, `/admin.js` redirect `/app`; known/unknown admin APIs and cross-student history 403; anonymous unknown API 401 and shell 302 `/login`; admin unknown API and nonexistent student 404. `e2e/C3-student.png`. |
| C4 prospective MC/SPR practice capture and shared metrics | PASS | `practice.spec.js` C4: new MC A→B wrong, SPR 2→3 correct; checked SPR verdict, persisted ordered `answer_history_json`/picked/correct from `/api/attempts`, baseline-keyed to exclude older attempts; admin directions increment right-to-wrong/wrong-to-right once with legacy unknown unchanged; seeded legacy account unknown 32; post-practice student dashboard totals/accuracy equal server progress. Screenshots `e2e/C4-student-SPR.png`, `e2e/C4-directions.png`. CLI browser captures `e2e/CLI-C4-MC-graded.png`, `e2e/CLI-C4-SPR-graded-round1.png`. |

## Final commands and results

- `rtk node tools/e2e_seed.cjs` — successful local-only seed while E2E dev servers stopped. Seed is repeatable for fixture IDs; append-only practice attempts from earlier runs remain, so C4 compares new attempt keys and direction deltas rather than claiming local D1 was reset. Added owned pending zero-activity `e2e-student-5` after CLI used `e2e-student-4` for exploratory practice.
- `rtk env PLAYWRIGHT_OUTPUT_DIR=.opencode/pipeline/lessons-01-admin-dashboard/e2e/results npx playwright test tests/e2e/lessons-01-admin-dashboard --workers=1 --max-failures=1` — **4 passed, 0 failed**, final run after last spec edit.
- `rtk env PLAYWRIGHT_OUTPUT_DIR=.opencode/pipeline/lessons-01-admin-dashboard/e2e/results npx playwright test --workers=1 --max-failures=1` — **10 passed, 0 failed**, final full run: six task00b + four task01. No skips/only/fixme, no fixed readiness sleeps or timeout increases.
- `rtk node --check tests/e2e/lessons-01-admin-dashboard/{admin,practice}.spec.js` — passed; `rtk git.exe diff --check` — passed (Windows Git future-CRLF warnings only). Developer independently reported unit **51/51**; not claimed as Test Developer run.

## Playwright CLI proof, 1366×768

- `node_modules/.bin/playwright cli open --browser=chromium https://127.0.0.1:8787/login`; self-signed local cert interstitial accepted manually; `resize 1366 768`; local-only fixture sign-in via `/api/e2e/login` and browser-only Supabase adapter matching task00b harness; `goto /app`; click Question Bank, Start practice, MC A then B then Check, Next twice, SPR 2 then 3 then Submit. Snapshot confirmed disabled SPR input value `3` and `✓ Correct`; screenshots `e2e/CLI-C4-MC-graded.png` and `e2e/CLI-C4-SPR-graded-round1.png`. Prior admin CLI browser screenshots: `e2e/CLI-C1-list.png`, `e2e/CLI-C2-overview.png`, `e2e/CLI-C2-MC.png`, `e2e/CLI-C2-SPR.png` (captured before adding pending fifth student). CLI browser and own enabled Wrangler process closed before final validation; temporary launcher/auth files removed.
- Local Wrangler emits TLS `SSLV3_ALERT_CERTIFICATE_UNKNOWN` log lines for probes despite all HTTP/browser assertions passing. CLI page logged one console error during CDN load; no acceptance claim about CDN/offline production behavior.

## Round 2 verification — after normalizer ordering and shared preview repair

- Cancelled round2 invocation in `state.md` had **no confirmed result**. Fresh invocation inspected processes/ports first: no owned server on 8787–8789; `rtk node tools/e2e_seed.cjs` succeeded on isolated DB and AI_DB with servers stopped. Append-only fixture attempts remain; C4 uses pre-run keys/direction deltas.
- `rtk env PLAYWRIGHT_OUTPUT_DIR=.opencode/pipeline/lessons-01-admin-dashboard/e2e/results npx playwright test tests/e2e/lessons-01-admin-dashboard --workers=1 --max-failures=1` — **4 passed, 0 failed** before and after tightening C2; final run with tightened C2 **4/4**.
- `rtk env PLAYWRIGHT_OUTPUT_DIR=.opencode/pipeline/lessons-01-admin-dashboard/e2e/results npx playwright test --workers=1 --max-failures=1` — **10 passed, 0 failed** before and after tightening C2; final run **10/10** (six task00b + four task01). No skips/fixme/only or timeout changes.
- C2 now asserts exact four MC letters/content and SPR explanation in admin preview; navigates actual Browse and asserts same MC letters/content/KaTeX/explanation and SPR answer/explanation. Existing C1 roster/search/sort, C2 eight tabs/filters/history/read-only, C3 gates, C4 MC/SPR history/directions/dashboard remained intact. `rtk node --check tests/e2e/lessons-01-admin-dashboard/admin.spec.js` and `rtk git.exe diff --check` passed (existing CRLF warnings only). Unit **51/51** remains Developer report, not rerun here.
- Playwright CLI, 1366×768: local fixture `e2e-admin` sign-in via browser-only Supabase adapter; owned enabled Wrangler HTTPS server; student1 admin Mistakes preview MC showed A 5/B 6/C 7/D 8, KaTeX, `E2E_EXPL_MARKER_MATH`, student/correct C; SPR showed disabled input 3 and `E2E_EXPL_MARKER_SPR`. Browse MC showed same four choices/KaTeX/explanation; Browse SPR showed `Answer: 3` and explanation. New screenshots: `e2e/CLI-round2-admin-MC.png`, `e2e/CLI-round2-admin-SPR.png`, `e2e/CLI-round2-Browse-MC.png`, `e2e/CLI-round2-Browse-SPR.png`. CLI session closed; owned server PID 2113 stopped before final suites; 8787–8789 not listening after runs. CLI auth helper `e2e/cli-login-round2.js` stays as owned artifact.
- Local Wrangler TLS probes still emit `SSLV3_ALERT_CERTIFICATE_UNKNOWN`; browser assertions pass. SPA CLI logged one console error consistent with prior CDN load; no production/CDN behavior claimed. No app bug observed round2. Seed lacks mojibake-specific MC fixture: normalization decoding-order case verified in Developer unit regression, not asserted as browser mojibake case.

## Failure history and classification (preserved)

- **App bug, repaired by Developer round 1**: `practice.spec.js:30` previously saw disabled SPR input `3` but empty `#spr-verdict`; expected `✓ Correct`. Developer reproduced `ReferenceError: cbIdx is not defined` from dashboard `bars()` during `refresh()`, before final `renderAnswerArea`; replaced stale reference with shared `cbSort`. Original failure screenshot/trace from previous run under `e2e/results/lessons-01-admin-dashboard-f48c8-ection-legacy-stays-unknown-chromium/` may be removed by Playwright `outputDir` cleanup on rerun; original repro retained in this report. After repair, exact SPR assertion passes in focused and full suites and CLI snapshot.
- **Test/fixture issues corrected, not app bugs**: initial ascending-sort tie assumption; invalid `Math` domain selection (actual domain `Algebra`); expecting Check/selection class after grading re-render; C4 assumed exactly two total attempts despite append-only previous runs (now captures pre-run keys/deltas); asserting Dashboard tab visible after returning to Question Bank home (home visible but selected tab remains Question Bank); CLI exploratory account `e2e-student-4` ceased being zero-activity, so added owned pending `e2e-student-5` for deterministic roster assertion. No assertion weakened to bypass app defect.

## Files changed within Test Developer boundary

- `tests/e2e/lessons-01-admin-dashboard/admin.spec.js` (round2 exact preview/Browse assertions)
- `tests/e2e/lessons-01-admin-dashboard/practice.spec.js` (prior Test Developer; unchanged round2)
- `tools/e2e_core.sql` (owned seed rows/math notation/Orange SPR/pending fifth member)
- `.opencode/pipeline/lessons-01-admin-dashboard/e2e.md` and task `e2e/` screenshots/results/owned CLI auth helper

No app/config/module/unit-test changes by Test Developer; no commit/push/deploy or remote mutations. Lessons populated assertion remains task09 G4 exception. Browser-only local test auth does not prove real Supabase OAuth, full-bank, or production behavior.
