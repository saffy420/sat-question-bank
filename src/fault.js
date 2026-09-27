// Test-only D1 fault injection for the lesson room (docs/perf/FREE-PLAN-BRIEF.md §5 free-03).
// Inert unless the Worker's D1_FAULT_INJECTION var is exactly '1', which only local wrangler dev
// runs set (tools/budget_measure.cjs); no wrangler config sets it. Off, every event goes straight
// to the room. On, `POST X-Lesson-Internal: fault {kind, after}` makes this object's D1 writes
// (batch() and run()) fail with Cloudflare's documented message after `after` more writes; reads pass.
export const FAULT_MESSAGES = {
  quota: "D1_ERROR: Your account has exceeded D1's free tier daily row write limit. Upgrade to a paid plan or wait until tomorrow (midnight UTC)",
  overload: 'D1_ERROR: D1 DB is overloaded. Too many requests queued.'
};
export const faultOn = env => env?.D1_FAULT_INJECTION === '1';
const EVENTS = ['fetch', 'alarm', 'webSocketMessage', 'webSocketClose', 'webSocketError'];

function faultyDb(db, fault) {
  const write = call => {
    if (fault.after > 0) { fault.after--; return call(); }
    return Promise.reject(new Error(FAULT_MESSAGES[fault.kind]));
  };
  const statement = inner => ({
    inner,
    bind: (...args) => statement(inner.bind(...args)),
    run: () => write(() => inner.run()),
    all: () => inner.all(),
    raw: options => inner.raw(options),
    first: colName => inner.first(colName)
  });
  return {
    prepare: sql => statement(db.prepare(sql)),
    batch: list => write(() => db.batch(list.map(s => s.inner || s))),
    exec: sql => write(() => db.exec(sql)),
    dump: () => db.dump(),
    withSession: (...args) => db.withSession(...args)
  };
}

export function faultInjection(Base) {
  class Faulty extends Base {}
  for (const event of EVENTS) {
    if (typeof Base.prototype[event] !== 'function') continue;
    Faulty.prototype[event] = async function (...args) {
      if (!faultOn(this.env)) return Base.prototype[event].apply(this, args);
      if (event === 'fetch' && args[0].headers.get('X-Lesson-Internal') === 'fault') {
        const { kind = null, after = 0 } = await args[0].json();
        this.fault = FAULT_MESSAGES[kind] ? { kind, after: Math.max(0, after | 0) } : null;
        return Response.json({ fault: this.fault });
      }
      if (!this.fault) return Base.prototype[event].apply(this, args);
      const env = this.env, wrapped = Object.create(env);
      Object.defineProperty(wrapped, 'DB', { value: faultyDb(env.DB, this.fault), enumerable: true });
      this.env = wrapped;
      try { return await Base.prototype[event].apply(this, args); }
      finally { if (this.env === wrapped) this.env = env; }
    };
  }
  Object.defineProperty(Faulty, 'name', { value: Base.name });
  return Faulty;
}
