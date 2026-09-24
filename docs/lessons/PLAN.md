# Live Lessons implementation plan

Date: 2026-09-23
Status: **APPROVED** — 2026-09-23 user approval recorded below. Implementation authorized for task 00b onward.
Source of truth: `docs/lessons/BRIEF.md`, including approved Amendments. The approval record below supersedes pending/proposed wording retained in the original audit plan.
Evidence: `.opencode/pipeline/lessons-00-audit/research.md`, including its corrections in A0–A6. Corrections supersede earlier claims in that report.

## User Approval Record — 2026-09-23

**PLAN.md approved in full.** All gates G1–G6 resolved as follows:

| Gate | Decision | Notes |
|---|---|---|
| G1 secrecy | **Option A: narrowed lesson-channel guarantee** | Practice bank access unchanged. Lesson HTTP/WS payloads and client state are role/phase-safe (strip trap tags, rationale, instructor notes, answer-derived fields). Existing practice access and prior disclosures are explicit exceptions. Brief §0 rule 5 acceptance wording is overridden for lesson channels only — see BRIEF.md Amendments. Anonymous distribution of others' answers in class charts remains approved; restriction is on identifiable individual responses, not anonymous aggregated distributions. |
| G2 deadline | **Freeze UI at endsAt, finalize/reveal after endsAt + 750ms** | Overrides BRIEF §6.1 "REVEALED fires immediately at 0". Server accepts in-flight changes through grace window, then finalizes and reveals. |
| G3 blanks/unavailable | **Assigned blank scorable question: picked=null, correct=0, zero changes unless earlier selections exist; source tag (lesson_session_id) + time retained** | Updates Red/mistake state via shared progress path. Unassigned: no attempt. Unscorable: null/excluded. Prospective answer-history capture added for direction stats; old records display unknown, never fabricated. Overrides BRIEF §10 implicit assumption. |
| G4 staged dependencies | **Approved exact shifts:** task01 Lessons tab honestly empty (populated assertion moves to task09); session row/join-code creation in task02; minimal answering lifecycle in task03 (includes one longer outage fixture — 45–60s question with deliberate 20s offline for reconnect testing); no dropped checkpoints overall. Overrides BRIEF §12.5 task checkpoints as specified. |
| G5 time budget | **Previous accepted time-flush/visit boundary and authoritative deadline with replay-safe event identity/sequence** | Server-bounded accumulation, not every select/ping. Frequent selections must not shrink valid time budget. Replay delta deduplication. Overrides BRIEF §8.5 "previous event" wording. |
| G6 lifecycle | **Set completion → finalize once → status=review** | Join code valid for review-only admission; new arrivals get no expired assignment. Notes/My Lessons unlock at final `ended`, not during live review; joins stop then. Results immutable during review. Zero-assignment participants excluded from score mean/median and "everyone submitted" completion test; still eligible for connected-student polls. Explicitly label set-finished vs session-ended in UI. Overrides BRIEF §8.6–8.7 ambiguity. |

**Additional approved items:**
- Local-only test authentication: separate local entry/config (Option B), `E2E_TEST_MODE=1` flag, seeded identity, isolated D1/DO, browser-only Supabase session adapter, production bundle excludes test imports (§4).
- Shared stats extraction: one shared module (e.g. `public/shared/stats.js`) with explicit inputs; Worker imports same source; dashboard calls it (§2).
- Schema additions when needed: `source` tag (`lesson_session_id`) on attempts for self-paced write-back, uniqueness on session/user/question, `answer_history_json` for direction tracking.
- Exact-value SPR grouping: deterministic parsed numeric keys (1/2 = .5), rounded-but-accepted distinct values stay separate groups. Preserve `isRight` unchanged.
- Reject duplicate template question IDs at addition time (requested response key is session/user/question, not position).
- Pipeline artifacts path: `.opencode/pipeline/<task-name>/` (workspace instruction), not brief's `.omp/`.
- Commit policy: after user approves each task STOP, one local commit for that task. No push/deploy.

## 1. Scope and approval boundary

No feature code, migrations, test harness, dependencies, or production changes in task 00. This plan describes future work, not shipped behavior. All brief [DEFAULT] choices stand; no approval requested for them.

Pipeline artifacts use `.opencode/pipeline/<task-name>/`, not `.omp/pipeline/`, because workspace orchestration instructions require that path. Future screenshots/traces go under that task's gitignored `e2e/` directory. Product documents remain in `docs/lessons/`.

Each implementation task: Researcher → Architect spec → Developer (app + unit tests) → separate fresh Test Developer (Playwright only) → read-only Reviewer → Documentation. App repairs return through Developer, full Test Developer rerun, Reviewer; maximum five repair rounds, stopping sooner on repeated unresolved ambiguity. No skipped/missing/failing checkpoint reaches completion without explicit user approval. Documentation writes handoff and a dated STATUS entry. Every brief STOP remains. No implicit deploy, remote mutation, or commit authorization is inferred from regression tests being described as "committed"; leave changes uncommitted unless separately authorized.

Task 00 is the research-only exception: Researcher → Architect plan/spec → independent Reviewer → Documentation → user STOP. Brief defines no task-00 browser checkpoint. Developer/Test Developer feature work would violate its research-only rule; none is claimed.

## 2. Verified baseline and reuse map

Line references below describe audited checkout, not future stable positions. Read actual files before changing them.

| Area | Existing code / evidence | Plan |
|---|---|---|
| Auth | `src/index.js:61–132,177–237`; `public/auth.js`; SPA auth `public/index.html:3895–4014` | Preserve Supabase validation, Google/OAuth restrictions, bearer/cookie intake, membership and account isolation. Role is separate from membership. |
| Question data | `schema.sql:9–24`, `schema_ai.sql`; `/api/questions` `src/index.js:262–276` | Reuse both banks and AI registry. Normalize server-side before role/phase projection. |
| Grading | `isRight`, `public/index.html:2908–2938`; normalization `1459–1492` | Extract one shared grading implementation, preserving fractions, alternatives, rounding/truncation, and null unscorable. Never depend on student receiving explanation to derive answer. |
| Renderer | `renderStem`, `choiceHTML`, `loadQuestion`, `renderPanes`, `renderAnswerArea`, `2692–2906`; `mathify` | Adapt existing player behind lesson state/actions. No second question renderer. Preserve test extraction markers or deliberately migrate their tests. |
| Progress/attempts | `recordProgress` / `recordAttempt`, `2943–2959`; Worker progress/attempt handlers `src/index.js:318–352` for attempts | One server persistence service shared by practice API and lesson completion; preserve existing client semantics and exact-snapshot acknowledgments. |
| Filters/taxonomy | `dd`, `DOM_ORDER`, `SKILL_ORDER`, `cbSort`, `1902–1958,2436–2473` | Reuse order, null=all / []=none, separate filter state. |
| Desmos | iframe `3389–3452`; CSP `src/index.js:9–23`, `public/_headers` | Keep ordinary practice iframe. Lesson API integration only in task 06, both CSP sources updated together. |
| Schema | core migrations through `0006_membership.sql`; separate AI migrations through `0001_init.sql` | Next core number is 0007 at audit time. Recheck before each task. Role migration precedes lesson migration; do not assign both 0007. No AI migration currently justified. |

### Stats: reuse does not mean copying

Research A2 documents closure dependencies. Most helpers are DOM-free but close over `QS`, `PROG`, or `LOG`; they are not already independent Worker functions.

- Existing: `weakness`, `tally`, `levelOf`, `targetOf`, `pacing`, `trapCounts`, `guessing`; mistake predicate/markers; inline difficulty accuracy loop.
- Extract needed computations into browser-served ESM (proposed `public/shared/stats.js`) with explicit questions/progress/attempts/filter inputs. Worker imports the same source; existing student dashboard must call it too. No copied inline implementations remain. Avoid extracting unrelated calendar/render code merely for architectural tidiness.
- Current-state accuracy and historical attempt accuracy are distinct existing measures. Preserve their definitions and label them, rather than silently substituting one for another. Orange remains correct for current-state accuracy; activity remains attempt-derived.
- New but derivable views: paginated question-attempt history (existing History is exam history), skill average time/trend, pacing by difficulty, trap example questions, last attempt activity. Add each calculation once to shared stats when needed; document metric denominator and sparse data.
- Missing data: right→wrong / wrong→right answer transitions. `attempts.changes` is only a count; historical direction cannot be reconstructed. See G3.
- Missing until later task: lesson attendance/history. Task 01 cannot honestly show populated Lessons data before lesson tables exist. See G4.
- Markdown notes helper already has extraction markers (`notesMd`, around 2377); task 02 research verifies safe reuse and math rendering. Do not introduce an unchecked HTML rendering path.

## 3. Security boundary — requires explicit decision G1

Today `/api/questions` sends both banks' full answer/explanation data to signed-in approved AND pending members. SPA stores it in `QS`, exposes it via `window.__qa`, Browse and Copy for AI. AI `choices[].trap` identifies distractors. Raw stems can include appended rationale currently removed only client-side. Rationale crop URLs are also disclosed; crop authorization currently checks membership, not lesson phase. Sources: research §4 and A4.

**Previously disclosed answers cannot be retracted. A student can also fetch current answers outside a lesson or through another permitted account. A sanitized lesson socket alone does not satisfy the brief's broad secrecy acceptance check.**

Two honest options, neither silently selected:

1. **G1-A: preserve current practice access and narrow the guarantee explicitly.** Lesson views do not bootstrap the full bank. All lesson HTTP/WS payloads and lesson client state are role/phase-safe, including removal of trap metadata and rationale leaks. Instructor notes and other students' answers stay protected. Existing practice access and prior disclosure are explicit exceptions. This changes the brief's broad acceptance wording and requires approval.
2. **G1-B: retain strict future-serving secrecy and approve a prerequisite bank-access redesign.** Before live lessons, redesign every student question/answer/explanation/export/crop path with server-authorized release, remove full-bank answer preload, and handle already-released/public questions explicitly (e.g. reserve undisclosed questions). Full secret reuse of historically exposed content still cannot be promised. Research/spec this prerequisite separately; it exceeds the current lesson-only scope and cannot be smuggled into task 03.

Recommendation: choose G1-B if assessment secrecy is mandatory; choose G1-A only if practice-bank openness is acceptable. Implementation remains blocked until chosen.

Regardless of option: construct student payloads from an allowlist, never spread full DB/question objects then delete a few fields. Strip answer-derived trap tags; normalize/sanitize stems before wire delivery; audit authored SVG, alt text, filenames and referenced assets for rationale disclosure. No instructor notes in live student snapshots/reveals. Authorize HTTP endpoints and WS actions independently of UI. Student can receive their own response only; named roster/results stay instructor-only. Anonymous lobby count needs a distinct safe count update, not named roster reuse.

Cookie-authenticated WS upgrades require same-origin validation, existing validated identity/membership, DB-derived role, session membership/ownership and joining rules. Ignore client role/identity fields; do not place long-lived access tokens in URLs. Worker-attached identity is trusted only on its internal DO path. Validate size/type/range of every event and rate-limit abusive traffic; this is required trust-boundary handling, not speculative scope.

## 4. Local-only test authentication: selected design for approval

Architect selects **separate local-only entry/config (research Option B)**. A flag-only login route cannot authenticate later requests: existing `whoami` verifies tokens with Supabase and SPA requires a Supabase-shaped session. Shipping a bypass in production conflicts with "nothing test-only ships".

Proposed task 00b design:

- Local E2E entry under test-support scope and separate Wrangler config, never imported by production entry. Require exact `E2E_TEST_MODE=1` from ignored local test vars; without flag the login route returns 404 with no side effects.
- Factor a minimal request-handler identity seam if necessary; production default always invokes real `whoami`. The local wrapper supplies seeded identity resolution. Do not claim production source remains byte-identical: a behavior-preserving seam may be needed. Production auth must never inspect `e2e.` tokens or test flags.
- Local wrapper issues bounded opaque test sessions for a fixed seeded account allowlist; route remains origin-checked. Subsequent local requests resolve those sessions to local users/membership. No client-supplied arbitrary role/user identities. Do not fake Google validation.
- Test Developer installs a browser-only Supabase session adapter for fixture sessions, preserving SPA login/load/queue flows without production auth calls. Local wrapper must not fall back to production Supabase for fixture authentication. Block/assert unexpected production network access. Document that this verifies application behavior, not real OAuth end-to-end.
- Separate local persistence directory for BOTH D1 databases and, once added, DO storage. Explicit binding/schema identity; no selection of the first SQLite file. Stop dev processes before direct seeding/reset. Prefer supported local D1 commands to raw SQLite edits.
- Developer owns required package/config/auth-seam changes; Test Developer owns only `tests/e2e/`, fixtures and seed data plus its pipeline report/artifacts. Declare Playwright config/dependency needs in Developer spec so Test Developer need not edit app/config outside its boundary.
- Tests prove route 404 with flag unset, normal production entry 404 even if test flag is accidentally provided, and production bundle excludes local auth/test imports. Keep real auth negative/unit tests intact.
- No remote Supabase test accounts and no changes to production Google/OAuth restrictions. No real crop-bank prerequisite: seed small owned R&W, Math and SPR questions and local fixtures in both initialized banks.

Alternatives rejected: shipped flag bypass has larger auth blast radius; Supabase password users fail current Google/OAuth restrictions and remote auth introduces external dependencies. Local Supabase is feasible but unnecessary extra service for this scope.

## 5. Realtime, persistence, grading decisions

### Durable Object ownership

One SQLite-backed `LessonRoom` DO per session ID, Hibernation API, serialized socket attachments for role/account/session context. Reconstruct live state from durable storage on wake; memory alone is not persistence. One student socket: replacement closes old connection with reason so old tab does not reconnect forever and evict the new tab.

Use one DO alarm scheduled to earliest pending deadline (question/set, grace finalization if approved, poll, result transition, persistence retry). Recompute deadlines on wake/reconnect/message; do not rely solely on punctual alarm delivery. Alarm delivery/retry and D1 flushes must be idempotent. Timers/locks are server decisions, even when instructor disconnects.

D1 writes only at lifecycle boundaries (session creation/join/assignment, question/set/session finalization), not per selection/time/annotation/Desmos event. Live state persists in DO storage. D1 failed batch leaves durable pending work and retries without duplicate attempts or lost results. DO↔D1 has no cross-store transaction; completion needs durable checkpoint/outbox and a stable session/user/question uniqueness constraint. Never synthesize fresh timestamps on retry. Reuse existing validated persistence path, not client self-HTTP calls with forged tokens. Practice write caps and failure semantics must not silently discard lesson results.

Freeze template/question/version data at start so later edits cannot rewrite session grading/history. Store assigned sets once at first valid self-paced join. Reconnect never recomputes subset. Reject or handle duplicate question IDs in a template explicitly: the requested response key is session/user/question, not position; recommended reject duplicate additions to avoid ambiguous results.

### Clock, grace and time accounting

Use ping round-trip samples to estimate latency and offset; unsolicited `serverNow` alone cannot identify a lowest-latency sample. Every server message still includes `serverNow`; countdown is display-only.

G2 recommendation: UI stops selection at `endsAt`, server accepts in-flight changes through `endsAt + 750ms`, then finalizes and reveals. This changes "REVEALED immediately at 0" by 750 ms but prevents selecting with disclosed answer. Alternative: immediate reveal with no grace. Immediate reveal plus post-reveal acceptance is not secure.

G5 recommendation: accumulate time against prior accepted time-flush/visit boundary, not every select/ping. Clamp/check against server elapsed active interval and authoritative deadline; frequent selections must not shrink valid time budget. Replay-safe event identity/sequence for time deltas prevents reconnect duplication. Any contract extension is documented, not silently inferred from deltaMs alone. Client hiding/disconnect accounting is not proof of attention; server bounds dishonest inflation only. Test 10s Q1 + 5s Q2 + 7s Q1 = 17s/5s exactly.

### SPR groups

`isRight` is a key-vs-response grading predicate, not a symmetric grouping relation (research A5). Preserve it unchanged for correctness; extract its cleanup/fraction parser once and use deterministic exact parsed numeric keys for grouping (e.g. 1/2 and .5). Do not round all submitted responses to three decimals or merge by correctness. Rounded-but-accepted distinct values can remain separate groups. Task 04 tests this and labels correct groups using original responses and shared checker. This is the proposed interpretation of brief §6.3, not a new grader.

### Self-paced finalization

G6 recommendation: shared-clock completion finalizes responses and approved self-paced write-back once, then `status=review`. Join code remains usable for review-only admission; new arrivals get no expired assignment. Notes/My Lessons unlock at final `ended`, not during live review; joins stop then. Results immutable during review. Explicitly label set-finished vs session-ended in UI. Zero-assignment participants excluded from score mean/median and from "everyone submitted" completion test; still eligible for connected-student polls. These edge rules require approval with G6.

Instructor-paced never invokes practice write-back. Self-paced attempt source column and stable uniqueness are added when needed, not an alternative duplicate stats store. Existing progress must also update via shared semantics or mistake log will not change merely because an attempt was inserted. Unscorable answers stay null/excluded, never turned into wrong.

## 6. Ordered task boundaries

All task specs copy their exact brief §12.5 checkpoint list. Table notes dependency adjustments proposed in G4; these do not silently mark an unmet checkpoint passed.

| Task | Implementation scope and verification | Gate |
|---|---|---|
| 00 audit | This research/plan, review against evidence, docs only. Existing unit baseline recorded; no e2e checkpoint. | STOP: approve plan and decisions below |
| 00b e2e harness | Local-only auth/seed + helpers; Developer adds required test dependency/config. Separate Test Developer verifies admin/student sign-in, both banks load, route 404 unset; full suite. No lesson tables/DO yet; future lesson fixture definitions do not pretend those features exist. | Stop on blocked checkpoint |
| 01 admin dashboard | Roles (next core migration), owner/admin authorization, shared existing stats and derivable views, all current-data tabs. Add prospective answer history if G3 approved. Lessons tab honestly empty/unavailable until schema/data tasks; proposed checkpoint exception requires G4 approval. | STOP |
| 02 builder | Next clean core lesson migration; renderer/filter/notes reuse, template autosave/library, frozen-run preparation. Session creation + join-code allocation move here so Save & start checkpoint is real; no live DO yet. Builder usage filter tested with seeded usage rows. | STOP |
| 03 realtime core | DO, authenticated join/WS, snapshots, server deadlines/reconnect, protocol. Minimal instructor start/answering selection/lock lifecycle moves here to make after-start/offline checkpoint real; task04 completes live presentation/reveal UX. Do not use test-only state injection as substitute for tested app path. | No planned STOP, except blocked checkpoint |
| 04 instructor-paced | Complete §6 renderer wrapper, early submit, server reveal, distributions/SPR, instructor responses batching, class chart, leakage checks under G1/G2 approved scope. | STOP: user tests real Chromebooks |
| 05 annotations | Stable content-node anchors separate from KaTeX generated DOM; text offsets, normalized strokes, ephemeral laser, private layer, follow, durable snapshot/history data. Text must align across viewport/zoom; normalized pen geometry does not promise identical word anchoring after reflow. | STOP |
| 06 Desmos | Lazy-load API only for math lessons, key/config/CSP both sources, read-only/fork behavior, dedupe/throttle/state persistence. Recheck pinned official docs before coding. | STOP, includes latency gate if target fails |
| 07 self-paced | Shared-clock/assigned sets, navigation/flags/submit, authoritative grading/time, all three exact late-join unit cases and revisit test, accumulated time/grid e2e. Responses stored; stats integration still task09, not claimed yet. | STOP |
| 08 review polls | Overview assigned denominators, poll timing/early close/ties/exclusion, immutable review. Deterministic final tie fallback documented in task spec (original lesson order recommended). | STOP |
| 09 history/stats | Student history/breakdown/saved review, usage tracking and 3-option bank filter, shared write-back source+progress/attempts, exactly-once retries. Complete populated admin Lessons tab. Prove instructor isolation and self-paced mistake/source visibility. | STOP |
| 10 e2e regression | Separate Test Developer only, whole suite and exploratory CLI screenshot tour both modes; Reviewer, Documentation. No feature expansion. | STOP |

Migration snapshots and numbered migrations must be tested by two separate paths: fresh initialization and upgrade of an existing schema. Never blindly replay historical ALTERs over current snapshot.

## 7. Browser verification contract

- No production E2E, production data, live student accounts, or production sign-in. Local `wrangler dev`, isolated D1/DO state, owned seed content. No claim local tests prove production or real-phone behavior.
- Pin `@playwright/test` version at 00b; inspect then use current Context7 docs. Playwright CLI skill: `C:\Users\Leon\.claude\skills\playwright-cli\SKILL.md`; repo copy also exists. No current Playwright Test config/suite was found.
- Fresh browser context per user, student viewport 1366×768; instructor at 1920×1080 when annotation checkpoint requires it. Multi-page context capture covers HTTP and every WS from before navigation, across reconnects. Preserve screenshot/trace paths and failures; no silent response-body read failures.
- Leak matcher parses schema/fields and uses unique seeded explanation/notes markers. A bare "B" or "2" cannot be forbidden since choices and timestamps contain them. Test answer-bearing keys, semantic answer hints/traps, decoded HTML and client state as well as bytes. G1 determines whether normal bank access itself must be denied/sanitized. Never whitelist a leak merely to get green tests.
- Use real 5–10 second DO timers for fast scenarios. G4 fixture exception: one 45–60 second question for a deliberate 20-second offline outage; that outage duration is test input, not a blind readiness sleep. Assert disconnect before holding outage, then wait for snapshot/UI restoration conditions. Also cover deadlines firing while instructor/student disconnected.
- Browser offline/CDP settings must be verified against actual WS transport; setting a CDP option alone is not evidence socket packets were delayed or disconnected. If Chromium's emulation does not exercise it, report blocked checkpoint and propose local network-level emulation; do not silently substitute a fake pass.
- Desmos ≤0.5s under named Slow 3G remains the brief's target. Record exact throttle, serialized state size, method, repeated samples, elapsed event-to-student-render time. Do not downgrade to informational, change to median-only, or inflate threshold without approval at task06.
- No `.skip`, `.only`, `fixme`, weakened assertion, inflated timeout or unnecessary fixed sleep. Test Developer touches no app code. After every app repair rerun task specs AND entire earlier e2e suite before independent review.
- Reviewer maps every checkpoint to an actual assertion and full-suite evidence in `e2e.md`. Missing browser/seed/network prerequisites are gates, not green results.

## 8. External references and verification limits

Research consulted Context7 `/websites/developers_cloudflare_durable-objects` for hibernation/state and alarms; `/microsoft/playwright` for browser contexts/auth/offline. Official references include:
- https://developers.cloudflare.com/durable-objects/best-practices/websockets/
- https://developers.cloudflare.com/durable-objects/api/alarms/
- https://playwright.dev/docs/browser-contexts
- https://playwright.dev/docs/api/class-browsercontext
- https://www.desmos.com/api/v1.11/docs/index.html

Context7 could not resolve Desmos; direct official v1.11 docs used with partial page extraction. Task06 must verify graphpaperBounds, read-only options, API key licensing/availability and exact CSP resources; current research is not proof no additional connect/img/worker sources are needed. Keep normal calculator iframe CSP.

Current checkout differs from historical standing facts: it has membership/auth routing, `run_worker_first = true`, a working `npm test` script and reorganized migrations. Do not "fix" these to match stale measurements. Serena initial_instructions was not exposed to parent tools; no manual-load claim is made.

Researcher ran existing `npm test`: **43 passed, 0 failed**. No lesson unit tests, browser suite, local DO execution, or production validation ran in task00. Local D1 files exist but identity/population/readiness not established for E2E; use dedicated seeds. Windows `git.exe` baseline showed unrelated untracked `.omp/`, `.serena/`, `docs/roadto1600-lessons-prompt.md`; preserve them. WSL Git produced CRLF phantom changes; do not normalize files.

## 9. User decisions required before implementation

Approval must name G1 option. G2–G6 can be approved together as recommendations or changed explicitly. No [DEFAULT] decision is reopened.

| Gate | Finding | Recommended decision |
|---|---|---|
| G1 secrecy | Existing bank already exposes answers, rationale, traps and crop URLs; broad brief acceptance cannot hold unchanged. | Choose **A narrowed lesson-channel guarantee**, or **B prerequisite future-serving access redesign**. Neither promises to erase prior disclosures. See §3. |
| G2 deadline | Reveal at zero plus acceptance for 750 ms exposes answers during acceptance. | Freeze UI at zero, finalize/reveal after grace; alternative drop grace. |
| G3 unavailable metrics / blanks | No timeout/skip writer and no historical answer-change sequence. | Assigned blank, scorable self-paced question writes `picked=null`, `correct=0`, zero changes unless earlier selections exist, source+accumulated time retained; updates Red/mistake state via shared path. Unassigned: no attempt. Unscorable: null/excluded. Add prospective answer-history capture for direction stats; old records display unknown, never fabricated. |
| G4 staged dependency conflicts | 01 Lessons before schema; 02 code before join; 03 answering before 04; short timers before 20-second outage. | Approve exact shifts/exceptions in §6–7: task01 honest empty Lessons tab (populated assertion moves to09), session row/code in02, minimal answering lifecycle in03, one longer outage fixture. No dropped checkpoint overall. |
| G5 time budget | "Previous event" would reject legitimate time after a recent selection/ping; replay delta can double count. | Interpret previous accepted time/visit boundary; server-bounded, replay-safe accumulation. |
| G6 lifecycle | Set completion, review, ended/history/code semantics ambiguous, zero-assignment scoring unspecified. | Set completion finalizes once → review; code valid for review-only joins; final ended unlocks history/notes and invalidates code. Zero-assignment excluded from score/completion denominator, allowed in polls. |

Plan approval also covers local-only auth design (§4), shared extraction/new derivable calculations (§2), source/uniqueness schema additions when needed, exact-value SPR grouping (§5), and rejection of duplicate template question IDs. These are explicit proposals, not claims existing behavior already supplies them.

Task06 latency failure, any later contradictory finding, missing prerequisites or failing/skipped checkpoint remains its own user gate. Approving this plan does not pre-approve such exceptions.
