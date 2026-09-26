# Task 06 handoff — lessons-06-desmos

## Status
Complete locally; PR open (see state.md). Review PASS after 1 repair round.

## Shipped (BRIEF §7.2)
- **Protocol** (`public/shared/lesson.js`): admin-only `desmos {questionId, state}`; `validDesmos` (plain object ≤ 48 KiB); only `desmos` may exceed the 2048-byte frame (admin cap `MAX_DESMOS_FRAME`).
- **DO** (`src/lesson-room.js`): accepted only from the room owner, in REVEALED, for the current question. Stored under DO key `desmos` (`state()`/`save()` keep it out of the room object). Unchanged states dropped. Relayed to every socket except the sender. Snapshots carry `hasMath`, `desmosKey`, and `desmos` (only when revealed). D1 `session_question_review.desmos_state_json` written only at `next`/`endSession` (COALESCE upsert alongside annotations).
- **Worker** (`src/index.js`): `desmosApiKey(env,url)` = `DESMOS_API_KEY` secret, else the public demo key on 127.0.0.1/localhost only, else null. Passed to the DO in the lesson context. `LESSON_CSP` (adds `'unsafe-eval'`, `https://www.desmos.com`, `worker-src blob:`) is sent only for `/app` and `/admin`; every other response and `public/_headers` stay strict. `/shared/desmos.js` added to the static allowlist.
- **Client** (`public/shared/desmos.js`, `lesson-ui/Desmos.tsx`): `loadDesmos` (single cached script inject), `syncOut` (150 ms trailing throttle over `change` + `graphpaperBounds`, dedupe), `FOLLOW_OPTIONS`/`EDIT_OPTIONS`.
  - Instructor (`admin-ui/Live.tsx`): "Desmos" toggle on math questions; editable panel; sends only in REVEALED; work done before the reveal goes out once at reveal; restores `s.desmos` after reload.
  - Student (`lesson-ui/index.tsx`, bridge in `public/index.html`): API preloaded in the lobby for math lessons. Panel opens automatically on the first instructor state after reveal. Following = read-only (capture-phase input guard, locked viewport, no zoom/menus/keypad) but scrollable. **Try it yourself** forks an editable copy (updates held back); **Back to instructor view** re-applies the latest state and re-locks.

## Evidence
- Unit 79/79 (`npm test`, needs a `git.exe` → `git` shim on Linux).
- E2E task 2/2; full suite 21/21 (twice).
- Desmos latency under Slow 3G (shaped relay; ping RTT ≈ 405 ms): isolated runs 243–297 ms (one outlier 384 ms); full-suite load 265–437 ms. Target ≤ 500 ms: met on every sample.

## Deviations from the brief
1. Slow 3G is measured through a TCP relay (`shapedOrigin` in `tests/e2e/lessons-00b-e2e-harness/network.js`), not CDP `Network.emulateNetworkConditions`: CDP does not delay WebSocket frames in Chromium (37 ms RTT). The relay is stricter (shapes every byte) and the test asserts RTT ≥ 400 ms.
2. `'unsafe-eval'` + `worker-src blob:` added for `/app` and `/admin` (Desmos API requirement, measured). Needs your sign-off.
3. Follower read-only uses an input guard instead of `inert`, because `inert` blocked scrolling and Desmos renders only the rows in view.
4. Sandbox-only harness aids: `PW_CHROMIUM_PATH` launch override; pinned CDN + Desmos script served from a curl-filled cache (`tests/e2e/cdn-cache.js`).

## Open items / next tasks
- Pre-existing: `LessonRoom.webSocketClose` throws on code 1006 (abrupt disconnect). Harmless (logged); candidate fix for task 10.
- Non-blocking: rare out-of-order Desmos store if two messages straddle a boundary D1 flush (self-heals on the next change).
- Task 08 review mode must reuse the same REVEALED gate for `desmos`; task 09 renders `session_question_review.desmos_state_json` read-only.
- `lessons-researcher` agent file exists but loads only in a new session; this session used a general-purpose Sonnet agent with the same prompt.

## Manual checks for you
- Desmos sync on a real Chromebook (school Wi-Fi): expression appears within ~0.5 s; Try it yourself / Back.
- Before deploy: `npx wrangler secret put DESMOS_API_KEY` with a production key from desmos.com/my-api (the demo key is local-only by design).
- Approve the `'unsafe-eval'` CSP scope on `/app` and `/admin`.
- The first math lesson on school Wi-Fi downloads about 1 MB (gzipped) of Desmos during the lobby; start the lobby a minute early.
