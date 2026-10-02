# Prepzy community Desmos solutions

Imports Prepzy's approved community Desmos solutions (used with Prepzy's permission) into the main
D1 database, one per core Math question, and shows them in the practice bank once a question is
closed. Three steps, each a separate script; nothing here touches a remote database.

| Step | Script | Reads | Writes |
|---|---|---|---|
| 1. Scrape | `scrape.cjs` | prepzy.app alignment samples, api.prepzy.app test metadata and solutions | `cache/`, `solutions.jsonl`, `verify.json`, `scrape-report.json` |
| 2. Map | `map.cjs` | `solutions.jsonl`, the bank | `mapping.json`, `review.csv`, `unmatched.csv` |
| 3. Import | `import.cjs` | `mapping.json`, the bank | `desmos_solutions.sql` |

Tracked: the scripts, `mapping.json` (IDs, state, credit; no question text), `desmos_solutions.sql`
and `scrape-report.json`. Ignored: `cache/`, `solutions.jsonl`, `verify.json`, `review.csv` and
`unmatched.csv`, which hold College Board question text (see `data/` in `.gitignore`).

The bank is `data/questions.snapshot.json` by default (docs/BOOTSTRAP.md), `--local` for the local
D1 files, or `--bank <file>`.

Collected on 2026-10-02: all 1,925 core Math questions across 19 skills were checked. The tracked
mapping and SQL contain 999 solutions: 995 automatic ID matches and four manually reviewed
matches, with no unmatched solutions or invalid states. Applying the generated SQL to a scratch
database imported all 999 rows; applying it again changed zero rows.

The reviewed IDs are `2d2cb85e`, `694b7fce`, `252a3b3a` and `3f5a3602` (`method: "reviewed"`).
Prepzy's diagram descriptions and the bank's image-based math lowered their text scores; the
prompts, math and available bank figures were checked individually. Running `map.cjs` again
regenerates automatic matches only: recheck these rows in `review.csv` and restore their reviewed
entries before regenerating SQL. The original review sheet retains these four resolved flags.

## 1. Scrape

Prepzy is signed-in only: its pages render client-side and the API answers 401 without a session.
Sign in at prepzy.app, copy the `accessToken` value from the browser's Local Storage, and paste it
into the repository-root `.env` (Git-ignored):

```dotenv
PREPZY_TOKEN=your_access_token
```

Run from the repository root with Node's built-in environment-file support:

```sh
node --env-file=.env tools/desmos/scrape.cjs --verify-only   # alignment check only
node --env-file=.env tools/desmos/scrape.cjs                 # check, then walk every Math test
node tools/desmos/scrape.cjs --offline                        # rebuild outputs from cache/ alone
```

`PREPZY_STORAGE_STATE=<file>` (a Playwright storageState saved from a signed-in browser) works in
place of the token. The scraper does not write either credential to its outputs. Keep token and
storage-state files out of Git. Pages render in headless Chromium through
`@playwright/test` (`npx playwright install chromium` once, outside the cloud sandbox).

- Tests: the distinct Math `skill` values of both banks. `common.cjs` `TEST_NAME` maps the one name
  Prepzy spells differently (`Nonlinear equations in one variable` is Prepzy's
  `Nonlinear equations in one variable and systems of equations in two variables`). Empty tests are
  listed at the end of the run as possible naming mismatches.
- Walk: `/test/load` supplies the complete ordered question list and its College Board IDs with the
  same filters as the rendered page. Every index is checked against the approved-solution API;
  a 404 means no solution yet. This avoids reloading the app for every question, which can hit
  Prepzy's session-key rate limit and make an unfinished test look empty.
- Alignment: before walking, up to 3 solutions in each of the first two tests must find their API
  stem on their own page (≥ 80% of its words), fit it better than the next page, and have the same
  College Board ID in the test metadata and page; otherwise the run stops with `verify.json`.
- One request per second (page loads and API calls share the limiter), a descriptive User-Agent, and
  images/fonts/media blocked in the headless page. 401/403 or a sign-in redirect stops the run.
- Kept per solution: `cbId`, `testName`, `questionIndex`, `questionFingerprint`, `desmosState`,
  `questionPreview`, `makerAttribution.displayName`. Email keys and anything shaped like an address
  are removed before anything is cached or written. A state needs a `version` and a non-empty
  `expressions.list`; rejects are listed per test in `scrape-report.json`.
- Offline rebuilds require every response in the metadata list to be cached; missing responses
  stop the run rather than silently publishing a partial import.

## 2. Map

`node tools/desmos/map.cjs` prints counts per test (confirmed by cbId / by text, review, unmatched).

- The College Board question ID is `questions.id` (8 hex characters, all 3,770 core rows). Not
  `external_id`: the snapshot copies `id` into it, but `active-ids.json` uses that name for College
  Board's internal UUID.
- Order: (1) cbId equal to a core `questions.id`; (2) otherwise normalized stem and choices from
  `questionPreview` against `stem_html` / `choices_json` of both banks (HTML stripped, `&nbsp;` and
  other entities converted, whitespace collapsed; Dice over words, stem 0.7 + choices 0.3).
- Confirmed: a cbId hit whose preview does not contradict it (word overlap ≥ 0.3), or a text match
  ≥ 0.9 that beats the runner-up by ≥ 0.1, on a core question. Weaker text matches, matches on AI
  questions, cbId hits whose text disagrees and second solutions for an already-mapped question go to
  `review.csv` with both stems side by side; nothing ≥ 0.6 goes to `unmatched.csv`. Only
  `mapping.json` is imported: move a reviewed row into it by hand if it is right.

## 3. Import

```sh
node tools/desmos/import.cjs
npx wrangler d1 execute DB --remote --file=migrations/0015_desmos_solutions.sql   # once, first
npx wrangler d1 execute DB --remote --file=tools/desmos/desmos_solutions.sql
```

Refuses the whole run (like `tools/apply_ai.cjs`) on any unknown question ID, invalid state, email-like
credit or statement over D1's size limit. The SQL is an idempotent upsert keyed on `question_id` that
writes nothing when the stored row is unchanged, and each row re-checks
`EXISTS (SELECT 1 FROM questions WHERE id = …)` on the database it runs against.

## In the app

`/api/questions` marks core rows that have a solution with `has_desmos: 1` (read once per cached bank
body; the key includes `MAX(rowid)` of `desmos_solutions`, so an import shows at once).
`GET /api/desmos/:id` returns `state_json`, `credit_name` and the Desmos key, behind the same sign-in
and membership checks as the bank. The practice screen (`lesson-ui/Bank.tsx`) offers "Desmos
solution" inside the closed-question section only, fetches it on click and renders it with the lesson
Desmos loader (`public/shared/desmos.js`), credited "Solution by {credit_name} via Prepzy".
