# Spec: report-and-suggest

Not one of the lessons-06..10 tasks. It follows the §12.3 flow (spec → implement → test → review → docs) on the branch
the session designates, `claude/eloquent-sagan-5340sj`. No PR unless asked.

## Scope
1. **Report** button on every question: question bank (practice, exam, Browse reuse `renderPanes`), lesson student view
   (instructor-paced + self-paced) and lesson history. In the question bar next to Mark for Review.
2. **Triage** in the Worker (`ctx.waitUntil`): store → Anthropic Messages API → JSON → validator → admin **Reports** tab.
3. **Suggest a feature** in the More menu (bank + lessons) → `feature_suggestions` → admin **Suggestions** tab.
4. Small migration `0011_reports.sql` (+ `schema.sql`), Free-plan safe.

## Files
- new `src/reports.js` (config constants, validator, prompt, Claude call, routes), `migrations/0011_reports.sql`,
  `public/shared/report.js` (capture helper + modal shared by bank and lessons), `admin-ui/Reports.tsx`, `admin-ui/Suggestions.tsx`
- edit `src/index.js` (routes, `ctx`, bank-cache stamp), `src/index.e2e.js` (pass `ctx`), `schema.sql`, `public/index.html`,
  `lesson-ui/{Stage,index,Self,History,types}.tsx`, `admin-ui/index.tsx`, `wrangler.e2e.toml`, `playwright.config.js`,
  `tools/e2e_seed.cjs`, `tools/e2e_anthropic_mock.cjs` (new), `wrangler.toml` comments, `.env.example`

## Decisions
1. **User ID** is taken from the validated token, never from the request body (CLAUDE.md: no client-supplied owner). The
   "sends user ID" requirement is met server-side.
2. **Rendered HTML** is the question card's `innerHTML` with each successfully rendered KaTeX node collapsed back to its
   TeX in `\( \)` (a `.katex-error` node is kept as rendered). Reason: KaTeX output is ~10× the size of its source and hides
   what a fix must edit. Stored ≤ 100 000 chars (413 above); ≤ 30 000 sent to Claude.
3. **Zoom** = `outerWidth / innerWidth` (rounded to 2 dp; null when unavailable) plus `devicePixelRatio`.
4. **Model** `TRIAGE_MODEL = 'claude-opus-5-5'`, one constant in `src/reports.js`. Plain `fetch` to `/v1/messages`
   (no new dependency; CLAUDE.md). Effort `low`, thinking left at the model default (Opus 5.5 always thinks), 25 s abort so the
   `waitUntil` budget is not exceeded → escalation "timed out". Secret `ANTHROPIC_API_KEY`; absent → escalation.
5. **Output** `{"action":"fix","reason":"…","patch":{stem_html?,choices_json?,explanation_html?}}` or
   `{"action":"escalate","reason":"…"}`. Bad JSON, refusal, `max_tokens`, HTTP error, timeout → escalation.
6. **Validator** (`checkPatch`), any failure → escalation carrying the reason and the rejected patch:
   - keys ⊆ {stem_html, choices_json, explanation_html}; `correct_answer` and everything else are never patchable;
   - markup safety: no script/iframe/object/embed/link/meta/style/base/form/foreignObject, no `on*`/`srcdoc`/`formaction`,
     no `javascript:`/`data:` values, every URL attribute is either already in the original field or `/qimg/<file>`;
   - visible text + math must be identical after canonicalisation (tags removed, entities decoded, whitespace, `$`, math
     delimiters, spacing/sizing macros, braces and `\text`-style wrappers ignored). That canonicalisation *is* the formatting
     tolerance; there is no extra character budget. So a typo fix always escalates;
   - `choices_json`: same length, same letters in same order, only `content`/`img` may differ, all other keys deep-equal;
   - `normalizeQuestion` on before/after gives the same `answer`, `spr` and choice letters (covers grid-in answers that
     are parsed out of the explanation).
7. **Wrong-answer** reports never call Claude: they create an escalation at once. Anything the model says needs renderer
   code changes must come back as `escalate` (prompt rule); nothing in the validator can detect it.
8. **Fixes are never auto-applied** (`AUTO_APPLY_FORMATTING_FIXES = false`). When true, a validated fix whose open reports are
   all `formatting` is applied immediately. Off by default and covered by a unit test only.
9. **Admin decision** (`POST /api/admin/reports/decision`): Approve re-checks that the stored fields still equal the
   triage-time base (else 409), writes the question row in the right bank (core or AI via `ai_ids`) and closes every open
   report on the question; Reject / Close closes them too without writing. Pending triage rows for the question are settled
   with it. Older pending rows are `superseded` when a newer call lands.
10. **Cache**: an approval changes `question_triage` and not `questions` rowids, so `stamps()` folds
    `COUNT(*) FROM question_triage WHERE status='applied'` (partial index) into the bank key. Otherwise the 1 h bank cache
    would keep serving the broken question.
11. **Limits** (all constants in `src/reports.js`): 10 reports/user/24 h; one open report per user per question (partial
    unique index); ≤ 1 Claude call per question per 24 h and ≤ `MONTHLY_CALL_CAP` (300) calls per calendar month (UTC), both
    claimed with one conditional INSERT so concurrent reports cannot both call; 5 suggestions/user/24 h.
    A report that arrives inside the 24 h window is stored and shows in the admin group as "awaiting triage"; it is
    included in the next call for that question. When the monthly cap is hit, an escalation "monthly cap reached" is created.
12. **Live lessons keep their frozen copy** of the question rows for the running session (DO memory); a fix shows up in the
    bank, My Lessons and new sessions.
13. **Free plan**: report = 1 insert; Claude call = 1 claim insert + 1 update; suggestion = 1 insert; admin lists are
    bounded (≤ 200 rows); indexes on (user_id, created_at) and (question_id).

## Unit tests (`tests/test_reports.cjs`, Claude API mocked by an injected `fetch`)
validator accepts markup/math/table/figure-reference fixes; rejects answer-key, correct-choice, choice-order, letter, text,
unsafe-markup, unknown-field and grid-in answer changes; triage stores fix vs escalation; bad JSON/refusal/timeout/no key →
escalation; wrong-answer → no call; limits (10/day, one open per question, one call per question per 24 h, monthly cap,
5 suggestions/day); approve writes core and AI rows and closes reports; stale approve 409; auto-apply flag; the real API URL is
never used (E2E_TEST_MODE guard).

## E2E checkpoints (`tests/e2e/report-and-suggest/`, Anthropic mocked by `tools/e2e_anthropic_mock.cjs`)
- **R1** report from the bank: button beside Mark for Review, modal (4 categories, optional note), "Thanks", payload holds
  question id, where seen, viewport, zoom, rendered HTML, no image data.
- **R2** report from a lesson (student view, instructor-paced) and from lesson history.
- **R3** a mocked valid fix → pending in Reports with real-renderer before/after → Approve → the student sees the fixed
  question in the bank; reports closed.
- **R4** a mocked fix that changes the answer key/choice → rejected by the validator → shown as an escalation.
- **R5** rate limits: 11th report in a day, duplicate open report, second Claude call inside 24 h, monthly cap.
- **R6** suggestion round trip: submit from the bank More menu and from a lesson → Suggestions tab newest first → mark done /
  dismiss; 6th suggestion refused.
- Leak check: no correct answer/explanation reaches a student in any new response (the report response is `{ok:true}`).
- Full existing suite stays green (baseline: unit 146/148 environmental, e2e see e2e.md).

## Review items
(a) triage/admin data never reach a student; (b) prompt-injection: reports/notes are data, output is validated, never
auto-applied; (c) no per-event D1 writes; (d) no duplicate stat logic; (e) `handleRequest` still works without `ctx`.
