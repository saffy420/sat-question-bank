# Handoff: lessons-00b-e2e-harness

## Status
**REVIEWER PASS** — 2026-09-24. Independent Reviewer full6/6 once. Task00b uncommitted, awaiting explicit user acceptance/commit authorization. No push/deploy. Task01 not started.

## Goal
Build isolated local browser harness and test sign-in for Live Lessons e2e checkpoints (BRIEF §12.5 task00b). No feature code, no production auth change, no commit/push/deploy. Complete C1–C4 browser checkpoints, helper suite, and full e2e regression.

## What changed

### Developer (uncommitted, pre-review)
- `src/index.js`: exported `handleRequest` + `resolveIdentity = whoami` default seam (3-line DI). Zero `E2E_TEST_MODE`/`/api/e2e` in production entry.
- `src/index.e2e.js`: new local-only entry. `/api/e2e/login` POST with exact `E2E_TEST_MODE='1'` flag; allowlisted accounts only; 64-cap server-held sessions, 1h TTL, crypto-random tokens; `__Host-sat_session` secure cookie before `/app`.
- `wrangler.e2e.toml`, `wrangler.e2e-production.toml`: local synthetic D1 IDs, no routes/Supabase bindings. `--persist-to .wrangler/state-e2e`.
- `tools/e2e_server.cjs`: fixed 8787 (enabled), 8788 (flag-unset), 8789 (production-entry/flag-set); `--local-protocol https`; `tools/e2e_unset.env` empty override.
- `tools/e2e_seed.cjs`, `tools/e2e_core.sql`, `tools/e2e_ai.sql`: both schema snapshots, 5 accounts, 3 core + 1 AI question + registry. Idempotent, `--local` only.
- `tools/e2e_smoke.cjs`: finite local HTTPS smoke.
- `playwright.config.js`: Chromium, `use.baseURL`, 1366×768, three Playwright-owned webServers, no reuse. `@playwright/test@1.63.0` exact devDep.
- `tests/test_e2e_auth.cjs`: auth and esbuild import-graph unit proofs. `.gitignore` updated for `.dev.vars`.
- Unit suite: `rtk npm test` 46/46 (up from 43 baseline).

### Test Developer (uncommitted, pre-review)
- `tests/e2e/lessons-00b-e2e-harness/`: permanent Playwright specs (auth.js, harness.spec.js, network.js, leaks.js).
- Helpers: `auth.js` (signIn), `contexts.js` (multi-context), `offline.js` (setOffline), `throttle.js` (CDP SLOW_3G), `leak.js` (captureLeaks).
- `e2e/` artifacts: CLI screenshots at 1366×768: `C1-admin.png`, `C2-student-MC.png`, `C2-student-SPR.png`, `CLI-C1-admin-1366x768.png`, `CLI-C2-student-bank-1366x768.png`, `CLI-C2-student-MC-1366x768.png`, `CLI-C2-student-SPR-1366x768.png`.
- `e2e.md`: full checkpoint mapping, command evidence, repair history, limits.

### Environment repair
- WSL Chromium missing shared libraries (`libnspr4.so`, `libnss3.so`, `libnssutil3.so`, `libasound.so.2`). User installed WSL deps. Real Chromium launch confirmed: version 153.0.8010.12 via `chromium-probe.cjs`.
- Prior `playwright install-deps chromium` timed out with no output; not repeatable without confirming root/sudo. Documented honestly — no claim of install success from that attempt.

### Repair rounds (3 of 5)
1. **HTTPS cookie** — Chromium rejected `Secure; __Host-` cookie from `http://127.0.0.1:8787`. Fixed: `--local-protocol https` on all Wrangler targets, `use.ignoreHTTPSErrors` and `webServer.ignoreHTTPSErrors` in Playwright config. Browser probe (`repair1-probe.cjs`) confirmed secure cookie + `/app` + both banks over HTTPS. Real Chromium cookie proof.
2. **WS fixture** — Reviewer rejected manual `EventEmitter` frame injection as not proof of browser transport. Replaced with real owned loopback HTTP + `ws@8.21.0` (transitive Miniflare dep), actual browser `page.on('websocket').framereceived`. Controlled fixture transport, not lesson WS.
3. **C2 boot race** — `#btn-start` hidden by `setTab('dash')` after `bank()` returned before boot finished. Fixed: `bank()` now waits for rendered `#home-stats`, Practice `.hide`, Dashboard visible; C2 clicks `[data-tab="practice"]` then asserts `#btn-start` visible before click. One focused run 1/1, full suite 6/6.

### CLI screenshots paths (from e2e.md)
- `.opencode/pipeline/lessons-00b-e2e-harness/e2e/C1-admin.png`
- `.opencode/pipeline/lessons-00b-e2e-harness/e2e/C2-student-MC.png`
- `.opencode/pipeline/lessons-00b-e2e-harness/e2e/C2-student-SPR.png`
- `.opencode/pipeline/lessons-00b-e2e-harness/e2e/CLI-C1-admin-1366x768.png`
- `.opencode/pipeline/lessons-00b-e2e-harness/e2e/CLI-C2-student-bank-1366x768.png`
- `.opencode/pipeline/lessons-00b-e2e-harness/e2e/CLI-C2-student-MC-1366x768.png`
- `.opencode/pipeline/lessons-00b-e2e-harness/e2e/CLI-C2-student-SPR-1366x768.png`

## Decisions
- Pipeline path `.opencode/pipeline/<task-name>/` per workspace instruction (not `.omp/`).
- Local-only test auth Option B: separate entry/config, `E2E_TEST_MODE='1'` exact flag, isolated D1/DO, browser-only Supabase session adapter.
- G1-A: narrowed lesson-channel guarantee; practice bank access unchanged.
- All G2–G6 approved as written per PLAN.md 2026-09-23.
- HTTPS for local e2e servers (not HTTP) — required for Secure cookies on loopback.
- Real WS fixture over controlled loopback rather than manual EventEmitter injection.
- C2 fix via condition synchronization (tab switch + visibility wait), not timeout inflation.
- Bounded retry rule established: same failure signature stops; correction required before rerun. No unchanged-signature retries.

## Validation
- `rtk npm test`: 46/46 pass (unit suite, including existing auth negatives and new e2e auth proofs).
- `rtk npm run test:e2e -- tests/e2e/lessons-00b-e2e-harness`: 6/6 pass (final).
- `rtk npm run test:e2e` (full suite): 6/6 pass.
- `rtk node tools/e2e_smoke.cjs`: enabled app+both banks 200, unset login 404/token 401, production-entry flag login 404 over local HTTPS.
- HTTPS browser probe (`repair1-probe.cjs`): `HTTPS browser cookie/login/app/both-bank PASS; Chromium 153.0.8010.12`.
- Chromium launch/page/close probe (`chromium-probe.cjs`): PASS, browser version 153.0.8010.12.
- `rtk git diff --check`: clean. No commits, no push, no deploy.
- Independent Reviewer full6/6 once; unit46/46 earlier (reviewer+developer), not claimed as final rerun.

## Review
**PASS** (Reviewer session `ses_f2c966257ffe80iSj8JTLx6fb2`). 3/5 app/review repair rounds.

Reviewer verified: production `whoami` remains default, esbuild excludes local test imports, exact flag enforced on issuance and resolution, random bounded allowlisted sessions, loopback launcher with isolated D1 IDs, real enabled/unset/production targets, designated admin is seed label not role feature, CLI screenshots exist, Test Developer diff limited to tests and artifacts.

All 00b checkpoints pass. E2E helper fixture uses real WS (loopback `ws@8.21.0`), not manual injection.

## Caveats
- **Transitive WS dependency**: the real WS fixture uses `ws@8.21.0` which is a transitive dependency of Miniflare/Wrangler. Subject to future dependency updates; not pinned explicitly.
- **No real lesson WS/decodedHTML/clientstate secrecy guarantees**: current harness proves HTTP and real fixture WS collection. Real lesson socket payloads, decoded HTML/client-state leak checks belong to future tasks (04/07+).
- **No roles feature**: admin is a seeded identity label only. No `role` column exists in schema; no `/api/admin/*` routes. Task01 adds roles.
- **E2E sessions live only in Worker memory**: reload loses sessions. Documented limit, not feature work.
- **Seeded bank is 4 rows**, not the full recovered question bank.
- **Prior repeat-loop historical failures documented honestly**: the cancelled Test Developer run (~435 invocations, all dying at 1ms with Chromium shared-library errors) and the initial incomplete task invocation (pre-Test-Developer `node node_modules/@playwright/test/cli.js test --list` returning "No tests found") are recorded in `failure-research.md` and `developer.md` respectively — not as passes.
- **Environment repair**: the timed-out `playwright install-deps chromium` attempt produced no output and cannot be claimed as successful. The actual success was the user-installed WSL dependencies verified by `chromium-probe.cjs`.
- **WSL/Windows shell caveat**: WSL executes Linux `workerd`; Windows Serena shell has incompatible Linux-only `@cloudflare/workerd-linux-64`. Run Node/Wrangler from WSL shell.
- **No commits/push/deploy**. All changes uncommitted.

## Next session
1. **User acceptance required** before any commit of task00b artifacts. One local commit per task, no push/deploy (commit policy).
2. After user approval: commit task00b uncommitted changes, update `state.md` to committed.
3. **Task01 not started** — awaiting task00b commit authorization and subsequent task01 STOP approval.
4. Future tasks 04/07 will need real lesson WS secrecy and decodedHTML/client-state leak checks under G1-A.
