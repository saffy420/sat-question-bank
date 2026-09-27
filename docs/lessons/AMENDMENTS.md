# Live Lessons — Approved Amendments (moved from BRIEF.md on 2026-09-26)

These G1–G6 amendments were approved 2026-09-23 and still override the matching BRIEF.md requirements. They were moved here when BRIEF.md was replaced verbatim by the Claude Code task 06–10 brief.

## Amendments — 2026-09-23 User Approval

The following amendments override specific BRIEF.md requirements per the PLAN.md approval record dated 2026-09-23. All G1–G6 gates resolved; commit policy established.

### G1 Secrecy Scope (Option A: Narrowed Lesson-Channel Guarantee)
- **Overrides:** §0 rule 5, §6.2, §6.3, §7.1, §7.2, §13 acceptance checks
- **Change:** Practice bank `/api/questions` remains unchanged — full answers, explanations, trap tags, and crop URLs stay accessible to signed-in members. Lesson channels (HTTP/WS payloads and lesson client state) are role/phase-safe: strip answer-derived trap metadata, rationale leaks, instructor notes, correct answers before reveal. Existing practice access and all prior disclosures are explicit exceptions. Student cannot receive instructor notes or identifiable individual responses in lesson snapshots/reveals. Anonymous distribution of others' answers in class charts remains approved. Anonymous lobby count uses distinct safe count update, not named roster. §13 acceptance check 1 applies to lesson channels only; practice bank disclosure is outside scope.

### G2 Deadline / Reveal Timing
- **Overrides:** §6.1 "REVEALED fires immediately at 0"
- **Change:** UI freezes selection at `endsAt`. Server accepts in-flight answer changes through `endsAt + 750ms`, then finalizes and reveals. REVEALED fires after grace window, not at 0. Alternative (drop grace entirely) rejected.

### G3 Blank Scorable Questions / Unavailable Metrics
- **Overrides:** §10 (implicit), §8.5, §8.6, §10 write-back conventions
- **Change:** Assigned blank scorable self-paced question writes `picked=null`, `correct=0`, zero `answer_changes` unless earlier selections exist; `source` tag (`lesson_session_id`) + `time_spent_ms` retained. Updates Red/mistake state via shared progress path. Unassigned questions: no attempt row. Unscorable: null/excluded, never turned into wrong. Prospective `answer_history_json` capture added for direction stats (right→wrong / wrong→right); old records display "unknown", never fabricated. No timeout/skip writer exists in current platform.

### G4 Staged Dependency Exceptions
- **Overrides:** §12.5 task checkpoints for tasks 01, 02, 03 and the §12.2 short-timer fixture rule
- **Approved shifts:**
  - Task 01: Lessons tab honestly empty/unavailable (populated assertion moves to task 09)
  - Task 02: Session row creation + join-code allocation move here (so Save & start checkpoint is real)
  - Task 03: Minimal answering lifecycle (start/answering/lock) moves here, including one longer outage fixture — 45–60s question with deliberate 20s offline for reconnect testing (so after-start/offline checkpoint is real)

- No checkpoints dropped overall.

### G5 Time Budget Accumulation
- **Overrides:** §8.5 "previous event" wording (that phrase reintroduces ambiguity; use precise boundary)
- **Change:** Accumulate against **previous accepted time-flush/visit boundary and authoritative deadline**, not every select/ping. Server bounds: `time_spent_ms += deltaMs` rejecting any delta larger than the elapsed interval since that student's previous accepted time-flush/visit boundary. Replay-safe event identity/sequence for time deltas prevents reconnect duplication. Contract extension documented, not silently inferred from deltaMs alone. Client hiding/disconnect accounting is not proof of attention; server bounds dishonest inflation only. Unit test: Q1 10s → Q2 5s → Q1 7s ⇒ Q1 17s, Q2 5s exactly.

### G6 Session Lifecycle / Review / End Semantics
- **Overrides:** §8.6, §8.7 ambiguity
- **Change:**
  - Self-paced set completion: finalizes responses once → `status=review` (write-back via shared path at this point)
  - Join code remains valid for **review-only** admission; new arrivals get no expired assignment
  - Notes/My Lessons unlock at final `ended`, not during live review; joins stop then
  - Results immutable during review
  - Zero-assignment participants: excluded from score mean/median and "everyone submitted" completion test; still eligible for connected-student polls
  - Explicitly label set-finished vs session-ended in UI

### Other Approved Items
- **Local-only test auth (§4):** Separate local entry/config (Option B), `E2E_TEST_MODE=1` flag, seeded identity, isolated D1/DO, browser-only Supabase session adapter, production bundle excludes test imports
- **Shared stats extraction (§2):** One shared module (e.g. `public/shared/stats.js`) with explicit inputs; Worker imports same source; dashboard calls it
- **Schema additions:** `source` tag (`lesson_session_id`) on attempts for self-paced write-back, uniqueness on session/user/question, `answer_history_json` for direction tracking — added when needed
- **SPR grouping:** Exact-value deterministic parsed numeric keys (1/2 = .5); rounded-but-accepted distinct values stay separate groups; `isRight` preserved unchanged
- **Duplicate template question IDs:** Rejected at addition time (response key is session/user/question, not position)
- **Pipeline path:** `.opencode/pipeline/<task-name>/` (workspace instruction), not brief's `.omp/`
- **Commit policy:** After user approves each task STOP, one local commit for that task. No push/deploy.
