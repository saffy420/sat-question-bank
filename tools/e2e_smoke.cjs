// Finite HTTP smoke for all three local targets; no browser fixture or remote URLs.
const { spawn } = require('node:child_process');
const https = require('node:https');
const assert = require('node:assert/strict');
const { setTimeout: delay } = require('node:timers/promises');
const { resolve } = require('node:path');
const root = resolve(__dirname, '..');
const ports = { enabled: 8787, unset: 8788, production: 8789 };
const children = [];
const url = (mode, path) => `https://127.0.0.1:${ports[mode]}${path}`;
const request = (mode, path, { method = 'GET', headers = {}, body } = {}) => new Promise((ok, fail) => {
  const req = https.request(url(mode, path), { method, headers, rejectUnauthorized: false }, res => {
    const chunks = [];
    res.on('data', chunk => chunks.push(chunk));
    res.on('end', () => ok({ status: res.statusCode, headers: res.headers, json: () => JSON.parse(Buffer.concat(chunks).toString()) }));
  });
  req.on('error', fail);
  req.end(body);
});
async function ready(mode) {
  for (let i = 0; i < 80; i++) {
    if (children.at(-1).exitCode !== null) throw new Error(`${mode} exited before ready`);
    try { if ((await request(mode, '/login')).status === 200) return; } catch {}
    await delay(500);
  }
  throw new Error(`${mode} not ready at ${url(mode, '/login')}`);
}
async function stop(child) {
  if (process.platform !== 'win32') {
    try { process.kill(-child.pid, 'SIGTERM'); } catch {}
  } else child.kill();
  if (child.exitCode === null) await Promise.race([new Promise(ok => child.once('exit', ok)), delay(5000)]);
  if (child.exitCode === null) {
    if (process.platform !== 'win32') { try { process.kill(-child.pid, 'SIGKILL'); } catch {} }
    else child.kill('SIGKILL');
  }
}
(async () => {
  for (const mode of Object.keys(ports)) {
    const child = spawn(process.execPath, [resolve(__dirname, 'e2e_server.cjs'), mode], { cwd: root, detached: process.platform !== 'win32', stdio: 'ignore' });
    children.push(child);
    await ready(mode);
  }
  const post = mode => request(mode, '/api/e2e/login', { method: 'POST', headers: { Origin: url(mode, ''), 'Content-Type': 'application/json' }, body: JSON.stringify({ account: 'e2e-admin' }) });
  const login = await post('enabled');
  assert.equal(login.status, 200, `enabled login status ${login.status}`);
  const { token, user } = login.json();
  assert.equal(user.id, 'e2e-admin');
  const cookie = login.headers['set-cookie'][0].split(';')[0];
  const app = await request('enabled', '/app', { headers: { Cookie: cookie } });
  assert.equal(app.status, 200);
  const bank = await request('enabled', '/api/questions', { headers: { Cookie: cookie } });
  assert.equal(bank.status, 200);
  const rows = bank.json();
  assert.equal(rows.length, 4);
  assert(rows.some(q => q.source === 'AI'));
  assert(rows.some(q => q.choices_json === '[]'));
  for (const mode of ['unset', 'production']) {
    const response = await post(mode);
    assert.equal(response.status, 404, `${mode} login status ${response.status}`);
    assert.equal(response.headers['set-cookie'], undefined);
  }
  assert.equal((await request('unset', '/api/questions', { headers: { Authorization: 'Bearer ' + token } })).status, 401);
  console.log('Local HTTP targets: enabled app+both banks 200, unset login 404/token 401, production-entry flag login 404');
})().catch(error => { console.error(error); process.exitCode = 1; }).finally(async () => { for (const child of children.reverse()) await stop(child); });
