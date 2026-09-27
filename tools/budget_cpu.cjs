// Free-plan CPU sampler (docs/perf/free-plan-budget.md, free-02): sends each GET path N times in a
// row to the staging Worker as one account and prints the CPU time `wrangler tail` reports for each
// request. Deploy staging with tracing off first so the numbers match production's code path:
//   npx wrangler deploy --env staging --var BUDGET_TRACE:0
//   node tools/budget_cpu.cjs <account> <n> <path> [path...]
// Then redeploy with `npx wrangler deploy --env staging` (tracing on) for budget_measure.cjs.
const { spawn } = require('node:child_process');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const root = join(__dirname, '..');
const env = Object.fromEntries(readFileSync(join(root, '.e2e.staging.env'), 'utf8').split('\n').filter(Boolean).map(l => l.split(/=(.*)/s).slice(0, 2)));
const [account, count, ...paths] = process.argv.slice(2);
if (!account || !(count > 0) || !paths.length) throw new Error('usage: node tools/budget_cpu.cjs <account> <n> <path>...');
const sleep = ms => new Promise(r => setTimeout(r, ms));
const H = { 'X-Staging-Test-Token': env.STAGING_TEST_TOKEN, Origin: env.STAGING_URL };
(async () => {
  const tail = spawn(process.execPath, [join(root, 'node_modules/wrangler/bin/wrangler.js'), 'tail', 'roadto1600-staging', '--format', 'json'], { cwd: root, stdio: ['ignore', 'pipe', 'ignore'] });
  let buf = ''; const events = [];
  tail.stdout.on('data', d => { buf += d; for (;;) { const i = buf.indexOf('\n}\n'); if (i < 0) break; try { events.push(JSON.parse(buf.slice(0, i + 2))); } catch { /* partial */ } buf = buf.slice(i + 3); } });
  await sleep(9000);
  const login = await fetch(env.STAGING_URL + '/api/e2e/login', { method: 'POST', headers: { ...H, 'Content-Type': 'application/json' }, body: JSON.stringify({ account }) });
  const { token } = await login.json();
  for (let k = 0; k < +count; k++) for (const p of paths) {
    const r = await fetch(env.STAGING_URL + p, { headers: { ...H, Authorization: 'Bearer ' + token } });
    await r.arrayBuffer();
    if (!r.ok) console.log(p, r.status);
    await sleep(300);
  }
  await sleep(8000); tail.kill();
  const by = {};
  for (const e of events) {
    const u = (e.event?.request?.url || '').replace(/^https?:\/\/[^/]+/, '');
    if (u !== '/api/e2e/login') (by[u] ||= []).push(e.cpuTime + (e.outcome !== 'ok' ? ' ' + e.outcome : ''));
  }
  for (const [u, list] of Object.entries(by)) console.log(`${u}\tCPU ms: ${list.join(', ')}`);
})();
