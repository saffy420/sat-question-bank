# Practice Exams + UI Fixes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix the Cross-Text dupe and topic order, make sync silent-on-success with a closable failure toast, move the eliminator outside the choice with a hotdog strike, add Practice Exams (5 fixed adaptive tests, results page, practice-missed), a signed-in History page backed by D1, and a right-docked notepad panel.

**Architecture:** Single-file SPA `public/index.html` + Worker `src/index.js` + D1. Exam question sets are a static `public/exams.json` built once by `tools/build_exams.cjs` from the two local D1 files. Exam/review sessions are one JSON blob per session in a new `sessions` table, pushed through the existing retry queue. Pure logic (routing, curves, cbSort, sync queue) lives between `// --- <name>` markers so `node test_*.cjs` lifts it out of the page.

**Tech Stack:** Vanilla JS, Cloudflare Workers + D1, `node:sqlite` for tools/tests, wrangler.

Spec: `docs/superpowers/specs/2026-09-17-practice-exams-ui-fixes-design.md`. Branch already has the AI bank merged (commit `91d6e22a`).

---

## File map

| File | Change |
|---|---|
| `tools/aiq/rw_11.jsonl`, `rw_12.jsonl`, `rw_13.jsonl` | domain of ai_rw231/256/281 → Craft and Structure |
| `migrations_ai/0002_cross_text_domain.sql` | same UPDATE for remote AI D1 |
| `migrations/0010_sessions.sql`, `schema.sql` | `sessions` table |
| `src/index.js` | whoami cache, touchUser once, `/api/sessions` GET/POST/DELETE |
| `tools/build_exams.cjs` → `public/exams.json` | 5 fixed tests (ids only) |
| `public/index.html` | cbSort, toast, eliminator, exam player + results, history tab, notepad panel, CSS |
| `test_exams.cjs` (new), `test_sync.cjs`, `test_worker_sql.cjs` | checks |
| `CLAUDE.md` | dated section at the end |

---

### Task 1: Cross-Text domain fix (data)

**Files:** `tools/aiq/rw_1{1,2,3}.jsonl`, `migrations_ai/0002_cross_text_domain.sql`, local AI sqlite.

- [ ] **Step 1: Stop `wrangler dev` if running** (it flushes its in-memory D1 over any file write on shutdown).

- [ ] **Step 2: Fix the jsonl + local D1 + emit migration**

```bash
sed -i 's/"id":"ai_rw\(231\|256\|281\)","section":"Reading & Writing","domain":"Information and Ideas"/"id":"ai_rw\1","section":"Reading \& Writing","domain":"Craft and Structure"/' tools/aiq/rw_11.jsonl tools/aiq/rw_12.jsonl tools/aiq/rw_13.jsonl
cat > migrations_ai/0002_cross_text_domain.sql <<'SQL'
-- Three AI rows filed Cross-Text Connections under Information and Ideas, so the
-- topic dropdown listed the skill twice. The skill belongs to Craft and Structure.
UPDATE questions SET domain = 'Craft and Structure'
 WHERE skill = 'Cross-Text Connections' AND domain <> 'Craft and Structure';
SQL
node -e "const {DatabaseSync}=require('node:sqlite');const d=new DatabaseSync('.wrangler/state/v3/d1/miniflare-D1DatabaseObject/0ac785e50256c7bd28d88a7cb4506d3cc3e2388ea567885d5b5e222f9f46b5a1.sqlite');d.exec(require('fs').readFileSync('migrations_ai/0002_cross_text_domain.sql','utf8'));console.log(d.prepare(\"select domain,count(*) n from questions where skill='Cross-Text Connections' group by 1\").all())"
```
Expected: `[{ domain: 'Craft and Structure', n: 11 }]`, and `grep -c '"domain":"Information and Ideas","skill":"Cross-Text' tools/aiq/*.jsonl` sums to 0.

- [ ] **Step 3: Remote** `npx wrangler d1 execute sat_ai_bank --remote --file migrations_ai/0002_cross_text_domain.sql`, then verify `npx wrangler d1 execute sat_ai_bank --remote --command "select domain,count(*) from questions where skill='Cross-Text Connections' group by 1"`. If no Cloudflare credentials in this session, record that in the final report.

- [ ] **Step 4: Commit** `git commit -am "fix: file the three AI Cross-Text rows under Craft and Structure"`

---

### Task 2: College Board order everywhere (`cbSort`)

**Files:** `public/index.html` (after `const DIFFS` ~line 1816; `.sort()` at 1857, 1871, 2231–2232, 2345–2346; `bars` at 2046).

- [ ] **Step 1: Add constants + helper right after `const DIFFS = [...]`**

```js
// Official College Board order for domains and skills. Alphabetical put Advanced
// Math before Algebra and Boundaries before Central Ideas.
const DOM_ORDER = ['Information and Ideas', 'Craft and Structure', 'Expression of Ideas', 'Standard English Conventions',
  'Algebra', 'Advanced Math', 'Problem-Solving and Data Analysis', 'Geometry and Trigonometry'];
const SKILL_ORDER = [
  'Central Ideas and Details', 'Inferences', 'Command of Evidence',
  'Words in Context', 'Text Structure and Purpose', 'Cross-Text Connections',
  'Rhetorical Synthesis', 'Transitions',
  'Boundaries', 'Form, Structure, and Sense',
  'Linear equations in one variable', 'Linear functions', 'Linear equations in two variables',
  'Systems of two linear equations in two variables', 'Linear inequalities in one or two variables',
  'Equivalent expressions', 'Nonlinear equations in one variable', 'Nonlinear functions',
  'Ratios, rates, proportional relationships, and units', 'Percentages',
  'One-variable data: Distributions and measures of center and spread',
  'Two-variable data: Models and scatterplots', 'Probability and conditional probability',
  'Inference from sample statistics and margin of error',
  'Evaluating statistical claims: Observational studies and experiments',
  'Area and volume', 'Lines, angles, and triangles', 'Right triangles and trigonometry', 'Circles'];
const cbIdx = (k) => { const i = DOM_ORDER.indexOf(k), j = SKILL_ORDER.indexOf(k); return i >= 0 ? i : j >= 0 ? 100 + j : 1e9; };
const cbSort = (list) => list.slice().sort((a, b) => cbIdx(a) - cbIdx(b) || a.localeCompare(b));
```

- [ ] **Step 2: Replace the six sorts.** `Object.keys(groups).sort()` → `cbSort(Object.keys(groups))`; `[...groups[d]].sort()` → `cbSort([...groups[d]])` (drawTopics, drawMistakes, drawBrowse). In `bars`, replace `.sort((a, b) => b[1].a - a[1].a || a[0].localeCompare(b[0]))` with `.sort((a, b) => cbIdx(a[0]) - cbIdx(b[0]) || a[0].localeCompare(b[0]))`.

- [ ] **Step 3: Check** `grep -n '\.sort()' public/index.html` shows only line ~2118 (`pc.n` sections) and ~2143 (levels). Then commit `feat: topic lists in College Board order`.

---

### Task 3: Sync — Worker cache + client toast

**Files:** `src/index.js:73-107`, `public/index.html` sync block 1201–1282 + CSS line ~431/450, `test_sync.cjs`.

- [ ] **Step 1: Worker**

```js
const expOf = (t) => {
  const seg = t.split('.');
  if (seg.length !== 3) return 0;
  try { const c = JSON.parse(atob(seg[1].replace(/-/g, '+').replace(/_/g, '/'))); return typeof c.exp === 'number' ? c.exp * 1000 : 0; }
  catch (e) { return 0; }
};
function looksLive(t) { return expOf(t) > Date.now(); }

// Token -> user until the token expires. A save used to cost a Supabase round-trip
// every time; an access token lives an hour, so one lookup covers a whole sitting.
// ponytail: unbounded per isolate, cleared at 1000 entries; an LRU if that ever matters.
const WHO = new Map();
async function whoami(req, env) {
  const t = (req.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '');
  const exp = t ? expOf(t) : 0;
  if (exp <= Date.now()) return null;
  const hit = WHO.get(t);
  if (hit) return hit;
  const r = await fetch(`${env.SUPABASE_URL}/auth/v1/user`, { headers: { Authorization: `Bearer ${t}`, apikey: env.SUPABASE_ANON_KEY } });
  if (!r.ok) return null;
  const u = await r.json().catch(() => null);
  if (!(u && u.id)) return null;
  if (WHO.size > 1000) WHO.clear();
  WHO.set(t, u);
  return u;
}
const TOUCHED = new Set();
async function touchUser(env, u) {
  if (TOUCHED.has(u.id)) return;
  ... existing upsert ...
  TOUCHED.add(u.id);
}
```
(Cache entries are keyed by token; the token's own `exp` is checked before the lookup so a cached expired token is never served.)

- [ ] **Step 2: Client.** In `flush`, add `keepalive: true` to the fetch options. Replace `readWarn`/`warnSync`/`syncBanner` with:

```js
let readWarn = '', toastShut = false;
function warnSync(msg) { readWarn = msg; toastShut = false; syncBanner(true); }

// Failure only. Nothing is shown while saves succeed; a failed flush or a failed
// read raises the toast, ✕ hides it, and it stays hidden until the queue drains
// and a later flush fails again.
function syncBanner(failed) {
  const n = unsaved();
  const text = [readWarn, n ? `${n} answer${n === 1 ? '' : 's'} not saved yet — retrying.` : ''].filter(Boolean).join(' ');
  let b = $('sync-bar');
  if (!text) { toastShut = false; if (b) b.remove(); return; }
  if (!failed || toastShut) return;
  if (!b) {
    b = document.createElement('div'); b.id = 'sync-bar';
    b.innerHTML = '<span id="sync-msg"></span><button id="sync-x" title="Dismiss">✕</button>';
    document.body.appendChild(b);
    $('sync-x').onclick = () => { toastShut = true; b.remove(); };
  }
  $('sync-msg').textContent = text;
}
```
In `flush`: the `catch` calls `syncBanner(true)`; the line after `inflight[url] = false;` becomes `if (sent) syncBanner(false);` (removes the toast once drained). CSS: `#sync-bar { display:flex; align-items:center; gap:12px; justify-content:space-between; }` plus `#sync-bar button { background:transparent; border:0; color:inherit; font-size:15px; padding:2px 6px; }` — it is already fixed bottom-center.

- [ ] **Step 3: test_sync.cjs.** Extend the `PRE` stub's `createElement` with `set innerHTML(v) { els['sync-msg'] = { textContent: '' }; els['sync-x'] = {}; }` and `set textContent` on the msg. Update assertions: `banner()` reads `els['sync-msg'].textContent` when `els['sync-bar']` exists else `undefined`. Add: after a failure `els['sync-x'].onclick()` → `banner()` undefined; a second failing push still hides; `fail=false; push` drains → then `fail=true; push` → toast back. Run `node test_sync.cjs` → prints ok.

- [ ] **Step 4: Commit** `feat: sync is silent on success, one closable toast on failure`.

---

### Task 4: Eliminator outside the choice, hotdog strike

**Files:** `public/index.html` choiceHTML (2543–2580), renderAnswerArea ko handler (2688–2695), `mm-clear-ko`, CSS 415–431/455, mobile 662.

- [ ] **Step 1: Markup.** `choiceHTML` returns
```html
<div class="choice-row">
  <div class="choice … [ko]" data-letter="A">badge, body, [chk-btn]</div>
  <button class="ko-btn [on]" data-ko="A" title="Eliminate choice"><s>A</s></button>   (not in staticMode)
</div>
```
Add `' ko'` to `cls` when `S.ko[q.id]` includes the letter.

- [ ] **Step 2: Handler.** In renderAnswerArea, `const koBtn = el.parentElement.querySelector('.ko-btn')`; on click toggle `koBtn.classList.toggle('on')` **and** `el.classList.toggle('ko')`.

- [ ] **Step 3: CSS.** Replace the `.ko-btn` rules:
```css
.choice-row { display: flex; align-items: center; gap: 10px; }
.choice-row .choice { flex: 1; min-width: 0; position: relative; }
.choice.ko { opacity: .55; }
.choice.ko::after { content: ""; position: absolute; left: 12px; right: 12px; top: 50%; height: 2px; margin-top: -1px; background: var(--text); border-radius: 1px; pointer-events: none; }
.ko-btn { flex: 0 0 28px; width: 28px; height: 28px; border-radius: 50%; border: 1.5px dashed var(--border2); background: transparent; color: var(--dim2); font-size: 12px; font-weight: 700; padding: 0; display: inline-flex; align-items: center; justify-content: center; }
.ko-btn:hover { border-color: var(--dim); color: var(--dim); }
.ko-btn.on { border-style: solid; border-color: var(--red); background: var(--red-bg); color: var(--red); }
```
`.choices` gap stays. Commit `feat: eliminator button beside the choice, strike through the whole row`.

---

### Task 5: Exam sets — `tools/build_exams.cjs` → `public/exams.json`

**Files:** create `tools/build_exams.cjs`, `public/exams.json`.

- [ ] **Step 1: Script.** Reads both sqlite files (`main`, `ai`) with `node:sqlite` read-only; `mulberry32(20260917)` PRNG; global `used` set.

Blueprints per module:
```js
const RW_DOM = { 'Information and Ideas': 7, 'Craft and Structure': 8, 'Expression of Ideas': 5, 'Standard English Conventions': 7 };
const MATH_DOM = { 'Algebra': 8, 'Advanced Math': 8, 'Problem-Solving and Data Analysis': 3, 'Geometry and Trigonometry': 3 };
const DIFF = { m1: { Easy: 1, Medium: 1, Hard: 1 }, m2easy: { Easy: 3, Medium: 3, Hard: 1 }, m2hard: { Easy: 1, Medium: 3, Hard: 4 } };  // weights
const SPR = 5; // grid-ins per Math module
```
`pick(pool, domQuota, diffW, sprN)`: shuffle pool; for each domain, take `quota` rows preferring the difficulty whose (taken/weight) is lowest; for Math take `SPR` grid-ins first spread across domains, then MCQ. Skip ids in `used`. Throws if a quota cannot be met.

Tests 1–3: pool = official rows. Tests 4–5: `m1` pool = official Hard ∪ AI level 4 (target 70/30 by taking AI first for ~30% of each domain quota then official); `m2hard` pool = AI level 4/5 first (~75%) then official Hard; `m2easy` = official Hard. Order RW modules by `DOM_ORDER`, Math by Easy→Medium→Hard.

Output `public/exams.json`:
```json
{ "built": "2026-09-17", "tests": [ { "id": "t1", "name": "Practice Test 1", "hard": false,
    "rw": { "m1": [...27], "m2easy": [...27], "m2hard": [...27] },
    "math": { "m1": [...22], "m2easy": [...22], "m2hard": [...22] } }, … ] }
```
Self-check at the end of the script: counts, no duplicate id across all sets, tests 1–3 contain no `ai_` id, tests 4–5 only `difficulty='Hard'`, each Math module has 4–6 grid-ins. Print a table of counts.

- [ ] **Step 2: Run** `node tools/build_exams.cjs` → `public/exams.json` (~750 ids, ≈15 KB). Commit `feat: five fixed practice exams built from the two banks`.

---

### Task 6: Exam logic block + `test_exams.cjs`

**Files:** `public/index.html` new `// --- exam` … `// --- end exam` block (pure, before `start()`), `test_exams.cjs`.

- [ ] **Step 1: Block**

```js
// --- exam (test_exams.cjs reads this block)
const MODS = [
  { sec: 'Reading & Writing', n: 27, ms: 32 * 60000, cut: 16 },
  { sec: 'Reading & Writing', n: 27, ms: 32 * 60000 },
  { sec: 'Math', n: 22, ms: 35 * 60000, cut: 13 },
  { sec: 'Math', n: 22, ms: 35 * 60000 }];
const BREAK_MS = 10 * 60000;
// ~60% right on module 1 earns the harder module 2.
const routeOf = (modIdx, raw) => raw >= MODS[modIdx].cut ? 'm2hard' : 'm2easy';
// Raw -> scaled, piecewise linear through anchors that approximate the published
// Bluebook conversion tables. An estimate, and the UI says so.
const CURVE = {
  'Reading & Writing': { m2hard: [[0,330],[10,400],[15,440],[20,480],[25,520],[30,560],[35,600],[40,640],[45,690],[50,750],[54,800]],
                         m2easy: [[0,300],[5,350],[15,420],[25,480],[35,540],[45,590],[54,640]] },
  'Math':              { m2hard: [[0,350],[10,440],[15,490],[20,540],[25,590],[30,640],[35,690],[40,750],[44,800]],
                         m2easy: [[0,300],[5,360],[15,430],[25,500],[35,570],[44,630]] } };
function scaled(sec, route, raw) {
  const a = CURVE[sec][route];
  if (raw <= a[0][0]) return a[0][1];
  for (let i = 1; i < a.length; i++) if (raw <= a[i][0]) {
    const [x0, y0] = a[i - 1], [x1, y1] = a[i];
    return Math.round((y0 + (y1 - y0) * (raw - x0) / (x1 - x0)) / 10) * 10;
  }
  return a[a.length - 1][1];
}
const scoreRange = (s) => [Math.max(200, s - 30), Math.min(800, s + 30)];
// --- end exam
```

- [ ] **Step 2: `test_exams.cjs`** lifts the block by markers (as `test_focus.cjs` does), asserts: `routeOf(0,16)==='m2hard'`, `routeOf(0,15)==='m2easy'`, `routeOf(2,13)`/`(2,12)`; every curve monotone non-decreasing over its full raw range and within 200–800; `scaled('Math','m2hard',44)===800`; reads `public/exams.json` and asserts 5 tests, module sizes 27/27/27/22/22/22, no id twice, t1–t3 have no `ai_` ids. Run `node test_exams.cjs` → ok. Commit.

---

### Task 7: Sessions API + `sessions` table

**Files:** `migrations/0010_sessions.sql`, `schema.sql`, `src/index.js`, `test_worker_sql.cjs`.

- [ ] **Step 1: SQL**
```sql
-- One JSON blob per exam or review session. Read as a whole, rewritten as a whole;
-- purged 30 days after its last write on the next read.
CREATE TABLE IF NOT EXISTS sessions (
  user_id TEXT NOT NULL,
  id TEXT NOT NULL,
  kind TEXT NOT NULL,
  state TEXT NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, id)
);
```
Apply locally: `npx wrangler d1 execute sat_question_bank --local --file migrations/0010_sessions.sql` (server stopped). Remote when credentials allow.

- [ ] **Step 2: Routes** (before `/auth/callback`)
```js
const MAX_SESSION = 65536;
const DAY = 86400000;
if (p === '/api/sessions' && req.method === 'GET') {
  const u = await whoami(req, env);
  if (!u) return json({ error: 'unauthorized' }, 401);
  await env.DB.prepare('DELETE FROM sessions WHERE user_id = ? AND updated_at < ?').bind(u.id, Date.now() - 30 * DAY).run();
  const r = await env.DB.prepare('SELECT id, kind, state, updated_at FROM sessions WHERE user_id = ? ORDER BY updated_at DESC').bind(u.id).all();
  return json(r.results || []);
}
if (p === '/api/sessions' && req.method === 'POST') {
  const u = await whoami(req, env);
  if (!u) return json({ error: 'unauthorized' }, 401);
  const b = await req.json().catch(() => null);
  const rows = (Array.isArray(b) ? b : [b]).filter(r => r && typeof r.id === 'string' && r.id && r.state && typeof r.state === 'object').slice(0, 50);
  if (!rows.length) return json({ ok: true, saved: 0 });
  const stmt = env.DB.prepare(`INSERT INTO sessions (user_id, id, kind, state, updated_at) VALUES (?,?,?,?,?)
    ON CONFLICT(user_id, id) DO UPDATE SET kind=excluded.kind, state=excluded.state, updated_at=excluded.updated_at`);
  const binds = [];
  for (const r of rows) { const s = JSON.stringify(r.state); if (s.length > MAX_SESSION) return json({ error: 'too large' }, 413); binds.push(stmt.bind(u.id, str(r.id, 64), str(r.kind, 16) || 'exam', s, Date.now())); }
  await env.DB.batch(binds);
  return json({ ok: true, saved: rows.length });
}
if (p.startsWith('/api/sessions/') && req.method === 'DELETE') {
  const u = await whoami(req, env);
  if (!u) return json({ error: 'unauthorized' }, 401);
  await env.DB.prepare('DELETE FROM sessions WHERE user_id = ? AND id = ?').bind(u.id, p.slice('/api/sessions/'.length)).run();
  return json({ ok: true });
}
```

- [ ] **Step 3: test_worker_sql.cjs** appends: upsert twice keeps one row with the second state; a row with `updated_at` 31 days old is removed by the purge statement, a fresh one is kept. Run → ok. Commit `feat: sessions table and /api/sessions`.

---

### Task 8: Exam player, break, results, practice missed

**Files:** `public/index.html` — markup (rail, `#tab-exams`, `#view-exam-res`, top-bar `#exam-lbl`), `start()`, `renderQTimer`, `renderAnswerArea`, `loadQuestion`, `btn-next`, `btn-dash`, `btn-map`, `grade` (extract `recordProgress`/`recordAttempt`), new `startExam/runModule/endModule/breakScreen/finishExam/drawExamResults/openReview/practiceMissed`, CSS.

- [ ] **Step 1: Rail + tabs.** Add after Browse: `<button class="nav-i" data-tab="exams">…📄 svg…<span>Practice Exams</span></button>` and `<button class="nav-i" data-tab="history">…🕘 svg…<span>History</span></button>`. `TABS = ['practice','dash','browse','mistakes','exams','history','settings']`; `setTab`: `if (t === 'exams') drawExams(); if (t === 'history') drawHistory();`. Phone bar CSS (760 block): the rail already spreads `.nav-i` evenly; add in the `max-width: 360px` block `.nav-i > span { display: none; }`.

- [ ] **Step 2: `#tab-exams` markup** — a `.panel` per test card grid: name, "Official bank" / "Harder · both banks" tag, 4 modules · 2h 14m, buttons **Start**. Start → modal with Normal time / No time limit (`.fx-o` buttons, reuse `.fx-row` styles) → `startExam(test, mode)`. If an in-progress exam session for that test exists in `SESS`, the card says "Resume" instead and calls `resumeExam(sess)`.

- [ ] **Step 3: State.** `EX = { id, testId, name, mode, modIdx, route: {}, mods: [{ ids, ans, flags, elapsed, done }×4], startedAt, finished: null }`. Per module, `runModule(i)`: items = QS by ids (route decides m2 key), `start(items, { exam: true })` then `S.exam = EX; S.ans = mod.ans; S.flags = mod.flags; S.timing = EX.mode === 'normal' ? 'set' : 'off'; S.setEnds = Date.now() + MODS[i].ms - mod.elapsed; S.modStart = Date.now() - mod.elapsed;` and `loadQuestion()` again. In `start()` accept `o.exam` (skip nothing else).

- [ ] **Step 4: Player differences under `S.exam`** (one `const inExam = !!(S && S.exam)` at each site):
  - `renderAnswerArea`: MCQ click sets `S.ans[q.id] = letter`, toggles `.sel`, no Check button; grid-in has no Submit, `input`/`change` writes `S.ans[q.id]`. Pass `picked = S.ans[q.id]` and `checked = false`.
  - `loadQuestion`: hide `#btn-expl`, `#btn-export`, `#btn-pause`, `#btn-hide-timer`; show `#exam-lbl` = `${EX.name} · ${sec} · Module ${1|2}`; `#btn-dash` text "Save & quit"; `#btn-next` on last → "Finish module".
  - `renderQTimer`: `if (S.exam && S.timing === 'off') s = elapsed since S.modStart`; `if (S.exam && S.timing === 'set' && left < 0) return endModule()`.
  - `btn-next` last question in exam → `confirmModal('Finish this module? You cannot return to it.', endModule)`.
  - `btn-dash` in exam → `confirmModal('Save and quit? …', saveQuit)`; `saveQuit` stores `mod.elapsed`, `saveSession(EX)`, `S = null; showHome(); setTab('history')` (guest: home).
  - `btn-map` in exam: cells `answered` (blue) / `flagged` / `current` only, legend "Answered · Marked · Current".
  - `S.exam` keeps `saveSession` debounced (2 s) on every answer/flag change.
- [ ] **Step 5: `endModule()`**: stop timer; `mod.elapsed = MODS[i].ms - (S.setEnds - now)` or `now - S.modStart`; `mod.done = true`; raw = count `isRight === true`; if `i === 0 || i === 2` → `EX.route[sec] = routeOf(i, raw)`; `saveSession(EX)`; `i === 1` → `breakScreen()`; `i === 3` → `finishExam()`; else `runModule(i + 1)`.
  `breakScreen()`: modal in `#modal-root`, 10:00 countdown (`setInterval`), "Resume now" button; ends → `runModule(2)`. Untimed mode: same screen, no countdown.

- [ ] **Step 6: `finishExam()`**: for each module/question: `ok = isRight(q, ans)`; `recordProgress(q, ok, now, 0)` + `recordAttempt(q, ok, now, 0, ans, 0)` (helpers extracted from `grade`: the `if (first) {…}` body and the `ev` block, both taking `(q, ok, now, ms, picked, changes)`). Compute `EX.score = { rw: { raw: [m1,m2], route, scaled, range }, math: {…}, total, breakdown: { [sec]: { [domain]: { [skill]: {a, c} } } }, missed: [ids], marked: [ids], times: [ms×4] }`; `EX.finished = Date.now()`; `saveSession(EX)`; `refresh()`; `drawExamResults(EX)`.

- [ ] **Step 7: Results view `#view-exam-res`** (markup next to `#view-results`): hero (name, date, mode), `.cards` KPI tiles (Total `1240` · likely 1180–1300; RW; Math; Time), route line ("Reading & Writing: Module 2 (harder) · Math: Module 2 (easier)"), per-module raw table, breakdown panels reusing `.prog-item` bars per domain → skill, buttons **Practice missed (n)** / **Back to History** / **Home**, then a filter row All / Missed / Marked over a `.res-list` of every question (number, section, skill, your answer → correct, ✓/✗). Click → `openReview(EX, idx)`.

- [ ] **Step 8: `openReview(EX, idx)`**: `S = { items: allQs, i: idx, ans: mergedAns, checked: all true, tried: all true, flags: mergedFlags, ko: {}, sel: {}, miss: {}, noted: {}, changes: {}, review: EX, timing: 'off', focus: false }`; show `#view-test`; `loadQuestion()`; explanation panel opens automatically; `#btn-dash` reads "← Results" and returns to `drawExamResults(EX)`; Next past the last → back to results. `renderAnswerArea` in the checked branch already paints right/wrong/dim.

- [ ] **Step 9: `practiceMissed(EX)`**: items = `EX.score.missed` mapped to QS; `start(items, { timing: 'off' })`; `S.session = { id: 'rv_' + EX.id, kind: 'review', examId: EX.id, name: EX.name + ' · missed' }`; on every `grade`, if `S.session` → `saveSession(reviewState(S))` where `reviewState = { …S.session, ids, i, ans, checked, tried }`; `finish()` marks it `finished`. Resume from History restores those fields after `start()`.

- [ ] **Step 10: Browser check** (`wrangler dev`, Claude Browser pane): start Test 1 untimed, answer 3, Save & quit, resume from History, finish all four modules with the map, see the results page, open a review item, Practice missed. Then Test 4 normal time: timer counts down, module ends at 0. Commit `feat: practice exams with adaptive modules, results and review`.

---

### Task 9: History tab

**Files:** `public/index.html` — `SESS`, `loadProgress`, `push()` dedupe key, `saveSession`, `#tab-history`, `drawHistory`.

- [ ] **Step 1: Data.** `let SESS = {}` (id → row `{id, kind, state, updated_at}`). In `loadProgress`, alongside notes: `fetch('/api/sessions')` → parse each `state`. `PENDING['/api/sessions'] = []`; in `push`, dedupe on `r.question_id || r.id`. `function saveSession(state) { SESS[state.id] = { id: state.id, kind: state.kind, state, updated_at: Date.now() }; clearTimeout(sessT); sessT = setTimeout(() => push('/api/sessions', [{ id: state.id, kind: state.kind, state }]), 2000); }` (guest: SESS only in memory, `push` already no-ops without a token). `deleteSession(id)`: `fetch('/api/sessions/' + id, { method: 'DELETE', headers: await sbHeaders() })`, `delete SESS[id]`, redraw.

- [ ] **Step 2: `#tab-history` markup + `drawHistory()`**: signed out → `.empty` "Sign in to keep exam history. Exams still run as a guest, but they are not saved." Signed in, no rows → "No sessions yet." Rows sorted by `updated_at` desc: date, name, kind pill (Exam / Review), status pill (In progress / Finished), score (`1240` or `—`), buttons: In-progress exam → **Resume**; finished exam → **View** + **Practice missed**; review → **Resume**/**View**; always **Delete** (confirmModal). Footer: "Sessions are deleted 30 days after their last change."

- [ ] **Step 3: Commit** `feat: history page for exam and review sessions`.

---

### Task 10: Notepad panel + note path check

**Files:** `public/index.html` — `#btn-note` handler, new `openNotePanel/closeNotePanel`, `loadQuestion`, `openExplanation`, `btn-calc`, CSS.

- [ ] **Step 1: Verify save path** in the browser: type a note in the explanation panel, blur, watch `POST /api/notes` 200 (network), reload, reopen the question → chip shows. If any step fails, fix before Step 2.

- [ ] **Step 2: Panel.**
```js
let noteT = null;
function closeNotePanel() {
  const np = $('note-panel');
  if (np) { clearTimeout(noteT); saveNote(np.dataset.qid, $('np-ta').value); np.remove(); }
  $('work').classList.remove('note-shift');
}
function fillNotePanel(q) { const np = $('note-panel'); if (!np) return; np.dataset.qid = q.id; $('np-ta').value = NOTES[q.id] || ''; $('np-msg').textContent = ''; }
function openNotePanel() {
  if (!S) return;
  if ($('note-panel')) return $('np-ta').focus();
  closeExpl(); if (desmosOpen) closeDesmos();
  const np = document.createElement('div'); np.id = 'note-panel'; np.className = 'note-panel';
  np.innerHTML = `<div class="ep-h"><span>📝 Notes</span><button class="icon-btn" id="np-close">✕</button></div>
    <div class="ep-b"><textarea class="note-ta" id="np-ta" placeholder="Notes while you solve. Saved to this question."></textarea>
    <div id="np-msg" class="np-msg"></div></div>`;
  document.body.appendChild(np);
  $('work').classList.add('note-shift');
  fillNotePanel(curQ());
  const save = () => { saveNote(np.dataset.qid, $('np-ta').value); renderNoteChip(curQ()); $('np-msg').textContent = 'Saved ✓'; };
  $('np-ta').oninput = () => { clearTimeout(noteT); $('np-msg').textContent = ''; noteT = setTimeout(save, 1000); };
  $('np-ta').onblur = () => { clearTimeout(noteT); save(); };
  $('np-close').onclick = closeNotePanel;
  $('np-ta').focus();
}
$('btn-note').onclick = openNotePanel;
```
`loadQuestion`: before rendering, `const np = $('note-panel'); if (np) { clearTimeout(noteT); saveNote(np.dataset.qid, $('np-ta').value); }` then after render `fillNotePanel(q)`. `openExplanation` and `btn-calc` call `closeNotePanel()`. CSS: `.note-panel` = `.expl-panel` rules with `width: 380px; min-width: 300px;`; `.work.note-shift .panes { margin-right: 400px; }`; mobile block: same bottom-sheet rules as `.expl-panel`, `.work.note-shift .panes { margin-right: 0 }`; `.np-msg { color: var(--green); font-size: 12.5px; margin-top: 6px; min-height: 16px; }`.

- [ ] **Step 3: Browser check**: open notepad on a practice question, type, wait 1 s → "Saved ✓" + POST; Next → panel follows with the next question's note (empty); Back → text is there; reload → chip. Commit `feat: notepad panel docked right while solving`.

---

### Task 11: Visual pass + docs

- [ ] **Step 1:** `--gold: #d19a00` (light) / `#f2b632` (dark) in `:root` blocks; `.flag-btn.on`, `.map-cell.flagged`, results "Marked" pill use it.
- [ ] **Step 2:** Walk at 1280 / 375 / 320, both themes: rail with 7 tabs (phone bar labels hidden ≤360), exams cards, exam top bar, results page, history table, notepad sheet, toast with ✕, eliminator row. `document.body.scrollWidth === innerWidth` at each width on every tab.
- [ ] **Step 3:** `node test_sync.cjs && node test_exams.cjs && node test_worker_sql.cjs && node test_grade.cjs && node test_notes.cjs && node test_focus.cjs` all pass.
- [ ] **Step 4:** CLAUDE.md: append a dated section (what changed, the whoami cache, the exam curve caveat, sessions purge, junction/deploy reminder). Commit `docs: practice exams pass`.
