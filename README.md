# SAT Question Bank

A Bluebook-style SAT practice app: one Cloudflare Worker, two D1 databases, and a single-file vanilla HTML/CSS/JS interface.

- **The core bank (~3.8k official questions) is NOT in this repo and cannot be reconstructed from it.** Core repair SQL contains UPDATEs against rows that must already exist, not a baseline seed.
- **400 AI-authored questions DO ship** in `tools/aiq/` and are importable through `tools/apply_ai.cjs`: 100 Math and 300 Reading & Writing across 17 files.
- **`public/qimg/` figure crops are gitignored and absent from a fresh clone.** They were recovered in this working copy; they do not ship in Git.

The original public endpoint `https://helpmeaceit.page/api/questions` was verified accessible during cleanup, returning 3,770 CollegeBoard and 400 AI display records. This is an optional external recovery source, not a repository seed or an availability guarantee. Figure crops must be downloaded separately; legacy OCR text is not supplied. See [bootstrap and recovery boundaries](docs/BOOTSTRAP.md).

## Features

- **Practice sets** filtered by section, domain, skill, difficulty and source; focus selection and a level ladder.
- **Bluebook-style player** with passage/figure/table panes, choice elimination, flagging, timer, question map, highlighting and notepad.
- **Desmos** graphing and scientific calculators docked on Math questions; external iframe availability is required.
- **Math rendering** with KaTeX where notation is text, and separately supplied crops where image notation remains necessary.
- **Dashboard and Mistakes** with accuracy, activity, skill breakdowns and retry practice.
- **Practice exams and History** with saved account sessions and explicitly estimated scores, not official Bluebook scoring. Tracked exam IDs need populated core data.
- **Copy for AI** exports question content, choices, answers and explanation to paste into an assistant; no model API or tutor service is included.
- **Supabase accounts** using Google or email/password with D1-backed progress, attempts, notes, settings and sessions. Guest answers are memory-only and are not merged on sign-in; guest preferences can persist locally. Known synchronization limits are recorded in [KNOWN-ISSUES](docs/KNOWN-ISSUES.md).

## Running it

Follow [SETUP](docs/SETUP.md) for your own resources and all coupled auth/domain settings, then [BOOTSTRAP](docs/BOOTSTRAP.md) for verified fresh local initialization. Installing dependencies and starting Wrangler alone does not populate databases.

```sh
npm ci
npm run dev -- --local
npm test
```

The verified tracked-AI-only bootstrap produces **0 core questions, 400 AI questions and 400 AI registry IDs**. Fixed core exams and missing crops remain unavailable. Supabase placeholders permit guest initialization but not real sign-in. Deployment is separate; `npm run deploy` uploads code/assets, not SQL, and its image guard requires a real populated crop directory.

## Layout

```text
public/index.html   complete SPA: markup, styles and logic; not split
public/exams.json   fixed exam IDs, not question bodies
public/qimg/        ignored external figure and notation crops
src/index.js       Worker API, authentication, CSP, redirect and asset fallback
schema.sql         core questions and all user-state tables
schema_ai.sql      AI question schema, including level
migrations/        sequential historical core schema changes
migrations_ai/     separate AI schema history
data-fixes/        one-time UPDATE repairs; not fresh-setup seeds
tools/aiq/         400 tracked AI-authored questions
tools/apply_ai.cjs  validate/import AI bank and register its IDs
tools/             extraction, repair, export and audit tools
tests/             local regression tests and marked integration checks
wrangler.toml      placeholder resources, two D1 bindings and static assets
docs/history/      original diary, plans and cleanup provenance
```

`CLAUDE.md` contains standing development guidance, not the full historical diary. See [AUDIT](docs/AUDIT.md) for inherited hazards and [UI map](docs/ui-map.md) for navigation through the unsplit SPA.

## Schema

Main `DB` contains:

| Table | Purpose |
|---|---|
| `questions` | Core metadata, stem/choice/explanation HTML, answer, source and legacy OCR text |
| `users` | Supabase user ID, email, name and creation time; touched by account GET and applicable writes |
| `progress` | Latest per-user/question attempts, corrects, marker, review time, time taken and stars |
| `attempts` | Append-only answer events with timestamp, correctness, time, picked answer and changes |
| `settings` | Per-user JSON preferences |
| `notes` | Per-user/question note text |
| `sessions` | Per-user exam/review JSON state; old sessions purged on sessions GET |
| `ai_ids` | AI question registry for write guards across separate D1 databases |

`AI_DB.questions` shares core question columns and adds `level`. AI records use levels 4–5; official difficulty maps to levels 1–3. No parsed choices means grid-in; no dedicated type column exists. The public API combines display fields from both banks and omits legacy `stem_text`; an AI query failure can silently return core-only results.

## PDF extraction is not a baseline import

`tools/extract.py` expects external `OfficialSatMath.pdf` / `OfficialSatReading.pdf`, glyph-decoding inputs, and Python prerequisites such as PyMuPDF and Pillow; experimental raster tools also use NumPy and missing template data. No complete Python dependency manifest or source PDFs ship. Extraction produces content/crops, not the complete metadata baseline. `tools/apply_math.cjs` updates existing question IDs, so extraction alone cannot populate an empty core bank. Printed Question IDs are the join key; historical `source_page` is not a reliable page index.

`tools/d1_dump.cjs` exports INSERTs from an already populated local bank; it cannot recover absent rows. Several tools hardcode or guess local SQLite filenames, so verify database identity and stop dev servers before using them. Never replay repairs indiscriminately over recovered/current content.

## License

Questions © College Board. This app is for personal study use only.

## Custom domain

Use [SETUP](docs/SETUP.md). Both Wrangler routes, Worker canonical redirect, browser auth constants, Worker vars and both CSP policies must agree. Historical author-specific configuration is reference only, not permission to deploy to or modify those resources.
