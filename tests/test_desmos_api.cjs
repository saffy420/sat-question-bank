// Community Desmos solutions: GET /api/desmos/:id and the has_desmos flag in /api/questions.
//   node --test tests/test_desmos_api.cjs
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { DatabaseSync } = require('node:sqlite');
const { readFileSync } = require('node:fs');
const { pathToFileURL } = require('node:url');
const root = __dirname + '/../';
const origin = 'https://roadto1600.org';
const STATE = { version: 11, expressions: { list: [{ type: 'expression', id: '1', latex: 'y=2x+3' }] } };
let serial = 0;

async function fixture(t, { status = 'approved' } = {}) {
  const db = new DatabaseSync(':memory:');
  db.exec(readFileSync(root + 'schema.sql', 'utf8'));
  db.exec("INSERT INTO questions (id, section, choices_json) VALUES ('q1', 'Math', '[]'), ('q2', 'Math', '[]')");
  db.prepare("INSERT INTO desmos_solutions (question_id, state_json, credit_name, imported_at) VALUES ('q1', ?, 'Ada', datetime('now'))").run(JSON.stringify(STATE));
  let reads = 0, broken = false;
  const wrap = (sql, args = []) => ({
    bind: (...values) => wrap(sql, values),
    first: async () => { if (broken && /desmos_solutions/.test(sql)) throw Error('D1 down'); if (/desmos_solutions WHERE/.test(sql)) reads++; return db.prepare(sql).get(...args) || null; },
    all: async () => ({ results: db.prepare(sql).all(...args) }),
    run: async () => ({ results: [], meta: { changes: Number(db.prepare(sql).run(...args).changes) } })
  });
  const env = { SUPABASE_URL: 'https://auth.example', SUPABASE_ANON_KEY: 'public', DESMOS_API_KEY: 'desmos-key',
    DB: { prepare: wrap, batch: async statements => { const out = []; for (const s of statements) out.push(await s.run()); return out; } },
    AI_DB: { prepare: () => ({ all: async () => ({ results: [{ id: 'ai_m001', section: 'Math', source: 'AI', choices_json: '[]', level: 4 }] }) }) },
    ASSETS: { fetch: async req => new Response(new URL(req.url || req).pathname) } };
  const users = {};
  const token = id => {
    const tok = Buffer.from('{}').toString('base64url') + '.' + Buffer.from(JSON.stringify({ exp: Math.floor(Date.now() / 1000) + 120, amr: [{ method: 'oauth' }], sub: id })).toString('base64url') + '.sig' + id;
    users[tok] = id;
    db.prepare('INSERT OR IGNORE INTO membership (user_id, email, status) VALUES (?, ?, ?)').run(id, id + '@ccs.us', status);
    return { Authorization: 'Bearer ' + tok };
  };
  t.mock.method(global, 'fetch', async (url, options) => {
    const id = users[options.headers.Authorization.slice(7)];
    return id ? Response.json({ id, email: id + '@ccs.us', email_confirmed_at: '2026-01-01', app_metadata: { provider: 'google' }, identities: [{ provider: 'google' }] })
      : new Response('{}', { status: 401 });
  });
  const worker = (await import(pathToFileURL(root + 'src/index.js'))).default;
  const request = (path, options = {}) => worker.fetch(new Request(origin + path, options), env);
  t.after(() => db.close());
  return { db, env, request, auth: token('desmos' + ++serial), reads: () => reads, breakDb: () => { broken = true; } };
}

test('a signed-in member gets the stored state and credit, plus the Desmos key', async t => {
  const f = await fixture(t);
  const res = await f.request('/api/desmos/q1', { headers: f.auth });
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('Cache-Control'), 'private, no-store');
  const body = await res.json();
  assert.deepEqual(JSON.parse(body.state_json), STATE);
  assert.equal(body.credit_name, 'Ada');
  assert.equal(body.desmosKey, 'desmos-key');
});

test('no solution is a 404, a malformed id a 400, and neither touches another question', async t => {
  const f = await fixture(t);
  assert.equal((await f.request('/api/desmos/q2', { headers: f.auth })).status, 404);
  assert.equal((await f.request('/api/desmos/nope', { headers: f.auth })).status, 404);
  assert.equal((await f.request('/api/desmos/%E0%A4%A', { headers: f.auth })).status, 400);
  assert.equal((await f.request('/api/desmos/' + encodeURIComponent("q1' OR '1'='1"), { headers: f.auth })).status, 400);
  assert.equal((await f.request('/api/desmos/' + 'x'.repeat(65), { headers: f.auth })).status, 400);
});

test('same gate as the bank: no token 401, forged token 401, denied membership 403, writes 404', async t => {
  const f = await fixture(t);
  assert.equal((await f.request('/api/desmos/q1')).status, 401);
  assert.equal((await f.request('/api/desmos/q1', { headers: { Authorization: 'Bearer forged' } })).status, 401);
  for (const method of ['POST', 'PUT', 'DELETE']) assert.equal((await f.request('/api/desmos/q1', { method, headers: { ...f.auth, Origin: origin } })).status, 404);
  const denied = await fixture(t, { status: 'denied' });
  assert.equal((await denied.request('/api/desmos/q1', { headers: denied.auth })).status, 403);
  assert.equal((await denied.request('/api/questions', { headers: denied.auth })).status, 403, 'the bank answers the same');
  const pending = await fixture(t, { status: 'pending' });
  assert.equal((await pending.request('/api/desmos/q1', { headers: pending.auth })).status, 200, 'pending members read the bank, so they read this too');
});

test('a database failure is a 503, not an empty answer', async t => {
  const f = await fixture(t);
  f.breakDb();
  assert.equal((await f.request('/api/desmos/q1', { headers: f.auth })).status, 503);
});

test('/api/questions flags only core questions with a solution, without a per-question read', async t => {
  const f = await fixture(t);
  const res = await f.request('/api/questions', { headers: f.auth });
  assert.equal(res.status, 200);
  const rows = await res.json();
  const flag = Object.fromEntries(rows.map(q => [q.id, q.has_desmos]));
  assert.deepEqual(flag, { q1: 1, q2: undefined, ai_m001: undefined });
  assert.equal(f.reads(), 0, 'the bank reads desmos_solutions once as a list, never row by row');
});
