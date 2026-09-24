const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { pathToFileURL } = require('node:url');
const root = __dirname + '/../';
const origin = 'http://127.0.0.1:8787';
const local = import(pathToFileURL(root + 'src/index.e2e.js'));
const production = import(pathToFileURL(root + 'src/index.js'));
const request = async (worker, env, path, options = {}, host = origin) => worker.fetch(new Request(host + path, options), env);
const login = (worker, env, account = 'e2e-admin', headers = {}, body = JSON.stringify({ account })) => request(worker, env, '/api/e2e/login', {
  method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json', ...headers }, body
});

test('production default rejects test login even with injected flag; bundle/import graph excludes local entry', async () => {
  const src = readFileSync(root + 'src/index.js', 'utf8');
  const config = readFileSync(root + 'wrangler.toml', 'utf8');
  assert.match(config, /^main = "src\/index.js"$/m);
  assert.doesNotMatch(src, /E2E_TEST_MODE|api\/e2e|index\.e2e|e2e_server/);
  const { build } = require('esbuild');
  const bundle = await build({ entryPoints: [root + 'src/index.js'], bundle: true, write: false, metafile: true, format: 'esm', platform: 'browser' });
  assert.deepEqual(Object.keys(bundle.metafile.inputs).map(p => p.replaceAll('\\', '/')).filter(p => /e2e|tests\//.test(p)), []);
  assert.doesNotMatch(bundle.outputFiles[0].text, /E2E_TEST_MODE|api\/e2e\/login/);
  const worker = (await production).default;
  assert.equal((await login(worker, { E2E_TEST_MODE: '1' })).status, 404);
});

test('local flag required on issue AND every resolution; no remote fallback, cookie enters /app', async t => {
  const worker = (await local).default;
  const env = { E2E_TEST_MODE: '1', DB: { prepare: () => ({ bind: () => ({ first: async () => ({ status: 'approved' }) }) }) },
    ASSETS: { fetch: async () => new Response('app') } };
  t.mock.method(global, 'fetch', () => { throw new Error('unexpected network'); });
  assert.equal((await login(worker, {})).status, 404);
  assert.equal((await login(worker, { E2E_TEST_MODE: '0' })).status, 404);
  assert.equal((await login(worker, env, 'e2e-admin', { Origin: 'https://other.test' })).status, 403);
  assert.equal((await login(worker, env, 'e2e-admin', { 'Sec-Fetch-Site': 'cross-site' })).status, 403);
  assert.equal((await login(worker, env, 'e2e-admin', {}, '{bad')).status, 400);
  assert.equal((await login(worker, env, 'e2e-admin', {}, 'x'.repeat(1025))).status, 400);
  assert.equal((await login(worker, env, 'bad')).status, 404);
  assert.equal((await login(worker, env, 'e2e-admin', {}, JSON.stringify({ account: 'e2e-admin', role: 'admin' }))).status, 404);
  assert.equal((await request(worker, env, '/api/e2e/login')).status, 404);
  assert.equal((await request(worker, env, '/api/e2e/login', { method: 'POST', headers: { Origin: 'https://roadto1600.org', 'Content-Type': 'application/json' }, body: JSON.stringify({ account: 'e2e-admin' }) }, 'https://roadto1600.org')).status, 404);
  const first = await login(worker, env);
  const token = (await first.json()).token;
  const second = (await (await login(worker, env)).json()).token;
  assert.notEqual(token, second);
  assert.match(token, /^e2e\.[^.]+\.[^.]+$/);
  const cookie = first.headers.get('Set-Cookie');
  assert.match(cookie, /HttpOnly; Secure; SameSite=Lax; Max-Age=3600/);
  assert.equal((await request(worker, env, '/app', { headers: { Cookie: cookie.split(';')[0] } })).status, 200);
  assert.equal((await request(worker, env, '/api/questions', { headers: { Authorization: 'Bearer forged' } })).status, 401);
  assert.equal((await request(worker, {}, '/api/questions', { headers: { Cookie: cookie.split(';')[0] } })).status, 401);
  assert.equal((await request(worker, { E2E_TEST_MODE: '0' }, '/app', { headers: { Cookie: cookie.split(';')[0] } })).status, 302);
  assert.equal((await request(worker, env, '/api/auth/session', { method: 'POST', headers: { Origin: origin, Authorization: 'Bearer ' + token } })).status, 200);
  assert.equal((await request(worker, env, '/api/questions', { headers: { Authorization: 'Bearer not-a-session' } })).status, 401);
});

test('session cap and expiration enforced', async () => {
  const worker = (await local).default;
  const env = { E2E_TEST_MODE: '1', DB: { prepare: () => ({ bind: () => ({ first: async () => ({ status: 'approved' }) }) }) }, ASSETS: { fetch: async () => new Response('app') } };
  const tokens = [];
  for (let i = 0; i < 65; i++) tokens.push((await (await login(worker, env)).json()).token);
  assert.equal((await request(worker, env, '/app', { headers: { Cookie: '__Host-sat_session=' + tokens[0] } })).status, 302);
  assert.equal((await request(worker, env, '/app', { headers: { Cookie: '__Host-sat_session=' + tokens[64] } })).status, 200);
  const live = Date.now;
  Date.now = () => live() + 3601_000;
  try { assert.equal((await request(worker, env, '/api/questions', { headers: { Authorization: 'Bearer ' + tokens[64] } })).status, 401); }
  finally { Date.now = live; }
});
