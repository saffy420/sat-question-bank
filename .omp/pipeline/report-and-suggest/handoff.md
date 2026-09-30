# Handoff: report-and-suggest

## Shipped
- **Report** button in the question bar: bank player (next to Mark for Review), lesson student view (instructor- and self-paced) and lesson history.
  Dialog in `public/shared/report.js` (category, optional note). Sends question id, where seen, session id (lessons), viewport, zoom
  (`outerWidth/innerWidth`), dpr and the rendered question HTML (KaTeX collapsed to TeX). User id comes from the token. No screenshots.
- **Triage** (`src/reports.js`) in `ctx.waitUntil`: store → Claude Messages API (plain `fetch`, model `TRIAGE_MODEL = 'claude-opus-5-5'`,
  secret `ANTHROPIC_API_KEY`) → JSON fix or escalation → `checkPatch`. Rejected fixes become escalations carrying the reason.
  Wrong-answer reports escalate without a call. Fixes are never auto-applied; `AUTO_APPLY_FORMATTING_FIXES = false`.
- **Admin Reports tab**: grouped by question, before/after through the real renderer, Approve (writes the row in the core or AI bank,
  closes all open reports on the question) / Reject / Close. **Suggestions tab**: newest first, done / dismiss / reopen.
- **Suggest a feature** in the bank More menu and the lesson More menu (instructor- and self-paced).
- Limits: 10 reports/user/24 h, one open report per user per question, ≤ 1 Claude call per question per 24 h, `MONTHLY_CALL_CAP = 300`,
  5 suggestions/user/24 h.
- Migration `0011_reports.sql` (3 tables, 7 indexes) and `schema.sql`; `tools/e2e_seed.cjs` upgrades existing local e2e state.

## Before you deploy (manual checks)
1. `npx wrangler d1 execute DB --remote --file migrations/0011_reports.sql` **before** `npm run deploy`: `/api/questions` now reads `question_triage`.
2. `npx wrangler secret put ANTHROPIC_API_KEY`. Without it reports are stored and show as "Triage failed: ANTHROPIC_API_KEY is not configured".
3. Confirm the model id `claude-opus-5-5` is what you want to pay for (one constant). Worst case ~300 calls/month.
4. Send one real report from a Chromebook and check the Reports tab. Nothing here was run against the real API.
5. Check the dialog in the lesson view on the real Chromebook (top-layer `<dialog>` over the lesson overlay).

## Deviations / notes
- "Question bar" in lessons is the numbered strip above the stem (lessons have no Mark for Review there); the Report button follows the number.
- Report button is not on Browse previews or Copy-for-AI; only the player and lesson views.
- A report inside the 24 h window waits for the next call for that question (no scheduler); the admin can Close it.
- Reports tab shows ≤ 50 questions / 200 reports. A running live lesson keeps its frozen question copy; fixes show in the bank, My Lessons, new sessions.
- Approve on a question with an open wrong-answer report closes that report too (spec).
- Tests: 19 new unit tests; e2e R1–R6. See `e2e.md` for the 3 pre-existing environmental e2e failures and 2 unit failures.
