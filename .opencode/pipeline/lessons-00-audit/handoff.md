# Handoff: lessons-00-audit

## Status
**APPROVED** — 2026-09-23 user approval recorded. Ready for task 00b. Commit pending user authorization.

## Goal
Audit the Live Lessons feature brief against actual codebase, produce evidence-based implementation plan (PLAN.md), obtain independent review, and STOP for user approval. No feature code, migrations, test harness, or config changes.

## What changed
- Created `research.md`: full evidence audit covering rule-2 stats reuse map, renderer/SPR grading reuse, question schema, all answer/explanation leak paths, attempt recording gaps (no skip/timeout convention, no source tagging), auth path, WS feasibility, Desmos iframe vs API + CSP, filter/taxonomy, next migration numbers (core 0007), local Worker/D1/DO prerequisites, Playwright/CLI skill location, test sign-in options comparison, and 12 brief/code conflicts.
- Created `spec.md`: task spec documenting scope, non-goals, implementation steps, gates, validation, and review focus.
- Created `PLAN.md` at `docs/lessons/PLAN.md`: ordered task boundaries, security boundary decision G1 (two honest options), local-only test auth design (Option B: separate local entry), realtime/persistence/grading decisions, browser verification contract, external references, and 6 user decision gates (G1–G6).
- Created `state.md`: tracking stage = audit completed / awaiting user approval.
- Created `review.md`: Reviewer PASS, no blocking findings, independently ran `rtk npm test` → 43/43 pass.
- **APPROVED 2026-09-23:** All gates G1–G6 resolved per user instruction: G1-A (narrowed lesson-channel guarantee), G2 (endsAt+750ms grace), G3 (picked=null/correct=0), G4 (task01 empty/task02 code/task03 answering+outage fixture), G5 (previous accepted time-flush/visit boundary and authoritative deadline), G6 (set completion→review/code valid review-only/ended unlocks).
- **BRIEF.md Amendments:** Appended Amendments section documenting all G1–G6 overrides and additional approvals (local-only auth, shared stats extraction, schema additions, exact-value SPR grouping, reject duplicate QIDs, pipeline path, commit policy).
- **STATUS.md updated:** Marked PLAN APPROVED with dated approval record, ready00b, commit pending.

## Decisions
- Pipeline artifacts use `.opencode/pipeline/` (workspace instruction), not brief's `.omp/`.
- Task 00 is research-only: no Developer feature work, no Test Developer E2E, no browser checkpoints.
- G1 (secrecy scope): **User selected Option A** — narrowed lesson-channel guarantee; practice bank access unchanged; lesson HTTP/WS payloads and client state are role/phase-safe; existing practice access and prior disclosures are explicit exceptions.
- G2–G6: **All approved as written** per user instruction.
- Local-only test auth: Option B (separate local entry/config).
- Missing stats conventions (skip/timeout, second-guess direction) are explicit gates, not assumptions.
- All [DEFAULT] items in brief preserved; no future task scope claimed.
- Commit policy: After user approves each task STOP, one local commit for that task. No push/deploy.

## Validation
- Existing unit suite: `rtk npm test` → 43 passed, 0 failed (auth routing, worker SQL, metrics, focus, grade, backfill, notes, sync, tidy_expl, exams).
- No lesson unit tests, no browser/E2E tests, no local DO execution, no production validation.
- Reviewer independently reran `rtk npm test` → 43/43 pass.
- Windows `git.exe` baseline showed untracked `.omp/`, `.serena/`, `docs/roadto1600-lessons-prompt.md`; `docs/lessons/` created by this task — all preserved.

## Review
Reviewer: PASS (no findings). Disposition: USER-DECISION GATE before implementation. Reviewer validated factual traceability, no false confidence on live secret answers, security of proposed auth separation, reuse without duplicated stats, missing metrics gates, impossible grace/reveal combination, staged task dependencies, no future feature code, truthful test evidence. Slow3G target retained unchanged per brief. **All gates RESOLVED per 2026-09-23 user approval.**

## Caveats
- No app, test, or config changes implemented. `npm test` baseline is pre-existing checks only.
- No E2E checkpoints exist for task 00 (brief §12.5 lists none); no browser tests run or claimed.
- Implementation authorized for task 00b; commit pending user authorization.
- Unrelated untracked paths (`.omp/`, `.serena/`, prompt file) preserved.
- No commits, deployments, remote data mutations, or data operations performed.
- **PLAN.md dated approval record and BRIEF.md Amendments section added.** Historical proposed choices preserved but clearly marked G1-A selected and all gates resolved.

## Next session
**Ready00b.** E2E harness task (lessons-00b-e2e-harness) authorized for start upon user commit authorization. Do not start without explicit commit approval. One local commit per task, no push/deploy.
