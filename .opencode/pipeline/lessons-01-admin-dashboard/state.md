# State: lessons-01-admin-dashboard

## Delegation rule

User requires NEW agent instance every delegation, including repair/rerun/review. Never resume task_id. Reviewer role does code review; Developer may only implement/repair or act as explicitly separate Test Developer. Context capacity reported by user:280k; no configuration change claimed.

## Current terminal state

**Stage:** Documentation after independent Reviewer PASS
**Final Reviewer:** ses_f2a7ee742ffesKhWUV4Bi4PbNU — PASS (actual diff verified, unit 51/51 rerun)
**Post-round2 Test Developer:** ses_f2a906b3cffe53VH0AdZEfVnn1 — focused 4/4, full 10/10, CLI screenshots; 2/5 repairs used
**Baseline:** 00cebf32 task00b committed; handoff corrected directly by parent
**Task01:** Uncommitted, STOP pending user acceptance. No commit/push/deploy.
**Documentation agent (ses_f2a7aeb62ffeIkCWhw9EHFN8oi, fresh delegation):** Read all pipeline artifacts, verified git status, wrote handoff.md and updated state.md and STATUS.md. No source/test changes made.

**Git status:** 16 modified files, 17 untracked files (including new task pipeline directory, .omp/, .serena/, docs/roadto1600-lessons-prompt.md, nul, odd root files). Unrelated untracked preserved.

## Evidence so far

- Research ses_f2bb42f08ffedV5YGwvnVXyqbD; research.md/spec.md.
- Developer ses_f2badec68ffeHsBiQ2N3ronn3V: task01 implemented, unit 51/51.
- Round1 browser failure SPR verdict: removed cbIdx called during refresh. Fixed using shared cbSort. Test Developer ses_f2ae965b6ffe50qfbos0782YIV completed C1–C4 focused4/4/full10/10, CLI screenshots, e2e.md.
- Reviewer ses_f2aad97bdffeAgRUgQeja2XbqX FAIL; findings documented in review.md.
- Round2 Developer: four findings refuted with runnable baseline parity/history/selection checks; confirmed normalization order and duplicate preview composition fixed. Unit 51/51.
- Reviewer ses_f2a820929ffez7CY8geLgsfHKO: unusable ELL, no verdict accepted (not treated as PASS).
- Reviewer ses_f2a807da1ffeNpFchmk5z61hPT: verified unit 51/51 but blocked on CRLF tooling; parent demonstrated clean `--ignore-cr-at-eol` diff without config changes (not treated as PASS).
- Final Reviewer ses_f2a7ee742ffesKhWUV4Bi4PbNU: PASS, actual diff inspected, unit 51/51 rerun, no blockers.
- Round2 Test Developer ses_f2a906b3cffe53VH0AdZEfVnn1: focused 4/4, full 10/10, CLI screenshots; 2/5 repairs used. No app/config/unit edits.
- Documentation agent ses_f2a7aeb62ffeIkCWhw9EHFN8oi fresh delegation: all artifacts read, handoff.md written, state.md/STATUS.md updated. No code/test changes.

## Review retry tooling issue (honest capture)

Two prior reviewer sessions did not produce usable verdicts: ses_f2a820929ffez7CY8geLgsfHKO returned unusable ELL; ses_f2a807da1ffeNpFchmk5z61hPT verified unit 51/51 but was blocked on CRLF tooling. Neither is treated as PASS. The CRLF tooling issue was demonstrated to be a tooling limitation, not a source problem: `git.exe --ignore-cr-at-eol` produced a clean diff without any Git configuration changes. The final Reviewer ses_f2a7ee742ffesKhWUV4Bi4PbNU completed the substantive independent review.

## Pending

- User acceptance of task01 uncommitted state before any commit.
- 0007 migration must be applied to any target database before deploy requiring role data.
- Production `ADMIN_EMAILS` must be configured before role-based admin access works in production.
- Role demotion is next-session, not instant (documented limitation).
- Task02 (builder) blocked until task01 user acceptance and commit.
- All G1–G6 closed; G4 Lessons-empty only checkpoint exception.
- Serena `initial_instructions` not exposed; not loaded.
