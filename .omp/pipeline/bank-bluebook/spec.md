# bank-bluebook — spec

Source: the user's task text and three screenshots (A: Bluebook at 100 %; B: our lesson student view after the polish,
the direct reference; C: the bank question screen before this task). BRIEF §0 (rules 2, 3, 7), §12 (pipeline).
Prerequisites **merged on main** (HEAD = origin/main `50cb6bc`): `lessons-11-ui-polish` (`5f1c1d4`…`4587bba`) and
`figure-viewer` (`06d7e80`…`ff8a86a`).

## Tier
Tier 3. A new React screen replaces the bank's practice player, a first-try rule moves into a typed module, and
the answer flow changes (retry until correct, Next/Check button). Main session only (BRIEF §12.1); no subagents.

## What the bank screen is today (measured from the source, not assumed)
- `#view-test` in `public/index.html`: hand-built DOM from `loadQuestion`/`renderPanes`/`renderAnswerArea`, styled by
  the page's own CSS (`.top`, `.panes`, `.choice`, `.bot`…). Header: ← Dashboard, Directions, Hide, clock, Pause,
  Calculator, More, theme. Footer: map, `n of N`, notes, Explanation, Copy for AI, Back, Next.
- The same DOM also plays **practice exams** (`S.exam`: answers saved as you go, no Check, module clock, Save & quit)
  and **exam review** (`S.review`: read-only, everything revealed).
- Practice today: pick → a `Check` button appears inside the picked row → `grade()`. Retry mode is a setting
  (`SET.retry`, off by default). The first Check moves the record (`recordProgress`); **every scored Check appends an
  attempt** (`recordAttempt`). A right answer closes the question and opens the explanation if it was missed.
  `openExplanation()` shows the explanation text even for a question that is still open.
- The lesson student view (`lesson-ui`) already has the screen B: fluid `--u`/`--fs` scale, header/footer, Stage
  (strip + Report + ABC cross-out, choice rows, grid-in, figure viewer, private highlighter, calculator dock).

## Stack decision (recorded in state.md)
Move the bank's practice screen **into lesson-ui** (same package, tsconfig, vite build, `lesson.js`/`lesson.css`),
mounted the way lessons are: `mountBank(root, bridge)` returns `{ update(model), clock(text, over), destroy() }`;
`public/index.html` keeps the session state `S` and draws the model.
- Shared components, not copies: `Stage` (question strip, choices, grid-in, figure viewer, ink, cross-out),
  the header/footer/tools/More/clock/position-pill/dialog/calculator-dock classes and the navigator grid.
  Extracted from the lesson Player/Self where the markup was identical (`Chrome.tsx`).
- The lesson CSS is keyed on `#lesson-live`; it is widened to `:is(#lesson-live, #bank-live)` (same specificity), so the
  bank root gets the same tokens and rules. Bank-only rules live in `lesson-ui/bank.css`.

## Scope
1. **Screen.** Practice sessions (plain, Focus, missed-question drills / review sessions) play in `#bank-live`: header
   (title + Directions, clock + Hide + Pause, tools: Dashboard, Calculator on math, Annotate, Notes, More, theme),
   one column (Stage), choice rows, footer (user name, `Question n of N` pill with the navigator, Back, primary button).
   **Not moved (recorded, deliberate):** practice **exams** and **exam review** keep the old screen and code; Home, filters,
   Browse, Mistakes, History, Settings, Results keep behaviour.
2. **Primary button.** No pick / no SPR value → `Next` (skip; `Finish` on the last question). Pick or value → `Check`.
   After a correct Check → `Next`. After a wrong Check the pick is cleared, so it reads `Next` again until a new pick.
3. **Retry until correct.** Wrong Check: the picked choice turns red and disabled; no correct answer, no green, no
   explanation anywhere in the DOM (status line, Explanation, Copy for AI). The student picks and Checks again;
   only a correct Check closes the question, marks the correct choice green and shows the explanation.
   - **[DEFAULT]** the attempt and the progress row are recorded once, at the **first** Check: `correct` = first-try result,
     `time_taken_ms` = time to the first Check. Later tries are appended to the in-memory answer history only.
     Accuracy, the mistake log and weak spots stay first-try based; the Focus ladder moves on the first Check only.
   - **[DEFAULT]** SPR: after 3 wrong Checks a `Show answer` button appears; it closes the question showing the answer and
     explanation; the recorded attempt stays wrong.
   - Leaving mid-retry (Next, Back, navigator, Dashboard) keeps the first-try result; returning resumes the retry.
   - `SET.retry` (Retry mode) is now the standing behaviour, so the setting row is removed.
4. **Figure viewer** for math figures (`Renderer.mathStem` through `Stage`), as on the lesson screens.
5. **Typed record path** `lesson-ui/record.ts`: pick/answer history, first-try Check, recordProgress/recordAttempt. The
   compiled `lesson.js` exports it; `index.html` (exam scoring included) calls it. `tests/test_bank_record.ts` covers it.

Out of scope (BRIEF rule 7 / CLAUDE.md): exams screen, dashboard/browse/mistakes behaviour, server, schema.

## Files to touch
- new: `lesson-ui/record.ts`, `lesson-ui/Bank.tsx`, `lesson-ui/Chrome.tsx`, `lesson-ui/bank.css`,
  `tests/test_bank_record.ts`, `tests/e2e/bank-bluebook/*.spec.js`
- changed: `lesson-ui/index.tsx` (exports), `lesson-ui/Stage.tsx` (missed letters, flag, grid-in without Select button, Enter),
  `lesson-ui/Self.tsx`/`index.tsx` (use the extracted chrome), `lesson-ui/lesson.css` (root selector), `lesson-ui/types.ts`,
  `tsconfig.lesson.json` (tests), `package.json` (test script picks up `.ts`), `public/index.html` (mount, draw, bridge, record
  calls, removal of practice-only legacy code), `public/shared/annotations.js` (scroller selector),
  `tests/test_grade.cjs` (practice `grade()` left index.html), the four e2e specs that drove the old practice DOM,
  `CLAUDE.md` (the two standing rules this task changes).

## Required unit tests (`tests/test_bank_record.ts`, through the real `createRecorder` + `/shared/stats.js`)
- wrong, wrong, right on one MC question → exactly **one** attempt (`correct` 0, `picked` = first answer, `time_taken_ms` = time
  to the first Check), one progress move (Red, attempts 1, corrects 0); history holds all three answers.
- right first try → one attempt correct, Green; the same question wrong first then solved in a later sitting → Orange.
- SPR: three wrong Checks then `showAnswer` → one wrong attempt, question closed, answer not scored right.
- unscorable question records nothing; exam scoring path (`recordProgress`+`recordAttempt` with ms 0) unchanged.
- switches counted, not first picks; SPR `change` commits collapse; history bound of 128 keeps first and last.
- the ported cases of the old `test_grade.cjs` (refresh order, Orange, unscorable, SPR switch count).

## E2E checkpoints (1366×768 and 1920×1080)
- C1 the bank beside B: screenshots of the same math question in the bank and in the lesson student view; asserted
  geometry (header/footer height, column width ratio, choice row shape, tools row) equal within tolerance.
- C2 a right answer goes `Next` → `Check` → `Next` (button text asserted at each step).
- C3 a wrong MC answer is marked red and disabled, retried and answered correctly; at every step the DOM, text and
  clipboard export hold no `.right`, no "Correct answer", no explanation text; after the right Check explanation shows.
  One attempt was POSTed (first-try wrong).
- C4 an SPR shows `Show answer` only after 3 wrong Checks; using it keeps the attempt wrong.
- C5 leaving mid-retry keeps the first-try result; coming back resumes; Mistakes list holds the question.
- C6 figure viewer on a math figure; Annotate highlights without selecting a choice; cross-out; dark theme; 390 px width.
- C7 full suite green; the updated practice / report / harness / figure-viewer specs drive the new screen.

## Review items
(a) no answer/explanation in any DOM or clipboard text before the question closes; (b) one attempt per question per
Check-sequence; (c) `nextProgress`/`attemptRow` untouched, Worker record path untouched; (d) nothing duplicated from the
lesson components; (e) exams untouched and still green; (f) dark mode, phone width, CSP (no inline-script, no new origins).
