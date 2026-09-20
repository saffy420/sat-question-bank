# Practice Exams, History, and four UI fixes — design (2026-09-17)

Approved in conversation. Applies to `public/index.html`, `src/index.js`,
`wrangler.toml`, D1 (main + AI bank), and tools.

## 0. Prep

Merge `origin/claude/ai-sat-question-bank-c11305` into this branch first. Only
conflict is `CLAUDE.md`; keep both sides. Everything below sits on top of the
merged tree (AI bank `AI_DB`, `ai_ids`, focus mode, `picked`/`changes` on
attempts).

## 1. Cross-Text dupe and topic order

- Root cause: AI rows `ai_rw231`, `ai_rw256`, `ai_rw281` carry domain
  `Information and Ideas` with skill `Cross-Text Connections`. The topic
  dropdown groups skills under domains, so the skill appears twice.
- Fix data: set domain to `Craft and Structure` in `tools/aiq/*.jsonl`, the
  local AI D1, and the remote AI D1 via `migrations_ai/0002_cross_text_domain.sql`.
- Order: constants `DOM_ORDER` and `SKILL_ORDER` in the official College Board
  order (RW: Information and Ideas → Craft and Structure → Expression of Ideas →
  Standard English Conventions; Math: Algebra → Advanced Math → Problem-Solving
  and Data Analysis → Geometry and Trigonometry; skills in CB order inside
  each). One `cbSort(list, key)` replaces alphabetical `.sort()` in the three
  topic dropdowns (Question Bank, Mistakes, Browse), the Topics table, and the
  dashboard by-domain / by-skill panels. Unknown names sort last, alphabetical.

## 2. Sync

Symptoms: banner shows too often and too long; answers take seconds to appear
saved.

- Worker: cache `whoami()` per token in module memory (`Map<token, {user, exp}>`),
  valid until the token's `exp`. Removes the Supabase round-trip from every
  save. `touchUser` runs once per user per isolate (a `Set`), not per POST.
- Client: `fetch(..., { keepalive: true })` on every push. No UI on success.
- Failure UI: `#sync-bar` becomes a bottom-center toast with a `✕` close button.
  Shown on a failed flush or a failed read. `✕` hides it; the retry loop keeps
  running. Once hidden it stays hidden until the queue has drained (a success)
  and a later flush fails again.
- Not doing: a local-first cache layer. `PROG`/`LOG` already update in memory
  on Check; lag is network only.

## 3. Eliminator

- `.ko-btn` moves out of `.choice` to a sibling on the right of the same row
  (`.choice-row { display:flex; align-items:center; gap }`).
- `.choice.ko`: `::after` draws one 2px line, full width, vertically centered
  (hotdog), text at reduced opacity. Choice stays clickable to select; button
  toggles off.
- `S.ko[q.id]` unchanged. `mm-clear-ko` unchanged.

## 4. Practice Exams (new rail tab)

### Structure
Real SAT: RW M1 27q / 32min → RW M2 27q / 32min → 10-min break (skippable) →
Math M1 22q / 35min → Math M2 22q / 35min. A finished module cannot be
re-entered. Inside a module: free navigation, question map, mark for review
(`--gold`), eliminator, calculator on Math, no Check / verdict / explanation.

### Adaptive cutoff
RW M1 ≥ 16/27 → hard M2, else easy. Math M1 ≥ 13/22 → hard M2, else easy.

### Question sets
Five fixed tests built once by `tools/build_exams.cjs` (seeded PRNG) into
`public/exams.json` — ids only, one static asset, no DB. No id appears in two
tests. Each test carries `rw.m1`, `rw.m2easy`, `rw.m2hard`, `math.m1`,
`math.m2easy`, `math.m2hard`.

- Tests 1–3 "Official": `source='CollegeBoard'` only. Domain mix per CB
  blueprint per module (RW 7/8/5/7 across the four domains; Math 8/8/3/3,
  ~5 grid-ins). M1 balanced E/M/H; M2-easy E-heavy; M2-hard H-heavy. RW ordered
  by domain order, Math easy → hard.
- Tests 4–5 "Hard": Hard only. M1 = official Hard + AI level 4; M2-hard =
  mostly AI level 4/5; M2-easy = official Hard.

### Timing modes
Start dialog: **Normal time** / **No time limit**. **Save & quit** always
available (top bar + More menu); clock frozen while away. Resume from History.

### Results page (immediately after the last module)
- KPI tiles: total scaled (400–1600), RW scaled, Math scaled, each with a
  ±30 range ("640 · likely 610–670"). Raw per module, route taken (easy/hard
  M2), time per module.
- Breakdown: section → domain → skill, right/answered with accuracy bars in the
  dashboard's existing style.
- Question review list: every question, filter All / Missed / Marked. Click →
  read-only player view: stem, your answer vs correct, explanation panel open,
  note box live. Prev/Next through the list. Same view from History → View.
- **Practice missed** → focus session (`S.focus`, no time limit, no ladder
  climb) over the exam's missed ids. Saved to History as `kind:'review'`
  linked to the exam id; resumable.
- Exam answers write `progress` + `attempts` at exam end so Mistakes and
  Dashboard reflect them.

### Scoring
Raw → scaled via a lookup table approximating Bluebook curves, separate for
easy-M2 and hard-M2 routes, per section. Monotone non-decreasing. Marked as an
estimate in the UI.

## 5. History (new rail tab, signed-in only)

- D1 (main): `sessions(user_id TEXT, id TEXT, kind TEXT, state TEXT, updated_at
  INTEGER, PRIMARY KEY(user_id, id))`. `migrations/0010_sessions.sql`. One JSON
  blob per exam or review session: test id, mode, module index, answers,
  marked, elapsed per module, route, score (when finished), missed ids.
- `GET /api/sessions`: runs `DELETE ... WHERE updated_at < now-30d` for the
  caller first, returns the rest. `POST /api/sessions`: upsert, rides `push()`
  (dedupe by `id`). `DELETE /api/sessions/:id`.
- Client saves on every answer and on quit, debounced 2s.
- Page: rows = date, test name, kind (Exam / Review), status
  (In progress / Finished), score. Buttons: Resume / View / Practice missed /
  Delete. Footer note: "Deleted after 30 days."
- Guest: exam runs in memory, nothing saved (matches current guest rule).
- Rail → 7 tabs (Dashboard, Mistakes, Question Bank, Browse, Practice Exams,
  History, Settings). Phone bar ≤ 360px: icons only.

## 6. Notes

- Verify save path end to end (Check → blur → `push('/api/notes')` → D1 →
  reload → chip). Fix whatever fails.
- New notepad panel: `#btn-notepad` (📝) in the bottom bar. Docks right at
  380px; textarea + "Saved ✓" state; autosave on blur and after 1s idle. Opens
  in practice, focus, exam, and review views. Shares the right slot with the
  explanation panel and Desmos — opening one closes the others. Explanation
  panel keeps its note box; both edit `NOTES[id]`.
- `#note-chip` under the answer area stays; a question opened in the practice
  bank with a note shows it.

## 7. Visual

Existing tokens only (`--panel`, `--border`, mint progress, rail navy). One new
token `--gold` for "marked for review". Results page uses the dashboard card
language (KPI tiles, bars). Exam player top bar: test name · module · timer ·
Save & quit. No new fonts. Checked at 1280 / 375 / 320, both themes.

## Tests

- `test_exams.cjs`: module routing at the cutoffs, scoring tables monotone,
  `exams.json` has no duplicate ids and matches the blueprint counts.
- `test_sync.cjs`: toast hidden on success, shown on failure, ✕ hides, reappears
  only after success → failure.
- `test_worker_sql.cjs`: sessions upsert and 30-day purge.
- Browser walk: one full exam in each timing mode, save & quit + resume,
  results page, practice-missed review, notepad save/reload.

## Skipped

Guest history, PDF score report, real CB curves (unpublished), per-question
timer in exam.
