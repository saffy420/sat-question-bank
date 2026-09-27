// free-03 (docs/perf/FREE-PLAN-BRIEF.md §5): a lesson flush that D1 refuses loses nothing and
// duplicates nothing. Real SQLite (schema.sql) behind a D1-shaped shim whose batch() is a
// transaction, as D1's is; faults come through the real test-only wrapper (src/fault.js).
//   node --test tests/test_lesson_flush.cjs
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { DatabaseSync } = require('node:sqlite');
const { readFileSync } = require('node:fs');
const root = __dirname + '/../';
globalThis.WebSocketPair ??= function WebSocketPair() { const stub = () => ({ send() {}, close() {}, serializeAttachment() {} }); return { 0: stub(), 1: stub() }; };
const roomModule = () => import('../src/lesson-room.js');
const S = 25, Q = 20, SESSION = 7;
const sid = i => 's' + String(i).padStart(2, '0'), qid = i => 'q' + String(i).padStart(2, '0');

function d1(db, log) {
  const stmt = (sql, args = []) => ({
    sql, args, bind: (...a) => stmt(sql, a),
    all: async () => { log.queries++; return { results: db.prepare(sql).all(...args), meta: {} }; },
    first: async col => { log.queries++; const r = db.prepare(sql).get(...args); return r == null ? null : col ? r[col] : r; },
    run: async () => { log.queries++; return { meta: { changes: Number(db.prepare(sql).run(...args).changes) } }; },
    exec: () => db.prepare(sql).run(...args)
  });
  return {
    prepare: sql => stmt(sql),
    batch: async list => {
      log.batches.push(list.length);
      db.exec('BEGIN');
      try { for (const s of list) s.exec(); db.exec('COMMIT'); } catch (e) { db.exec('ROLLBACK'); throw e; }
      return list.map(() => ({ meta: {} }));
    }
  };
}
function storage() {
  const data = new Map();
  return { data,
    get: async k => structuredClone(data.get(k)), put: async (k, v) => { data.set(k, structuredClone(v)); }, delete: async k => data.delete(k),
    list: async ({ prefix = '' } = {}) => new Map([...data].filter(([k]) => k.startsWith(prefix))),
    setAlarm: async n => { data.set('alarm', n); }, deleteAlarm: async () => { data.delete('alarm'); }, getAlarm: async () => data.get('alarm') ?? null };
}
async function fixture(opts = {}) {
  const flag = 'flag' in opts ? opts.flag : '1';
  const { normalizeQuestion } = await import('../public/shared/stats.js');
  const { GRACE_MS } = await import('../public/shared/lesson.js');
  const db = new DatabaseSync(':memory:'); db.exec(readFileSync(root + 'schema.sql', 'utf8'));
  const choices = JSON.stringify([{ letter: 'A', content: 'a' }, { letter: 'B', content: 'b' }]);
  const questions = {};
  for (let i = 1; i <= Q; i++) {
    const row = { id: qid(i), section: 'Math', domain: 'Algebra', skill: 'Linear functions', difficulty: 'Medium', stem_html: '<p>x</p>', choices_json: choices, correct_answer: 'B', explanation_html: '', source: 'College Board' };
    db.prepare('INSERT INTO questions (id,section,domain,skill,difficulty,stem_html,choices_json,correct_answer,explanation_html,source) VALUES (?,?,?,?,?,?,?,?,?,?)')
      .run(...Object.values(row));
    questions[row.id] = normalizeQuestion(row);
  }
  db.exec("INSERT INTO users (id,email,name,role) VALUES ('teacher','t@x','Teacher','admin')");
  db.exec("INSERT INTO lessons (id,title,mode,created_by) VALUES (1,'Set','self','teacher')");
  db.prepare("INSERT INTO lesson_sessions (id,lesson_id,join_code,status,snapshot_json) VALUES (?,1,'ABCDEF','live','{}')").run(SESSION);
  const ids = Array.from({ length: Q }, (_, i) => qid(i + 1));
  const s = { id: SESSION, code: 'ABCDEF', title: 'Set', owner: 'teacher', mode: 'self', status: 'live', phase: 'ANSWERING',
    startedAt: Date.now() - 600000, endsAt: Date.now() - GRACE_MS - 1, index: 0, lockedJoin: false, kicked: [],
    items: ids.map(question_id => ({ question_id, time_limit_sec: 60, notes: '' })), questions,
    difficulty: Object.fromEntries(ids.map(id => [id, 'Medium'])), assigned: {}, positions: {}, submitted: {}, clock: {}, joinRemaining: {},
    reviewed: [], poll: null, pollResult: null, responses: {}, roster: {}, joinedAt: {} };
  for (let u = 1; u <= S; u++) {
    const user = sid(u);
    db.prepare("INSERT INTO users (id,email,name) VALUES (?,?,?)").run(user, user + '@x', user);
    db.prepare('INSERT INTO session_participants (session_id,user_id,assigned_question_ids_json) VALUES (?,?,?)').run(SESSION, user, JSON.stringify(ids));
    s.assigned[user] = ids; s.roster[user] = user; s.joinedAt[user] = Date.now();
    // Every other answer right; the first student leaves the last question blank (scorable → wrong).
    s.responses[user] = Object.fromEntries(ids.map((q, i) => [q, u === 1 && i === Q - 1 ? {} : { answer: (u + i) % 2 ? 'A' : 'B', ms: 30000, changes: 0, history: [] }]));
  }
  // A practice record the lesson moves exactly once.
  db.prepare("INSERT INTO progress (user_id,question_id,attempts,corrects,marker,last_reviewed,time_taken_ms) VALUES ('s01','q01',2,1,'Orange','2026-09-01T00:00:00Z',40000)").run();
  const log = { queries: 0, batches: [] }, sync = [];
  const env = { DB: d1(db, log), D1_FAULT_INJECTION: flag,
    LESSON_SYNC: { getByName: name => ({ fetch: async req => { sync.push([name, await req.json()]); return Response.json({ ok: true }); } }) } };
  const store = storage(), sockets = [], ctx = { storage: store, getWebSockets: () => sockets, acceptWebSocket() {} };
  const { LessonRoom } = await roomModule();
  const room = new LessonRoom(ctx, env);
  await room.save(s);
  const fault = (r, kind, after = 0) => r.fetch(new Request('https://lesson.internal/', { method: 'POST', headers: { 'X-Lesson-Internal': 'fault' }, body: JSON.stringify({ kind, after }) }));
  const count = (sql, ...args) => db.prepare(sql).get(...args).n;
  const counts = () => ({
    responses: count('SELECT COUNT(*) n FROM session_responses WHERE session_id=?', SESSION),
    attempts: count('SELECT COUNT(*) n FROM attempts WHERE lesson_session_id=?', SESSION),
    distinct: count('SELECT COUNT(*) n FROM (SELECT DISTINCT user_id, question_id FROM attempts WHERE lesson_session_id=?)', SESSION),
    progress: count('SELECT COUNT(*) n FROM progress'),
    moved: { ...db.prepare("SELECT attempts, corrects FROM progress WHERE user_id='s01' AND question_id='q01'").get() },
    status: db.prepare('SELECT status FROM lesson_sessions WHERE id=?').get(SESSION).status });
  return { db, env, ctx, store, sockets, room, log, sync, fault, counts, LessonRoom };
}
async function withClock(fn) {
  const real = Date.now; let now = real();
  Date.now = () => now;
  try { return await fn(ms => { now += ms; }, () => now); } finally { Date.now = real; }
}

test('25 × 20 write-back goes out in chunks of at most 500 statements and lands once', async () => {
  const f = await fixture();
  await f.room.alarm();
  const c = f.counts();
  assert.deepEqual(c, { responses: S * Q, attempts: S * Q, distinct: S * Q, progress: S * Q, moved: { attempts: 3, corrects: 1 }, status: 'review' });
  // 8 students × 60 statements per batch; the last carries the status update.
  assert.deepEqual(f.log.batches, [480, 480, 480, 61]);
  assert.ok(f.log.queries <= 35, `${f.log.queries} queries`);
  assert.equal(await f.store.get('pending'), undefined);
  assert.equal(await f.store.get('flushRetry'), undefined);
  assert.deepEqual(f.sync, [], 'nothing to report when nothing failed');
});

test('daily limit mid write-back: landed chunks stay, the rest waits in DO storage, eviction loses nothing, recovery lands each attempt once', async () => withClock(async (tick, now) => {
  const f = await fixture();
  await f.fault(f.room, 'quota', 1);                      // first chunk lands, then the write limit
  await f.room.alarm();
  let c = f.counts();
  assert.deepEqual([c.responses, c.attempts, c.status], [8 * Q, 8 * Q, 'live']);
  const pending = await f.store.get('pending');
  assert.deepEqual(pending.done, ['s01', 's02', 's03', 's04', 's05', 's06', 's07', 's08']);
  assert.equal(pending.rows.length, S * Q, 'every response is still held');
  const retry = await f.store.get('flushRetry');
  assert.deepEqual({ ...retry }, { kind: 'quota', failures: 1, since: now(), at: now() + 5000 });
  assert.equal(await f.store.getAlarm(), now() + 5000);
  assert.deepEqual(f.sync.at(-1), ['all', { sessionId: SESSION, at: now() + 5000, kind: 'quota', since: now() }]);
  assert.equal((await f.room.state()).phase, 'FINISHED');

  // A student's message during the wait tries D1 once, fails, and leaves the schedule alone.
  tick(1000);
  const reports = f.sync.length, sent = [];
  const ws = { deserializeAttachment: () => ({ userId: 's02', role: 'student' }), send: x => sent.push(JSON.parse(x)), close() {} };
  f.sockets.push(ws);
  await f.room.webSocketMessage(ws, JSON.stringify({ type: 'navigate', questionId: 'q01' }));
  assert.equal(sent.at(-1).error, 'persistence unavailable');
  assert.deepEqual({ ...await f.store.get('flushRetry') }, { ...retry });
  assert.equal(await f.store.getAlarm(), retry.at);
  assert.equal(f.sync.length, reports);

  // Retries from the alarm back off and never wait past a minute after 00:00 UTC. The clock is
  // moved to 22:00 UTC so the backoff runs into the reset.
  const { nextReset } = await import('../src/flush.js');
  tick(Date.UTC(2026, 8, 28, 22) - now());
  const steps = [];
  for (let n = 2; n <= 14; n++) {
    tick(Math.max(0, (await f.store.getAlarm()) - now()));
    const at = now();
    await f.room.alarm();
    const r = await f.store.get('flushRetry');
    assert.equal(r.failures, n);
    assert.equal(await f.store.getAlarm(), r.at);
    const backoff = Math.min(5000 * 2 ** (n - 1), 3600000), reset = nextReset(at) + 60000;
    assert.equal(r.at, Math.min(at + backoff, reset), `retry ${n}`);
    steps.push([new Date(at).toISOString().slice(11, 19), r.at === reset ? 'reset' : r.at - at]);
  }
  // 22:00 → doubling to an hour → the first retry after the reset is 00:01 UTC, then hourly.
  assert.deepEqual(steps.find(x => x[1] === 'reset'), ['23:25:10', 'reset']);
  assert.ok(steps.some(([t]) => t === '00:01:00'), JSON.stringify(steps));
  c = f.counts();
  assert.deepEqual([c.responses, c.attempts], [8 * Q, 8 * Q], 'failed retries land nothing twice');

  // The object is evicted mid-retry (its in-memory fault goes with it, as the quota resets):
  // a new instance over the same storage finishes from the alarm alone.
  tick((await f.store.getAlarm()) - now());
  const woken = new f.LessonRoom(f.ctx, f.env);
  await woken.alarm();
  c = f.counts();
  assert.deepEqual(c, { responses: S * Q, attempts: S * Q, distinct: S * Q, progress: S * Q, moved: { attempts: 3, corrects: 1 }, status: 'review' });
  assert.equal(await f.store.get('pending'), undefined);
  assert.equal(await f.store.get('flushRetry'), undefined);
  assert.deepEqual(f.sync.at(-1), ['all', { sessionId: SESSION, clear: true }]);

  // Replaying the whole original flush (as if D1 took it but the object died before recording
  // that) changes nothing: every statement is idempotent.
  const before = JSON.stringify([f.counts(), f.db.prepare('SELECT * FROM progress ORDER BY user_id, question_id').all(),
    f.db.prepare('SELECT * FROM attempts ORDER BY id').all(), f.db.prepare('SELECT * FROM session_responses ORDER BY user_id, question_id').all()]);
  await f.store.put('pending', { ...pending, done: [] });
  await woken.flush(await woken.state());
  const after = JSON.stringify([f.counts(), f.db.prepare('SELECT * FROM progress ORDER BY user_id, question_id').all(),
    f.db.prepare('SELECT * FROM attempts ORDER BY id').all(), f.db.prepare('SELECT * FROM session_responses ORDER BY user_id, question_id').all()]);
  assert.equal(after, before);
}));

test('overload backs off from 5 s to a 5-minute cap; other errors keep the 5 s retry', async () => withClock(async (tick, now) => {
  const f = await fixture();
  await f.fault(f.room, 'overload');
  const seen = [];
  for (let n = 1; n <= 9; n++) {
    await f.room.alarm();
    seen.push((await f.store.getAlarm()) - now());
    tick(seen.at(-1));
  }
  assert.deepEqual(seen, [5000, 10000, 20000, 40000, 80000, 160000, 300000, 300000, 300000]);
  assert.equal((await f.store.get('flushRetry')).kind, 'overload');
  assert.equal(f.counts().responses, 0);

  const g = await fixture();
  g.env.DB.batch = async () => { throw new Error('D1_ERROR: UNIQUE constraint failed: session_responses.session_id'); };
  for (let n = 1; n <= 3; n++) {
    await g.room.alarm();
    assert.equal((await g.store.getAlarm()) - now(), 5000);
    assert.deepEqual([(await g.store.get('flushRetry')).kind, (await g.store.get('flushRetry')).failures], ['other', n]);
    tick(5000);
  }
}));

test('instructor-paced boundary: one batch as before; a refused flush keeps the question until D1 takes it', async () => withClock(async (tick, now) => {
  const f = await fixture();
  const s = await f.room.state();
  Object.assign(s, { mode: undefined, phase: 'ANSWERING', index: 0 });
  delete s.mode; await f.room.save(s);
  await f.fault(f.room, 'quota');
  await f.room.alarm();
  assert.equal((await f.room.state()).phase, 'REVEALED');
  assert.equal((await f.store.get('pending')).rows.length, S);
  assert.equal((await f.store.get('flushRetry')).kind, 'quota');
  await f.fault(f.room, null);
  tick(5000);
  await f.room.alarm();
  assert.equal(f.counts().responses, S);
  assert.equal(f.counts().attempts, 0, 'instructor-paced lessons write no practice attempts');
  assert.deepEqual(f.log.batches.slice(-1), [S]);
  assert.equal(await f.store.get('flushRetry'), undefined);
}));

test('fault flag off: the fault route is the room\'s 404 and writes go straight to D1', async () => {
  for (const flag of [undefined, '', '0', 'true', 1]) {
    const f = await fixture({ flag });
    const res = await f.fault(f.room, 'quota');
    assert.equal(res.status, 404);
    assert.equal(await res.text(), 'not found');
    await f.room.alarm();
    assert.equal(f.counts().responses, S * Q, String(flag));
  }
});

test('sync registry: rooms report and clear; GET lists; bad bodies refused; internal header required', async () => {
  const { LessonSync } = await import('../src/lesson-sync.js');
  const sync = new LessonSync({ storage: storage() });
  const call = (method, body, header = 'sync') => sync.fetch(new Request('https://lesson.internal/', { method, headers: header ? { 'X-Lesson-Internal': header } : {}, body: body && JSON.stringify(body) }));
  assert.equal((await call('GET', null, null)).status, 404);
  assert.equal((await call('GET', null, 'room')).status, 404);
  assert.deepEqual(await (await call('GET')).json(), { pending: [] });
  assert.equal((await call('POST', { sessionId: 9, at: 2, kind: 'quota', since: 1 })).status, 200);
  assert.equal((await call('POST', { sessionId: 3, at: 5, kind: 'overload', since: 4, extra: 'dropped' })).status, 200);
  assert.deepEqual(await (await call('GET')).json(), { pending: [{ sessionId: 3, at: 5, kind: 'overload', since: 4 }, { sessionId: 9, at: 2, kind: 'quota', since: 1 }] });
  for (const bad of [{ sessionId: '9', clear: true }, { sessionId: 0, clear: true }, { sessionId: 4, at: 'x', kind: 'quota', since: 1 }, { sessionId: 4, at: 1, kind: 'nope', since: 1 }])
    assert.equal((await call('POST', bad)).status, 400);
  await call('POST', { sessionId: 9, clear: true });
  assert.deepEqual((await (await call('GET')).json()).pending.map(p => p.sessionId), [3]);
  assert.equal((await call('PUT', {})).status, 404);
});
