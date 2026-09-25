Task: lessons-02-builder
Tier: 3
Tier rationale: D1 migrations and session creation alter write-integrity and durable template/history boundaries. Admin-only write routes, frozen run snapshots, and builder filters require focused independent research before implementation.
Session scope: this task only
Stage: implementation + E2E + review complete; task02 STOP awaits user approval BEFORE commit or task03
Developer: prior focused 4/4, full unit 55/55. Fresh repair: reproduced C2 failure (1 failed), added missing DOM_ORDER import, reran C2 (1 passed), full E2E (11 passed), src/index.js + public/admin.js syntax and git diff --check passed. Chromium viewport 1366×768; details and screenshot paths in e2e.md.
Approval: PLAN/BRIEF amendments approved; task01 committed. Task02 STOP approved by user; implementation committed as b5dd02fd ("feat: admin lesson templates and builder"). No push, deploy, remote mutation, or production data use. Task03 not started.

## Validation
- Unit: 55/55 pass.
- E2E: 11/11 pass at 1366×768 Chromium.
- Syntax: `rtk node --check src/index.js && rtk node --check public/admin.js` pass.
- Diff: `rtk git.exe diff --check` pass.

## Reviewer nonblockers (recorded, no action required this task)
- Snapshot DDL uses plain `CREATE TABLE` (no advanced DDL features).
- Seed completeness checks 4 vs 8 tables (2 tables not seeded in test fixture; inert).
- Future schema tables are inert (no current read/write path).
- Default times 60/90 are explicit constants vs `TARGET_MS` wording discrepancy (cosmetic; behavior identical).
- Session create does not write `question_lesson_usage` (future task, out of scope).
