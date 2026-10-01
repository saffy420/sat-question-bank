```text
Task: bank-bluebook
Tier: 3
Branch: claude/focused-rubin-wz26ng   Base: main (50cb6bc)
Last completed step: 8 (implementation, tests, review PASS, docs); step 9: pushed, no PR (not requested)
Next step: none; manual checks in handoff.md
Open blockers: none
Decisions made this task:
- Prerequisites verified: lessons-11-ui-polish and figure-viewer are both in main (HEAD == origin/main 50cb6bc).
- Stack: the bank practice screen moves INTO lesson-ui (one package/tsconfig/vite build, `lesson.js`+`lesson.css`),
  mounted like lessons (`mountBank`). Why: lesson-ui already owns every piece of screen B (Stage, fluid scale, header/footer,
  calculator dock, navigator, figure viewer, ink). A second React bundle or shared-CSS-only copy would duplicate them.
  `S` (session state) stays in index.html: the dashboard, results, sessions, exams all read it.
- Scope: practice sessions only. Practice exams and exam review keep the old `#view-test` screen (they share its DOM but
  have a different contract: no Check, module clock, save & quit, read-only review). Flagged in the handoff as follow-up.
- Retry mode setting removed: retry-until-correct is now the standing behaviour (task text), a setting for it is misleading.
- Record rule: progress + attempt at the first Check only; later tries -> in-memory history (session state), never attempts.
- Explanation: inline reveal (lesson `lesson-reveal` pattern) replaces the docked explanation panel; Notes stays a docked panel.
  Copy for AI omits the correct answer and explanation until the question is closed (same no-leak rule).
- Dark mode: the lesson CSS is light-only; the bank keeps its theme setting, done with a container inversion filter and a
  counter-filter + light plate for figures.
PR: not requested (do not open); body in pr.md
Baseline: main was 70/80 e2e; final 94/94 (e2e.md)
Instructions: docs/lessons/BRIEF.md — re-read §0, §12, §13 + .omp/pipeline/bank-bluebook/spec.md
Env: `npm ci` then `npm i --no-save --no-package-lock @cloudflare/workerd-linux-64@1.20260820.1` (the lockfile omits the
linux workerd binary); `export PW_CHROMIUM_PATH=/opt/pw-browsers/chromium-1194/chrome-linux/chrome`; `npm run e2e:seed`.
`rtk` is not installed in this container; commands run without the prefix.
```
