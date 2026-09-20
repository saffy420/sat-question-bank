# Phase 1 audit

## Scope and fork

Baseline: `cb9fac1b` (`main`), inspected 2026-09-20. Work branch: `cleanup`.

- `origin`: https://github.com/saffy420/sat-question-bank.git
- `upstream`: https://github.com/DailyDoseOfStuff/sat-question-bank.git
- Fork created with `gh.exe repo fork DailyDoseOfStuff/sat-question-bank --clone --remote` (Windows CLI invoked from WSL).
- Read in full: `src/index.js` (387 lines), `public/index.html` (4,057), `wrangler.toml` (42), `schema.sql` (83), `.gitignore` (40). Also inspected package scripts, README, tools, migrations, tracked inventory and historical references.
- No application code, configuration, SQL, tests, data or existing documentation changed. Nothing deleted. No deployment or remote database operations performed.
- Phase 0 changes only Git/GitHub metadata; no file change exists to commit separately. This phase's audit commit records the fork and baseline; no empty commit created.

## Critical correction: data and insertion

**The assertion that nothing inserts question rows is false. So is the proposed blanket statement that no question data ships.** A fresh checkout has no populated local question database or core-bank baseline dump, but it includes 400 complete AI questions and core question content inside UPDATE migrations.

- `tools/apply_ai.cjs:235-247` inserts/upserts AI `questions` into local SQLite; line 257 emits equivalent SQL for D1.
- `tools/d1_dump.cjs:27` generates core question INSERT statements from an existing local bank. It is an exporter, not a source of missing data.
- `test_worker_sql.cjs:9-11` inserts a synthetic question into an in-memory test database, not a production seed.
- `tools/aiq/` has 17 tracked JSONL files: four Math files with 25 records each, RW files 01/02 with 13/12 records, and RW files 03–13 with 25 each. Total: 100 Math + 300 RW. Full examples: `tools/aiq/math_01.jsonl:1`, `tools/aiq/rw_13.jsonl:1`.
- `.gitignore:29-31` explicitly preserves these authored AI sources. They are not automatically imported by any package script (`package.json:6-10`).
- Core repair SQL contains real stems, choices, answers and rationales, e.g. `migrations/0006_math_answerable.sql:5-6`. UPDATEs against an empty table insert nothing.
- No tracked source PDFs, core baseline dump, local SQLite state or `public/qimg/` crops. The historical ~5,528 crops / ~44 MB claim is not measurable from this checkout. `.gitignore:6` excludes crops.
- `tools/extract.py:3-7,1007-1013` extracts PDF content and crops but omits metadata; `tools/apply_math.cjs:20-30` updates existing IDs only. Extraction alone cannot reconstruct the complete core bank from an empty schema. A baseline/metadata import path is still needed.
- `public/exams.json` contains selected question IDs, not question bodies (`tools/build_exams.cjs:1-9`).

### Complete INSERT search in requested scopes

Case-insensitive whole-word search across `migrations/`, `schema.sql`, `schema_ai.sql`, and `tools/` found five SQL occurrences and eight non-SQL occurrences. `migrations_ai/` was checked additionally.

| Location | Target and action |
|---|---|
| `tools/apply_ai.cjs:235` | Prepare local AI question upsert; executed at 245–247 |
| `tools/apply_ai.cjs:244` | Prepare core `ai_ids` registration; executed at 248; not question content |
| `tools/apply_ai.cjs:257` | Generate AI question INSERT/upsert SQL |
| `tools/apply_ai.cjs:267` | Generate core `ai_ids` INSERT SQL |
| `tools/d1_dump.cjs:27` | Generate core question INSERT SQL from existing local rows |

No INSERT matches in either migration directory or either schema file. Non-SQL matches: `sys.path.insert` in `tools/extract.py:20`, `rastercheck.py:16`, `rastercover.py:12`, `rastersweep.py:14`, `try.py:7`, `underline.py:30`, `why.py:6`; prose in `tools/pdfcommon.py:68`.

Outside those scopes: Worker INSERTs only write `users`, `progress`, `attempts`, `notes`, `settings`, and `sessions` (`src/index.js:118,214,255,290,327,355`). The AI implementation plan also contains sample question INSERT code (`docs/superpowers/plans/2026-09-07-ai-question-bank.md:360,379`). README and diary references to INSERT dumps are descriptions, not executable seeds.

## Worker routes

All line references in this table are to `src/index.js`. Protected routes call `whoami()` and return 401 on rejected/missing identity. `whoami()` prefilters JWT expiry then resolves identity through Supabase `/auth/v1/user`, caching by token (73–101). There is no client-supplied user-ID authority.

| Method | Path / match | Auth | Behavior | Lines |
|---|---|---|---|---|
| Any reaching Worker | Host `www.helpmeaceit.page` | Public | 301 to apex, retaining path/query; before all other branches | 148–157 |
| GET | `/api/questions` | Public | Core questions plus optional AI questions; AI query errors silently produce empty AI list | 159–182 |
| GET | `/api/account` | Required | Upsert user, return user row; this GET writes | 184–190 |
| GET | `/api/progress` | Required | Caller progress rows | 192–199 |
| POST | `/api/progress` | Required | Upsert known question IDs; row/array, max 500; stars use maximum | 201–227 |
| GET | `/api/attempts` | Required | Caller attempts ordered by timestamp | 232–239 |
| POST | `/api/attempts` | Required | Insert-or-ignore known question attempts; max 500; account cap 100,000 | 241–265 |
| GET | `/api/notes` | Required | Caller notes | 270–276 |
| POST | `/api/notes` | Required | Upsert trimmed note, or delete empty note; max 500, body max 4,000 chars | 278–302 |
| GET | `/api/settings` | Required | Parsed JSON settings, or empty object | 307–317 |
| POST | `/api/settings` | Required | Object-only JSON blob; 8,000-character limit | 319–331 |
| GET | `/api/sessions` | Required | Delete caller sessions older than 30 days, then return remaining; GET writes | 333–344 |
| POST | `/api/sessions` | Required | Upsert session state; max 50, state max 65,536 chars | 346–367 |
| DELETE | Prefix `/api/sessions/` | Required | Delete caller session by raw pathname suffix | 369–375 |
| Any | `/auth/callback` | Public | Internally serve app asset `/`, not an HTTP redirect | 377–383 |
| Any unmatched | Asset fallback | Public | Delegate to ASSETS; custom `/404.html` on missing asset | 385; helper 50–60 |

There are **14 explicit API method/path branches**, plus host redirect, callback and fallback. No `/api/chat`, Gemini proxy, generic proxy, explicit OPTIONS handler, or JSON API 404/405 branch exists. Unsupported API methods and unknown API paths fall into asset handling.

Static dispatch: `wrangler.toml:16-23` binds `public/` as ASSETS and sends `/` through Worker first. Existing non-root assets can be served before Worker; the host redirect therefore does not cover every static asset request. `/exams.json` is a tracked static asset, not a missing Worker route. Callback loads the SPA for Supabase URL-session detection (`public/index.html:3935-3943`).

## Every explicit page fetch()

Seven syntactic call sites; shared helpers expand to the endpoints below. Lines refer to `public/index.html`.

| Call line | Method | Target(s) | Authentication / behavior |
|---|---|---|---|
| 1067 | POST | `/api/settings` | Await bearer headers; skips signed-out; does not inspect HTTP status |
| 1184 | GET | `/api/progress`, `/api/notes`, `/api/attempts`, `/api/sessions` | Helper targets at 1190,1192,1196,1198; bearer; checks status |
| 1256 | GET | `/api/settings` | Bearer; checks status; successful empty object triggers initial save |
| 1328 | POST | `/api/progress`, `/api/attempts`, `/api/notes`, `/api/sessions` | Queue keys 1287; bearer, JSON, keepalive; batches up to 200; retries failed status |
| 1369 | DELETE | `/api/sessions/` + `encodeURIComponent(id)` | Bearer; optimistic local deletion, no status check or retry |
| 1400 | GET | `/api/questions` | No explicit bearer; parses without checking status |
| 1438 | GET | `/exams.json` | Static asset; parses `.tests`, failures become empty exam list |

**No page API method/path is missing from Worker.** Worker `GET /api/account` has no explicit page fetch caller.

Not explicit fetch sites: Supabase SDK authentication/session/sign-out calls (3924–4014), CDN resources (10–23), and Desmos iframe (3419–3460). Copy for AI is clipboard export, not a network model call (3839–3912). Worker itself performs outbound Supabase identity fetch (`src/index.js:93-95`) and ASSETS fetches (51,53).

### Contract mismatches and risks — recorded, not changed

1. **Session batch 200 versus 50:** client sends up to 200 and removes the entire batch after any OK response (`public/index.html:1288,1325-1335`); server slices to 50 (`src/index.js:352`). Queued remainder can be lost.
2. **Acknowledgement is input count, not rows written:** unknown IDs/duplicate attempts may write nothing but still contribute to `saved` (`src/index.js:213-226,254-264`). Client checks status only.
3. **Session ID encoding differs:** browser encodes ID; Worker uses raw pathname suffix (`public/index.html:1369`, `src/index.js:373`). Normal generated IDs avoid this, arbitrary IDs may not.
4. **Settings/deletion failures hidden:** HTTP errors are not checked at page lines 1067–1072 and 1367–1370.
5. **Queue replacement during inflight send:** replacing pending state at 1308–1312 and later splicing by count at 1335 can drop newer data. Account changes do not reset these queues, and sending resolves the current token (1177–1189,1287–1331,3945–3948). Source-level risk, not runtime-reproduced.
6. **Comments overstate auth revocation:** sign-out comment promises token rejection, but Worker identity cache persists until token expiry (`public/index.html:3952-3959`, `src/index.js:81,87-100`).
7. **GET-write exception:** `touchUser()` comment says writing routes only, but account GET calls it; session GET also purges rows (`src/index.js:106-110,184-188,338-339`).
8. **AI errors hidden:** AI query failures return successful core-only bank (`src/index.js:167-180`). Missing core schema instead fails the core query.
9. Cache headers exist, but actual deployed edge caching was not measured (`src/index.js:174-181`).

## Tool reachability

Inventory: **13 CommonJS + 12 Python tools**. Only `predeploy.cjs` is npm-wired. README explicitly names only `d1_dump.cjs`; it describes extraction generally. No CommonJS tool imports or spawns another project tool. Comment references are not executable edges.

“Historical” below means documented manual use, not an active package entry point. “Orphan candidate” means no external caller/documentation mention found beyond ignore rules; absence is not proof that deletion is safe.

### CommonJS

| Tool | Inbound reference / reachability | Purpose and prerequisites |
|---|---|---|
| `predeploy.cjs` | `package.json:9` | Deploy hook; real non-symlink crop directory with >=4,000 entries (`tools/predeploy.cjs:8-25`) |
| `d1_dump.cjs` | `README.md:48`; `CLAUDE.md:520` | Export existing core DB into `d1_sync`; hardcoded SQLite filename (`tools/d1_dump.cjs:4-27`) |
| `apply_math.cjs` | Historical `CLAUDE.md:457,995,1177` | Update existing core rows from extraction JSONL; emit `d1_chunks` (tool lines 9–42) |
| `fix_math_text.cjs` | Historical `CLAUDE.md:749,998,1177`; comments in `apply_choice_tables.cjs:42`, `apply_answerable.cjs:129` | DB repair / migration 0002 emitter; hardcoded SQLite path (180–229) |
| `apply_choice_tables.cjs` | Historical `CLAUDE.md:1084,1178`; comment `apply_answerable.cjs:128-133` | Repair existing DB, backup, emit math migration 0005 (87–135) |
| `apply_answerable.cjs` | Historical `CLAUDE.md:1171,1178` | Repair DB; needs `tools/math_new.jsonl`; emits 0006 (87–149) |
| `audit_math.cjs` | **Orphan candidate** | Read supplied/default extraction JSONL; default missing (9–20) |
| `apply_ai.cjs` | Spec `docs/superpowers/specs/2026-09-07-ai-question-bank-design.md:70-71`; `CLAUDE.md:2200,2291`; `migrations/0009_ai_bank.sql:10`; AI tool comments | Validate/import tracked AI JSONL; two initialized local DBs needed for import; emit SQL (182–268) |
| `audit_ai.cjs` | Historical `CLAUDE.md:2353`; `fix_ai_reasoning.cjs:4,318` | Audit tracked AI source; no DB needed (226–244,293–294) |
| `balance_ai_answers.cjs` | Historical `CLAUDE.md:2339,2533`; comments `audit_ai.cjs:205`, `fix_ai_reasoning.cjs:21` | Rewrite tracked AI source (85–100,146–147) |
| `fix_ai_defects.cjs` | **Orphan candidate** | One-off exact-string AI repair; rewrites source, no dry-run branch (95–136) |
| `fix_ai_reasoning.cjs` | Historical `CLAUDE.md:2504` | One-off exact-string AI repair; rewrites source (432–473) |
| `build_exams.cjs` | Plan `docs/superpowers/plans/2026-09-17-practice-exams-ui-fixes.md:194-219`; corresponding spec line 65; `CLAUDE.md:2651` | Build tracked `public/exams.json`; two hardcoded SQLite paths and `node:sqlite` (10–38,134) |

### Python

| Tool | Inbound reference / reachability | Purpose and prerequisites |
|---|---|---|
| `extract.py` | Imported by `try.py:9`, `why.py:8`, `rastercheck.py:17`, `rastercover.py:13`, `rastersweep.py:15`, `underline.py:32`; historical `CLAUDE.md:114,1176` | Main PDF extractor, JSONL/crops; PyMuPDF, Pillow, PDFs and glyph labels; does not seed DB |
| `pdfcommon.py` | Imported by `extract.py:22`, `try.py:10`, `why.py:10`, `rastercheck.py:18`, `rastercover.py:14`, `underline.py:31` | Shared PDF geometry/text code; PyMuPDF |
| `glyphmap.py` | Imported by `extract.py:21`, `why.py:9`; `CLAUDE.md:131` | Glyph decoder and scan/sheet CLI; PDF, PyMuPDF, Pillow |
| `sheet.py` | Historical `CLAUDE.md:395` | Contact sheets; PDF, generated index, labels, PyMuPDF/Pillow (3–15,36–41) |
| `addlabels.py` | Historical `CLAUDE.md:396` | Merge human labels into tracked glyph map; generated JSON inputs (2–9) |
| `try.py` | **Orphan candidate** | Diagnostic extraction of PDF slice (7–23) |
| `why.py` | **Orphan candidate** | PDF diagnostic; stale `E.is_table` call at 25; extractor defines `table_of` at 803 instead |
| `underline.py` | Historical `CLAUDE.md:2125,2146` | RW repair; local DB, source PDF; imports extractor/common (28–36,216–269) |
| `rastermath.py` | Imported by `rastercheck.py:19`, `rastercover.py:15`, `rastersweep.py:16`; `CLAUDE.md:464` | Retained experiment, explicitly not production extractor path (19–40); NumPy/PyMuPDF/Pillow |
| `rastercheck.py` | Historical `CLAUDE.md:484`; comment `rastermath.py:28` | Experimental visual harness; PDF, labels, missing template bank (13–25) |
| `rastercover.py` | Historical `CLAUDE.md:490` | Experimental coverage harness; same prerequisites (10–21) |
| `rastersweep.py` | Historical `CLAUDE.md:478`; comment `rastermath.py:23` | Experimental precision harness; same prerequisites (12–22) |

Tool paths in these two tables are under `tools/` unless another directory is shown. Dependencies imported by orphaned/manual scripts are dependency edges, not proof of reachability from npm or README. The raster experiment was deliberately retained despite rejection for production; do not delete it as accidental dead code.

### Reproducibility hazards

- Several helpers select the first SQLite file rather than identify the core DB (`tools/apply_math.cjs:10-19`, `apply_choice_tables.cjs:87-90`, `apply_answerable.cjs:87-90`, `underline.py:216-219`). Two databases now exist.
- Python imports require PyMuPDF/Pillow/NumPy, but no Python dependency manifest ships. PDFs, generated glyph index, `tools/templates.npz`, extraction JSONL and local DBs are missing.
- `schema.sql:44-45` already includes columns added by `migrations/0009_ai_bank.sql:4-5`; applying the complete migration history over the snapshot is not a safe bootstrap recipe.
- AI migrations have their own directory, but `wrangler.toml:39-42` does not select a `migrations_dir`.
- Future migration cleanup must also inspect smaller data repairs: 0003, 0004 and 0005_math_render_fixes are not schema merely because they are small. The two 0005 files and two 0009 files serve different purposes; no renumbering performed here.
- README's 3,843-row/Bluebook description (`README.md:3-6`) conflicts with deliberate removal recorded in `CLAUDE.md:1235-1246`. No live database count verified.

## Every stale whitelist rule

All 20 negated `.gitignore` rules were compared with the tracked tree. Exactly four have no match:

| Line | Stale rule |
|---|---|
| `.gitignore:32` | `!tools/restore_bluebook.cjs` |
| `.gitignore:33` | `!tools/bluebook_explanations.json` |
| `.gitignore:34` | `!tools/bluebook_stem_fixes.json` |
| `.gitignore:35` | `!tools/bluebook_skill_fixes.json` |

Historical removal is explicit at `CLAUDE.md:1243-1246`; these rules can be removed in an approved cleanup phase. No literal `!tools/bluebook_*.json` rule exists: three exact filename rules exist.

Remaining rules are live: `!tools/*.py` (line 14, 12 files), glyph labels (15), named CommonJS tools (16–28, one each), and `!tools/aiq/` (31, 17 descendants). `tools/templates.npz` at 36 is an ignore, not a whitelist. Generated `d1_sync/` has no dedicated ignore rule, unlike `d1_chunks/` and `d1_ai/` (38–40); exporter creates it at `tools/d1_dump.cjs:14-23`.

## Verified standing constraints for later review

- CSP exists in **two matching locations**, `src/index.js:9-27` and `public/_headers:6`. Worker hardens API/callback/fallback responses; assets may bypass Worker. Preserve parity.
- Both allow `frame-src https://www.desmos.com`; calculator iframe targets that host (`public/index.html:3419-3460`). Removing it blocks calculator framing.
- `run_worker_first = ["/"]` routes the homepage through Worker so canonical-host redirect cannot be bypassed by asset-first handling, without routing every crop through Worker (`wrangler.toml:19-23`).
- Grid-in derives from parsed empty choices: `q.spr = !q.choices.length` (`public/index.html:1403-1416`), not a type column (`schema.sql:1-16`). Invalid choices JSON also falls back to empty choices.
- Auth URL/key also occur directly in browser source (`public/index.html:1027-1028`); changing only Wrangler vars later would leave browser auth pointing at the original project. CSP host allowlists and Worker canonical-host redirect must also be considered in Phase 6; no behavior/config changes made now.
- College Board personal-study license note remains untouched.

## Verification and limits

- Windows `git.exe` confirms the inherited checkout is clean. WSL Git reports CRLF-only phantom changes; `git diff --ignore-space-at-eol --stat` is empty. Use Windows Git for this checkout, without changing Git configuration or rewriting inherited files.
- Full `npm ci` failed building `better-sqlite3`: Linux Node 24.18.1 environment lacks `make`. No system packages installed to work around this.
- `npm ci --ignore-scripts` succeeded, retaining the lockfile. This is sufficient for the startup check but **does not validate native SQLite tools**. npm reported three high-severity dependency advisories; no dependency upgrades performed.
- `WRANGLER_SEND_METRICS=false timeout --signal=INT --kill-after=5s 35s npm run dev -- --local` reached **Ready on http://localhost:8787**, Wrangler 4.125.0, with both D1 bindings local and one valid asset header rule. Timed shutdown intentional. Repeated after writing this audit.
- No schema/data was loaded; readiness proves server startup, not populated-bank functionality. No authenticated requests, production endpoint checks or deployments performed.
- No lint, typecheck or test script is provided in `package.json:6-10`. No new runner introduced before Phase 4. Please supply intended lint/typecheck commands if any.
- Phase 1 changes only this audit. No deletion is approved by calling a tool orphaned; four stale whitelist rules have explicit historical justification. Runtime contract fixes would change behavior and require separate approval.

## Review gate

Stop here before Phase 2. Approve the audit and correct the later README requirement to distinguish **missing populated core bank** from **400 shipped AI source questions and embedded core repair content**. No history relocation, test moves, migration renumbering, configuration edits or UI work has begun.
