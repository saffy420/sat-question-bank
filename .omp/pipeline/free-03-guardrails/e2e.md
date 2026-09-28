# free-03 e2e

Command: `npm run e2e:seed && PW_CHROMIUM_PATH=/opt/pw-browsers/chromium-1194/chrome-linux/chrome PLAYWRIGHT_OUTPUT_DIR=.omp/pipeline/free-03-guardrails/e2e/resultsN npx playwright test`. Artifacts under `.omp/pipeline/free-03-guardrails/e2e/` (gitignored).

| Run | Code | Result |
|---|---|---|
| 0 | banner spec alone | 2/2 |
| 1 | 9101df6 + tests (before review fixes) | **33 passed** (31 existing + 2 banner) |
| 2 | 76627f2 (flush guard, backoff) | **33 passed** |

New spec `tests/e2e/free-03-guardrails/banner.spec.js`: real endpoint empty → no banner; routed pending entries → "Lesson results saved locally, will sync after <time>." (latest retry time, local clock), persists across sections, clears on the next empty check, hidden on a 503, fits 390 px; student app makes no lesson-sync request and gets 403 on the endpoint. Screenshots `banner-1366.png`, `banner-390.png`.

Quota-failure e2e (brief §5): `tests/test_budget_flows.cjs`, real Worker + DO + Miniflare D1, budget seed, 25 × 20 self-paced, D1 write limit injected after the first batch (`D1_FAULT_INJECTION`, loopback only). During: 160/500 responses (8 whole students), registry holds the session (quota, retry ≤ 00:01 UTC). After clearing: 500 responses, 500 lesson attempts, 500 distinct, progress attempts +500, 25 finish times, status `review`, registry empty; recovered at the first 5 s retry.

Unit: `npm test` 143/143 (git.exe shim on PATH for `tests/test_grade.cjs`, as in free-02), including `test_budget_flows.cjs` 17/17 (~2 min).
