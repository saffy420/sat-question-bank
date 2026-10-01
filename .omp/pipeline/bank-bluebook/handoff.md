# bank-bluebook — handoff

## What shipped
- **The practice question screen is the lesson student screen (B).** React in `lesson-ui/` (`Bank.tsx`, `mountBank`), same build,
  tsconfig and `lesson.js`/`lesson.css` as lessons; mounted in `#bank-live` like `mountLesson`. It reuses `Stage` (question bar,
  choice rows, grid-in, figure viewer, private highlighter, cross-out), the header/footer/tool/More/pill/navigator markup
  (`Chrome.tsx`, now also used by the lesson Player and SelfPlayer) and the calculator dock (`Calculator.tsx` gained an `embed`
  mode: the College Board Graphing/Scientific iframe, no API key). `lesson.css` selectors were widened from `#lesson-live` to
  `:is(#lesson-live, #bank-live)` (same specificity). Measured by C1: header, footer, dashes, type sizes, tool row, pill, primary,
  column, question bar and choice rows equal the lesson view within 1 px at 1366×768 and 1920×1080.
- **Footer button:** `Next` (skip; `Finish` on the last) until a pick or an SPR value, then `Check`, then `Next` after a right answer.
- **Retry until correct:** a wrong Check marks the pick red and disabled, clears the pick, shows only "Not quite" and reveals nothing
  (screen, More, Copy for AI). A right Check closes it: green choice, inline explanation, Notes dock when the miss setting is on.
  [DEFAULT] The progress row and the attempt are recorded once, at the first Check (`correct` = first try, `time_taken_ms` = time to it);
  later tries go to the in-memory answer history (and the saved practice session). Accuracy, mistake log, weak spots, Focus ladder,
  question map and results are first-try based (a solved retry shows **Corrected** in results, Red in the record).
  [DEFAULT] SPR: `Show answer` after 3 wrong Checks (`SHOW_ANSWER_AFTER` in `record.ts`); the attempt stays wrong.
  Leaving mid-retry keeps the first-try result; coming back resumes with the misses marked.
- **Figure viewer** for math figures, through `Stage`.
- **Typed record path** `lesson-ui/record.ts` (`createRecorder`, `pick`, `commit`, `remember`, `firstTry`, `outcome`): stats functions are
  passed in, so there is still one `nextProgress`/`attemptRow`. `index.html` calls it for practice and for practice-exam scoring.
  `tests/test_bank_record.ts` (13 tests, Node type stripping; `npm test` now also runs `tests/test_*.ts`).
- Dark theme kept (the screen is authored light; each part of `#bank-content` is filtered, figures counter-filtered on a light plate).

## Decisions (also in state.md)
- **Stack:** into lesson-ui, not a second bundle or CSS-only sharing: lesson-ui already owns every piece of B.
- **Scope:** practice only. Exams and exam review keep `#view-test`; the old `renderAnswerArea`/panels/map/More now serve them only
  (dead practice branches and `grade()`/`rememberAnswer()` removed). **Follow-up if wanted:** move exams to the same screen.
- Explanation is inline (lesson `lesson-reveal` pattern); Notes is a right dock; the old docked "Explanation & note" panel is gone.
- The "Retry mode" setting row is removed (always on). `noteOnWrong` kept ("Note on a miss").
- Copy for AI omits the correct answer/explanation until the question is closed.

## Behaviour changes to know
- Grid-in accepts `-`, digits, `.`, `/` only (lesson Stage rule); the old field accepted any text.
- `Next` on an unsolved question no longer opens the explanation (it would reveal the answer).
- `S.miss` is now every wrong Check (SPR duplicates counted). Practice sessions saved before this change load fine (first-try falls
  back to `ans`/`checked`).
- `.lb` lightbox, `#sync-bar` and `.modal-bg` z-indexes raised above the fixed practice/lesson layer; `#sync-bar` sits above the footer.
- CLAUDE.md: two standing rules rewritten (first-try record, docking) plus architecture/ESM/dark-mode notes.

## Not done / for you
- Baseline on main was 70/80 (see e2e.md). Report-box vs no-box sweep conflict is resolved in the test helpers; flakes noted.
- Desmos iframe (desmos.com) was not reachable/verified in the sandbox: iframe src and docking are asserted, not the calculator UI.
- Not exercised: real Chromebook touch, real browser zoom, signed-in production.
- `rtk` is not installed in this container; commands ran without the prefix. No lint command exists in the repo (typecheck only).

## Manual checks before merge
- Chromebook 1366×768: do a few practice questions (MC, SPR, a math figure); wrong → retry → right; Show answer on a grid-in.
- Dark theme on the practice screen, with a figure and a table question; scroll a long passage (header/footer stay).
- Calculator dock with the real Desmos embed; Notes dock; Copy for AI mid-retry (no answer) and after (answer + explanation).
- Start a practice exam: unchanged old screen.
