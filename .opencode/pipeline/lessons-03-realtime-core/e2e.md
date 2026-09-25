# Task03 browser checkpoint report — 2026-09-24

**PASS: app repair verified.** Local-only E2E server, isolated D1 seed, 1366×768 Chromium. No app edits, deploy, remote mutation, or commit in this test pass. All screenshots at `.opencode/pipeline/lessons-03-realtime-core/e2e/` (ignored).

## Checkpoints executed

| BRIEF §12.5 task03 | Result | Actual assertions and evidence |
|---|---|---|
| Nav modal wrong code inline; lowercase and pasted codes | PASS | Wrong-code error inline, live view hidden; lowercase join and pasted code normalize to uppercase, open room WS, connected UI and title. `02-wrong-code.png`, `03-student-lobby.png` |
| Instructor lobby names live | PASS | Join code displayed; roster shows Student 1, Student 2, then Student 3; first student's lobby shows 2 joined. `01-instructor-lobby.png`, `04-live-roster.png` |
| Joining after start | PASS | Student 3 joins during ANSWERING, sees first question and nonempty clock. `06-after-start.png` |
| Student offline 20s restores question/time/selection | PASS | Student 3 selects C; admin GET confirms server-backed C before drop. Proxied **real upstream WS** closed with code 1000; browser `WebSocket.isClosed()` true and UI `Reconnecting…` before context offline. Measured offline interval >=20,000 ms; socket remains closed at end of interval. On reconnect: `Connected`, ANSWERING, same question, C pressed; clock nonempty and elapsed clock seconds >= measured offline seconds minus 2. Not CDP flag alone. `05-answering.png`, `07-reconnected.png` |
| Second tab closes first without eviction | PASS | Second page same account joins and opens room WS; first browser WS closes and first tab displays `Opened in another tab.`; second stays Connected and restores B selection. `08-second-tab.png` |
| Lock joining blocks new joins | PASS | Instructor checkbox checked, admin GET `lockedJoin: true`; new Student 4 sees inline `joining locked`, live view hidden; incumbent second tab remains Connected. `09-joining-locked.png` |

Seed: `tools/e2e_core.sql` supplies 55-second R&W question plus 7-second Math MC and 6-second Math SPR; test creates instructor-owned template/session with those timers through local admin API. Separate account contexts except intentional same-student second tab. Initial first-tab B and offline student's C are separate selections. Prior app blocker (`replaced by another tab` on fresh second-tab join) no longer reproduces.

## Validation

- `rtk npm run e2e:seed` — PASS, isolated local D1 seed; E2E ports free before seed.
- `rtk npx playwright test tests/e2e/lessons-03-realtime-core/realtime.spec.js --workers=1` — PASS 1/1 after clock restoration assertion added; earlier post-repair run also passed 1/1.
- `rtk npm run test:e2e` — PASS 12/12 including task03; Wrangler printed local TLS `SSLV3_ALERT_CERTIFICATE_UNKNOWN` logs during teardown, without failing tests.
- `rtk npm test` — PASS 64/64 unit tests (run alongside first full E2E pass; no app/unit changes since).
