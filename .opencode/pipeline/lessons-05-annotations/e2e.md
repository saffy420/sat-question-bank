# Task05 E2E — PASS

Environment: isolated local D1/DO reseeded with `rtk npm run e2e:seed` (PASS). Playwright config starts three local Wrangler servers; enabled server uses `E2E_TEST_MODE=1`. No app edits, remote writes, or deployment.

## Checkpoints

| Checkpoint | Result | Evidence in `tests/e2e/lessons-05-annotations/annotations.spec.js`; screenshot under `.opencode/pipeline/lessons-05-annotations/e2e/` |
|---|---|---|
| Instructor highlights at 1920×1080; 1366×768 and 110% zoom students see identical string | PASS | Native selection, both students' mark strings equal `Careful readers compare evidence`, instructor mark checked; `01-instructor-1920x1080-before.png`, `02-instructor-1920x1080-highlight.png`, `03-student-1366x768-highlight.png`, `04-student-1366x768-110pct-highlight.png` |
| Strikethrough: cross-viewport string and live reception | PASS | Both student marks equal `question assumptions` and CSS `text-decoration-line: line-through`; `05-student-110pct-strike.png` |
| Pen strokes and laser appear live | PASS | Shared snapshot contains stroke; student canvas pixel checks for stroke and ephemeral laser colors; `07-student-live-pen.png`, `08-student-live-laser.png` |
| Follow me scrolls long passage | PASS | Offscreen paragraph verified, student scrollTop increases on annotation; disabling Follow keeps scrollTop unchanged on next mark; `06-student-follow-long-passage.png` |
| Reconnecting student sees highlights, strike, ink | PASS | Reload and rejoin same code, compare four text marks, visible stroke pixels and preserved layer IDs; `09-student-reconnected.png` |
| Students cannot draw on shared layer | PASS | Student toolbar absent, WS annotation rejected `invalid action`, layer IDs unchanged; `10-student-write-denied.png` |
| Targeted erase and clear-all | PASS | Erase strike alone; other marks and stroke remain. Clear removes all marks and shared snapshot layer; reload/rejoin remains empty; `11-student-strike-erased.png`, `12-student-clear-reconnected.png` |

All screenshots: `.opencode/pipeline/lessons-05-annotations/e2e/01-instructor-1920x1080-before.png` through `12-student-clear-reconnected.png` (12 files). Viewports asserted in spec: instructor 1920×1080; students 1366×768; second student CSS zoom 110%. Earlier 404 blocker resolved by app Developer before this re-run.

## Commands

- `rtk npm run e2e:seed` — PASS; isolated local seed.
- `rtk npx playwright test tests/e2e/lessons-05-annotations/annotations.spec.js --workers=1` — initial FAIL 0/1: test expected wrong lexical order of sorted mark strings; corrected spec only.
- `rtk npx playwright test tests/e2e/lessons-05-annotations/annotations.spec.js --workers=1` — FAIL 0/1: test assumed reload automatically rejoins live view; corrected by rejoining same code.
- `rtk npx playwright test tests/e2e/lessons-05-annotations/annotations.spec.js --workers=1` — FAIL 0/1: second sorted expected array order; corrected spec only.
- `rtk npx playwright test tests/e2e/lessons-05-annotations/annotations.spec.js --workers=1` — PASS 1/1 after test corrections.
- `rtk npm run test:e2e` — PASS 14/14, including task03 and task04.
- `rtk npx playwright test tests/e2e/lessons-05-annotations/annotations.spec.js --workers=1` — PASS 1/1 after adding reconnect ink and targeted-erase stroke assertions.
- `rtk npm run test:e2e` — PASS 14/14 after final spec changes. Wrangler shutdown logged local TLS `SSLV3_ALERT_CERTIFICATE_UNKNOWN` noise; Playwright exit successful.

No skipped checkpoints or app blockers. Tests use local seeded browsers/DO, not deployed or physical devices.
