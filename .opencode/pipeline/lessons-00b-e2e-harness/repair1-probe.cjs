// Focused local HTTPS cookie probe; no browser fixture or HTTP header spoofing.
const { spawn } = require('node:child_process');
const { resolve } = require('node:path');
const { chromium } = require('@playwright/test');
const root = resolve(__dirname, '../../..');
const origin = 'https://127.0.0.1:8787';
const child = spawn(process.execPath, [resolve(root, 'tools/e2e_server.cjs'), 'enabled'], { cwd: root, detached: process.platform !== 'win32', stdio: 'inherit' });
let browser;
async function ready() {
  for (let n = 0; n < 90; n++) {
    if (child.exitCode !== null) throw new Error(`Local server exited: ${child.exitCode}`);
    try {
      const status = await new Promise((ok, fail) => require('node:https').get(origin + '/login', { rejectUnauthorized: false }, r => { r.resume(); ok(r.statusCode); }).on('error', fail));
      if (status === 200) return;
    } catch {}
    await new Promise(resolve => setTimeout(resolve, 500));
  }
  throw new Error('Local HTTPS login readiness failed');
}
(async () => {
  await ready();
  browser = await chromium.launch();
  const context = await browser.newContext({ ignoreHTTPSErrors: true, baseURL: origin });
  const page = await context.newPage();
  await page.goto('/login');
  const login = await page.evaluate(async () => {
    const r = await fetch('/api/e2e/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ account: 'e2e-admin' }) });
    return { status: r.status, body: await r.json() };
  });
  if (login.status !== 200) throw new Error(`Login status ${login.status}: ${JSON.stringify(login.body)}`);
  const cookie = (await context.cookies(origin)).find(c => c.name === '__Host-sat_session');
  if (!cookie || cookie.value !== login.body.token || !cookie.secure || !cookie.httpOnly) throw new Error('Browser did not store secure __Host- cookie');
  await context.addInitScript(session => {
    Object.defineProperty(window, 'supabase', { configurable: true, value: { createClient: () => ({ auth: {
      getSession: async () => ({ data: { session }, error: null }),
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } })
    } }) } });
  }, { access_token: login.body.token, user: login.body.user });
  await context.route('https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.112.4', route => route.abort());
  const app = await page.goto('/app');
  if (app.status() !== 200 || new URL(page.url()).pathname !== '/app') throw new Error(`Gated /app failed: ${app.status()} ${page.url()}`);
  const bank = await page.evaluate(async () => { const r = await fetch('/api/questions'); return { status: r.status, rows: await r.json() }; });
  if (bank.status !== 200 || bank.rows.length !== 4 || !bank.rows.some(q => q.source === 'AI')) throw new Error(`Cookie-only bank failed: ${JSON.stringify(bank)}`);
  console.log('HTTPS browser cookie/login/app/both-bank PASS; Chromium ' + browser.version());
})().catch(e => { console.error(e); process.exitCode = 1; }).finally(async () => {
  if (browser) await browser.close();
  if (process.platform !== 'win32') { try { process.kill(-child.pid, 'SIGTERM'); } catch {} }
  else child.kill();
  if (child.exitCode === null) await Promise.race([new Promise(ok => child.once('exit', ok)), new Promise(ok => setTimeout(ok, 5000))]);
  if (child.exitCode === null) { if (process.platform !== 'win32') { try { process.kill(-child.pid, 'SIGKILL'); } catch {} } else child.kill('SIGKILL'); }
});
