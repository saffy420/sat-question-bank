// Free-plan budget trace (src/budget.js) and the staging gate in src/index.e2e.js.
//   node --test tests/test_budget.cjs
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { pathToFileURL } = require('node:url');
const root = __dirname + '/../';
const budget = () => import(pathToFileURL(root + 'src/budget.js'));

// A fake D1 whose meta says each statement read 3 rows and wrote 1.
function fakeD1(rows = [{ n: 1 }]) {
  const calls = [];
  const stmt = (sql, args = []) => ({
    sql, args,
    bind: (...a) => stmt(sql, a),
    all: async () => { calls.push(['all', sql]); return { results: rows, meta: { rows_read: 3, rows_written: 1 } }; },
    run: async () => { calls.push(['run', sql]); return { meta: { rows_read: 3, rows_written: 1, changes: 1 } }; },
    first: async () => { throw new Error('first() must be served from all()'); },
    raw: async () => { calls.push(['raw', sql]); return [[1]]; }
  });
  return { calls, prepare: sql => stmt(sql), batch: async list => { calls.push(['batch', list.map(s => s.sql)]); return list.map(() => ({ results: [], meta: { rows_read: 2, rows_written: 2 } })); } };
}
const quiet = t => t.mock.method(console, 'log', () => {});

test('off: the env object is handed back untouched and nothing is printed', async t => {
  const { traceEnv, traceDurableObject } = await budget();
  const log = quiet(t);
  for (const flag of [undefined, '', '0', 'true', 1]) {
    const env = { DB: fakeD1(), BUDGET_TRACE: flag };
    const out = traceEnv(env, 'worker');
    assert.equal(out.env, env);
    assert.equal(out.trace, null);
    assert.equal(out.done(), null);
  }
  class Room { constructor(ctx, env) { this.env = env; } async fetch() { return this.env; } }
  const env = { DB: fakeD1() };
  const room = new (traceDurableObject(Room))({}, env);
  assert.equal(await room.fetch(new Request('https://x/')), env);
  assert.equal(log.mock.callCount(), 0);
});

test('on: queries, batches, statements and rows are counted at the binding', async t => {
  const { traceEnv } = await budget();
  const log = quiet(t);
  const db = fakeD1(), ai = fakeD1();
  const { env, trace, done } = traceEnv({ DB: db, AI_DB: ai, BUDGET_TRACE: '1', OTHER: 7 }, 'worker', 'GET /x');
  assert.equal(env.OTHER, 7);
  await env.DB.prepare('SELECT 1').all();
  await env.DB.prepare('SELECT ?').bind(1).run();
  assert.deepEqual(await env.DB.prepare('SELECT ?').bind(2).first(), { n: 1 });
  assert.equal(await env.DB.prepare('SELECT ?').bind(2).first('n'), 1);
  await env.AI_DB.prepare('SELECT 2').all();
  await env.DB.batch([env.DB.prepare('INSERT 1'), env.DB.prepare('INSERT 2').bind(1), env.DB.prepare('INSERT 3')]);
  // Wrapped statements reach the real batch unwrapped.
  assert.deepEqual(db.calls.at(-1), ['batch', ['INSERT 1', 'INSERT 2', 'INSERT 3']]);
  const out = done({ status: 200 });
  assert.equal(out, trace);
  assert.equal(trace.queries, 5);
  assert.equal(trace.batches, 1);
  assert.deepEqual(trace.batchStatements, [3]);
  assert.equal(trace.statements, 8);
  assert.equal(trace.rowsRead, 5 * 3 + 3 * 2);
  assert.equal(trace.rowsWritten, 5 * 1 + 3 * 2);
  assert.equal(trace.byBinding.AI_DB.queries, 1);
  assert.equal(trace.byBinding.DB.queries, 4);
  assert.equal(trace.status, 200);
  assert.equal(trace.maxParams, 1);
  assert.equal(log.mock.callCount(), 1);
  assert.match(log.mock.calls[0].arguments[0], /^BUDGET_TRACE \{/);
});

test('on: first() keeps D1 semantics for empty results and missing columns; errors are recorded', async t => {
  const { traceEnv } = await budget();
  quiet(t);
  const { env, trace } = traceEnv({ DB: fakeD1([]), BUDGET_TRACE: '1' }, 'worker');
  assert.equal(await env.DB.prepare('SELECT 1').first(), null);
  assert.equal(await env.DB.prepare('SELECT 1').first('n'), null);
  const other = traceEnv({ DB: fakeD1([{ a: 1 }]), BUDGET_TRACE: '1' }, 'worker');
  await assert.rejects(other.env.DB.prepare('SELECT 1').first('n'), /D1_COLUMN_NOTFOUND/);
  const failing = { prepare: () => ({ bind() { return this; }, all: async () => { throw new Error('D1_ERROR: boom'); } }) };
  const f = traceEnv({ DB: failing, BUDGET_TRACE: '1' }, 'worker');
  await assert.rejects(f.env.DB.prepare('SELECT 1').all(), /boom/);
  assert.equal(f.trace.queries, 1);
  assert.match(f.trace.errors[0], /boom/);
  assert.equal(trace.queries, 2);
});

test('Durable Object events each get their own trace', async t => {
  const { traceDurableObject } = await budget();
  const log = quiet(t);
  class Room {
    constructor(ctx, env) { this.ctx = ctx; this.env = env; }
    async webSocketMessage(ws, raw) { await this.env.DB.prepare('SELECT 1').all(); return raw; }
    async alarm() { await this.env.DB.batch([this.env.DB.prepare('X'), this.env.DB.prepare('Y')]); await this.ctx.storage.put('room', 1); await this.ctx.storage.setAlarm(5); }
  }
  const Traced = traceDurableObject(Room);
  assert.equal(Traced.name, 'Room');
  const stored = {};
  const storage = { put: async (k, v) => { stored[k] = v; }, setAlarm: async () => {}, get: async k => stored[k] };
  const room = new Traced({ storage, id: 'x' }, { DB: fakeD1(), BUDGET_TRACE: '1' });
  assert.equal(room.ctx.id, 'x');
  assert.equal(await room.webSocketMessage({}, '{"type":"select"}'), '{"type":"select"}');
  await room.alarm();
  const traces = log.mock.calls.map(c => JSON.parse(c.arguments[0].slice('BUDGET_TRACE '.length)));
  assert.deepEqual(traces.map(x => [x.kind, x.label, x.queries, x.batches]), [['do.webSocketMessage', 'select', 1, 0], ['do.alarm', '', 0, 1]]);
  assert.deepEqual(traces[1].storage, { put: 1, setAlarm: 1 });
  assert.equal(stored.room, 1);
});

test('production config never enables the trace or the staging test surface', async () => {
  const toml = readFileSync(root + 'wrangler.toml', 'utf8');
  const top = toml.split(/^\[env\./m)[0].replace(/^#.*$/gm, '');
  assert.doesNotMatch(top, /BUDGET_TRACE|BUDGET_PROBE|E2E_TEST_MODE|STAGING_TEST_TOKEN|D1_FAULT_INJECTION/);
  // The fault flag is set by no config at all, staging included: only local test runs pass it.
  assert.doesNotMatch(toml.replace(/^#.*$/gm, ''), /D1_FAULT_INJECTION/);
  assert.match(top, /^main = "src\/index.js"$/m);
  for (const file of ['wrangler.e2e.toml', 'wrangler.e2e-production.toml']) assert.doesNotMatch(readFileSync(root + file, 'utf8'), /BUDGET_TRACE|BUDGET_PROBE|STAGING_TEST_TOKEN|D1_FAULT_INJECTION/);
  const src = readFileSync(root + 'src/index.js', 'utf8');
  assert.doesNotMatch(src, /BUDGET_TRACE\s*[:=]\s*['"]|budget-probe|STAGING_TEST_TOKEN|D1_FAULT_INJECTION|d1-fault/);
  // The production worker, even handed the flags, serves no probe and prints no trace line.
  const worker = (await import(pathToFileURL(root + 'src/index.js'))).default;
  const res = await worker.fetch(new Request('https://roadto1600.org/api/e2e/budget-probe?kind=worker-serial', { method: 'POST', headers: { Origin: 'https://roadto1600.org' } }),
    { ASSETS: { fetch: async () => new Response('404', { status: 404 }) } });
  assert.equal(res.status, 404);
  assert.equal(res.headers.get('X-Budget-Trace'), null);
  // No fault route in production, even handed both flags.
  const fault = await worker.fetch(new Request('https://roadto1600.org/api/e2e/d1-fault', { method: 'POST', headers: { Origin: 'https://roadto1600.org', 'Content-Type': 'application/json' }, body: '{"sessionId":1,"kind":"quota"}' }),
    { E2E_TEST_MODE: '1', D1_FAULT_INJECTION: '1', LESSON_ROOM: { getByName() { throw new Error('reached a room'); } }, ASSETS: { fetch: async () => new Response('404', { status: 404 }) } });
  assert.equal(fault.status, 404);
});

test('fault flag: the local route needs E2E_TEST_MODE, D1_FAULT_INJECTION, loopback and same origin; staging never', async t => {
  const e2e = (await import(pathToFileURL(root + 'src/index.e2e.js'))).default;
  const seen = [];
  const env = flags => ({ ...flags, STAGING_TEST_TOKEN: 'x'.repeat(40), LESSON_ROOM: { getByName: name => ({ fetch: async req => { seen.push([name, req.headers.get('X-Lesson-Internal'), await req.json()]); return Response.json({ ok: true }); } }) } });
  const call = (flags, { host = 'http://127.0.0.1:8791', origin = host, headers = {} } = {}) => e2e.fetch(new Request(host + '/api/e2e/d1-fault',
    { method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json', ...headers }, body: JSON.stringify({ sessionId: 7, kind: 'quota', after: 1 }) }), env(flags));
  quiet(t);
  const both = { E2E_TEST_MODE: '1', D1_FAULT_INJECTION: '1' };
  for (const flags of [{}, { E2E_TEST_MODE: '1' }, { D1_FAULT_INJECTION: '1' }, { E2E_TEST_MODE: '1', D1_FAULT_INJECTION: 'true' }]) assert.equal((await call(flags)).status, 404);
  // Staging (off loopback, with the staging token) never reaches it.
  assert.equal((await call(both, { host: 'https://roadto1600-staging.example.workers.dev', headers: { 'X-Staging-Test-Token': 'x'.repeat(40) } })).status, 404);
  assert.equal((await call(both, { origin: 'http://evil.test' })).status, 403);
  assert.deepEqual(seen, []);
  assert.equal((await call(both)).status, 200);
  assert.deepEqual(seen, [['7', 'fault', { kind: 'quota', after: 1 }]]);
});

test('staging gate: off loopback only with the configured token; probe needs every flag', async t => {
  const worker = (await import(pathToFileURL(root + 'src/index.e2e.js'))).default;
  const { stagingAllowed } = await import(pathToFileURL(root + 'src/index.e2e.js'));
  quiet(t);
  const token = 'a'.repeat(40);
  const remote = (headers = {}, path = '/api/e2e/budget-probe?kind=worker-serial') =>
    new Request('https://roadto1600-staging.example.workers.dev' + path, { method: 'POST', headers: { Origin: 'https://roadto1600-staging.example.workers.dev', ...headers } });
  const probeDo = { getByName: () => ({ fetch: async () => Response.json({}) }) };
  const db = { prepare: () => ({ bind() { return this; }, first: async () => ({ n: 1 }) }) };
  const base = { E2E_TEST_MODE: '1', BUDGET_PROBE: '1', BUDGET_PROBE_DO: probeDo, DB: db };
  assert.equal(stagingAllowed(remote(), { STAGING_TEST_TOKEN: token }), false);
  assert.equal(stagingAllowed(remote({ 'X-Staging-Test-Token': token }), {}), false);
  assert.equal(stagingAllowed(remote({ 'X-Staging-Test-Token': 'short' }), { STAGING_TEST_TOKEN: 'short' }), false);
  assert.equal(stagingAllowed(remote({ 'X-Staging-Test-Token': token.slice(1) + 'b' }), { STAGING_TEST_TOKEN: token }), false);
  assert.equal(stagingAllowed(remote({ 'X-Staging-Test-Token': token + 'a' }), { STAGING_TEST_TOKEN: token }), false);
  assert.equal(stagingAllowed(remote({ 'X-Staging-Test-Token': token }), { STAGING_TEST_TOKEN: token }), true);
  assert.equal((await worker.fetch(remote(), { ...base, STAGING_TEST_TOKEN: token })).status, 404);
  assert.equal((await worker.fetch(remote({ 'X-Staging-Test-Token': token }), base)).status, 404);
  assert.equal((await worker.fetch(remote({ 'X-Staging-Test-Token': token }), { ...base, STAGING_TEST_TOKEN: token, BUDGET_PROBE: undefined })).status, 404);
  assert.equal((await worker.fetch(remote({ 'X-Staging-Test-Token': token }), { ...base, STAGING_TEST_TOKEN: token, E2E_TEST_MODE: '0' })).status, 404);
  const ok = await worker.fetch(remote({ 'X-Staging-Test-Token': token }), { ...base, STAGING_TEST_TOKEN: token });
  assert.equal(ok.status, 200);
  assert.deepEqual(await ok.json(), { ok: 60 });
});

test('staging sign-in: stateless signed token works across isolates; tampered or ungated tokens do not', async t => {
  const worker = (await import(pathToFileURL(root + 'src/index.e2e.js'))).default;
  quiet(t);
  const token = 'b'.repeat(40), host = 'https://roadto1600-staging.example.workers.dev';
  const db = { prepare: () => ({ bind() { return this; }, first: async () => ({ status: 'approved' }), all: async () => ({ results: [] }), run: async () => ({ meta: {} }) }) };
  const env = { E2E_TEST_MODE: '1', STAGING_TEST_TOKEN: token, DB: db };
  const login = await worker.fetch(new Request(host + '/api/e2e/login', { method: 'POST',
    headers: { Origin: host, 'Content-Type': 'application/json', 'X-Staging-Test-Token': token }, body: JSON.stringify({ account: 'e2e-budget-07' }) }), env);
  assert.equal(login.status, 200);
  const session = (await login.json()).token;
  assert.match(session, /^e2e\.[\w-]+\.[\w-]+$/);
  const get = (bearer, gate = token, e = env) => worker.fetch(new Request(host + '/api/settings', { headers: { Authorization: 'Bearer ' + bearer, 'X-Staging-Test-Token': gate } }), e);
  assert.equal((await get(session)).status, 200);
  const [h, p, mac] = session.split('.');
  const forged = btoa(JSON.stringify({ exp: 9999999999, account: 'e2e-admin' })).replace(/=+$/, '');
  assert.equal((await get(`${h}.${forged}.${mac}`)).status, 401);
  assert.equal((await get(`${h}.${p}.${mac.slice(0, -2)}xx`)).status, 401);
  assert.equal((await get(session, 'c'.repeat(40))).status, 404);
  assert.equal((await get(session, token, { ...env, STAGING_TEST_TOKEN: 'd'.repeat(40) })).status, 404);
  assert.equal((await get(session, token, { ...env, E2E_TEST_MODE: '0' })).status, 401);
});
