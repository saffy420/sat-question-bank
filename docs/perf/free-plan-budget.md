# Free-plan budget — roadto1600.org

Status: **free-01 in progress — paused at a hard stop** (verified limits contradict brief §1; see "Open decisions").
Labels: **[staging]** measured on the staging Worker, **[local]** measured on local `wrangler dev`, **[est]** estimated, **[doc]** from Cloudflare docs.

## Verified limits (2026-09-27)

| Limit | Brief §1 | Verified | Source |
|---|---|---|---|
| D1 queries per invocation (Worker) | 50 | **1,000** separate queries; query 1,001 fails with "Too many API requests by single Worker invocation" [staging] | probe `worker-ceiling` |
| D1 queries per invocation (DO fetch) | — | **1,000**, same error [staging] | probe `do-ceiling` |
| D1 queries per DO alarm | — | 60 ok in a first alarm, 45 more in a chained second alarm: **each alarm is a fresh invocation** [staging] | probe `do-alarm` |
| Worker + DO in one request | — | Worker 45 + DO 45 both succeed: **the DO has its own budget** [staging] | probe `chain` |
| `batch()` counting | unknown | **A batch counts as one query.** 200-statement batch + 60 separate = ok; 1,500-statement batch ok [staging] | probes `worker-mix`, `worker-big`, `do-big` |
| 1,500-statement read batch duration | 30 s cap | 177–187 ms [staging] | probes `worker-big`, `do-big` |
| Worker CPU per invocation | 10 ms | **Not enforced at the observed levels:** Worker invocations of 21–41 ms and one DO invocation of 380 ms all ended `outcome: ok` [staging] | `wrangler tail` |
| D1 rows written / day | 100,000 | 100,000, resets 00:00 UTC; errors, not billing, when exceeded [doc] | https://developers.cloudflare.com/d1/platform/pricing/ |
| D1 rows read / day | 5,000,000 | 5,000,000 [doc] | same |
| D1 DB size / bound params / query duration | 500 MB / 100 / 30 s | 500 MB / 100 / 30 s; 10 databases per account [doc] | https://developers.cloudflare.com/d1/platform/limits/ |
| Worker requests / day | 100,000 | 100,000, Error 1027 [doc] | https://developers.cloudflare.com/workers/platform/limits/ |
| Subrequests per invocation | — | 50 (fetch) / **1,000 to internal services** [doc] — the 1,000 ceiling above matches this row, and Paid would be 10,000 | same |
| DO requests / day | not in brief | **100,000**, "Includes HTTP requests, RPC sessions, WebSocket messages, and alarm invocations"; 20:1 ratio stated for billing only [doc] | https://developers.cloudflare.com/durable-objects/platform/pricing/ |
| DO duration / day | not in brief | **13,000 GB-s** (128 MB per active object ⇒ ~28 active object-hours/day) [doc] | same |
| DO SQLite storage (KV API) | not in brief | 5 M rows read / 100,000 rows written per day; every `put()`/`delete()`/`setAlarm()` is a row written [doc] | same |
| DO storage backend on Free | — | SQLite only (the app already uses `new_sqlite_classes`) [doc] | same |

Notes
- Cloudflare's D1 limits page still says "Queries per Worker invocation … 50 (Free)". On this account the binding behaves like the 1,000 internal-services subrequest limit instead. Whether the account is on Workers Free couldn't be read from the API (the token lacks billing scope); the 1,000 ceiling is the Free value (Paid would be 10,000).
- CPU: the documented Free limit is 10 ms per request. Observed invocations far above it were not killed. The probes are too small a sample to call that safe: Cloudflare may enforce it later or statistically.

## Batch-semantics result (drives free-02 chunking)

One `batch()` = one query against the per-invocation limit, whatever its statement count. Per-statement limits still apply inside a batch (100 bound params, 100 KB SQL, 30 s for the whole batch) [doc]. A 1,500-statement batch finishes in < 0.2 s [staging, read-only statements; write latency to be measured with the self-paced flow].

## Per-flow table / daily model / ranked problems

Pending. Blocked on the decisions below and on the question-bank size (see "Open decisions").

## Staging usage log

| Date (UTC) | Rows written | Rows read | Worker requests | What |
|---|---|---|---|---|
| 2026-09-27 | ~252 | ~122 | ~30 | schema + e2e seed; batch/ceiling probes (read-only `SELECT ?`) |

Caps: 10% = 10,000 rows written, 500,000 rows read, 10,000 requests.

## Open decisions (hard stop, brief §3)

1. Targets for free-02: the brief's ≤ 35 queries/invocation and ≤ 7 ms CPU were derived from 50 and 10 ms.
2. The realistic question-bank size and content for local and staging measurement (production reads were not permitted in this session).
