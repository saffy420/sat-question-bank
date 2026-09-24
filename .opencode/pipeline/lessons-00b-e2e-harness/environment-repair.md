# Environment repair — lessons-00b-e2e-harness

Date: 2026-09-24. Scope: WSL Chromium runtime dependencies only. No app/config/test edits, no browser suite, no deployment or commit.

## Evidence / actions

- Research: `failure-research.md` documents WSL Chromium rev 1243 missing `libnspr4.so`, `libnss3.so`, `libnssutil3.so`, `libasound.so.2`; request-only tests succeeded. No owned servers at start.
- One installation attempt: `rtk npx playwright install-deps chromium </dev/null` (noninteractive, 120000 ms). Tool returned **no output** and terminated command after timeout. No exit status or package-install confirmation. Cannot claim dependencies installed. Root/sudo availability not established; installation may have waited for sudo or apt. Do not repeat unchanged command.
- Attempted focused launch/page/close probe via `rtk node -e ...`. Shell parsing failed before Node or Chromium ran: `bash: -c: line 1: unexpected EOF while looking for matching '"'`. Second quote form also failed before Node ran: `bash: -c: line 1: unexpected EOF while looking for matching '\''`. Neither is a Chromium result. No real launch success or browser pass claimed.

## Verification after user-installed WSL dependencies

User reports OS dependencies installed. Exactly one real Playwright Chromium launch/page/close probe ran in WSL:

```
rtk node .opencode/pipeline/lessons-00b-e2e-harness/chromium-probe.cjs
Chromium launch/page/close PASS; browser version 153.0.8010.12
```

Probe navigated to `data:text/html,chromium-ready`, checked body text, closed browser in `finally`, and exited successfully. No `LD_LIBRARY_PATH` override. This verifies current installed Playwright Chromium can launch; package-install command itself was not rerun, and original timed-out attempt remains unconfirmed. No full suite or Playwright spec run here. Environment launch blocker cleared for fresh Test Developer; app/browser checkpoints still unverified.
