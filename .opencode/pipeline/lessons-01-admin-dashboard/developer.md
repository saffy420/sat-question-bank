# Developer report — lessons-01-admin-dashboard

## Repair round 2/5 — 2026-09-24 (review six findings)

Compared with `git.exe show 00cebf32:public/index.html`; assertions in `tests/test_grade.cjs` lift live `grade()`/`renderAnswerArea()` and compare actual baseline `choiceHTML`. No Playwright specs changed.

1. **MC stale Check — refuted.** `public/index.html` binds `Check` to its own choice letter; click selection removes other Check buttons, keyboard selection calls `renderAnswerArea()` and replaces old choice DOM/buttons, highlight click returns before selection. Runnable assertions click A→B→Check B, keyboard-equivalent state change→re-render→Check B and highlight click; all grade B/current selection or leave selection unset. No UI logic change.
2. **Retry history alias/reset — refuted.** `recordAttempt()` serializes history into a string, `saveLog()` snapshots queued rows, and `grade()` clears `S.history[q.id]` after logging *including keep-open retries* (`public/index.html` grade block). Runnable wrong A→Check then B→Check asserts first persisted history stays `[A]`, second `[B]`, fresh retry history empty. No history logic change.
3. **SPR switch double-count — refuted.** `rememberAnswer()` increments `S.changes` only if new answer differs from last; `onchange(2)`, `onchange(3)`, submit(3), grade(3) yields history `[2,3]` and `changes=1`. Runnable assertion passes. No switch logic change.
4. **choiceHTML graph/paragraph regression — refuted.** Baseline `isGraphImg` true and false arms emit identical `<img src="…" alt="Choice …">`; extracted renderer uses same output and identical `<p>` replacement. Runnable exact-markup equality against `git.exe show 00cebf32:public/index.html` for `_a.png`, other SVG image, multi-paragraph content. No choiceHTML change.
5. **normalizeQuestion — partially confirmed, fixed actual ordering.** Browser caller already decoded stem/explanation/choice content and blank-letter fallback used `trim()` (did not trim nonblank letters); reviewer assertions about missing cleanup/letter trim were inaccurate. Real regression: extracted `normalizeQuestion()` interpreted an MC answer prefix before caller `demoji`, so mojibake em-dash (`B ΓÇö reason`) stayed unshortened. Red test failed on that answer; moved existing `demoji` table into shared stats and decode answer before prefix extraction, decode choices in same shared normalizer, keep browser stem/explanation cleanup. Passing regression covers mojibake prefix/content, blank-letter fallback, SPR alternative fallback. No nonblank letter trimming (not baseline behavior).
6. **Duplicate read-only preview composition — confirmed, fixed.** Browse and admin previously assembled stem/choices/explanation separately; both now call `public/shared/renderer.js` `previewHTML(q, document, picked?)` using existing `renderStem`, `splitContext`, `choiceHTML`. Browse retains correct answer display; admin retains disabled SPR and labeled student/correct answer. Runnable assertions check MC/explanation/SPR/figure markup and both callers. Player rendering unchanged.

**Files edited round2:** `public/index.html`, `public/shared/stats.js`, `public/shared/renderer.js`, `public/admin.js`, `tests/test_grade.cjs`, this report. **Red-before-green:** `rtk node --test tests/test_grade.cjs` failed on mojibake MC answer (`'B ΓÇö reason'` vs `'B'`); passed after fix. Final `rtk npm test`: **51/51 passed**; `rtk node --test tests/test_grade.cjs tests/test_metrics.cjs tests/test_admin.cjs tests/test_sync.cjs`: **8/8 passed**; `rtk node --check public/admin.js public/shared/stats.js public/shared/renderer.js src/index.js` passed; `rtk git.exe diff --check` passed with existing CRLF warnings. No commit/push/deploy/remote mutation. Test Developer owns full browser rerun.

## Repair round 1/5 — 2026-09-24

- Reproduced C4 from Test Developer `e2e.md`, `practice.spec.js:30`, failure screenshot and error context. Added unit regression using real `bars()` and `renderAnswerArea()` lifted from SPA plus `grade()`; before fix `rtk node --test tests/test_grade.cjs` failed with `ReferenceError: cbIdx is not defined` in `bars()` during `refresh()`.
- Cause: task01 stats extraction removed inline `cbIdx` in favor of shared `cbSort`, but `bars()` still referenced removed `cbIdx`. `grade()` set `S.checked`, recorded answer, then `refresh()` threw before final `renderAnswerArea(q)` could populate `#spr-verdict`. Grader and `isRight()` were correct. Same path affects any scored Check whose dashboard has at least two attempted taxonomy buckets.
- Fix: `bars()` now sorts attempted bucket keys through imported shared `cbSort`; no duplicate taxonomy logic. Regression asserts checked SPR input and `✓ Correct` after dashboard refresh. Changed only `public/index.html`, `tests/test_grade.cjs`, this report; Playwright specs untouched.
- Checks: `rtk node --test tests/test_grade.cjs` red before fix, green after; `rtk npm test` **51/51 pass**; `rtk node --test tests/test_grade.cjs tests/test_metrics.cjs tests/test_focus.cjs tests/test_admin.cjs tests/test_sync.cjs` **9/9 pass**; `rtk node --check public/shared/stats.js` and `rtk node --check src/index.js` pass; `rtk git.exe diff --check` no whitespace errors (CRLF warnings only).
- Browser C4 and full E2E suite not run by Developer; separate Test Developer must rerun both and complete remaining C2/C3 checks. No commit/deploy/remote change.

Date: 2026-09-24
Scope: task01 only. No Playwright specs authored. No commit, push, deploy, or remote mutation.

## Implemented

- Core migration `migrations/0007_admin_history.sql`: `users.role` constrained to `student`/`admin`, default student; nullable `attempts.answer_history_json`. Mirrored in `schema.sql` for fresh initialization. Isolated E2E seed detects existing pre-0007 state and applies the upgrade before snapshot/fixture SQL.
- `ADMIN_EMAILS` is comma-separated, trimmed, case-insensitive and matched only against the server-validated identity during `POST /api/auth/session`. Empty/blank config promotes nobody; DB role is authoritative until the next session POST; removal demotes then. Client role/body fields are ignored. Production `wrangler.toml` value remains blank; local E2E config owns `e2e-admin@e2e.test`. Membership rules remain approved/pending, with denied rejected.
- Central authorization before unknown-route fallthrough:
  - unauthenticated `/api/admin/*`: 401;
  - member student: API 403, `/admin` and `/admin.js` redirect to `/app`;
  - admin unknown API: 404;
  - `/admin`, descendants, `/admin.html`, and `/admin.js` share role checks and fail closed 503 on role/database failure;
  - `/admin` shell asset is served only after authorization; direct alias redirects to canonical `/admin`.
- Admin API is GET-only and read-only: bounded validated page/sort/search inputs, allowlisted sort fields, bound IDs, private/no-store responses, escaped client text, no `touchUser`/account writes, and no raw client-selected SQL sort.
- Shared computation:
  - `public/shared/stats.js` owns existing tally/weakness/metrics plus new derivable views. Student dashboard/focus and Worker admin routes import it; existing inline duplicates were removed.
  - `public/shared/renderer.js` owns existing stem/choice/context rendering and shared `isRight` via stats; practice and read-only admin preview call it.
  - Definitions remain distinct: Orange is correct for current-state accuracy; historical accuracy is attempt-based; null/unscorable answers are excluded.
- Prospective history is required now: practice captures ordered MC/SPR selections before grading, stores validated `answer_history_json` with attempt snapshots, preserves legacy `null`, supports queue round-trips/acknowledgments, and grades first/final direction with unchanged `isRight`. Malformed/oversized/non-monotonic/mismatched sequences are rejected at the API boundary.
- Admin shell and all current-data tabs: searchable/sortable/paginated Students list; detail Overview, By skill, Mistakes (filters + read-only renderer preview), Traps, Pacing, Second-guessing, History (genuinely paginated), and honest Lessons unavailable until task09. Lessons/Live/Question Bank sidebar sections are clear unavailable placeholders.
- Local owned fixtures include an admin, approved/pending roster, zero-activity student, Orange/Red/Green state, traps, prospective and legacy attempts, deterministic timing/trends, and enough attempt rows for pagination.

## Commands and results

- `rtk npm test` — 51 tests, 51 passed, 0 failed.
- Focused `rtk node --test tests/test_admin.cjs tests/test_auth_routing.cjs tests/test_grade.cjs tests/test_metrics.cjs tests/test_focus.cjs tests/test_sync.cjs` — 43 tests, 43 passed, 0 failed.
- `rtk node --check src/index.js public/admin.js public/shared/stats.js public/shared/renderer.js` — passed.
- `rtk git.exe diff --check` — no whitespace errors (Windows Git may report future-CRLF warnings).
- `rtk node tools/e2e_seed.cjs` — passed against isolated `.wrangler/state-e2e`, including fresh/upgrade-aware core schema handling.
- Serena `initial_instructions` was unavailable to this parent session; no claim it loaded.

## Changed files

Modified:

- `.env.example`
- `.opencode/pipeline/lessons-00b-e2e-harness/handoff.md` (pre-existing task00b continuation edit preserved; not authored by this task)
- `playwright.config.js`
- `public/index.html`
- `schema.sql`
- `src/index.js`
- `tests/test_auth_routing.cjs`
- `tests/test_e2e_auth.cjs`
- `tests/test_focus.cjs`
- `tests/test_grade.cjs`
- `tests/test_metrics.cjs`
- `tools/e2e_ai.sql`
- `tools/e2e_core.sql`
- `tools/e2e_seed.cjs`
- `wrangler.e2e.toml`
- `wrangler.toml`

New:

- `migrations/0007_admin_history.sql`
- `public/admin.html`
- `public/admin.js`
- `public/shared/stats.js`
- `public/shared/renderer.js`
- `tests/test_admin.cjs`
- `.opencode/pipeline/lessons-01-admin-dashboard/developer.md`

Untouched unrelated untracked files include `.omp/`, `.serena/`, `docs/roadto1600-lessons-prompt.md`, `nul`, and odd root files.

## Caveats / readiness

- Prospective direction covers attempts written after task01; legacy attempts honestly report unknown.
- Official trap metadata is sparse; Traps states the tagged denominator.
- List stats are computed for a bounded club roster (501-row guard) before server sorting; upgrade to SQL aggregates if membership grows beyond 500.
- No browser evidence claimed by Developer. Fresh Test Developer can start from isolated `rtk node tools/e2e_seed.cjs` and `npm run dev:e2e`; configure Playwright output with `PLAYWRIGHT_OUTPUT_DIR=.opencode/pipeline/lessons-01-admin-dashboard/e2e/results` if desired. The default remains the prior task00b output path.
