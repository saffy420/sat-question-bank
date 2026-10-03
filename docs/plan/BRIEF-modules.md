Task: plan-hard-modules. Add every Bluebook module-2 variant (easy and hard) to the Study Plan's practice-test map, and replace the log form's "Easier/Harder" radios with a recognition check.

## 0. Setup
1. `gh pr checkout 16`. Confirm its head branch is `claude/bold-knuth-uczjut`. If it isn't, STOP and report.
2. Read PR #16's description, commits, review threads and CI status. Note anything still unresolved, because this work lands on the same PR.
3. Save this prompt verbatim to `docs/plan/BRIEF-modules.md`. Re-read it after every compaction.
4. Inputs: `tools/ptmap/sources/SAT_RW_Bluebook_App_Test_Questions__With_Answers_.pdf` and `SAT_Math_Bluebook_App_Test_Questions__With_Answers_.pdf`. If either is missing, STOP.
5. Use a researcher subagent for step 1. Implement in this session. Run a review pass before pushing.

## 1. Research first (read-only, no edits)
Write findings to `docs/plan/modules-research.md` before writing any code. Read:
- `CLAUDE.md`, especially the Study Plan rules. `practice-tests.json` is generated; never hand-edit it.
- `docs/plan/BRIEF.md` and any status or handoff files in `docs/plan/`.
- `tools/ptmap/`: `build-ptmap.cjs`, its inputs (the stripped My Practice exports, `active-ids.json`) and its README. Learn how the current map was built: the `externalId` join and the `sequence` block → easy/hard rule.
- `public/practice-tests.json`, the current output.
- `lesson-ui/plan.ts`: `routesOf`, `modulesOf`, `resolveLog`, `blockedIds`, `pickSet`, `TestLog.route`. Also read `tests/test_plan.ts`.
- `public/index.html`, Study Plan section: `load()` (PTMAP fetch), `openLog`, `defaultRoute`, `drawLog` (the `.pl-route` radios), `saveTestLog`, `startStep` (uses `blockedIds`).
- `tests/e2e/study-plan/support.ts` (fixture MAP, `logTest`) and `plan.spec.ts` (asserts `[data-route="Math"] input[value="hard"]` is disabled).
- `src/index.e2e.js`: the `/api/e2e/plan` fixture.
- The existing grading helper behind `isRight()`. Reuse it for answer checks; don't reimplement it.
- `migrations/0012_study_plan.sql`. Confirm no schema change is needed, since the route is stored in the plan JSON. If one is needed, STOP and ask.
- `tools/build_exams.cjs` and `public/exams.json`. Report whether the in-app exams reuse Bluebook tests. Don't change them.
- `.gitignore`: `tools/*` is allow-listed, and `tools/ptmap/` is tracked.

## 2. Data: PDFs → map
PDF layout:
- Rows are keyed by the `Test/M/Q` column, for example `SAT4 RW 2.13` = test 4, RW, block 2, question 13.
- Ignore the `order` column; it has typos, such as a duplicated 56.
- Block 1 is module 1, block 2 is module-2 easy, block 3 is module-2 hard. Before relying on this, verify it against the existing map. PT7 Math `hard` came from an Mhard export and should equal block 3. Every existing `easy` should equal block 2. If the check fails, STOP.

Rules:
1. Write `tools/ptmap/extract-pdf.cjs`. It converts both PDFs into a tracked input, `tools/ptmap/sources/bluebook-ids.csv`, with columns test, section, block, number, id, skill, difficulty, answer. `build-ptmap.cjs` reads that CSV alongside the export inputs. Rerunning both scripts regenerates `public/practice-tests.json`.
2. `xyz#####` and `abcd####` are placeholders, not bank IDs. Map them to null and list them.
3. SAT11 rows have no IDs. Keep PT11 from the exports, and use the PDF answers only as a cross-check.
4. The exports, joined on `externalId`, are authoritative. Where the existing map is non-null and the PDF differs, keep the existing ID and list the conflict. Where the existing map is null, or the module is missing (most `hard` modules), fill it from the PDF.
5. Validate every PDF ID before mapping it:
   - Reject it (leave null and list it) if it is not in the bank, its section is wrong, or the PDF answer disagrees with the bank's answer under `isRight` semantics. Grid-in answers can list several accepted forms, for example `30, -30` or `451/100, 4.51`.
   - Warn only on skill or difficulty mismatches. The PDF's names differ from the bank's ("Text, Structure, and Purpose", "Nonlinear Equations and Systems", "&" vs "and"), so normalize before comparing.
6. The same ID in both easy and hard is legitimate, for example `79fe7550`. The same ID twice within one module gets flagged.
7. Known conflicts (not exhaustive; find them all):
   - PT6 Math m1 #19: `345cc36a` vs `adae6543`
   - PT6 Math easy #11: `d3f7c429` vs `dd3a910a`
   - PT8 Math easy #16: `b78cd5df` vs `74c98c82`
   - PT9 Math m1 #3: `7a8cb72a` vs `ff2c1431`
   - PT9 Math m1 #14: `3c03cbd8` vs `038d87d7`
   - PT10 Math easy #3: `4a090a46` vs `3e9eaffc`. The PDF also puts `3e9eaffc` at hard #3 with a different answer, so the PDF row is suspect.
8. Update `tools/ptmap/README.md` with:
   - a coverage table per test × section × variant (mapped, null, conflicts),
   - every rejected, warned or conflicting position with its reason. I will hand-check these.

## 3. Module-2 recognition check (replaces the radios)
- **Per section.** RW and Math route independently.
- **No "easy or hard?" question.** For each section, show the opening line of module-2 question P from both variants side by side, with neutral labels (Version A / Version B; never Easier / Harder). Ask: "Which was question P in your second <section> module?"
- **Two positions per section.** If the two answers contradict each other, ask a third position. If that is still unresolved, or the student picks "Not sure", show a hint to check the test's review in Bluebook. Keep module 2's grid hidden and Save disabled until the section is resolved.
- **Position picker** (pure function in `plan.ts`, deterministic per test):
  - only positions where easy[i] ≠ hard[i], both IDs are in the bank, and the opening text differs;
  - prefer one early position (around Q5) and one late position (around Q15);
  - skip a stem with no usable text, such as one that opens with a figure.
- **Snippet:** plain text taken from `stem_html` (strip HTML, MathML to text), about 140 characters. Never show choices, answers or explanations.
- **Resolved route:** fills `PLOG.route[sec]`. Changing the answer clears that section's module-2 marks, as the radios did.
- **Fallback:** if only one variant is mapped, keep the current radios for that section, with the unmapped option disabled.
- **Optional shortcut:** "Upload your My Practice questions.json".
  - Parse it in the browser only. Never upload or store it.
  - Use `externalId` per section to detect the variant from the module-2 IDs.
  - Detect a different test from the module-1 IDs and offer to switch to it.
  - `build-ptmap.cjs` emits a separate `public/practice-tests-ext.json` (bank ID → `externalId` via `active-ids.json`). Load it only when a file is uploaded.
  - Route detection only. Don't auto-fill Wrong marks, since the raw export's answer fields aren't verified. List that as a follow-up.

## 4. Side effects to measure and report (don't change the rules)
- `blockedIds` will now block the hard modules of unlogged tests. Report Medium and Hard pool sizes per skill, before and after, for a student with nothing logged.
- Say what happens to the variant a student didn't take once the test is logged: is it blocked, unblocked, or seen?
- Already-logged `TestLog`s keep their route. Confirm nothing needs migrating.

## 5. Tests
- **Unit** (`tests/test_plan.ts`): the position picker (differs, in bank, spread, deterministic, skips unusable stems), contradiction handling, and the export resolver (each variant, wrong test, malformed file).
- **Build:** merge rules (a conflict keeps the existing ID, a placeholder becomes null, an answer mismatch is rejected), plus a check that the regenerated map is byte-identical on a rerun.
- **E2E** (`tests/e2e/study-plan/`), at 1366×768:
  - update the fixture MAP so both variants exist for both sections in one test;
  - replace the old radio assertion;
  - cover: the recognition flow for RW and Math, the contradiction path, Not sure, the export upload, and the one-variant fallback;
  - save screenshots to `docs/plan/screens/`.
- `npm test`, `npm run typecheck` and `npm run test:e2e` all pass.

## 6. Finish
- Push to `claude/bold-knuth-uczjut` so the work lands on PR #16.
- Add to the PR description: the coverage table, the conflicts and rejections list, the pool-size numbers, and the follow-ups.
- Don't merge. Don't deploy.
