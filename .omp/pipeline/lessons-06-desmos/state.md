```text
Task: lessons-06-desmos
Branch: claude/lessons-06-desmos   Base: main
Last completed step: 0 (preflight — PASS)   Commit: fbde0b58 (+ this state commit)
Next step: §12.3 step 1 (Start): read PLAN.md, STATUS.md, .opencode/pipeline/lessons-05-annotations/handoff.md; then step 2 research (Desmos API) and step 3 spec.md.
Open blockers: none
Decisions made this task: BRIEF.md replaced verbatim; prior G1–G6 amendments moved to docs/lessons/AMENDMENTS.md (still binding). New pipeline artifacts go to .omp/pipeline/ per new brief; tasks 00–05 artifacts remain in .opencode/pipeline/. Playwright config accepts PW_CHROMIUM_PATH (run e2e with PW_CHROMIUM_PATH=/opt/pw-browsers/chromium) because the sandbox browser (chromium-1194) does not match Playwright 1.63's revision and `playwright install` is not allowed here. E2E serves pinned jsdelivr assets from a curl-filled cache (tests/e2e/cdn-cache.js) because sandbox Chromium drops proxied CDN connections. Unit tests need a scratchpad `git.exe` → `git` shim on PATH (tests/test_grade.cjs spawns git.exe).
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
