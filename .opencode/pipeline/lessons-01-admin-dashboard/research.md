# Task01 research — 2026-09-24

Researcher session: ses_f2bb42f08ffedV5YGwvnVXyqbD. Read-only investigation completed before source work. Baseline commit 00cebf32; unrelated untracked files preserved. Task00b commit verified by Architect and its handoff corrected directly.

## Authority and resolved gates
Read docs/lessons/BRIEF.md (including amendments), PLAN.md (approved), STATUS.md, docs/AUDIT.md, audit research with A0–A6 corrections, task00b handoff, original prompt.
G1-A: practice disclosure unchanged; lesson-channel guarantee only. G2: grace before reveal. G3: prospective answer history, old direction unknown. G4: task01 Lessons tab honestly unavailable, populated assertion task09. G5/G6 later scope. Shared stats extraction approved. No new research contradiction. STOP after task01; no commit/push/deploy authorization.
Architect correction to researcher suggestion: PLAN.md line139 expressly calls for prospective history if G3 approved; G3 is approved. Include history capture now, not unknown-only deferral.

## Current code pointers
- src/index.js: tokenOf/whoami 86–111 (validated Supabase OAuth, cache); touchUser 122–132; handleRequest 165; knownAPI early404 199–202; restrictedAsset203; membership217–228; session POST229. No role/ADMIN_EMAILS. Preserve identity injection seam with production whoami default. Admin prefix must bypass early unknown-API404 to enforce student403 even unknown admin routes. Existing membership permits approved AND pending; preserve this behavior.
- schema.sql users36–41 lacks role. attempts45–56 carries question_id,ts,correct,time_taken_ms,picked,changes, unique user/question/ts; no answer_history_json. Core migrations through0006; next0007. Schema snapshot + migration need fresh and upgrade tests, never replay ALTER over fresh snapshot.
- public/index.html: everWrong1704; weakness1732; focusSet1752/nextLevel1816; tally1822; metrics levelOf/targetOf/trapCounts/pacing/guessing1841–1884; difficulty accuracy loops2177 and2236; mistakes2277–2370; renderer2692–2906; isRight2908; recordProgress/recordAttempt2943–2959; auth3895+.
- DOM-free stats close over QS/PROG/LOG. No Worker stat module. Approved shared module public/shared/stats.js absent. Browser and Worker must call same code, not copies. Retain current-state vs attempt definitions, Orange correct, attempt-based activity.
- tests/test_metrics.cjs, test_focus.cjs, test_grade.cjs, test_backfill.cjs lift marker blocks using new Function. Migrate intentionally when extracting; retain assertions.
- New derivable views: per-skill time/trend, difficulty pacing, trap examples, paginated attempts, last activity. Historical changes count cannot yield direction. Official trap coverage sparse; AI choices[].trap only. No lesson tables.
- renderStem/choiceHTML/loadQuestion/renderPanes/renderAnswerArea/mathify are real renderer; admin read-only inspection must reuse rather than duplicate. SPR from empty choices; isRight semantics unchanged.

## Recommended implementation
Single core0007 migration role + required prospective history column, mirrored snapshot. Role CHECK(student/admin), default student. Seed role from validated identity email and ADMIN_EMAILS on session POST only, never trust request role or write on admin reads. Env parsing comma-separated trim/case-insensitive. Document setup; no invented production email. Preserve membership rules. User role is separate from membership.
Central admin authorization for /api/admin and descendants, /admin and descendants and direct shell asset aliases: unauth API401/page login redirect, authenticated student API403/page app redirect, admin unknownAPI404. Same-origin write protections unchanged. GET APIs list/detail read-only, escaped account strings, explicit safe returned fields.
Shared browser-served pure stats with explicit inputs and shared normalization/grading/rendering only as necessary. Worker aggregates, SPA calls extracted functions, no duplicate computations. Admin sidebar Students/Lessons/Live/Question Bank; future surfaces disabled, no builder. Every current-data detail tab required; Lessons approved empty.
List columns name, questions done, current accuracy, weakest skill, pace/target, second-guess rate, last activity. Detail Overview/By skill/Mistakes/Traps/Pacing/Second-guessing/History/Lessons. Search/sort; history pagination; mistake filters/read-only question. Sparse values honest, not fabricated. Include all permitted club members consistent with actual membership policy (approved/pending); research suggestion of approved-only is not a requirement.

## Harness/tests
Reuse tests/e2e/lessons-00b-e2e-harness/{auth,contexts,offline,throttle,leak}. auth.js signIn/newUserContext, HTTPS127.0.0.1:8787, Chromium1366x768, production-network block. playwright config three owned webServers8787/8788/8789, reusefalse. Baseline historical unit46/e2e6 passes, not rerun by parent.
Extend owned SQL fixtures users/progress/attempts, MC/SPR/AI traps, known directions + legacy unknown, pagination, Orange/Red/Green and timing. Seeds idempotent and local only. Existing e2e state requires explicit0007 upgrade handling; CREATE IF NOT EXISTS snapshot alone cannot upgrade existing tables.
Developer unit security matrix unknown prefixes, aliases, DB failures failclosed, no admin GET writes, membership, role seeding, history validation/roundtrip/queue ownership, stats parity and migration fresh/upgrade. Separate Test Developer real CLI + permanent specs, focused/full suite, screenshots/e2e.md. Original01 checkpoint admin list/every detail tab; student /admin redirect, /api/admin/*403. G4 only exception Lessons empty. Add unauth/admin unknown prefixes.

## Environment
rtk prefix all shell; Windows git.exe authoritative (WSL Git CRLF phantoms). Node/Wrangler from WSL due Linux workerd. Secure host cookie needs HTTPS. Stop owned dev processes before direct seed/schema writes; no production data or remote calls. Explicit two DB bindings/persistence .wrangler/state-e2e. E2E env-file override means configure ADMIN_EMAILS in local config/seed, not shell expectation. Serena initial_instructions unavailable; no claim loaded.
Untracked .omp/, .serena/, docs/roadto1600-lessons-prompt.md, nul and odd root files must remain untouched.
