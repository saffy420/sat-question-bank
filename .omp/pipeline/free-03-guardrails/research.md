# free-03 research — D1 quota and overload errors

Source: `lessons-researcher`, 2026-09-27, external docs only.

## Daily limit exhausted (Free plan) — doc-stated
https://developers.cloudflare.com/d1/observability/debug-d1/
- `Your account has exceeded D1's free tier daily row read limit. Upgrade to a paid plan or wait until tomorrow (midnight UTC)`
- `Your account has exceeded D1's free tier daily row write limit. Upgrade to a paid plan or wait until tomorrow (midnight UTC)`
- No numeric code on the page (a "7429"-style code is unconfirmed).
- Storage variants (not daily): `Your account has exceeded D1's maximum account storage limit…`, `Exceeded maximum DB size.` These do not clear at midnight, so they are not classed as daily quota.

## Overloaded / transient — doc-stated (same page)
- `D1 DB is overloaded. Requests queued for too long.`
- `D1 DB is overloaded. Too many requests queued.`
- `Network connection lost.`
- `Replica disconnected from primary.`
- `Cannot resolve D1 DB due to transient issue on remote node.`
- `D1 DB storage operation exceeded timeout which caused object to be reset.`
- `Internal error while starting up D1 DB storage caused object to be reset.`
- `Internal error in D1 DB storage caused object to be reset.`
- `D1 DB reset because its code was updated.`
- `D1 DB's isolate exceeded its memory limit and was reset.`
- `D1 DB exceeded its CPU time limit and was reset.`

## Batch atomicity — doc-stated
https://developers.cloudflare.com/d1/worker-api/d1-database/#batch
"Batched statements are SQL transactions. If a statement in the sequence fails, then an error is returned for that specific statement, and it aborts or rolls back the entire sequence."

## Consequences for free-03
- Classify on the message text: `daily row (read|write) limit` → quota (retry after 00:00 UTC, with backoff probes before); the overload/reset list → overload (short backoff); anything else → unchanged 5 s retry.
- A failed batch lands nothing, so a chunk either lands whole or not at all; the flushed-set can record a chunk only after its batch returns.
- Staging cannot verify the quota message: exhausting the account-wide daily cap would take production down (brief §2 rule 3). The e2e fault flag injects the doc-stated write-limit message instead.
