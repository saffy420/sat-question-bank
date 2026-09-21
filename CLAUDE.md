# CLAUDE.md — SAT Question Bank

## Working rules

- State assumptions and tradeoffs before coding; ask when requirements are unclear.
- Choose the smallest correct change. No speculative features, abstractions, dependencies or unrelated cleanup.
- Match nearby conventions; remove only dead code created by your change unless removal is requested.
- Define verifiable success criteria. Reproduce bugs before fixing them and check the same path afterwards.
- Preserve runtime behavior during documentation/cleanup work; obtain approval for contract changes.
- Keep this file standing guidance only, under 200 lines. Full original diary is `docs/history/dev-log.md`; it is historical evidence, not current instructions.
- Consult `docs/AUDIT.md` for source-level hazards and unavailable prerequisites; do not turn historical measurements into current production claims.
- Record discoveries outside this standing guide; verify the cause before treating a changed count as data loss.
- Use file read/write/edit tools for content changes, especially LaTeX and regexes; shell quoting has corrupted backslashes into control characters.
- Prefix shell commands with `rtk`. Use Windows `git.exe` for this checkout; WSL Git can report CRLF-only phantom diffs. Do not change Git configuration or normalize unrelated files.
- Do not deploy, mutate remote data, or commit without explicit authorization.

## Architecture and conventions

- `src/index.js` is the real server: a Cloudflare Worker, not a Node server. `public/index.html` is the single-file vanilla HTML/CSS/JS SPA with an inline IIFE; preserve existing helpers and test extraction markers.
- `wrangler.toml` binds `public/` as `ASSETS`, the main D1 as `DB`, and the separate AI bank as `AI_DB`.
- `schema.sql` defines core questions and all user data: users, progress, attempts, settings, notes, sessions, and `ai_ids`. `schema_ai.sql` defines AI questions, including `level`.
- `/api/questions` explicitly selects display fields and concatenates both banks; legacy OCR `stem_text` stays off the wire. AI query errors currently fall back to core-only results; a successful response does not prove AI availability.
- Account/progress/attempts/notes/settings/sessions routes use authenticated identity. Unsupported API paths/methods fall through to assets; do not assume JSON 404/405 handling.
- `/auth/callback` serves the SPA so Supabase consumes and persists its own URL session. Do not replace it with custom token storage or a redirect that strips the fragment.
- Custom 404 handling lives in Worker `asset()`. Do not substitute asset-router `not_found_handling = "404-page"`; that previously intercepted API and callback routes.
- The AI tutor/Gemini proxy is gone. Copy for AI is clipboard export with a selectable-text fallback, not a model API.
- `public/exams.json` contains fixed exam question IDs, not question bodies; `tools/build_exams.cjs` requires populated local databases.
- Package is ESM; standalone JS tools/tests use `.cjs`. Existing dependencies are Wrangler and `better-sqlite3`; some tools also need `node:sqlite` or Python packages not covered by a Python manifest.

## Coupled configuration and security

When changing Supabase project or canonical host, review these FIVE locations together:
1. `public/index.html`: browser `SUPABASE_URL` / `SUPABASE_KEY`.
2. `wrangler.toml`: `[vars]` `SUPABASE_URL` / `SUPABASE_ANON_KEY` (and custom-domain routes when changing host).
3. `src/index.js`: CSP `connect-src`.
4. `public/_headers`: CSP `connect-src`.
5. `src/index.js`: `www.roadto1600.org` -> `roadto1600.org` canonical redirect.

Adding or changing a domain later touches the same set: the two `[[routes]]`
patterns in `wrangler.toml`, the redirect hostnames in `src/index.js`, the Supabase
Site URL / redirect allowlist (must include the canonical origin and `/auth/callback`),
and `.env.example`'s `CANONICAL_HOST` / `WWW_HOST` checklist entries.

- Both CSP sources must agree: static assets can bypass Worker headers. Keep `frame-src https://www.desmos.com` in both for the SAT calculator embeds.
- Preserve `run_worker_first = ["/"]` in `wrangler.toml`; it prevents asset-first handling from bypassing the root canonical redirect without routing every crop through Worker. Other existing static assets can still bypass the redirect.
- Keep Supabase's allowed callback origin aligned with the canonical host and `/auth/callback`; cross-host auth loses origin-local sessions.
- Supabase URL and publishable key are public configuration. Never ship a service-role key or other secret.
- Identity comes from `whoami()` validating a bearer token through Supabase, never `X-User-Id` or a client-supplied owner. `looksLive()` checks shape/expiry only, not signature.
- Worker caches validated identities until token expiry; do not promise immediate access-token revocation on global sign-out.
- D1 account isolation is explicit `WHERE user_id = ?`, not row-level security. Keep question-write guards for both `questions` and `ai_ids`.
- Keep rejected authentication distinct from an empty account: protected reads return 401, not empty successful data.
- Escape user/account text before HTML interpolation. Question HTML is trusted imported content; audit imports because it reaches `innerHTML` under an inline-enabled CSP.
- Preserve pinned CDN integrity attributes and matching CSP origins. Do not add `unsafe-eval` for browser test harnesses.

## Data sources and availability

- The populated core bank, source PDFs and core baseline dump are absent from Git. Tracked UPDATE migrations cannot reconstruct the full bank or insert missing rows. This working copy has an ignored recovery from `https://helpmeaceit.page/api/questions`; fresh clones still need an external data source. The endpoint supplies display fields, not legacy `stem_text`, and availability is not guaranteed.
- Core source PDFs are `OfficialSatMath.pdf` and `OfficialSatReading.pdf`. Join using printed `Question ID` and `questions.id`; historical `source_page` values are unusable, so do not assume a page index is available.
- Extraction produces content and crops, not the complete metadata baseline. `tools/apply_math.cjs` UPDATEs existing IDs and leaves section/domain/skill/difficulty/source untouched. `tools/d1_dump.cjs` exports an existing bank; it cannot supply absent data.
- Personal Bluebook practice-test rows were deliberately removed from the shared bank. Do not restore them merely to match an obsolete README or diary count.
- `tools/aiq/*.jsonl` ships 400 complete AI-authored records: 300 Reading & Writing and 100 Math across 17 files. These tracked files are the source of record and are importable, not automatically imported by package scripts.
- `tools/apply_ai.cjs` validates and upserts AI questions into initialized local `AI_DB`, registers IDs in main `DB.ai_ids`, and emits `d1_ai/questions.sql` plus `d1_ai/ids.sql`. D1 cannot join across the two databases; keep the registry synchronized.
- AI rows use `source='AI'`, `difficulty='Hard'`, levels 4–5; official levels derive from Easy/Medium/Hard = 1/2/3. Preserve labels distinguishing AI from College Board material.
- `public/qimg/` is gitignored: recovered locally, absent from fresh clones. Fetch referenced crops separately from question JSON. Do not infer current asset counts or sizes from historical diary measurements.
- `.wrangler/`, extraction outputs, backups and generated import SQL are not a reproducible core seed. Check actual prerequisites rather than assuming a sibling worktree has them.
- Preserve the College Board personal-study license notice. Legal text in the SPA remains draft boilerplate with a `LEGAL_CONTACT` placeholder, not reviewed launch-ready policy.

## Database and deployment safety

- Stop all `wrangler dev` processes before direct local SQLite edits/imports: in-memory state can flush over external changes on shutdown.
- Verify database identity before using helpers: several choose the first SQLite file or hardcode a filename, while two databases now exist. Changing `database_id` re-keys Miniflare storage and may leave stale populated files behind.
- Schema snapshots already include some historical ALTERs. Do not blindly apply every migration over `schema.sql`; duplicate 0005/0009 prefixes serve different purposes, and AI migrations have separate storage requirements.
- Re-extraction overwrites repaired content. Inspect and reapply the relevant math-text, choice-table, answerability and underline repairs; regenerate complete intended deltas rather than empty second-run diffs.
- Back up before destructive data changes. For table replacement, load and verify staging before swapping; check references and user data first.
- Verify deletions by the deleted predicate, not by an unaffected total. Verify remote changes against the deployed endpoint as well as the database/tool output.
- D1 row-write budget is account-wide; adding a database does not increase it. Avoid writes in read paths. Current exceptions must be acknowledged: account GET calls `touchUser`, sessions GET purges the caller's records older than 30 days.
- `touchUser` is cached once per user per isolate. Progress GET does not call it; preserve this distinction to avoid making saved answers unreadable when writes fail.
- `npm run deploy` uploads code/assets, not SQL migrations. Use its predeploy hook rather than bypassing it with direct Wrangler deploy.
- `tools/predeploy.cjs` rejects missing crops, symlinks/junctions, and directories with fewer than 4,000 entries. That threshold is a guard, not a measured asset count or proof of completeness.
- Deploy only with a real crop directory; Wrangler's asset walker can omit junction contents even when ordinary file listing sees them. Verify the uploaded manifest and actual image responses.

## Client state, grading and rendering

- Derive grid-in from empty parsed choices: `q.spr = !q.choices.length`, never a type/qtype column. Invalid choices JSON also becomes empty choices, so investigate extraction failures masquerading as grid-ins.
- Use `explanation_html`, not obsolete `rationale_html`; use `source`, not obsolete `label`.
- Keep `isRight()` semantics: fractions, alternative numeric answers, rounded/truncated grid precision at three or more decimals, and null for unscorable answers. Do not score unscorable questions as wrong.
- Practice selects before Check. First Check updates progress; every scored Check appends an attempt. Retry must not reveal unselected correct choices or turn repeated guesses into first-try success.
- Green is correct, Red needs work, Orange is corrected. Count Orange as correct in current-state accuracy; derive activity history from attempts, not overwritten progress timestamps.
- Update `PROG`/`LOG` before `refresh()` so dashboard, topic counts and mistakes agree immediately. Keep `tally()` shared and calendar activity keyed to local days.
- Guest answers are memory-only; do not resurrect the removed localStorage guest merge. Await auth initialization before loading account state; await live `sbHeaders()` for protected requests.
- Failed reads must not overwrite account settings with defaults. Progress/log backfills are in-memory only, and stored progress always wins.
- Retry queues keep attempts append-only and dedupe state by `question_id || id`; failures must remain visible without blocking alerts. Do not treat current queue code as a lossless guarantee; audit records known races and batch-limit mismatches.
- Filters use `null` for all and `[]` for none; preserve old-storage migrations and separate practice/Browse/Mistakes state. Use `cbSort()` with domain/skill order instead of alphabetical taxonomy.
- Focus selection weights weak skills and balances levels across the whole set; balancing within each skill alone can leave no harder questions for the ladder. Two correct promote, a miss demotes, bounded at levels 1–5.
- Practice-exam scores are estimates, not official Bluebook scoring. Preserve estimated-score disclosure; exam completion uses shared progress/attempt recording. Guests do not gain durable History.
- Notepad, explanation and Desmos share docking space; opening one closes competing panels. Retry explanation auto-open waits until closure or explicit give-up, not the first live miss.
- KaTeX renders `\( ... \)` and `\[ ... \]`, not dollar delimiters. Load it before inline initialization; money must remain prose.
- `tidyExpl`/`tidySpace` must preserve non-whitespace content, lists, images and math. Run punctuation spacing after paragraph repair; leading-dot decimals are not punctuation artifacts.
- Keep figure/table context splitting and responsive single-scroller layout. Choice figures must not open the lightbox, and highlighting must not select/grade a choice.
- Preserve dark-mode distinction: notation crops may invert; colored figures need their colors and a light plate. Test compact choice tables in the real player, not only Browse previews.
- Copy for AI must retain absolute image references, table structure, line breaks, underlining and LaTeX; naive tag stripping loses answer-critical information.

## Extraction and authored-content gotchas

- PDF prose is extractable without OCR; vector math requires geometry/glyph decoding. Raster notation stays cropped when uncertain: plausible wrong math is worse than a correct image. Raster matching remains an experiment, not production extraction.
- Group text by vertical overlap, preserve inferred spaces, and bucket figures into stem/choice/rationale bands using page plus position. Apply the metadata-banner cutoff only on the first page.
- Reconstruct tables before rejecting prose-overlapping figure clusters. A rationale crop may be the only copy of covered text; never delete it merely because it looks redundant.
- Choice-band tables/figures need per-choice ownership; compare actual choice content, not just nonempty output. Continuation pages, bare choice letters and art overlapping labels require geometry-aware handling.
- Underlines are drawn rectangles, not font attributes; distinguish table ruling and repeated words in passage versus prompt.
- Parse/fix/stringify `choices_json`; do not regex-rewrite escaped JSON blindly. In HTML math use `\lt` or an entity rather than bare `<` before a letter.
- AI graphs are inline SVG with `viewBox`, `role="img"`, title and theme-aware colors, not new qimg assets. Preserve trap vocabulary and per-choice rationale structure.
- When balancing answer letters, move content, trap tags, rationale paragraphs and references together in one pass. Use `Choice X` cross-references; bare letters evade the rebalancer.
- Structural validation cannot prove a unique correct answer or sound distractor reasoning. Read items and recompute derivations; Math text-similarity scans can confuse boilerplate with duplicates.

## Verification boundaries

- `package.json` provides dev/deploy/predeploy only. User confirms no lint or typecheck commands; do not invent them. Consolidated test runner work is deferred to Phase 4.
- Existing standalone `test_*.cjs` and tool self-checks are the available checks; inspect prerequisites and scope before running. Preserve source-block markers used to lift real functions instead of copied implementations.
- Use the actual player's render/grading path for UI verification. Check distinct choices, correct grading, figures, tables, underlines, dark/light themes and narrow screens, not only empty output or console errors.
- Re-query choice nodes after Check; grading replaces them. Next may first open an explanation: assert exact position changes and count skipped questions.
- Exclude KaTeX subtrees when checking raw TeX or authored SVGs; its hidden source annotations and generated SVGs are intentional. DOM-decoded math is the validation target, not raw HTML entities.
- Scope selectors to the active tab; hidden screens share the document. Use question IDs/session state rather than rendered stem text to identify questions.
- Server readiness is not proof of populated-bank functionality. Do not claim production, signed-in isolation, full-bank sweeps or real-phone touch behavior without exercising them and having prerequisites.
