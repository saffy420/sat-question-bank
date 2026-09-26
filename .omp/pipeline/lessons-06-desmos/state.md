```text
Task: lessons-06-desmos
Branch: claude/lessons-06-desmos   Base: main
Last completed step: 0 (preflight — HARD STOP)   Commit: see git log (docs brief b42f1b4a + this preflight commit)
Next step: After the user allows www.desmos.com and cdn.jsdelivr.net in the environment network policy: rerun §12.2 preflight (curl both hosts; `npm run e2e:seed`; `PW_CHROMIUM_PATH=/opt/pw-browsers/chromium npm run test:e2e` must be 19/19 green), then start §12.3 step 1 for lessons-06.
Open blockers: HARD STOP §12.2 — network allowlist denies www.desmos.com (Desmos API script) and cdn.jsdelivr.net (KaTeX, supabase-js). Base e2e suite 14 passed / 5 failed, all 5 failures are missing `.katex` (KaTeX CDN blocked).
Decisions made this task: BRIEF.md replaced verbatim; prior G1–G6 amendments moved to docs/lessons/AMENDMENTS.md (still binding). New pipeline artifacts go to .omp/pipeline/ per new brief; tasks 00–05 artifacts remain in .opencode/pipeline/. Playwright config accepts PW_CHROMIUM_PATH because the sandbox browser (chromium-1194) does not match Playwright 1.63's revision and `playwright install` is not allowed here.
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
