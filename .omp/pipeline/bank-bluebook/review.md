# bank-bluebook — review

Verdict: **PASS** after one repair round. Diff read: `git diff 50cb6bc...HEAD` against spec.md and BRIEF §12.6.

## Findings (listed before fixing)
| # | Where | Finding | Disposition |
|---|---|---|---|
| 1 | `lesson-ui/Bank.tsx` Notes | Pending note was saved under the *next* question when Next ran before the 1 s debounce (render-phase write to the ref the cleanup reads). Data goes to the wrong question. | blocker, fixed (ef1d1d1), C8 |
| 2 | `lesson-ui/bank.css` dark | Filter on `#bank-live` makes it the containing block of the fixed header/footer/docks; they scroll away. | blocker, fixed (ef1d1d1), C6 asserts footer pinned |
| 3 | `public/index.html` CSS | `.lb` (90), `#sync-bar` (90), `.modal-bg` (60) sat under the new fixed layer (100): unsaved-answers banner and R&W lightbox invisible. | fixed in feat commit; `#sync-bar` lifted above the footer |
| 4 | grid-in | Commit used blur only; the old screen used the native `change`. | fixed, practice spec covers history `['2','3']` |
| 5 | `shared/report.js` | Report HTML would include the Mark for Review button. | fixed |
| 6 | scope | Exams and exam review keep the old player (different contract). | accepted, recorded, C9 guards it |
| 7 | behaviour | Grid-in field accepts only `-0-9./` (the lesson Stage rule); the old field took any text and `isRight` strips `,`/`$`. | accepted, listed in handoff |
| 8 | behaviour | `S.miss` no longer dedupes SPR values (count of wrong Checks drives Show answer). Copy for AI omits answer/explanation until closed. Retry-mode setting removed. | intended by the task, listed |

## Checklist
(a) no answer/explanation before close: DOM, More menu, export, status — asserted in C3/C4 · (b) one attempt per question per retry sequence:
unit + e2e · (c) `Stats.nextProgress/attemptRow`, Worker, schema untouched (`git diff --stat src schema.sql public/shared/stats.js` empty) ·
(d) no copy of lesson components: Stage, Calculator dock, header/footer/tools classes, `Chrome.tsx` extracted and used by Player,
SelfPlayer and Bank; CSS selectors widened, not duplicated · (e) exams untouched, C9 · (f) CSP unchanged, no new origin, dark/phone
checked · tests: no `.skip`/`.only`, no loosened assertions (lessons-11 sweeps exempt one control, with reason), full suite run.
(No new hand-written `.js`: `record.ts`, `Bank.tsx`, `Chrome.tsx`, `bank.spec.ts`, `support.ts`, `test_bank_record.ts`.)

## Repair round 1
Findings 1, 2, 4, 5 and the pill size fixed in ef1d1d1; unit tests, the task's specs and the full suite (94/94) re-run; no regression.
