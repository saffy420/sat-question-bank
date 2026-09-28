# free-03 review

## Round 1 (self, adversarial read of the diff) — 2 findings, both fixed in 76627f2
1. **Concurrent flushes could lose a queued flush.** DO events interleave while a D1 call is in flight; each student message during a write-back runs `advance()+flush()`. The SQL is idempotent, but the new per-chunk `put('pending')` from a stale caller could overwrite the `nextPending` another caller had just promoted (End session queued behind a stuck write-back). Fix: `flush()` shares one in-flight `flushOnce()` per object; the `nextPending` recursion calls `flushOnce` directly. Test `concurrent flushes … share one run` fails without the guard (status stays `review`, the queued end is lost) and passes with it; it also shows one pass over the work (batches 480/480/480/61/3) instead of one per caller.
2. **Idle retry cost.** A permanent non-D1 error retried every 5 s forever (pre-existing: 17,280 alarms a day), and free-03 added a retry-state write and a registry call per retry. Fix: `other` errors back off like overload (5 s doubling to 5 min, ≤ ~300 a day). Live rooms still try D1 on every message, so a transient unclassified error recovers as fast as before while anyone is connected.

## Round 2 (after fixes) — PASS
Brief §6 checklist:
- (a) No feature/UI change except the admin banner. Flush semantics unchanged for a healthy D1 (same statements, same rows written: 4,542 for the self-paced end; instructor flush is still one batch). While D1 is refusing, the room still blocks new boundaries and answers `persistence unavailable`, as before. Retry timing for unclassified errors changes (5 s fixed → backoff) — not user-visible beyond when an idle room retries.
- (b) `BUDGET_TRACE` and `D1_FAULT_INJECTION` inert in production: `tests/test_budget.cjs` (no config sets the fault flag, staging included; production Worker has no `/api/e2e/d1-fault` even with both flags; the e2e route needs E2E_TEST_MODE + D1_FAULT_INJECTION + loopback + same origin, refuses staging); `tests/test_lesson_flush.cjs` (flag off → fault route is the room's 404, writes reach D1).
- (c) No caching added. `/api/admin/lesson-sync` is admin-only, `private, no-store`; the registry holds session IDs, times and a failure class only. Students: no new request, 403 on the endpoint (Playwright).
- (d) No stat logic touched (write-back still `lessonWriteBack` → shared `nextProgress`/`attemptRow`); no per-event D1 writes (registry writes are per failed flush, in DO storage, not D1).
- (e) Report numbers labeled (see report "free-03: guardrails").
- (f) free-03 used no staging quota (all local).
- (g) No `.skip`/`.only`; constants are post-free-02 + 20% rounded down; the one pinned change (self-paced largest batch) is lower, not higher.

Security: LessonSync is reachable only through the binding (no public route to DOs); the room's `fault` handler exists only with the flag; bodies validated.

Residual (documented, not fixed):
- The daily-limit message is matched on Cloudflare's documented text; it could not be observed on staging without exhausting the account-wide cap (brief §2 rule 3).
- The banner needs the admin check, which reads D1; if D1 *reads* are exhausted the whole dashboard is down anyway.
- If D1 stays down, a live lesson still pauses at the next boundary (lesson architecture; brief §3).
