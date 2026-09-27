# lessons-06-desmos — e2e

Spec: `tests/e2e/lessons-06-desmos/desmos.spec.js` (2 tests). Local `wrangler dev` + local D1/DO (00b harness), seeded with `npm run e2e:seed`. Browser: preinstalled Chromium 141 via `PW_CHROMIUM_PATH=/opt/pw-browsers/chromium`.

Commands:
- Task: `npm run e2e:seed && PW_CHROMIUM_PATH=/opt/pw-browsers/chromium npx playwright test tests/e2e/lessons-06-desmos`, 2 passed (three consecutive green runs after the last fix).
- Full suite: `npm run e2e:seed && PW_CHROMIUM_PATH=/opt/pw-browsers/chromium npm run test:e2e`, **21 passed** (1.9 min): 19 existing + 2 new.
- Unit: `npm test` (with a `git.exe` → `git` shim on PATH), **79/79**.

Artifacts (gitignored): `.omp/pipeline/lessons-06-desmos/e2e/01..06-*.png`, `latency.json`.

## Checkpoints

| # | Checkpoint | Result | Assertion |
|---|---|---|---|
| 1 | Expression typed in the instructor's Desmos appears in student panels under Slow 3G; target ≤ 0.5 s; value recorded | PASS | 5 samples per run, each asserted ≤ 500 ms. Isolated runs: 243–297 ms (one outlier at 384 ms). Full-suite run under parallel load: 265, 267, 374, 403, 437 ms. Ping RTT through the relay: 403–478 ms. |
| 2 | Students can't edit | PASS | Clicking an expression, typing, Backspace, clicking the new-expression row and typing all leave the list text unchanged; focus never lands in the calculator. The instructor has a "Zoom In" control and the follower has none. `lockViewport` is set. |
| 3 | Try it yourself edits don't propagate | PASS | Forked student types `y=3131`: it shows locally only, never appears in the instructor or other-student lists, and never appears in any student-received WS frame. |
| 4 | Back to instructor view resyncs | PASS | An instructor update (`2468`) made while the student was forked is held back from that student (and delivered to the other). After Back: `2468` present, `3131` gone, mode `follow`, typing is blocked again. |
| 5 (added) | Panel opens on first instructor use; nothing before REVEALED | PASS | The instructor graphs `y=7777x` during ANSWERING; no student panel appears. Leak capture: the first frame containing `7777` comes after the first REVEALED frame, and no HTTP body contains it. `violations()` is empty. |
| 6 (added) | Reconnect restores the graph | PASS | A fresh page load and re-join gets `7777` and `2468` from the snapshot, in follow mode. |
| 7 (added) | No CSP violations | PASS | `securitypolicyviolation` listener on instructor and both students: `[]`. |
| 8 (added) | Non-math lesson never loads Desmos | PASS | R&W-only lesson: no requests to `*.desmos.com`, `window.Desmos` undefined, no instructor Desmos toggle. Math lessons preload the API in the lobby (asserted). |
| — (added) | Follower list scrolls | PASS | With rows past the fold, a wheel scroll moves the list, and the previously unrendered `x+105` row appears. |

## Measurement method (checkpoint 1)
- **CDP `Network.emulateNetworkConditions` does not delay WebSocket frames in this Chromium.** Ping RTT under 00b `SLOW_3G` was **37 ms**. PLAN.md §7 forbids passing on that, so the student context instead connects through `shapedOrigin(SLOW_3G)` (`tests/e2e/lessons-00b-e2e-harness/network.js`). That TCP relay adds `latency/2` each way plus 50 KiB/s per direction to every byte (HTTP and WS alike, TLS end to end). The test asserts min ping RTT ≥ 400 ms, so the shaping is proven on the actual socket.
- Latency = student `MutationObserver` time when the marker first appears in `#lesson-desmos .dcg-expressionlist` minus the instructor's capture-phase `keydown` time for the final digit. Both pages share one machine clock. Includes the 150 ms trailing throttle, DO relay, one shaped downlink hop, and Desmos render.
- Only the student is shaped (instructor laptop assumed on normal Wi-Fi).
- Serialized state size: `latency.json` records `expressionTextChars`. The state for these graphs is a few hundred bytes; the limit is 48 KiB.

## Failures and classification
1. CDP throttle doesn't affect WS (RTT 37 ms) → **test bug** (harness limitation) → shaped relay.
2. First relay version reordered chunks (separate timers) → TLS `BAD_RECORD_MAC`, student page dropped → **test bug** → single ordered queue per direction.
3. Latency marker not found → Desmos renders only the rows in view; new rows landed off-screen → **test bug** (reuse one row) **and app bug**: `inert` on the follower stopped students scrolling, so off-screen instructor rows were unreachable. Fixed in `e86f9103` (capture-phase input guard instead of `inert`).
4. Instructor panel too short at 1920×1080 (keypad covered the list; screenshot 01) → **app bug**, fixed in `e86f9103`.
5. Reconnect through the relay exceeded 5 s (full app reload at 50 KiB/s) → **test bug**: reconnect runs on the unthrottled student instead of raising timeouts.
6. Negative assertions could pass because of virtualization → **test bug**: reordered so fork/back markers are rendered before negative checks.
7. Desmos script over the sandbox proxy: `ERR_TOO_MANY_RETRIES` → **test environment**: script added to the curl-filled CDN cache (same bytes).

## Environment notes
- Pre-existing (not task 06): `LessonRoom.webSocketClose` calls `ws.close(code)` with 1006 on abrupt disconnects, which throws `InvalidAccessError` (logged only; the socket is already closed). Recorded for the handoff.
- The workerd `SSLV3_ALERT_CERTIFICATE_UNKNOWN` lines are the known self-signed local TLS noise.
