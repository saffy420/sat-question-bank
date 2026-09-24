# Failure research — lessons-00b-e2e-harness (cancelled Test Developer)

Date: 2026-09-24. Read-only investigation. No code/test/config edits, no commits, no test reruns beyond one diagnostic.

## Exact failed command

```
rtk npm run test:e2e -- tests/e2e/lessons-00b-e2e-harness --workers=1 --reporter=list
```

Variants without `--reporter=list`/`--workers=1` also used. ~435 invocations, roughly every 60 s,
2026-09-24T03:01Z → 10:47Z, session `ses_f2ea91301ffeKOAvxtevOf9Hpf`
("Build and execute browser checkpoints (@developer subagent)").
Cancelled 10:48:04Z (`cancel session` → `error=Aborted`). Earlier: 05:58Z
`ProviderHeaderTimeoutError` (model API, unrelated to test failure).

## Exact error (identical on every run)

```
Running 6 tests using 1 worker
  ✘ C1 admin login ... (1ms)
  ✘ C2 student separate context ... (1ms)
  ✓ C3 real flag-unset server ... (92ms)
  ✓ C4 production entry ... (57ms)
  ✘ offline HTTP failure ... (1ms)
  ✘ scoped leak capture ... (1ms)
  1) Error: browserType.launch: Target page, context or browser has been closed
     Browser logs:
     <launching> /home/leon/.cache/ms-playwright/chromium_headless_shell-1243/chrome-headless-shell-linux64/chrome-headless-shell ...
     [pid=...][err] .../chrome-headless-shell: error while loading shared libraries:
       libnspr4.so: cannot open shared object file: No such file or directory
```

Browser fixtures die at 1 ms; request-only tests C3/C4 pass → three Playwright
webServers (8787/8788/8789) started and answered; wrangler/workerd fine under WSL.

## One diagnostic (same signature)

```
ldd chromium_headless_shell-1243/.../chrome-headless-shell | grep "not found"
  libnspr4.so => not found
  libnss3.so => not found
  libnssutil3.so => not found
  libasound.so.2 => not found
ldd chromium-1243/.../chrome | grep "not found"
  (+ libsmime3.so)
chrome-headless-shell --version  →  exit 127, same libnspr4 error
```

Matches recorded failure exactly. Stopped there.

## Classification

**Runtime/OS environment, not app bug, not test bug.**
WSL lacks Chromium shared libraries. Playwright 1.63.0 chromium rev 1243 downloaded
OK (02:57Z); OS deps never installed. Prior partial attempt 2026-09-21
(`apt-get download libnspr4 libnss3 libasound2t64` → `~/pwlibs`) never completed;
`playwright install-deps` never run for this machine state.

Not: workerd platform mismatch (linux-64 present, C3/C4 prove servers), not
EADDRINUSE, not webServer timeout (runs fail in ~60 s wall = 3× wrangler boot + instant
browser crash; config timeout 90 s never hit), not missing browser binary, not spec logic.

## Current state

- Modified (Windows git.exe): `.gitignore`, `package-lock.json`, `package.json`,
  `src/index.js`.
- Untracked: `playwright.config.js`, `src/index.e2e.js`, `tests/e2e/`,
  `tests/test_e2e_auth.cjs`, `tools/e2e_*.{cjs,sql,env}`,
  `wrangler.e2e{,-production}.toml`, pipeline dir. Stray corrupted file
  `r.name).join('` (shell-quote damage from prior session; leave alone).
- Pipeline: spec/research/developer/state present; **no** `e2e.md`; results dir empty
  (`.playwright-artifacts-0/` empty) — no screenshots/traces/evidence written.
- Servers: no listeners on 8787/8788/8789; no `workerd`/`e2e_server`/`wrangler`/
  playwright processes. Playwright cleaned up; no orphans to kill.
- `state.md` still says "Developer: pending spawn / Test Developer: pending" — stale.

## Smallest repair

Install Chromium OS deps in WSL (root required):

```
rtk npx playwright install-deps chromium
```

If no sudo: `apt-get download libnspr4 libnss3 libasound2t64` +
`dpkg -x` into a user prefix and `LD_LIBRARY_PATH` for the test run
(same direction as the abandoned 2026-09-21 attempt).

No app, config, or spec changes needed.

## Owning agent

**Neither Test Developer nor a code fix.** Environment prerequisite gate
(spec §Project gates: "Stop for unresolvable local runtime/browser prerequisites").
Practical owner: **Developer** (owns harness tooling/environment notes) executes or
documents `install-deps`; if sudo is denied, Architect escalates to user.
Test Developer must not be respawned until the one-liner below passes once —
its retry loop was rational response to an unfixable-by-retry env failure.

## Verification commands (after deps install)

Focused (reproduces the failing browser path only):

```
rtk npm run test:e2e -- tests/e2e/lessons-00b-e2e-harness -g "C1 admin login"
```

Full suite (task + all):

```
rtk npx playwright install-deps chromium && rtk npm run test:e2e
```

Expect 6/6 pass (C3/C4 already pass). Then Test Developer writes `e2e.md`
evidence + screenshots per spec.
