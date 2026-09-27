// Free-plan budget trace (docs/perf/FREE-PLAN-BRIEF.md §4). Off unless the Worker's
// BUDGET_TRACE var is exactly '1': then every D1 call of one invocation is counted at
// the binding and printed as one `BUDGET_TRACE {json}` line. Off, the env object is
// handed back untouched, so production pays nothing and nothing can change.
const D1 = ['DB', 'AI_DB'];
export const budgetOn = env => env?.BUDGET_TRACE === '1';

export function traceEnv(env, kind, label = '') {
  if (!budgetOn(env)) return { env, trace: null, done: () => null };
  const trace = { kind, label, queries: 0, batches: 0, batchStatements: [], statements: 0, rowsRead: 0, rowsWritten: 0,
    d1Ms: 0, byBinding: {}, errors: [] };
  const start = Date.now();
  const wrapped = Object.create(env);
  for (const name of D1) if (env[name]) Object.defineProperty(wrapped, name, { value: tracedDb(env[name], name, trace), enumerable: true });
  const done = (extra = {}) => {
    Object.assign(trace, extra, { wallMs: Date.now() - start });
    console.log('BUDGET_TRACE ' + JSON.stringify(trace));
    return trace;
  };
  return { env: wrapped, trace, done };
}

function note(trace, binding, meta, ms, statements, batch) {
  const b = trace.byBinding[binding] ||= { queries: 0, batches: 0, statements: 0, rowsRead: 0, rowsWritten: 0 };
  const read = meta.reduce((n, m) => n + (m?.rows_read || 0), 0), written = meta.reduce((n, m) => n + (m?.rows_written || 0), 0);
  if (batch) { trace.batches++; b.batches++; trace.batchStatements.push(statements); } else { trace.queries++; b.queries++; }
  trace.statements += statements; b.statements += statements;
  trace.rowsRead += read; trace.rowsWritten += written; b.rowsRead += read; b.rowsWritten += written;
  trace.d1Ms += ms;
}
async function timed(trace, binding, statements, batch, call, metaOf) {
  const t = Date.now();
  try {
    const out = await call();
    note(trace, binding, metaOf(out), Date.now() - t, statements, batch);
    return out;
  } catch (e) {
    note(trace, binding, [], Date.now() - t, statements, batch);
    trace.errors.push(String(e?.message || e).slice(0, 200));
    throw e;
  }
}

function tracedDb(db, binding, trace) {
  const statement = inner => ({
    inner,
    bind: (...args) => statement(inner.bind(...args)),
    run: () => timed(trace, binding, 1, false, () => inner.run(), r => [r?.meta]),
    all: () => timed(trace, binding, 1, false, () => inner.all(), r => [r?.meta]),
    raw: options => timed(trace, binding, 1, false, () => inner.raw(options), () => []),
    // workerd's first() runs the whole query and keeps row 0; all() does the same work
    // and also returns meta. Column lookup and its error match first(colName).
    first: colName => timed(trace, binding, 1, false, () => inner.all(), r => [r?.meta]).then(r => {
      const row = r.results?.[0];
      if (!row) return null;
      if (colName === undefined) return row;
      if (row[colName] === undefined) throw new Error(`D1_COLUMN_NOTFOUND: Column not found (${colName})`);
      return row[colName];
    })
  });
  return {
    prepare: sql => statement(db.prepare(sql)),
    batch: list => timed(trace, binding, list.length, true, () => db.batch(list.map(s => s.inner || s)), r => (r || []).map(x => x?.meta)),
    exec: sql => timed(trace, binding, 1, false, () => db.exec(sql), () => []),
    dump: () => db.dump(),
    withSession: (...args) => db.withSession(...args)
  };
}

// One trace per Durable Object event. D1 work from two events interleaved on the same
// object is attributed to whichever started last (this.env is per object, not per event).
const EVENTS = ['fetch', 'alarm', 'webSocketMessage', 'webSocketClose', 'webSocketError'];
export function traceDurableObject(Base) {
  class Traced extends Base {
    constructor(ctx, env) { super(ctx, env); this.budgetEnv = env; }
  }
  for (const event of EVENTS) {
    if (typeof Base.prototype[event] !== 'function') continue;
    Traced.prototype[event] = async function (...args) {
      if (!budgetOn(this.budgetEnv)) return Base.prototype[event].apply(this, args);
      let label = '';
      if (event === 'webSocketMessage') try { label = JSON.parse(args[1]).type || ''; } catch { /* not JSON */ }
      if (event === 'fetch') label = args[0].headers.get('Upgrade') ? 'upgrade' : 'post';
      const t = traceEnv(this.budgetEnv, 'do.' + event, label);
      this.env = t.env;
      try { return await Base.prototype[event].apply(this, args); }
      finally { t.done(); }
    };
  }
  Object.defineProperty(Traced, 'name', { value: Base.name });
  return Traced;
}
