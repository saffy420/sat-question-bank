// Saved questions (the player's Mark for Review flag): GET/POST /api/saved and migration 0013.
//   node --test tests/test_saved_api.cjs
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
  db.exec("INSERT INTO questions (id) VALUES ('q1'), ('q2'), ('q3'); INSERT INTO ai_ids (id) VALUES ('ai1');");
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
  const f = { db, request, a: token('saved-a' + ++serial), b: token('saved-b' + serial) };
  f.get = async h => (await request('/api/saved', { headers: h })).json();
  f.post = (h, body) => request('/api/saved', { method: 'POST', headers: h, body: JSON.stringify(body) });
  return f;
}

test('save and unsave round trip, per account', async t => {
  const f = await fixture(t);
  assert.deepEqual(await f.get(f.a), []);
  const first = await f.post(f.a, { question_id: 'q1', saved: true });
  assert.equal(first.status, 200);
  assert.deepEqual(await first.json(), { saved: 1, acknowledged: [{ question_id: 'q1', saved: true }] });
  assert.equal((await f.post(f.a, { question_id: 'ai1', saved: true })).status, 200, 'an AI question can be saved');
  assert.deepEqual((await f.get(f.a)).sort(), ['ai1', 'q1']);
  // Another account sees none of it, and its own row for the same question is separate.
  assert.deepEqual(await f.get(f.b), []);
  assert.equal((await f.post(f.b, { question_id: 'q1', saved: true })).status, 200);
  assert.equal((await f.post(f.a, { question_id: 'q1', saved: false })).status, 200);
  assert.deepEqual(await f.get(f.a), ['ai1']);
  assert.deepEqual(await f.get(f.b), ['q1'], 'a delete only touches the caller\'s row');
  // Saving twice is one row; un-saving what is not saved is not an error.
  await f.post(f.a, { question_id: 'q2', saved: true });
  const again = await f.post(f.a, { question_id: 'q2', saved: true });
  assert.equal(again.status, 200);
  assert.deepEqual((await again.json()).acknowledged, [{ question_id: 'q2', saved: true }]);
  assert.equal((await f.post(f.a, { question_id: 'q3', saved: false })).status, 200);
  assert.equal(f.db.prepare("SELECT COUNT(*) AS n FROM saved_questions WHERE question_id = 'q2'").get().n, 1);
});

test('a batch saves and unsaves several at once', async t => {
  const f = await fixture(t);
  const res = await f.post(f.a, [{ question_id: 'q1', saved: true }, { question_id: 'q2', saved: true }, { question_id: 'q1', saved: false }]);
  assert.equal(res.status, 200);
  assert.deepEqual(await f.get(f.a), ['q2']);
});

test('unknown question ids are rejected and nothing is stored', async t => {
  const f = await fixture(t);
  const res = await f.post(f.a, { question_id: 'nope', saved: true });
  assert.equal(res.status, 400);
  assert.deepEqual((await res.json()).unknown, ['nope']);
  const mixed = await f.post(f.a, [{ question_id: 'q1', saved: true }, { question_id: 'nope', saved: true }]);
  assert.equal(mixed.status, 400);
  assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM saved_questions').get().n, 0, 'the known id in a refused batch is not saved either');
});

test('auth and body checks', async t => {
  const f = await fixture(t);
  assert.equal((await f.request('/api/saved')).status, 401);
  assert.equal((await f.request('/api/saved', { method: 'POST', headers: { Origin: origin }, body: JSON.stringify({ question_id: 'q1', saved: true }) })).status, 401);
  for (const body of [null, 5, { saved: true }, { question_id: '', saved: true }, { question_id: 'q1' }, { question_id: 'q1', saved: 'yes' }, { question_id: 'q1', saved: 1 }, { question_id: 'x'.repeat(65), saved: true }]) {
    assert.equal((await f.post(f.a, body)).status, 400, JSON.stringify(body));
  }
  const many = Array.from({ length: 501 }, () => ({ question_id: 'q1', saved: true }));
  assert.equal((await f.post(f.a, many)).status, 413, 'the row cap is the notes cap');
  assert.equal((await f.request('/api/saved', { method: 'DELETE', headers: f.a })).status, 404, 'only GET and POST exist');
  assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM saved_questions').get().n, 0);
});

test('0013 upgrades a pre-0013 database to the fresh snapshot', () => {
  const schema = readFileSync(root + 'schema.sql', 'utf8');
  const old = schema.replace(/^-- 0013_saved_questions\.sql[\s\S]*?CREATE TABLE IF NOT EXISTS saved_questions \([\s\S]*?\);\r?\n/m, '');
  assert.ok(!/saved_questions/.test(old), 'the pre-0013 schema has no saved_questions');
  const db = new DatabaseSync(':memory:'); db.exec(old);
  db.exec(readFileSync(root + 'migrations/0013_saved_questions.sql', 'utf8'));
  db.exec(readFileSync(root + 'migrations/0013_saved_questions.sql', 'utf8'));  // re-running is harmless
  const fresh = new DatabaseSync(':memory:'); fresh.exec(schema);
  const shape = d => ['saved_questions'].map(name => d.prepare(`PRAGMA table_info(${name})`).all().map(c => `${c.name}:${c.type}:${c.notnull}:${c.dflt_value}:${c.pk}`).join());
  assert.deepEqual(shape(db), shape(fresh));
  assert.equal(shape(fresh)[0].split(',').length, 3);
  db.close(); fresh.close();
});
