# Research: lessons-00-audit (task00 §12.5)

Research only. No feature code, config, test, or data changes. Artifact path follows the higher-priority instruction: `.opencode/pipeline/lessons-00-audit/` (brief's `.omp/` not used for this file). Task 00 has **no e2e checkpoints** — nothing e2e was written or run. The only execution performed: existing unit suite `npm test` (see §0.3).

## 0. Methods and evidence base

### 0.1 Sources read
- `docs/lessons/BRIEF.md` (461 lines, full), `CLAUDE.md` (standing instructions), `docs/AUDIT.md` (189 lines, full — Phase 1, baseline `cb9fac1b`; treat as historical where it conflicts with files below).
- Full reads: `src/index.js` (450 lines), `schema.sql`, `schema_ai.sql`, `wrangler.toml`, `package.json`, `.env.example`, `public/_headers`, `public/auth.js`, `migrations/0006_membership.sql`, `migrations_ai/0001_init.sql`.
- Targeted reads of `public/index.html` (4,040 lines): stats/metrics (1729–2250), filters (1902–1958), mistakes (2276–2360), browse (2436–2493), session/timer (2527–2619), renderer (2692–2906), grading (2908–3020), Desmos (3389–3452), exam finish/results (3454–3750), history (3780–3808), export (3810–3859), sync/load (1180–1503).
- Tests: `tests/test_metrics.cjs`, `tests/test_grade.cjs`, `tests/test_focus.cjs`, `tests/test_backfill.cjs`, `tests/test_auth_routing.cjs` (partial). 11 files, all `node --test`, `.cjs`, marker-lift pattern.
- Git: Windows `git.exe` via `rtk` (see §0.2).

### 0.2 Git state (Windows git.exe)
- Branch `setup` tracking `origin/setup`. HEAD `a7f81117 fix: resolve known-issues backlog and open Google sign-in to all domains`.
- `git.exe status --porcelain`: **clean except 4 untracked**: `.omp/`, `.serena/`, `docs/lessons/`, `docs/roadto1600-lessons-prompt.md`.
- WSL `rtk git status` reports "87 modified files" with `git diff --stat` = 20,533 insertions / 20,533 deletions — CRLF-only phantom diffs (matches `CLAUDE.md` warning). Windows `git.exe` is authoritative; no files modified by this task; unrelated untracked dirs left untouched.

### 0.3 Existing tests executed
`npm test` (`node --test "tests/test_*.cjs"`): **43 tests, 43 pass, 0 fail** (auth routing, worker SQL, metrics, focus, grade, backfill, notes, sync, tidy_expl, exams). These are the pre-existing checks; no lesson e2e exists or was claimed.

---

## 1. Rule-2 stats: existing vs derivable vs absent

Rule 2 lists: question history, mistake log, weak spots, accuracy by domain/skill, accuracy by difficulty, pacing, traps, second-guessing. All current computation is **client-side inline** in `public/index.html` inside one IIFE; the Worker has zero stat code. Data needed lives in D1 (`progress`, `attempts`) + bank rows (`questions`/`ai_ids`), all queryable server-side for any `user_id`.

Extraction/test markers already lift pure blocks: `// --- tidyExpl` (1125), `// --- backfillProgress` (1221), `// --- sync` (1293), `// --- focus` (1729), `// --- metrics` (1838), `// --- notesMd` (2377), `// --- exam` (2496), `// --- grade` (2940) with matching `// --- end …` lines. Tests prove marker-lift works (`test_metrics.cjs:8-11`, `test_focus.cjs:8-12`, `test_grade.cjs:13-15`, `test_backfill.cjs:9-15`).

| Rule-2 / §3 stat | Status | Evidence (symbol + line in `public/index.html` unless noted) |
|---|---|---|
| Question history (attempt log) | **Existing data** (`attempts` append-only, `schema.sql:45-56`); GET `/api/attempts` (`src/index.js:318-324`). Per-question paginated history UI **absent** — `drawHistory()` (3780) lists *exam sessions* (`SESS`), not attempts | derivable + new UI |
| Mistake log | **Existing**: markers Red/Orange in `progress` (`recordProgress` 2943-2953), `everWrong` (1704), `wrongSet`/`drawMistakes` (2291-2360) with sec/diff/skill/status/bank filters | exists |
| Weak spots | **Existing**: `weakness(list)` Laplace-smoothed per-skill miss rate (1732-1748), DOM-free | exists |
| Accuracy by domain/skill/section | **Existing**: `tally(list)` (1822-1836), DOM-free; `bars()` renders (2147-2153) | exists |
| Accuracy by difficulty | **Existing but inline** in `drawDash` LOG loop (2177-2194) — not a standalone pure function; trivially extractable | exists (inline) |
| Accuracy by level | **Existing**: `levelOf` (1841), drawDash (2236-2249) | exists |
| Pacing (rushed/on-pace/slow, per-section mean vs target) | **Existing**: `TARGET_MS`/`targetOf` (1844-1845), `pacing()` (1862-1873), DOM-free; drawDash (2212-2223). Per-*difficulty* pacing **absent** (§3.2 asks "by section and difficulty" — difficulty split not computed; derivable by same loop keyed on `q.difficulty`) | exists (section); difficulty split derivable, not coded |
| Traps fallen for | **Existing**: `trapCounts()` (1849-1859) joins `LOG.picked` → `choices[].trap` from bank JSON; DOM-free. **Example questions per trap absent** — derivable: each miss row already carries `question_id` | exists; examples derivable |
| Second-guessing (rate) | **Existing**: `guessing()` (1877-1884) from `attempts.changes`; client increments on selection switch (`S.changes`, 2887) | exists |
| Second-guessing **right→wrong vs wrong→right** (§3.2) | **ABSENT capture, not derivable.** `attempts` stores only final `correct`, `picked`, `changes` count (`schema.sql:45-55`) — no per-change answer sequence. `changes>0 & correct=1` could be wrong→right *or* right→wrong→right. No `answer_history` anywhere in current schema. **Decision gate** (§12.3) | absent |
| Overall accuracy / questions done / avg time | **Existing**: `tally` + `drawHomeStats` (1894-1900); drawDash overview (2163-2167) | exists |
| Day streak / activity chart / heatmap | **Existing**: `buckets` (2027), `chartHTML` (2070), `heatHTML` (2099), `streak` (2134) — depend on `LOG`+`dkey`/`mkey`, DOM-free except HTML string builders | exists |
| Last active (§3.1) | **Derivable**: `max(attempts.ts)` per user (GET already returns `ts`) | derivable |
| Avg time per skill + sparkline trend (§3.2 "By skill") | Per-skill avg time: **derivable** (`attempts.time_taken_ms` ⋈ `questions.skill`) — `tally` accumulates only section/domain/skill `a/c`, no per-skill time (`x` has no time field, 1832-1833). Sparkline: **data derivable** from ordered `LOG`; **no sparkline code exists** (grep `spark` → 0 hits) | derivable + new UI |
| Student list / weakest / second-guess rate / avg pace per student (§3.1) | All per-user reruns of the above over one student's rows — derivable server-side once pure functions are shared. **No admin routes or role exist today** (§5) | derivable |
| Lessons tab data (§3.2) | **Absent schema** — no `lesson_*` tables (§7) | absent (task02) |

**Server-side reuse feasibility (facts):** DOM-free candidates: `weakness`, `focusSet`, `nextLevel`, `tally`, `levelOf`, `targetOf`, `pacing`, `trapCounts`, `guessing`, `isRight`, `cbIdx`/`cbSort` (1923-1924), `buckets`/`streak` (need `dkey`/`mkey` helpers), difficulty/level LOG loops. DOM-bound (cannot run on Worker as-is): `drawDash`, `drawMistakes`, `bars`, `chartHTML`, `heatHTML`, all `draw*`. Worker imports ESM from `src/`; `index.html` is inline script — **no shared module exists yet**; rule 2 requires extraction into one module importable by Worker and available to the client (proposal §12.1).

**Proposal (not fact):** extract pure stat functions into one ESM file (e.g. `src/stats.js`) imported by the Worker; client either fetches computed JSON from `/api/admin/*` or loads the same module. Architect decides shape; Reviewer checks "no duplicated stat logic" (§12.4(d)).

---

## 2. Renderer and SPR equivalence reuse

- **Stem/choices/panes/answer area**: `renderStem` (2692), `choiceHTML` (2699), `loadQuestion` (2740), `renderPanes` (2768), `renderAnswerArea` (2813). Math via `mathify` (2622) + KaTeX; figures are `c.img`/`stem_html` crops. Lesson views must wrap these (brief rule 3); they live inside the page IIFE — same shared-module question as §1.
- **SPR derivation**: `q.spr = !q.choices.length` (1473), not a schema column (`schema.sql:9-24` has no type/qtype).
- **SPR equivalence checker**: `isRight(q, val)` (2908-2938): strips `space , $`; parses `a/b` fractions; alternative answers split on `OR`/`,`; exact `1e-9` numeric match, else round/trunc at ≥3 decimals (grid-precision proxy, comment 2929-2930); non-numeric falls back to cleaned string equality; MC compares letter only after validating stored answer is a real letter (2936); `val` empty or `'TIMEOUT'` → `false` (2909); no stored answer → `null` (unscorable, `grade` skips recording progress for `null`, 2977).
- **SPR input**: `<input class="gridin" id="gi">` (2821), blank display when `picked==='TIMEOUT'`.
- **Answer normalization on load** (1459-1492): `choices_json` → `q.choices` (invalid JSON → `[]` → becomes SPR — extraction-failure caveat in CLAUDE.md applies); `correct_answer` may be JSON array → joined string; MC `"A — …"` letter extraction (1477); SPR answer mined from explanation text when empty (1484-1491).
- **Reuse facts**: `isRight` is pure (only `q`/`val`) → extractable for Worker-side distribution grouping (§6.3 SPR normalization) and self-paced server grading (§8.4 "graded server-side"). No second checker exists — one must never be written (rule 2). `test_grade.cjs` stubs `isRight` rather than lifting it (40); no dedicated `isRight` unit test exists today (risk: SPR changes unguarded — Developer should add the shared-module test).

---

## 3. Question schema and answer formats

- Core: `schema.sql:9-24` — `id, external_id, section, domain, difficulty, skill, stem_html, choices_json, correct_answer, explanation_html, source, source_page, has_figure, stem_text` (legacy, stripped from wire `src/index.js:263-266`).
- AI: `schema_ai.sql:5-21` same columns + `level INTEGER DEFAULT 4`. Client: official level = Easy/Medium/Hard → 1/2/3 (`LVL`, index.html:1840-1841).
- `choices_json`: array of `{letter, content, img?, trap?}` — `trap` read by `trapCounts` (1856); AI records carry trap vocabulary (CLAUDE.md). Official rows may lack traps (counts sparse — fact, not bug).
- `correct_answer`: string; may be JSON array (joined), MC letter, or SPR numeric/expression string; `q.answer` is the normalized form.
- Taxonomy columns `section/domain/skill/difficulty` populated per bank; official CB order constants: `DOM_ORDER`/`SKILL_ORDER` (1907-1922), sort via `cbIdx`/`cbSort` (1923-1924).
- `usedInLesson`: **does not exist** anywhere in schema or client (grep 0 hits) — introduced by brief §2.

---

## 4. Every path that exposes/preloads answers & explanations today

**Fact inventory** (current behavior — practice-app by design; lessons must not reuse these blindly):

1. **`GET /api/questions`** (`src/index.js:262-276`): SELECT includes `correct_answer, explanation_html` for **every row of both banks**. Route requires `whoami` + membership `approved|pending` (209-228) — confirmed by test: unauthenticated → 401 (`test_auth_routing.cjs:70`), cookie → 200 (87-89). **Every signed-in (even `pending`) student receives all answers/explanations in one JSON.** No stripped student variant exists.
2. **Client memory**: whole bank kept in `QS` with normalized `q.answer` + `q.explanation_html` (1458-1493); exposed via `window.__qa()` (1593) — trivially readable in console/DevTools on personal devices.
3. **Browse preview** (`previewQuestion`, 2475-2493): shows SPR answer line (2486) and full explanation (2488) to any member — browse is not gated by "answered".
4. **Export for AI** (`exportPrompt`, 3831-3859): writes `CORRECT ANSWER` + `OFFICIAL EXPLANATION` into clipboard text regardless of check state (3848, 3853-3854).
5. **After Check / results / review**: `grade` → `renderAnswerArea` reveals (3115, 3128); exam results list `Correct:` per question (3746); retry mode promises "correct answer is never revealed" *in the UI* (1667) though data remains in `QS`.
6. **Practice session state** (`sessions` table `kind`, state JSON) stores answers/flags/timing — user-scoped, own answers only (`schema.sql:84-91`).
7. **`/exams.json`**: question IDs only — no answers (AUDIT; `tools/build_exams.cjs`).
8. **Notes**: user's own notes (`/api/notes`) — instructor lesson notes do not exist yet; brief rule 5 protects future `lesson_questions.notes`.
9. **Stem rationale leak**: `LEAKED_RATIONALE` regex strips rationale appended into `stem_html` (1123, 1466) — evidence some rationales ship inside stems; server does **not** strip them (only client).
10. **`/qimg/*`**: images only; gated by membership (restrictedAsset, `src/index.js:203-207`).

**Implication (proposal):** lesson student payloads cannot reuse `/api/questions` as-is; brief already mandates server-side stripping (rule 5). Leak-capture helper (§12.2) must also inspect this endpoint's normal practice payload when testing lessons — if lesson UI loads the shared bank, rule 5 is violated by construction. Architect must scope a stripped lesson-question path (e.g., DO snapshot fields or a dedicated endpoint) in PLAN.md.

---

## 5. Attempt recording: skips/timeouts, idempotency, source

### 5.1 Write path (facts)
- Client: `recordProgress` (2943-2953) updates `PROG` (attempts/corrects/marker Green-Orange-Red/last_reviewed/time_taken_ms); `recordAttempt` (2954-2959) pushes `{question_id, ts, correct, time_taken_ms, picked, changes}` → queue → `POST /api/attempts`. Only first Check moves progress (2982-2984); every scored Check appends an attempt (2986). Retry-mode corrections also log (test_grade 63-76).
- Exam module end records only answered questions: `if (ok !== null && m.ans[id])` (3680) — **blank exam answers are not recorded**.
- `finish()` counts only `S.checked` (3460-3464); unanswered practice questions produce **no attempt row**.
- Per-question timer overrun: clock runs red; auto-advance optional (2588-2593); **no timeout record written**.
- **`'TIMEOUT'` sentinel**: referenced only twice (read paths 2821, 2909). **No writer anywhere in the repo** (grep `TIMEOUT` → 2 matches). Historic/defensive only.
- **Skipped/timed-out convention: does not exist.** Brief §10 explicitly says: find it or raise a decision gate → **GATE** (§16).

### 5.2 Idempotency (facts)
- Schema: `UNIQUE (user_id, question_id, ts)` (`schema.sql:54`); Worker `INSERT OR IGNORE` + pre-existence check + post-persist acknowledgement (`src/index.js:331-351`); cap 100k/account (`MAX_ATTEMPTS`, 143; 429 when full, 336). Client queue treats attempts as append-only, splice-by-count (index.html ~1326; CLAUDE.md batch semantics).
- `ts` is client-supplied ISO string (max 32 chars, 247) — collision of identical `(question, ts)` silently drops a second event; acceptable today, matters if lesson flushes synthesize rows (same-second flushes must uniquify `ts` or use another key).

### 5.3 Source fields (facts)
- **None.** `attempts` columns: `id, user_id, question_id, ts, correct, time_taken_ms, picked, changes` (`schema.sql:45-55`). `progress` has no source. No `lesson_session_id`, no tag column. `GET /api/attempts` selects exactly those fields (`src/index.js:321`). Brief §10 requires tagging lesson writes (`lesson_session_id`) → needs schema addition (migration 0007, §7) or a side table — Architect decision; **no existing mechanism to reuse**.

### 5.4 Unanswered-at-session-end (brief §8.1/§10)
Platform never records unanswered practice items (5.1). Lesson self-paced "auto-submit at end" + "record unanswered the way the platform already does" has **no platform way** → same gate as 5.1.

---

## 6. Auth path (JWT → Worker), roles, WS feasibility

### 6.1 Facts
- Token intake: `Authorization: Bearer` or `__Host-sat_session` cookie (`tokenOf`, `src/index.js:86-88`). Cookie set only by `POST /api/auth/session` (229-232); `Max-Age` ≤ remaining token life (89).
- Verification: cheap `exp` prefilter (`expOf`/`looksLive`, 69-77) then **Supabase `GET /auth/v1/user`** with publishable key (95-97); identity cache `WHO` Map, cleared at 1000 entries (84, 108); cache survives logout until token expiry.
- **Stricter gates** (102-107): `claims.sub === u.id`; identities must include `provider === 'google'` and no provider outside `['google','email']`; `claims.amr` must include `method === 'oauth'` and nothing outside `['oauth','totp','mfa/totp','mfa/phone','mfa/webauthn']`. Tests: non-Google/password/GitHub rejected (`test_auth_routing.cjs:128-133`); linked-email-Google accepted, linked-password-Google rejected (320-326).
- Membership: `membership.status ∈ {approved,pending,denied}` (`schema.sql:1-7`); auto-create on session POST; `@ccs.us` → approved else pending (`src/index.js:217-223`); denied → 403 / `/login?denied=1` (224-228). **`pending` passes** the `['approved','pending'].includes` check for all routes (224).
- CSRF: non-GET/HEAD requires `Origin === url.origin` and not `Sec-Fetch-Site: cross-site` (177-180). GET upgrades not covered by this check.
- No `role` column, no `ADMIN_EMAILS`, no `/api/admin/*`, no WS routes (unknown `/api/*` → 404, 199-202). SPA has no `/admin` (tabs: practice/dash/browse/mistakes/exams/history/settings, 1596).
- Client bootstrap: Supabase browser SDK Google OAuth only (`public/auth.js:43-45`) → `POST /api/auth/session` → redirect `/app` (22-31). App reads session via `sbHeaders()`/`authToken` (index.html sync block).

### 6.2 WS upgrade feasibility (facts + minimal inference)
- URL pattern `wss://…/api/lessons/:sessionId/ws` is currently **404** (unknown API). Worker must special-case `Upgrade: websocket` before the unknown-API 404 (pattern: Context7 hibernation example returns 426 without the header).
- `tokenOf` already accepts cookie or bearer → works on GET upgrade requests; run same `whoami` + membership + role check, attach `{userId, role}` then `stub.fetch(request)` (Context7 DO example).
- Origin check (177-180) skips GET — Architect should decide whether to add an explicit Origin check on the WS upgrade (browser Ws sends Origin; same-origin rule of thumb) — currently no fact mandates it; note as design point.
- `harden()` sets `X-Frame-Options`/CSP etc. on JSON responses; upgrade response must return `101` with `webSocket` (per DO pattern), not run through `harden` blindly — implementation detail for task03.
- Role source: brief says add `role` seeded from `ADMIN_EMAILS` (§1 Roles). Not present. Membership table is the nearest existing concept (status ≠ role). Adding `role` = migration 0007 territory (task01).

---

## 7. Desmos embed + CSP (current) vs brief §7.2

### 7.1 Facts
- Embed is a plain `<iframe>` to College Board testing URLs: `DESMOS_SRC = { graphing: 'https://www.desmos.com/testing/collegeboard/graphing', scientific: '…/scientific' }` (3390-3393); panel build at 3413-3451; tab switch rewrites `iframe.src` (3431).
- **No Desmos API script**, no `Desmos.GraphingCalculator`, no key anywhere (grep `desmos.com/api` → 0; `apiKey` → 0).
- CSP (must stay in parity): `src/index.js:9-23` and `public/_headers:2` — `frame-src https://www.desmos.com`; `script-src` currently `'self' 'unsafe-inline' https://cdn.jsdelivr.net`. Desmos API script host (`https://www.desmos.com/api/.../calculator.js`) would need adding to `script-src` in **both** files (CLAUDE.md coupled-config rule). `connect-src` unchanged (Desmos API is same-page script + no cross-origin XHR required for state sync via our WS).
- `wrangler.toml` `[assets] run_worker_first = true` (19) — CLAUDE.md's `run_worker_first = ["/"]` note describes an array form; current file uses boolean `true` (routes all asset requests through Worker first). Record as-is; do not "fix" without a gate.

### 7.2 External docs (Context7 limitation)
- **Context7 has no Desmos library** (resolve for "Desmos API"/"Desmos" returned unrelated libs — OpenAI/Gradio/etc.). Fallback: official docs fetched directly: **Desmos API v1.11**, `https://www.desmos.com/api/v1.11/docs/index.html` (fetched 2026-09-23).
  - Load: `<script src="https://www.desmos.com/api/v1.11/calculator.js?apiKey=…">`; key via `desmos.com/my-api`.
  - `Desmos.GraphingCalculator(element, options)`; options include `lockViewport` (disables pan/zoom), `expressions`/`keypad` toggles for read-only-ish student views; `authorFeatures` + readonly expressions exist for classroom locking.
  - `getState()` / `setState(obj)` (state is opaque JSON); `observeEvent('change', …)` fires on any persisted-state change (user- or API-initiated, `event.isUserInitiated`); `unobserveEvent`; graphpaper bounds observation is in the full docs (page truncated in fetch — re-verify `graphpaperBounds` API in task06 from the same v1.11 page).
  - Limitation: v1.11 docs are versioned URL — record pin in task06 spec; no Context7 snippet provenance for Desmos.

---

## 8. Bank filters / taxonomy (for §9.2 + builder §4)

- **Two filter states**: practice `F` (sec/bank/diff/count/rand + `skills`, persisted `LS.set('filters')`, 1926-1958) and browse `FB` (sec/diff/skills + text, `drawBrowse` 2436-2473). Mistakes filters `MK` (2277). Convention: `null` = all, `[]` = none (dd helper, 1509-1514; CLAUDE.md).
- Controls built by shared `dd()` dropdown helper (grouped options, 1509+); skills limited to chosen domains in browse via `groups` map (2443-2449).
- Official ordering: `DOM_ORDER`/`SKILL_ORDER`/`cbSort` (1907-1924) — reuse for builder filters (rule: exact CB taxonomy as stored).
- §9.2 "Lesson questions" three-option control: **no analogous control exists** (no `usedInLesson`); pattern to copy = one `dd()` + filter predicate inside `browseBase()`/`wrongSet` chain. Student "attended sessions" join = new query (`session_participants`) — task09.
- `usedInLesson` badges: Browse table rows currently 6 columns (2457-2465) — badge column is a UI addition.

---

## 9. Next unused migration numbers

| Directory | Existing files | Next free | Notes |
|---|---|---|---|
| `migrations/` (core `DB`, default dir — `wrangler.toml` sets no `migrations_dir` for DB) | `0001_attempts` … `0006_membership` (glob, contiguous; historical duplicate-0005/0009 data repairs now live under `data-fixes/`, not applied as migrations) | **0007** | `schema.sql` already includes membership + AI columns — do not re-apply history over snapshot (AUDIT/CLAUDE) |
| `migrations_ai/` (`AI_DB`, `migrations_dir = "migrations_ai"`, `wrangler.toml:40`) | `0001_init` | **0002** | only if AI bank changes (lessons should not need it) |

Lesson tables (brief §2) → core **0007** (or 0007+ if split). `data-fixes/` numbering is independent — do not continue it for schema work.

---

## 10. Local Worker + D1 + DO prerequisites (facts)

Present:
- `wrangler` + `workerd` binaries in `node_modules/.bin` (Wrangler 4.x; AUDIT measured 4.125.0 ready on :8787 — historical, re-verify at task00b).
- `.wrangler/state/v3/d1/miniflare-D1DatabaseObject/` — **8 local D1 sqlite files** (both `DB` and `AI_DB` bindings); `v3/cache`, `v3/observability` also present. **No `v3/do/` storage** (no DO ever declared).
- Local data aids: `data/questions.snapshot.json` (8.8 MB, ignored, 4,170 rows per commit `fe5f7edd`), `backup/`, `d1_chunks/`, `d1_ai/` (emitters), `tools/apply_ai.cjs` for AI rows.
- `.env.example` documents `DB_DATABASE_ID`/`AI_DB_DATABASE_ID` overrides; **no `.dev.vars` file exists** (must be created for task00b flags — untracked).
- `npm test` works with zero native deps for the suite (node:sqlite used by `test_auth_routing`).

Missing (must be added by later tasks, not now):
- `[[durable_objects.bindings]]` + DO migrations tag in `wrangler.toml` — **absent** (full file read). Local DO runs automatically under `wrangler dev` once declared; alarms + hibernation supported on local workerd (Context7).
- `LessonRoom` class — absent (`src/index.js` has no exports besides default fetch).
- Seed script for e2e accounts/lessons — absent.
- `E2E_TEST_MODE` / test route — absent (grep 0 hits).
- **Caution (CLAUDE.md):** stop `wrangler dev` before direct SQLite edits; changing `database_id` re-keys Miniflare storage.

Config-coupling reminder for any host change: 5 locations per CLAUDE.md; lessons add WS route + Desmos `script-src` ×2 → treat as growing checklist in PLAN.md.

---

## 11. Playwright config/tests + CLI skill location

Facts:
- **No** `playwright.config.*`, **no** `tests/e2e/`, **no** `@playwright/test` in `package.json` (deps: `better-sqlite3`, `wrangler` only). Existing tests: 11 `tests/test_*.cjs`, `node --test`.
- Repo-local artifacts: `.playwright/` (playwright-cli session dumps: `page-*.yml`, one PNG, console logs — dated 2026-09-21/22), `.playwright-cli/` (console/page dumps), **`.claude/skills/playwright-cli/SKILL.md`** (repo copy).
- User-level skills: `C:\Users\Leon\.claude\skills\` contains `playwright-cli/` (also `agents-sdk, cloudflare, durable-objects, wrangler, …`); WSL path `/mnt/c/Users/Leon/.claude/skills/playwright-cli/`. System-available-skill entry: `C:\Users\Leon\.config\opencode\skills\…` per harness — harness lists `playwright-cli` at `C:\Users\Leon\.claude\skills\playwright-cli\SKILL.md`.
- Brief's own pipeline copy: `.omp/skills/SKILL.md` (484 lines, `name: playwright-cli`) — duplicate of the claude skill; per higher-priority instruction, pipeline artifacts go to `.opencode/pipeline/…`, but **skill location remains** the claude/config paths above.
- Binary: `playwright-cli` on PATH (`/mnt/c/Users/Leon/AppData/Roaming/npm/playwright-cli`). `npx playwright --version` failed under rtk parse — Playwright package version not installed in this repo; task00b/Test Developer must add `@playwright/test` (devDependency) + config — that is a later task's diff, not done here.
- Context7 Playwright docs: library `/microsoft/playwright` (versions seen: v1.51.0, v1.58.2, v1.61.0, v1.63.0) — multi-context pattern (`browser.newContext()` per user, storageState per role), `BrowserContext.setOffline` (affects fetch/XHR/WebSocket, not WebRTC), CDP throttling via `page.context().newCDPSession(page)` + `Network.emulateNetworkConditions` (Chromium-only; referenced by brief §12.2 — confirm exact command in task00b against pinned version).

---

## 12. Test sign-in options — comparison and recommendation

### 12.1 Constraints (facts)
- Google OAuth only in UI (`auth.js:43`); cannot automate.
- Worker `whoami` **hard-rejects non-Google providers and non-oauth amr** (`src/index.js:104-107`; tests 128-133) — Supabase email/password or anonymous test users **fail today** without code change.
- Local `wrangler dev` uses `[vars]` Supabase URL/key from `wrangler.toml:25-26` (**production project**) — any token-minting against Supabase from e2e touches prod auth service unless `.dev.vars` overrides `SUPABASE_URL`/`SUPABASE_ANON_KEY`.
- Protected reads distinguish 401 vs empty (CLAUDE.md); test identities must still produce real `users`/`membership` rows for app logic (`touchUser`, membership gates).
- Role/admin does not exist yet (task01).

### 12.2 Options

| | A. Dev-only sign-in route + seeded accounts (brief proposal) | B. Separate local-only entry/config (e.g. second wrangler entrypoint or build flag without shipping route) | C. Supabase test users (email/password or test Google) |
|---|---|---|---|
| Mechanism | `POST /api/e2e/login {user}` mints session **only when `E2E_TEST_MODE=1`** from `.dev.vars`; Worker 404s otherwise; seeds `e2e-admin`, `e2e-student-1..4` with synthetic user ids + membership rows | Keep prod Worker untouched; run a parallel dev Worker/wrangler config that includes the route, never deployed | Create `e2e-*` users in Supabase (email provider) and use `signInWithPassword` |
| Hits prod Supabase? | No (route bypasses `whoami` or uses internal identity) | No if vars overridden | **Yes unless** a separate Supabase project + var override (cost/complexity) or local GoTrue |
| Works with current `whoami` Google-only check? | Yes — route must set identity *without* passing through Google/amr checks (e.g., short-circuit before `whoami` for this path only, still Origin-checked) | Same, scoped to dev entry | **No** — `whoami` rejects `provider:'email'`/`method:'password'` (104-107); requires weakening auth code or dual-path — security-sensitive change to production auth |
| Risk of shipping to prod | Route code exists in deployed bundle; must hard-fail without flag; flag must never be set in prod (wrangler production vars). Test proves 404 without flag (brief 00b checkpoint) | Lowest: test code not in prod artifact; highest setup cost (second config, asset binding, maintenance) | Test users in prod project = real accounts in prod DB unless separate project; password auth opens a second sign-in path users could discover (login page is Google-only UI, but API/provider enabled) |
| Membership/roles fidelity | Full control of seeded membership + future `role` | Same | Must seed membership rows via SQL/admin API anyway |
| e2e reliability | Deterministic, fast, offline-friendly | Deterministic | Depends on network to Supabase; rate limits shared with prod (whoami cache mitigates partially) |
| Brief fit | Exactly §12.2 proposal | Alternative named as "separate local-only entry/config" | Named alternative "Supabase test users" |

### 12.3 Recommendation (proposal → Architect picks; user approves at STOP)
**Option A** (dev-only route + seeds), with these hard properties:
1. Route unreachable unless `env.E2E_TEST_MODE === '1'`; unset ⇒ 404 (not 401) and zero side effects; unit test in task00b mirrors brief checkpoint.
2. Flag only via untracked `.dev.vars`; production deploy must not define it — add a `predeploy`-style guard or config assertion in task00b (Reviewer checks "nothing test-only ships", §12.5).
3. Route short-circuits *before* Google/amr checks but **after** same-origin check; issues identity by writing/matching seeded `users` + `membership` rows; session cookie path reuses `sessionCookie()` so all existing routes work unchanged.
4. No weakening of `whoami` itself — production sign-in path untouched (smallest blast radius vs C).
5. Option B acceptable fallback if user forbids any test route in the deployed file; cost: dual entry maintenance. Option C rejected: requires changing hardened auth or prod-project test users.

---

## 13. External documentation sources, versions, limitations

| Topic | Source | Version/date | Limitation |
|---|---|---|---|
| DO WebSocket Hibernation | Context7 `/websites/developers_cloudflare_durable-objects` (developers.cloudflare.com/durable-objects/api/state + examples/websocket-hibernation-server + llms-full.txt) | fetched 2026-09-23; docs mention compat note `web_socket_auto_reply_to_close` for dates ≥ 2026-04-07 (repo compat_date = 2024-12-16 — auto-close reply not active; explicit `ws.close()` still fine) | Docs describe current API; local workerd behavior should be re-verified in task03 |
| DO Alarms | Context7 same library → developers.cloudflare.com/durable-objects/api/alarms | 2026-09-23 | One alarm per object; `setAlarm` overwrites; alarm wakes hibernating object |
| Playwright | Context7 `/microsoft/playwright` (docs: browser-contexts, auth, class-browsercontext setOffline) | versions listed: v1.51–v1.63 | Not installed in repo yet — pin at task00b; CDP throttling docs snippet not retrieved this pass (pattern known: `newCDPSession` + `Network.emulateNetworkConditions`) |
| Desmos API | **Context7: none found** (limitation). Direct fetch: `https://www.desmos.com/api/v1.11/docs/index.html` | v1.11 (versioned URL) | Full page truncated in fetch; `graphpaperBounds` observer + changelog size not re-read — task06 must re-read pinned page |

---

## 14. Brief conflicts / dependencies (each: brief text ↔ code fact)

1. **Immediate reveal vs +750ms grace.** §6.1: "REVEALED fires immediately at 0"; §1: answers accepted until `endsAt + 750ms`. A lock/select in flight at 0 can arrive after reveal broadcast — is it graded into distribution? Does reveal wait for +750? Undefined ordering → **clarify in PLAN or gate**.
2. **Public bank answer leaks.** Rule 5 vs fact §4.1/4.2: `/api/questions` ships every `correct_answer` + `explanation_html` to any signed-in (even pending) member; `window.__qa` exposes them. Lessons must not preload via this endpoint; leak helper will flag it if the lesson view fetches the full bank. Also browse preview/export reveal answers with no gating (facts 4.3/4.4) — out of lesson scope but relevant if tests share the SPA.
3. **Missing stats.** (a) Second-guessing direction right→wrong vs wrong→right: **not derivable** from `attempts` (no history) → §3.2 tab can only show what `guessing()` gives unless capture changes → **gate**. (b) Unanswered/skipped/timed-out convention: **does not exist** (`TIMEOUT` never written; blanks not recorded) → **explicit gate per §10**. (c) Sparklines, per-skill avg time, trap examples, per-difficulty pacing: derivable, not built — scope note, not a gate. (d) Lessons tab/`usedInLesson`: schema absent until task02 — task01 gate item.
4. **task02 starts session before task03.** 02 checkpoint: "Save & start session produces a join code"; join/WS/lobby live in 03. Dependency: 02 must create `lesson_sessions` row + `join_code` (schema) **without** DO; 03 adds join flow/DO. Acceptable if PLAN states 02's "start" = row insert only; else checkpoint untestable → clarify ordering in PLAN.
5. **task03 restores question state before task04.** Snapshot/phase/selection restore (03) precedes instructor-paced state machine/reveal (04). 03's snapshot must define generic phase storage that 04 drives; a "full lesson mid-question reconnect" e2e needs 04 — 03 checkpoint only claims "restores question, time, selection" for whatever phase 03 itself can enter (likely lobby/self fields). PLAN must scope 03 checkpoints to avoid requiring 04 logic.
6. **task01 Lessons tab before schema.** §3.2 Lessons tab needs `lesson_sessions`/`session_participants` (brief §2) which land in 02. 01 before 02 ⇒ tab must render empty-state/stub or 01/02 order flips. Also 01 needs `role` (schema) — same migration timing question. → PLAN decision.
7. **Time-delta budget vs frequent selections.** §8.5: reject `deltaMs` larger than time since "previous event". If "event" = *any* message (select/navigate ping), a burst of selects resets the reference and a later legitimate `time` delta (covering since last time flush) is rejected → undercount. If "previous *time* event", selections irrelevant. Undefined → clarify (unit test in 07 will encode whichever reading wins).
8. **Set-end / review / session-end / join-code semantics.** §5: code "works from creation through the whole session … dies when session ends". Status enum: `lobby|live|review|ended`. §8.6-8.7 review polls run after shared clock ends — is that `status='review'` (code still valid — students already connected; late join during review?) or `ended`? §9.1 My Lessons available "as soon as the session ends" — clock end or instructor `End session`? §5 lobby says count of joined students; "code dies when session ends" must mean `ended`, not clock-end, or review-after-end breaks. Clarify mapping status ↔ code validity ↔ history availability.
9. **Slow 3G ≤0.5s (task06).** Chrome "Slow 3G" ≈ 400 kbit/s + ~400 ms RTT. One Desmos `getState()` JSON (KBs) + WS hop + `setState` eval can exceed 0.5 s round-trip on first paint under that throttle. Brief hedges "record the measured value" — treat ≤0.5 s as **at-risk target, not guaranteed gate**; decide pass criterion (e.g., median of N runs, or local-only strict + Slow3G informational).
10. **Single-letter answer leak false positives.** Leak helper (§12.2) searching student payloads for correct answer "B" or SPR "2"/"5" will match choice letters, sizes, timestamps everywhere → flood of false positives. Need scoped matching (e.g., `"correct_answer"`/`explanation_html` key absence; MC: compare per-choice reveal payloads; SPR: word-boundary + context like `"correct"`), plus baseline against pre-reveal frames. Architect must spec matcher precision or checkpoints become noise.
11. **Minor doc drift (record only):** AUDIT.md describes older 387-line Worker/public-index shapes and `run_worker_first` array form; actual: `src/index.js` 450 lines, `wrangler.toml:19 run_worker_first = true`, membership gate present. CLAUDE.md still authoritative for rules; line numbers from AUDIT are historical.
12. **Guest vs member bank access:** `/app` and `/api/questions` require auth (401/redirect) — lesson join must assume authenticated students (brief implies sign-in). No guest lesson path — consistent.

---

## 15. Separation: facts vs proposals

**Facts** — all claims in §1–§11, §14 with file:line evidence; test run results (§0.3); git state (§0.2); Context7/Desmos doc citations (§13).

**Proposals** (for Architect, not decisions):
- §1 shared stat module extraction shape.
- §6 WS route handling pattern + explicit Origin check on upgrade.
- §12.3 recommend Option A with five hard properties.
- §10 next migration = 0007 core.
- §14 clarifications drafted as questions for the user, not silent choices.

---

## 16. Required user gates (from §12.3 + findings)

Per brief, gates = every STOP (tasks 00, 01, 02, 04–10), any research finding contradicting the brief, the §10 unanswered-convention question if none exists (**confirmed absent → gate**), and any e2e checkpoint that can't pass.

Research-raised gates/clarifications for the user at task00 STOP (Architect folds into PLAN.md approval):
1. **G1 — Skipped/timed-out convention** (§5.1): none exists. Choose: (i) don't record unanswered self-paced (contradicts §8.6 completion semantics?), (ii) record `correct=0, picked=null` rows, (iii) record `picked='TIMEOUT'` sentinel (readers already treat it wrong).
2. **G2 — Second-guess direction** (§1): absent capture; accept reduced tab (changes-rate only) or add history capture going forward (cannot backfill).
3. **G3 — Reveal vs +750ms ordering** (§14.1).
4. **G4 — Task order/scope seams**: 01 Lessons tab vs 02 schema; 02 start-session vs 03 join; 03 snapshot vs 04 phases (§14.4-6).
5. **G5 — Time-delta reference event definition** (§14.7).
6. **G6 — Join-code lifetime vs review/status mapping** + when My Lessons unlocks (§14.8).
7. **G7 — Slow3G ≤0.5s pass criterion** (§14.9).
8. **G8 — Leak-matcher precision spec** (§14.10).
9. **G9 — Test sign-in option choice** (§12; Architect recommends A, user approves).
10. **G10 — Attempt source tagging** (§5.3): no column exists — approve `attempts` schema extension (nullable `source`/`lesson_session_id`) vs side table; affects migration 0007 shape.

[DEFAULT] items in the brief are not gates.

---

## 17. Research summary (for Architect)

- **Relevant code:** pure stats cluster in `public/index.html` 1729-2250 (+markers); grading `isRight`/`record*` 2908-3020; renderer 2692-2906; auth/membership `src/index.js` 61-132, 177-237; bank wire `src/index.js` 262-276; attempts API 318-352; schema `schema.sql`; migrations → next **0007**; Desmos iframe 3389-3452; filters 1902-1958/2436-2473; CSP `src/index.js:9-23` + `public/_headers:2`.
- **Existing tests:** 11 marker-lift/node:test files, 43/43 green; no Playwright/e2e anywhere; skills at `.claude/skills/playwright-cli` (repo) and `C:\Users\Leon\.claude\skills\playwright-cli\` (user); binary `playwright-cli` on PATH; `.playwright/` holds old CLI dumps only.
- **Project conventions:** single-file SPA + ESM Worker; marker-lift for shared logic; append-only attempts with UNIQUE dedupe; 401-vs-empty protected reads; dual CSP parity; Windows git.exe; no lint/typecheck scripts.
- **Dependencies/interfaces:** D1 `DB`+`AI_DB` local state present; no DO binding yet; Supabase Google-only whoami; membership approved/pending/denied; D1 row-write cap shapes flush strategy (brief rule 6).
- **Risks/unknowns:** §14 conflicts 1-10; `graphpaperBounds` detail unverified (Desmos docs truncated); local wrangler/DO behavior untested this task; Playwright version unpinned; official-bank trap coverage unknown without populated DB count (snapshot claims 4,170 core rows).
- **Could not find:** skip/timeout writer; attempt source field; role/ADMIN routes; lesson tables; usedInLesson; sparkline; second-guess direction data; Desmos API script/key; e2e config; `.dev.vars`; Context7 Desmos library.

Pipeline artifact: `.opencode/pipeline/lessons-00-audit/research.md` (this file). No other files written; git tree otherwise untouched.

---

# ADDENDUM (post-review, still research-only)

Corrections to earlier sections, then six focused items. No code/test/config changes; no new runtime evidence (only static reads + already-cited docs + the earlier `npm test` run).

## A0. Corrections to prior sections

1. **§12.3 Option A claim was wrong in two ways.** Prior text said a login route could "short-circuit before Google/amr checks" with "existing routes work unchanged" and "without touching `whoami`". False: (a) **every** protected request re-enters `whoami(req, env)` (`src/index.js:212`) — `/api/questions`, progress, attempts, notes, settings, sessions, `/app`, `/exams.json`, `/qimg/*` all funnel through the same call; a synthetic bearer/cookie fails `fetch(SUPABASE_URL/auth/v1/user)` → 401 → route 401 (`95-98`, `213-215`) unless identity resolution itself changes or the `WHO` cache is primed by a `whoami` that already trusts the synthetic token. (b) The SPA **never sends the Worker cookie**; it sends Supabase Bearer only: `sbHeaders()` requires `sb.auth.getSession()` with matching `uid` (`public/index.html:3895-3905`); `loadProgress`/`push`/`flush` all gate on `authToken` (`1186`, `1317`, `1340`); bank fetch uses `sbHeaders()` (`1455`); `bootstrapSession` posts Bearer to `/api/auth/session` (`3950-3951`); `initAuth` aborts to login without a Supabase session (`3967-3983`). Cookie set by the Worker (`src/index.js:231`) is a Worker-side convenience, not the client's auth. Revised recommendation: §A1 below.
2. **§5.2 "spliced by count" was wrong.** Current queue removes **exact acknowledged snapshots**, not counts — see §A3.
3. **§1 "DOM-free/pure" overstated.** Page-scope functions close over mutable globals; they are *parameterizable*, not pure. Exact closure inventory: §A2. (Tests already inject `QS/PROG/LOG` as `new Function` parameters — `tests/test_metrics.cjs:10-11`, `test_focus.cjs:10-12` — which proves parameterizability, not purity in place.)
4. No other numeric/line claims retracted; §0.3 test result stands (43/43).

## A1. Test sign-in: honest auth seam (Option A vs local entry)

**Trace (facts, all cited):**
- Login half: `public/auth.js` Google-only OAuth (`43-45`) → `POST /api/auth/session` with Bearer (`22-24`) → Worker `whoami` + membership → `Set-Cookie __Host-sat_session` (`src/index.js:229-232`).
- Every later API call: `sbHeaders()` → Supabase `getSession()` → `Authorization: Bearer <sb access_token>` (`index.html:3895-3905`); Worker `tokenOf` prefers Authorization, falls back to cookie (`src/index.js:86-88`); `whoami` validates via Supabase each token (cache `WHO` only after a successful Supabase round-trip, `93-109`).
- Client bootstrap chain: `initAuth` → `bootstrapSession` → `applySession` sets `uid`/`authToken` (`3967-3983`, `3945-3965`, `4010-4014`); no session ⇒ `leaveAccount()` → `/login` (`3919-3921`, `3948`).

**Consequences (facts):**
1. A dev-only **login route alone cannot authenticate subsequent traffic.** Synthetic token must resolve inside `whoami` (or a wrapper around it) on **every** request — that is an **identity-resolution change**, not just a new route. Claiming otherwise (prior §12.3) is retracted.
2. Even with Worker-side resolution fixed, the **SPA needs a Supabase-shaped session** or `authToken` stays null: no loads, no queues, no bank fetch, redirect to login. Options: (i) Playwright injects a stub `window.supabase`/session via `page.addInitScript` (**test-harness code, not app code** — allowed in Test Developer diff); (ii) app ships an e2e branch (test-only code in bundle — conflicts with "nothing test-only ships"); (iii) local entry also serves a patched client (test-only asset).
3. **Shipped-flag route (brief's Option A)** puts flag-gated identity bypass **inside the deployed Worker file** — unreachable in prod without `E2E_TEST_MODE`, but Reviewer rule 00b says "nothing test-only ships to production"; dead test code still ships. Only valid if the user waives "ships" to mean "reachable".
4. **Separate local entry (Option B, revised recommendation):** second Wrangler config (e.g. `wrangler.e2e.toml`, `main = src/index.e2e.js`) used only by `wrangler dev`; production deploy keeps `wrangler.toml` → `src/index.js` untouched. Local entry wraps/re-exports `handleRequest` with an identity seam: resolve tokens matching `e2e.` prefix + flag to seeded `users`/`membership` rows; otherwise delegate to real `whoami`. Client side: Playwright init-script stubs Supabase session (harness-only). Satisfies both constraints: no whoami weakening in shipped file, **zero test-only code in the production bundle**. Cost: one extra entry module + config (task00b diff scope: allowed as Worker code? — brief scopes 00b to "test sign-in route + seed script"; entry file counts as that route's host; Architect to state it in spec).
5. Seeded identity still must create `users` + `membership` rows (`touchUser` only runs on progress POST, `src/index.js:22-23`, `123-131`; membership bootstrap only on session POST, `218-223`) — local entry must insert both or first writes behave as foreign accounts.

**Recommendation (revises §12.3):** **Option B (local-only entry + config) primary**; Option A only with explicit user waiver that flag-gated test code may exist in the shipped Worker. Option C (Supabase test users) stays rejected: `whoami` rejects non-Google/non-oauth (`src/index.js:104-107`; `tests/test_auth_routing.cjs:128-133`). Client half (Playwright session stub or cookie+Bearer emulation) required under either A or B.

## A2. Stats dependency classification (explicit inputs; no "already pure" claim)

Symbols: no `CFG` or `QMAP` exist — actual globals are `QS`, `QBY` (`index.html:1037`, rebuilt `1494`), `PROG`, `LOG`, `NOTES`, `SESS`, `SET` (`1045`), `MK` (`2277`), `F` (`1100`), `FB` (`2420`), `DBR` (`2024`), `S` (session, `2530`), plus constant blocks `LVL`/`TARGET_MS` (`1840-1845`), `DOM_ORDER`/`SKILL_ORDER` (`1907-1922`).

| Function | Explicit params | Free variables (page scope) | DOM? | Server inputs needed |
|---|---|---|---|---|
| `nextLevel(lvl,streak,ok)` (`1816`) | all | none | no | — |
| `isRight(q,val)` (`2908`) | all | none (builtins only) | no | — |
| `levelOf(q)` (`1841`) | q | `LVL` (literal) | no | q.level/q.difficulty |
| `targetOf(q)` (`1845`) | q | `TARGET_MS` (literal) | no | q.section |
| `cbIdx`/`cbSort` (`1923-1924`) | k/list | `DOM_ORDER`,`SKILL_ORDER` (literals) | no | — |
| `weakness(list)` (`1732`) | list | **`PROG`** (`1740`) | no | list=questions(skill,id), PROG rows |
| `focusSet(cfg)` (`1752`) | cfg | **`QS`** (`1754`), **`PROG`** (`1767`) + `weakness`,`levelOf` | no | QS subset, PROG |
| `tally(list)` (`1822`) | list (null→**`QS`**, `1823`) | **`QS`**, **`PROG`** (`1827`) | no | questions, PROG |
| `trapCounts()` (`1849`) | **none** | **`QS`** (`1850`), **`LOG`** (`1852`) | no | questions(+parsed choices_json.trap), attempts |
| `pacing()` (`1862`) | **none** | **`QS`**, **`LOG`** + `targetOf` | no | questions(section), attempts(time) |
| `guessing()` (`1877`) | **none** | **`LOG`** (`1878`) | no | attempts(changes,correct) |
| `buckets(range)` (`2027`) | range | **`LOG`**, `dkey`/`mkey`/`pad2` (`2021-2022`), wall clock | no* | attempts(ts,correct,time) |
| `streak()` (`2134`) | none | **`LOG`**, `dkey` | no* | attempts(ts) |
| `heatHTML()` (`2099`) / `chartHTML(bs,unit)` (`2070`) / `bars(map)` (`2147`) / `accHTML`/`pctOf` (`1887-1889`) | partial | `LOG`/`dkey`; `cbIdx`,`esc` | return HTML **strings** (no DOM writes) | same as above |
| `everWrong(id)` (`1704`) / `wrongSet.one(q)` (`2292`) | id/q | **`PROG`**, **`MK`** (mutable filters) | no | PROG + filter state |
| difficulty-accuracy loop (`2177-2186`), level-accuracy loop (`2236-2243`) | — | **`LOG`**, `qid` map of **`QS`**, `levelOf` | inline inside `drawDash` — **not a named function** | extract or reimplement-as-move |
| `drawDash`(`2155`), `drawMistakes`(`2306`), `drawHomeStats`(`1894`), `drawFilters`(`1926`), `drawBrowse`(`2436`), `previewQuestion`(`2475`) | — | all of the above + `$`/innerHTML | **DOM** | must not run on Worker; Worker returns data, admin page draws |

\* string builders touch no DOM but format with `toLocaleDateString` — locale-stable output needs `en-US` pinning if ever compared byte-exact (note only).

**Explicit input bundle for any server-side stat call (proposal shape, Architect decides names):** `questions` projection (`id, section, domain, difficulty, skill, source, level-or-difficulty, choices_json→parsed choices`), caller's `progress` rows, caller's `attempts` rows, optional filter state (`MK`-shaped object), optional `DBR` range. Trap stats additionally need parsed `choices[].trap` — present in AI bank (below), sparse/absent in official rows (no `trap` in `migrations/` or `data-fixes/` — grep 0 hits).

## A3. Attempt-queue acknowledgement claim — corrected

Standing rule (CLAUDE.md): "Remove only exact acknowledged snapshots, never a count or newer replacement."

**Current code complies** (`public/index.html:1358-1372`): validates `acknowledged` array + `saved` bounds (`1358-1359`); canonicalizes each row (sorted-key `encode`, `1360-1361`); matches acknowledged → remaining by canonical-string equality, throws `'Invalid save acknowledgment'` on any unmatched ack (`1363-1366`); removes only the exact matched object references from the live queue via `indexOf(row)`/`splice` (`1368-1371`); throws if any batch row unacknowledged (`1372`) → catch keeps queue for retry (`1374-1380`). Attempts enqueue appends every row (`1326`: `key = -1` for `/api/attempts`); progress/notes/sessions replace-by-id first (`1323-1327`). Account change clears queues (`resetPending`, `1298-1303`, checked in `push`/`flush` `1318`,`1338`).

Worker ack semantics unchanged from §5.2: attempts `acknowledged` = rows present after `INSERT OR IGNORE` (`src/index.js:347-351`) — includes idempotent repeats; progress ack = `meta.changes>0` rows (`311-312`); sessions ack = all submitted rows (`435`).

**AUDIT.md risk #5 ("splicing by count") describes pre-fix behavior; do not carry it forward.** Prior research §5.2 phrase "splice-by-count" retracted.

## A4. Answer-leak security scope (choices trap metadata, stem rationale, crops) + retraction limit

**Facts:**
1. **Trap metadata marks distractors by construction (AI bank).** Design: `choices_json` = `[{letter, content, trap}]` — **`trap` on wrong choices only** (`docs/history/superpowers/specs/2026-09-07-ai-question-bank-design.md:40`). Validators reject a trap tag on the correct choice: `tools/apply_ai.cjs:60`, `tools/audit_ai.cjs:199-200`, fixtures at `apply_ai.cjs:156`; dev-log records the same rule (`docs/history/dev-log.md:2204`, `2362`). Ship path: `/api/questions` returns raw `choices_json` (`src/index.js:265-266` col list includes it; client parses at `1460`) → **for every AI question, "has trap key" ⇒ "is wrong" is disclosed pre-reveal** to any member. `trapCounts` never reads correct choices (`1853-1856`) but the leak is in the payload, not the stat. Official-bank choices: no `trap` evidence in tracked SQL/data-fixes (grep 0) — leak is AI-bank-specific for this channel.
2. **Stem rationale:** client strips appended "Rationale…" from `stem_html` at load (`LEAKED_RATIONALE`, `index.html:1123`, applied `1466`) — **server does not strip**; Worker SELECT sends raw `stem_html` (`src/index.js:265-266`). Network + any early DOM parse still sees it. Also SPR answers mined from `explanation_html` text ("correct answer is…", `1484-1491`) confirm explanations contain answer strings in the delivered payload.
3. **Explanation content ships with the bank:** `explanation_html` in same response; AI explanations open with "Traps in this question" + per-choice "Why X is right/wrong" (e.g. `tools/aiq/rw_13.jsonl:1`) — full answer key + reasoning per question, delivered at app load.
4. **Crop assets:** `/qimg/*` URLs embedded in `stem_html`/`choices_json` (`tools/extract.py:44,660,963`; `apply_answerable.cjs:54`) and in **rationale** HTML — comment: "926 rationales carry their own figure crops as a bare `<img alt=\"Figure\">`" (`index.html:420`). Worker gates `/qimg/` on membership only — **no per-question or per-phase authorization** (`src/index.js:203-207`); any member holding a filename fetches it. Filenames are content-hash-like (`36f068e2_chA.webp`) — not practically guessable blind, but they **are disclosed** inside `stem_html`/`explanation_html` of the same bank payload. Stripping `explanation_html` from a future lesson payload does not retract crop URLs already seen or present in practice payloads.
5. **Alternate accounts / re-download:** membership permits multiple identities (any confirmed Google account; non-`@ccs.us` = pending, still passes `['approved','pending']` gate `src/index.js:224`); bank re-fetchable on every load (`1455`); no device binding; `window.__qa` exposes live `QS` (`1593`).

**Hard limit (state explicitly):** **Previously disclosed answers cannot be retracted.** Any member can obtain the complete answer key (field-level + trap tags + rationale text + SPR answers + crop paths) at any time via `/api/questions`, independent of lessons. Rule 5 can only: (i) prevent *new* lesson-channel surfaces (DO snapshots, `reveal` messages, instructor notes) from adding disclosures; (ii) not worsen practice-mode behavior; (iii) scope leak-capture baselines accordingly — a leak helper that flags the standing bank payload will fail forever unless scoped to lesson-channel messages / phase-gated fields relative to a pre-collected bank baseline. **Feasible strict protection applies only to not-yet-public surfaces (instructor notes, unrevealed grading, roster/answers-of-others). Answer secrecy for members is not achievable** and must not be promised in PLAN.md acceptance wording beyond §13's "before they are allowed to see them" applied to *lesson reveals*.

## A5. `isRight` is not an equivalence relation — do not group SPR responses with it

**Code** (`index.html:2908-2938`): SPR branch computes `dp` = decimal places of the **submitted value** (`2924`), then accepts if `|af−vf|<1e-9` **or** (`dp≥3` and) `round(af·10^dp)/10^dp === vf` **or** `trunc(af·10^dp)/10^dp === vf` (`2925-2933`), where `af` = parsed **stored** answer, `vf` = parsed **submitted** value; non-numeric falls back to cleaned string equality; accepted set = `q.answer.split(/ OR |,/)`. Empty/`TIMEOUT` → `false` (`2909`); missing answer → `null` (`2911`).

**Properties vs equivalence:**
- **Symmetric? No.** Rounding/truncation is applied to the *stored* side at the *decimal precision of the submitted* side. Counterexample: stored `'0.1666666'`, submitted `'.1667'` → `dp=4`, `round(0.1666666·10^4)/10^4 = 0.1667` → **true**. Swap (stored `'.1667'`, submitted `'0.1666666'`) → `dp=7`, `|0.1667−0.1666666…|>1e-9`, `round(0.1667·10^7)/10^7 = 0.1667000 ≠ 0.1666666`, `trunc` likewise → **false**. `isRight(A,B) ≠ isRight(B,A)`.
- **Transitive? No** — round-to-precision classes at variable `dp` are the classic non-transitive tolerance chain (e.g. `0.16666~.1667` at dp=4, `.1667~.16671` at dp=5 with stored `.1667`, but `0.1666666` vs `.16671` fails at dp=5: `round(0.1666666·1e5)/1e5=0.16667≠.16671`).
- **Reflexive?** Mostly (numeric self-compare hits `1e-9`), but not a relation *between responses*: it is a ternary predicate `ok = isRight(q, candidate)` against a fixed key with an OR-list membership test — pairwise clustering needs a symmetric key, which this is not.
- MC branch (`2936-2937`) is letter equality — fine as a key, but SPR (brief §6.3 "group responses by normalized value using the existing SPR checker") must not use pairwise `isRight` for grouping: clusters would depend on iteration order/first-seen representative.

**Proposal (one shared helper, checker retained):** add `normSpr(val)` alongside `isRight` in the shared module: `clean` (existing `2918`) → if parses as finite number (fraction-aware like `num`, `2919-2922`) return canonical number (e.g. rounded to grid precision / fixed decimal string); else return cleaned uppercase string. **Grouping/distribution** = `Map` keyed by `normSpr(response)`. **Grading stays `isRight(q,val)`** exactly as today (semantics preserved: OR-lists, `dp≥3` round/trunc, `null` unscorable). `isRight` may be *implemented* via `normSpr` on both sides only if task-level tests prove byte-identical accept sets — otherwise leave checker untouched and share only the normalizer (smaller risk). Known ceiling: a symmetric grouping key can disagree with the asymmetric grader on boundary pairs (`.1667` vs `0.1666666` land in one group but only one direction grades right) — document with `ponytail:` comment at implementation; upgrade path = store grid-canonical answers at import time. Worker + client import the same helper (rule 2); no second implementation.

## A6. "20 s offline" vs no-blind-sleeps; fixture timer insufficiency

**Facts (brief text only — no Playwright run this task):**
- Standing rule: Reviewer rejects "fixed sleeps where a condition wait works" (`BRIEF.md` §12.4(h)).
- Checkpoint 03: "student offline for 20s then back restores question, time, and selection" (§12.5); acceptance §13 repeats "Killing Wi-Fi … for 20s". Mechanism: `context.setOffline(true/false)` (§12.2); Playwright docs confirm offline affects fetch/XHR/WebSocket (Context7 `class-browsercontext.setOffline`).
- Seed policy: "Seeded lessons use **5–10 second** time limits … short real timers keep the suite fast" (§12.2); DO alarms are real-time (Context7 alarms docs; brief §1 says browser can't fast-forward).

**Classification (proposal for spec wording):**
1. The **20 s outage duration is the phenomenon under test**, not a blind sleep — distinct from banned `waitForTimeout` used as a proxy for an async condition. Allowed pattern: `setOffline(true)` → **await condition** ("Reconnecting…" banner / socket close indicator, brief §6.2) → hold offline for the designated 20 s (documented scenario constant, not an assertion delay) → `setOffline(false)` → **await restore conditions** (question id, remaining time, selection, snapshot received — never a bare sleep-then-assert).
2. **Default 5–10 s fixture timers are insufficient:** a 20 s outage exceeds the whole question/session budget — timer would hit 0, phase would advance/reveal mid-outage, restore assertions become meaningless. Need **one designated long-timer fixture** for reconnect scenarios (e.g. a lesson/question with `time_limit_sec ≥ 45–60`, still a seed constant), separate from the 5–10 s fast fixtures. Suite cost: +≥20 s wall time on that test is unavoidable (real DO alarms); Architect should budget it and forbid compensating with un-awaited sleeps elsewhere.
3. No claim that any of this has run — task00 has no e2e; wording above is for PLAN/spec + Test Developer.

## Addendum gate deltas
- G9 (sign-in) now: **recommend local entry (B)**; A requires user waiver that flag-gated test identity code ships in `src/index.js`. Client-side Supabase stub decided in 00b spec either way.
- New G11: leak-helper **baseline/scoping** decision (A4) — bank payload is permanently disclosive; checkpoints must target lesson channels relative to baseline, or they can never pass.
- G8 (single-letter matcher) unchanged, now reinforced by A4 (trap-key / "Why X is wrong" strings are higher-signal markers than bare letters).
- A5 implies task04/07 spec must ask for `normSpr` shared helper + forbid pairwise-`isRight` grouping (Reviewer check).
