# Approved cleanup plan

Phase 1 audit approved. Stop for review after Phase 2; later phases require continuation. No features, runtime fixes, UI split, or presentation mode. Preserve College Board personal-study license note. Commit each phase without force-pushing; verify local `npm run dev` startup after each phase. No lint/typecheck exists or will be added; Phase 4 adds only the test runner.

## Phase 2 — standing instructions

Archive original CLAUDE.md verbatim in `docs/history/dev-log.md`; keep current standing instructions under 200 lines in CLAUDE.md. Record deferred contract bugs in `docs/KNOWN-ISSUES.md`, severity-ranked, session batch mismatch first. Stop for review.

## Phase 3 — historical plans

Move whole `docs/superpowers/` directory into `docs/history/`; preserve contents.

## Phase 4 — tests

Move nine root test files to `tests/`, add a working default Node test runner, separate clearly marked network/live-D1 integration tests. Report pass/fail/dead tests. Fix trivial breakage without changing assertions.

## Phase 5 — migration classification

Classify EVERY migration by SQL contents before moving anything, not by size. Separate schema from one-time data repairs against existing rows. Preserve SQL bytes, make schema numbering strictly sequential, document old-to-new mapping in history. Put repairs in `data-fixes/` with a README explaining they are not fresh-setup seeds.

## Phase 5b — verified bootstrap

Write `docs/BOOTSTRAP.md` with an ordered fresh-D1 recipe: exact schema files, subsequent migrations in order, skipped files and reasons, complete 400-question AI import, and explicit statement that core bank remains empty. Verify against scratch local D1 and report resulting row counts. Snapshot already contains `picked`/`changes`; do not replay conflicting additions. Prefer documented ordering without SQL changes; stop and ask if ordering cannot suffice.

## Phase 6 — coordinated configuration

Archive original values as reference; replace author-specific database IDs, auth settings and custom-domain configuration with clearly marked placeholders. Treat these five locations as one change-set: browser Supabase constants, Wrangler vars, Worker CSP connect-src, static CSP connect-src, Worker canonical-host redirect. Wrangler custom-domain routes must also match. Add `.env.example` and concise `docs/SETUP.md` describing required own-account resources.

## Phase 7 — README truth-up

Use three distinct statements near the top:

- The core bank (~3.8k official questions) is NOT in this repo and cannot be reconstructed from it. Repair migrations contain core question content only as UPDATEs against rows that must already exist.
- 400 AI-authored questions DO ship in `tools/aiq/` and are importable via `tools/apply_ai.cjs`.
- `public/qimg/` figure crops are gitignored, not present. Do not repeat unverifiable historical file counts or sizes.

Describe PDF extraction and its missing baseline/metadata prerequisites honestly. Retain accurate feature/schema documentation; replace custom-domain walkthrough with pointer to SETUP.

## Phase 8 — optional, not authorized

Skip UI map unless explicitly requested. Do not split `public/index.html`.

## Deferred behavior defects

Nine audit contract findings belong in KNOWN-ISSUES, not this cleanup. No fixes authorized. Session endpoint changes require particular care because later work will build on them.
