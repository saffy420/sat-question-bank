# Repair 1/5 — local browser cookie / HTTPS

Date: 2026-09-24. Root cause in `e2e.md`: Chromium rejects `Secure; __Host-` cookie from `http://127.0.0.1:8787`, despite request-only login200. Production cookie and auth source unchanged.

## Files changed
- `tools/e2e_server.cjs`: add Wrangler `--local-protocol https` to all three loopback-only local targets. Existing `--local`, isolated D1 and explicit flag scopes unchanged; Wrangler generates local development certificate.
- `playwright.config.js`: baseURL and three readiness URLs `https://127.0.0.1` with same 8787/8788/8789 ports; `use.ignoreHTTPSErrors` for test-owned contexts and `webServer.ignoreHTTPSErrors` for readiness TLS checks. Playwright docs distinguish those two independent settings.
- `tools/e2e_smoke.cjs`: HTTPS Node request with local-only certificate bypass; same target checks, not browser authentication proof.
- `.opencode/pipeline/lessons-00b-e2e-harness/repair1-probe.cjs`: standalone focused Chromium probe (not Playwright spec), HTTPS real browser login, cookie jar secure/HttpOnly value check, authenticated initial `/app`, Supabase browser-only adapter bootstraps `/api/auth/session`, and both-bank load. Owned server stopped after probe.
- Pipeline `developer.md` and this report. No app UI, production auth, `src/index.js`, `src/index.e2e.js`, fixture/spec edits, deployment or commit.

## Validation
- First browser probe: login200, `__Host-sat_session` present and `/app` HTTP200, but app JS redirected to `/login` because probe had not yet installed browser-only Supabase adapter. This was a **probe setup bug**, not cookie failure; corrected probe before second invocation.
- Second and last browser probe: `rtk node .opencode/pipeline/lessons-00b-e2e-harness/repair1-probe.cjs` → `HTTPS browser cookie/login/app/both-bank PASS; Chromium 153.0.8010.12`. Wrangler logs: HTTPS `/api/e2e/login` 200, `/app` 200, `/api/auth/session` 200, `/api/questions` 200. Checked cookie token match, secure/HttpOnly, page stays `/app` and four seeded rows include AI. TLS logs also show certificate-unknown alerts from unrelated browser/CDN traffic, but required path succeeded; test full browser suite remains pending.
- `rtk npm test`: 46/46 pass.
- `rtk node tools/e2e_smoke.cjs`: enabled app+both banks200, unset login404/token401, production-entry flag login404 over local HTTPS.
- Sources: [Wrangler dev flags](https://developers.cloudflare.com/workers/wrangler/commands/workers/#dev) (`--local-protocol https`, `--ip`, local); Context7 `/microsoft/playwright/v1.63.0` (`use.ignoreHTTPSErrors`, separate `webServer.ignoreHTTPSErrors`).

## Test Developer handoff
Update only `tests/e2e/**`: origin literals in `auth.js`, `harness.spec.js` C3/C4 to `https://127.0.0.1:8787`/8788/8789; `localURL` allow `https:` and deny remote. `newUserContext(browser, ...)` directly creates contexts: set `ignoreHTTPSErrors: true` there, not only in root config. Controlled fixture WebSocket URL must use `wss:` for HTTPS page. Keep real browser POST, cookie jar assertion and no blanket Authorization injection. Rerun focused C1 once, task suite once, full suite once and CLI screenshots; classify any *new* failure. No production sign-in claim.
