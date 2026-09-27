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

## Round 2 — option A (admin stats fan-out), 2026-09-27
The `ADMIN_STATS` self-binding is live under `wrangler dev` (startup lists `env.ADMIN_STATS (sat-question-bank-local-e2e#adminStats) … [connected]`), so every admin students-list load in the suite goes through the fan-out.

| Run | Result | Notes |
|---|---|---|
| A1 | 31/31 | |
| A2 | 30/31 | `task06 Desmos sync` line 183: a frame received by one of the two students held the substring `3131` (the forked student's private expression is `y=3131`). |
| Desmos ×6 (spec alone, `--repeat-each 6`, temporary uncommitted log of any frame holding `3131`) | 6/6 | No received frame held `3131`. |
| A3 | 31/31 | |

Why A2 is not a regression from this change: (1) the only free-02 diff outside `src/index.js`'s bank/admin routes is two exact fast paths in `public/shared/stats.js`; `src/lesson-room.js`, the lesson client and `public/shared/desmos.js` are unchanged from free-01. (2) The Durable Object relays Desmos state only from the admin (`a.role !== 'admin'` → error), so a student's forked state cannot reach another socket through Desmos frames. (3) The assertion is a raw substring over every received frame, which also carry epoch-ms timestamps and random UUIDs; the saved trace shows the page itself generating an ID containing `3131` (`a3804f1b-…-0853131e33a2`). Playwright's trace does not keep WS payloads, so the frame that matched in A2 cannot be recovered. Not fixed here (the test's precision is lessons-06's, and the brief forbids loosening assertions); noted for free-03 or a follow-up: match the marker inside parsed Desmos expression LaTeX rather than the raw frame.

Unit: `npm test` 114/114 (git.exe shim as before). Bench: list and detail bodies byte-identical to the pre-change code, and fan-out ≡ inline (`BENCH_NO_FANOUT=1`).
