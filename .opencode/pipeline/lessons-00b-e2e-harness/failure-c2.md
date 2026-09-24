# Failure C2 — root cause (read-only research, 2026-09-24)

Reviewer session `ses_f2c966257ffe80iSj8JTLx6fb2`. No app/test/config edits, no test runs,
no commits. Evidence: `e2e/results/lessons-00b-e2e-harness-ha-15e93-MC-choices-and-SPR-renderer-chromium/{trace.zip,error-context.md,test-failed-*.png}`,
`tests/e2e/lessons-00b-e2e-harness/harness.spec.js`, `public/index.html`.

## Exact stalled awaited operation

`harness.spec.js:49` — `await page.locator('#btn-start').click();` (student page).

Playwright call log (trace `3-trace.trace`, callId `call@242`, `test.trace` `pw:api@107`):

- `before click {selector:"#btn-start"}` at t=58996.31; **no matching `after`** before
  `Test timeout of 30000ms exceeded`.
- Locator resolves: `<button class="btn-p" id="btn-start">Start practice</button>`.
- First hit attempt succeeds actionability (`element is visible, enabled and stable`,
  point `{x:1241,y:138.5}`), but hit-target check fails:
  `<div class="v mono">0%</div> from <div class="cards" id="home-stats">…</div> subtree
  intercepts pointer events` (boot still rendering practice stats cards → layout shift).
- Retry 2: `element is not stable`.
- Retries 3+: `element is not visible`, every ~500 ms, until 30 s test timeout.
  Pattern repeats ~60×; last log t≈88349 = timeout.

Error-context page snapshot shows **admin** dashboard fully rendered (`E2E Admin`,
`Good morning, E2E`) — Playwright attached the first page, not the stalling student page.

## What completed before the stall (ruled out)

- Both `bank()` calls finished: admin + student `goto /app` (domcontentloaded) 200,
  `/api/questions` 200 on both contexts, `#user-name` asserts (`E2E Admin`,
  `E2E Student 1`), `window.__qa().QS` id asserts, cookie-differs assert — all in
  `test.trace` as DONE before `pw:api@107`.
- Network (both contexts): `/api/e2e/login` POST 200, KaTeX/fontsource CDN 200,
  `/api/questions` 200, `/api/auth/session` POST 200. Only non-200: intentional
  `route.abort()` of `cdn.jsdelivr.net/npm/@supabase/supabase-js@2.112.4`
  (status −1) — normal harness adapter substitution, not a stall.
- No unfinished `waitForResponse`, no unfinished `goto`, no navigation hang, no timer
  involvement. Sequential bootstrap of second context completed.

## Why `#btn-start` becomes invisible

App boot (`public/index.html`):

1. `let TAB = 'dash'` (line 1040) — signed-in default tab is **dashboard**.
2. Boot IIFE: `initAuth()` (sets `#user-name` via `applySession`) → `load()`.
3. `load()` (line 1453): fetch questions → `QS` (1458/1494) → `exams.json` →
   `loadProgress()` → `loadSettings()` → `refresh(); setTab(TAB);` (1501–1502).
4. `setTab('dash')` (1599–1602) toggles `.hide` on every non-dash tab.
   `.hide { display: none !important; }` (line 77) → `#tab-practice` (holds
   `#btn-start`, line 807) disappears.

`bank()` can return **before** `setTab(TAB)` runs: `#user-name` is set in `initAuth`,
and `__qa().QS` only needs `QS` assigned mid-`load()`, before
`loadProgress/loadSettings/refresh/setTab`. So C2 clicks while `#tab-practice` is
still visible (static HTML default), boot then finishes mid-click and hides it →
`element is not visible` forever. Test never clicks `[data-tab="practice"]`.

Intermittency: earlier green runs (`e2e.md` focused C2 1/1, task 6/6) = click won the
race and completed before `setTab('dash')`. This run lost: first hit intercepted by
`#home-stats` re-render, `not stable`, then hide landed. The prior `waitUntil:
domcontentloaded` change only removed a possible `goto load` stall; it did **not**
synchronize tab state — misdiagnosis paper, race remains.

CLI evidence agrees: `e2e.md` — student "clicked Question Bank → Start practice";
spec skips the Question Bank navigation.

## Classification

**Test/fixture bug** (spec race against intended app behavior). App defaulting to
dashboard tab is product design, not a defect. No app runtime fault, no auth/seeding
fault, no CDN/timer fault.

## Repair owner + fix (Test Developer, `tests/e2e/` only)

Synchronize to condition before click — switch tab, wait visible, then click
(no timeout inflation, no retry loop, no sleep, no skipped assert):

```js
await page.locator('[data-tab="practice"]').click();
await expect(page.locator('#btn-start')).toBeVisible();
await page.locator('#btn-start').click();
```

`expect(...).toBeVisible()` is the robust condition: waits for boot's `setTab` to
settle either way; after explicit tab switch the button stays visible. Playwright's
own actionability wait then handles the transient `#home-stats` intercept.

Do not touch `playwright.config.js`, app, or timeouts. No rerun loops; one focused
`-g 'C2 student'` after the Test Developer edit is the verification.

## Commands used (read-only)

- artifact reads: `trace.zip` extracted to temp, parsed with throwaway node scripts
  (action before/after pairing, network status summary, call@242 log slice)
- greps: `public/index.html` (`TAB`, `setTab`, `btn-start`, `.hide`), `harness.spec.js`
- zero Playwright invocations, zero edits to app/tests/config
