# Known issues — reviewed resolution record

Source baseline: `cb9fac1b`; originally recorded during approved cleanup as nine deferred behavior changes. Original severity ranks were source-review triage, not claims of runtime reproduction. No fixes were authorized in that cleanup; the resolutions below describe subsequent working-tree changes reviewed on 2026-09-22, not that baseline or a deployed release. Original evidence locations are retained as historical references and must not be read as current line numbers.

Review scope: actual `src/index.js`, client save/auth paths in `public/index.html`, `public/auth.js`, `public/login.html`, and regression test implementations. All nine original findings are addressed within their stated scope. Items 5 and 9 are resolved by honest claims, not new token invalidation or caching infrastructure. Remaining limitations below are not a lossless-sync or production-verification guarantee.

## 1. HIGH — session batch silently truncates: resolved

**Historical finding:** client sent 200 rows, Worker accepted 50, and HTTP success discarded the whole sent batch. Original evidence: `public/index.html:1288,1325-1335`; `src/index.js:352,366`.

**Current behavior:** all four row-write routes enforce a 500-row maximum, rejecting larger requests with 413 instead of truncating. Sessions validate every state before the batch write. Client sends at most 200 rows and removes only acknowledged snapshots.

**Evidence:** `src/index.js:239-260,421-435`; `public/index.html:1294-1295,1337-1385`. `tests/test_auth_routing.cjs:183-218` exercises actual Worker code with 200 sessions, 501-row rejection and oversized-state rejection without partial session writes. `tests/test_sync.cjs:186-190` drains 201 sessions in batches of 200 and 1.

**Limit:** row limits do not bound serialized request bytes; browser keepalive/body limits can still reject a large batch. Failed rows stay queued in memory, not durable storage.

## 2. HIGH — inflight replacement and account changes: resolved within queue scope

**Historical finding:** count-based removal could discard a newer replacement; queued data could be sent with a different account's token. This concerned client ownership/lifetime, not bypass of Worker ownership predicates. Original evidence: `public/index.html:1308-1312,1325-1335,1177-1189,1287-1331,3945-3948`.

**Current behavior:** `push()` deep-snapshots input, state rows replace by key, and acknowledgements remove the exact sent object rather than a count or newer version. Flushes bind to owner and queue identity across awaits. Account changes clear queues, inflight tracking and session debounce; `sbHeaders()` rejects switched identities. Old completions cannot drain a new account's queue.

**Evidence:** `public/index.html:1298-1406,3895-3922,3971-3974,4010-4014`; `tests/test_sync.cjs:133-184`; `tests/test_auth_routing.cjs:402-419` lifts real header/reset code and verifies clearing on a switched token.

**Limit:** queues are memory-only and deliberately discarded on account exit/change, not transferred to another user. Already-issued requests cannot be recalled; they retain the original bearer identity. Reload/close can lose unsaved work. Tests use controlled fetch/header timing, not live multi-tab browser sessions.

## 3. MEDIUM — save acknowledgement is not persisted-row count: resolved

**Historical finding:** `saved` counted filtered input, including unknown IDs and ignored duplicate attempts; client checked only HTTP success. Duplicate-attempt suppression was intentional. Original evidence: `src/index.js:213-226,254-264`; `public/index.html:1334-1335`.

**Current behavior:** `saved` sums D1 `meta.changes` for the row operation, not input length or total database writes. `acknowledged` contains original submitted row objects whose operation succeeded or is idempotently satisfied. Duplicate attempts are acknowledged by existing `(user_id, question_id, ts)` keys even with zero new writes; clearing an absent note likewise acknowledges with zero changes. Unknown IDs reject the whole batch with 400. Client validates counts and exact snapshot content, retaining unacknowledged rows and refusing malformed acknowledgements.

**Evidence:** `src/index.js:239-260,307-312,326-351,364-382,434-435`; `public/index.html:1355-1372`; `tests/test_auth_routing.cjs:183-231`; `tests/test_sync.cjs:148-167`.

**Limit:** acknowledgement is not an echo of normalized stored columns. Reusing an attempt key does not overwrite its original payload. Permanent validation/capacity failures remain queued and retry; no dead-letter/remediation UI was added. Progress and attempts remain separate requests, not one atomic save.

## 4. MEDIUM — hidden settings/deletion failures: resolved

**Historical finding:** settings ignored HTTP status; deletion removed local history before confirmation and ignored failures. Original evidence: `public/index.html:1064-1072,1367-1370`.

**Current behavior:** settings checks `res.ok` and shows a retry instruction on failure. Deletion checks owner/status, keeps local history on failure, and removes it only after success; History redraw is conditional on that success. Pending session saves block deletion and produce a visible retry instruction.

**Evidence:** `public/index.html:1065-1078,1408-1424,3807`; `tests/test_sync.cjs:191-207` checks settings failure, failed/successful encoded deletion and pending-save refusal.

**Limit:** settings and deletions have manual retry, not durable retry queues. Settings stay locally applied on remote failure; overlapping settings writes are not serialized. Deletion's pending-save check is client-side, not a server tombstone preventing later saves from recreating an ID.

## 5. MEDIUM — immediate token-revocation claim: resolved by corrected claims

**Historical finding:** sign-out comment overstated global sign-out's ability to stop token resolution while Worker cached identity until expiry. Original evidence: `public/index.html:3952-3959`; `src/index.js:73-81,87-100`.

**Current behavior:** no immediate-revocation promise remains. Logout clears the browser session cookie; client requests global SDK sign-out, clears account state on success, and reports incomplete sign-out on failure. Worker still accepts cached live access tokens until expiry, while checking membership denial on each protected request.

**Evidence:** `src/index.js:79-110,189-192,217-227`; `public/index.html:3990-4007`; `tests/test_auth_routing.cjs:233-242,339-387` explicitly confirms bearer access after logout and rejection after membership denial.

**Limit:** no token denylist or logout cache invalidation was added. Clearing cookies/revoking refresh sessions is not immediate rejection of already-issued access tokens.

## 6. MEDIUM — nominal reads consume write budget: resolved

**Historical finding:** account GET called `touchUser`; sessions GET purged old records. Progress GET already avoided writes. Original evidence: `src/index.js:106-110,184-188,192-199,338-339`.

**Current behavior:** account GET only reads and can return `{}` before a users row exists. Sessions GET filters out records older than 30 days without deleting them. `touchUser()` is called only on progress POST. Missing membership on GET fails closed without creating a record; membership bootstrap remains an explicit POST.

**Evidence:** `src/index.js:217-227,278-294,412-418`; `tests/test_auth_routing.cjs:244-258` runs all seven data GET routes with SQLite `PRAGMA query_only=ON`; `tests/test_worker_sql.cjs:87-99` checks old rows remain stored and other owners are preserved.

**Limit:** old session rows accumulate; no scheduled cleanup was added. Reads still require available authentication/database reads. The regression simulates write prohibition locally, not deployed D1 budget exhaustion.

## 7. MEDIUM — AI failures look like empty bank: resolved

**Historical finding:** AI query errors silently returned successful core-only results. Original evidence: `src/index.js:167-180`.

**Current behavior:** both banks must query successfully. AI exceptions or a missing binding reach the Worker error boundary and return 503; a successfully queried empty AI bank still returns 200. Client checks question-response status before consuming it.

**Evidence:** `src/index.js:155-161,262-275`; `public/index.html:1455-1457`; `tests/test_auth_routing.cjs:260-267` distinguishes empty AI results, query failure and absent binding.

**Limit:** AI outage now prevents loading the combined bank; no degraded core-only mode was added. Successful empty results do not prove expected content was imported. Tests stub AI responses rather than exercising a deployed AI database.

## 8. LOW — session deletion ID encoding mismatch: resolved

**Historical finding:** client encoded IDs but Worker bound raw pathname suffixes; ordinary generated `ex_...`/`rv_...` IDs avoided the bug. Original evidence: `public/index.html:1369,3617,3796`; `src/index.js:369-375`.

**Current behavior:** client URI-encodes IDs; Worker decodes once, validates nonblank/maximum length, returns 400 for malformed percent encoding, and retains the owner predicate.

**Evidence:** `public/index.html:1416`; `src/index.js:438-446`; `tests/test_sync.cjs:194-202`; `tests/test_auth_routing.cjs:268-275` checks spaces, slash, Unicode, literal `%2F`, malformed encoding and preservation of another owner's matching ID.

**Limit:** IDs remain subject to the 64-character contract; deletion is idempotent and does not report an affected-row count.

## 9. LOW / UNVERIFIED — cache claim exceeds evidence: resolved by corrected claims

**Historical finding:** emitting `Cache-Control` did not prove edge hits or avoidance of repeated full-table scans; no Cache API was used. This was a documentation/verification gap, not a demonstrated cache failure. Original evidence: `src/index.js:174-181`.

**Current behavior:** question responses use `private, no-store`; source no longer claims measured caching or scan avoidance. No Cache API layer or new cache was added. Each successful questions request still queries both banks.

**Evidence:** `src/index.js:25-41,262-275`; `tests/test_auth_routing.cjs:87-91,244-256` verifies emitted private/no-store headers.

**Limit:** local header assertions do not measure deployed CDN behavior, hit rates, or D1 scan cost. No production cache/performance claim is made.

## Related auth checks

`public/auth.js:43-45` no longer sends Google's `hd` hint; it retains `prompt: 'select_account'`. `public/login.html:7,18` distinguishes automatic approval for exact `@ccs.us` addresses from provisional access for other Google accounts. Worker enforces that distinction and preserves existing review decisions (`src/index.js:217-230`). `tests/test_auth_routing.cjs:101-126,288-317` checks domain edge cases and executes the real Google-button script. Live Google OAuth and deployed policy configuration were not exercised.

## Verification and historical cross-reference

Reviewed and ran `node.exe --test tests/test_auth_routing.cjs tests/test_sync.cjs tests/test_worker_sql.cjs`: **36 tests passed, 0 failed** on 2026-09-22. Auth/routing tests import the actual Worker with an in-memory SQLite D1 adapter; sync tests lift actual client functions with fetch/DOM stubs. The older SQL self-check also contains copied statements, so it is supplementary, not the sole evidence for current Worker behavior. No lint/typecheck commands are configured. No application code changed in this documentation review; no deployment, remote mutation or commit performed.

Original audit findings 1–9 map to this severity-ranked list as follows: 1→1, 2→3, 3→8, 4→4, 5→2, 6→5, 7→6, 8→7, 9→9. Their original deferred status remains historical provenance; current dispositions are recorded above. No substantive omission in the nine original fixes was found in this source/test review; limitations and unexercised production/browser paths remain explicit.
