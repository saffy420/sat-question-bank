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

(End of file - total ~65+ lines)
