# Review: lessons-01-admin-dashboard
## Final verdict: PASS
Fresh independent Reviewer: ses_f2a7ee742ffesKhWUV4Bi4PbNU. Repair count2/5.
Spec compliance/correctness/regressions/security/conventions/tests: PASS. No blocking findings.

## Independently verified evidence
- Windows `rtk git.exe diff --ignore-cr-at-eol --stat 00cebf32`:16 tracked files402insertions299deletions. LF→CRLF warnings not churn; no Git configuration changes needed or made.
- Worker and SPA actual hunks reviewed, new untracked admin/shared modules/migration/unit/e2e files read directly.
- Reviewer `rtk npm test`:51/51 passed,0failed.
- Fresh Test Developer ses_f2a906b3cffe53VH0AdZEfVnn1 post-round2 focused4/4 and full10/10, CLI Browse/admin MC/SPR screenshots. Reviewer inspected tests and e2e.md, did not claim fresh browser rerun.
- Additive0007 constrained role/nullable history mirrors snapshot; fresh/upgrade tests; isolated seed idempotent upgrade.
- Server-validated env-role sync only sessionPOST, explicit demotion-next-session limit; approved/pending membership preserved; role prefix/aliases,401/403/404/503 matrix, bounded escaped parameters, no admin GET writes (query_only unit proof), private no-store.
- Single-source stats/renderer; history validation/batch rejection, legacy unknown; current-state/attempt semantics, read-only previews and pagination.
- Eight tabs covered (G4 Lessons unavailable); C1–C4 actual numeric assertions, no skips/only, separate Test Developer boundaries.

## Prior FAIL findings — independently resolved
1. MC stale Check: refuted by click/keyboard/highlight runnable assertions.
2. Retry history aliasing: refuted, first serialized attempt remains[A], second[B].
3. SPR doublecount: refuted,2→3 then submit/grade remains changes1/history[2,3].
4. Choice markup regression: refuted by exact baseline graph/non-graph/multi-paragraph comparisons.
5. Normalization ordering: confirmed/fixed, decode mojibake before MC prefix extraction; red-before/green-after unit regression.
6. Duplicate preview composition: confirmed/fixed; Browse/admin share previewHTML, browser markup parity asserted.

## Nonblocking caveats
- Roster returns413 above500 matching members; documented ceiling, SQL aggregation needed if exceeded.
- Mojibake regression unit-proven, no dedicated browser fixture.
- Local TLS probe noise and CDN-load console error noted; no production claims.
- Unrelated untracked root clutter remains outside task.

## Review history
Initial Reviewer ses_f2aad97bdffeAgRUgQeja2XbqX FAIL prompted repair2. Later fresh reviewer ses_f2a820929ffez7CY8geLgsfHKO returned unusable ELL: no verdict accepted. Fresh ses_f2a807da1ffeNpFchmk5z61hPT verified unit51/51 but blocked on CRLF tooling. Parent demonstrated clean Windows git.exe --ignore-cr-at-eol diff without changing config. Final fresh Reviewer above completed substantive independent review. No source changes during these review retries.
