import { breakdown, normalizeQuestion, direction, cbSort } from '../public/shared/stats.js';
import { CODE, USAGE_MODES, lessonUsageVisible } from '../public/shared/lesson.js';
import { padSessionId, progressStatement, attemptStatement, attendedSessions, lessonHistory } from './record.js';
export { LessonRoom } from './lesson-room.js';
import { traceEnv } from './budget.js';

export const validLessonUpgrade = (req, url) => req.method === 'GET' &&
  req.headers.get('Upgrade')?.toLowerCase() === 'websocket' &&
  req.headers.get('Origin') === url.origin && req.headers.get('Sec-Fetch-Site') !== 'cross-site';

// Desmos's public demo key is for development only; production sets the DESMOS_API_KEY
// secret. With neither, lesson snapshots carry no key and the panel says so.
const DESMOS_DEMO_KEY = 'dcb31709b452b1cf9dc26972add0fda6';
export const desmosApiKey = (env, url) => env.DESMOS_API_KEY || (['127.0.0.1', 'localhost'].includes(url.hostname) ? DESMOS_DEMO_KEY : null);

async function lessonAccess(req, env, url, p, u) {
  const ws = /^\/api\/lessons\/([1-9]\d{0,8})\/ws$/.exec(p);
  const join = p === '/api/lessons/join' && req.method === 'POST';
  const info = /^\/api\/lessons\/([1-9]\d{0,8})$/.exec(p);
  if (!ws && !join && !info) return json({ error: 'not found' }, 404);
  let code, clientId = ws || info ? url.searchParams.get('client') : null;
  if (ws && !validLessonUpgrade(req, url)) return json({ error: 'invalid websocket upgrade or origin' }, 403);
  if (clientId && !/^[0-9a-f]{8}-[0-9a-f-]{27,40}$/i.test(clientId)) return json({ error: 'invalid client' }, 400);
  if (join) clientId = crypto.randomUUID();
  if (info && req.method !== 'GET') return json({ error: 'not found' }, 404);
  if (join) {
    if (Number(req.headers.get('Content-Length') || 0) > 128) return json({ error: 'invalid code' }, 400);
    const text = await req.text();
    if (text.length > 128) return json({ error: 'invalid code' }, 400);
    try { code = JSON.parse(text).code?.toUpperCase(); } catch { /* invalid */ }
    if (typeof code !== 'string' || !CODE.test(code)) return json({ error: 'invalid code' }, 400);
  }
  const role = await env.DB.prepare('SELECT role FROM users WHERE id=?').bind(u.id).first();
  if (!role || !['admin','student'].includes(role.role)) return json({ error: 'authorization unavailable' }, 503);
  let session;
  if (join) session = await env.DB.prepare('SELECT id, status FROM lesson_sessions WHERE join_code=? AND status!=\'ended\'').bind(code).first();
  else session = await env.DB.prepare('SELECT s.id, s.status, l.created_by FROM lesson_sessions s JOIN lessons l ON l.id=s.lesson_id WHERE s.id=?').bind(Number((ws || info)[1])).first();
  if (!session) return json({ error: join ? 'wrong or ended code' : 'session not found' }, 404);
  if (session.status === 'ended') return json({ error: 'session ended' }, 410);
  const owner = session.created_by || (await env.DB.prepare('SELECT l.created_by FROM lessons l JOIN lesson_sessions s ON s.lesson_id=l.id WHERE s.id=?').bind(session.id).first())?.created_by;
  const admin = role.role === 'admin' && owner === u.id;
  if (!join && !admin && role.role !== 'student') return json({ error: 'forbidden' }, 403);
  if (ws && !admin && !clientId) return json({ error: 'invalid client' }, 400);
  if (join && role.role !== 'student') return json({ error: 'student only' }, 403);
  if (role.role === 'student' && !join) {
    const participant = await env.DB.prepare('SELECT 1 FROM session_participants WHERE session_id=? AND user_id=? AND left_at IS NULL').bind(session.id,u.id).first();
    if (!participant) return json({ error: 'not joined' }, 403);
  }
  const body = { sessionId: session.id, userId: u.id, role: admin ? 'admin' : 'student',
    name: String(u.user_metadata?.full_name || u.email || u.id).slice(0, 200), ws: !!ws, join, clientId, desmosKey: desmosApiKey(env, url) };
  return env.LESSON_ROOM.getByName(String(session.id)).fetch(ws
    ? new Request('https://lesson.internal/', { headers: { Upgrade: 'websocket', 'X-Lesson-Internal': 'room', 'X-Lesson-Context': JSON.stringify(body) } })
    : new Request('https://lesson.internal/', { method: 'POST', headers: { 'X-Lesson-Internal': 'room', 'Content-Type': 'application/json' }, body: JSON.stringify(body) }));
}

// SAT Question Bank — Cloudflare Worker
// Serves static assets + /api/questions + /api/progress + /api/attempts.

// Everything the page loads is either same-origin or one of the two CDNs in
// index.html's <head>. The question HTML comes out of the database and goes
// straight into innerHTML, so if a stray <script> ever rides along with it,
// connect-src is what stops it from posting a session token anywhere. The inline
// allowances are the app's own <script> block and its style="" attributes.
const CSP = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net",
  "style-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net",
  "font-src 'self' data: https://cdn.jsdelivr.net",
  "img-src 'self' data:",
  "connect-src 'self' https://cxlzflzdlegosybkklma.supabase.co",
  // The SAT-locked Desmos calculators are iframed in. frame-src falls back to
  // default-src, so 'self' alone silently blanks the calculator panel.
  "frame-src https://www.desmos.com",
  "form-action 'none'",
  "frame-ancestors 'none'",
  "base-uri 'none'",
  "object-src 'none'"
].join('; ');
// Live lessons run the Desmos API, which evals its own module source and starts a
// blob: Web Worker (measured). Only /app and /admin get this; public/_headers and
// every other response keep the strict policy above.
const LESSON_CSP = CSP.replace("script-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net",
  "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://cdn.jsdelivr.net https://www.desmos.com") + "; worker-src blob:";

const harden = (h, csp = CSP) => {
  h.set('Content-Security-Policy', csp);
  h.set('X-Content-Type-Options', 'nosniff');
  h.set('Referrer-Policy', 'strict-origin-when-cross-origin');
  h.set('X-Frame-Options', 'DENY');
  h.set('Cache-Control', 'private, no-store');
  h.set('X-Robots-Tag', 'noindex, nofollow');
  // Only honoured over HTTPS, so wrangler dev on http://localhost ignores it.
  h.set('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  return h;
};

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: harden(new Headers({ 'Content-Type': 'application/json' }))
  });

// ASSETS.fetch hands back an immutable Response, so the headers go on a copy.
// A miss is answered with public/404.html rather than the platform's bare "Not
// Found". This is done here and not with [assets] not_found_handling, which is
// applied by the asset router *before* the Worker runs and therefore 404s every
// API route and /auth/callback along with it (measured).
const asset = async (env, req, csp = CSP) => {
  let r = await env.ASSETS.fetch(req);
  if (r.status === 404) {
    const page = await env.ASSETS.fetch(new URL('/404.html', req.url));
    if (page.ok) r = new Response(page.body, { status: 404, headers: page.headers });
  }
  return new Response(r.body, {
    status: r.status,
    statusText: r.statusText,
    headers: harden(new Headers(r.headers), csp)
  });
};

// Resolve the caller from their Supabase access token. The old code trusted an
// X-User-Id header, which let any client read or overwrite any account's progress.
// Cheap pre-filter, not a verification: is this even shaped like a live JWT? The
// signature still has to be checked by Supabase, but without this any stranger can
// put a line of noise in Authorization and make the Worker spend a call on
// Supabase's auth endpoint - which is the account's shared rate limit, so a curl
// loop from one machine is an auth outage for everyone. Garbage now costs the
// attacker a request and this Worker nothing.
const expOf = (t) => {
  const seg = t.split('.');
  if (seg.length !== 3) return 0;
  try {
    const c = JSON.parse(atob(seg[1].replace(/-/g, '+').replace(/_/g, '/')));
    return typeof c.exp === 'number' ? c.exp * 1000 : 0;
  } catch (e) { return 0; }
};
function looksLive(t) { return expOf(t) > Date.now(); }

// Token -> user, for as long as the token lives. A save used to cost a Supabase
// round-trip every time; an access token lasts an hour, so one lookup covers a
// sitting. Logout clears the browser cookie, not this cache or issued access tokens.
// Cached tokens remain valid until expiry; membership denial is checked per request.
// ponytail: cleared at 1000 entries; an LRU if that ever matters.
const WHO = new Map();
const COOKIE = '__Host-sat_session';
const tokenOf = (req) => req.headers.has('Authorization')
  ? (req.headers.get('Authorization').match(/^Bearer\s+([^\s]+)$/i)?.[1] || '')
  : (req.headers.get('Cookie') || '').split(';').map(v => v.trim()).find(v => v.startsWith(COOKIE + '='))?.slice(COOKIE.length + 1) || '';
const sessionCookie = (token = '') => `${COOKIE}=${token}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${token ? Math.max(0, Math.min(3600, Math.floor((expOf(token) - Date.now()) / 1000))) : 0}`;
async function whoami(req, env) {
  const t = tokenOf(req);
  if (!t || !looksLive(t)) return null;
  const hit = WHO.get(t);
  if (hit) return hit;
  const r = await fetch(`${env.SUPABASE_URL}/auth/v1/user`, {
    headers: { Authorization: `Bearer ${t}`, apikey: env.SUPABASE_ANON_KEY }
  });
  if (r.status === 401 || r.status === 403) return null;
  if (!r.ok) throw new Error('Authentication service unavailable');
  const u = await r.json().catch(() => null);
  if (!(u && u.id && u.email && u.email_confirmed_at)) return null;
  const claims = JSON.parse(atob(t.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')));
  if (claims.sub !== u.id ||
      !u.identities?.some(identity => identity.provider === 'google') ||
      u.identities.some(identity => !['google', 'email'].includes(identity.provider)) ||
      !claims.amr?.some(entry => entry.method === 'oauth') ||
      claims.amr.some(entry => !['oauth', 'totp', 'mfa/totp', 'mfa/phone', 'mfa/webauthn'].includes(entry.method))) return null;
  if (WHO.size > 1000) WHO.clear();
  WHO.set(t, u);
  return u;
}

// Every account that signs in gets a row, so progress has an owner to hang off and
// the account survives a Supabase-side name or email change.
// Only ever called from a route that is already writing. It used to run on
// GET /api/progress as well, which made a *read* spend D1's daily row-write
// budget - and once that budget is gone the read throws instead of returning the
// account's answers, so a full database reads as "Could not load your saved
// progress" on every reload. A read must not write.
// Once per user per isolate: the row does not change between two saves in a
// sitting, and every write here counts against D1's daily row-write cap.
const TOUCHED = new Set();
async function touchUser(env, u) {
  if (TOUCHED.has(u.id)) return;
  const name = u.user_metadata?.full_name || u.user_metadata?.name || '';
  await env.DB.prepare(
    `INSERT INTO users (id, email, name) VALUES (?,?,?)
     ON CONFLICT(id) DO UPDATE SET email=excluded.email,
       name=CASE WHEN excluded.name<>'' THEN excluded.name ELSE users.name END`
  ).bind(u.id, u.email || '', name).run();
  TOUCHED.add(u.id);
}

// A save is one sitting's worth of answers, never thousands. Without a ceiling a
// signed-in account can post an array of any length and have the Worker write all
// of it, which is a cheap way to fill someone else's database.
const MAX_ROWS = 500;
// Per-request row caps are not a storage bound on their own: nothing stops an
// account from posting the same 500 rows again a thousand times. `progress` is
// bounded by its own primary key once question_id has to name a real question,
// but `attempts` is append-only and keyed on a client-supplied timestamp, so it
// needs a ceiling of its own. 100k is ~55 years at 5 questions a day.
const MAX_ATTEMPTS = 100000;
// The settings blob was truncated to 8000 chars, which cuts JSON mid-string and
// stores something that will never parse again - the read side then silently
// hands back {} and the account's preferences are gone. Refuse it instead.
const MAX_SETTINGS = 8000;
// A note is prose about one question, not a document.
const MAX_NOTE = 4000;
// An exam session is ~150 answers plus timings; 64K is ten times that.
const MAX_SESSION = 65536;
const DAY = 86400000;
const adminPath = p => p === '/admin' || p.startsWith('/admin/') || p === '/admin.html';
const adminAPI = p => p === '/api/admin' || p.startsWith('/api/admin/');
const PAGE_SIZE = 25;
const pageOf = url => { const s = url.searchParams.get('page') ?? '1'; return /^[1-9]\d{0,5}$/.test(s) ? Number(s) : null; };
const validHistory = r => {
  if (r.answer_history_json == null) return true;
  if (typeof r.answer_history_json !== 'string' || r.answer_history_json.length > 8192) return false;
  let h; try { h = JSON.parse(r.answer_history_json); } catch { return false; }
  return Array.isArray(h) && h.length > 0 && h.length <= 128 && h.every((v, i) =>
    v && typeof v === 'object' && !Array.isArray(v) && typeof v.answer === 'string' &&
    v.answer.length > 0 && v.answer.length <= 32 && v.answer.trim() === v.answer &&
    Number.isInteger(v.atMs) && v.atMs >= 0 && v.atMs <= DAY &&
    (i === 0 || v.atMs >= h[i - 1].atMs)) && h.at(-1).answer === r.picked;
};
// Only the session POST synchronizes env promotion/demotion. Existing roles remain until next sign-in.
async function syncRole(env, u) {
  const name = u.user_metadata?.full_name || u.user_metadata?.name || '';
  const emails = String(env.ADMIN_EMAILS || '').split(',').map(x => x.trim().toLowerCase()).filter(Boolean);
  const role = emails.includes(u.email.toLowerCase()) ? 'admin' : 'student';
  await env.DB.prepare(`INSERT INTO users (id, email, name, role) VALUES (?,?,?,?)
    ON CONFLICT(id) DO UPDATE SET email=excluded.email,
      name=CASE WHEN excluded.name<>'' THEN excluded.name ELSE users.name END, role=excluded.role`)
    .bind(u.id, u.email, name, role).run();
  return role;
}
const BANK_COLS = 'id, external_id, section, domain, difficulty, skill, stem_html, choices_json, correct_answer, explanation_html, source, source_page, has_figure';
async function bank(env) {
  const [core, ai] = await Promise.all([
    env.DB.prepare(`SELECT ${BANK_COLS} FROM questions`).all(),
    env.AI_DB.prepare(`SELECT ${BANK_COLS}, level FROM questions`).all()
  ]);
  return [...(core.results || []), ...(ai.results || [])];
}
// What the shared stats read from a question: taxonomy, level, answer and each choice's letter and
// trap, not its HTML (free-plan CPU, docs/perf/free-plan-budget.md). normalizeQuestion still runs on
// the rows. It reads explanation_html only for a grid-in whose answer comes out empty; those few
// rows are read again with it.
// Choice HTML is dropped with json_remove on fixed paths: json_each would bill every choice as a D1 row read.
const LEAN = `id, section, domain, difficulty, skill, correct_answer, source,
  CASE WHEN json_valid(choices_json) THEN json_remove(choices_json, ${Array.from({ length: 8 }, (_, i) => `'$[${i}].content'`).join(', ')}) ELSE '[]' END AS choices_json`;
// Kept per isolate like the builder index (same key and expiry); callers only read the rows.
let statMemo = null;
async function statBank(env, keep = null) {
  const key = await bankStamp(env);
  if (!(statMemo?.key === key && Date.now() - statMemo.at < BANK_TTL * 1000)) statMemo = { key, at: Date.now(), qs: await leanBank(env) };
  return keep ? statMemo.qs.filter(q => keep.has(q.id)) : statMemo.qs;
}
async function leanBank(env) {
  const [core, ai] = await Promise.all([
    env.DB.prepare(`SELECT ${LEAN} FROM questions`).all(),
    env.AI_DB.prepare(`SELECT ${LEAN}, level FROM questions`).all()
  ]);
  const raw = [...(core.results || []), ...(ai.results || [])], qs = raw.map(normalizeQuestion);
  const blank = qs.flatMap((q, i) => q.spr && !q.answer ? [i] : []);
  for (const ai of [false, true]) {
    const list = blank.filter(i => qs[i].ai === ai);
    for (const rows of await byIds(ai ? env.AI_DB : env.DB, 'id, explanation_html', list.map(i => qs[i].id))) {
      const html = new Map(rows.map(r => [r.id, r.explanation_html]));
      for (const i of list) if (html.has(qs[i].id)) qs[i] = normalizeQuestion({ ...raw[i], explanation_html: html.get(qs[i].id) });
    }
  }
  return qs;
}
// Rows by ID in chunks under D1's 100 bound parameters.
async function byIds(db, cols, ids) {
  const out = [];
  for (let i = 0; i < ids.length; i += 90) {
    const part = ids.slice(i, i + 90);
    out.push((await db.prepare(`SELECT ${cols} FROM questions WHERE id IN (${part.map(() => '?').join(',')})`).bind(...part).all()).results || []);
  }
  return out;
}
// The /api/questions body is the same for every signed-in user (both banks and the global
// usedInLesson), and building it is the costliest CPU on the free plan, so the finished body is kept
// in a named cache and served only after the membership checks. Its key moves when a question is
// added or replaced (max rowid of either bank) or a lesson adds usage rows (insert-only table); an
// edit to an existing question shows once the entry expires. Clients still get private, no-store.
const BANK_CACHE = 'https://bank-cache.internal/v1/', BANK_TTL = 3600;
const maxRowid = (db, table) => db.prepare(`SELECT MAX(rowid) AS r FROM ${table}`).all().then(x => x.results?.[0]?.r ?? '');
const bankStamp = env => Promise.all([maxRowid(env.DB, 'questions'), maxRowid(env.AI_DB, 'questions')]).then(r => r.join('-'));
async function questionsResponse(env) {
  const [bankKey, usage] = await Promise.all([bankStamp(env), maxRowid(env.DB, 'question_lesson_usage')]);
  const key = BANK_CACHE + bankKey + '-' + usage;
  const cache = typeof caches === 'undefined' ? null : await caches.open('bank');
  const hit = await cache?.match(key);
  if (hit) return new Response(hit.body, { headers: harden(new Headers({ 'Content-Type': 'application/json' })) });
  const [rows, usageById] = await Promise.all([bank(env), lessonUsage(env)]);
  const body = JSON.stringify(rows.map(q => ({ ...q, usedInLesson: usageById.get(q.id) || [] })));
  await cache?.put(key, new Response(body, { headers: { 'Content-Type': 'application/json', 'Cache-Control': 'max-age=' + BANK_TTL } }));
  return new Response(body, { headers: harden(new Headers({ 'Content-Type': 'application/json' })) });
}
// Admin stats are kept per student in a named cache (admin-only data, read only behind the admin
// check) under a stamp of the bank and the student's latest attempt time: one index seek each, in one
// batch. Every graded answer writes its attempt and its progress row with the same time (practice,
// exams and the lesson write-back all use nextProgress/attemptRow with one `now`), but they arrive
// as separate requests; an entry computed while progress lags the latest attempt is not kept.
const STATS_CACHE = 'https://admin-stats.internal/v1/';
const statsCache = async () => typeof caches === 'undefined' ? null : caches.open('admin-stats');
const cachedStats = async (cache, key) => { const r = await cache?.match(STATS_CACHE + key); return r ? r.json() : null; };
const keepStats = (cache, key, value) => cache?.put(STATS_CACHE + key, new Response(JSON.stringify(value),
  { headers: { 'Content-Type': 'application/json', 'Cache-Control': 'max-age=' + BANK_TTL } }));
async function statStamps(env, ids) {
  const [latest, bankKey] = await Promise.all([ids.length ? env.DB.batch(ids.map(id => env.DB.prepare('SELECT MAX(ts) AS ts FROM attempts WHERE user_id = ?').bind(id))) : [], bankStamp(env)]);
  const out = new Map(ids.map((id, i) => [id, bankKey + '|' + (latest[i].results?.[0]?.ts ?? '')]));
  return id => out.get(id);
}
const settled = (prog, log) => { const last = log.reduce((a, x) => !a || x.ts > a.ts ? x : a, null); return !last || (prog[last.question_id]?.last_reviewed || '') >= last.ts; };
// §2 usedInLesson: padded session IDs per question, oldest first. With a user, only the
// questions of sessions they attended (My Lessons refreshes those after a lesson ends).
// The global map is kept per isolate under the usage table's max rowid: rows are only ever inserted,
// so an unchanged max rowid means an unchanged map.
let usageMemo = null;
async function lessonUsage(env, userId = null) {
  const key = userId ? null : await maxRowid(env.DB, 'question_lesson_usage');
  if (!userId && usageMemo?.key === key) return usageMemo.map;
  const used = await (userId ? env.DB.prepare(`SELECT question_id, session_id FROM question_lesson_usage WHERE question_id IN
      (SELECT u.question_id FROM question_lesson_usage u JOIN session_participants p ON p.session_id = u.session_id WHERE p.user_id = ?)
      ORDER BY used_at, session_id`).bind(userId)
    : env.DB.prepare('SELECT question_id, session_id FROM question_lesson_usage ORDER BY used_at, session_id')).all();
  const usageById = new Map();
  for (const r of used.results || []) { if (!usageById.has(r.question_id)) usageById.set(r.question_id, []); usageById.get(r.question_id).push(padSessionId(r.session_id)); }
  if (!userId) usageMemo = { key, map: usageById };
  return usageById;
}
async function adminData(env, id) {
  const [progress, attempts, qs] = await Promise.all([
    env.DB.prepare('SELECT question_id, attempts, corrects, marker, last_reviewed, time_taken_ms FROM progress WHERE user_id = ?').bind(id).all(),
    env.DB.prepare('SELECT question_id, ts, correct, time_taken_ms, picked, changes, answer_history_json, lesson_session_id FROM attempts WHERE user_id = ? ORDER BY ts').bind(id).all(),
    statBank(env)
  ]);
  const prog = Object.fromEntries((progress.results || []).map(p => [p.question_id, p]));
  const log = attempts.results || [];
  const stats = breakdown(qs, prog, log);
  const byId = new Map(qs.map(q => [q.id, q]));
  const directions = { 'right-to-wrong': 0, 'wrong-to-right': 0, unchanged: 0, unknown: 0 };
  log.forEach(x => { directions[direction(byId.get(x.question_id) || { answer: '', choices: [] }, x)]++; });
  return { qs, prog, log, stats, directions };
}
const str = (v, n) => (typeof v === 'string' ? v.slice(0, n) : '');
export { padSessionId };
const CODE_CHARS = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
// Rejection sampling avoids modulo bias when mapping secure random bytes to 31 symbols.
const joinCode = () => {
  let code = '';
  while (code.length < 6) for (const b of crypto.getRandomValues(new Uint8Array(12))) {
    if (b < Math.floor(256 / CODE_CHARS.length) * CODE_CHARS.length) code += CODE_CHARS[b % CODE_CHARS.length];
    if (code.length === 6) break;
  }
  return code;
};
const lessonId = s => /^[1-9]\d{0,8}$/.test(s) ? Number(s) : null;
const lessonBody = b => b && !Array.isArray(b) && typeof b === 'object' &&
  typeof b.title === 'string' && b.title.trim().length > 0 && b.title.trim().length <= 200 &&
  ['instructor', 'self'].includes(b.mode) && Array.isArray(b.items) && b.items.length <= MAX_ROWS &&
  b.items.every(x => x && typeof x === 'object' && !Array.isArray(x) &&
    typeof x.question_id === 'string' && x.question_id.length > 0 && x.question_id.length <= 64 &&
    Number.isInteger(x.time_limit_sec) && x.time_limit_sec >= 5 && x.time_limit_sec <= 10800 &&
    typeof x.notes === 'string' && x.notes.length <= MAX_NOTE) &&
  new Set(b.items.map(x => x.question_id)).size === b.items.length;
// The builder filters and pages the whole bank on every search. Receiving its 3,400 light rows from
// D1 alone costs more CPU than the free plan's 10 ms, so each isolate keeps them, sorted once in the
// builder's order (cbSort is one fixed order, so any filtered subset of the sorted list is sorted
// too), while both banks' max rowid hold and for at most BANK_TTL, like the bank cache.
let builderMemo = null;
async function builderIndex(env, fresh = false) {
  const key = await bankStamp(env);
  if (!fresh && builderMemo?.key === key && Date.now() - builderMemo.at < BANK_TTL * 1000) return builderMemo;
  const cols = 'id, section, domain, difficulty, skill';
  const [core, ai] = await Promise.all([env.DB.prepare(`SELECT ${cols} FROM questions`).all(), env.AI_DB.prepare(`SELECT ${cols} FROM questions`).all()]);
  const bank = [...(core.results || []), ...(ai.results || []).map(q => ({ ...q, ai: true }))];
  const rank = list => new Map(cbSort(list).map((k, i) => [k, i]));
  const domainOrder = rank([...new Set(bank.map(q => q.domain || ''))]), skillOrder = rank([...new Set(bank.map(q => q.skill || ''))]), byText = new Intl.Collator().compare;
  // Same order as indexOf + localeCompare; a Map and one collator (what localeCompare uses) cost less per comparison.
  const rows = bank.slice().sort((a,b) => domainOrder.get(a.domain || '') - domainOrder.get(b.domain || '') ||
    skillOrder.get(a.skill || '') - skillOrder.get(b.skill || '') || byText(a.id, b.id));
  return builderMemo = { key, at: Date.now(), bank, rows, taxonomy: {} };
}
function taxonomy(bank, section) {
  const inSection = bank.filter(q => !section || q.section === section);
  const domains = cbSort([...new Set(inSection.map(q => q.domain).filter(Boolean))]);
  return { domains, skillsByDomain: Object.fromEntries(domains.map(d => [d, cbSort([...new Set(inSection.filter(q => q.domain === d).map(q => q.skill).filter(Boolean))])])) };
}
// Search matches the ID, skill or tag-stripped stem, lower-cased. D1 first narrows to rows whose raw
// text holds every whitespace-free piece of the term: tag stripping only inserts spaces, and for an
// ASCII term SQLite's lower() agrees with toLowerCase() except on U+0130 and U+212A, which JS lowers
// to ASCII, so rows holding those always pass. The exact test below then decides, as before.
async function searchBank(env, search) {
  const pieces = search.split(/\s+/).filter(Boolean);
  const narrow = pieces.every(x => /^[\x21-\x7e]+$/.test(x));
  const has = f => pieces.map((_, i) => `instr(lower(${f}), ?${i + 1}) > 0`).join(' AND ');
  const where = narrow ? ` WHERE (${has('id')}) OR (${has('skill')}) OR (${has('stem_html')}) OR
    instr(COALESCE(id, '') || COALESCE(skill, '') || COALESCE(stem_html, ''), char(304)) > 0 OR instr(COALESCE(id, '') || COALESCE(skill, '') || COALESCE(stem_html, ''), char(8490)) > 0` : '';
  const read = db => db.prepare('SELECT id, skill, stem_html FROM questions' + where).bind(...(narrow ? pieces : [])).all();
  const match = q => [q.id, q.skill, q.stem_html?.replace(/<[^>]*>/g, ' ')].some(v => String(v || '').toLowerCase().includes(search));
  return (await Promise.all([read(env.DB), read(env.AI_DB)])).map(r => new Set((r.results || []).filter(match).map(q => q.id)));
}
async function lessonDetail(env, id) {
  const lesson = await env.DB.prepare('SELECT * FROM lessons WHERE id=?').bind(id).first();
  if (!lesson) return null;
  const items = await env.DB.prepare('SELECT question_id, time_limit_sec, notes FROM lesson_questions WHERE lesson_id=? ORDER BY position').bind(id).all();
  return { ...lesson, items: items.results || [] };
}
async function lessonRoutes(req, env, url, p, u) {
  const method = req.method;
  if (p === '/api/admin/questions' && method === 'GET') {
    const page = pageOf(url), params = url.searchParams;
    const section = params.get('section') || '', domains = params.getAll('domain'), skills = params.getAll('skill');
    const difficulties = params.getAll('difficulty'), usage = params.get('lessonUsage') || 'show-all', search = (params.get('search') || '').trim().toLowerCase();
    if (!page || !['','Math','Reading & Writing'].includes(section) ||
        [domains,skills,difficulties].some(v => v.length > 30) || [...domains,...skills].some(s => !s || s.length > 150) ||
        difficulties.some(d => !['Easy','Medium','Hard'].includes(d)) || !USAGE_MODES.includes(usage) || search.length > 100 ||
        [...params.keys()].some(k => !['page','section','domain','skill','difficulty','lessonUsage','search'].includes(k))) return json({ error: 'invalid filter' }, 400);
    const [usageById, found] = await Promise.all([lessonUsage(env), search ? searchBank(env, search) : null]);
    // The instructor "attended" every session of a lesson they created: they ran it.
    const ran = usage === 'hide-attended' ? new Set(((await env.DB.prepare('SELECT s.id FROM lesson_sessions s JOIN lessons l ON l.id=s.lesson_id WHERE l.created_by=?').bind(u.id).all()).results || []).map(r => padSessionId(r.id))) : new Set();
    let index, rows, shown, full;
    // A question deleted since the index was built is missing from the page read: rebuild the index once.
    for (const fresh of [false, true]) {
      index = await builderIndex(env, fresh);
      // The index is already in the builder's order, so every filtered subset is too.
      rows = index.rows.filter(q => (!section || q.section === section) && (!domains.length || domains.includes(q.domain)) && (!skills.length || skills.includes(q.skill)) &&
        (!difficulties.length || difficulties.includes(q.difficulty)) && lessonUsageVisible(usageById.get(q.id), usage, ran) && (!found || found[q.ai ? 1 : 0].has(q.id)));
      shown = rows.slice((page-1)*PAGE_SIZE,page*PAGE_SIZE);
      const [coreFull, aiFull] = await Promise.all([byIds(env.DB, BANK_COLS, shown.filter(q => !q.ai).map(q => q.id)),
        byIds(env.AI_DB, BANK_COLS + ', level', shown.filter(q => q.ai).map(q => q.id))]);
      full = [new Map(coreFull.flat().map(r => [r.id, r])), new Map(aiFull.flat().map(r => [r.id, r]))];
      if (shown.every(q => full[q.ai ? 1 : 0].has(q.id))) break;
    }
    return json({ questions: shown.map(q => ({ ...normalizeQuestion(full[q.ai ? 1 : 0].get(q.id)), usedInLesson: usageById.get(q.id) || [] })),
      total: rows.length, page, pages: Math.max(1, Math.ceil(rows.length/PAGE_SIZE)),
      ...(index.taxonomy[section] ||= taxonomy(index.bank, section)) });
  }
  if (p === '/api/admin/lessons' && method === 'GET') {
    const rows = await env.DB.prepare(`SELECT l.*, COUNT(DISTINCT q.question_id) AS questionCount,
      COALESCE(SUM(q.time_limit_sec),0) AS totalSec,
      (SELECT COUNT(*) FROM lesson_sessions s WHERE s.lesson_id=l.id) AS timesRun,
      (SELECT MAX(created_at) FROM lesson_sessions s WHERE s.lesson_id=l.id) AS lastRun
      FROM lessons l LEFT JOIN lesson_questions q ON q.lesson_id=l.id
      WHERE l.archived=0 OR ?=1 GROUP BY l.id ORDER BY l.updated_at DESC, l.id DESC`).bind(url.searchParams.get('includeArchived') === '1' ? 1 : 0).all();
    return json(rows.results || []);
  }
  const m = /^\/api\/admin\/lessons\/([^/]+)(?:\/(duplicate|sessions))?$/.exec(p);
  if (!m && !(p === '/api/admin/lessons' && method === 'POST')) return json({ error: 'not found' }, 404);
  const id = m && lessonId(m[1]);
  if (m && !id) return json({ error: 'invalid lesson ID' }, 400);
  if (m && m[2] === 'sessions' && method === 'GET') {
    if (!await env.DB.prepare('SELECT id FROM lessons WHERE id=?').bind(id).first()) return json({ error: 'not found' }, 404);
    const rows = await env.DB.prepare('SELECT id, join_code, status, created_at, started_at, ends_at, ended_at FROM lesson_sessions WHERE lesson_id=? ORDER BY id DESC').bind(id).all();
    return json((rows.results || []).map(r => ({ ...r, paddedId: padSessionId(r.id) })));
  }
  if (m && !m[2] && method === 'GET') {
    const detail = await lessonDetail(env, id);
    return json(detail || { error: 'not found' }, detail ? 200 : 404);
  }
  if (m && !m[2] && method === 'DELETE') {
    if (!await env.DB.prepare('SELECT id FROM lessons WHERE id=?').bind(id).first()) return json({ error: 'not found' }, 404);
    // Keep the template reference and every frozen session/response/review intact.
    await env.DB.prepare('UPDATE lessons SET archived=1 WHERE id=?').bind(id).run();
    return json({ ok: true });
  }
  if (m && m[2] === 'sessions' && method === 'POST') {
    const lesson = await lessonDetail(env,id);
    if (!lesson) return json({ error: 'not found' }, 404);
    if (!lesson.items.length) return json({ error: 'empty lesson' }, 400);
    const snapshot = JSON.stringify({ title: lesson.title, mode: lesson.mode, items: lesson.items });
    for (let i=0;i<10;i++) {
      const code = joinCode();
      try {
        const result = await env.DB.prepare('INSERT INTO lesson_sessions (lesson_id, join_code, snapshot_json) VALUES (?,?,?)').bind(id,code,snapshot).run();
        const sessionId = result.meta.last_row_id;
        return json({ sessionId, paddedId: padSessionId(sessionId), joinCode: code });
      } catch (e) { if (!/UNIQUE constraint failed: lesson_sessions.join_code/i.test(String(e))) throw e; }
    }
    return json({ error: 'join codes unavailable' }, 503);
  }
  if (m && m[2] === 'duplicate' && method === 'POST') {
    const old = await lessonDetail(env,id);
    if (!old) return json({ error: 'not found' }, 404);
    return saveLesson(env, u, { title: old.title + ' (copy)', mode: old.mode, items: old.items });
  }
  if ((!m && method === 'POST') || (m && !m[2] && method === 'PUT')) {
    const text = await req.text();
    if (text.length > 1000000) return json({ error: 'too large' }, 400);
    let b; try { b = JSON.parse(text); } catch { return json({ error: 'invalid lesson' }, 400); }
    if (!lessonBody(b)) return json({ error: 'invalid lesson' }, 400);
    if (m && !await env.DB.prepare('SELECT id FROM lessons WHERE id=?').bind(id).first()) return json({ error: 'not found' }, 404);
    return saveLesson(env,u,b,id);
  }
  return json({ error: 'not found' }, 404);
}
async function saveLesson(env, u, b, id = null) {
  const ids = b.items.map(x => x.question_id);
  if (ids.length) {
    const known = await env.DB.batch(ids.map(q => env.DB.prepare('SELECT id FROM questions WHERE id=? UNION SELECT id FROM ai_ids WHERE id=?').bind(q,q)));
    if (known.some(x => !x.results?.length)) return json({ error: 'unknown question IDs' }, 400);
  }
  // Reserve an explicit ID so each child uses the same parent, even when inserts change last_insert_rowid().
  for (let attempt = 0; attempt < (id ? 1 : 10); attempt++) {
    const target = id || (await env.DB.prepare("SELECT COALESCE((SELECT seq FROM sqlite_sequence WHERE name='lessons'),0)+1 AS id").first()).id;
    const statements = id ? [env.DB.prepare('UPDATE lessons SET title=?, mode=?, updated_at=datetime(\'now\') WHERE id=?').bind(b.title.trim(), b.mode, target),
      env.DB.prepare('DELETE FROM lesson_questions WHERE lesson_id=?').bind(target)] :
      [env.DB.prepare('INSERT INTO lessons (id, title, mode, created_by) VALUES (?,?,?,?)').bind(target, b.title.trim(), b.mode, u.id)];
    for (const [position, item] of b.items.entries()) statements.push(env.DB.prepare(
      'INSERT INTO lesson_questions (lesson_id, position, question_id, time_limit_sec, notes) VALUES (?,?,?,?,?)'
    ).bind(target,position,item.question_id,item.time_limit_sec,item.notes));
    try { await env.DB.batch(statements); return json({ id: target }); }
    catch (e) { if (id || !/UNIQUE constraint failed: lessons.id/i.test(String(e))) throw e; }
  }
  return json({ error: 'lesson ID unavailable' }, 503);
}

export default {
  async fetch(req, env) {
    const t = traceEnv(env, 'worker', req.method + ' ' + new URL(req.url).pathname);
    let res;
    try {
      res = await handleRequest(req, t.env);
    } catch {
      res = json({ error: 'service unavailable' }, 503);
    }
    return withTrace(res, t);
  }
};

// BUDGET_TRACE=1 only: the invocation's D1 counts ride back on the response (not on 101s).
export function withTrace(res, t) {
  const trace = t.done({ status: res.status });
  if (!trace || res.status === 101) return res;
  const out = new Response(res.body, res);
  out.headers.set('X-Budget-Trace', JSON.stringify(trace));
  return out;
}

export async function handleRequest(req, env, resolveIdentity = whoami) {
    const url = new URL(req.url);
    const p = url.pathname;

    // One canonical host. Supabase only redirects an OAuth or confirmation link
    // back to an origin on its allowlist, so a session started on www and
    // finished on the apex (or the reverse) is a session dropped on the floor.
    if (url.hostname === 'www.roadto1600.org') {
      url.hostname = 'roadto1600.org';
      return new Response(null, { status: 301, headers: harden(new Headers({ Location: url.toString() })) });
    }

    if (!['GET', 'HEAD'].includes(req.method) &&
        (req.headers.get('Origin') !== url.origin || req.headers.get('Sec-Fetch-Site') === 'cross-site')) {
      return json({ error: 'forbidden origin' }, 403);
    }
    const pages = { '/': '/landing.html', '/login': '/login.html', '/privacy': '/privacy.html', '/terms': '/terms.html', '/auth/callback': '/login.html' };
    const aliases = { '/landing.html': '/', '/login.html': '/login', '/privacy.html': '/privacy', '/terms.html': '/terms', '/index.html': '/app', '/app/': '/app', '/admin.html': '/admin' };
    const redirect = (to) => new Response(null, { status: 302, headers: harden(new Headers({ Location: to })) });
    if (['GET', 'HEAD'].includes(req.method)) {
      if (Object.hasOwn(aliases, p) && !adminPath(p)) return redirect(aliases[p]);
      if (Object.hasOwn(pages, p)) return asset(env, new Request(new URL(pages[p], url), req));
      if (['/lesson-ui/lesson.js', '/lesson-ui/lesson.css', '/site.css', '/site.js', '/auth.js', '/shared/stats.js', '/shared/renderer.js', '/shared/lesson.js', '/shared/annotations.js', '/shared/desmos.js', '/favicon.svg', '/robots.txt'].includes(p)) return asset(env, req);
    }
    if (p === '/api/auth/logout' && req.method === 'POST') {
      const res = json({ ok: true });
      res.headers.set('Set-Cookie', sessionCookie());
      return res;
    }
    const lessonRoute = p === '/api/lessons/join' || /^\/api\/lessons\/[1-9]\d{0,8}(?:\/ws)?$/.test(p);
    const historyRoute = req.method === 'GET' && /^\/api\/lesson-history(?:\/[1-9]\d{0,8})?$/.test(p);
    const apiMethods = {
      '/api/auth/session': ['POST'], '/api/questions': ['GET'], '/api/account': ['GET'],
      '/api/progress': ['GET', 'POST'], '/api/attempts': ['GET', 'POST'],
      '/api/notes': ['GET', 'POST'], '/api/settings': ['GET', 'POST'], '/api/sessions': ['GET', 'POST']
    };
    const isAPI = p === '/api' || p.startsWith('/api/');
    const knownAPI = apiMethods[p]?.includes(req.method) ||
      (/^\/api\/sessions\/[^/]+$/.test(p) && req.method === 'DELETE');
    if (isAPI && !knownAPI && !adminAPI(p) && !lessonRoute && !historyRoute) return json({ error: 'not found' }, 404);
    const restrictedAsset = ['GET', 'HEAD'].includes(req.method) &&
      (p === '/app' || adminPath(p) || p === '/admin.js' || p === '/exams.json' || /^\/qimg\/[^/]+\.(?:png|jpg|jpeg|webp|svg)$/i.test(p));
    if (!knownAPI && !restrictedAsset && !adminAPI(p) && !lessonRoute && !historyRoute) {
      const res = await asset(env, new Request(new URL('/404.html', url), { method: req.method === 'HEAD' ? 'HEAD' : 'GET' }));
      return new Response(res.body, { status: 404, headers: res.headers });
    }
    let u, membership;
    try {
      if (p === '/api/auth/session' && !req.headers.has('Authorization')) return json({ error: 'bearer required' }, 401);
      u = await resolveIdentity(req, env);
      if (!u) {
        if (p === '/app' || adminPath(p) || p === '/admin.js') return redirect('/login');
        return json({ error: 'unauthorized' }, 401);
      }
      membership = await env.DB.prepare('SELECT status FROM membership WHERE user_id = ?').bind(u.id).first();
      if (!membership && p === '/api/auth/session') {
        const status = u.email.toLowerCase().endsWith('@ccs.us') ? 'approved' : 'pending';
        await env.DB.prepare('INSERT INTO membership (user_id, email, status) VALUES (?, ?, ?) ON CONFLICT(user_id) DO NOTHING')
          .bind(u.id, u.email, status).run();
        membership = await env.DB.prepare('SELECT status FROM membership WHERE user_id = ?').bind(u.id).first();
      }
      if (!['approved', 'pending'].includes(membership?.status)) {
        const res = p === '/app' || adminPath(p) || p === '/admin.js' ? redirect('/login?denied=1') : json({ error: 'membership denied' }, 403);
        res.headers.set('Set-Cookie', sessionCookie());
        return res;
      }
      if (p === '/api/auth/session') {
        // The client shows admin navigation only from this server-derived role.
        const role = await syncRole(env, u);
        const res = json({ user_id: u.id, status: membership.status, role });
        res.headers.set('Set-Cookie', sessionCookie(tokenOf(req)));
        return res;
      }
    } catch {
      return json({ error: 'authentication unavailable' }, 503);
    }
    if (lessonRoute) {
      if (membership.status !== 'approved') return json({ error: 'membership not approved' }, 403);
      try { return await lessonAccess(req, env, url, p, u); }
      catch { return json({ error: 'lesson unavailable' }, 503); }
    }
    // §9.1 My Lessons: a student's own sessions; one opens only after it has ended (G6).
    if (historyRoute) {
      try {
        if (p === '/api/lesson-history') {
          const [sessions, usage] = await Promise.all([attendedSessions(env.DB, u.id), lessonUsage(env, u.id)]);
          return json({ attended: sessions.map(s => s.paddedId), sessions: sessions.filter(s => s.status === 'ended'), usage: Object.fromEntries(usage) });
        }
        const detail = await lessonHistory(env.DB, env.AI_DB, u.id, Number(p.slice('/api/lesson-history/'.length)));
        return detail ? json({ ...detail, desmosKey: desmosApiKey(env, url) }) : json({ error: 'not found' }, 404);
      } catch { return json({ error: 'history unavailable' }, 503); }
    }
    if (adminPath(p) || adminAPI(p) || p === '/admin.js') {
      let role;
      try { role = await env.DB.prepare('SELECT role FROM users WHERE id = ?').bind(u.id).first(); }
      catch { return json({ error: 'authorization unavailable' }, 503); }
      if (!role || !['student', 'admin'].includes(role.role)) return json({ error: 'authorization unavailable' }, 503);
      if (role.role !== 'admin') return adminPath(p) || p === '/admin.js'
        ? new Response('<!doctype html><meta charset="utf-8"><title>Forbidden</title><p>Admin access required. <a href="/app">Back to the app</a></p>', { status: 403, headers: harden(new Headers({ 'Content-Type': 'text/html; charset=utf-8' })) })
        : json({ error: 'forbidden' }, 403);
      if (p === '/admin.js') return asset(env, req);
      if (adminPath(p)) {
        if (!['GET', 'HEAD'].includes(req.method)) return json({ error: 'not found' }, 404);
        if (p === '/admin.html') return redirect('/admin');
        return asset(env, new Request(new URL('/admin.html', url), req), LESSON_CSP);
      }
      if (p === '/api/admin/questions' || p === '/api/admin/lessons' || p.startsWith('/api/admin/lessons/')) {
        try { return await lessonRoutes(req, env, url, p, u); }
        catch { return json({ error: 'service unavailable' }, 503); }
      }
      if (req.method !== 'GET') return json({ error: 'not found' }, 404);
      if (p === '/api/admin/students') {
        const page = pageOf(url); if (!page) return json({ error: 'invalid page' }, 400);
        const search = (url.searchParams.get('search') || '').trim();
        if (search.length > 100) return json({ error: 'invalid search' }, 400);
        const sort = url.searchParams.get('sort') || 'name', asc = url.searchParams.get('order') !== 'desc';
        const sorts = ['name', 'done', 'accuracy', 'weakest', 'avgMs', 'guessRate', 'lastActive'];
        if (!sorts.includes(sort)) return json({ error: 'invalid sort' }, 400);
        const term = '%' + search.replace(/[\\%_]/g, '\\$&') + '%';
        const where = `FROM membership m JOIN users u ON u.id=m.user_id
          WHERE m.status IN ('approved','pending') AND u.role='student'
          AND (u.name LIKE ? ESCAPE '\\' OR u.email LIKE ? ESCAPE '\\')`;
        // ponytail: compute club roster before sorting; move aggregates into SQL if club grows past a few hundred.
        const users = await env.DB.prepare(`SELECT u.id, u.email, u.name, m.status ${where} LIMIT 501`).bind(term, term).all();
        // ponytail: explicit club-size ceiling; use SQL materialized aggregates when >500 members.
        if ((users.results || []).length > 500) return json({ error: 'Student list exceeds supported size' }, 413);
        // Cached rows are reused while a student's stamp holds. The rest are computed with one read per
        // table (not two per student), each over only the questions that student touched: every field
        // below is keyed by their own progress/attempt rows.
        const roster = `SELECT u.id ${where} LIMIT 501`;
        const [stamp, cache] = await Promise.all([statStamps(env, (users.results || []).map(x => x.id)), statsCache()]);
        const held = (await cachedStats(cache, 'list')) || {};
        const stale = (users.results || []).filter(x => held[x.id]?.stamp !== stamp(x.id)).map(x => x.id);
        const progs = new Map(), logs = new Map(), touchedIds = new Set();
        if (stale.length) {
          const [who, args] = stale.length <= 90 ? [stale.map(() => '?').join(','), stale] : [roster, [term, term]];
          const [progress, attempts] = await Promise.all([
            env.DB.prepare(`SELECT user_id, question_id, attempts, corrects, marker, last_reviewed, time_taken_ms FROM progress WHERE user_id IN (${who})`).bind(...args).all(),
            env.DB.prepare(`SELECT user_id, question_id, ts, correct, time_taken_ms, picked, changes FROM attempts WHERE user_id IN (${who}) ORDER BY ts`).bind(...args).all()
          ]);
          for (const { user_id, ...r } of progress.results || []) { (progs.get(user_id) || progs.set(user_id, {}).get(user_id))[r.question_id] = r; touchedIds.add(r.question_id); }
          for (const { user_id, ...r } of attempts.results || []) { (logs.get(user_id) || logs.set(user_id, []).get(user_id)).push(r); touchedIds.add(r.question_id); }
        }
        const byId = new Map(stale.length ? (await statBank(env, touchedIds)).map(q => [q.id, q]) : []);
        const students = (users.results || []).map(student => {
          if (!stale.includes(student.id)) return { ...student, ...held[student.id].row };
          const prog = progs.get(student.id) || {}, log = logs.get(student.id) || [];
          const touched = [...new Set([...Object.keys(prog), ...log.map(x => x.question_id)])].map(id => byId.get(id)).filter(Boolean);
          const stats = breakdown(touched, prog, log);
          const weak = Object.entries(stats.skills).filter(([, v]) => v.a).sort((a, b) => a[1].c / a[1].a - b[1].c / b[1].a || a[0].localeCompare(b[0]))[0];
          const n = Object.values(stats.paceSection).reduce((sum, x) => sum + x.n, 0);
          const ms = Object.values(stats.paceSection).reduce((sum, x) => sum + x.ms, 0);
          const target = Object.values(stats.paceSection).reduce((sum, x) => sum + x.target, 0);
          return { ...student, done: stats.tally.att, accuracy: stats.tally.att ? Math.round(100 * stats.tally.corr / stats.tally.att) : null,
            weakest: weak?.[0] || null, avgMs: n ? ms / n : null, targetMs: n ? target / n : null,
            guessRate: stats.guessing.n ? stats.guessing.changedN / stats.guessing.n : null, lastActive: stats.lastActive };
        });
        if (stale.length) {
          for (const x of students) if (stale.includes(x.id)) { const { id, email, name, status, ...row } = x; held[id] = { stamp: settled(progs.get(id) || {}, logs.get(id) || []) ? stamp(id) : null, row }; }
          await keepStats(cache, 'list', held);
        }
        students.sort((a, b) => {
          const x = a[sort], y = b[sort];
          if (x == null || y == null) return (x == null) - (y == null) || a.id.localeCompare(b.id);
          const cmp = typeof x === 'number' && typeof y === 'number' ? x - y : String(x).localeCompare(String(y));
          return (asc ? cmp : -cmp) || a.id.localeCompare(b.id);
        });
        return json({ students: students.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE), total: students.length,
          page, pages: Math.max(1, Math.ceil(students.length / PAGE_SIZE)) });
      }
      const match = /^\/api\/admin\/students\/([^/]+)(?:\/(history))?$/.exec(p);
      if (match) {
        let id; try { id = decodeURIComponent(match[1]); } catch { return json({ error: 'invalid ID' }, 400); }
        if (!id || id.length > 128) return json({ error: 'invalid ID' }, 400);
        const student = await env.DB.prepare(`SELECT u.id, u.name, u.email, m.status FROM users u JOIN membership m ON m.user_id=u.id
          WHERE u.id=? AND u.role='student' AND m.status IN ('approved','pending')`).bind(id).first();
        if (!student) return json({ error: 'not found' }, 404);
        const page = pageOf(url); if (!page) return json({ error: 'invalid page' }, 400);
        if (match[2]) {
          const total = await env.DB.prepare('SELECT COUNT(*) AS n FROM attempts WHERE user_id = ?').bind(id).first();
          const rows = await env.DB.prepare(`SELECT question_id, ts, correct, picked, changes, time_taken_ms, answer_history_json, lesson_session_id
            FROM attempts WHERE user_id = ? ORDER BY ts DESC, id DESC LIMIT ? OFFSET ?`).bind(id, PAGE_SIZE, (page - 1) * PAGE_SIZE).all();
          return json({ results: rows.results || [], total: total.n, page, pages: Math.max(1, Math.ceil(total.n / PAGE_SIZE)) });
        }
        // Stats, directions and the Mistakes list are reused while the student's stamp holds (see statStamps).
        const [stamp, cache] = await Promise.all([statStamps(env, [id]), statsCache()]);
        const key = 'detail/' + encodeURIComponent(id);
        let held = await cachedStats(cache, key);
        if (held?.stamp !== stamp(id)) {
          const { qs, prog, log, stats, directions } = await adminData(env, id);
          const latest = new Map();
          for (const x of log) if (!latest.has(x.question_id) || x.ts >= latest.get(x.question_id).ts) latest.set(x.question_id, x);
          const wrong = qs.filter(q => ['Red', 'Orange'].includes(prog[q.id]?.marker)).map(q => ({ question_id: q.id, marker: prog[q.id].marker,
            picked: latest.get(q.id)?.picked || null, lessonSessionId: latest.get(q.id)?.lesson_session_id ? padSessionId(latest.get(q.id).lesson_session_id) : null, ai: q.ai }));
          held = { stamp: settled(prog, log) ? stamp(id) : null, stats, directions, wrong, totalHistory: log.length };
          await keepStats(cache, key, held);
        }
        // The stats read lean rows; the Mistakes tab shows whole questions, so only those are read in full.
        const { wrong } = held;
        const full = await Promise.all([byIds(env.DB, BANK_COLS, wrong.filter(q => !q.ai).map(q => q.question_id)), byIds(env.AI_DB, BANK_COLS + ', level', wrong.filter(q => q.ai).map(q => q.question_id))]);
        const byQ = [new Map(full[0].flat().map(r => [r.id, r])), new Map(full[1].flat().map(r => [r.id, r]))];
        const mistakes = wrong.map(({ ai, ...m }) => ({ ...m, question: byQ[ai ? 1 : 0].has(m.question_id) ? normalizeQuestion(byQ[ai ? 1 : 0].get(m.question_id)) : undefined }));
        // §3.2 Lessons: only self-paced sessions feed the stats above (§10).
        const lessons = (await attendedSessions(env.DB, id)).map(({ endedAt, ...x }) => ({ ...x, counted: x.mode === 'self' }));
        return json({ student, stats: held.stats, directions: held.directions, mistakes, lessons, totalHistory: held.totalHistory });
      }
      return json({ error: 'not found' }, 404);
    }
    if (restrictedAsset) return p === '/app' ? asset(env, new Request(new URL('/index.html', url), req), LESSON_CSP) : asset(env, req);

    let rows;
    if (req.method === 'POST' && ['/api/progress', '/api/attempts', '/api/notes', '/api/sessions'].includes(p)) {
      const b = await req.json().catch(() => null);
      rows = Array.isArray(b) ? b : [b];
      if (rows.length > MAX_ROWS) return json({ error: 'too many rows', limit: MAX_ROWS }, 413);
      const validID = id => typeof id === 'string' && id.trim().length > 0 && id.length <= 64;
      if (rows.some(r => !r || typeof r !== 'object' || Array.isArray(r) ||
          !validID(p === '/api/sessions' ? r.id : r.question_id) ||
           (p === '/api/attempts' && (typeof r.ts !== 'string' || !r.ts.trim() || r.ts.length > 32 || !validHistory(r))) ||
          (p === '/api/sessions' && (!r.state || typeof r.state !== 'object' || Array.isArray(r.state))))) {
        return json({ error: 'invalid row or missing ID' }, 400);
      }
      if (!rows.length) return json({ saved: 0, acknowledged: [] });
      if (p !== '/api/sessions') {
        const ids = [...new Set(rows.map(r => r.question_id))];
        const known = await env.DB.batch(ids.map(id => env.DB.prepare(
          'SELECT id FROM questions WHERE id = ? UNION SELECT id FROM ai_ids WHERE id = ?'
        ).bind(id, id)));
        const unknown = ids.filter((id, i) => !known[i].results?.length);
        if (unknown.length) return json({ error: 'unknown question IDs', unknown }, 400);
      }
    }

    if (p === '/api/questions' && req.method === 'GET') {
      // Not SELECT *: stem_text is a legacy OCR column nothing renders, and it
      // is 15% of a payload the client downloads whole.
      // Shared bank read; AI_DB failures stay 503 rather than core-only success.
      return questionsResponse(env);
    }

    if (p === '/api/account' && req.method === 'GET') {
      if (!u) return json({ error: 'unauthorized' }, 401);
      const r = await env.DB.prepare('SELECT id, email, name, created_at FROM users WHERE id = ?').bind(u.id).first();
      return json(r || {});
    }

    if (p === '/api/progress' && req.method === 'GET') {
      // Not an empty list: a rejected token that reads back as "no rows" is
      // indistinguishable from an account whose progress has been wiped.
      if (!u) return json({ error: 'unauthorized' }, 401);
      const r = await env.DB.prepare('SELECT * FROM progress WHERE user_id = ?').bind(u.id).all();
      return json(r.results || []);
    }

    if (p === '/api/progress' && req.method === 'POST') {
      if (!u) return json({ error: 'unauthorized' }, 401);
      await touchUser(env, u);
      // Only a question that exists. Without this the primary key bounds nothing:
      // question_id is whatever the client typed, so an account can write rows for
      // 500 invented ids per request, for ever.
      const results = await env.DB.batch(rows.map(r => progressStatement(env.DB, u.id, r)));
      return json({ saved: results.reduce((n, r) => n + r.meta.changes, 0),
        acknowledged: rows.filter((r, i) => results[i].meta.changes > 0) });
    }

    // The attempt log. `progress` is overwritten on every answer, so it cannot say
    // how many questions were done on a given day; these rows can. Append-only:
    // a repeat of the same (question, timestamp) is ignored rather than updated.
    if (p === '/api/attempts' && req.method === 'GET') {
      if (!u) return json({ error: 'unauthorized' }, 401);
      const r = await env.DB.prepare(
        'SELECT question_id, ts, correct, time_taken_ms, picked, changes, answer_history_json, lesson_session_id FROM attempts WHERE user_id = ? ORDER BY ts'
      ).bind(u.id).all();
      return json(r.results || []);
    }

    if (p === '/api/attempts' && req.method === 'POST') {
      if (!u) return json({ error: 'unauthorized' }, 401);
      // One count for the batch, not one per row.
      const held = await env.DB.prepare('SELECT COUNT(*) AS n FROM attempts WHERE user_id = ?')
        .bind(u.id).first();
      const existing = await env.DB.batch(rows.map(r => env.DB.prepare(
        'SELECT 1 FROM attempts WHERE user_id = ? AND question_id = ? AND ts = ?'
      ).bind(u.id, r.question_id, r.ts)));
      const added = new Set(rows.filter((r, i) => !existing[i].results.length)
        .map(r => JSON.stringify([r.question_id, r.ts]))).size;
      if ((held?.n || 0) + added > MAX_ATTEMPTS) return json({ error: 'log full' }, 429);
      const results = await env.DB.batch(rows.map(r => attemptStatement(env.DB, u.id, r)));
      const persisted = await env.DB.batch(rows.map(r => env.DB.prepare(
        'SELECT 1 FROM attempts WHERE user_id = ? AND question_id = ? AND ts = ?'
      ).bind(u.id, r.question_id, r.ts)));
      return json({ saved: results.reduce((n, r) => n + r.meta.changes, 0),
        acknowledged: rows.filter((r, i) => persisted[i].results.length > 0) });
    }

    // One note per question: why you missed it, in your own words. Same shape as
    // progress - keyed on (user, question), rewritten in place, and bounded by that
    // primary key once question_id has to name a real question.
    if (p === '/api/notes' && req.method === 'GET') {
      if (!u) return json({ error: 'unauthorized' }, 401);
      const r = await env.DB.prepare(
        'SELECT question_id, body, updated_at FROM notes WHERE user_id = ?').bind(u.id).all();
      return json(r.results || []);
    }

    if (p === '/api/notes' && req.method === 'POST') {
      if (!u) return json({ error: 'unauthorized' }, 401);
      // An emptied note is a delete, not a blank row - otherwise clearing one still
      // costs a row and the export has to filter empties back out.
      const del = env.DB.prepare('DELETE FROM notes WHERE user_id = ? AND question_id = ?');
      const put = env.DB.prepare(
        `INSERT INTO notes (user_id, question_id, body, updated_at)
           SELECT ?,?,?,datetime('now') WHERE EXISTS(SELECT 1 FROM questions WHERE id = ?)
                                            OR EXISTS(SELECT 1 FROM ai_ids   WHERE id = ?)
         ON CONFLICT(user_id, question_id) DO UPDATE SET
           body=excluded.body, updated_at=excluded.updated_at`
      );
      const results = await env.DB.batch(rows.map(r => {
        const body = str(r.body, MAX_NOTE).trim();
        const qid = str(r.question_id, 64);
        return body ? put.bind(u.id, qid, body, qid, qid) : del.bind(u.id, qid);
      }));
      return json({ saved: results.reduce((n, r) => n + r.meta.changes, 0),
        acknowledged: rows.filter((r, i) => results[i].meta.changes > 0 || !str(r.body, MAX_NOTE).trim()) });
    }

    // Preferences, one JSON blob per account, so they follow the user across
    // devices. Resolved from the token like everything else here: a client that
    // names someone else's id gets its own row, not theirs.
    if (p === '/api/settings' && req.method === 'GET') {
      // 401, not {}, for the same reason the progress and attempts reads say 401:
      // an empty object reads as "this account has no settings row yet", and the
      // client answers that by pushing its own defaults up over the account's.
      if (!u) return json({ error: 'unauthorized' }, 401);
      const r = await env.DB.prepare('SELECT json FROM settings WHERE user_id = ?').bind(u.id).first();
      let out = {};
      try { out = r && r.json ? JSON.parse(r.json) : {}; } catch (e) { out = {}; }
      return json(out);
    }

    if (p === '/api/settings' && req.method === 'POST') {
      if (!u) return json({ error: 'unauthorized' }, 401);
      const b = await req.json().catch(() => null);
      if (!b || typeof b !== 'object' || Array.isArray(b)) return json({ error: 'bad body' }, 400);
      const blob = JSON.stringify(b);
      if (blob.length > MAX_SETTINGS) return json({ error: 'too large' }, 413);
      await env.DB.prepare(
        `INSERT INTO settings (user_id, json, updated_at) VALUES (?,?,datetime('now'))
         ON CONFLICT(user_id) DO UPDATE SET json=excluded.json, updated_at=excluded.updated_at`
      ).bind(u.id, blob).run();
      return json({ ok: true });
    }

    // Sessions older than 30 days stay stored but are excluded from reads.
    if (p === '/api/sessions' && req.method === 'GET') {
      if (!u) return json({ error: 'unauthorized' }, 401);
      const r = await env.DB.prepare(
        'SELECT id, kind, state, updated_at FROM sessions WHERE user_id = ? AND updated_at >= ? ORDER BY updated_at DESC'
      ).bind(u.id, Date.now() - 30 * DAY).all();
      return json(r.results || []);
    }

    if (p === '/api/sessions' && req.method === 'POST') {
      if (!u) return json({ error: 'unauthorized' }, 401);
      const stmt = env.DB.prepare(
        `INSERT INTO sessions (user_id, id, kind, state, updated_at) VALUES (?,?,?,?,?)
         ON CONFLICT(user_id, id) DO UPDATE SET
           kind=excluded.kind, state=excluded.state, updated_at=excluded.updated_at`
      );
      const binds = [];
      for (const r of rows) {
        const st = JSON.stringify(r.state);
        if (st.length > MAX_SESSION) return json({ error: 'too large' }, 413);
        binds.push(stmt.bind(u.id, str(r.id, 64), str(r.kind, 16) || 'exam', st, Date.now()));
      }
      const results = await env.DB.batch(binds);
      return json({ saved: results.reduce((n, r) => n + r.meta.changes, 0), acknowledged: rows });
    }

    if (p.startsWith('/api/sessions/') && req.method === 'DELETE') {
      if (!u) return json({ error: 'unauthorized' }, 401);
      let id;
      try { id = decodeURIComponent(p.slice('/api/sessions/'.length)); }
      catch { return json({ error: 'invalid session ID encoding' }, 400); }
      if (!id.trim() || id.length > 64) return json({ error: 'invalid session ID' }, 400);
      await env.DB.prepare('DELETE FROM sessions WHERE user_id = ? AND id = ?')
        .bind(u.id, id).run();
      return json({ ok: true });
    }

    return json({ error: 'not found' }, 404);
}
