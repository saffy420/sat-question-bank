// Session results: GET /api/admin/sessions/:id/results and the Past sessions summary (joined, class average).
//   node --test tests/test_session_results.cjs
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { DatabaseSync } = require('node:sqlite');
const { readFileSync } = require('node:fs');
const schema = readFileSync(__dirname + '/../schema.sql', 'utf8');
const origin = 'https://roadto1600.org';

function d1(db) {
  const sql = (query, args = []) => ({ bind: (...values) => sql(query, values), first: async () => db.prepare(query).get(...args) || null,
    all: async () => ({ results: db.prepare(query).all(...args) }),
    run: async () => { const stmt = db.prepare(query); if (stmt.columns().length) return { results: stmt.all(...args), meta: { changes: 0 } }; const r = stmt.run(...args); return { results: [], meta: { changes: Number(r.changes), last_row_id: Number(r.lastInsertRowid) } }; } });
  return { prepare: sql, batch: async statements => { const out = []; for (const s of statements) out.push(await s.run()); return out; } };
}
const MC = (id, answer, skill, difficulty) => `('${id}','Math','Algebra','${skill}','${difficulty}','<p>${id} stem</p>','[{"letter":"A","content":"a"},{"letter":"B","content":"b"},{"letter":"C","content":"c"}]','${answer}','<p>E</p>','OFFICIAL')`;
const COLS = 'id,section,domain,skill,difficulty,stem_html,choices_json,correct_answer,explanation_html,source';
const items = [{ question_id: 'qA', time_limit_sec: 60, notes: 'Start with **slope**' }, { question_id: 'qB', time_limit_sec: 60, notes: '' }, { question_id: 'qU', time_limit_sec: 60, notes: '' }];

async function world(t) {
  const db = new DatabaseSync(':memory:'); db.exec(schema);
  // qB lives in the AI bank: results read both.
  const ai = new DatabaseSync(':memory:'); ai.exec(`CREATE TABLE questions (id TEXT PRIMARY KEY, section TEXT, domain TEXT, skill TEXT, difficulty TEXT, stem_html TEXT, choices_json TEXT, correct_answer TEXT, explanation_html TEXT, source TEXT)`);
  db.exec(`INSERT INTO questions(${COLS}) VALUES ${MC('qA', 'B', 'Linear functions', 'Easy')},${MC('qU', '', 'Ratios', 'Medium')};
    INSERT INTO users(id,email,name,role) VALUES('teacher','t@ccs.us','Teacher','admin'),('alice','a@ccs.us','Alice A','student'),('bob','bob@ccs.us',NULL,'student');
    INSERT INTO membership(user_id,email,status) VALUES('teacher','t@ccs.us','approved'),('alice','a@ccs.us','approved'),('bob','bob@ccs.us','approved');
    INSERT INTO lessons(id,title,mode,created_by) VALUES(1,'Paced','instructor','teacher');`);
  ai.exec(`INSERT INTO questions(${COLS}) VALUES ${MC('qB', 'A', 'Systems', 'Hard')}`);
  t.after(() => { db.close(); ai.close(); });
  const env = { DB: d1(db), AI_DB: d1(ai), ASSETS: { fetch: async () => new Response('asset') } };
  const { handleRequest } = await import('../src/index.js');
  const who = { 'Bearer teacher': { id: 'teacher', email: 't@ccs.us' }, 'Bearer alice': { id: 'alice', email: 'a@ccs.us' } };
  const get = (path, token = 'teacher') => handleRequest(new Request(origin + path, { headers: token ? { Authorization: 'Bearer ' + token } : {} }), env, async req => who[req.headers.get('Authorization')] || null);
  return { db, get };
}
// Session 15, ended: alice right on qA and qB, answered the unscorable qU; bob wrong on qA, blank on qB and qU;
// zed joined (no users row) and answered nothing.
function seed(db, { id = 15, status = 'ended', timing = JSON.stringify({ qA: { explainMs: 133000, answerMs: 40000 }, qB: { explainMs: 5000, answerMs: 30000 } }) } = {}) {
  db.prepare(`INSERT INTO lesson_sessions(id,lesson_id,join_code,status,created_at,started_at,ended_at,snapshot_json,timing_json) VALUES(?,1,?,?,'2026-10-01 09:58:00','2026-10-01 10:00:00',?,?,?)`)
    .run(id, 'CODE' + id, status, status === 'ended' ? '2026-10-01 10:25:30' : null, JSON.stringify({ title: 'Paced', mode: 'instructor', items }), timing);
  for (const user of ['alice', 'bob', 'zed']) db.prepare(`INSERT INTO session_participants(session_id,user_id,joined_at,assigned_question_ids_json) VALUES(?,?,'2026-10-01 10:00:0${user.length}',?)`).run(id, user, JSON.stringify(items.map(x => x.question_id)));
  const r = db.prepare('INSERT INTO session_responses(session_id,user_id,question_id,final_answer,is_correct,locked_early,time_spent_ms,answer_changes) VALUES(?,?,?,?,?,?,?,?)');
  r.run(id, 'alice', 'qA', 'B', 1, 1, 12000, 0); r.run(id, 'alice', 'qB', 'A', 1, 0, 8000, 1); r.run(id, 'alice', 'qU', 'C', null, 0, 3000, 0);
  r.run(id, 'bob', 'qA', 'A', 0, 0, 20000, 2); r.run(id, 'bob', 'qB', null, 0, 0, 30000, 0); r.run(id, 'bob', 'qU', null, null, 0, 30000, 0);
  for (const q of ['qA', 'qB', 'qU']) db.prepare('INSERT INTO question_lesson_usage(question_id,session_id) VALUES(?,?)').run(q, id);
}

test('results route is admin only; unknown is 404, a running session 409', async t => {
  const { db, get } = await world(t);
  seed(db); seed(db, { id: 16, status: 'live', timing: null });
  assert.equal((await get('/api/admin/sessions/15/results', null)).status, 401);
  assert.equal((await get('/api/admin/sessions/15/results', 'alice')).status, 403);
  assert.equal((await get('/api/admin/sessions/99/results')).status, 404);
  const running = await get('/api/admin/sessions/16/results');
  assert.equal(running.status, 409);
  assert.deepEqual(await running.json(), { error: 'session still running' });
  assert.equal((await get('/api/admin/sessions/15/results')).status, 200);
  assert.equal((await get('/api/admin/sessions/00015/results')).status, 200, 'the padded ID works too');
});

test('results numbers: scores, per-student rows, per-question counts, timing, names fall back', async t => {
  const { db, get } = await world(t);
  seed(db);
  const res = await get('/api/admin/sessions/15/results');
  assert.equal(res.status, 200, await res.clone().text());
  const r = await res.json();
  assert.deepEqual(r.session, { id: 15, paddedId: '00015', lesson_id: 1, title: 'Paced', mode: 'instructor', join_code: 'CODE15',
    created_at: '2026-10-01 09:58:00', started_at: '2026-10-01 10:00:00', ended_at: '2026-10-01 10:25:30', durationMs: 1530000, timed: true });
  assert.deepEqual(r.students.map(s => [s.userId, s.name, s.right, s.scorable, s.answered, s.totalMs]), [
    ['alice', 'Alice A', 2, 2, 3, 23000], ['bob', 'bob@ccs.us', 0, 2, 1, 80000], ['zed', 'zed', 0, 0, 0, 0]], 'sorted by score; name → email → id');
  const bob = r.students[1];
  assert.deepEqual(bob.rows, [
    { questionId: 'qA', recorded: true, answer: 'A', correct: false, timeMs: 20000, changes: 2, lockedEarly: false },
    { questionId: 'qB', recorded: true, answer: null, correct: false, timeMs: 30000, changes: 0, lockedEarly: false },
    { questionId: 'qU', recorded: true, answer: null, correct: null, timeMs: 30000, changes: 0, lockedEarly: false }]);
  assert.equal(r.students[0].rows[0].lockedEarly, true);
  assert.deepEqual(r.students[2].rows.map(x => [x.questionId, x.recorded, x.timeMs]), [['qA', false, null], ['qB', false, null], ['qU', false, null]]);
  const q = Object.fromEntries(r.questions.map(x => [x.questionId, x]));
  assert.deepEqual(r.questions.map(x => x.number), [1, 2, 3], 'lesson order');
  assert.deepEqual([q.qA.skill, q.qA.difficulty, q.qA.correctAnswer, q.qA.notes, q.qB.skill, q.qB.correctAnswer], ['Linear functions', 'Easy', 'B', 'Start with **slope**', 'Systems', 'A']);
  assert.deepEqual([q.qA.right, q.qA.wrong, q.qA.blank, q.qA.avgMs, q.qA.explainMs, q.qA.answerMs], [1, 1, 0, 16000, 133000, 40000]);
  assert.deepEqual([q.qB.right, q.qB.wrong, q.qB.blank, q.qB.avgMs, q.qB.explainMs], [1, 0, 1, 19000, 5000]);
  assert.deepEqual([q.qU.scorable, q.qU.right, q.qU.wrong, q.qU.blank, q.qU.explainMs, q.qU.answerMs], [false, 0, 0, 1, null, null], 'never revealed: no time');
  assert.deepEqual(q.qA.distribution.map(g => [g.label, g.count, g.correct]), [['A', 1, false], ['B', 1, true], ['C', 0, false], ['blank', 0, false]]);
  assert.deepEqual(r.average, { right: 1, scorable: 2, percent: 0.5 }, 'zed has nothing scorable and is left out');
});

test('an old session without timing_json still reads; explain time is null', async t => {
  const { db, get } = await world(t);
  seed(db, { timing: null });
  const r = await (await get('/api/admin/sessions/15/results')).json();
  assert.equal(r.session.timed, false);
  assert.deepEqual(r.questions.map(x => [x.explainMs, x.answerMs]), [[null, null], [null, null], [null, null]]);
  assert.equal(r.students.length, 3);
});

test('past sessions list carries the joined count and class average', async t => {
  const { db, get } = await world(t);
  seed(db); seed(db, { id: 16, status: 'live', timing: null });
  db.prepare("INSERT INTO lesson_sessions(id,lesson_id,join_code,status,snapshot_json) VALUES(17,1,'EMPTY1','ended','{}')").run();
  const rows = await (await get('/api/admin/lessons/1/sessions')).json();
  assert.deepEqual(rows.map(s => [s.id, s.joined, s.average]), [[17, 0, null], [16, 3, { right: 1, scorable: 2, percent: 0.5 }], [15, 3, { right: 1, scorable: 2, percent: 0.5 }]]);
});

test('0013 and 0014 upgrade an existing database and match the fresh snapshot', () => {
  const migration = readFileSync(__dirname + '/../migrations/0014_session_timing.sql', 'utf8');
  const old = schema.replace(/^-- 0013_saved_questions\.sql[\s\S]*?CREATE TABLE IF NOT EXISTS saved_questions \([\s\S]*?\);\r?\n/m, '')
    .replace(/^  -- 0014_session_timing\.sql.*\r?\n  timing_json TEXT\r?\n/m, '').replace(/snapshot_json TEXT NOT NULL,(\r?\n\);)/, 'snapshot_json TEXT NOT NULL$1');
  assert.notEqual(old, schema);
  const db = new DatabaseSync(':memory:'); db.exec(old);
  assert.equal(db.prepare('PRAGMA table_info(lesson_sessions)').all().some(c => c.name === 'timing_json'), false);
  db.exec("INSERT INTO lessons(id,title,mode,created_by) VALUES(1,'L','instructor','t'); INSERT INTO lesson_sessions(lesson_id,join_code,snapshot_json) VALUES(1,'ABCDEF','{}')");
  db.exec(readFileSync(__dirname + '/../migrations/0013_saved_questions.sql', 'utf8'));
  db.exec(migration);
  assert.equal(db.prepare('SELECT timing_json FROM lesson_sessions').get().timing_json, null, 'existing sessions read as untimed');
  assert.throws(() => db.exec(migration), /duplicate column/);
  const fresh = new DatabaseSync(':memory:'); fresh.exec(schema);
  const shape = d => ['saved_questions', 'lesson_sessions'].map(name => d.prepare(`PRAGMA table_info(${name})`).all().map(c => [c.name, c.type, c.notnull, c.dflt_value, c.pk]));
  assert.deepEqual(shape(db), shape(fresh));
  db.close(); fresh.close();
});
