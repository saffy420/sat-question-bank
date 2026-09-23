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

const harden = (h) => {
  h.set('Content-Security-Policy', CSP);
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
const asset = async (env, req) => {
  let r = await env.ASSETS.fetch(req);
  if (r.status === 404) {
    const page = await env.ASSETS.fetch(new URL('/404.html', req.url));
    if (page.ok) r = new Response(page.body, { status: 404, headers: page.headers });
  }
  return new Response(r.body, {
    status: r.status,
    statusText: r.statusText,
    headers: harden(new Headers(r.headers))
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
const str = (v, n) => (typeof v === 'string' ? v.slice(0, n) : '');

export default {
  async fetch(req, env) {
    try {
      return await handleRequest(req, env);
    } catch {
      return json({ error: 'service unavailable' }, 503);
    }
  }
};

async function handleRequest(req, env) {
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
    const aliases = { '/landing.html': '/', '/login.html': '/login', '/privacy.html': '/privacy', '/terms.html': '/terms', '/index.html': '/app', '/app/': '/app' };
    const redirect = (to) => new Response(null, { status: 302, headers: harden(new Headers({ Location: to })) });
    if (['GET', 'HEAD'].includes(req.method)) {
      if (Object.hasOwn(aliases, p)) return redirect(aliases[p]);
      if (Object.hasOwn(pages, p)) return asset(env, new Request(new URL(pages[p], url), req));
      if (['/site.css', '/site.js', '/auth.js', '/favicon.svg', '/robots.txt'].includes(p)) return asset(env, req);
    }
    if (p === '/api/auth/logout' && req.method === 'POST') {
      const res = json({ ok: true });
      res.headers.set('Set-Cookie', sessionCookie());
      return res;
    }
    const apiMethods = {
      '/api/auth/session': ['POST'], '/api/questions': ['GET'], '/api/account': ['GET'],
      '/api/progress': ['GET', 'POST'], '/api/attempts': ['GET', 'POST'],
      '/api/notes': ['GET', 'POST'], '/api/settings': ['GET', 'POST'], '/api/sessions': ['GET', 'POST']
    };
    const isAPI = p === '/api' || p.startsWith('/api/');
    const knownAPI = apiMethods[p]?.includes(req.method) ||
      (/^\/api\/sessions\/[^/]+$/.test(p) && req.method === 'DELETE');
    if (isAPI && !knownAPI) return json({ error: 'not found' }, 404);
    const restrictedAsset = ['GET', 'HEAD'].includes(req.method) &&
      (p === '/app' || p === '/exams.json' || /^\/qimg\/[^/]+\.(?:png|jpg|jpeg|webp|svg)$/i.test(p));
    if (!knownAPI && !restrictedAsset) {
      const res = await asset(env, new Request(new URL('/404.html', url), { method: req.method === 'HEAD' ? 'HEAD' : 'GET' }));
      return new Response(res.body, { status: 404, headers: res.headers });
    }
    let u;
    try {
      if (p === '/api/auth/session' && !req.headers.has('Authorization')) return json({ error: 'bearer required' }, 401);
      u = await whoami(req, env);
      if (!u) {
        if (p === '/app') return redirect('/login');
        return json({ error: 'unauthorized' }, 401);
      }
      let membership = await env.DB.prepare('SELECT status FROM membership WHERE user_id = ?').bind(u.id).first();
      if (!membership && p === '/api/auth/session') {
        const status = u.email.toLowerCase().endsWith('@ccs.us') ? 'approved' : 'pending';
        await env.DB.prepare('INSERT INTO membership (user_id, email, status) VALUES (?, ?, ?) ON CONFLICT(user_id) DO NOTHING')
          .bind(u.id, u.email, status).run();
        membership = await env.DB.prepare('SELECT status FROM membership WHERE user_id = ?').bind(u.id).first();
      }
      if (!['approved', 'pending'].includes(membership?.status)) {
        const res = p === '/app' ? redirect('/login?denied=1') : json({ error: 'membership denied' }, 403);
        res.headers.set('Set-Cookie', sessionCookie());
        return res;
      }
      if (p === '/api/auth/session') {
        const res = json({ user_id: u.id, status: membership.status });
        res.headers.set('Set-Cookie', sessionCookie(tokenOf(req)));
        return res;
      }
    } catch {
      return json({ error: 'authentication unavailable' }, 503);
    }
    if (restrictedAsset) return asset(env, p === '/app' ? new Request(new URL('/index.html', url), req) : req);

    let rows;
    if (req.method === 'POST' && ['/api/progress', '/api/attempts', '/api/notes', '/api/sessions'].includes(p)) {
      const b = await req.json().catch(() => null);
      rows = Array.isArray(b) ? b : [b];
      if (rows.length > MAX_ROWS) return json({ error: 'too many rows', limit: MAX_ROWS }, 413);
      const validID = id => typeof id === 'string' && id.trim().length > 0 && id.length <= 64;
      if (rows.some(r => !r || typeof r !== 'object' || Array.isArray(r) ||
          !validID(p === '/api/sessions' ? r.id : r.question_id) ||
          (p === '/api/attempts' && (typeof r.ts !== 'string' || !r.ts.trim() || r.ts.length > 32)) ||
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
      const cols = 'id, external_id, section, domain, difficulty, skill, stem_html,' +
        ' choices_json, correct_answer, explanation_html, source, source_page, has_figure';
      // The AI bank is a second D1 database, and D1 cannot join across one, so the
      // two banks are concatenated here rather than in SQL. `level` exists only there;
      // the client derives a level for the official rows from their difficulty.
      const [core, ai] = await Promise.all([
        env.DB.prepare(`SELECT ${cols} FROM questions`).all(),
        env.AI_DB.prepare(`SELECT ${cols}, level FROM questions`).all()
      ]);
      const r = { results: [...(core.results || []), ...(ai.results || [])] };
      return json(r.results || []);
    }

    if (p === '/api/account' && req.method === 'GET') {
      if (!u) return json({ error: 'unauthorized' }, 401);
      const r = await env.DB.prepare('SELECT * FROM users WHERE id = ?').bind(u.id).first();
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
      const stmt = env.DB.prepare(
        `INSERT INTO progress
           SELECT ?,?,?,?,?,?,?,? WHERE EXISTS(SELECT 1 FROM questions WHERE id = ?)
                                     OR EXISTS(SELECT 1 FROM ai_ids   WHERE id = ?)
         ON CONFLICT(user_id, question_id) DO UPDATE SET
           attempts=excluded.attempts, corrects=excluded.corrects, marker=excluded.marker,
           last_reviewed=excluded.last_reviewed, time_taken_ms=excluded.time_taken_ms,
           stars=MAX(progress.stars, excluded.stars)`
      );
      const results = await env.DB.batch(rows.map(r => stmt.bind(
        u.id, str(r.question_id, 64), r.attempts | 0, r.corrects | 0,
        str(r.marker, 16) || 'Red', str(r.last_reviewed, 32) || null,
        r.time_taken_ms | 0, r.stars | 0, str(r.question_id, 64), str(r.question_id, 64))));
      return json({ saved: results.reduce((n, r) => n + r.meta.changes, 0),
        acknowledged: rows.filter((r, i) => results[i].meta.changes > 0) });
    }

    // The attempt log. `progress` is overwritten on every answer, so it cannot say
    // how many questions were done on a given day; these rows can. Append-only:
    // a repeat of the same (question, timestamp) is ignored rather than updated.
    if (p === '/api/attempts' && req.method === 'GET') {
      if (!u) return json({ error: 'unauthorized' }, 401);
      const r = await env.DB.prepare(
        'SELECT question_id, ts, correct, time_taken_ms, picked, changes FROM attempts WHERE user_id = ? ORDER BY ts'
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
      const stmt = env.DB.prepare(
        `INSERT OR IGNORE INTO attempts
           (user_id, question_id, ts, correct, time_taken_ms, picked, changes)
         SELECT ?,?,?,?,?,?,? WHERE EXISTS(SELECT 1 FROM questions WHERE id = ?)
                                 OR EXISTS(SELECT 1 FROM ai_ids   WHERE id = ?)`
      );
      const results = await env.DB.batch(rows.map(r => stmt.bind(
        u.id, str(r.question_id, 64), str(r.ts, 32), r.correct ? 1 : 0, r.time_taken_ms | 0,
        str(r.picked, 32) || null, r.changes | 0,
        str(r.question_id, 64), str(r.question_id, 64))));
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
