# Module-2 variants: research (BRIEF-modules.md §1)

Read-only findings, written before any code. Line numbers are against `main` at 7aadc10.

## Setup facts

- **PR #16 is merged.** Its head branch is `claude/bold-knuth-uczjut` (5ff1a6c), closed and merged into `main` on 2026-09-30. It has no review threads or comments, and no unresolved items. A merged PR can't take new commits, so this work goes on the session's designated branch, `claude/brave-turing-rvoe4y`, which starts from `main`.
- **Input PDFs** are tracked, but under different names from the brief: `tools/ptmap/sources/SAT RW Bluebook App Test Questions (With Answers).pdf` and `SAT Math Bluebook App Test Questions (With Answers).pdf`. They were added in 7aadc10.
- **Tools.** `pdftotext` (poppler) is installed. No Python PDF libraries are available, and no new npm dependency is allowed. So `extract-pdf.cjs` shells out to `pdftotext -layout`.
- **Bank.** No local D1 exists in this container. The validation bank is a read-only snapshot of `https://helpmeaceit.page/api/questions` (CLAUDE.md "Data sources"). It holds 4,270 rows: 3,770 CollegeBoard and 500 AI.

## PDF layout (verified)

- **RW:** 648 rows, which is 8 tests × 81. **Math:** 528 rows, which is 8 × 66. Each row looks like `order ID Subject Domain Skill Difficulty Test/M/Q Answer`.
  - Difficulty is 1–3.
  - `Test/M/Q` is `SAT<n> RW|M <block>.<q>`.
  - SAT11 rows have no ID and no difficulty.
- **Placeholders:** `xyz#####` and `abcd####` IDs.
- **Math grid-in answers** can list several forms: `30, -30`, `451/100, 4.51`, `29/3, 9.667, 9.666`, `2, -12`.
- **Skill names differ from the bank's.** Examples: "Text, Structure, and Purpose", "Distributions", "Probability", "Linear Inequalities", "Systems of Linear Equations", "Nonlinear Equations and Systems", "Nonlinear Equations in One or Two Variables", "Sample Statistics and Margin of Error", "Ratios, Rates, Proportions, and Units", "Area and Volume". A few Math rows also put the domain "Geometry and Trigonometry" ahead of the skill.
- **Block rule check (§2 gate): passed.**
  - Of the positions where both the existing map and the PDF are non-null, 675 agree and 6 disagree. The 6 disagreements are exactly the brief's known conflicts.
  - PT7 Math `hard` (from the Mhard export) equals PDF block 3 at 22/22 positions and block 2 at 0/22.
  - Every existing `easy` equals block 2, apart from the conflicts.
- **PT6 Math easy #11** (`d3f7c429` vs `dd3a910a`) is the duplicate-row pair from PR #16: one externalId, identical rows, and the choice between them was arbitrary. It is not a content conflict.

## tools/ptmap/build-ptmap.cjs

- **Inputs:**
  - `active-ids.json` (root, 2,022 `{questionId, external_id, section}`).
  - `tools/ptmap/manual-matches.json` (14 `{externalId, bankId, section}`).
  - `practice-tests/PT<n>-RW(easy|hard)-M(easy|hard)-questions.json` (9 files, all tracked).
- **Export record:** `{id:'reading'|'math', items:[{section:'Reading'|'Math', displayNumber:'1', sequence:0, questionId, externalId, metadata:{PRIMARY_CLASS_CD}}]}`.
- **Join:** exact `externalId` ↔ `external_id` within a section (`lookup`, :55). Manual matches are used only when the exact match is missing or ambiguous.
- **Blocks:** `sequence` blocks are RW 0–26 / 27–53 / 54–80 and Math 81–102 / 103–124 / 125–146. Filename labels vote, and the result is A = easy, B = hard.
- **Outputs:**
  - `practice-test-map.json`: `{PTn:{RW:{m1,easy,hard}}}`, with entries `{displayNumber, sequence, externalId, bankId}`.
  - `public/practice-tests.json`: one line, `{tests:[{id,number,name,RW:{m1,easy,hard},Math}]}`. Bank IDs are in display order; an unexported module is `null`.
  - `README.md` and `UNMATCHED.md`.
- Output is deterministic. The exit code is 1 on errors, and the files are still written.
- **Change needed:**
  - Read the CSV and a bank check.
  - Merge after the export pass, before `slim`.
  - Add a new README section and emit `practice-tests-ext.json`.

## public/practice-tests.json (current)

- **m1:** every test, both sections. PT5 RW m1 has 1 null and PT6 RW m1 has 2.
- **RW easy:** all 8 tests.
- **RW hard:** PT11 only.
- **Math easy:** all tests except PT7.
- **Math hard:** PT7 and PT11.

## lesson-ui/plan.ts

- **Types:**
  - `Route = 'easy'|'hard'`.
  - `PracticeTest = {id,number,name} & Record<Section,{m1,easy,hard: (string|null)[]|null}>`.
  - `TestLog = {testId, number, date, route: Record<Section, Route>, marks, at}`.
  - `BankQ` has no `stem_html`.
- **Functions:**
  - `routesOf` (:57) returns the routes whose array is non-null.
  - `modulesOf` (:61).
  - `resolveLog` (:70) walks only the logged route.
- **`blockedIds` (:178)** blocks every m1/easy/hard ID of each **unlogged** test. Once hard modules are mapped, it blocks them with no code change.
- **Pool selection:** `pickSet` (:210) filters by skill and difficulty, excluding blocked, reserved and unscorable IDs. Unseen questions come first, then ones the student got right.
- **Untaken variant after logging.**
  - The whole logged test leaves `blockedIds`, so both variants unblock.
  - `saveTestLog` records progress and an attempt only for the taken route, so only those questions are "seen".
  - The untaken variant becomes ordinary unseen pool material.
- **Plan JSON.** `plan.ts` is type-stripping safe and must not import `/shared`. Any text helper must be pure regex code inside `plan.ts`.
- **tests/test_plan.ts:**
  - `MAP` PT1/PT2: RW hard is null, and Math has both easy and hard.
  - Test :30 asserts the `routesOf` results.
  - Test :183 asserts the exact `blockedIds` set.

## public/index.html, Study Plan

- **`Plan`** comes from the `/lesson-ui/lesson.js` bundle (`export * as Plan`).
- **`load()`** (:1461) sets `QS`/`QBY` from `/api/questions`, normalized; each row keeps `stem_html`. PTMAP is fetched at :1476.
- **`openLog`** (:3523) builds `PLOG = {testId,date,route:defaultRoute(t),marks,error}`.
- **`defaultRoute`** (:3531) picks the first mapped route.
- **`drawLog`** (:3535):
  - The radios are at :3564: `.pl-route[data-route=sec] input[name=pl-sec][value=easy|hard]`, labelled Easier/Harder.
  - The change handler (:3577) sets the route and deletes the `Sec2` marks.
  - Save is never disabled, except while saving.
- **`saveTestLog`** (:3595) copies `PLOG.route` into the log.
- **`startStep`** (:3405) calls `pickSet` with `blocked: Plan.blockedIds(PTMAP, logged)`.
- **Text helpers:**
  - `plain()` (:2119) strips `<h3>` labels and tags.
  - `toText()` (:3949) handles Copy for AI.
  - Neither converts TeX.
  - The bank stores math as `\( … \)` TeX, not MathML: 1,260 stems contain TeX and 0 contain `<math>`. "MathML to text" therefore means TeX to plain text here.
- **Stem shapes.** Stems open with `<h3>Passage</h3>` or `<p>`. Many open with a figure (`<div class="qfig">`, `<p><img class="minl">`) or a table (`<div class="qtable">`). Many Rhetorical Synthesis stems share the boilerplate opening "While researching a topic, a student has taken the following notes:".

## E2E

- **`support.ts`:**
  - The `MAP` (PT90–92, `e2e-plan-` IDs) is served by `context.route('**/practice-tests.json')`.
  - `logTest` checks `[data-route=sec] input[value=r]` (:59).
- **`plan.spec.ts` :30** asserts that Math hard is disabled. Screenshots go to `docs/plan/screens/NN-name.png`.
- **`src/index.e2e.js`:**
  - `/api/e2e/plan` seeds `PLAN_FIXTURE` rows.
  - Every stem is `<p>Plan fixture <id>: the answer is B.</p>`, so opening texts differ by ID.
- **Playwright** runs at 1366×768 with 1 worker.

## Grading

- `isRight(q, val)` is in `public/shared/stats.js:151`. It is applied to `normalizeQuestion(raw)`, and the build script can `require()` both.
  - It returns `true`, `false`, or `null` when unscorable.
  - SPR answers split on `,` and `OR`, and handle fractions and rounding.
- **Multi-form PDF answers.** A position is accepted when the bank accepts at least one listed form. It warns when only some forms are accepted, and it is rejected when none are.

## Schema

- `migrations/0012_study_plan.sql` stores `study_plans.state` as an opaque JSON blob.
- `POST /api/plan` validates only the shape and size.
- `route` lives inside that JSON, so **no schema change is needed**.

## In-app exams

`public/exams.json` holds 5 tests, 735 distinct IDs. **127 of those IDs also sit in the practice-test map.** The in-app exams therefore reuse Bluebook-test questions, and `build_exams.cjs` does not exclude them. This is reported only; nothing was changed.

## .gitignore

`tools/*` is ignored, with `!tools/ptmap/` allowed. `practice-tests/`, `active-ids.json` and `public/practice-tests.json` are tracked, so `extract-pdf.cjs` and `sources/bluebook-ids.csv` will be tracked too.

## Design decisions (from the findings)

1. **Inputs and steps.**
   - `extract-pdf.cjs` turns the PDFs into `sources/bluebook-ids.csv`.
   - `build-ptmap.cjs --bank <api-dump.json>` refreshes `sources/bank-check.json`. This is a tracked, IDs-and-answer-keys-only extract of the bank rows the map and CSV touch.
   - A plain `build-ptmap.cjs` run reads `bank-check.json`. That keeps the build reproducible from tracked inputs, as it is today.
2. **Merge logic** lives in `tools/ptmap/merge.cjs` as pure functions, so `tests/test_ptmap.cjs` can test it.
3. **`--out <dir>`** redirects every output, so a test can run the build twice in a temp directory and compare the bytes.
4. **Picker and snippet** are pure functions in `plan.ts`, taking `byId` plus `stem_html`. The opening must differ within its first 60 normalised characters, so boilerplate openings don't count as different.
5. **Version A / Version B** are assigned per test, section and position by a hash, so A is not always the easier version.
6. **Resolution** is a majority over the recognition answers. "Not sure" gives the hint immediately.
