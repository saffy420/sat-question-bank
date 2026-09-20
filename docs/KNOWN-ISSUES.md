# Known issues — deferred behavior changes

Source baseline: `cb9fac1b`; recorded during approved cleanup. Severity ranks are source-review triage, not claims of runtime reproduction. No fixes authorized in this cleanup. References remain to unchanged application files.

## 1. HIGH — session batch silently truncates (priority for future session features)

Client sends up to **200** queued rows, but POST `/api/sessions` accepts only **50**. After any successful response the client removes the entire sent batch. More than 50 queued session states can therefore lose unsaved entries.

Evidence: `public/index.html:1288,1325-1335`; `src/index.js:352,366`.

Before building on `/api/sessions`, align limits and acknowledgement handling in a separately approved behavior task; test a batch exceeding 50.

## 2. HIGH — inflight queue replacement and account changes can misattribute or lose state

`push()` replaces queued state while a previously serialized batch can still be inflight; success removes rows by count, potentially dropping a newer replacement. Account changes do not clear these queues, while sends resolve the current account token. This risks replaying pending state under another account. This is a client-side ownership/lifetime concern, not evidence that Worker ownership predicates can be bypassed.

Evidence: `public/index.html:1308-1312,1325-1335` (replacement/removal), `1177-1189,1287-1331,3945-3948` (account and queue lifecycle).

Separate regression checks should cover edits during an inflight request and account changes with pending/inflight writes.

## 3. MEDIUM — successful save acknowledgement is not a persisted-row count

Worker `saved` counts filtered input, not changed rows. Unknown question IDs and duplicate attempts can write nothing while contributing to the count. Client checks only HTTP success, not acknowledgement content. Duplicate-attempt suppression is intentional; do not confuse idempotency with missing-ID rejection.

Evidence: `src/index.js:213-226,254-264`; `public/index.html:1334-1335`.

## 4. MEDIUM — settings and session-deletion failures are hidden

Settings POST does not inspect response status. Session deletion removes local state before confirmation, ignores HTTP failures and has no retry/rollback; failed deletions can reappear after reload.

Evidence: `public/index.html:1064-1072,1367-1370`.

## 5. MEDIUM — sign-out comment overstates immediate token revocation

Browser comment claims global sign-out stops token resolution, but Worker returns cached identity until token expiry without logout invalidation. Do not promise immediate access-token rejection based on refresh-token revocation.

Evidence: `public/index.html:3952-3959`; `src/index.js:73-81,87-100`.

## 6. MEDIUM — nominal reads can fail on write-budget exhaustion

`touchUser()` comment says it belongs to writing routes, yet account GET calls it. Sessions GET deletes old records. Both reads therefore depend on writes and can fail when write budget is exhausted. Progress GET does not have this dependency; preserve that distinction.

Evidence: `src/index.js:106-110,184-188,192-199,338-339`.

## 7. MEDIUM — AI database errors look like an empty AI bank

AI query errors are caught and converted into an empty array; `/api/questions` still returns successful core-only results. Missing schema and a legitimately empty AI bank are indistinguishable to the client.

Evidence: `src/index.js:167-180`.

## 8. LOW — session deletion uses mismatched ID encoding

Browser URI-encodes the ID; Worker binds the raw pathname suffix without decoding. IDs requiring encoding can fail to delete. Normal generated `ex_...` and `rv_...` IDs avoid this case.

Evidence: `public/index.html:1369,3617,3796`; `src/index.js:369-375`.

## 9. LOW / UNVERIFIED — cache comment exceeds measured evidence

Worker emits `Cache-Control` but does not use Cache API. Deployed edge hits and avoidance of repeated full-table scans have not been measured. This is a verification/documentation gap, not a demonstrated cache failure; do not change caching during cleanup.

Evidence: `src/index.js:174-181`.

## Cross-reference to original audit ordering

Audit findings 1–9 map to this severity-ranked list as follows: 1→1, 2→3, 3→8, 4→4, 5→2, 6→5, 7→6, 8→7, 9→9. All nine remain deferred.
