const { test } = require('node:test');
const assert = require('node:assert/strict');
const { DatabaseSync } = require('node:sqlite');
const { readFileSync } = require('node:fs');
const schema = readFileSync(__dirname + '/../schema.sql', 'utf8');
const migration = readFileSync(__dirname + '/../migrations/0008_lessons.sql', 'utf8');
const origin = 'https://roadto1600.org';

test('0008 works on fresh and pre-0008 upgrade; constraints and partial code uniqueness', () => {
  for (const upgrade of [false, true]) {
    const db = new DatabaseSync(':memory:'); db.exec(upgrade ? schema.slice(0, schema.indexOf('-- 0008_lessons.sql')) : schema);
    if (upgrade) { db.exec("INSERT INTO questions(id) VALUES('old')"); db.exec(migration); assert.ok(db.prepare("SELECT id FROM questions WHERE id='old'").get()); }
    db.exec('PRAGMA foreign_keys=ON');
    assert.deepEqual(db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name IN ('lessons','lesson_questions','lesson_sessions','session_participants','session_responses','session_question_review','session_polls','question_lesson_usage') ORDER BY name").all().map(r => r.name),
      ['lesson_questions','lesson_sessions','lessons','question_lesson_usage','session_participants','session_polls','session_question_review','session_responses']);
    assert.throws(() => db.exec(migration), /already exists/);
    db.exec("INSERT INTO lessons(title,mode,created_by) VALUES('One','self','admin'); INSERT INTO lesson_questions VALUES(1,0,'old',60,''); INSERT INTO lesson_sessions(lesson_id,join_code,snapshot_json) VALUES(1,'ABCDEF','{}')");
    db.exec("INSERT INTO session_participants(session_id,user_id,assigned_question_ids_json) VALUES(1,'student','[\"old\"]')");
    assert.throws(() => db.exec("INSERT INTO session_participants(session_id,user_id,assigned_question_ids_json) VALUES(1,'student','[]')"), /UNIQUE/);
    assert.throws(() => db.exec("INSERT INTO session_participants(session_id,user_id,assigned_question_ids_json) VALUES(999,'student','[]')"), /FOREIGN KEY/);
    db.exec("INSERT INTO session_responses(session_id,user_id,question_id) VALUES(1,'student','old')");
    assert.throws(() => db.exec("INSERT INTO session_responses(session_id,user_id,question_id) VALUES(1,'student','old')"), /UNIQUE/);
    assert.throws(() => db.exec("INSERT INTO session_responses(session_id,user_id,question_id) VALUES(1,'other','old')"), /FOREIGN KEY/);
    const response = db.prepare("SELECT final_answer,is_correct,answer_history_json FROM session_responses WHERE session_id=1").get();
    assert.equal(response.final_answer, null); assert.equal(response.is_correct, null); assert.equal(response.answer_history_json, null);
    db.exec("INSERT INTO session_question_review(session_id,question_id) VALUES(1,'old'); INSERT INTO session_polls(session_id,poll_index,options_json,votes_json) VALUES(1,0,'[]','{}')");
    assert.throws(() => db.exec("INSERT INTO session_question_review(session_id,question_id) VALUES(1,'old')"), /UNIQUE/);
    assert.throws(() => db.exec("INSERT INTO session_polls(session_id,poll_index,options_json,votes_json) VALUES(1,0,'[]','{}')"), /UNIQUE/);
    assert.throws(() => db.exec("INSERT INTO lesson_sessions(lesson_id,join_code,snapshot_json) VALUES(1,'ABCDEF','{}')"), /UNIQUE/);
    db.exec("UPDATE lesson_sessions SET status='ended' WHERE id=1; INSERT INTO lesson_sessions(lesson_id,join_code,snapshot_json) VALUES(1,'ABCDEF','{}')");
    assert.throws(() => db.exec("INSERT INTO lesson_questions VALUES(1,1,'other',4,'')"), /CHECK/);
    db.close();
  }
});

let seq = 0;
async function fixture(t) {
  const db = new DatabaseSync(':memory:'); db.exec(schema);
  db.exec("INSERT INTO questions(id,section,domain,skill,difficulty,stem_html) VALUES('q1','Math','Algebra','Linear functions','Easy','linear stem'),('q2','Math','Algebra','Linear equations in one variable','Hard','other stem'),('q3','Math','Advanced Math','Nonlinear functions','Medium','advanced'),('q4','Reading & Writing','Craft and Structure','Words in Context','Easy','words'); INSERT INTO ai_ids(id) VALUES('ai1'); INSERT INTO users(id,email,role) VALUES('student','student@ccs.us','student'); INSERT INTO membership(user_id,email,status) VALUES('student','student@ccs.us','approved')");
  const sql = (query, args = []) => ({ bind: (...values) => sql(query, values), first: async () => db.prepare(query).get(...args) || null,
    all: async () => ({ results: db.prepare(query).all(...args) }), run: async () => { const stmt = db.prepare(query); if (stmt.columns().length) return { results: stmt.all(...args), meta: { changes: 0 } }; const r = stmt.run(...args); return { results: [], meta: { changes: Number(r.changes), last_row_id: Number(r.lastInsertRowid) } }; } });
  const env = { DB: { prepare: sql, batch: async statements => { db.exec('BEGIN'); try { const out = []; for (const s of statements) out.push(await s.run()); db.exec('COMMIT'); return out; } catch(e) { db.exec('ROLLBACK'); throw e; } } }, AI_DB: { prepare: () => ({ all: async () => ({ results: [] }) }) }, ASSETS: { fetch: async () => new Response('asset') } };
  const { handleRequest } = await import('../src/index.js');
  const id = 'lesson-admin-' + ++seq;
  db.prepare("INSERT INTO users(id,email,role) VALUES(?,'admin@ccs.us','admin')").run(id);
  db.prepare("INSERT INTO membership(user_id,email,status) VALUES(?,'admin@ccs.us','approved')").run(id);
  const request = (path, token = 'admin', method = 'GET', body) => handleRequest(new Request(origin + path, { method, headers: { ...(token ? { Authorization: 'Bearer ' + token } : {}), ...(method !== 'GET' ? { Origin: origin } : {}) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) }), env, async req => req.headers.get('Authorization') === 'Bearer admin' ? { id, email: 'admin@ccs.us' } : req.headers.get('Authorization') === 'Bearer student' ? { id: 'student', email: 'student@ccs.us' } : null);
  t.after(() => db.close()); return { db, env, id, request };
}
const body = { title: 'Lesson', mode: 'instructor', items: [{ question_id: 'q1', time_limit_sec: 60, notes: '<script>alert(1)</script> \\(x\\)' }, { question_id: 'ai1', time_limit_sec: 90, notes: '' }] };
const data = async response => { assert.equal(response.status, 200, await response.clone().text()); return response.json(); };

test('role gates, invalid payloads, unknown routes, DB failure', async t => {
  const { db, request } = await fixture(t);
  for (const path of ['/api/admin/questions','/api/admin/lessons','/api/admin/lessons/1/sessions']) {
    assert.equal((await request(path, null)).status, 401);
    assert.equal((await request(path, 'student')).status, 403);
  }
  assert.equal((await request('/api/admin/absent')).status, 404);
  assert.equal((await request('/api/admin/lessons/1/absent')).status, 404);
  for (const bad of [{ ...body, items: [body.items[0],body.items[0]] }, { ...body, items: [{ ...body.items[0], time_limit_sec: 4 }] }, { ...body, items: [{ ...body.items[0], question_id: 'missing' }] }, { ...body, title: '' }, { ...body, mode: 'bad' }, { ...body, items: [{ ...body.items[0], notes: 'x'.repeat(4001) }] }]) assert.equal((await request('/api/admin/lessons','admin','POST',bad)).status, 400);
  assert.equal((await request('/api/admin/lessons/0')).status,400);
  assert.equal((await request('/api/admin/questions?page=0')).status,400);
  assert.equal((await request('/api/admin/questions?difficulty=Impossible')).status,400);
  assert.equal((await request('/api/admin/questions?domain='.concat('x'.repeat(151)))).status,400);
  db.exec('DROP TABLE lessons'); assert.equal((await request('/api/admin/lessons')).status,503);
});

test('save, replace, duplicate, session snapshot stays frozen, collisions retry, usage badges oldest-first', async t => {
  const { db, request } = await fixture(t);
  const created = await data(await request('/api/admin/lessons','admin','POST',body));
  const id = created.id;
  assert.deepEqual((await data(await request(`/api/admin/lessons/${id}`))).items, body.items);
  const copy = await data(await request(`/api/admin/lessons/${id}/duplicate`,'admin','POST'));
  assert.equal((await data(await request(`/api/admin/lessons/${copy.id}`))).items.length,2);
  const nativeCrypto = Object.getOwnPropertyDescriptor(globalThis, 'crypto');
  let calls = 0;
  Object.defineProperty(globalThis, 'crypto', { configurable: true, value: { getRandomValues: array => { array.fill(calls++ ? 1 : 0); return array; } } });
  t.after(() => { if (nativeCrypto) Object.defineProperty(globalThis, 'crypto', nativeCrypto); else delete globalThis.crypto; });
  db.prepare("INSERT INTO lesson_sessions(lesson_id,join_code,snapshot_json) VALUES(?,'AAAAAA','{}')").run(id);
  const session = await data(await request(`/api/admin/lessons/${id}/sessions`,'admin','POST'));
  assert.match(session.joinCode,/^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{6}$/);
  assert.equal(session.joinCode,'BBBBBB'); assert.equal(session.paddedId,String(session.sessionId).padStart(5,'0'));
  const frozen = db.prepare('SELECT snapshot_json FROM lesson_sessions WHERE id=?').get(session.sessionId).snapshot_json;
  assert.deepEqual(JSON.parse(frozen), { title: body.title, mode: body.mode, items: body.items });
  assert.equal((await request(`/api/admin/lessons/${id}`,'admin','PUT',{ ...body, items: [body.items[0],body.items[0]] })).status,400);
  assert.equal((await request(`/api/admin/lessons/${id}`,'admin','PUT',{ title: 'Edited', mode: 'self', items: [{ ...body.items[0], notes: 'updated', time_limit_sec: 120 }] })).status,200);
  assert.equal(db.prepare('SELECT snapshot_json FROM lesson_sessions WHERE id=?').get(session.sessionId).snapshot_json,frozen);
  assert.equal((await data(await request(`/api/admin/lessons/${id}`))).items[0].notes,'updated');

  db.prepare('INSERT INTO question_lesson_usage(question_id,session_id) VALUES(?,?)').run('q1',session.sessionId);
  db.prepare('INSERT INTO question_lesson_usage(question_id,session_id) VALUES(?,?)').run('q1',1);
  const list = await data(await request('/api/admin/questions?domain=Algebra&domain=Advanced%20Math&difficulty=Easy&difficulty=Medium'));
  assert.deepEqual(list.questions.map(q => q.id),['q1','q3']);
  assert.deepEqual(list.questions[0].usedInLesson,['00001',session.paddedId]);
  assert.deepEqual((await data(await request('/api/admin/questions?lessonUsage=hide-all'))).questions.map(q => q.id).includes('q1'),false);
  assert.deepEqual(list.skillsByDomain.Algebra,['Linear equations in one variable','Linear functions']);
  assert.equal((await data(await request('/api/admin/lessons'))).find(l => l.id === id).timesRun >= 1,true);
  assert.equal((await data(await request(`/api/admin/lessons/${id}/sessions`))).length,2);
});

test('approved lesson GET reaches room; pending membership stays blocked', async t => {
  const { db, env, id, request } = await fixture(t);
  const created = await data(await request('/api/admin/lessons', 'admin', 'POST', { ...body, items: [body.items[0]] }));
  const session = await data(await request(`/api/admin/lessons/${created.id}/sessions`, 'admin', 'POST'));
  env.LESSON_ROOM = { getByName: name => {
    assert.equal(name, String(session.sessionId));
    return { fetch: async req => {
      assert.equal(req.method, 'POST');
      assert.deepEqual(await req.json(), { sessionId: session.sessionId, userId: id,
        role: 'admin', name: 'admin@ccs.us', ws: false, join: false, clientId: null, desmosKey: null });
      return Response.json({ phase: 'READY' });
    } };
  } };
  assert.deepEqual(await data(await request(`/api/lessons/${session.sessionId}`)), { phase: 'READY' });
  db.prepare("UPDATE membership SET status='pending' WHERE user_id=?").run(id);
  const denied = await request(`/api/lessons/${session.sessionId}`);
  assert.equal(denied.status, 403);
  assert.deepEqual(await denied.json(), { error: 'membership not approved' });
});

test('admin WebSocket upgrades without student client ID; student sockets require one', async t => {
  const { env, id, request } = await fixture(t);
  const created = await data(await request('/api/admin/lessons', 'admin', 'POST', { ...body, items: [body.items[0]] }));
  const session = await data(await request(`/api/admin/lessons/${created.id}/sessions`, 'admin', 'POST'));
  const { handleRequest } = await import('../src/index.js');
  const upgrade = (token, client = '') => handleRequest(new Request(`${origin}/api/lessons/${session.sessionId}/ws${client}`, {
    headers: { Upgrade: 'websocket', Origin: origin, Authorization: `Bearer ${token}` }
  }), env, async () => token === 'admin' ? { id, email: 'admin@ccs.us' } : { id: 'student', email: 'student@ccs.us' });
  let forwarded = 0;
  env.LESSON_ROOM = { getByName: () => ({ fetch: async req => {
    forwarded++;
    assert.equal(req.headers.get('Upgrade'), 'websocket');
    const context = JSON.parse(req.headers.get('X-Lesson-Context'));
    assert.equal(context.role, 'admin'); assert.equal(context.clientId, null);
    return Response.json({ accepted: true });
  } }) };
  assert.equal((await upgrade('admin')).status, 200);
  assert.equal(forwarded, 1);
  assert.equal((await upgrade('student')).status, 400);
  assert.equal(forwarded, 1);
});

test('builder time and notes checks use actual client helpers', async () => {
  const helpers = await import('../admin-ui/helpers.ts');
  assert.equal(helpers.defaultTime({ section:'Math', skill:'Circles', difficulty:'Medium' }),120);
  assert.equal(helpers.defaultTime({ section:'Reading & Writing', skill:'Transitions', difficulty:'Easy' }),40);
  assert.equal(helpers.defaultTime({ section:'Math' }),95);
  assert.equal(helpers.totalTime([{ time_limit_sec:90 },{ time_limit_sec:60 }]),150);
  assert.equal(helpers.formatTime(150),'2:30'); assert.equal(helpers.parseTime('2:30'),150);
  for (const bad of ['0:04','180:01','1:60','bad']) assert.equal(helpers.parseTime(bad),null);
  assert.match(helpers.notesHTML('<img src=x onerror=alert(1)> **bold**'),/&lt;img.*&gt; <strong>bold<\/strong>/);
  assert.doesNotMatch(helpers.notesHTML('<script>alert(1)</script>'),/<script>/);
});

test('lesson delete is admin-gated and archives without changing any past-session data', async t => {
  const { db, request } = await fixture(t);
  db.exec('PRAGMA foreign_keys=ON');
  const lesson = await data(await request('/api/admin/lessons','admin','POST',body));
  const path = `/api/admin/lessons/${lesson.id}`;
  const session = await data(await request(path + '/sessions','admin','POST'));
  db.prepare("INSERT INTO session_participants(session_id,user_id,assigned_question_ids_json) VALUES(?,'student','[\"q1\"]')").run(session.sessionId);
  db.prepare("INSERT INTO session_responses(session_id,user_id,question_id,final_answer,is_correct,time_spent_ms) VALUES(?,'student','q1','A',1,14000)").run(session.sessionId);
  db.prepare("INSERT INTO session_question_review(session_id,question_id,annotations_json) VALUES(?,'q1','[{\"type\":\"clear\"}]')").run(session.sessionId);
  db.prepare("INSERT INTO session_polls(session_id,poll_index,options_json,votes_json) VALUES(?,0,'[]','{}')").run(session.sessionId);
  db.prepare("INSERT INTO question_lesson_usage(question_id,session_id) VALUES('q1',?)").run(session.sessionId);
  const tables = ['lesson_questions','lesson_sessions','session_participants','session_responses','session_question_review','session_polls','question_lesson_usage'];
  const snapshot = () => Object.fromEntries(tables.map(table => [table, db.prepare(`SELECT * FROM ${table}`).all()]));
  const before = snapshot();
  assert.equal((await request(path,null,'DELETE')).status,401);
  assert.equal((await request(path,'student','DELETE')).status,403);
  assert.equal(db.prepare('SELECT archived FROM lessons WHERE id=?').get(lesson.id).archived,0);
  assert.deepEqual(snapshot(),before);
  assert.equal((await request('/api/admin/lessons/999999','admin','DELETE')).status,404);
  assert.equal((await request('/api/admin/lessons/0','admin','DELETE')).status,400);
  assert.equal((await request(path,'admin','DELETE')).status,200);
  assert.equal((await request(path,'admin','DELETE')).status,200);
  assert.equal(db.prepare('SELECT archived FROM lessons WHERE id=?').get(lesson.id).archived,1);
  assert.deepEqual(snapshot(),before);
  assert.deepEqual(await data(await request('/api/admin/lessons')),[]);
  assert.equal((await data(await request('/api/admin/lessons?includeArchived=1')))[0].id,lesson.id);
  assert.equal((await data(await request(path+'/sessions')))[0].id,session.sessionId);
  assert.equal((await data(await request(path))).title,body.title);
  assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(),[]);
});

test('archive migration preserves existing templates and defaults new lessons to visible', () => {
  const db = new DatabaseSync(':memory:');
  db.exec(migration);
  db.exec("INSERT INTO lessons(title,mode,created_by) VALUES('Before','self','admin')");
  db.exec(readFileSync(__dirname + '/../migrations/0009_lesson_archive.sql','utf8'));
  assert.equal(db.prepare('SELECT archived FROM lessons').get().archived,0);
  assert.throws(() => db.exec('UPDATE lessons SET archived=2'),/CHECK/);
  db.close();
});
