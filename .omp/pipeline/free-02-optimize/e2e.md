# free-02 e2e

Command: `npm run e2e:seed && PW_CHROMIUM_PATH=/opt/pw-browsers/chromium-1194/chrome-linux/chrome PLAYWRIGHT_OUTPUT_DIR=.omp/pipeline/free-02-optimize/e2e/resultsN npx playwright test`. Artifacts under `.omp/pipeline/free-02-optimize/e2e/` (gitignored). Local `wrangler dev` implements the Cache API, so the suite runs with the new caches and memos active.

free-02 adds no UI checkpoints (no feature change); the requirement is the full existing suite green after every optimization.

| Run | Code | Result |
|---|---|---|
| 1 | after all optimizations (before review fixes) | **31 passed** (3.4 min) |
| 2 | after review round 1 (Set refactor, comments) | **31 passed** (3.5 min) |

The `SSLV3_ALERT_CERTIFICATE_UNKNOWN` lines in the logs are local HTTPS dev-server noise; no spec failed.

Unit: `npm test` 112/112 (with a `git.exe` → `git` shim on PATH for `tests/test_grade.cjs`, which spawns Windows git; without it that file fails on `main` too).

Response equivalence (the "no feature change" proof for the optimized routes): `tools/budget_bench.cjs` with `BENCH_DUMP` against the budget seed, 15 route variants (bank, 7 builder filters/searches, 3 list sorts/searches, 2 details, history, lesson history). Every body is byte-identical to the free-01 code on the same data, and every cached/memoized repeat is identical to the first response. `tests/test_free_budget.cjs` pins the same against the pre-change computation on a fixture with MC, grid-ins (incl. one whose answer comes from the explanation), invalid choices JSON, AI rows, traps and attempts on unknown questions; plus the search superset (tag-spanning terms, U+0130, U+212A, non-ASCII terms), cache invalidation, auth-before-cache, and the answer/progress race. Mutation checks: disabling the U+0130 or U+212A guard, or either direction of the settle rule, fails a test.

Staging: one `503` among ~150 untraced builder/admin requests (`hide-attended`), not reproduced in 50 further requests; tail recorded no exception for it. The route's catch-all returns 503 on any error (pre-existing behavior).
