# Spec: lessons-00b-e2e-harness

## Goal
Build isolated, reproducible local browser harness and test sign-in, without shipping test authentication or changing production behavior. Complete brief task00b browser checkpoints through separate Test Developer, then independent review.

## Context
Read docs/lessons/BRIEF.md including Amendments, APPROVED PLAN.md, research.md here, and CLAUDE.md. User approved G1-A and G2–G6, local-only auth, pipeline .opencode path. Audit committed fb727eea. Research is evidence, not executable spec; corrections below override its unsafe/incomplete sketches. No Serena initial_instructions exposed; do not invent calls.

## Requirements
### Production seam and local auth (Developer)
- Minimal export/optional resolver seam on existing request handler. Production fetch always defaults to existing whoami; no test flag/token route/prefix branches or E2E imports in production entry. Preserve original error handling/security headers and all existing auth tests.
- Separate local-only entry/config imports production handler. Flag exact E2E_TEST_MODE='1' required BOTH for login issuance and every synthetic session resolution. Unset flag makes route404 and synthetic identities invalid, including prior sessions. Never fall back to production Supabase in local wrapper.
- Test login POST /api/e2e/login; body validates fixed account allowlist e2e-admin, e2e-student-1..4. Never accept arbitrary user_id/role. Origin and cross-site protections, malformed/oversized body handling, no-store response. Unsupported methods404 or explicit405 consistent tested choice.
- Bounded expiring server-held sessions with crypto-random unguessable token component. Research's deterministic e2e.<sub,exp>.e2e sketch is NOT acceptable as opaque authentication. JWT-shaped opaque envelope allowed solely to satisfy existing expOf cookie expiry; identity MUST resolve via server-held token map, not decoded claims. Validate expiry/bound; sessions lost on reload is documented limit, not feature work.
- Local login must return enough Supabase-shaped identity/session for browser fixture adapter and set valid cookie or support fixture bootstrap POST /api/auth/session BEFORE navigating /app. Initial /app navigation is already auth-gated; addInitScript alone cannot bypass it. Prove browser context cookies allow actual /app and bank loads without injecting Authorization on all requests to conceal broken auth flow.
- Seeded 'admin' is designated account only. No production role/admin APIs or migrations in00b.

### Isolation/config/package/seed (Developer)
- Separate Wrangler config WITHOUT production routes, Supabase credentials or remote bindings. Prefer clearly synthetic local D1 names/IDs over copying production IDs; do not change production IDs/config. All commands local with dedicated .wrangler/state-e2e; no use of existing populated state.
- Guard local entry to loopback host for test sign-in/resolver as additional safety; never listen publicly by default. No deploy commands (even accidental config deployment). Development process helpers must refuse production URLs.
- Exact Playwright version pin: research says registry1.63.0, reverify install availability. Add dependency+lockfile/scripts and correct Playwright config yourself. baseURL belongs inside use, not root as research sketch. No unrelated dependency upgrades.
- Developer owns root config and server runner. Test Developer never edits package/config/app. Provide real local enabled, flag-UNSET and production-entry targets for browser tests. Unset means truly missing, not '0'. Use isolated config/vars mechanism proven against current Wrangler docs; do not rename/delete user's .dev.vars or expose production vars. No attaching to arbitrary existing servers (reuseExistingServer=false or strictly verified explicit harness instance).
- Use Playwright-managed finite lifecycle server processes; clean child processes on exit. Dedicated ports; launch only local. Pass readiness conditions, no assumed sleep.
- Seed script initializes BOTH current schema snapshots, then idempotent owned data (core R&W MC, Math MC, Math SPR, AI+registry) and fixed users+membership; never historical migration replay over snapshot. Include distinct explanation/notes markers in fixture metadata for helper tests without inventing lesson tables. No external bank/crop required.
- Every seed/initialization command hardcodes validated local config+persistence and --local; refuse unsafe overrides. Do not overwrite unrelated data; stop owned dev processes before seed, fail with actionable message on active target where applicable.
- Ignore .dev.vars variants, state, downloaded browsers/results/screenshots/traces; artifacts only .opencode/pipeline/<task>/e2e/. Production deployment inputs must exclude local test entry/config/auth/fixtures, not only be unreachable. Test dependency remains devDependency.
- Developer unit tests: default production login route404 even injected flag; local route404 unset and no side effects; missing/wrong flag rejects existing tokens; same-origin/method/body/account validation; random tokens distinct, expire, map bounded; forged/non-session token401 without network; default whoami negative tests still pass. Test production import graph/bundle exclusion meaningfully; no actual deployment. Existing npm test remains command.

### Separate Test Developer scope
Fresh Developer spawn, never implementing instance. May edit only tests/e2e/**, E2E fixtures/seed data, and its pipeline e2e.md/artifacts. App/config/tool-runner bug => stop and report; Architect routes Developer repair then Test Developer full rerun. No writing app fixes directly.
- Load Playwright CLI skill; drive actual local site at1366x768 and capture screenshots for every checkpoint.
- Permanent specs tests/e2e/lessons-00b-e2e-harness/*.spec.js. Use root configured runner, not separate mock-only checks. Run task specs AND full E2E suite after changes/repairs.
- Browser-only Supabase adapter installed before page scripts; intercept only SDK and forbidden remote auth, preserving real DOM/app/HTTP/D1 logic. Local test login route must genuinely execute. Production entry/test authentication negatives use real local HTTP. No real Google OAuth claim.
- Block/assert production app and auth access, including roadto1600.org and configured Supabase origin; APIRequestContext must also target loopback. Intentional SDK substitution can fulfill a local stub to avoid fake console noise. KaTeX assets may be fetched from pinned public CDN or locally fulfilled exactly; no CSP weakening. No response-body read failure silently ignored.
- Multi-user helper creates independent contexts with per-user cookie/session state. Student profile1366x768; optional instructor dimensions supported. Demonstrate no session crossover.
- Offline helper uses context.setOffline, verified HTTP failure/recovery; no claim existing WS disconnected without actual socket exercise. CDP throttle helper exposes documented profile with correct byte/sec units and measured HTTP smoke; future WS latency must be measured in realtime tasks, not claimed now.
- Leak helper attaches to existing/future pages before navigation, collects HTTP response bodies and received WS frames including reconnects; explicit scoped predicates allow lesson-channel checks under G1-A. Structured key/unique-marker checks, not bare B/2. Capture decode/errors surfaced; distinct practice-bank baseline not asserted secret. Helper smoke must prove intentional marker/answer-key violation detected and benign choices not flagged; WS listener can be exercised with controlled local fixture transport (not lesson feature). Record transport limits truthfully.
- Wait on selectors/responses; no fixed sleeps where condition exists, no skipped/fixme/only or inflated timeout. Traces/screenshots ignored under task pipeline e2e dir; terminal result evidence in e2e.md.

## Exact E2E checkpoints (BRIEF §12.5)
**00b:** admin and a student sign in through the test route; question bank loads for both; the test route 404s with E2E_TEST_MODE unset.

Mapping (all required browser specs and CLI evidence):
C1 admin local login, initial /app authenticates, seeded name and rendered bank/questions including core+AI.
C2 student same in independent context, admin identity not inherited; actual renderer shows distinct MC choices and SPR input for seeded question.
C3 real local entry without E2E_TEST_MODE returns404 on login (Playwright request allowed for HTTP assertion); no unit-only substitute.
Additional security C4 real production entry with test flag set still404; no test route in deployed import graph. Unit complements browser evidence.
Helper checks: scoped HTTP+WS capture detects deliberate fixture leak without treating bank answers as lesson leak; independent contexts; offline recovery; explicit throttle profile smoke. Future lesson checkpoints not implemented here.

## Non-goals
No lesson tables/DO/sockets/roles feature, stats extraction, change to practice-bank answer exposure, schema/source columns, UI lesson controls, production auth relaxation, remote data, push/deploy/commit. No cosmetic cleanup or standing-doc rewrite.

## Implementation steps
1 Research done; Developer reads actual code and current docs, implements only above and unit checks. Reports exact files/commands/results/limitations in developer.md under this pipeline.
2 Fresh Test Developer builds CLI evidence, specs+helpers and e2e.md. Stops on app bug.
3 Reviewer inspects actual diff and checkpoint assertion mapping/full-suite evidence; read-only.
4 Repair blockers only via Developer, rerun full browser suite, re-review; maximum5 app/review repair rounds.
5 After PASS Documentation handoff + dated STATUS entry. No commit00b until explicit task completion approval; user approved audit00 only so far. Do not advance task01 in this task.

## Project gates
Stop for unresolvable local runtime/browser prerequisites, missing/failing checkpoint, changes outside approved scope or production security contract. Test harness is explicitly authorized dependency/config change. No defaults reopened. No production usage or deployment, including dry-run command named deploy; use local bundler API/import-graph proof instead.

## Validation
Existing npm test baseline43 passed from task00. Must run updated unit suite, seed idempotence, all above local targets, CLI checkpoints screenshots1366x768, task Playwright specs, full Playwright suite. Commands prefix rtk; Windows git.exe for diff/status. Content changes via specialized tools only (no shell Python writing). Preserve unrelated .omp/.serena/prompt/nul artifacts.

## Review focus
Auth seam safe; exact flag enforced on every synthetic identity; random bounded tokens; initial navigation/cookies not handwaved; production import graph excludes test files; strict local configs/seed; no bypass/prod access; renderer real and no roles built ahead; Test Developer diff limited; every checkpoint asserted and full suite ran. G1-A is approved but not excuse to narrow helper so it misses actual lesson payloads later.
