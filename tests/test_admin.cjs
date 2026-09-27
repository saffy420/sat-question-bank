const { test } = require('node:test');
const assert = require('node:assert/strict');
const { DatabaseSync } = require('node:sqlite');
const { readFileSync } = require('node:fs');
const root = __dirname + '/../';
const schema = readFileSync(root + 'schema.sql', 'utf8');
const migration = readFileSync(root + 'migrations/0007_admin_history.sql', 'utf8');
const origin = 'https://roadto1600.org';
let idSeq = 0;
async function fixture(t) {
  const db = new DatabaseSync(':memory:'); db.exec(schema);
  db.exec(`INSERT INTO questions (id,section,domain,skill,difficulty,choices_json,correct_answer) VALUES
    ('mc','Math','Algebra','Linear functions','Easy','[{"letter":"A","content":"wrong","trap":"sign"},{"letter":"B","content":"right"}]','B'),
    ('spr','Math','Algebra','Linear functions','Medium','[]','1/2');`);
  const sql = (query, args = []) => ({ bind: (...values) => sql(query, values),
    first: async () => db.prepare(query).get(...args) || null,
    all: async () => ({ results: db.prepare(query).all(...args) }),
    run: async () => { const stmt = db.prepare(query); if (stmt.columns().length) return { results: stmt.all(...args), meta: { changes: 0 } }; return { results: [], meta: { changes: Number(stmt.run(...args).changes) } }; } });
  const env = { ADMIN_EMAILS: ' ADMIN@e2e.test ,someone@example.test ',
    DB: { prepare: sql, batch: async statements => { db.exec('BEGIN'); try { const out = []; for (const s of statements) out.push(await s.run()); db.exec('COMMIT'); return out; } catch(e) { db.exec('ROLLBACK'); throw e; } } },
    AI_DB: { prepare: () => ({ all: async () => ({ results: [] }) }) },
    ASSETS: { fetch: async req => new Response(new URL(req.url).pathname) } };
  const { handleRequest } = await import('../src/index.js');
  const id = 'admin-test-' + ++idSeq;
  const identity = async req => req.headers.get('Authorization') === 'Bearer admin' ? { id, email: 'admin@e2e.test' } :
    req.headers.get('Authorization') === 'Bearer student' ? { id: 'student', email: 'student@ccs.us' } : null;
  const request = (path, token, method = 'GET', body) => handleRequest(new Request(origin + path, {
    method, headers: { ...(token ? { Authorization: 'Bearer ' + token } : {}), ...(method !== 'GET' ? { Origin: origin } : {}) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }) }), env, identity);
  t.after(() => db.close());
  return { db, env, request, id };
}
test('shared annotations module is publicly served without opening other paths', async t => {
  const { request } = await fixture(t);
  const module = await request('/shared/annotations.js');
  assert.equal(module.status, 200);
  assert.equal(await module.text(), '/shared/annotations.js');
  assert.equal((await request('/shared/annotations.js', null, 'HEAD')).status, 200);
  assert.equal((await request('/shared/missing.js')).status, 404);
});
test('lesson pages alone get the Desmos CSP; shared desmos module served; key falls back to demo only locally', async t => {
  const { request, id } = await fixture(t);
  const { desmosApiKey } = await import('../src/index.js');
  const csp = res => res.headers.get('Content-Security-Policy');
  const desmos = await request('/shared/desmos.js');
  assert.equal(desmos.status, 200); assert.doesNotMatch(csp(desmos), /unsafe-eval|desmos\.com\/?[^;]*;?\s*worker/);
  assert.doesNotMatch(csp(await request('/login')), /unsafe-eval|worker-src/);
  assert.equal((await request('/api/auth/session', 'admin', 'POST')).status, 200);
  const admin = await request('/admin', 'admin');
  assert.equal(admin.status, 200, await admin.clone().text());
  assert.match(csp(admin), /script-src [^;]*'unsafe-eval'[^;]*https:\/\/www\.desmos\.com/);
  assert.match(csp(admin), /worker-src blob:/);
  assert.match(csp(admin), /frame-src https:\/\/www\.desmos\.com/);
  assert.doesNotMatch(csp(await request('/api/admin/students', 'admin')), /unsafe-eval/);
  assert.equal(desmosApiKey({ DESMOS_API_KEY: 'abc' }, new URL('https://roadto1600.org/')), 'abc');
  assert.equal(desmosApiKey({}, new URL('https://roadto1600.org/')), null);
  assert.equal(desmosApiKey({}, new URL('https://127.0.0.1:8787/')), 'dcb31709b452b1cf9dc26972add0fda6');
  assert.ok(id);
});
test('0007 fresh snapshot and existing upgrade both constrain roles and preserve old attempts', () => {
  for (const upgrade of [false,true]) {
    const db = new DatabaseSync(':memory:');
    db.exec(upgrade ? schema.replace(/  created_at TEXT DEFAULT \(datetime\('now'\)\),\s+role TEXT NOT NULL DEFAULT 'student' CHECK \(role IN \('student', 'admin'\)\)/, "  created_at TEXT DEFAULT (datetime('now'))").replace(/  answer_history_json TEXT,\s*/, '') : schema);
    if (upgrade) { db.exec("INSERT INTO users(id) VALUES('old'); INSERT INTO attempts(user_id,question_id,ts) VALUES('old','mc','before')"); db.exec(migration); }
    db.exec("INSERT INTO users(id) VALUES('new')");
    assert.equal(db.prepare("SELECT role FROM users WHERE id='new'").get().role, 'student');
    assert.throws(() => db.exec("UPDATE users SET role='owner' WHERE id='new'"));
    assert.ok(db.prepare('PRAGMA table_info(attempts)').all().some(c => c.name === 'answer_history_json'));
    if (upgrade) assert.equal(db.prepare("SELECT answer_history_json FROM attempts WHERE ts='before'").get().answer_history_json, null);
    db.close();
  }
});
test('role sync demotes; every admin prefix and shell alias gates before fallback; GET reads stay read-only', async t => {
  const f = await fixture(t); const { db, request, env, id } = f;
  db.exec("INSERT INTO users(id,email,role) VALUES('student','student@ccs.us','student'); INSERT INTO membership(user_id,email,status) VALUES('student','student@ccs.us','pending')");
  for (const path of ['/api/admin', '/api/admin/students', '/api/admin/unknown']) assert.equal((await request(path)).status, 401);
  for (const path of ['/admin', '/admin/other', '/admin.html', '/admin.js']) assert.equal((await request(path)).headers.get('Location'), '/login');
  const session = await request('/api/auth/session','admin','POST', { role:'student', user_id:'student' }); assert.equal(session.status, 200);
  assert.equal(db.prepare('SELECT role FROM users WHERE id=?').get(id).role, 'admin');
  assert.equal((await request('/api/admin/students','admin')).status,200);
  assert.equal((await request('/api/auth/session','student','POST')).status, 200);
  for (const path of ['/api/admin', '/api/admin/students', '/api/admin/unknown']) assert.equal((await request(path,'student')).status, 403);
  for (const path of ['/admin','/admin/other','/admin.html','/admin.js']) assert.equal((await request(path,'student')).status, 403);
  assert.equal((await (await request('/api/auth/session','student','POST')).json()).role, 'student');
  assert.equal((await (await request('/api/auth/session','admin','POST')).json()).role, 'admin');
  assert.equal((await request('/api/admin/unknown','admin')).status,404);
  assert.equal((await request('/api/admin/students','student','POST')).status,403);
  assert.equal((await request('/admin.html','admin')).headers.get('Location'), '/admin');
  assert.equal((await request('/admin/anything','admin')).status,200);
  assert.equal((await request('/admin.js','admin')).status,200);
  assert.equal((await request('/admin.js','admin','POST')).status,404);
  assert.equal((await request('/api/admin/students','admin','POST')).status,404);
  db.exec("INSERT INTO users(id,email,name) VALUES ('zero','zero@ccs.us','Zero'); INSERT INTO membership(user_id,email,status) VALUES ('zero','zero@ccs.us','approved')");
  db.exec('PRAGMA query_only=ON');
  for (const path of ['/api/admin/students','/api/admin/students/zero','/api/admin/students/zero/history','/api/admin/unknown']) {
    const r = await request(path,'admin'); assert.equal(r.status, path.endsWith('unknown') ? 404 : 200, path); assert.equal(r.headers.get('Cache-Control'),'private, no-store');
    if (path.endsWith('students')) assert.equal((await r.json()).students.find(s => s.id === 'zero').done, 0);
  }
  db.exec('PRAGMA query_only=OFF');
  env.ADMIN_EMAILS = '';
  assert.equal((await request('/api/auth/session','admin','POST')).status,200);
  assert.equal(db.prepare('SELECT role FROM users WHERE id=?').get(id).role,'student');
  assert.equal((await request('/api/admin/students','admin')).status,403);
  db.exec("UPDATE membership SET status='denied' WHERE user_id='student'");
  assert.equal((await request('/api/admin/students','student')).status,403);
  assert.equal((await request('/api/auth/session','student','POST')).status,403);
  db.exec('DROP TABLE users');
  assert.equal((await request('/api/admin/other','admin')).status,503);
});
test('shared stats compute Orange current, attempt accuracy, sparse time and trap denominator once', async () => {
  const stats = await import('../public/shared/stats.js');
  const qs = [{ id:'mc', section:'Math', domain:'Algebra', skill:'Linear functions', difficulty:'Easy', choices_json:'[{"letter":"A","trap":"sign"},{"letter":"B"}]', correct_answer:'B' },
    { id:'spr', section:'Math', domain:'Algebra', skill:'Linear functions', difficulty:'Medium', choices_json:'[]', correct_answer:'1/2' }].map(stats.normalizeQuestion);
  assert.equal(stats.isRight(qs[1],'.5'),true);
  assert.equal(stats.isRight(qs[1],'.6'),false);
  assert.equal(stats.isRight({ ...qs[1], answer:'' },'.5'),null);
  const progress = { mc:{ attempts:2,corrects:1,marker:'Orange',time_taken_ms:90000 }, spr:{ attempts:1,corrects:0,marker:'Red' } };
  const log = [{ question_id:'mc', ts:'2026-01-01', correct:0, picked:'A', time_taken_ms:40000, changes:1 },
    { question_id:'mc', ts:'2026-01-02', correct:1, picked:'B', time_taken_ms:95000, changes:0 },
    { question_id:'spr', ts:'2026-01-03', correct:0, picked:'2', time_taken_ms:0, changes:null }];
  const b = stats.breakdown(qs, progress, log);
  assert.equal(b.tally.att,2); assert.equal(b.tally.corr,1);
  assert.deepEqual(b.diff.Easy,{ a:2,c:1 }); assert.equal(b.skills['Linear functions'].avgMs,67500);
  assert.deepEqual(b.skills['Linear functions'].trend,[0,1,0]);
  assert.equal(b.pacing.rushed,1); assert.equal(b.paceSection.Math.n,2);
  assert.equal(b.traps[0][0],'sign'); assert.equal(b.traps[0][1].count,1);
  assert.equal(b.guessing.n,2); assert.equal(b.lastActive,'2026-01-03');
});
test('student roster searches and sorts across pages; attempt history paginates newest first', async t => {
  const { db, request } = await fixture(t);
  await request('/api/auth/session','admin','POST');
  for (let i = 0; i < 28; i++) {
    const id = 'roster-' + i;
    db.prepare('INSERT INTO users(id,email,name) VALUES(?,?,?)').run(id, `${id}@ccs.us`, `Learner ${String(i).padStart(2,'0')}`);
    db.prepare("INSERT INTO membership(user_id,email,status) VALUES(?,?,'approved')").run(id, `${id}@ccs.us`);
    db.prepare("INSERT INTO progress(user_id,question_id,attempts,corrects,marker) VALUES(?,'mc',1,? ,?)")
      .run(id, i % 2, i % 2 ? 'Green' : 'Red');
  }
  const first = await (await request('/api/admin/students?sort=accuracy&order=desc','admin')).json();
  const second = await (await request('/api/admin/students?sort=accuracy&order=desc&page=2','admin')).json();
  assert.equal(first.total,28); assert.equal(first.students.length,25); assert.equal(second.students.length,3);
  assert.equal(first.students[0].accuracy,100); assert.equal(second.students.at(-1).accuracy,0);
  const match = await (await request('/api/admin/students?search=Learner%2027','admin')).json();
  assert.deepEqual(match.students.map(s => s.name),['Learner 27']);
  db.prepare("UPDATE users SET name=? WHERE id='roster-2'").run('<img src=x onerror=alert(1)>');
  const safe = await (await request('/api/admin/students?search=roster-2','admin')).json();
  assert.equal(safe.students[0].name,'<img src=x onerror=alert(1)>');
  assert.equal((await (await request('/api/admin/students?search=%25','admin')).json()).total,0);
  for (const path of ['/api/admin/students?page=0','/api/admin/students?sort=role','/api/admin/students/roster-1/history?page=-1'])
    assert.equal((await request(path,'admin')).status,400,path);
  for (let i = 0; i < 27; i++) db.prepare('INSERT INTO attempts(user_id,question_id,ts) VALUES(?,?,?)').run('roster-1','mc',String(i).padStart(3,'0'));
  const h = await (await request('/api/admin/students/roster-1/history','admin')).json();
  assert.equal(h.total,27); assert.equal(h.results.length,25); assert.equal(h.results[0].ts,'026');
  assert.equal((await (await request('/api/admin/students/roster-1/history?page=2','admin')).json()).results.length,2);
});
test('attempt history validates and roundtrips MC/SPR, legacy stays unknown; directions use same grader', async t => {
  const f = await fixture(t); const { db, request, id } = f;
  await request('/api/auth/session','admin','POST');
  const post = body => request('/api/attempts','admin','POST',body);
  const mk = (qid, ts, picked, sequence) => ({ question_id: qid, ts, picked, correct: picked === 'B', changes: 1,
    answer_history_json: JSON.stringify(sequence.map((answer,i) => ({ answer, atMs: i*1000 }))) });
  const mc = mk('mc','2026-09-24T10:00:00Z','A',['B','A']);
  const spr = mk('spr','2026-09-24T11:00:00Z','0.5',['2','0.5']);
  assert.equal((await post([mc,spr])).status,200);
  const old = { question_id:'mc', ts:'2026-09-24T09:00:00Z', picked:'A', correct:0 };
  assert.equal((await post(old)).status,200);
  assert.equal((await post([mc,spr])).status,200);
  const log = await (await request('/api/attempts','admin')).json();
  assert.equal(log.length,3); assert.equal(log[0].answer_history_json,null);
  assert.equal(log[1].answer_history_json,mc.answer_history_json);
  const detail = await (await request('/api/admin/students/other','admin')).json();
  assert.equal(detail.error,'not found');
  db.prepare("INSERT INTO users(id,email,role) VALUES('another','another@e2e.test','student')").run();
  db.prepare("INSERT INTO membership(user_id,email,status) VALUES('another','another@e2e.test','approved')").run();
  assert.equal((await (await request('/api/admin/students/another/history','admin')).json()).total,0);
  const stats = await import('../public/shared/stats.js');
  const q = { answer:'1/2',spr:true,choices:[] }; assert.equal(stats.direction(q,spr),'wrong-to-right');
  assert.equal(stats.direction({ answer:'B',spr:false,choices:[{letter:'A'},{letter:'B'}] },mc),'right-to-wrong');
  assert.equal(stats.direction(q,old),'unknown');
  for (const bad of ['{}','[]','[{}]',JSON.stringify([{answer:'A',atMs:-1}]),'x'.repeat(8193),JSON.stringify([{answer:'B',atMs:0},{answer:'A',atMs:-1}])]) {
    assert.equal((await post({ ...mc,ts:'bad'+bad.length,answer_history_json:bad })).status,400);
  }
  assert.equal((await post({ ...mc, ts:'bad', picked:'B' })).status,400);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM attempts WHERE user_id=?').get(id).n,3);
});
