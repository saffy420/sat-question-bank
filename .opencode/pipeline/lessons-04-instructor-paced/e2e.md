# Task04 E2E — 2026-09-25 — PASS / user gate

Local seeded Wrangler only (`https://127.0.0.1:8787`, plus harness flag-unset and production-entry local ports 8788/8789); Chromium viewport 1366×768. No production traffic, deployment, app edits or commit. Permanent spec: `tests/e2e/lessons-04-instructor-paced/paced.spec.js`. Three isolated signed-in student contexts plus instructor use real app, HTTP and WS. Lesson-channel leak helper in `tests/e2e/lessons-00b-e2e-harness/leaks.js` runs phase-aware on each student; practice `/api/questions` remains approved exception. Modal stacking repair in `public/index.html` now allows normal pointer clicks; no forced clicks, skips or test bypasses.

## BRIEF §12.5 task04 checkpoint matrix

| Checkpoint | Result | Assertion / screenshot in `.opencode/pipeline/lessons-04-instructor-paced/e2e/` |
|---|---|---|
| Instructor + 3 students; live response ○/◐/● | PASS | All join; `0/3` ○, `1/3` ◐ with choice/correctness, ● after lock; `01-lobby.png`, `02-selected.png`, `03-locked.png`, `04-responses.png`. |
| Early-submit modal: Go back keeps editing; Yes, submit locks and hides correctness | PASS | Exact question in dialog; normal Go back click preserves B; edits to A; normal confirm click locks, disables changes, waiting text, no correct answer; `03-confirmation.png`, `03-locked.png`. |
| At 0 unsubmitted selection final | PASS | Student 1 enters `1/2` without locking; waits for `0:00`, disabled grid, REVEALED; server room response retains `1/2`; `07-spr-answering.png`, `08-spr-distribution.png`. |
| Reveal colors correct | PASS | Correct A green, Student 2 wrong B red, correct A green for Student 2; correct-answer disclosure only after reveal; `05-reveal-distribution.png`. |
| Distribution counts, clicked bar right names | PASS | A=1, B=1, blank=1; click B shows only Student 2 with seconds, click blank shows Student 3; `05-reveal-distribution.png`. |
| Show class results toggles student chart | PASS | Student chart absent before toggle, anonymous chart visible after instructor checks, hidden after uncheck; `06-reveal-chart.png`. |
| +15s and End now | PASS | Instructor adds time; server `endsAt` > current time +15s; End now yields REVEALED on all four views. |
| SPR responses group by normalized value | PASS | Inputs `1/2`, `2/4`, `.5`; `0.5 ███ 3` one group; clicking lists all three names; `08-spr-distribution.png`. |
| No pre-reveal answer/explanation/notes; no notes any phase | PASS | Student-scoped lesson HTTP and browser-received WS frames captured throughout; nonempty HTTP and WS per student, phase-aware key/marker and peer-name checks report `[]`; no student chart before reveal. |

## Commands / evidence

- `rtk npm run e2e:seed` — PASS; isolated local DB, ports free before seeding.
- `rtk proxy npx playwright test tests/e2e/lessons-04-instructor-paced/paced.spec.js --workers=1` — PASS 1/1 after modal repair; repeated after moving screenshots under pipeline `e2e/`: PASS 1/1 (20.8s test, 1.2m with local server lifecycle).
- `rtk npm run test:e2e` — PASS 13/13 including task03 and task04; repeated after screenshot-path edit: PASS 13/13 (1.4m). Playwright starts only fixed local Wrangler targets. Local self-signed TLS generates noisy workerd `SSLV3_ALERT_CERTIFICATE_UNKNOWN` log lines during teardown; test results pass.
- `rtk git.exe diff --check && rtk proxy node --check tests/e2e/lessons-03-realtime-core/realtime.spec.js` — PASS. Task03 stale exact `Connected` checks now require visible `#lesson-connection` with `● Connected` (text plus indicator), not weaker substring match.
- Nine checkpoint screenshots in `.opencode/pipeline/lessons-04-instructor-paced/e2e/`, captured with configured 1366×768 viewport; gitignored. Earlier blocked-modal screenshots under `tests/e2e/lessons-04-instructor-paced/` are historical, not pass evidence.

Failure classification: prior task04 Go back pointer interception was app modal stacking bug, repaired upstream; prior task03 `Connected` exact-text failure was stale E2E expectation against `● Connected`, repaired in test. Current run: no failures or missing task04 checkpoint. Next gate: user's real Chromebook test; browser E2E does not prove touch behavior, production data, or deployed runtime.
