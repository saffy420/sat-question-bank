# lessons-06-desmos — review

Diff reviewed: `git diff origin/main...HEAD` (through commit 12b38562 + e2e/state commit), against `spec.md` and BRIEF §12.6.

## Findings (listed before fixing)

| # | Severity | Where | Finding |
|---|---|---|---|
| R1 | Blocker (spec gap) | `wrangler.toml` | spec.md lists a `DESMOS_API_KEY` secret note in wrangler.toml; not added. Without it, the production setup step is undiscoverable. |
| R2 | Non-blocking | `src/lesson-room.js` desmos branch | If a D1 flush is in flight (only at question boundaries), two Desmos messages could interleave across that await and the older state could be stored last. Each message is a full state, the window is only at boundaries, and the next instructor change self-heals it. Not fixed; documented. |
| R3 | Non-blocking, pre-existing | `src/lesson-room.js` `webSocketClose` | `ws.close(1006)` throws `InvalidAccessError` on abrupt disconnects (seen in e2e logs). Predates task 06; the socket is already closed, so it is only a logged exception. Recorded for the handoff, not widened into this PR. |
| R4 | Note (security tradeoff) | `src/index.js` `LESSON_CSP` | The Desmos API requires `'unsafe-eval'` + `worker-src blob:` (measured: calculator fails without eval; worker refused without blob). Scoped to `/app` and `/admin` only; `script-src` already allowed `'unsafe-inline'`, so the added risk is small. Listed for the user in the PR. |
| R5 | Note (bandwidth) | lobby preload | The Desmos API is 1,050,346 bytes gzipped (4.0 MB raw), about 21 s at 50 KiB/s. It is preloaded in the lobby only for lessons with a Math question. Desmos serves it with `max-age=300`. |

## §12.6 checklist
- (a) Rule 5: Desmos state enters the student snapshot only when `REVEALED`/`ENDED`; the server rejects `desmos` outside REVEALED or for another question; the client sends nothing before reveal. Unit test + e2e leak capture (`7777` never before REVEALED). PASS.
- (b) Rule 4: gate enforced in the DO; client gating is only UX. PASS.
- (c) Rule 6: DO storage per event; D1 `session_question_review.desmos_state_json` only at `next`/`endSession` (unit: zero writes per event, one at each boundary). PASS.
- (d) Rule 2: no stat logic touched. PASS.
- (e) Rule 7: no review-mode (§8.7) or history rendering (§9.1). PASS.
- (f) Every spec checkpoint has an asserting spec (e2e.md table). PASS.
- (g) No `.skip/.only/fixme`, no loosened assertions, no raised timeouts (reconnect moved to the unthrottled student instead of raising a timeout). PASS.
- (h) No fixed sleeps; all waits are conditions/polls. PASS.
- (i) `test(lessons-06)` commits touch only `tests/` and `playwright.config.js` (harness config). PASS.
- (j) e2e.md shows the full suite (21/21). PASS.
- (k) The diff is task 06 plus the brief-mandated `docs/lessons/BRIEF.md`, `AMENDMENTS.md` (preserves approved amendments) and `.claude/agents/lessons-researcher.md`. PASS.
- Task items: students read-only unless forked (e2e 2–4); unchanged states not resent (client `syncOut` dedupe + server string compare; unit test asserts no rebroadcast). PASS.

## Repair round 1
- R1 fixed in `fix(lessons-06)` (wrangler.toml comment only). Reran unit 79/79 and the full e2e suite: 21/21 (Desmos latency under load 270, 387, 395, 413, 414 ms; ping RTT 420–528 ms). Re-review: comment only, no runtime change, no regressions.

Verdict after round 1: **PASS**.
