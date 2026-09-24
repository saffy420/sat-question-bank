# lessons-00-audit spec

## Goal
Research brief, produce evidence-based `docs/lessons/PLAN.md`, obtain independent review, then STOP for user approval. No feature implementation.

## Context
Source `docs/lessons/BRIEF.md`; evidence `research.md` in this directory, especially corrections A0–A6. Workspace requires `.opencode/pipeline/`, overriding brief `.omp/`. User requested Researcher explicitly; successful researcher session `ses_f2f08f103ffeDhWKNXse0ge2lP` produced report and addendum.

## Requirements
- Preserve brief as supplied.
- Audit all task00 §12.5 topics against actual code and current library docs, distinguish facts/proposals.
- Explain stats capture gaps, auth/test seam, schema/migration order, renderer/grading reuse, leakage and local prerequisites.
- Plan must not promise secrecy while unrestricted bank answers remain accessible, nor hide violations with narrowed test matchers without approval.
- Raise required user gates, preserve all [DEFAULT] choices and future STOPs.
- Plan future Developer → separate Test Developer → Reviewer flow, ownership boundaries, full-suite reruns and five-round ceiling.
- Document tests actually run, no invented E2E evidence.

## Non-goals
No app/test/config edits, dependency installation, DB mutation, E2E scaffolding, production access, deployment or commit. Task00 has no E2E checkpoint; implementation/Test Developer stages not applicable to research-only task.

## Implementation steps
1. Researcher investigates and writes research.md (complete).
2. Architect writes PLAN.md, this spec.md and state.md (documentation artifacts only).
3. Independent Reviewer reads actual changed docs, validates claims against source/research; returns PASS/FAIL with blockers. Reviewer writes no files.
4. Architect saves review.md. Blocking documentation corrections route to separate Developer, then re-review (max five rounds). No app/test work authorized.
5. After PASS, Documentation writes handoff.md and dated docs/lessons/STATUS.md entry; stop for approval, no task00b.

## Project gates
PLAN approval and explicit G1 choice; G2–G6 recommendations in plan; any contradiction/new unsupported assertion. BRIEF unchanged; pipeline directory deviation documented. Deployment/data/auth contract changes await later approved specs.

## Validation
Researcher reports existing npm test ran 43/43 passing. Reviewer may independently run existing checks but need not run browser tests with no task00 checkpoint. Inspect Windows git.exe diff/status through rtk; ignore unrelated untracked files, do not use WSL phantom diff as evidence. Research contains corrected overstatements; plan must use latest corrections, not stale earlier paragraphs.

## E2E checkpoints
None listed for task00 in BRIEF §12.5. No skipped checkpoint; no browser pass claimed. Future specs copy exact corresponding checkpoint lists and obtain explicit approval for scope shifts.

## Review focus
Factual traceability, no false confidence on live secret answers, security of proposed local auth and production separation, reuse without duplicated stats, missing metrics and blank convention gates, impossible grace/reveal combination, staged task dependencies, no future feature code, truthful test evidence. Check plan retains Slow3G target and does not silently weaken it. Artifacts required: research.md, spec.md, state.md, review.md, handoff.md.
