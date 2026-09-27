# lessons-06-desmos — spec

## Scope
BRIEF §7.2 (Desmos sync, math). Context: §6.2/§6.3 (REVEALED is where the synced panel appears), §11 (`desmos {state}` instructor→server, `desmos` server→clients), §1 (DO holds Desmos state; snapshot on reconnect), §0 rules 4–7.
Binding amendments: docs/lessons/AMENDMENTS.md (G1-A lesson-channel secrecy; G2 reveal after endsAt+750ms).

Out of scope (later tasks): review mode (§8.7, task 08) — the same REVEALED gate will serve it; student history rendering of the saved Desmos state (§9.1, task 09). The practice-bank iframe calculator stays unchanged (PLAN.md §2 "Keep ordinary practice iframe").

## Design
- **Phase gate (rule 5 / G1-A):** Desmos state is lesson content that can reveal the answer, so the server accepts `desmos` only from the room owner (admin role) in phase REVEALED for the current question — same gate as `annotate`. Snapshots include `desmos` only when revealed (same projection as `annotations`). Instructor may open and use the panel at any phase; client sends only in REVEALED. When the phase becomes REVEALED with a non-blank instructor calculator, the client sends that state once.
- **Protocol (`public/shared/lesson.js`):** `desmos` added to ADMIN_ACTIONS; fields `type, questionId, state`; `validDesmos(state)` = plain object, not array, serialized ≤ `MAX_DESMOS_BYTES` (48 KiB). Frame gate: admin frames may be up to `MAX_DESMOS_FRAME`; any non-`desmos` frame still must be ≤ `MAX_FRAME` (2048).
- **DO (`src/lesson-room.js`):** state stored under its own storage key `desmos:<questionId>` (keeps the room object small, since every save rewrites it). An identical serialized state is ignored (no storage write, no broadcast). Broadcast `{type:'desmos', questionId, state}` to every socket except the sender. Boundary flush: `next`/`endSession` pending carries `desmos` → `session_question_review.desmos_state_json` upsert (same statement as annotations, `COALESCE` keeps the other column). No per-event D1 writes (rule 6).
- **Snapshot:** `hasMath` (any frozen item is a Math question; metadata only) for all roles, so the client preloads the API script at join (Chromebook Wi-Fi). `desmos` (latest state for current question, or null) when revealed. `desmosKey` from `desmosApiKey(env, url)`: `env.DESMOS_API_KEY`, else the public demo key on local hosts only (127.0.0.1/localhost), else null → panel shows "Desmos unavailable".
- **Loader (`public/shared/desmos.js`, new):** `loadDesmos(key)` injects `https://www.desmos.com/api/v1.11/calculator.js?apiKey=…` once (promise-cached); `FOLLOW_OPTIONS` (read-only + locked viewport) and `EDIT_OPTIONS`; `sameState(a,b)` via serialization.
- **Instructor (`admin-ui/Live.tsx`):** "Desmos" toolbar button (math questions only) opens a side panel with an editable calculator. `observeEvent('change')` + `observe('graphpaperBounds')` → 150 ms trailing throttle → `getState()` → skip if equal to last sent → `send('desmos',{questionId,state})` when REVEALED. Restores `s.desmos` on (re)load. New question → blank calculator.
- **Student (`lesson-ui`):** panel opens automatically on the first Desmos state for the current question (snapshot or live). Following mode: calculator with read-only options + `inert` wrapper as a belt-and-braces block; `setState(state)` on each update. **Try it yourself** → editable copy from current state (updates buffered, not applied). **Back to instructor view** → `setState(latest)` and re-lock. Students never send `desmos` (not in STUDENT_ACTIONS; server rejects).
- **CSP:** add the Desmos API origin(s) to `script-src` (and whatever style/img/font/connect/worker sources research + a CSP-violation check show) in BOTH `src/index.js` and `public/_headers`. Keep `frame-src https://www.desmos.com`.
- **Static allowlist:** `/shared/desmos.js` added to the Worker's public asset list (task 05 hit this exact 404).

## Files
`public/shared/lesson.js`, `public/shared/desmos.js` (new), `src/lesson-room.js`, `src/index.js` (CSP, allowlist, `desmosKey` context), `public/_headers`, `admin-ui/Live.tsx`, `admin-ui/admin.css`, `lesson-ui/index.tsx`, `lesson-ui/types.ts`, `lesson-ui/lesson.css`, `lesson-ui/Desmos.tsx` (new), `public/index.html` (bridge: desmos message handler), `tests/test_lesson_room.cjs`, `tests/test_admin.cjs` (allowlist), `tests/e2e/lessons-06-desmos/desmos.spec.js`, `wrangler.toml` comment for `DESMOS_API_KEY` secret.

## Required unit tests
1. Protocol: `desmos` valid for admin, invalid for student; oversized state rejected; extra fields rejected; non-desmos admin frame > 2048 bytes still closes 1008.
2. DO: desmos rejected outside REVEALED / wrong question; accepted in REVEALED, stored under `desmos:<qid>`, broadcast to others not sender; identical state not re-broadcast or re-stored; no D1 writes per event; snapshot hides `desmos` before reveal, includes it after; `hasMath` present.
3. Boundary flush writes `desmos_state_json` once at `next` / `endSession`, retry-safe.

## E2E checkpoints (§12.7 — 06; may add, never drop)
1. An expression typed in the instructor's Desmos appears in student panels, measured under Slow 3G throttling (CDP `SLOW_3G` from 00b `network.js`; target ≤ 0.5 s; record measured values, serialized state size, sample count).
2. Students can't edit (typing into the follower panel changes nothing; expression list read-only; viewport locked).
3. **Try it yourself** edits don't propagate (instructor + second student unchanged).
4. **Back to instructor view** resyncs (student panel equals instructor state again, including updates made while forked).
Added:
5. Panel opens automatically on the student when the instructor first uses Desmos; not before reveal (no Desmos state in any student frame/response before REVEALED — leak helper).
6. Reconnect: a student who reloads mid-review gets the current Desmos state from the snapshot.
7. No CSP violations from the Desmos API on student or instructor pages.
8. Non-math lesson does not load the Desmos script.

## Task review items
- Student calculators read-only unless forked.
- Unchanged states not resent (client dedupe + server dedupe).
- Plus §12.6 (a)–(k).
