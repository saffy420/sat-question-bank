# Live Lessons — Status Log

## 2026-09-23 — Task 00: Audit & Plan (research only)

**Shipped:** Documentation only. Artifacts in `.opencode/pipeline/lessons-00-audit/`:
- `research.md` — evidence audit (rule-2 stats reuse, renderer/SPR grading, schema, answer leaks, attempt gaps, auth, WS, Desmos, filters, migrations, local prerequisites, Playwright skill, test sign-in options, 12 brief/code conflicts).
- `PLAN.md` at `docs/lessons/PLAN.md` — ordered task boundaries, G1–G6 user gates, security boundary decision, local-only auth design, realtime/persistence/grading decisions, browser verification contract.
- `spec.md` — task spec with scope, non-goals, validation, review focus.
- `state.md` — stage tracking.
- `review.md` — Reviewer PASS, no findings.
- `handoff.md` — this handoff summary.

**Evidence:**
- Existing `npm test` (43 unit tests): 43 passed, 0 failed. Independently re-verified by Reviewer.
- No lesson unit tests, no browser/E2E tests, no local DO execution, no production validation.
- Windows `git.exe` baseline showed untracked `.omp/`, `.serena/`, `docs/roadto1600-lessons-prompt.md`; `docs/lessons/` created by this task — all preserved.

**E2E:** Not applicable. Task 00 has no E2E checkpoints per BRIEF.md §12.5. No browser tests run or claimed.

**Review:** PASS (Reviewer session `ses_f2ef5252bffeDGS3IrB3SWsSXs`). No blocking findings. Disposition: USER-DECISION GATE before implementation.

**Deviations from BRIEF.md:**
1. Pipeline artifacts use `.opencode/pipeline/` (workspace instruction), not `.omp/pipeline/`.
2. Research-only stages: no Developer feature work, no Test Developer E2E for task 00.
3. Future proposed exceptions (G1–G6, task order seams, Slow3G target, leak matcher) are explicit gates — not approved, not silently accepted.

**User Approval — 2026-09-23:** PLAN.md APPROVED in full. All gates G1–G6 resolved:
- G1: Option A (narrowed lesson-channel guarantee; practice bank unchanged)
- G2: Freeze UI at endsAt, reveal after endsAt+750ms
- G3: Blank scorable = picked=null, correct=0, zero changes; prospective answer_history_json
- G4: Task01 empty Lessons→task09, session/code in task02, answering+outage fixture in task03
- G5: Previous accepted time-flush/visit boundary and authoritative deadline, replay-safe
- G6: Set completion→review; code valid review-only; ended unlocks history/notes; zero-assignment excluded from score/polls eligible

Additional approved: local-only test auth (Option B), shared stats extraction, schema additions, exact-value SPR grouping, reject duplicate template QIDs, .opencode/pipeline path, commit policy (one local commit per task STOP, no push/deploy).

**BRIEF.md Amendments:** Added Amendments section documenting all G1–G6 overrides and additional approvals.

**Next:** Ready for task 00b (e2e harness). Commit pending user authorization. Do not start implementation without commit authorization.

**Correcting event — 2026-09-24:** Task00 commit made: `fb727eea` ("docs: approve live lessons audit and amended plan"). Prior STATUS entry said "commit pending"; this event records the actual commit hash. No history rewritten.

---

## 2026-09-24 — Task 00b: E2E Harness (Reviewer PASS)

**Shipped:** Local e2e harness complete, uncommitted, awaiting user acceptance/commit. Artifacts in `.opencode/pipeline/lessons-00b-e2e-harness/`:
- `spec.md`, `research.md`, `developer.md`, `repair1.md`, `environment-repair.md`, `failure-c2.md`, `failure-research.md`, `e2e.md`, `review.md`, `state.md`, `handoff.md`
- `src/index.e2e.js`, `wrangler.e2e.toml`, `wrangler.e2e-production.toml`, `playwright.config.js`
- `tools/e2e_server.cjs`, `tools/e2e_seed.cjs`, `tools/e2e_core.sql`, `tools/e2e_ai.sql`, `tools/e2e_smoke.cjs`
- `tests/test_e2e_auth.cjs`, `tests/e2e/lessons-00b-e2e-harness/` (specs + helpers)
- CLI screenshots: `e2e/C1-admin.png`, `e2e/C2-student-MC.png`, `e2e/C2-student-SPR.png`, `e2e/CLI-C1-admin-1366x768.png`, `e2e/CLI-C2-student-bank-1366x768.png`, `e2e/CLI-C2-student-MC-1366x768.png`, `e2e/CLI-C2-student-SPR-1366x768.png`

**Evidence:**
- `rtk npm test`: 46/46 pass (unit suite, up from 43 baseline).
- `rtk npm run test:e2e -- tests/e2e/lessons-00b-e2e-harness`: 6/6 pass (final, task suite).
- `rtk npm run test:e2e` (full suite): 6/6 pass.
- HTTPS browser probe (`repair1-probe.cjs`): cookie/login/app/both-bank PASS; Chromium 153.0.8010.12.
- Chromium launch probe (`chromium-probe.cjs`): PASS; version 153.0.8010.12.
- `rtk node tools/e2e_smoke.cjs`: enabled 200, unset 404/token 401, production-entry flag 404.
- Independent Reviewer: PASS (session `ses_f2c966257ffe80iSj8JTLx6fb2`), full6/6 once. Unit46/46 earlier (reviewer+developer), not claimed as final rerun.

**E2E:** All 00b checkpoints pass (C1–C4). 3/5 app/review repair rounds: (1) HTTPS cookie contract, (2) actual WS coverage via real loopback `ws@8.21.0` fixture replacing manual EventEmitter injection, (3) C2 boot synchronization via condition wait. Bounded retry rule: same signature stops; correction required before rerun.

**Review:** PASS. No blocking findings.

**Deviations from BRIEF.md:**
1. HTTPS local servers (not HTTP) required for Secure cookies on loopback — added `--local-protocol https`.
2. WS fixture uses transitive `ws@8.21.0` Miniflare dep; not independently pinned.
3. No real lesson WS/decodedHTML/clientstate secrecy guarantees; those belong future tasks (04/07+).
4. No roles feature; admin is seeded identity label only (task01 adds roles).
5. Environment repair: timed-out `playwright install-deps` attempt recorded honestly; actual success was user-installed WSL deps verified by probe.

**Limits:** Transitive WS dependency caveat; no real lesson WS/decodedHTML/clientstate secrecy guarantees yet; no roles feature (admin seeded identity only). E2E sessions live only in Worker memory (reload loses them). Seeded bank is 4 rows, not full recovered bank.

**Commit:** Awaiting explicit user acceptance. No push/deploy. Task01 not started.

---

## 2026-09-24 — Task 01: Admin Dashboard (Reviewer PASS)

**Shipped:** Admin dashboard implementation complete, uncommitted, awaiting user acceptance/commit. Artifacts in `.opencode/pipeline/lessons-01-admin-dashboard/`:
- `spec.md`, `research.md`, `developer.md`, `e2e.md`, `review.md`, `state.md`, `handoff.md`
- `migrations/0007_admin_history.sql`, `public/admin.html`, `public/admin.js`, `public/shared/stats.js`, `public/shared/renderer.js`
- `tests/test_admin.cjs`, `tests/test_auth_routing.cjs`, `tests/test_sync.cjs`
- `public/admin.js` (new), `public/shared/` module pair
- CLI screenshots: `e2e/CLI-C4-MC-graded.png`, `e2e/CLI-C4-SPR-graded-round1.png`, `e2e/CLI-round2-admin-MC.png`, `e2e/CLI-round2-admin-SPR.png`, `e2e/CLI-round2-Browse-MC.png`, `e2e/CLI-round2-Browse-SPR.png`, `e2e/CLI-C1-list.png`, `e2e/CLI-C2-overview.png`, `e2e/CLI-C2-MC.png`, `e2e/CLI-C2-SPR.png`

**Evidence:**
- Developer `rtk npm test`: 51/51 passed, 0 failed.
- Focused `rtk node --test tests/test_admin.cjs tests/test_auth_routing.cjs tests/test_grade.cjs tests/test_metrics.cjs tests/test_focus.cjs tests/test_sync.cjs`: 43/43 passed.
- `rtk node --check src/index.js public/admin.js public/shared/stats.js public/shared/renderer.js`: passed.
- `rtk git.exe diff --check`: passed (Windows Git future-CRLF warnings only).
- Reviewer `rtk npm test`: 51/51 passed, 0 failed (actual diff verified).
- Test Developer focused 4/4, full suite 10/10, CLI screenshots 2/5 repairs.
- Final Reviewer ses_f2a7ee742ffesKhWUV4Bi4PbNU: PASS, actual diff inspected, prior findings independently resolved, unit 51/51 rerun, no blockers.

**E2E:** 4 task01 specs passed, 0 failed. Full suite 10/10 (six task00b + four task01). No skips/only/fixme, no fixed readiness sleeps or inflated timeouts. CLI browser captures at 1366×768 confirmed admin list, detail tabs, route gates, and practice MC/SPR history capture.

**Scope delivered:** Roles (migration 0007, role session-sync via ADMIN_EMAILS, demotion-next-session limitation), admin all tabs (Students list with search/sort/pagination, Overview/By skill/Mistakes/Traps/Pacing/Second-guessing/History/Lessons), shared stats module (`public/shared/stats.js`), shared renderer (`public/shared/renderer.js`), prospective answer history capture and validation, read-only admin API with full route gating (401/403/404/503 matrix).

**Review:** PASS (Reviewer session `ses_f2a7ee742ffesKhWUV4Bi4PbNU`). Repair count 2/5. Prior review retry tooling issues documented honestly: ses_f2a820929ffez7CY8geLgsfHKO returned unusable ELL; ses_f2a807da1ffeNpFchmk5z61hPT blocked on CRLF tooling — neither treated as PASS. Final Reviewer completed substantive independent review. No source changes during review retries.

**Deviations from BRIEF.md:**
1. G4: Lessons tab honestly unavailable until task09 (approved checkpoint exception).
2. Production `ADMIN_EMAILS` blank in `wrangler.toml`; no admin promotion possible without configuration.
3. 0007 migration not applied to any production database; required before future deploy needing role data.
4. Role demotion is next-session, not instant (documented limitation).
5. Roster returns 413 above 500 matching members (documented ceiling, SQL aggregation needed if exceeded).
6. Local-only test auth continues from task00b; no production auth changes.
7. Serena `initial_instructions` unavailable to parent session; no claim loaded.

**Limits:** Production ADMIN_EMAILS blank/configure and 0007 migration required before any future deploy that needs role data. Local seed only; no deployment now. Role demotion next-session limitation. Roster 500 limit. Legacy unknown direction for pre-task01 attempts. Official trap metadata sparse. Mojibake normalization unit-proven but no dedicated browser fixture. Local TLS probe noise noted; no production/CDN behavior claimed.

**Commit:** Awaiting explicit user acceptance. No push/deploy. Task02 blocked until task01 user acceptance and commit. No commit/push/deploy/remote data mutation.

**Correcting event — 2026-09-24:** Task00b handoff corrected directly by parent (commit 00cebf32). Task01 remains uncommitted per user STOP instruction. Fresh agent every delegation; no task_id resume.

**Correcting event — 2026-09-24 (task01 acceptance):** User approved task01 and authorized its local commit. Actual commits: `137c29f1` (task00b handoff correction), `c98300e2` (`feat: admin roles, dashboard, shared stats` — task01 source/tests/docs, 31 files), `a3911a90` (task01 handoff/state marked committed). No push, no deploy, no remote mutation. Task02 (builder) NOT started — user explicitly declined to begin it in this session. Screenshots under `.opencode/pipeline/*/e2e/` remain gitignored/local. Entries above describing task00b/task01 as uncommitted are historical as of their writing and superseded by this event.

---

## 2026-09-24 — Task 02: Lesson Templates & Builder (Reviewer PASS, committed)

**Shipped:** Admin-only lesson templates (§4): filter/add/reorder/remove, per-question time + notes, autosave, library, frozen session row + join code. Artifacts in `.opencode/pipeline/lessons-02-builder/`:
- `research.md`, `spec.md`, `state.md`, `e2e.md`
- `migrations/0008_lessons.sql`, `schema.sql` snapshot update
- `public/admin.html`, `public/admin.js` (builder UI + helpers), `src/index.js` (admin lesson routes)
- `tests/test_lessons_builder.cjs`, `tests/e2e/lessons-02-builder/builder.spec.js`
- `tools/e2e_core.sql`, `tools/e2e_seed.cjs` (0008 upgrade + builder seed)
- Screenshots: `.opencode/pipeline/lessons-02-builder/e2e/01..07-*.png` (gitignored/local)

**Evidence:**
- `rtk npm test`: 55/55 pass (includes 4 new lessons tests: dual-path migration, role/400/404/503 matrix, frozen snapshot, collision retry, oldest-first usage).
- `rtk npm run test:e2e`: 11/11 pass at 1366×768 (one pre-existing `DOM_ORDER` import bug found and fixed in `public/admin.js` during E2E; C2 repro then pass).
- `rtk node --check src/index.js public/admin.js` and `rtk git.exe diff --check`: pass (LF warnings only).
- Independent deep Reviewer: PASS, no blockers.

**E2E:** Task02 builder spec covers the full §12.5 checkpoint list: domain+skill filters, add, drag reorder, remove/re-add, custom times with live total, notes with math + escaped script preview, save/reload persistence, used-question badge + "Hide all lesson questions", Save & start session join code + lobby session. Screenshots 01–07 recorded in `e2e.md`.

**Review:** PASS. Non-blocking findings recorded in `state.md`: snapshot DDL plain `CREATE TABLE` (not `IF NOT EXISTS`), seed completeness checks 4 of 8 tables, four inert future-session tables in 0008 (no task02 consumers), default times 60/90 explicit per spec (not `TARGET_MS`), session create does not write `question_lesson_usage` (future task).

**Scope delivered:** migration 0008 (lessons, lesson_questions, lesson_sessions with partial-unique join code, question_lesson_usage + future inert tables), admin API (questions filter/pagination with `usedInLesson`, lesson CRUD transactional replace, duplicate, session create with frozen `snapshot_json`, past sessions), builder UI (three columns, DnD + keyboard reorder, time chips/custom mm:ss, escaped bounded markdown + KaTeX notes preview, debounced autosave, library grid), `padSessionId` helper.

**Deviations from spec/BRIEF:**
1. `defaultTime` uses explicit 60/90 seconds per spec's stated defaults, not `TARGET_MS` (95/71) — spec wording conflict resolved in favor of explicit values; unit + E2E assert 60/90.
2. Pre-existing full-suite failure (`DOM_ORDER` missing import in `public/admin.js`) fixed as part of task02 E2E validation; one-line import only.

**Limits:** Local E2E only; no production D1 migration applied; no DO/WS/student lesson UI; join codes unique only among non-ended sessions; `usedInLesson` badges depend on seed/task03 usage writers.

**Commit:** User approved task02 STOP. Local commit `b5dd02fd` (`feat: admin lesson templates and builder`, 13 files, 772 insertions). No push, no deploy, no remote mutation. Task03 not started.

**Correcting event — 2026-09-24 (task02 acceptance):** User approved task02 and authorized its local commit. Actual commit: `b5dd02fd`. Baseline untracked files (`.omp/`, `.serena/`, `docs/roadto1600-lessons-prompt.md`, root junk) preserved untouched. This entry supersedes the pre-approval "commit pending" language in `state.md`.

---

## 2026-09-25 — Task 03: Realtime Core (Reviewer PASS, uncommitted)

**Shipped:** Local instructor-paced lobby and minimal answering lifecycle with SQLite-backed `LessonRoom` Durable Object, WebSocket hibernation, server deadlines/750ms grace, durable snapshots/alarms, authenticated join and role-safe student payloads. Production and both local E2E Wrangler configs bind room; E2E entry re-exports class. Student Join lesson modal, instructor live lobby, selection/lock, reconnect, one-student-socket replacement and joining lock. Full instructor presentation/distribution remains task04.

**Evidence:** `rtk npm test` 64/64; focused task03 browser spec 1/1; full `rtk npm run test:e2e` 12/12. All six task03 browser checkpoints passed at 1366×768, including physical WebSocket closure plus measured 20-second offline recovery. Screenshots and per-checkpoint assertions: `.opencode/pipeline/lessons-03-realtime-core/e2e.md`. Independent scoped deep Reviewer: PASS, no blockers. Earlier app repairs: membership scope caused room GET 503; admin WS missing client parameter caused reconnect; second-tab explicit join failed ownership transfer. Browser spec fixed upstream hook order. All rerun to green.

**Limits:** Local seed/browser only; no production/real Chromebook validation. Practice bank remains answer-bearing per approved G1-A exception; lesson channels project role/phase-safe fields. Task04 instructor-paced full reveal/distribution UX not started. No commit, push, deploy, or remote data mutation. Handoff: `.opencode/pipeline/lessons-03-realtime-core/handoff.md`.

**Next:** Fresh top-level session for task04, per task session boundary. Task04 ends at user Chromebook STOP.

---

## 2026-09-25 — Task 04: Instructor-Paced Lesson (Reviewer PASS, uncommitted)

**Shipped:** Full instructor-paced lesson implementation (BRIEF §6). Artifacts in `.opencode/pipeline/lessons-04-instructor-paced/`:
- `spec.md`, `research.md`, `e2e.md`, `state.md`, `handoff.md`
- Student live player (`public/index.html:3688+`), instructor view (`public/admin.js:104+`)
- Phase-secrecy guarantees, exact-value SPR grouping, distribution/chart features
- Nine checkpoint screenshots in `e2e/` (gitignored, local only)
- `tests/e2e/lessons-04-instructor-paced/paced.spec.js` — permanent focused E2E spec

**Evidence:**
- `rtk npm test` — PASS 69/69 unit tests (Reviewer independently ran 69/69).
- `rtk npx playwright test tests/e2e/lessons-04-instructor-paced/paced.spec.js --workers=1` — PASS 1/1 focused E2E (~20.8s).
- `rtk npm run test:e2e` — PASS 13/13 full suite (repeated after screenshot-path edit: PASS 13/13, 1.4m).
- `rtk git.exe diff --check && rtk proxy node --check tests/e2e/lessons-03-realtime-core/realtime.spec.js` — PASS.
- `rtk npm run e2e:seed` — PASS; isolated local DB, ports free before seeding.
- Independent Reviewer: deep PASS, no blockers. All 9 BRIEF §12.5 task04 checkpoints verified.

**E2E:** 1/1 focused, 13/13 full. All task04 checkpoints pass: response panel ○/◐/● live; early-submit modal Go back keeps editing and Yes locks/hides correctness; at 0 unsubmitted selection finalizes; reveal colors correct; distribution counts match and clicked bar lists names; Show class results toggles student chart; +15s and End now work; SPR responses group by normalized value; no pre-reveal answer/explanation/notes and no notes any phase. App repair: modal stacking in `public/index.html`. Test repair: task03 `Connected` indicator updated to require visible `#lesson-connection` with `● Connected`.

**Review:** PASS. Non-blocking findings recorded: ephemeral 250ms debounce (within spec), SPR input narrower than parser (cosmetic, no grading impact), color E2E gap (visual screenshot only, no programmatic color assertion).

**Deviations from spec/BRIEF:**
1. SPR distribution groups exact deterministic numeric values (1/2=.5); rounded-but-grader-accepted distinct inputs kept separate per approved spec wording.
2. Task03 `Connected` exact-text test repaired to match `● Connected` indicator (text plus visual dot), not weaker substring.
3. Modal stacking fix in `public/index.html` — app repair discovered during task04 E2E, not a spec deviation.

**Limits:** Local E2E only; no production/real Chromebook validation. Practice-bank G1-A exception: `/api/questions` answer exposure remains approved exception; lesson-channel secrecy assertions limited to lesson channels only. Local self-signed TLS generates noisy `SSLV3_ALERT_CERTIFICATE_UNKNOWN` workerd log lines during teardown; test results pass. No production D1 migration applied. Screenshots gitignored, local only.

**User Approval — 2026-09-25:** Task04 Reviewer PASS confirmed. No commit/push/deploy performed. User STOP remains: real Chromebook test required before any further action. No task05 (annotations), task06 (Desmos), task07 (self-paced), or task09 (history) started. No commit, push, deploy, or remote data mutation without explicit user authorization.

**Next:** User real Chromebook test. STOP for any further task/production action until Chromebook validation completes.(End of file)

**Correcting event — 2026-09-25 (task04 release authorization):** User explicitly authorized local commit and production deploy of task04, plus `chakrabortyleon@gmail.com` admin access, so earlier no-commit/no-deploy STOP no longer blocks this release. Real Chromebook testing remains pending. Production D1 migration state and Cloudflare authentication must be verified before deployment; no claim of deployed or signed-in access until checked.

---

## 2026-09-25 — Task 05: Annotations (Reviewer PASS, uncommitted)

**Shipped:** Shared instructor annotations with user-requested strikethrough (BRIEF §7.1). Artifacts in `.opencode/pipeline/lessons-05-annotations/`:
- `spec.md`, `research.md`, `developer.md`, `e2e.md`, `state.md`, `handoff.md`
- `public/shared/annotations.js` (new — shared text/ink helpers), `public/shared/lesson.js` (annotate/laser protocol)
- `src/lesson-room.js` (LessonRoom DO annotation ops, boundary flush, snapshot projection)
- `public/admin.js` (REVEALED toolbar: pen/highlight/strikethrough/erase/clear/laser)
- `public/index.html` (student shared layer, Follow me, private highlighter)
- `src/index.js` (static allowlist repair for `/shared/annotations.js`)
- `tests/test_lesson_room.cjs` (15 unit tests), `tests/e2e/lessons-05-annotations/annotations.spec.js`
- `tools/e2e_core.sql` (long local passage seed), 12 E2E screenshots

**Evidence:**
- `rtk node --test tests/test_lesson_room.cjs` — PASS 15/15 (Developer + Reviewer independently).
- `rtk npm test` — PASS 72/72 (Developer + Reviewer independently).
- `rtk npx playwright test tests/e2e/lessons-05-annotations/annotations.spec.js --workers=1` — PASS 1/1 focused E2E.
- `rtk npm run test:e2e` — PASS 14/14 full suite.
- Independent deep Reviewer: PASS, no blockers. All 7 BRIEF §12.5 task05 checkpoints verified.

**E2E:** 1/1 focused, 14/14 full suite. All checkpoints pass: cross-viewport highlight equality (1920×1080 instructor → 1366×768 / 110% zoom students), strikethrough live reception, pen/laser liveness, Follow me scroll, reconnect annotation persistence, student write denial, targeted erase and clear-all. App repair: `/shared/annotations.js` static allowlist 404 (task04 spec regression) fixed in `src/index.js`. Test repairs in spec only (sort order, reconnect join).

**Review:** PASS. Non-blocking caveats: server anchor bounds permissive HTML-length vs decoded text (client validates; no observed break); choice anchor `c:[A-D]` SAT-shaped (4-choice only); laser throttle shared across admin tabs. Local-only E2E; no deployed/physical-device test; no commit/push/deploy/remote writes.

**Deviations from spec/BRIEF:** None. Strikethrough was user-requested addition explicitly allowed by task gate.

**Limits:** Local-only browser validation; no production/real-device claim. Practice-bank G1-A exception continues. No production D1 migration applied. Screenshots gitignored, local only.

**Commit authorization — 2026-09-25:** User authorized local commit of task05. No push/deploy or remote data mutation authorized. STOP remains for user validation before task06.

**Next:** User validation on real Chromebook. Task06 (Desmos) not started until user clears task05 STOP.

---

## 2026-09-26 — Task 06: Desmos sync (Claude Code pipeline; review PASS)

**Shipped (BRIEF §7.2):** Instructor Desmos API panel in the live view (math questions). Changes are throttled to 150 ms, de-duplicated, and sent only after the reveal. The LessonRoom DO stores the latest state per question under its own key, relays it to other sockets, drops unchanged states, and writes `session_question_review.desmos_state_json` only at `next`/`endSession`. Students get a read-only, scrollable follower panel that opens on the first instructor state, plus **Try it yourself** / **Back to instructor view**. The API is preloaded in the lobby only for lessons with math. Artifacts: `.omp/pipeline/lessons-06-desmos/` (spec, research, e2e, review, handoff, state). Previous tasks' artifacts remain in `.opencode/pipeline/`.

**E2E:** task 2/2; full suite 21/21. Unit 79/79.

**Measured:** Desmos edit → student render under Slow 3G, 5 samples per run: 243–297 ms isolated (one outlier 384 ms); 265–437 ms during full-suite load. Target ≤ 500 ms met on every sample. Measured through a Slow 3G-shaped TCP relay (ping RTT ≈ 405 ms), because CDP emulation does not delay WebSocket frames in Chromium (37 ms RTT). Desmos API download: 1,050,346 bytes gzipped.

**Deviations:** (1) relay instead of CDP for Slow 3G; (2) `/app` and `/admin` CSP adds `'unsafe-eval'`, `https://www.desmos.com` and `worker-src blob:` (the Desmos API evals its module source and starts a blob worker); `_headers` and all other responses stay strict; (3) the follower is read-only through an input guard rather than `inert`, so it can scroll; (4) BRIEF.md replaced verbatim by the tasks 06–10 brief; the approved G1–G6 amendments moved to `docs/lessons/AMENDMENTS.md` and still apply.

**Manual checks:** Desmos sync on a real Chromebook; set the `DESMOS_API_KEY` secret before deploy (demo key is local-only); approve the CSP scope.

**Known pre-existing issue:** `LessonRoom.webSocketClose` throws on close code 1006 (logged only).

---

## 2026-09-26 — Task 07: Self-paced lessons (Claude Code pipeline; review PASS)

**Shipped (BRIEF §8.1–8.5):**
- **Shared clock:** Σ question times. Students move freely with Back/Next, a navigator and ⚑ flags, then use a review page and **Submit all** (with the brief's confirmation modal).
- **Completion:** auto-submit at the shared end (after the 750 ms grace). The set also ends early when every joined student has submitted, or on **End session**. Completion writes every assigned response to D1 once and sets `status=review` (G6); a second **End session** ends the session.
- **Late joiners:** they get a subset fitted once to the time left, hardest first, stored in `session_participants`. It is never recomputed.
- **Time on question:** the sum of visits, bounded by server time and replay-safe (G5).
- **Instructor view:** a graded student × question grid (■ □ ◆ · ░) and per-question cards (answered x/assigned, accuracy, avg time, distribution with names · time).
- **Secrecy:** students see no correctness, explanation or notes in this task.

**E2E:** task 2/2; full suite 23/23 (twice). Unit 85/85, including the exact §8.2 and §8.5 cases.

**Measured:** 25 students × 20 questions → student full snapshot 21.7 KB (once per join/connect/start), student ack 582 B, instructor refresh 23.1 KB (≤ 4/s; 56.5 KB before review fix B6).

**Deviations:**
1. End session finishes the set first, then ends the session (G6).
2. A time delta above server-elapsed time is cut to the elapsed time rather than dropped whole.
3. Flags are kept on the student's page only.
4. Instructor-paced time accounting is unchanged (single server-measured segment).

**Manual checks:** self-paced run on real Chromebooks; a late joiner's set and ░ in the grid; accumulated time after revisiting a question.

---

## 2026-09-26 — Task 08: Review polls (Claude Code pipeline; review PASS)

**Shipped (BRIEF §8.6–8.7):**
- **Post-set overview:**
  - class summary (average, median, completed);
  - sortable student table with per-question answers;
  - most-missed ranked with assigned-only denominators (`Qn — w of a wrong (p%) · skill · difficulty`) that opens the question card.
- **Launcher:** Start review poll, Review a specific question, End session.
- **Review polls:** 30 s. Most-missed vs. a question the student picks (✓ / ✗ / "not in your set"); option 2 needs a pick. The poll closes early when every connected student has voted, including when the last non-voter disconnects. Option 2 must win outright; picks tie by more wrong, then lesson order.
- **After the vote:** the result shows for 3 s, then everyone moves to review mode, which is the instructor-paced REVEALED screen with the student's own answer or "Not in your set", annotations and Desmos, and no clock or notes.
- **Next** returns to the launcher, and reviewed questions leave later polls.
- **Reviews change no data:** votes stay in the Durable Object.

**E2E:** task 1/1; full suite 24/24 (twice). Unit 90/90.

**Measured:** 25 students × 20 questions: student poll 2.6 KB, student review 3.2 KB, instructor overview refresh 39.0 KB.

**Deviations:**
1. `poll`/`pollResult` ride in snapshots.
2. "Completed" = answered every assigned question.
3. "End the review" = End session.
4. Polls and review use lesson numbering.
5. Instructor-paced students' self-only actions are now rejected instead of locking.

**Manual checks:** poll + review flow in class conditions on real Chromebooks.

---

## 2026-09-26 — Task 09: History and stats (Claude Code pipeline; review PASS)

**Shipped (BRIEF §9, §10; §2 usedInLesson; §3.2 Lessons tab, deferred here by G4):**
- **Self-paced write-back:**
  - Set completion writes one attempt per assigned scorable question, tagged `lesson_session_id`, with time, changes and answer history, in the same batch as the responses.
  - Progress moves through the practice marker rule, shared now between the SPA and the room. Blanks are Red (G3).
  - Unscorable and unassigned questions write nothing.
  - Exactly once: migration 0010 adds a unique index, and progress is guarded against replays.
- **Instructor-paced lessons** write no attempts and no progress.
- **Usage:** the final end records `question_lesson_usage` for the questions shown. `/api/questions` carries `usedInLesson`.
- **Bank filter:** **Lesson questions** (Show all / Hide questions from lessons I attended / Hide all lesson questions). The same logic serves the builder, where the middle option reads "lessons I ran". Usage badges appear in Browse and on Mistakes.
- **My Lessons:** a list of session, title, date, mode and score. It opens a read-only history with the answer, the correct answer, the explanation, the notes as **Breakdown**, the saved highlights and the final Desmos graph. It is available only after the session ends.
- **Tags and admin:** mistakes show "Lesson 00003", in both the student and admin views. The admin Lessons tab lists sessions with score and "counts toward stats".

**E2E:** task 1/1; full suite 25/25 (three green runs). Unit 97/97.

**Deviations:**
1. Write-back at set completion (G6).
2. History uses `/api/lesson-history` and shows the current bank question body.
3. Builder "Hide questions from lessons I ran".
4. E2E self-paced specs use a new local account, student 6, so student 1's pinned stats stay fixed; the bank fixture has 7 questions.

**Manual checks:**
- spot-check stats and the mistake log after a real self-paced lesson, and that an instructor-paced lesson changes nothing;
- My Lessons on a Chromebook;
- apply migration 0010 before deploying.

---

## 2026-09-27 — Task 10: E2E regression and screenshot tour (Claude Code pipeline; review PASS)

**Shipped:**
- **Screenshot tour:** both modes, run as in class. 29 compressed PNGs are in `docs/lessons/tour/`, with an index in its README.
  - Students at 1366×768; the instructor at 1920×1080.
  - Every student passes the leak check.
- **New end-to-end checks for §13 gaps:**
  - a raw answer change after `endsAt + 750 ms` is refused and the answer is unchanged;
  - 20 s outages keep the self-paced assigned set, and keep annotations made while the student was offline;
  - reusing a lesson gets a new session, code and ID, and leaves the first run's results unchanged.
- **Fix:** below a long passage on a Chromebook, three things were off screen:
  - the "Answer locked in" notice and the reveal verdict, under the footer;
  - the class results chart, below the window.

  They now scroll into view when they appear.

**E2E:** task 6/6; full suite **31/31**, twice in a row. Unit 97/97. Desmos under Slow 3G: 253–295 ms, against a 500 ms target.

**§13:** each acceptance check maps to a passing unit or e2e test (`.omp/pipeline/lessons-10-e2e-regression/e2e.md`).

**Deviations:**
1. Instructor tour shots are at 1920×1080.
2. The self-paced tour uses students 2–4.
3. The tour tool uses the `sharp` that wrangler installs.

**Manual checks:**
- look through the screenshot tour;
- on a Chromebook, lock and reveal on a long passage;
- on a 1366-wide instructor screen, typing in Desmos scrolls the short question out of the card (not seen at 1080p).

## 2026-09-28 — Task 11a: Live Lessons bug fixes (Tier 2)

**Shipped:**
- **A1** The instructor's choice eliminations (⊖ / ABC) now reach every student. They also appear:
  - on reconnect;
  - in self-paced review mode;
  - in My Lessons.

  Students' own cross-outs stay private. One gate for lessons-11d: `Room.sharedEliminations`, sent only by `broadcastEliminations` as the `eliminations` message.
- **A2** Strikethrough shows its own cursor, not the highlighter's.
- **A3** The laser landed on a word the pointer had only passed over. The room's 25 ms floor dropped the resting frame when Wi-Fi delivered frames in bursts; it now holds and sends it.
- **A4** Builder filter panels:
  - the checkbox sits at the left with its label wrapping beside it;
  - no clipped labels and no sideways scroll;
  - each panel is at least as wide as its trigger.
- **A5** End session sends every student to /app, including students who are offline or reconnecting. Answers are saved as before.

**E2E:** new spec 7/7, each failing with its fix reverted. Full suite **40/40**. Unit 144/144, typecheck clean. Screenshots are in `docs/lessons/11a/`.

**Deviations:**
1. The brief's A3 fix text was a placeholder, so the fix is my own diagnosis.
2. Eliminations sync in every phase until 11d gates them.
3. Two seeded questions (`e2e-unused`, `e2e-used-other`) became a passage question and a figure question. Their IDs are unchanged.
4. Specs 07, 08 and 09 now expect release to /app instead of "Session ended.".

---

## 2026-09-28 — Task 11b: Instructor screen cleanup and question navigator (Claude Code, Tier 3)

**Shipped:**
- **Fixed split:** both views use a 50/50 split, Bluebook's default. The pane divider and its three controls are gone.
- **Instructor layout:** the question fills the screen above a bottom bar.
  - The header row, question rail, meta strip and Responses panel are gone.
  - Each pane has the student view's inset, at least 24 px.
  - The sidebar collapses when the session starts and can be expanded again.
  - The join code sits in a black box in the top-right corner and covers no control.
  - Desmos is in the annotation toolbar.
  - The instructor's own choices mark the correct answer in every phase. Students still never get it before the reveal.
- **Bottom bar:** the navigator, the timer with +15 s and End now, "n of N responses", Notes, the connection, and End session.
  - The **Responses popup** holds everything the old panel did and updates live.
  - **Notes** is a drawer from the right.
- **Question navigator:**
  - ‹ and › move between questions. On the furthest question, › is Next.
  - "Question n of N" opens a drawer with each question's number, snippet, ID and response count.
  - Only played questions and the next unplayed one can be opened.
- **Revisits:** everyone sees the question revealed, with their own answer, the annotations and the Desmos graph.
  - Nothing reopens and no clock runs.
  - The state model for 11d is in the handoff (`reached`, `played`, `revisit`).

**E2E:** new `tests/e2e/lessons-11b.spec.js` (4 tests); full suite **37/37**, twice in a row. Unit 145/145. Typecheck clean.

**Deviations:**
1. No navigation while a question is open for answers.
2. Revisits show no clock.
3. Annotation tools show disabled before the reveal.
4. The self-paced grid, poll and overview screens are unchanged.
5. Spec 04 was rewritten for the popup.
6. New seed question `e2e-split-rw`; the bank is now 8 questions.

**Manual checks:**
- Run a lesson on the 1080p laptop and on a 1366-wide screen: go back and forward, and check the join code box, popup and drawers.
- Check the split on a Chromebook.

---

## 2026-09-28 — Task 11c: Student Desmos calculator + Try it yourself (Claude Code; single session)

**Shipped:**
- **C1:** a **Calculator** button in the student header, on math questions only, in both modes. It opens the student's own Desmos graphing calculator in a floating window:
  - drag it by the title bar and resize it from the corner, always inside the viewport;
  - while it is open, the question shifts right by the window's default footprint, so it isn't covered;
  - the state is kept for the whole session: across questions, polls and review, and when closed and reopened. It is memory-only;
  - nothing from the calculator is ever sent.

  Self-paced student snapshots now carry `hasMath` and the public `desmosKey`.
- **C2:** **Try it yourself** copies the instructor's current graph (expressions + viewport) into the student's calculator and opens it.
  - An empty calculator is replaced without asking.
  - A non-empty one asks "This will delete everything in your calculator and replace it with your instructor's graph." [Cancel] [Replace].
  - The instructor panel stays read-only and keeps syncing. The old fork and **Back to instructor view** are removed.

**E2E:** new `tests/e2e/lessons-11c.spec.js` 2/2. Spec 06 was rewritten for the new flow. Full suite **35/35** on two consecutive runs of the final code. Unit 144/144; typecheck clean. Desmos under Slow 3G: 264–401 ms (target 500).

**Deviations:**
1. The layout shift is fixed to the default window footprint.
2. "Empty" ignores viewport-only changes.
3. The calculator state lasts for one lesson view (not Leave/rejoin or reload), so shared Chromebooks don't carry it between students.
4. One session, no subagent pipeline.

**Manual checks:** the calculator and Try it yourself on a real Chromebook; both calculator panels open together at 1366×768.
