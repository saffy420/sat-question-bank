```text
Task: lessons-06-desmos
Branch: claude/lessons-06-desmos   Base: main
Last completed step: 8 (docs: handoff.md + STATUS.md)   Commit: see git log
Next step: Step 9 — push, open PR 'lessons-06: desmos' base main, record URL here, end turn with the CHECKPOINT line.
Open blockers: none
Decisions made this task: BRIEF.md replaced verbatim; G1–G6 in docs/lessons/AMENDMENTS.md. Pipeline artifacts in .omp/pipeline/. PW_CHROMIUM_PATH + CDN cache for sandbox e2e; git.exe shim for unit tests. Desmos only in REVEALED (same gate as annotations). Desmos API needs 'unsafe-eval' + worker-src blob: (measured) → LESSON_CSP only on /app and /admin; _headers stays strict (browsers would enforce both). DESMOS_API_KEY env; demo key only on 127.0.0.1/localhost; else panel says unavailable. State under DO key 'desmos'; D1 only at next/endSession. Follower uses a capture-phase input guard (not inert) so the list scrolls. CDP throttle does not delay WS → Slow 3G via shapedOrigin TCP relay.
PR: pending
Instructions: docs/lessons/BRIEF.md — re-read §0, §12, §13 + §7.2
```

## Preflight log (2026-09-26)

1. `npm ci` — OK. `npx playwright install --with-deps chromium` not run: sandbox forbids browser download; preinstalled Chromium 141 used via `PW_CHROMIUM_PATH=/opt/pw-browsers/chromium` (launch verified).
2. `.dev.vars`: not needed — `tools/e2e_server.cjs` passes `--var E2E_TEST_MODE:1` and an explicit empty env file, suppressing `.dev.vars`. `npm run e2e:seed` — OK. Wrangler dev servers (8787/8788/8789) start via Playwright `webServer`; 00b sign-in route exercised by the passing harness specs.
3. Desmos reachability — FAIL: `curl https://www.desmos.com/...` → proxy CONNECT 403 (policy). Also `cdn.jsdelivr.net` → 403.
4. Full base e2e suite — 14 passed, 5 failed:
   - lessons-01 admin C2 (`#preview .katex` 0)
   - lessons-02 builder (`#notes-preview .katex` 0)
   - ui-admin-dashboard 1920x1080 and 1366x768 (`#notes-preview .katex` 0)
   - ui-student-player (`#lesson-card .katex` not found)
   All five: KaTeX loads from cdn.jsdelivr.net, which is blocked.

### Preflight rerun after allowlist update (2026-09-26)
- `www.desmos.com` 200 (API v1.11 redirects to v1.11.4), `cdn.jsdelivr.net` 200.
- First reruns: 18/19 then 16/19. Traces show `net::ERR_TOO_MANY_RETRIES` on cdn.jsdelivr.net assets inside Chromium (absent from the proxy failure log); specs themselves correct. Fix: `tests/e2e/cdn-cache.js` global setup + route in `newUserContext` (identical bytes, SRI intact).
- After fix: full suite 19/19 twice (1.7m each). `npm test` 75/75 with a `git.exe` → `git` shim (74/75 without; test_grade.cjs spawns git.exe).
