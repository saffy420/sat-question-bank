# Study Plan — Status Log

## 2026-10-01 — Brief saved and split (Architect)

**Shipped:** `docs/plan/BRIEF.md`: the user's brief verbatim, plus §7 pipeline conventions, §8 ordered tasks
(`plan-00-audit` → `plan-06-e2e-regression`) with tiers, checkpoints and STOP gates, and §9 the audit's question list.
No code, migrations or tests.

**Deviation:** the user pointed to "docs/lessons/BRIEF.md §12.1 tiers". That file's §12.1 is the later single-session
model (no subagents). The tiered, fresh-subagent model with Test Developer and Reviewer is in
`docs/roadto1600-lessons-prompt.md` §12.1, so §7 follows that.

**Preliminary dependency finding (for plan-00 to confirm):** the practice-test → bank-ID map exists as data
(`tools/ptmap/practice-test-map.json`: PT4–PT11, 833 positions, 5 unmapped, most hard module-2 blocks not exported),
but nothing in `src/`, `public/` or `lesson-ui/` reads it. The "mapping feature's behavior" §1 reuses (mark done,
misses to the mistake log) was not found. bank-bluebook is merged (PR #20).

**Next:** `plan-00-audit` in a new session.
