# Review: report-and-suggest

Reviewed by re-reading `git diff cadec68...HEAD` against `spec.md` and BRIEF §12.6 after the test round. One session, no
Reviewer subagent (BRIEF §12.1).

## Round 1 (before the repair pass)

| # | Item | Verdict |
|---|---|---|
| a | Nothing from triage, reports or other students reaches a student. The report reply is `{ok:true}`; every triage/admin route is behind the admin role check (unit test `Reports` 403 for a student; e2e R6). The student bank feed carries no report data. | PASS |
| b | Prompt injection. Note, rendered HTML and the question text are fenced as untrusted in the system prompt, but the real control is that the output is validated and never auto-applied: `checkPatch` + human Approve. Approve re-runs `checkPatch` on the row as stored now. | PASS |
| c | No per-event D1 writes: report = 1 insert, call = 1 claim insert + 1 batch, suggestion = 1 insert, admin reads bounded to 200 rows. | PASS |
| d | No second copy of any stat; the answer key check reuses `normalizeQuestion`. | PASS |
| e | `handleRequest` still works without `ctx` or `deps` (existing unit tests call it with three arguments). | PASS |
| f | Production source must not name E2E flags. **Found by `test_e2e_auth`**: the first version of `src/reports.js` read `E2E_TEST_MODE`. Moved: the e2e entry now supplies `deps.apiUrl` (`claudeTarget`), production passes nothing. | FIXED |
| g | Deploy order: `stamps()` now reads `question_triage`, so code deployed before migration 0011 breaks `/api/questions`. Documented in CLAUDE.md, SETUP.md and `wrangler.toml`; same constraint as migration 0010. | DOCUMENTED |
| h | Hidden-text loophole. `checkPatch` compares visible text after stripping tags, so a markup-only patch could hide a sentence with `display:none`. | FIXED in the repair round (hiding patterns may not increase) |

## Design notes for the owner (not defects)
- Approving a fix closes *all* open reports on the question (spec). If a wrong-answer report is open on the same question, the
  approve button says how many reports it closes and the wrong-answer escalation is shown in the same card.
- A report that arrives inside the 24 h window waits ("awaiting triage") and goes into the next Claude call for that question,
  which happens when the next report for it arrives after the window. There is no scheduler; the admin can also Close it.
- The Reports tab shows at most 50 questions and 200 open reports; closing some brings the rest into view.
- Live lessons keep their frozen copy of a question; an approved fix shows in the bank, My Lessons and new sessions.
- Playwright cannot read the response body of the page's own `fetch` to `/api/reports` here (`response.json()` hangs); the
  reply body is asserted through the API request in R5/R6 instead. The client never reads that body.
