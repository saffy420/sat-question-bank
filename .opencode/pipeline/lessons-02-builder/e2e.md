# lessons-02-builder E2E — 2026-09-24

Viewport: 1366×768 Chromium (`playwright.config.js`, `newUserContext`). Current uncommitted workspace; local isolated E2E DB only. No deploy or remote mutation.

## Commands and outcomes

- `rtk npm run test:e2e` — first attempt blocked: `https://127.0.0.1:8787/login is already used`. Stopped pre-existing local `tools/e2e_server.cjs enabled` process before rerun, as required before local DB seed.
- `rtk npm run test:e2e` — builder test passed; full suite 10 passed, 1 failed. Failure: `tests/e2e/lessons-01-admin-dashboard/admin.spec.js:45`, C2 student Overview empty instead of containing `Math`.
- `rtk proxy npm run test:e2e -- tests/e2e/lessons-01-admin-dashboard/admin.spec.js` — reproduced same C2 failure; C1 and C3 passed. Raw output used to inspect failure after filtered `rtk` output.

## Builder checkpoints

`tests/e2e/lessons-02-builder/builder.spec.js` passed: domain + skill filters; add R&W and Math; drag reorder; remove and re-add; default and custom times with live totals; notes with rendered math and escaped script; save and reload persisted title/mode/order/times/notes; used-question badge and Hide all lesson questions; Save & start session generated six-character code, join URL, and persisted lobby session. Screenshots retained under `.opencode/pipeline/lessons-02-builder/e2e/`:

- `01-domain-skill.png` — filtered add.
- `02-reorder-remove.png` — drag/reorder/remove/re-add.
- `03-notes-math.png` — custom time and safe math notes preview.
- `04-saved.png` — saved builder.
- `05-reloaded.png` — persisted builder after reload.
- `06-hide-used.png` — used badge and hide-used results.
- `07-join-code.png` — join code and URL.

## Failure classification and repair

**App bug, not E2E test bug.** Repro: sign in as local `e2e-admin`, visit `/admin`, open seeded `e2e-student-1`; student summary and eight tabs render, but `#tab-content` stays empty on Overview. `public/admin.js:68` references `DOM_ORDER`; `public/admin.js:1` imported only `cbSort`. Overview rendering threw `ReferenceError: DOM_ORDER is not defined`. Original failure screenshot and trace: `.opencode/pipeline/lessons-00b-e2e-harness/e2e/results/lessons-01-admin-dashboard-3b1be-s-and-real-mistake-previews-chromium/` (`test-failed-1.png`, `trace.zip`, `error-context.md`).

Fresh Developer repair: added `DOM_ORDER` to existing `./shared/stats.js` import in `public/admin.js`; no tests changed. Same local E2E DB setup, Chromium 1366×768:

- `rtk npm run test:e2e -- tests/e2e/lessons-01-admin-dashboard/admin.spec.js -g 'C2 seeded student'` — pre-fix failed at `admin.spec.js:45` (1 failed); post-fix passed (1 passed), including Overview, other tabs and mistake previews. Post-fix C2 screenshots: `.opencode/pipeline/lessons-01-admin-dashboard/e2e/C2-overview.png`, `C2-mistake-MC.png`, `C2-mistake-SPR.png`.
- `rtk npm run test:e2e` — 11 passed, 0 failed; builder checkpoint and C2 passed. Builder screenshots listed above.
- `rtk node --check src/index.js && rtk node --check public/admin.js && rtk git.exe diff --check` — passed; Git emitted LF-to-CRLF warnings for `public/admin.html`, `public/admin.js`, `tools/e2e_core.sql`, `tools/e2e_seed.cjs` (no diff-check errors).

No deploy, remote mutation, commit, or test changes. Independent review and task02 STOP approval still pending.
