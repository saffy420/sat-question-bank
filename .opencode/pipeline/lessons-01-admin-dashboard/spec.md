# Spec: lessons-01-admin-dashboard
Date: 2026-09-24

## Goal
Implement only BRIEF §1 Roles and §3 admin dashboard. Complete task01 then STOP for user acceptance, no commit/push/deploy. Task00b commit00cebf32 verified; user requested continuation.

## Context
Read research.md and approved docs/lessons/{BRIEF,PLAN}. Approved amendments override original prompt. Current runtime differs from stale standing notes (membership, API404, run_worker_first=true, npm test); follow actual code. Existing harness local HTTPS with isolated DBs. Preserve unrelated untracked files. Source work belongs Developer, e2e work separate fresh Test Developer, review independent.

## Requirements
### Roles / security
1. Next unused core migration0007 (verify) adds users.role NOT NULL DEFAULT student with constrained student/admin and attempts.answer_history_json nullable; mirror schema snapshot. Test both fresh and existing-schema upgrade. No lesson tables.
2. Seed/synchronize role from server-validated identity email matching comma-separated, trimmed, case-insensitive ADMIN_EMAILS on existing session POST. Upsert user there; removal from list demotes on next session POST. Stored DB role authoritative between session syncs, documented limitation. No role from client payload/metadata/headers. Empty env means no admin promotion. Production config blank or unset; do not invent instructor address. Local e2e has explicit owned admin email. Existing touchUser must not reset seeded roles. Membership remains distinct; preserve approved/pending access and denied rejection.
3. Central prefix authorization /api/admin and all descendants (all methods, before unknown-route fallthrough): unauth401, permitted membership nonadmin403, admin unknown404. /admin and descendants: anonymous login redirect, student /app redirect, admin shell. Protect any direct admin.html alias equivalently. No private data in static source; all admin data server-authorized. Role DB errors failclosed503. Preserve CSRF/origin gate, Supabase validation and production default identity.
4. Admin GET reads never write (no touchUser, account write/purge helper). Explicit queries, bound IDs, bounded/validated pagination, no client-selected SQL sort. Responses private,no-store. Avoid client spoofing and escape all account/user-answer strings; imported question HTML stays existing trust model.

### Shared computation / prospective history
5. Extract existing pure stats to one browser-served ESM module (e.g. public/shared/stats.js), explicit inputs, Worker imports same source, student dashboard/focus call same implementations. Do not copy inline logic. Preserve markers or migrate affected tests deliberately. Current-state Orange correct vs historical attempt accuracy labeled separately; null/unscorable excluded; existing retry/backfill and local-day activity unchanged.
6. New derivable computations only once: skill attempted/current accuracy/avg time/trend, difficulty pacing, trap examples, last activity, paginated attempt history. No invented historical data. Use existing taxonomy order. Sparse trap/time records display unavailable or proper denominator.
7. G3 prospective history IS REQUIRED (PLAN §6 task01). Capture ordered answer selection changes for new practice attempts including MC and SPR, persist nullable answer_history_json through existing attempt API, load/queue/retry exact snapshots, keep legacy attempts history null. Define UI direction as first vs final scored selection per attempt; grade both using same isRight (extract existing implementation unchanged if needed). Invalid/unscorable/absent sequences count unknown, never infer from changes/final correctness. Capture before grading; retries not falsely first-try, no post-check choices included in prior attempt. Handle empty/no-change histories honestly. Validate history shape/size/timestamps and answer strings at API trust boundary; preserve existing old-client payload compatibility and acknowledgments. No lesson source/uniqueness yet.

### Dashboard
8. Minimal /admin laptop shell: collapsible sidebar Students, Lessons, Live, Question Bank; Students functional; later sections clear unavailable placeholders (no builder/live/bank redesign). Integrate auth through existing cookie/session flows. UI renders only server-computed stats, no duplicated logic.
9. Searchable/sortable student table: name, questions done, overall current accuracy, weakest skill, average pace vs target, second-guess rate, last active. Include member students per existing approved/pending policy, not admin as student. Zero-activity member visible; pagination if needed for payload bound; no arbitrary silently truncated history.
10. Student detail name/email/total/current accuracy/last active. All eight tabs:
- Overview: domain bars R&W/Math grouped, E/M/H accuracy, weak spots.
- By skill: every bank skill, attempted, accuracy, avg time, sparkline trend, ascending accuracy (unavailable labeled).
- Mistakes: existing mistake semantics, domain/skill/difficulty filters; read-only real-renderer question with student's answer, correct answer, explanation. Reuse shared player helpers; no second question renderer. No admin inspection writes progress/attempts.
- Traps: categories/count/examples, sparse data honest.
- Pacing: section and difficulty vs target.
- Second-guessing: existing change-rate + prospective right-to-wrong/wrong-to-right and legacy unknown.
- History: newest-first question attempts, genuinely paginated, not exam sessions.
- Lessons: explicitly unavailable/empty until task09 per G4. No fake attendance.
11. Reuse normalization/grading/render helpers when required, smallest extraction, no unrelated refactor. Preserve math/figures/grid-in, same renderer for admin preview. Accessible controls, keyboard operation, visible focus, errors/empty/loading states, no unsafe-eval. New static modules must be reachable through actual Worker routing/CSP without exposing restricted data.

## Non-goals
No DO/WS/timers/builder/lesson schema/notes/Desmos/new external dependencies, no remote data changes. No real OAuth e2e claim, no full-bank or production validation claim. No commit. Do not rewrite entire app or add speculative service framework.

## Implementation steps
1. Read relevant sources/tests; inspect Git status via git.exe. Load applicable Workers skill; use Context7 for version-specific SDK/CLI usage. Serena initial_instructions absent in parent tool list, note if unavailable.
2. Add migration/snapshot, role session-sync and prefix gate, configure/document ADMIN_EMAILS in existing config example. Schema upgrade for existing isolated harness must be safe/idempotent and explicit; do not apply ALTER over new snapshot blindly.
3. Extract shared stats/minimal normalization/grader/renderer reuse; integrate browser and Worker. Add prospective history persistence with validation and queue compatibility tests.
4. Add read-only admin endpoints + shell, ensure no personal data in generic assets. Add app/unit tests and Developer-owned config changes. Developer must NOT author Playwright tests.
5. Update local owned fixture/seed support as needed. Ensure Playwright output task01 configurable/path without touching prior evidence (Developer owns config).
6. Developer report under this pipeline directory, with actual commands/results/changed files and limitations.
7. Separate Test Developer uses CLI skill and permanent Playwright tests, screenshots/e2e.md; no app changes. Classify failures and stop on app bug. Full regression after every app repair.
8. Independent Reviewer actual diff, then Documentation handoff + dated docs/lessons/STATUS.md. STOP.

## Project gates
G1–G6 approved. Only explicit task01 checkpoint exception G4 Lessons-empty. Prospective history required, not a deferral gate. Missing e2e prerequisite, unmet checkpoint, unexpected contradiction: USER-DECISION GATE with exact evidence; do not silently narrow requirements. At most5 automatic repair rounds; same unresolved ambiguity/failure signature stops, no unchanged retries. Task01 STOP after PASS; no task02/commit/push/deploy.

## Validation
Developer: run actual npm test (not imaginary lint/typecheck) plus focused fresh/upgrade migration, security/role tests, parity and history checks. Tests assert no writes for all admin GETs; two accounts cross-access denied, spoofed role denied, unknown admin prefix gated, shell alias protected, missing DB/role failclosed, pending membership semantics unchanged. Exercise history JSON legacy/new roundtrip, malformed/oversized rejection, out-of-order account-owned queue safety, MC and SPR direction via unchanged grader. Renderer tests existing suite preserved.
Test Developer original checkpoint copied exactly: **admin sees the student list and every detail tab renders data for a seeded student; a student gets redirected from `/admin` and 403 from `/api/admin/*`.** Approved G4: Lessons tab asserts honest unavailable, populated test deferred09.
Extended checkpoints: C1 admin list columns/search/sort and zero-activity student. C2 all8 tabs, meaningful seeded numeric assertions, filters, newest-first history pagination; read-only MC/SPR previews and math render; no inspection writes. C3 student /admin+alias redirect and known/unknown adminAPI403; unauth401/page redirect; admin unknown404. C4 prospective MC/SPR practice selections roundtrip through server and admin direction metrics vs legacy unknown; practice dashboard continues using shared metrics. No stale DOM reference after Check. Seed enough data for traps/trends/pagination with deterministic values.
Use isolated local HTTPS only, owned accounts,1366x768, Playwright CLI screenshots AND permanent tests under tests/e2e/lessons-01-admin-dashboard/. Run task specs and entire existing e2e suite. No skips/only/fixme/fixed readiness sleeps/inflated timeout. Screenshots/traces/e2e.md under this task pipeline. Load Playwright skill and current Context7 docs. Do not claim baseline historical tests newly ran.

## Review focus
Actual diff versus this spec and approved brief; no duplicated computations/renderer/grader, student behavior parity, history does not fabricate direction, no new data-loss/security path. Migration and existing seeded DB upgrade. Every admin route/alias gated, no writes on reads, stored role/env lifecycle explicit, secrets absent, test-only auth still excluded from production. Every checkpoint genuine assertion, independent Test Developer touched no app code, CLI proof/full regression evidence. Flag any undocumented narrowing instead of accepting it.
