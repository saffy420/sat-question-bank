# free-01 research (2026-09-27)

Sources fetched 2026-09-27 as Markdown from developers.cloudflare.com (quotes verbatim).

## D1 — https://developers.cloudflare.com/d1/platform/limits/ (updated Apr 21, 2026)
- "Queries per Worker invocation (read subrequest limits) | 1000 (Workers Paid) / 50 (Free)"
- "Maximum database size | 10 GB (Workers Paid) / 500 MB (Free)"; "Databases per account | … / 10 (Free)"; "Maximum storage per account | … / 5 GB (Free)"
- "Maximum bound parameters per query | 100"; "Maximum SQL query duration | 30 seconds"; "Maximum SQL statement length | 100,000 bytes"
- Batch: "Limits for individual queries (listed above) apply to each individual statement contained within a batch statement. For example, the maximum SQL statement length of 100 KB applies to each statement inside a db.batch()." — silent on whether the 50-per-invocation *count* is per statement or per batch. Settled empirically on staging (free-01 §4).
- "A database that receives too many concurrent requests will first attempt to queue them. If the queue becomes full, the database will return an 'overloaded' error."

## D1 pricing — https://developers.cloudflare.com/d1/platform/pricing/
- "Rows read | 5 million / day"; "Rows written | 100,000 / day"; "Free limits reset daily at 00:00 UTC."
- "Indexes will add an additional written row when writes include the indexed column"
- "When your account hits the daily read and/or write limits, you will not be able to run queries against D1. D1 API will return errors…"

## Workers — https://developers.cloudflare.com/workers/platform/limits/
- "CPU time per HTTP request | 10 ms" (Free); "Subrequests per invocation | 50" (Free); "Subrequests to internal services | 1,000"
- "Accounts on the Workers Free plan have a daily request limit of 100,000 requests, resetting at midnight UTC … Error 1027."
- CPU/wall time "appear at the top level of the Workers Trace Events object" (Tail Workers / Logpush / wrangler tail).

## Durable Objects pricing — https://developers.cloudflare.com/durable-objects/platform/pricing/
- Free: "Only Durable Objects with SQLite storage backend are available." "If you exceed any one of the free tier limits, further operations of that type will fail with an error." "Daily free limits reset at 00:00 UTC."
- "Requests | 100,000 / day | … Includes HTTP requests, RPC sessions, WebSocket messages, and alarm invocations"
- "Duration | 13,000 GB-s / day"
- WebSocket: "For compute requests billing-only, a 20:1 ratio is applied to incoming WebSocket messages… The 20:1 ratio does not affect Durable Object metrics". Whether the Free daily cap applies the 20:1 ratio is not stated → the report models both (1:1 worst case).
- SQLite storage (Free): "Rows reads | 5 million / day"; "Rows written | 100,000 / day"; "SQL Stored data | 5 GB (total)". "Key-value methods like get(), put(), delete(), or list() … are billed as rows read and rows written." "Each setAlarm() is billed as a single row written." "Deletes are counted as rows written." Separate meter from D1 per the table (not stated whether it shares D1's cap) → modelled separately.
- Hibernation: "Durable Objects that are idle and eligible for hibernation are not billed for duration".

## Durable Objects limits — https://developers.cloudflare.com/durable-objects/platform/limits/
- "CPU per request | 30 seconds (default)…"; "Durable Objects are Worker scripts, and have the same per invocation CPU limits as any Workers do." "the maximum CPU time per Durable Objects invocation (HTTP request, WebSocket message, or Alarm)". Contradictory for Free (10 ms vs 30 s) → measured on staging.
- "Simultaneous outgoing connections/request | 6"
- Not documented: whether D1's 50-per-invocation limit applies per DO fetch / WebSocket message / alarm → measured on staging.

## Codebase flow map (lessons-researcher B + own reading)
- Student boot: POST /api/auth/session, GET /api/questions, /exams.json, /api/progress, /api/attempts, /api/settings, /api/lesson-history (public/index.html:1230-1302, 1241, 4066).
- Filters in the student bank are client-side (no request). Admin builder search = GET /api/admin/questions (admin-ui/Builder.tsx:157), builder autosave debounced 600 ms PUT /api/admin/lessons/:id (Builder.tsx:475).
- Practice Check: push('/api/progress'), push('/api/attempts'), no debounce, one in-flight per endpoint, ≤200 rows (index.html:1335-1398).
- Admin: students list (Students.tsx:103), detail (Students.tsx:235), history tab paginated (Students.tsx:535). Live picker: GET lessons?includeArchived=1 then one GET sessions per lesson (Live.tsx:81-84).
- Self-paced student sends select / navigate / time (on leaving a question, index.html:3826-3835) / submitAll / vote.
- Throttles: Desmos SYNC_MS = 150 (public/shared/desmos.js:3); server laser floor 25 ms (src/lesson-room.js:379); admin roster refresh ≤ 4/s via 250 ms timer (src/lesson-room.js:154-163).

## Code hazards spotted while reading (to measure, not fix, in free-01)
- /api/admin/students runs adminData per student: 2 queries each + bank (2) → ~65 queries for 30 students in one invocation.
- LessonRoom.initialize: one D1 query per lesson item (+ AI_DB fallback) → 20–40 queries in the first DO event.
- Self-paced flush: 25 separate progress SELECTs + one batch of ~1,500 statements (500 responses + 1,000 write-back + finished/status).
- saveLesson: batch of one SELECT per item + UPDATE + DELETE + N INSERTs per autosave.
