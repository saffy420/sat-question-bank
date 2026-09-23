const { test } = require('node:test');
const assert = require('node:assert/strict');
const { DatabaseSync } = require('node:sqlite');
const { readFileSync } = require('node:fs');
const { pathToFileURL } = require('node:url');
const vm = require('node:vm');
const root = __dirname + '/../';
const origin = 'https://roadto1600.org';
let serial = 0;

async function fixture(t, email = 'member@ccs.us', provider = 'google', method = 'oauth') {
  const db = new DatabaseSync(':memory:');
  db.exec(readFileSync(root + 'schema.sql', 'utf8'));
  db.exec("INSERT INTO questions (id) VALUES ('real'); INSERT INTO ai_ids (id) VALUES ('ai');");
  const wrap = (sql, args = []) => ({
    bind: (...values) => wrap(sql, values),
    first: async () => db.prepare(sql).get(...args) || null,
    all: async () => ({ results: db.prepare(sql).all(...args) }),
    run: async () => {
      const statement = db.prepare(sql);
      if (statement.columns().length) return { results: statement.all(...args), meta: { changes: 0 } };
      return { results: [], meta: { changes: Number(statement.run(...args).changes) } };
    }
  });
  const assets = [];
  const env = { SUPABASE_URL: 'https://auth.example', SUPABASE_ANON_KEY: 'public',
    DB: { prepare: wrap, batch: async statements => {
      db.exec('BEGIN');
      try {
        const results = [];
        for (const statement of statements) results.push(await statement.run());
        db.exec('COMMIT');
        return results;
      } catch (error) { db.exec('ROLLBACK'); throw error; }
    } },
    AI_DB: { prepare: () => ({ all: async () => ({ results: [] }) }) },
    ASSETS: { fetch: async req => {
      const p = new URL(req.url || req).pathname;
      assets.push(p);
      return new Response(req.method === 'HEAD' ? null : p, { headers: { 'Cache-Control': 'public, max-age=300' } });
    } }
  };
  const id = 'u' + ++serial;
  const token = Buffer.from('{}').toString('base64url') + '.' + Buffer.from(JSON.stringify({ exp: Math.floor(Date.now() / 1000) + 120, amr: [{ method }], sub: id })).toString('base64url') + '.signature';
  let calls = 0;
  t.mock.method(global, 'fetch', async (url, options) => {
    calls++;
    assert.equal(url, env.SUPABASE_URL + '/auth/v1/user');
    assert.equal(options.headers.Authorization, 'Bearer ' + token);
    return Response.json({ id, email, email_confirmed_at: '2026-01-01', app_metadata: { provider }, identities: [{ provider }] });
  });
  const worker = (await import(pathToFileURL(root + 'src/index.js'))).default;
  const request = (path, options = {}) => worker.fetch(new Request(origin + path, options), env);
  const auth = { Authorization: 'Bearer ' + token, Origin: origin };
  t.after(() => db.close());
  return { db, env, assets, id, token, request, auth, calls: () => calls };
}

test('public routes and aliases never serve app; private paths require auth', async t => {
  const f = await fixture(t);
  for (const [path, target] of Object.entries({ '/': '/landing.html', '/login': '/login.html', '/privacy': '/privacy.html', '/terms': '/terms.html', '/auth/callback': '/login.html', '/auth.js': '/auth.js', '/favicon.svg': '/favicon.svg', '/robots.txt': '/robots.txt', '/site.css': '/site.css', '/site.js': '/site.js' })) {
    const res = await f.request(path);
    assert.equal(res.status, 200);
    assert.equal(await res.text(), target);
  }
  for (const [path, target] of Object.entries({ '/index.html': '/app', '/landing.html': '/', '/login.html': '/login', '/privacy.html': '/privacy', '/terms.html': '/terms', '/app/': '/app' })) {
    assert.equal((await f.request(path)).headers.get('Location'), target);
  }
  assert.equal((await f.request('/app')).headers.get('Location'), '/login');
  for (const path of ['/api/questions', '/api/notes', '/exams.json', '/qimg/a.png']) assert.equal((await f.request(path)).status, 401);
  for (const path of ['/index', '/index.html/', '/%69ndex.html', '/login.html/', '/_headers', '/other.js', '/api/missing', '/api']) assert.equal((await f.request(path)).status, 404);
  assert.equal((await f.request('/api/questions', { method: 'POST', headers: { Origin: origin } })).status, 404);
  assert.equal(f.calls(), 0);
  assert.ok(!f.assets.includes('/index.html'));
});

test('validated school session creates approval and bounded secure cookie; cached identity still checks denial', async t => {
  const f = await fixture(t, 'Member@CCS.US');
  const res = await f.request('/api/auth/session', { method: 'POST', headers: f.auth });
  assert.equal(res.status, 200);
  assert.equal((await res.json()).status, 'approved');
  assert.equal(f.calls(), 1);
  const cookie = res.headers.get('Set-Cookie');
  assert.match(cookie, /; Path=\/; HttpOnly; Secure; SameSite=Lax; Max-Age=\d+$/);
  const age = Number(cookie.match(/Max-Age=(\d+)/)[1]);
  assert.ok(age > 0 && age <= 120);
  for (const path of ['/app', '/qimg/a.png', '/exams.json', '/api/questions']) {
    const response = await f.request(path, { headers: { Cookie: cookie.split(';')[0] } });
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('Cache-Control'), 'private, no-store');
    assert.equal(response.headers.get('X-Robots-Tag'), 'noindex, nofollow');
  }
  f.db.prepare("UPDATE membership SET status='denied', reviewed_at='reviewed' WHERE user_id=?").run(f.id);
  for (const path of ['/qimg/a.png', '/exams.json', '/api/questions', '/api/notes']) assert.equal((await f.request(path, { headers: f.auth })).status, 403);
  assert.equal((await f.request('/app', { headers: f.auth })).headers.get('Location'), '/login?denied=1');
  assert.equal((await f.request('/api/auth/session', { method: 'POST', headers: f.auth })).status, 403);
  assert.equal(f.db.prepare('SELECT reviewed_at FROM membership').get().reviewed_at, 'reviewed');
  assert.equal(f.calls(), 1);
});

test('only exact school domain auto-approves; existing reviews survive repeated Google sign-in', async t => {
  for (const [email, expected] of [
    ['member@ccs.us', 'approved'], ['Member@CCS.US', 'approved'],
    ['member@gmail.com', 'pending'], ['member@example.org', 'pending'],
    ['member@students.ccs.us', 'pending'], ['member@ccs.us.attacker.test', 'pending'],
    ['member@fakeccs.us', 'pending'], ['ccs.us@gmail.com', 'pending'],
    ['member@ccs.us.com', 'pending']
  ]) await t.test(email, async sub => {
    const f = await fixture(sub, email);
    const response = await f.request('/api/auth/session', { method: 'POST', headers: f.auth });
    assert.equal(response.status, 200);
    assert.equal((await response.json()).status, expected);
    assert.equal(f.db.prepare('SELECT status FROM membership WHERE user_id=?').get(f.id).status, expected);
    assert.equal((await f.request('/api/questions', { headers: f.auth })).status, 200);
    for (const status of ['approved', 'pending', 'denied']) {
      f.db.prepare('UPDATE membership SET status=?, reviewed_at=? WHERE user_id=?').run(status, 'admin-review', f.id);
      const before = f.db.prepare('SELECT * FROM membership WHERE user_id=?').get(f.id);
      for (let attempt = 0; attempt < 2; attempt++) {
        const reviewed = await f.request('/api/auth/session', { method: 'POST', headers: f.auth });
        assert.equal(reviewed.status, status === 'denied' ? 403 : 200);
        if (status !== 'denied') assert.equal((await reviewed.json()).status, status);
        assert.deepEqual(f.db.prepare('SELECT * FROM membership WHERE user_id=?').get(f.id), before);
      }
    }
  });
});

test('non-Google identities and password sessions rejected', async t => {
  for (const [provider, method] of [['email', 'password'], ['google', 'password'], ['github', 'oauth']]) {
    await t.test(provider + method, async sub => {
      const f = await fixture(sub, 'member@ccs.us', provider, method);
      assert.equal((await f.request('/api/auth/session', { method: 'POST', headers: f.auth })).status, 401);
      assert.equal(f.db.prepare('SELECT count(*) n FROM membership').get().n, 0);
    });
  }
});

test('forged and expired tokens rejected; outages fail closed', async t => {
  const f = await fixture(t);
  for (const token of ['garbage', 'e30.' + Buffer.from('{"exp":1}').toString('base64url') + '.x']) {
    assert.equal((await f.request('/api/questions', { headers: { Authorization: 'Bearer ' + token } })).status, 401);
  }
  assert.equal(f.calls(), 0);
  global.fetch = async () => new Response(null, { status: 401 });
  assert.equal((await f.request('/api/questions', { headers: f.auth })).status, 401);
  global.fetch = async () => { throw new Error('network'); };
  assert.equal((await f.request('/api/questions', { headers: f.auth })).status, 503);
});

test('all mutations require same origin; bootstrap requires bearer; logout clears cookie', async t => {
  const f = await fixture(t);
  for (const path of ['/api/auth/session', '/api/auth/logout', '/api/progress', '/api/notes', '/api/settings', '/api/attempts', '/api/sessions']) {
    for (const headers of [{}, { Origin: 'https://evil.example' }, { Origin: 'null' }, { Origin: origin, 'Sec-Fetch-Site': 'cross-site' }]) {
      assert.equal((await f.request(path, { method: 'POST', headers: { Authorization: 'Bearer ' + f.token, ...headers } })).status, 403);
    }
  }
  assert.equal((await f.request('/api/auth/session', { method: 'POST', headers: { Origin: origin, Cookie: '__Host-sat_session=' + f.token } })).status, 401);
  const logout = await f.request('/api/auth/logout', { method: 'POST', headers: { Origin: origin } });
  assert.equal(logout.status, 200);
  assert.match(logout.headers.get('Set-Cookie'), /Max-Age=0$/);
});

test('real Worker SQL keeps reads and writes owner-scoped', async t => {
  const f = await fixture(t);
  f.db.exec("INSERT INTO notes VALUES ('other','real','private','now'); INSERT INTO settings VALUES ('other','{\"private\":true}','now');");
  assert.equal((await f.request('/api/auth/session', { method: 'POST', headers: f.auth })).status, 200);
  const post = (path, body) => f.request(path, { method: 'POST', headers: f.auth, body: JSON.stringify(body) });
  for (const question_id of ['real', 'ai', 'fake']) {
    const expected = question_id === 'fake' ? 400 : 200;
    assert.equal((await post('/api/notes', { user_id: 'other', question_id, body: 'mine' })).status, expected);
    assert.equal((await post('/api/progress', { user_id: 'other', question_id, attempts: 1 })).status, expected);
    assert.equal((await post('/api/attempts', { user_id: 'other', question_id, ts: 'now' })).status, expected);
  }
  for (const table of ['notes', 'progress', 'attempts']) {
    const rows = await (await f.request('/api/' + table, { headers: f.auth })).json();
    assert.equal(rows.length, 2);
    assert.ok(rows.every(row => row.question_id !== 'fake'));
  }
  assert.equal(f.db.prepare("SELECT body FROM notes WHERE user_id='other'").get().body, 'private');
  assert.deepEqual(await (await f.request('/api/settings', { headers: f.auth })).json(), {});
});

test('save acknowledgements count changes, retain input rows and reject whole invalid batches', async t => {
  const f = await fixture(t);
  await f.request('/api/auth/session', { method: 'POST', headers: f.auth });
  const post = (table, rows) => f.request('/api/' + table, { method: 'POST', headers: f.auth, body: JSON.stringify(rows) });
  for (const table of ['progress', 'attempts', 'notes', 'sessions']) {
    const row = table === 'sessions' ? { id: 'session', state: { answer: 1 } } :
      { question_id: 'real', ts: 'now', body: 'note', attempts: 1 };
    const res = await post(table, [row]);
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), { saved: 1, acknowledged: [row] });
    assert.deepEqual(await (await post(table, [])).json(), { saved: 0, acknowledged: [] });
    for (const bad of [null, {}, { ...row, [table === 'sessions' ? 'id' : 'question_id']: 'x'.repeat(65) }]) {
      assert.equal((await post(table, [row, bad])).status, 400);
    }
    assert.equal((await post(table, Array(501).fill(row))).status, 413);
    if (table !== 'sessions') {
      const invalid = await post(table, [{ ...row, question_id: 'ai' }, { ...row, question_id: 'unknown' }]);
      assert.equal(invalid.status, 400);
      assert.deepEqual((await invalid.json()).unknown, ['unknown']);
      assert.equal(f.db.prepare(`SELECT COUNT(*) n FROM ${table} WHERE question_id='ai'`).get().n, 0);
    }
  }
  const retry = { question_id: 'real', ts: 'now', body: 'note', attempts: 1 };
  assert.deepEqual(await (await post('attempts', [retry, retry])).json(), { saved: 0, acknowledged: [retry, retry] });
  const cleared = { question_id: 'real', body: '' };
  assert.deepEqual(await (await post('notes', cleared)).json(), { saved: 1, acknowledged: [cleared] });
  assert.deepEqual(await (await post('notes', cleared)).json(), { saved: 0, acknowledged: [cleared] });
  const rows = Array.from({ length: 200 }, (_, i) => ({ id: 'batch' + i, state: { i } }));
  assert.deepEqual(await (await post('sessions', rows)).json(), { saved: 200, acknowledged: rows });
  assert.equal(f.db.prepare('SELECT COUNT(*) n FROM sessions').get().n, 201);
  assert.equal((await post('sessions', [{ id: 'not-written', state: {} }, { id: 'huge', state: { text: 'x'.repeat(65536) } }])).status, 413);
  assert.equal(f.db.prepare("SELECT COUNT(*) n FROM sessions WHERE id='not-written'").get().n, 0);
  f.db.exec("CREATE TRIGGER fail_note BEFORE INSERT ON notes WHEN NEW.question_id='ai' BEGIN SELECT RAISE(ABORT, 'write failure'); END;");
  assert.equal((await post('notes', [{ question_id: 'real', body: 'rollback' }, { question_id: 'ai', body: 'fail' }])).status, 503);
  assert.equal(f.db.prepare('SELECT COUNT(*) n FROM notes').get().n, 0);
});

test('attempt retries remain acknowledged at capacity; new attempts rejected', async t => {
  const f = await fixture(t);
  await f.request('/api/auth/session', { method: 'POST', headers: f.auth });
  f.db.prepare(`WITH RECURSIVE n(x) AS (SELECT 1 UNION ALL SELECT x+1 FROM n WHERE x<100000)
    INSERT INTO attempts (user_id, question_id, ts, correct, time_taken_ms)
    SELECT ?, 'real', CAST(x AS TEXT), 1, 0 FROM n`).run(f.id);
  const row = { question_id: 'real', ts: '1', correct: true };
  const post = rows => f.request('/api/attempts', { method: 'POST', headers: f.auth, body: JSON.stringify(rows) });
  assert.deepEqual(await (await post([row])).json(), { saved: 0, acknowledged: [row] });
  assert.equal((await post([row, { ...row, ts: 'new' }])).status, 429);
  assert.equal(f.db.prepare('SELECT COUNT(*) n FROM attempts').get().n, 100000);
});

test('logout clears cookie but does not promise access-token revocation', async t => {
  const f = await fixture(t);
  await f.request('/api/auth/session', { method: 'POST', headers: f.auth });
  const logout = await f.request('/api/auth/logout', { method: 'POST', headers: f.auth });
  assert.match(logout.headers.get('Set-Cookie'), /Max-Age=0$/);
  assert.equal((await f.request('/api/account', { headers: f.auth })).status, 200);
  assert.equal(f.calls(), 1);
  f.db.exec("UPDATE membership SET status='denied'");
  assert.equal((await f.request('/api/account', { headers: f.auth })).status, 403);
});

test('reads never write, missing membership fails closed, expired sessions remain stored', async t => {
  const f = await fixture(t);
  assert.equal((await f.request('/api/account', { headers: f.auth })).status, 403);
  assert.equal(f.db.prepare('SELECT COUNT(*) n FROM membership').get().n, 0);
  await f.request('/api/auth/session', { method: 'POST', headers: f.auth });
  f.db.prepare('INSERT INTO sessions VALUES (?,?,?,?,?)').run(f.id, 'old', 'exam', '{}', 0);
  f.db.exec('PRAGMA query_only=ON');
  for (const path of ['account', 'progress', 'attempts', 'notes', 'settings', 'sessions', 'questions']) {
    const res = await f.request('/api/' + path, { headers: f.auth });
    assert.equal(res.status, 200, path);
    assert.equal(res.headers.get('Cache-Control'), 'private, no-store');
    if (path === 'sessions') assert.deepEqual(await res.json(), []);
  }
  assert.equal(f.db.prepare('SELECT COUNT(*) n FROM sessions').get().n, 1);
});

test('AI failures differ from empty bank; deletion decodes exactly once and remains owner scoped', async t => {
  const f = await fixture(t);
  await f.request('/api/auth/session', { method: 'POST', headers: f.auth });
  assert.equal((await f.request('/api/questions', { headers: f.auth })).status, 200);
  f.env.AI_DB.prepare = () => ({ all: async () => { throw new Error('missing schema'); } });
  assert.equal((await f.request('/api/questions', { headers: f.auth })).status, 503);
  delete f.env.AI_DB;
  assert.equal((await f.request('/api/questions', { headers: f.auth })).status, 503);
  for (const id of ['space / unicode 雪', 'literal%2F']) {
    for (const user of [f.id, 'other']) f.db.prepare('INSERT INTO sessions VALUES (?,?,?,?,?)').run(user, id, 'exam', '{}', Date.now());
    const res = await f.request('/api/sessions/' + encodeURIComponent(id), { method: 'DELETE', headers: f.auth });
    assert.equal(res.status, 200);
    assert.equal(f.db.prepare('SELECT COUNT(*) n FROM sessions WHERE user_id=? AND id=?').get(f.id, id).n, 0);
    assert.equal(f.db.prepare('SELECT COUNT(*) n FROM sessions WHERE user_id=? AND id=?').get('other', id).n, 1);
  }
  assert.equal((await f.request('/api/sessions/%ZZ', { method: 'DELETE', headers: f.auth })).status, 400);
});

test('database and asset failures fail closed with private headers', async t => {
  const f = await fixture(t);
  f.env.DB.prepare = () => { throw new Error('database'); };
  const res = await f.request('/api/questions', { headers: f.auth });
  assert.equal(res.status, 503);
  assert.equal(res.headers.get('Cache-Control'), 'private, no-store');
  f.env.ASSETS.fetch = async () => { throw new Error('assets'); };
  assert.equal((await f.request('/login')).status, 503);
});

test('actual Google button sends no hosted-domain restriction and bootstraps callback before navigation', async () => {
  const elements = Object.fromEntries(['google-signin', 'auth-error', 'auth-status'].map(id => [id, {}]));
  let event, oauth, bootstrap, destination;
  const tasks = [];
  const session = { access_token: 'validated-by-server' };
  const ctx = {
    document: { getElementById: id => elements[id] }, URLSearchParams,
    location: { origin, hash: '', search: '', replace: path => { destination = path; } },
    history: { replaceState() {} }, setTimeout: fn => tasks.push(fn),
    fetch: async (path, options) => { bootstrap = { path, options }; return { ok: true }; },
    window: { supabase: { createClient: () => ({ auth: {
      getSession: async () => ({ data: { session: null } }),
      onAuthStateChange: fn => { event = fn; },
      signInWithOAuth: async options => { oauth = options; return {}; },
      signOut: async () => ({})
    } }) } }
  };
  vm.runInNewContext(readFileSync(root + 'public/auth.js', 'utf8'), ctx);
  await elements['google-signin'].onclick();
  assert.equal(oauth.provider, 'google');
  assert.equal(Object.hasOwn(oauth.options.queryParams, 'hd'), false);
  assert.deepEqual({ ...oauth.options.queryParams }, { prompt: 'select_account' });
  assert.equal(oauth.options.redirectTo, origin + '/auth/callback');
  event('SIGNED_IN', session);
  assert.equal(destination, undefined);
  await tasks.shift()();
  assert.equal(bootstrap.path, '/api/auth/session');
  assert.equal(bootstrap.options.headers.Authorization, 'Bearer ' + session.access_token);
  assert.equal(destination, '/app');
});

test('linked email Google OAuth accepted, linked password and ambiguous OAuth rejected', async t => {
  for (const [method, providers, expected] of [
    ['oauth', ['email', 'google'], 200], ['password', ['email', 'google'], 401],
    ['oauth', ['email', 'google', 'github'], 401]
  ]) await t.test(method + providers.join(','), async sub => {
    const f = await fixture(sub, 'member@ccs.us', 'email', method);
    global.fetch = async () => Response.json({ id: f.id, email: 'member@ccs.us', email_confirmed_at: 'now',
      app_metadata: { provider: 'email' }, identities: providers.map(provider => ({ provider })) });
    assert.equal((await f.request('/api/auth/session', { method: 'POST', headers: f.auth })).status, expected);
  });
});

test('Supabase upstream errors remain transient', async t => {
  const f = await fixture(t);
  for (const status of [429, 500, 503]) {
    global.fetch = async () => new Response(null, { status });
    assert.equal((await f.request('/api/auth/session', { method: 'POST', headers: f.auth })).status, 503);
  }
});

test('session retry preserves work; logout waits for bootstrap and blocks refresh', async () => {
  const page = readFileSync(root + 'public/index.html', 'utf8');
  const block = page.slice(page.indexOf('let bootstrapTail ='), page.indexOf('function applySession(session)'));
  const requests = [], warnings = [], timers = [], alerts = [];
  let resolveBootstrap, failLogout = false, sdkError = false, clears = 0;
  const ctx = vm.createContext({
    Promise, fetch: async path => {
      requests.push(path);
      if (path.endsWith('/session')) return new Promise(resolve => { resolveBootstrap = resolve; });
      return { ok: !failLogout };
    },
    warnSync: message => warnings.push(message), setTimeout: fn => { timers.push(fn); return timers.length; }, clearTimeout() {},
    leaveAccount: denied => { clears++; ctx.denied = denied; }, clearAccount: () => { clears++; },
    alert: message => alerts.push(message), location: { replace: path => { ctx.destination = path; } },
    sb: { auth: { signOut: async () => ({ error: sdkError ? new Error('offline') : null }) } }
  });
  vm.runInContext(block, ctx);
  const start = () => vm.runInContext("bootstrapSession({access_token:'token'})", ctx);
  const first = start(); await Promise.resolve();
  resolveBootstrap({ ok: false, status: 503 });
  assert.equal(await first, false);
  assert.equal(clears, 0);
  assert.equal(warnings.length, 1);
  const savedFetch = ctx.fetch;
  ctx.fetch = async () => { throw new Error('offline'); };
  assert.equal(await start(), false);
  assert.equal(clears, 0);
  ctx.fetch = savedFetch;
  const second = start(); await Promise.resolve();
  const logout = vm.runInContext('signOut()', ctx);
  const queued = start();
  assert.equal(requests.filter(p => p.endsWith('/logout')).length, 0);
  resolveBootstrap({ ok: true, status: 200 });
  await logout; await second; await queued;
  assert.deepEqual(requests, ['/api/auth/session', '/api/auth/session', '/api/auth/logout']);
  assert.equal(ctx.destination, '/login');
  assert.equal(await start(), false);

  vm.runInContext('loggingOut = false', ctx);
  ctx.destination = undefined; failLogout = true;
  await vm.runInContext('signOut()', ctx);
  assert.equal(ctx.destination, undefined);
  assert.match(alerts.at(-1), /incomplete/);
  failLogout = false; sdkError = true;
  await vm.runInContext('signOut()', ctx);
  assert.equal(ctx.destination, undefined);
  sdkError = false;
  await vm.runInContext('signOut()', ctx);
  assert.equal(ctx.destination, '/login');
  assert.match(page, /href="\/terms"/);
  assert.match(page, /href="\/privacy"/);
  assert.match(page, /const LEGAL_CONTACT = 'chakrabortyleon@gmail.com'/);
  assert.doesNotMatch(page, /An account is optional|aggregate traffic analytics/);
});

test('migration repeat-safe with constrained status', () => {
  const db = new DatabaseSync(':memory:');
  const migration = readFileSync(root + 'migrations/0006_membership.sql', 'utf8');
  db.exec(migration); db.exec(migration);
  assert.throws(() => db.exec("INSERT INTO membership(user_id,email,status) VALUES ('u','e','unknown')"));
  db.close();
});

test('client clears account data, rejects switched tokens, and gates startup', async () => {
  const page = readFileSync(root + 'public/index.html', 'utf8');
  const auth = page.slice(page.indexOf('async function sbHeaders()'), page.indexOf('async function initAuth()'));
  const ctx = vm.createContext({
    uid: 'old', authToken: 'old-token', PROG: { private: 1 }, LOG: [1], NOTES: { private: 'note' }, SESS: { private: 1 }, S: {},
    retryTimer: 1, sessT: 2, sessGet: () => {}, queueOwner: 'old', inflight: {}, PENDING: { '/api/notes': [{ body: 'private' }] }, SET: {}, SET_DEFAULTS: {},
    clearTimeout() {}, localStorage: { removeItem() {} }, document: { body: {} }, location: { replace(path) { ctx.destination = path; } },
    sb: { auth: { getSession: async () => ({ data: { session: { user: { id: 'new' }, access_token: 'new-token' } } }) } }
  });
  vm.runInContext(page.slice(page.indexOf('function resetPending('), page.indexOf('function saveProgress(')) + auth, ctx);
  await assert.rejects(vm.runInContext('sbHeaders()', ctx), /Account changed/);
  assert.equal(ctx.destination, '/login');
  assert.equal(Object.keys(ctx.NOTES).length, 0);
  assert.equal(ctx.PENDING['/api/notes'].length, 0);
  assert.equal(ctx.authToken, null);
  assert.equal(ctx.document.body.hidden, true);
  assert.match(page, /if \(!await initAuth\(\)\) return;\s+await load\(\)/);
  assert.doesNotMatch(page, /signInWithPassword|signUp\(|Continue as guest/);
  const config = readFileSync(root + 'wrangler.toml', 'utf8');
  assert.match(config, /run_worker_first = true/);
  assert.match(config, /html_handling = "none"/);
  for (const script of page.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g)) new vm.Script(script[1]);
  const worker = readFileSync(root + 'src/index.js', 'utf8');
  const headers = readFileSync(root + 'public/_headers', 'utf8');
  assert.doesNotMatch(worker + headers, /static\.cloudflareinsights\.com/);
  const csp = vm.runInNewContext(worker.slice(worker.indexOf('const CSP ='), worker.indexOf('const harden =')) + '\nCSP');
  assert.equal(headers.match(/Content-Security-Policy: (.*)/)[1].trim(), csp);
  for (const file of ['public/index.html', 'public/404.html']) assert.match(readFileSync(root + file, 'utf8'), /name="robots" content="noindex, nofollow"/);
});
