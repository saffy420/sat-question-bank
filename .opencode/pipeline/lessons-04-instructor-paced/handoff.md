# Task04 Handoff — lessons-04-instructor-paced

## Status
Complete

## Goal
Finish BRIEF §6 instructor-paced lesson from existing task03 room/lobby. Ship full live lesson with server-authoritative phase control, student player, instructor view, secrecy guarantees, exact-value SPR grouping, and distribution/chart features. No task05+, no commit/push/deploy.

## Changed

### New files
- `src/lesson-room.js` — `LessonRoom` Durable Object (task03, carried forward): server-authoritative READY → ANSWERING → REVEALED lifecycle, `endsAt` freeze with 750ms grace window, persisted timers/alarms/reconnect, one socket per student, idempotent finalize, D1 writes only at join/finalization boundaries.
- `public/shared/lesson.js` — Shared lesson protocol (task03, carried forward): `GRACE_MS=750`, `validAction(m,role)`, `lessonQuestion(q,reveal)` strips rationale/trap/notes from student projection; reveals on REVEALED/ENDED or admin.
- `tests/test_lesson_room.cjs` — 8 unit tests (task03, carried forward): origin/upgrade gate, role allowlist, student projection secrecy, server grace/finalize, join lock/reconnect, socket replacement.

### Student live player (`public/index.html:3688+`)
- Wraps existing `public/shared/renderer.js` hooks (context/choice/math/SPR); no copied renderer.
- Title, question position, clock, connected/reconnecting indicator.
- Countdown amber ≤10s, red ≤5s. Selection editable during ANSWERING.
- Submit opens exact confirmation: "Have you double checked your answer and made sure it's right?" Go back retains editing; Yes, submit sends lock and waits with "Answer locked in. Waiting for time to end…", no early correctness.
- Disable changes on server-confirmed lock and local deadline; reconcile reconnect/pending selection safely.
- At REVEALED: correct green, own wrong red, SPR result, collapsed official explanation; no notes.
- Modal stacking repair in `public/index.html` allows normal pointer clicks (app fix, no forced clicks/skips/test bypasses).

### Instructor view (`public/admin.js:104+`)
- Question via same renderer; correct answer; collapsed official explanation; escaped/math-rendered notes.
- Live named response rows: ○ blank, ◐ selected, ● locked, answer and ✓/✗; sorted name/status; n/total in.
- Responses emitted at ≤4/sec under selection bursts; eventual latest state; no student receives named peer data.
- After reveal: choice/blank distribution and correct bar; click group for names and per-question time.
- SPR distribution groups exact deterministic numeric value (1/2, 2/4, .5 same); leaves rounded-but-grader-accepted distinct numeric inputs separate; uses unchanged `isRight` for correctness; top groups plus other.
- Class-results toggle: admin-only, durable; student chart anonymous, visible only after reveal when enabled.
- Admin controls phase-aware.

### Security / state
- Student lesson HTTP/WS/state contains no answer/explanation/answer-derived trap data before reveal; no notes or identifiable peers at any time; anonymous class results approved.
- Response projection built server-side; no grading leak through responses events or sent chart before reveal.
- No per-event D1 writes; persist DO changes before acknowledgments/broadcast; D1 flush at question/session boundary with idempotence.
- Previous task03 join/reconnect behavior and GRACE_MS preserved.

### Tests
- `tests/test_lesson_room.cjs` expanded to 69/69 unit tests (from task03 baseline).
- `tests/e2e/lessons-04-instructor-paced/paced.spec.js` — focused E2E spec, 1366×768, permanent location.
- `tests/e2e/lessons-00b-e2e-harness/leaks.js` — phase-aware lesson-channel leak checks; practice `/api/questions` remains approved exception.
- `src/index.e2e.js`, `wrangler.e2e.toml`, `wrangler.e2e-production.toml` — E2E config with DO binding.

### E2E artifacts
- Nine checkpoint screenshots in `.opencode/pipeline/lessons-04-instructor-paced/e2e/`: `01-lobby.png`, `02-selected.png`, `03-confirmation.png`, `03-locked.png`, `04-responses.png`, `05-reveal-distribution.png`, `06-reveal-chart.png`, `07-spr-answering.png`, `08-spr-distribution.png`.
- Duplicate repo-path PNGs removed. Earlier blocked-modal screenshots under `tests/e2e/lessons-04-instructor-paced/` are historical, not pass evidence.

## Validation
- `rtk npm test` — PASS 69/69 unit tests (Reviewer independently ran 69/69).
- `rtk npx playwright test tests/e2e/lessons-04-instructor-paced/paced.spec.js --workers=1` — PASS 1/1 focused E2E (~20.8s).
- `rtk npm run test:e2e` — PASS 13/13 full suite (repeated after screenshot-path edit: PASS 13/13, 1.4m).
- `rtk git.exe diff --check && rtk proxy node --check tests/e2e/lessons-03-realtime-core/realtime.spec.js` — PASS. Task03 stale `Connected` checks updated to require visible `#lesson-connection` with `● Connected`.
- `rtk node --check src/index.js public/index.html public/admin.js public/shared/lesson.js public/shared/renderer.js` — passed.
- `rtk npm run e2e:seed` — PASS; isolated local DB, ports free before seeding.

## Review
PASS (Reviewer deep read-only, no blockers). All BRIEF §12.5 task04 checkpoints verified:
1. Instructor + 3 students; live response ○/◐/● — PASS
2. Early-submit modal: Go back keeps editing; Yes, submit locks and hides correctness — PASS
3. At 0, unsubmitted selection becomes final — PASS
4. Reveal colors correct — PASS
5. Distribution counts, clicked bar right names — PASS
6. Show class results toggles student chart — PASS
7. +15s and End now — PASS
8. SPR responses group by normalized value — PASS
9. No pre-reveal answer/explanation/notes; no notes any phase — PASS

App repair: modal stacking bug in `public/index.html` (Go back pointer interception) fixed upstream.
Test repair: task03 `Connected` exact-text expectation updated to require visible `#lesson-connection` with `● Connected` (text plus indicator), not weaker substring match.

## Nonblocking review notes
- **Ephemeral 250ms debounce**: autosave debounce observed at 250ms; not a defect, but noted as within task scope.
- **SPR input narrower than parser**: some SPR input fields narrower than the parser accepts; cosmetic, does not affect grading or grouping correctness.
- **Color E2E gap**: E2E does not programmatically verify color rendering (green/red/correct-answer disclosure); verified by visual screenshot only.
- Local-only limit: all E2E runs use local seeded Wrangler (`https://127.0.0.1:8787`); no production traffic, deployment, app edits, or commit.

## Caveats / next session
- **Chromebook user STOP**: browser E2E does not prove touch behavior, production data, or deployed runtime. User must test on real Chromebook before any further action.
- No task05 (annotations), task06 (Desmos), task07 (self-paced), or task09 (history) started.
- No commit, push, deploy, or remote data mutation without explicit user authorization.
- Local E2E only; no production D1 migration applied.
- Practice-bank G1-A exception: `/api/questions` answer exposure remains approved exception; lesson-channel secrecy assertions limited to lesson channels only.
- Local self-signed TLS generates noisy `SSLV3_ALERT_CERTIFICATE_UNKNOWN` workerd log lines during teardown; test results pass.
- Screenshots at `.opencode/pipeline/lessons-04-instructor-paced/e2e/` (gitignored, local only).

## App repairs (task04 E2E discovered)
- **Modal stacking**: `public/index.html` pointer interception blocked Go back click in early-submit confirmation; fixed to allow normal pointer clicks. No forced clicks, skips, or test bypasses in spec.

## Test repairs (task03 visible indicator)
- Task03 `realtime.spec.js` stale `Connected` exact-text checks updated to require visible `#lesson-connection` indicator with `● Connected` (text plus indicator), not weaker substring match.
