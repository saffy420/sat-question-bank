# Research: lessons-00b-e2e-harness

Research only. No source/config/test edits, no installs, no services launched, no commits. Artifact path `.opencode/pipeline/lessons-00b-e2e-harness/` (workspace instruction; brief's `.omp/` not used). Serena `initial_instructions` tool not present in this session's active tool set — no Serena manual loaded, none fabricated.

Sources: `docs/lessons/BRIEF.md` (incl. Amendments 2026-09-23), `docs/lessons/PLAN.md` (APPROVED, §4 local-only auth), `.opencode/pipeline/lessons-00-audit/research.md` corrections A0–A6, full reads of `src/index.js`, `wrangler.toml`, `package.json`, `schema.sql`, `schema_ai.sql`, `.env.example`, `.gitignore`, `public/auth.js`, `public/login.html`, SPA auth block `public/index.html:3885–4040` + `load()` 1453–1494, `tests/test_auth_routing.cjs`, `tests/browser-probes.js`, `docs/BOOTSTRAP.md`, `tools/import_snapshot.cjs`, `tools/apply_ai.cjs`, `migrations/0006_membership.sql`. Context7: `/cloudflare/workers-sdk` (`.dev.vars` load path, `--persist-to`, global `--config`), `/microsoft/playwright` (multi-context, `setOffline`, CDP `Network.emulateNetworkConditions`, `webServer`, pin). Playwright CLI skill loaded (`C:\Users\Leon\.claude\skills\playwright-cli\SKILL.md`). npm registry queried for versions.

---

## 0. Baseline (this session, Windows `git.exe` via rtk)

- Branch `setup`, HEAD `a7f81117` (`fix: resolve known-issues backlog and open Google sign-in to all domains`). No staged changes.
- `git.exe status --porcelain`: only untracked — `.omp/`, `.opencode/`, `.serena/`, `docs/lessons/`, `docs/roadto1600-lessons-prompt.md`, `nul`. Zero modified tracked files. Preserve all; do not touch `docs/lessons/` (task00 docs finalizing concurrently).
- WSL `rtk git status` reports ~87 modified files — CRLF phantom only; `git.exe` is authoritative (CLAUDE.md).
- Node `v24.18.1` (wrangler engines ≥22 OK). Installed: `wrangler@4.125.0`, `better-sqlite3@^13`. **No** `@playwright/test`, no `playwright.config.*`, no `tests/e2e/`.
- Existing unit suite: `npm test` → `node --test "tests/test_*.cjs"`, 11 files, 43/43 green (task00 evidence). New unit tests must match `test_*.cjs`.
- Local D1 state present under `.wrangler/state/v3/d1/miniflare-D1DatabaseObject/` (4 sqlite files + metadata; both banks ever keyed here). No `.dev.vars` anywhere. No DO bindings/storage.
- Shell caveat: in this research shell `node node_modules/wrangler/bin/wrangler.js --version` and `npx wrangler` returned empty `Error:` (spawn/rtk interaction). Developer must re-verify the exact working invoker (`npm run dev`, `npx wrangler`, `node node_modules/wrangler/wrangler-dist/cli.js`) before scripting; do not assume CLI works untested.
- Stale artifact: `tests/browser-probes.js` references a removed "Continue as guest" button (SPA now hard-requires `initAuth`, `public/index.html:4033`). Excluded from `npm test`; do not treat as a working fixture.

---

## 1. Auth facts that constrain the harness (A0 corrections applied)

1. Every protected request funnels through one call: `u = await whoami(req, env)` at `src/index.js:212` inside `handleRequest` (`:165`). Routes: `/api/questions`, progress, attempts, notes, settings, sessions, `/app`, `/exams.json`, `/qimg/*`, `/api/auth/session`. A login route alone cannot authenticate later traffic.
2. `whoami` (`:90–111`) hard-verifies via Supabase `GET /auth/v1/user` and rejects non-Google providers / non-oauth amr (`:104–107`; tests `test_auth_routing.cjs:128–133`). No weakening allowed.
3. SPA never sends the Worker cookie as its auth; it sends Supabase Bearer from `sbHeaders()` → live `sb.auth.getSession()` (`index.html:3895–3905`). `initAuth` (`:3967`) requires `window.supabase.createClient(...).auth.getSession()` to return a session or boot aborts to `/login` (`:3978`, `:4033`). `bootstrapSession` POSTs Bearer to `/api/auth/session` (`:3950–3951`).
4. Worker cookie `__Host-sat_session` is set on `/api/auth/session` (`src/index.js:231`) with `Max-Age` derived from `expOf(token)` (`:89`) — a non-JWT token gets `Max-Age=0`. Cookie matters for asset GETs (`/qimg`, `/exams.json`) that carry no Authorization header. 00b seeds no figures → crop cookie gap is out of scope; design tokens JWT-shaped anyway (§3) so later tasks are not blocked.
5. Unknown `/api/*` already returns JSON 404 (`:202`) with no side effects — the natural "flag unset" behavior; no production code change needed for the 404.
6. Membership gate `['approved','pending']` (`:224`) after `whoami`; session POST auto-creates membership (`:218–223`). E2E seeded users must have `users` + `membership` rows (or rely on session POST auto-create with `@ccs.us`-style email → `approved`).
7. Origin/CSRF check for non-GET/HEAD (`:177–180`) runs inside `handleRequest`. A login route handled *before* `handleRequest` must repeat this check.

---

## 2. Approved design recap (PLAN §4 + Amendments "Local-only test auth")

Option B: separate local entry/config. Production default `whoami` fixed. Local wrapper supplies seeded identity. `E2E_TEST_MODE=1` exact match from ignored `.dev.vars`. Route 404s with no side effects when flag unset. Bounded sessions, fixed allowlist, no client-supplied identity/role. Browser-only Supabase session adapter (test harness, not app code). Isolated D1 for **both** banks. Production bundle excludes all test imports. No remote Supabase accounts, no production OAuth changes, no DO feature in 00b. Admin identity seeded; roles API = task01 (no role column exists — `schema.sql`/`0006_membership` have membership status only).

---

## 3. Smallest safe interfaces (exact)

### 3.1 Production seam — `src/index.js` (Developer, behavior-preserving)

Current: `handleRequest` module-private; default export `fetch` → `handleRequest(req, env)`; identity call hardcoded `whoami`.

Proposed minimal diff:

```js
// signature + export only; body unchanged except one call site
export async function handleRequest(req, env, resolveIdentity = whoami) {
  // ...
  u = await resolveIdentity(req, env);   // was: u = await whoami(req, env);
  // ...
}
export default {
  async fetch(req, env) {
    try { return await handleRequest(req, env); }  // production: fixed whoami, no args
    catch { return json({ error: 'service unavailable' }, 503); }
  }
};
```

Hard constraints:
- Production `fetch` never passes a resolver → always real `whoami`.
- `src/index.js` contains **zero** occurrences of `E2E_TEST_MODE`, `/api/e2e`, `e2e.` token prefix, or any import of the local entry. Seam is pure DI with default.
- No byte-identical claim (PLAN §4 allows this seam explicitly).
- Existing 43 tests keep passing unchanged (they import `.default` only — `test_auth_routing.cjs:52`).

### 3.2 Local entry — new file `src/index.e2e.js` (Developer)

Never referenced by `wrangler.toml` or `src/index.js` (one-way import: e2e → production).

```js
import { handleRequest } from './index.js';

const FLAG = 'e2e';           // token segment, not read by production
const ALLOW = new Set(['e2e-admin', 'e2e-student-1', 'e2e-student-2',
                       'e2e-student-3', 'e2e-student-4']);  // must match seed
// ponytail: in-memory sessions, Map cap 64 + 1h TTL; durable store if reload-mid-test hurts

export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    if (url.pathname === '/api/e2e/login' && req.method === 'POST') {
      if (env.E2E_TEST_MODE !== '1') return json404();          // exact flag, no side effects
      if (req.headers.get('Origin') !== url.origin ||
          req.headers.get('Sec-Fetch-Site') === 'cross-site') return json403();
      const { account } = await req.json().catch(() => null) || {};
      if (!ALLOW.has(account)) return json404();                // no enumeration oracle
      // mint JWT-shaped opaque: `e2e.` + b64url({sub:userId, exp}) + `.e2e`
      // so sessionCookie/expOf give a working Max-Age for later asset GETs
      return json({ token, user_id, account });                 // + optional Set-Cookie
    }
    return handleRequest(req, env, e2eIdentity);                // all other routes
  }
};

async function e2eIdentity(req, env) {
  const t = tokenOfLike(req);                 // same Bearer/cookie extraction rules
  if (!t.startsWith('e2e.')) return null;     // NEVER delegates to whoami/Supabase
  // verify session Map + exp; load/return Supabase-shaped user:
  // { id, email, email_confirmed_at, user_metadata: { full_name } }
}
```

Hard constraints:
- Non-`e2e.` tokens → `null` (401). E2E worker makes **zero** calls to production Supabase (PLAN: "must not fall back to production Supabase"). Omit `SUPABASE_URL`/`SUPABASE_ANON_KEY` from the e2e config entirely so accidental use fails closed.
- No client-supplied user/role: identity comes only from server-side session Map keyed by allowlisted account.
- No fake Google/amr validation path — separate resolver, production `whoami` untouched.
- Flag check is `env.E2E_TEST_MODE !== '1'` (string exact), before any body parse or DB write.
- Route lives only in this file. Production entry has no knowledge of it → "production rejects flag even if injected" is structural (§6 test P2).

Token shape: three segments `e2e.<b64url payload with exp>.e2e`. `expOf` (`src/index.js:69–76`) then yields real `Max-Age` on `/api/auth/session` cookie (`:89`, `:231`), so cookie-scoped asset GETs work without any production change. `whoami` would send such a token to Supabase and get 401 — production never inspects the `e2e.` prefix (satisfies PLAN "Production auth must never inspect e2e. tokens").

### 3.3 E2E Wrangler config — `wrangler.e2e.toml` (Developer)

```toml
name = "sat-question-bank-e2e"
main = "src/index.e2e.js"
compatibility_date = "2024-12-16"

[assets]
directory = "./public"
binding = "ASSETS"
run_worker_first = true
html_handling = "none"

# NO [vars] SUPABASE_* — fixture auth must not touch production Supabase.
# NO [[routes]] — cannot claim production domains.

[[d1_databases]]
binding = "DB"
database_name = "sat_question_bank"
database_id = "f01978d5-ae12-49f5-900a-6f457376205f"

[[d1_databases]]
binding = "AI_DB"
database_name = "sat_ai_bank"
database_id = "4c0fe455-4e45-4982-bbe2-46191af9c685"
migrations_dir = "migrations_ai"
```

Isolation mechanism: **`--persist-to .wrangler/state-e2e`** on every dev/d1 command (Context7: flag resolves relative to cwd; default otherwise is `.wrangler/state` beside the config — same dir as production dev, which would collide). Same `database_id` values are fine because the entire state tree differs; do **not** invent new IDs (re-key hazard, CLAUDE.md/BOOTSTRAP).

`.dev.vars` location (Context7 `getVarsForDev`): resolved as `dirname(configPath) + "/.dev.vars"`. Both configs sit at repo root → one root `.dev.vars`:

```
E2E_TEST_MODE=1
```

Consequences:
- Production `npm run dev` (wrangler.toml) also loads this flag locally — harmless: production entry has no route and never reads the flag. Production **deploy** never reads `.dev.vars` (not a deploy input).
- `.dev.vars` is **not currently gitignored** (`.gitignore` has `.env` only) → Developer must add `.dev.vars` to `.gitignore`.
- Create `.dev.vars` with a file tool (shell quoting corrupts content on this checkout).

### 3.4 package.json additions (Developer)

```json
"scripts": {
  "dev:e2e": "wrangler dev --config wrangler.e2e.toml --persist-to .wrangler/state-e2e",
  "e2e:seed": "node tools/e2e_seed.cjs",
  "test:e2e": "playwright test"
},
"devDependencies": {
  "@playwright/test": "1.63.0"
}
```

Exact pin `1.63.0` (npm `latest` as of 2026-09-23; PLAN §7 requires pin at 00b). After install: `npx playwright install chromium` (one-time browser download, needs network). Existing deps unchanged; wrangler stays `4.125.0` (optional follow-up: replace `"latest"` with exact pin — not required for 00b).

### 3.5 Playwright config — `playwright.config.js` (Developer owns; ESM matches package `"type": "module"`)

```js
import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: 'tests/e2e',
  baseURL: 'http://127.0.0.1:8787',
  use: { viewport: { width: 1366, height: 768 } },  // Chromebook default
  projects: [{ name: 'chromium', use: { browserName: 'chromium' } }],
  webServer: {
    command: 'npm run dev:e2e',
    url: 'http://127.0.0.1:8787',
    reuseExistingServer: true,
    timeout: 60000
  }
});
```

No `.ts` — avoids adding a TS toolchain. Config declares dependency + layout so Test Developer never edits app/config (PLAN §4 boundary).

---

## 4. Seed design (Developer owns `tools/e2e_seed.cjs` + SQL)

Accounts (allowlist in §3.2 must match exactly):

| account | users.id (propose) | email | membership |
|---|---|---|---|
| e2e-admin | `e2e-admin` | `e2e-admin@e2e.test` | approved |
| e2e-student-1..4 | `e2e-student-1` … | `e2e-student-N@e2e.test` | approved |

"Admin" is only a designated seeded identity for 00b (no `role` column, no `/api/admin/*` — task01). Seed does not invent a roles API.

Questions (no crops, `has_figure=0`, no `/qimg` refs):
- Core `DB.questions`: ≥1 R&W MC, ≥1 Math MC, ≥1 Math SPR (`choices_json='[]'`, non-empty `correct_answer` + `explanation_html` with a unique leak-marker string e.g. `E2E_EXPL_MARKER`).
- `AI_DB.questions`: ≥1 row (`source='AI'`, `level=4`, choices + explanation) **and** `DB.ai_ids` registry row (write guards require both — `schema.sql:80`, `src/index.js:254–256`).
- Checkpoint "bank loads both" asserts `/api/questions` contains `source !== 'AI'` **and** `source === 'AI'` rows (same discriminator `browser-probes.js:70` used).

Schema apply + seed order (server **stopped** — direct SQLite/wrangler flush hazard):

```bash
# 1. stop every wrangler dev
# 2. init both banks into the isolated tree
npx wrangler d1 execute DB    --local --config wrangler.e2e.toml --persist-to .wrangler/state-e2e --file=schema.sql
npx wrangler d1 execute AI_DB --local --config wrangler.e2e.toml --persist-to .wrangler/state-e2e --file=schema_ai.sql
# 3. seed (script shells the same wrangler d1 execute flags; no raw hashed-file guessing)
node tools/e2e_seed.cjs
# 4. start
npm run dev:e2e
# 5. tests
npx playwright test
```

`tools/e2e_seed.cjs`: generate SQL → invoke `npx wrangler d1 execute <BINDING> --local --config wrangler.e2e.toml --persist-to .wrangler/state-e2e --file=<tmp>` (binding-aware; never pick "first sqlite file" — two banks, CLAUDE.md). Idempotent upserts. `--persist-to` requires `--local` (Context7 d1 execute). Never `--remote`.

Do **not** run `wrangler d1 migrations apply` on schema-built DBs (BOOTSTRAP). No lesson tables/DO in 00b (PLAN §6).

---

## 5. Browser Supabase adapter + helpers (Test Developer owns `tests/e2e/**` only)

### 5.1 Sign-in flow (checkpoint: "sign in through the test route")

1. `const { token, user_id } = await request.post('/api/e2e/login', { data: { account: 'e2e-admin' }, headers: { Origin: baseURL } })` → 200.
2. `context.addInitScript` **before** first navigation, installing:
   - `window.supabase = { createClient: () => ({ auth: { getSession, onAuthStateChange, signOut, signInWithOAuth: () => error } }) }` where `getSession` returns `{ data: { session: { access_token: token, user: { id: user_id, email, user_metadata: { full_name } } }, error: null } }` consistently (SPA `sbHeaders` compares `session.user.id === uid`, `index.html:3900`).
   - `context.route('**/@supabase/supabase-js/**', r => r.abort())` so the CDN script cannot overwrite the stub.
   - `context.route('**/*.supabase.co/**', r => r.abort())` — block/assert zero production Supabase network.
3. `page.goto('/app')` → `initAuth` → `bootstrapSession` POST Bearer `e2e.…` → local resolver → membership → SPA boots; `load()` fetches `/api/questions` with Bearer (`:1455`).

This is harness-only (init scripts + routes live under `tests/e2e/`); app bundle unchanged. Document honestly: verifies app behavior under a synthetic session, **not** real Google OAuth end-to-end.

### 5.2 Helper interfaces (Test Developer)

| helper | file (propose) | contract |
|---|---|---|
| `signIn(pageOrContext, account)` | `tests/e2e/helpers/auth.js` | login POST + initScript + supabase routes; throws on non-200 |
| `newUserContext(browser, account, opts)` | `tests/e2e/helpers/contexts.js` | fresh `browser.newContext()` per user; multi-user = N contexts in one test (Context7 browser-contexts pattern) |
| `CHROMEBOOK = { width: 1366, height: 768 }` | same | student default; instructor annotation tests override 1920×1080 |
| `setOffline(ctx, bool)` | `tests/e2e/helpers/offline.js` | wraps `context.setOffline` — affects fetch/XHR/WebSocket, not WebRTC (Context7). Assert disconnect condition before holding outage; 20 s outage is scenario input, not a sleep-assert (A6) |
| `throttle(page, profile)` | `tests/e2e/helpers/throttle.js` | `context.newCDPSession(page)` → `Network.enable` + `Network.emulateNetworkConditions` `{offline:false, latency, downloadThroughput, uploadThroughput}` (Chromium-only). Slow 3G prop: latency≈400, download≈50*1024/8… record exact numbers in e2e.md. **Verify WS actually delayed** (PLAN §7) — CDP flag alone is not evidence |
| `captureLeaks(context, markers)` | `tests/e2e/helpers/leak.js` | `page.on('response')` body + `page.on('websocket')` `framereceived`; search unique seeded markers (`E2E_EXPL_MARKER`, notes markers) and answer-bearing keys — never bare `"B"`/`"2"` (A4/G8). For 00b: wire + smoke only; full lesson-channel leak assertions are tasks 04/07 under G1 |

Wait style: conditions (selector / response / WS message), no fixed sleeps (BRIEF §12.2). Screenshots/traces → `.opencode/pipeline/<task>/e2e/` (gitignored), not repo.

Playwright CLI skill: exploratory passes + screenshots via `playwright-cli`; committed regression = `@playwright/test` specs under `tests/e2e/<task>/`.

### 5.3 Exact 00b checkpoints → assertions

| # | checkpoint (BRIEF §12.5) | assertion |
|---|---|---|
| C1 | admin signs in through test route | `POST /api/e2e/login {account:'e2e-admin'}` 200; SPA boots on `/app` with `#user-name` showing seeded name; `/api/questions` 200 |
| C2 | student signs in through test route | same for `e2e-student-1`, separate context |
| C3 | question bank loads for both | response body (and SPA `QS`) contains ≥1 `source!=='AI'` **and** ≥1 `source==='AI'` row for each user |
| C4 | test route 404s with `E2E_TEST_MODE` unset | (a) unit: e2e entry `fetch` with `env={}` → 404, no session side effect; (b) optional HTTP: start `wrangler dev -c wrangler.e2e.toml` **without** `.dev.vars` flag on a spare port → `POST /api/e2e/login` 404 |
| C5 | production entry rejects flag even if injected | unit: import `src/index.js` default, `env.E2E_TEST_MODE='1'`, `POST /api/e2e/login` → 404 (unknown API, `src/index.js:202`) |

C4a/C5 are Developer unit tests (`tests/test_e2e_auth.cjs`, matches `npm test` glob). C1–C3 (+ optional C4b) are Test Developer Playwright specs `tests/e2e/lessons-00b/*.spec.js`.

---

## 6. Production bundle exclusion proof (Reviewer check 00b)

Static unit tests in `tests/test_e2e_auth.cjs` (no deploy, no network):

1. `src/index.js` source: no `E2E_TEST_MODE`, no `/api/e2e`, no `index.e2e`, no `import` of e2e module.
2. `wrangler.toml`: `main = "src/index.js"`, no `E2E_TEST_MODE` key anywhere in tracked config (`wrangler.toml`, `package.json` scripts other than `dev:e2e`/`test:e2e`/`e2e:seed`, `public/_headers`).
3. Production default export with injected flag → C5 404.
4. E2E entry without flag → C4a 404; with flag + allowlisted account → 200; unknown account → 404; cross-origin POST → 403; non-e2e Bearer on e2e entry → 401 (no Supabase call — mock `fetch` and assert 0 calls, pattern `test_auth_routing.cjs:46–48`).
5. Optional belt-and-suspenders: `npx wrangler deploy --dry-run --outdir dist-check` then grep `dist-check` for `E2E_TEST_MODE` — run only if Developer's shell can invoke wrangler; static checks 1–4 are sufficient evidence if CLI broken.

Nothing test-only in the production **bundle** because production never imports `src/index.e2e.js` (esbuild entry graph is `wrangler.toml` → `src/index.js` only).

---

## 7. Ownership split (spec input for Architect/Developer)

### Developer owns (app/config/auth/seed — one diff before Test Developer)

| file | change |
|---|---|
| `src/index.js` | export `handleRequest` + `resolveIdentity = whoami` default (3-line-class seam) |
| `src/index.e2e.js` | **new** local entry (login route + `e2eIdentity`) |
| `wrangler.e2e.toml` | **new** e2e config (no Supabase vars, no routes) |
| `.gitignore` | add `.dev.vars` (and optionally `.wrangler/state-e2e/` if not covered — `.wrangler/` already covers) |
| `.dev.vars` | **new untracked** `E2E_TEST_MODE=1` |
| `tools/e2e_seed.cjs` | **new** seed script (+ optional `tools/e2e_seed_core.sql` / `_ai.sql`) |
| `package.json` | scripts `dev:e2e`, `e2e:seed`, `test:e2e`; devDep `@playwright/test@1.63.0` exact |
| `playwright.config.js` | **new** root config (testDir, baseURL, chromium, webServer) |
| `tests/test_e2e_auth.cjs` | **new** unit proofs C4a, C5, exclusion §6 (runs under existing `npm test`) |

Developer also writes the unit tests the spec calls for; it does **not** write Playwright specs (BRIEF §12.1).

### Test Developer owns (fresh instance, never the implementer)

- `tests/e2e/**` only: helpers (§5.2), `tests/e2e/lessons-00b/*.spec.js` for C1–C3 (+C4b if run), fixtures/seed *data* files under `tests/e2e/` if any.
- Runs Playwright CLI skill for exploratory pass + screenshots at 1366×768.
- Writes `.opencode/pipeline/lessons-00b-e2e-harness/e2e.md` (checkpoint → pass/fail, command, screenshot/trace paths, failure classification).
- **Zero** edits to `src/**`, `public/**`, `wrangler*.toml`, `package.json`, `playwright.config.js`, `tools/**`, `.dev.vars`.

### Not in 00b

Roles/API, lesson tables, DO, real crop bank, remote anything, production Supabase test users, leak assertions beyond helper smoke, commit/push (commit only after user approves task STOP).

---

## 8. Versions / install checklist (implementable)

```bash
# from repo root, Windows git for VCS; prefix shell with rtk
npm install --save-dev @playwright/test@1.63.0     # exact pin
npx playwright install chromium                    # one-time browser download
node -v                                            # ≥22 required; observed v24.18.1
# verify wrangler invoker works in *your* shell before scripting (research shell failed):
npx wrangler --version                            # expect 4.125.0
```

Context7 pins: Playwright docs consulted at v1.63.x surface (multi-context, setOffline, CDP, webServer); workers-sdk for `.dev.vars` path + `--persist-to` + global `-c`. Re-check docs if pin changes.

---

## 9. Server lifecycle + Windows/WSL pitfalls

1. **Stop all `wrangler dev` before any `d1 execute`/seed** — in-memory state flushes over external writes on shutdown (CLAUDE.md; dev-log 1274).
2. **One state tree per mode**: always pass `--persist-to .wrangler/state-e2e` with `-c wrangler.e2e.toml`; production `npm run dev` keeps default `.wrangler/state`. Never omit the flag (would mix banks) and never change `database_id` (re-keys Miniflare, leaves stale populated files).
3. **Port**: `dev:e2e` and any manual `npm run dev` both want 8787 — kill one first. `webServer.reuseExistingServer: true` attaches if already up; confirm it is the **e2e** entry (response to `POST /api/e2e/login` with flag → not 404, or check process args) before trusting a reused server.
4. **Flag lifecycle**: `.dev.vars` sits beside both configs. Unset-flag tests must not delete the user's file — spawn the spare server with a temp config dir or temporarily rely on unit test C4a; document exact method in e2e.md.
5. **Git**: Windows `git.exe` only; WSL phantom diffs. Commit only after user approves task STOP (one local commit, no push).
6. **File writes**: use file tools for `.dev.vars`, `wrangler.e2e.toml`, SQL, LaTeX-free configs — shell echo corrupts backslashes/CRLF on this checkout.
7. **Playwright on Windows**: `npx playwright install chromium` once; if PATH `playwright-cli` (global) and local `@playwright/test` versions drift, prefer repo-local `npx playwright` for committed specs; CLI skill binary is for exploratory sessions.
8. **WSL vs Windows**: pick one side for server + tests per run (path/`127.0.0.1`/browser binary consistency). Do not seed from WSL while Windows wrangler holds the files.
9. **CSP**: e2e config reuses production CSP inside `src/index.js` (unchanged); supabase CDN block in tests is route-level, not CSP edit. No CSP change for 00b.
10. **`nul` untracked artifact**: leave untouched.
11. **Serena**: `initial_instructions` unavailable this session — future implementers should call it if exposed; no onboarding claims here.

---

## 10. Research summary (for Architect spec)

- **Relevant code:** seam at `src/index.js:165/155/212`; 404 fallthrough `:202`; origin check `:177–180`; membership `:217–228`; cookie `:85–89,231`; SPA boot `index.html:3895–4035`, bank load `:1453–1458`; schemas `schema.sql` / `schema_ai.sql`; config `wrangler.toml`; seed precedents `docs/BOOTSTRAP.md`, `tools/import_snapshot.cjs` (marker-not-first-file pattern).
- **Existing tests:** 43/43 `node --test`; no Playwright suite; `browser-probes.js` stale (guest flow removed).
- **Conventions:** ESM worker + `.cjs` tools/tests; marker-lift; 401-vs-empty; dual-bank split with `ai_ids` registry; `rtk` + Windows `git.exe`; no lint/typecheck scripts.
- **Dependencies/interfaces:** `@playwright/test@1.63.0` to add (exact); wrangler 4.125.0 local `-c` + `--persist-to`; `.dev.vars` root (new, gitignore); two D1 bindings, no DO yet.
- **Risks/unknowns:** research-shell wrangler invoker failure (re-verify); `.dev.vars` shared by both local configs (harmless locally — production entry ignores flag — but document); in-memory e2e sessions lost on hot reload; CDP throttle vs real WS behavior must be measured, not assumed; C4b spare-port flag-off server optional if unit C4a accepted by Reviewer; playwright webServer may attach to wrong server if 8787 already occupied.
- **Could not find:** `.dev.vars` (absent), e2e config/entry/seed (absent), Playwright package/config (absent), role column/admin routes (absent, task01), DO bindings (absent), Serena `initial_instructions` (tool not exposed).

Pipeline artifact: `.opencode/pipeline/lessons-00b-e2e-harness/research.md` (this file) only. Git tree otherwise untouched; `docs/lessons/` not modified.
