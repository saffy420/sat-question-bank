// Staging-only probe for the Free-plan batch semantics test (docs/perf/FREE-PLAN-BRIEF.md
// §4): how D1's 50-queries-per-invocation limit counts batch() statements, and whether it
// applies per Durable Object fetch and alarm. Reached only through src/index.e2e.js with
// E2E_TEST_MODE=1, BUDGET_PROBE=1 and a BUDGET_PROBE binding - none exist in production.
const reply = (body, status = 200) => Response.json(body, { status, headers: { 'Cache-Control': 'private, no-store' } });

async function serial(db, n) {
  let ok = 0;
  try { for (; ok < n; ok++) await db.prepare('SELECT ?1 AS n').bind(ok).first(); return { ok }; }
  catch (e) { return { ok, error: String(e?.message || e).slice(0, 300) }; }
}
async function batch(db, n, write) {
  const t = Date.now();
  try {
    if (write) await db.prepare('CREATE TABLE IF NOT EXISTS budget_probe (id INTEGER PRIMARY KEY, v TEXT)').run();
    const list = Array.from({ length: n }, (_, i) => write ? db.prepare('INSERT INTO budget_probe (v) VALUES (?1)').bind('p' + i) : db.prepare('SELECT ?1 AS n').bind(i));
    const out = await db.batch(list);
    return { ok: true, statements: n, ms: Date.now() - t, rowsWritten: out.reduce((s, r) => s + (r.meta?.rows_written || 0), 0) };
  } catch (e) { return { ok: false, statements: n, ms: Date.now() - t, error: String(e?.message || e).slice(0, 300) }; }
}
// serial: 60 separate queries. batch: one batch() of 200 inserts. mix: a 200-statement batch
// followed by 60 separate queries - failing at separate query 50 means the batch counted once.
async function run(db, kind) {
  if (kind === 'serial') return serial(db, 60);
  if (kind === 'batch') return batch(db, 200, true);
  if (kind === 'mix') return { batch: await batch(db, 200, false), serial: await serial(db, 60) };
  if (kind === 'half') return serial(db, 45);
  // ceiling: where separate queries actually stop; big: a read-only batch the size of a
  // 25 x 20 self-paced flush (~1,500 statements), for its duration.
  if (kind === 'ceiling') return serial(db, 1100);
  if (kind === 'big') return batch(db, 1500, false);
  return null;
}

export async function budgetProbe(req, env) {
  if (env.E2E_TEST_MODE !== '1' || env.BUDGET_PROBE !== '1' || !env.BUDGET_PROBE_DO || req.method !== 'POST') return reply({ error: 'not found' }, 404);
  const kind = new URL(req.url).searchParams.get('kind') || '';
  const [where, what] = kind.split('-');
  if (where === 'worker') { const out = await run(env.DB, what); return out ? reply(out) : reply({ error: 'unknown kind' }, 400); }
  // chain: the Worker spends 45 queries, then asks a Durable Object to spend 45 more.
  if (kind === 'chain') {
    const worker = await serial(env.DB, 45);
    const room = await env.BUDGET_PROBE_DO.getByName('chain').fetch('https://probe.internal/?kind=half');
    return reply({ worker, object: await room.json() });
  }
  if (where === 'do') {
    const asked = new URL(req.url).searchParams.get('name') || '';
    const name = /^[a-z0-9-]{1,40}$/.test(asked) ? asked : kind + '-' + Date.now();
    const out = await env.BUDGET_PROBE_DO.getByName(name).fetch('https://probe.internal/?kind=' + what);
    return reply({ name, ...(await out.json()) }, out.status);
  }
  return reply({ error: 'unknown kind' }, 400);
}

export class BudgetProbe {
  constructor(ctx, env) { this.ctx = ctx; this.env = env; }
  async fetch(req) {
    const kind = new URL(req.url).searchParams.get('kind');
    // alarm: the first alarm runs 60 queries, the second (chained) runs 45; read back with result.
    if (kind === 'alarm') { await this.ctx.storage.put('alarms', []); await this.ctx.storage.setAlarm(Date.now() + 100); return reply({ scheduled: true }); }
    if (kind === 'result') return reply({ alarms: await this.ctx.storage.get('alarms') || [] });
    const out = await run(this.env.DB, kind);
    return out ? reply(out) : reply({ error: 'unknown kind' }, 400);
  }
  async alarm() {
    const done = await this.ctx.storage.get('alarms') || [];
    done.push(await serial(this.env.DB, done.length ? 45 : 60));
    await this.ctx.storage.put('alarms', done);
    if (done.length < 2) await this.ctx.storage.setAlarm(Date.now() + 100);
  }
}
