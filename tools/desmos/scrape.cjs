// Phase 1: fetch Prepzy's approved community Desmos solutions for every Math skill test.
//   PREPZY_TOKEN=... node tools/desmos/scrape.cjs                 verify alignment, then walk every test
//   PREPZY_TOKEN=... node tools/desmos/scrape.cjs --verify-only   only the alignment check
//   node tools/desmos/scrape.cjs --offline                        rebuild outputs from the cache alone
//   options: --test "<testName>" (repeatable) limits the walk; --bank <file> | --local picks the bank
//
// Prepzy is a signed-in app: its pages render client-side and its API answers 401 without a session.
// PREPZY_TOKEN is the `accessToken` a signed-in prepzy.app tab keeps in localStorage (sent as a
// Bearer header and injected into the headless page). Alternatively PREPZY_STORAGE_STATE names a
// Playwright storageState JSON saved from a signed-in browser. Neither is ever written to disk.
//
// Per test n = 0, 1, 2, ...: the rendered page gives the College Board question ID (its
// aria-label="Copy College Board question ID {cbId}" button) and the API gives the solution. The walk
// stops after STOP_AFTER pages in a row without a CB ID. One request per second (page loads and API
// calls share the limiter), a descriptive User-Agent, and every response cached under cache/ (ignored)
// with emails removed, so a rerun asks Prepzy only for what it has not seen.
//
// Writes (both ignored; they hold College Board question text):
//   tools/desmos/solutions.jsonl     one slim record per valid solution
//   tools/desmos/scrape-report.json  per test: pages walked, CB IDs, solutions, rejects, naming check
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const { DIR, loadBank, testNameOf, plain, tokens, previewParts, stateProblems, scrub } = require('./common.cjs');

const UA = 'roadto1600-desmos-import/1.0 (+https://roadto1600.org; importing Prepzy community Desmos solutions with permission)';
const PAGE = (t, n) => `https://prepzy.app/test/${encodeURIComponent(t)}/${n}?difficulty=all&scoreBand=all&releaseLabel=all&program=all&excludeBluebook=0&excludeStudyPlan=0`;
const API = (t, n) => `https://api.prepzy.app/desmos-solutions/approved?testName=${encodeURIComponent(t)}&questionIndex=${n}`;
const CB_ID = /aria-label="Copy College Board question ID ([^"]+)"/g;
const STOP_AFTER = 3;
const MIN_GAP_MS = 1000;
const PAGE_TIMEOUT_MS = 20000;
const VERIFY_SAMPLES = 3;
const ALIGNED = 0.8;
const CACHE = path.join(DIR, 'cache');

const slug = (t) => t.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
let last = 0;
async function slot() { const wait = last + MIN_GAP_MS - Date.now(); if (wait > 0) await sleep(wait); last = Date.now(); }

class AuthError extends Error {}

// ---- cache ----
const cacheFile = (kind, t, n) => path.join(CACHE, kind, slug(t), `${n}.${kind === 'page' ? 'html.gz' : 'json'}`);
function readCache(kind, t, n) {
  const f = cacheFile(kind, t, n);
  if (!fs.existsSync(f)) return undefined;
  return kind === 'page' ? zlib.gunzipSync(fs.readFileSync(f)).toString('utf8') : JSON.parse(fs.readFileSync(f, 'utf8'));
}
function writeCache(kind, t, n, value) {
  const f = cacheFile(kind, t, n);
  fs.mkdirSync(path.dirname(f), { recursive: true });
  // A page can show the signed-in account's address; an API row carries the maker's. Neither is kept.
  if (kind === 'page') fs.writeFileSync(f, zlib.gzipSync(String(value).replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, '[email removed]')));
  else fs.writeFileSync(f, JSON.stringify(scrub(value)));
}

// ---- network ----
async function apiGet(t, n, offline) {
  const held = readCache('api', t, n);
  if (held !== undefined || offline) return held === undefined ? { status: 0, body: null, missing: true } : held;
  const token = process.env.PREPZY_TOKEN;
  for (let attempt = 0; ; attempt++) {
    await slot();
    let res;
    try {
      res = await fetch(API(t, n), { headers: { 'User-Agent': UA, Accept: 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) } });
    } catch (e) {
      if (attempt >= 3) throw e;
      await sleep(2000 * 2 ** attempt); continue;
    }
    if (res.status === 401 || res.status === 403) throw new AuthError(`API answered ${res.status}: PREPZY_TOKEN is missing or expired`);
    if (res.status === 429 || res.status >= 500) {
      if (attempt >= 3) throw new Error(`API ${res.status} for ${t} #${n} after retries`);
      await sleep(Math.max(Number(res.headers.get('retry-after')) * 1000 || 0, 5000 * 2 ** attempt)); continue;
    }
    const text = await res.text();
    let body = null;
    try { body = text ? JSON.parse(text) : null; } catch { body = null; }
    const out = { status: res.status, body };
    writeCache('api', t, n, out);
    return out;
  }
}

let browser = null, context = null;
async function pageHtml(t, n, offline) {
  const held = readCache('page', t, n);
  if (held !== undefined || offline) return held;
  if (!context) {
    const { chromium } = require('@playwright/test');
    browser = await chromium.launch();
    const state = process.env.PREPZY_STORAGE_STATE;
    context = await browser.newContext({ userAgent: UA, ...(state ? { storageState: state } : {}) });
    const token = process.env.PREPZY_TOKEN;
    if (token && !state) await context.addInitScript(tok => {
      if (location.hostname === 'prepzy.app') { localStorage.setItem('accessToken', tok); localStorage.setItem('isAuthenticated', 'true'); }
    }, token);
    // Only the documents and scripts the page needs: no images, media or fonts.
    await context.route('**/*', route => ['image', 'media', 'font'].includes(route.request().resourceType()) ? route.abort() : route.continue());
  }
  await slot();
  const page = await context.newPage();
  try {
    await page.goto(PAGE(t, n), { waitUntil: 'domcontentloaded', timeout: PAGE_TIMEOUT_MS });
    try { await page.waitForSelector('[aria-label^="Copy College Board question ID"]', { timeout: PAGE_TIMEOUT_MS }); }
    catch { /* past the last question, or no CB ID on this one: decided by the caller */ }
    if (/\/(login|signin|sign-in)\b/.test(new URL(page.url()).pathname)) throw new AuthError('the page redirected to sign-in: PREPZY_TOKEN / PREPZY_STORAGE_STATE is missing or expired');
    const html = await page.content();
    writeCache('page', t, n, html);
    return html;
  } finally { await page.close(); }
}

// ---- parsing ----
const cbIdsOf = (html) => [...new Set([...String(html || '').matchAll(CB_ID)].map(m => m[1].trim()))];
// The approved list may come back as one solution, an array, or an object wrapping an array.
function solutionsOf(body) {
  if (!body) return [];
  if (Array.isArray(body)) return body.filter(Boolean);
  for (const k of ['solutions', 'data', 'items', 'results']) if (Array.isArray(body[k])) return body[k].filter(Boolean);
  if (body.solution && typeof body.solution === 'object') return [body.solution];
  return body.desmosState ? [body] : [];
}
// Only these fields survive; userEmail, finalizedBy, _id, the synthetic questionId and the rest are dropped.
function slim(sol, { cbId, testName, questionIndex }) {
  let state = sol.desmosState;
  if (typeof state === 'string') { try { state = JSON.parse(state); } catch { /* reported by stateProblems */ } }
  return { cbId: cbId || null, testName, questionIndex, questionFingerprint: sol.questionFingerprint ?? null,
    desmosState: state, questionPreview: scrub(sol.questionPreview ?? null),
    makerAttribution: { displayName: sol.makerAttribution && typeof sol.makerAttribution.displayName === 'string' ? scrub(sol.makerAttribution.displayName) : null } };
}

// Share of the API stem's words that appear on the rendered page (math markup differs between the two).
function coverage(apiStem, html) {
  const want = tokens(apiStem).filter(w => w.length >= 3 || /\d/.test(w));
  if (!want.length) return null;
  const have = new Set(tokens(plain(html)));
  return want.filter(w => have.has(w)).length / want.length;
}

// The page index and the API index must name the same question. For the first few solutions of the
// first tests, the API stem must be on its own page and fit it better than the next page.
async function verify(tests, offline) {
  const samples = [];
  for (const t of tests.slice(0, 2)) {
    for (let n = 0, found = 0; n < 15 && found < VERIFY_SAMPLES; n++) {
      const api = await apiGet(t, n, offline);
      const sol = solutionsOf(api.body)[0];
      if (!sol) continue;
      const stem = previewParts(sol.questionPreview).stem;
      const here = await pageHtml(t, n, offline), next = await pageHtml(t, n + 1, offline);
      const s = { testName: t, questionIndex: n, same: coverage(stem, here), next: coverage(stem, next), stem: plain(stem).slice(0, 120) };
      s.aligned = s.same !== null && s.same >= ALIGNED && (s.next === null || s.same > s.next);
      samples.push(s); found++;
    }
  }
  return samples;
}

async function walk(t, offline, out) {
  const r = { testName: t, pages: 0, withCbId: 0, solutions: 0, invalid: [], multiCbId: [], firstPageHasCbId: false };
  for (let n = 0, misses = 0; misses < STOP_AFTER; n++) {
    const html = await pageHtml(t, n, offline);
    if (html === undefined) break; // offline and never fetched
    r.pages++;
    const ids = cbIdsOf(html);
    if (n === 0) r.firstPageHasCbId = ids.length > 0;
    if (ids.length) { misses = 0; r.withCbId++; } else misses++;
    if (ids.length > 1) r.multiCbId.push({ questionIndex: n, ids });
    const api = await apiGet(t, n, offline);
    const sols = solutionsOf(api.body);
    if (!sols.length) continue; // no approved solution for this question yet
    // One solution per question: the first approved one, in the order Prepzy lists them.
    const rec = slim(sols[0], { cbId: ids.length === 1 ? ids[0] : null, testName: t, questionIndex: n });
    const bad = stateProblems(rec.desmosState);
    if (bad.length) { r.invalid.push({ questionIndex: n, cbId: rec.cbId, problems: bad }); continue; }
    r.solutions++;
    out.push(rec);
  }
  return r;
}

async function main() {
  const argv = process.argv.slice(2);
  const offline = argv.includes('--offline');
  if (!offline && !process.env.PREPZY_TOKEN && !process.env.PREPZY_STORAGE_STATE) {
    console.error('Set PREPZY_TOKEN (or PREPZY_STORAGE_STATE) from a signed-in Prepzy session; see tools/desmos/README.md.');
    process.exit(2);
  }
  const bank = loadBank(process.argv);
  const skills = [...new Set(bank.filter(q => q.section === 'Math' && q.skill).map(q => q.skill))].sort();
  const only = argv.flatMap((a, i) => a === '--test' ? [argv[i + 1]] : []);
  const tests = skills.map(s => ({ skill: s, testName: testNameOf(s) })).filter(x => !only.length || only.includes(x.testName));
  console.log(`${skills.length} Math skills in the banks; walking ${tests.length} Prepzy test(s)`);
  try {
    const samples = await verify(tests.map(x => x.testName), offline);
    for (const s of samples) console.log(`verify ${s.aligned ? 'ok ' : 'BAD'} ${s.testName} #${s.questionIndex}: same page ${s.same?.toFixed(2)}, next page ${s.next?.toFixed(2)} | ${s.stem}`);
    fs.writeFileSync(path.join(DIR, 'verify.json'), JSON.stringify(samples, null, 1) + '\n');
    if (!samples.length) { console.error('STOP: no solution found to verify the page/API alignment against.'); process.exitCode = 1; return; }
    if (samples.some(s => !s.aligned)) { console.error('STOP: page index and API index do not name the same question (tools/desmos/verify.json).'); process.exitCode = 1; return; }
    if (argv.includes('--verify-only')) return;

    const out = [], report = [];
    for (const { skill, testName } of tests) {
      const r = await walk(testName, offline, out);
      r.skill = skill;
      report.push(r);
      console.log(`${testName}: ${r.pages} pages, ${r.withCbId} with CB ID, ${r.solutions} solutions, ${r.invalid.length} invalid${r.firstPageHasCbId ? '' : '  <- no results: check Prepzy naming'}`);
    }
    fs.writeFileSync(path.join(DIR, 'solutions.jsonl'), out.map(r => JSON.stringify(r)).join('\n') + (out.length ? '\n' : ''));
    fs.writeFileSync(path.join(DIR, 'scrape-report.json'), JSON.stringify(report, null, 1) + '\n');
    const none = report.filter(r => !r.firstPageHasCbId).map(r => r.testName);
    console.log(`${out.length} solutions written to tools/desmos/solutions.jsonl`);
    if (none.length) console.log(`no results on Prepzy for: ${none.join(' | ')}`);
  } catch (e) {
    if (e instanceof AuthError) { console.error('STOP: ' + e.message); process.exitCode = 1; return; }
    throw e;
  } finally { if (browser) await browser.close(); }
}

if (require.main === module) main().catch(e => { console.error(e); process.exit(1); });
module.exports = { cbIdsOf, solutionsOf, slim, coverage };
