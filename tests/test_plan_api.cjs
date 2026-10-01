// Study Plan storage: GET/POST /api/plan (one row per student, revision-checked) and the plan_step tag on attempts.
//   node --test tests/test_plan_api.cjs
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { DatabaseSync } = require('node:sqlite');
const { readFileSync } = require('node:fs');
const { pathToFileURL } = require('node:url');
const root = __dirname + '/../';
const origin = 'https://roadto1600.org';
let serial = 0;

async function fixture(t) {
  const db = new DatabaseSync(':memory:');
  db.exec(readFileSync(root + 'schema.sql', 'utf8'));
  db.exec("INSERT INTO questions (id) VALUES ('q1'), ('q2');");
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
  const env = { SUPABASE_URL: 'https://auth.example', SUPABASE_ANON_KEY: 'public',
    DB: { prepare: wrap, batch: async statements => { const out = []; for (const s of statements) out.push(await s.run()); return out; } },
    AI_DB: { prepare: () => ({ all: async () => ({ results: [] }) }) },
    ASSETS: { fetch: async req => new Response(new URL(req.url || req).pathname) } };
  const users = {};
  const token = id => {
    const tok = Buffer.from('{}').toString('base64url') + '.' + Buffer.from(JSON.stringify({ exp: Math.floor(Date.now() / 1000) + 120, amr: [{ method: 'oauth' }], sub: id })).toString('base64url') + '.sig' + id;
    users[tok] = id;
    db.prepare("INSERT OR IGNORE INTO membership (user_id, email, status) VALUES (?, ?, 'approved')").run(id, id + '@ccs.us');
    return { Authorization: 'Bearer ' + tok, Origin: origin, 'Content-Type': 'application/json' };
  };
  t.mock.method(global, 'fetch', async (url, options) => {
    const id = users[options.headers.Authorization.slice(7)];
    return Response.json({ id, email: id + '@ccs.us', email_confirmed_at: '2026-01-01', app_metadata: { provider: 'google' }, identities: [{ provider: 'google' }] });
  });
  const worker = (await import(pathToFileURL(root + 'src/index.js'))).default;
  const request = (path, options = {}) => worker.fetch(new Request(origin + path, options), env);
  t.after(() => db.close());
  return { db, request, token, a: token('plan-a' + ++serial), b: token('plan-b' + serial) };
}

test('a plan saves and reads back per account; a stale revision is refused, not overwritten', async t => {
  const f = await fixture(t);
  const get = async h => (await f.request('/api/plan', { headers: h })).json();
  const post = (h, body) => f.request('/api/plan', { method: 'POST', headers: h, body: JSON.stringify(body) });
  assert.deepEqual(await get(f.a), { state: null, rev: 0 });
  const first = await post(f.a, { state: { tests: ['PT4'] }, rev: 0 });
  assert.equal(first.status, 200);
  assert.deepEqual(await first.json(), { rev: 1 });
  assert.deepEqual(await get(f.a), { state: { tests: ['PT4'] }, rev: 1 });
  // A second tab that still holds rev 0 (or any old rev) cannot overwrite the log saved first.
  const stale = await post(f.a, { state: { tests: [] }, rev: 0 });
  assert.equal(stale.status, 409);
  assert.deepEqual(await stale.json(), { error: 'stale', rev: 1 });
  assert.equal((await post(f.a, { state: { tests: ['PT4', 'PT5'] }, rev: 1 })).status, 200);
  assert.equal((await post(f.a, { state: { tests: [] }, rev: 1 })).status, 409);
  assert.deepEqual(await get(f.a), { state: { tests: ['PT4', 'PT5'] }, rev: 2 });
  // Another account sees only its own row.
  assert.deepEqual(await get(f.b), { state: null, rev: 0 });
  assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM study_plans').get().n, 1);
});

test('plan route: auth, body and size checks', async t => {
  const f = await fixture(t);
  assert.equal((await f.request('/api/plan')).status, 401);
  assert.equal((await f.request('/api/plan', { method: 'POST', headers: { Origin: origin }, body: '{}' })).status, 401);
  for (const body of [null, [], { state: [], rev: 0 }, { state: {}, rev: -1 }, { state: {}, rev: 1.5 }, { state: 'x', rev: 0 }, { rev: 0 }]) {
    assert.equal((await f.request('/api/plan', { method: 'POST', headers: f.a, body: JSON.stringify(body) })).status, 400, JSON.stringify(body));
  }
  const big = { state: { pad: 'x'.repeat(140000) }, rev: 0 };
  assert.equal((await f.request('/api/plan', { method: 'POST', headers: f.a, body: JSON.stringify(big) })).status, 413);
  assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM study_plans').get().n, 0);
});

test('attempts carry the plan step they were answered in, and read it back', async t => {
  const f = await fixture(t);
  const rows = [
    { question_id: 'q1', ts: '2026-10-01T12:00:00.000Z', correct: 0, time_taken_ms: 0, picked: '', changes: 0, plan_step: 'test:PT4' },
    { question_id: 'q2', ts: '2026-10-02T12:00:00.000Z', correct: 1, time_taken_ms: 40000, picked: 'B', changes: 0 }
  ];
  const res = await f.request('/api/attempts', { method: 'POST', headers: f.a, body: JSON.stringify(rows) });
  assert.equal(res.status, 200);
  const back = await (await f.request('/api/attempts', { headers: f.a })).json();
  assert.deepEqual(back.map(r => [r.question_id, r.plan_step]), [['q1', 'test:PT4'], ['q2', null]]);
  const bad = await f.request('/api/attempts', { method: 'POST', headers: f.a, body: JSON.stringify([{ ...rows[1], ts: 'x', plan_step: 'y'.repeat(41) }]) });
  assert.equal(bad.status, 400);
});

test('0012 upgrades a pre-0012 database to the fresh snapshot', () => {
  const schema = readFileSync(root + 'schema.sql', 'utf8');
  const old = schema.replace(/^  -- 0012_study_plan\.sql.*\r?\n  plan_step TEXT,\r?\n/m, '')
    .replace(/^-- 0012_study_plan\.sql[\s\S]*?CREATE TABLE IF NOT EXISTS study_plans \([\s\S]*?\);\r?\n/m, '');
  assert.ok(!/plan_step|study_plans/.test(old), 'the pre-0012 schema has neither');
  const db = new DatabaseSync(':memory:'); db.exec(old);
  db.exec("INSERT INTO attempts(user_id,question_id,ts) VALUES('u','q','t')");
  db.exec(readFileSync(root + 'migrations/0012_study_plan.sql', 'utf8'));
  assert.equal(db.prepare('SELECT plan_step FROM attempts').get().plan_step, null);
  const fresh = new DatabaseSync(':memory:'); fresh.exec(schema);
  const shape = d => ['attempts', 'study_plans'].map(t => d.prepare(`PRAGMA table_info(${t})`).all().map(c => `${c.name}:${c.type}:${c.notnull}:${c.pk}`).join());
  assert.deepEqual(shape(db), shape(fresh));
  db.close(); fresh.close();
});
