// Free-plan CPU bench (docs/perf/free-plan-budget.md): runs the real handleRequest in Node against
// copies of the local budget databases (.wrangler/state-budget, filled by `budget_measure.cjs local`)
// and reports Worker-side CPU per route. D1's own work (SQLite + serializing the result) is timed
// separately and subtracted; parsing the result JSON is left in, as it is in the Worker isolate.
// Numbers are [local-node]: a proxy for ranking changes. Staging is the authority for the 10 ms limit.
//   node tools/budget_bench.cjs [iterations]   (BENCH_DUMP=<dir> writes each route's first response body)
const { DatabaseSync } = require('node:sqlite');
const { readdirSync, copyFileSync, mkdtempSync, existsSync, writeFileSync } = require('node:fs');
const { join, resolve } = require('node:path');
const { tmpdir } = require('node:os');
const root = resolve(__dirname, '..');
const dir = join(root, '.wrangler/state-budget/v3/d1/miniflare-D1DatabaseObject');
const cpu = () => { const u = process.cpuUsage(); return (u.user + u.system) / 1000; };

function open() {
  if (!existsSync(dir)) throw new Error('run `node tools/budget_measure.cjs local` first');
  const tmp = mkdtempSync(join(tmpdir(), 'budget-bench-'));
  const dbs = {};
  for (const f of readdirSync(dir).filter(f => /^[0-9a-f]{64}\.sqlite$/.test(f))) {
    for (const ext of ['', '-wal', '-shm']) if (existsSync(join(dir, f + ext))) copyFileSync(join(dir, f + ext), join(tmp, f + ext));
    const db = new DatabaseSync(join(tmp, f));
    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map(r => r.name);
    dbs[tables.includes('attempts') ? 'DB' : 'AI_DB'] = db;
  }
  return dbs;
}
// A D1-shaped binding. `excluded` accumulates the CPU D1 spends on its side of the wire.
function d1(db, clock) {
  const exec = (query, args, mode) => {
    const t = cpu();
    const stmt = db.prepare(query);
    const reader = stmt.columns().length > 0;
    const out = reader ? { results: stmt.all(...args), meta: { changes: 0 } } : (() => { const r = stmt.run(...args); return { results: [], meta: { changes: Number(r.changes) } }; })();
    const wire = JSON.stringify(out);
    clock.excluded += cpu() - t;
    const res = JSON.parse(wire);
    return mode === 'raw' ? res.results.map(Object.values) : res;
  };
  const stmt = (query, args = []) => ({
    bind: (...v) => stmt(query, v),
    all: async () => exec(query, args),
    run: async () => exec(query, args),
    raw: async () => exec(query, args, 'raw'),
    first: async col => { const r = exec(query, args).results[0]; return r == null ? null : col ? r[col] : r; },
    _q: query, _a: args
  });
  return { prepare: q => stmt(q), batch: async list => list.map(s => exec(s._q, s._a)) };
}
// Cache API stand-in (workerd provides caches; Node does not). Stores bodies as bytes.
function cacheStub() {
  const store = new Map();
  const cache = {
    match: async req => { const hit = store.get(typeof req === 'string' ? req : req.url); return hit ? new Response(hit.body, { headers: hit.headers }) : undefined; },
    put: async (req, res) => { store.set(typeof req === 'string' ? req : req.url, { body: new Uint8Array(await res.arrayBuffer()), headers: [...res.headers] }); },
    delete: async req => store.delete(typeof req === 'string' ? req : req.url)
  };
  return { default: cache, open: async () => cache, store };
}

async function main() {
  const n = Number(process.argv[2] || 5);
  const dbs = open();
  const clock = { excluded: 0 };
  globalThis.caches = cacheStub();
  const env = { DB: d1(dbs.DB, clock), AI_DB: d1(dbs.AI_DB, clock), ADMIN_EMAILS: 'e2e-admin@e2e.test',
    ASSETS: { fetch: async () => new Response('asset') } };
  const { handleRequest } = await import(join(root, 'src/index.js'));
  const who = id => async () => ({ id, email: id + '@e2e.test' });
  const origin = 'http://127.0.0.1:8790';
  const routes = [
    ['GET /api/questions', '/api/questions', 'e2e-budget-01'],
    ['GET /api/admin/questions (show-all)', '/api/admin/questions?page=1', 'e2e-admin'],
    ['GET /api/admin/questions (hide-attended)', '/api/admin/questions?page=1&lessonUsage=hide-attended', 'e2e-admin'],
    ['GET /api/admin/questions (search)', '/api/admin/questions?page=1&search=the', 'e2e-admin'],
    ['GET /api/admin/students', '/api/admin/students?page=1', 'e2e-admin'],
    ['GET /api/admin/students/:id', '/api/admin/students/e2e-budget-01?page=1', 'e2e-admin'],
    ['GET /api/admin/students/:id/history', '/api/admin/students/e2e-budget-01/history?page=1', 'e2e-admin'],
    ['GET /api/lesson-history', '/api/lesson-history', 'e2e-budget-01']
  ];
  const out = {};
  for (const [label, path, user] of routes) {
    const runs = [];
    let status, bytes;
    for (let i = 0; i < n + 1; i++) {
      clock.excluded = 0;
      const t = cpu();
      const res = await handleRequest(new Request(origin + path), env, who(user));
      const body = await res.text();
      const used = cpu() - t - clock.excluded;
      status = res.status; bytes = body.length;
      if (process.env.BENCH_DUMP && !i) writeFileSync(join(process.env.BENCH_DUMP, label.replace(/[^\w]+/g, '_') + '.json'), body);
      if (i) runs.push(used); // first run warms the JIT (and fills any cache)
    }
    runs.sort((a, b) => a - b);
    out[label] = { status, bytes, medianMs: +runs[Math.floor(runs.length / 2)].toFixed(1), maxMs: +runs.at(-1).toFixed(1) };
  }
  console.table(out);
  if (process.env.BENCH_JSON) console.log(JSON.stringify(out));
}
main().catch(e => { console.error(e); process.exit(1); });
