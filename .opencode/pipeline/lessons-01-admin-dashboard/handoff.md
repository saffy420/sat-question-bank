# Handoff: lessons-01-admin-dashboard

**Date:** 2026-09-24
**Stage:** Documentation after independent Reviewer PASS
**Final Reviewer:** ses_f2a7ee742ffesKhWUV4Bi4PbNU — PASS (actual diff verified, unit 51/51 rerun)
**Post-round2 Test Developer:** ses_f2a906b3cffe53VH0AdZEfVnn1 — focused 4/4, full 10/10, CLI screenshots; 2/5 repairs used
**Baseline commit:** 00cebf32 (task00b, committed)
**Task01 status:** Uncommitted, STOP pending user acceptance. No task02/commit/push/deploy authorized.

## Scope delivered

- **Roles:** Core migration 0007 adds `users.role` (NOT NULL DEFAULT `student`, constrained `student`/`admin`) and nullable `attempts.answer_history_json`; mirrored in `schema.sql` for fresh init. Role synced server-side from validated identity email matching `ADMIN_EMAILS` on session POST only. Demotion on next session POST when removed from list. Client role/body fields ignored. Production `ADMIN_EMAILS` blank; local E2E owns `e2e-admin@e2e.test`.
- **Admin dashboard (all tabs):** `/admin` shell with collapsible sidebar (Students/Lessons/Live/Question Bank). Students list searchable/sortable/paginated with seven columns; detail page all eight tabs: Overview, By skill, Mistakes (filters + read-only renderer preview), Traps, Pacing, Second-guessing, History (genuinely paginated), Lessons (honestly unavailable per G4).
- **Shared stats/renderer:** `public/shared/stats.js` owns all derivable views; `public/shared/renderer.js` owns stem/choice/context rendering + shared `isRight`. Worker and SPA import same modules; no duplicate computation.
- **Prospective history:** Practice captures ordered MC/SPR selections before grading into validated `answer_history_json`. Legacy attempts report unknown. Direction graded via unchanged `isRight` (first vs final). Malformed/oversized/non-monotonic sequences rejected at API boundary. Queue round-trip/acknowledgment compatibility preserved.
- **Security/authorization:** Central `/api/admin/*` and `/admin` prefix gates: unauth 401, member student 403/page redirect, admin unknown 404, role DB errors failclosed 503. Admin GET read-only: no `touchUser`, no account writes, bounded/validated params, escaped output, private/no-store.

## Verification summary

- `rtk npm test` — 51/51 passed (Developer report, not rerun by this Documentation agent).
- `rtk node --check src/index.js public/admin.js public/shared/stats.js public/shared/renderer.js` — passed.
- `rtk git.exe diff --check` — passed (Windows Git future-CRLF warnings only).
- Test Developer focused 4/4, full suite 10/10, CLI screenshots captured.
- Reviewer actual diff vs spec: PASS, no blocking findings, prior findings independently resolved.
- **This Documentation agent did not rerun tests.** Verification is by reading artifacts and git status. No test claims made beyond what the artifacts report.

## Decisions

1. **G4 Lessons empty** — Honest unavailable placeholder until task09. No fabricated attendance data.
2. **Role demotion is deferred** — Removal from `ADMIN_EMAILS` takes effect on next session POST, not instantly. Documented as a known limitation.
3. **Roster 500 guard** — List stats computed for bounded club roster (501-row guard) before server sorting; SQL aggregation needed if membership exceeds 500.
4. **Production ADMIN_EMAILS blank** — No admin promotion possible in production until configured. 0007 migration required before any future deploy that needs role data.
5. **No deployment** — Task01 uncommitted. 0007 migration and ADMIN_EMAILS configuration are prerequisites for any future deploy, but no deployment is happening now.

## Limitations / caveats

- Production `ADMIN_EMAILS` is blank in `wrangler.toml`. Role-based admin access requires explicit configuration before deploy.
- 0007 migration is not applied to any production database. Fresh deploy needs migration run; existing isolated E2E DBs handle upgrade via seed script.
- Role demotion is next-session, not instant.
- Roster returns 413 above 500 matching members (documented ceiling).
- Official trap metadata is sparse; Traps tab shows tagged denominator only.
- Mojibake normalization regression was unit-proven (Developer round2) but has no dedicated browser fixture.
- Local Wrangler TLS probes emit `SSLV3_ALERT_CERTIFICATE_UNKNOWN`; browser assertions pass. No production/CDN behavior claimed.
- Serena `initial_instructions` was unavailable to parent session; no claim it loaded.

## Review retry history (honest capture)

| Reviewer session | Outcome | Notes |
|---|---|---|
| ses_f2aad97bdffeAgRUgQeja2XbqX | FAIL | Prompted repair round 2 (round 1 fixed SPR verdict before review) |
| ses_f2a820929ffez7CY8geLgsfHKO | Unusable ELL | No verdict accepted; not treated as PASS |
| ses_f2a807da1ffeNpFchmk5z61hPT | Blocked on CRLF tooling | Verified unit 51/51 but tooling issue prevented diff review; parent demonstrated clean `--ignore-cr-at-eol` diff without changing Git config |
| ses_f2a7ee742ffesKhWUV4Bi4PbNU | **PASS** | Actual diff inspected, prior findings resolved, unit 51/51 rerun, no blockers |

No source changes were made during any review retry. Repair rounds: 2/5.

## User constraints honored

- Fresh agent instance every delegation; no task_id resume.
- No commit, push, deploy, or remote data mutation.
- Task01 uncommitted; STOP before task02 without explicit user acceptance.
- Unrelated untracked files preserved (`.omp/`, `.serena/`, `docs/roadto1600-lessons-prompt.md`, `nul`, odd root files).
- No code or test changes made by this Documentation agent.

## Next session

- User must accept task01 uncommitted state before any commit.
- 0007 migration must be applied to any target database before deploy that requires role data.
- `ADMIN_EMAILS` must be configured in production `wrangler.toml` before role-based admin access works.
- Task02 (builder) cannot start until task01 user acceptance and commit.
- Role demotion timing and roster 500 limit are known limitations to address in a future session if they become blockers.

## Changed files (per Developer report)

Modified: `.env.example`, `playwright.config.js`, `public/index.html`, `schema.sql`, `src/index.js`, `tests/test_auth_routing.cjs`, `tests/test_e2e_auth.cjs`, `tests/test_focus.cjs`, `tests/test_grade.cjs`, `tests/test_metrics.cjs`, `tools/e2e_ai.sql`, `tools/e2e_core.sql`, `tools/e2e_seed.cjs`, `wrangler.e2e.toml`, `wrangler.toml`, `.opencode/pipeline/lessons-00b-e2e-harness/handoff.md`

New: `migrations/0007_admin_history.sql`, `public/admin.html`, `public/admin.js`, `public/shared/stats.js`, `public/shared/renderer.js`, `tests/test_admin.cjs`, `.opencode/pipeline/lessons-01-admin-dashboard/developer.md`, `.opencode/pipeline/lessons-01-admin-dashboard/handoff.md`

Untracked artifacts preserved: `.opencode/pipeline/lessons-01-admin-dashboard/e2e/` (screenshots, results, CLI auth helper)
