// lessons-09: self-paced write-back through the shared record path, instructor-paced isolation,
// usedInLesson rows at session end, the three-way bank filter, and post-end lesson history.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { DatabaseSync } = require('node:sqlite');
const { readFileSync } = require('node:fs');
const schema = readFileSync(__dirname + '/../schema.sql', 'utf8');
const migration = readFileSync(__dirname + '/../migrations/0010_lesson_attempts.sql', 'utf8');
const origin = 'https://roadto1600.org';
const stats = () => import('../public/shared/stats.js');
const lesson = () => import('../public/shared/lesson.js');

// D1 over a real SQLite database; batch() is one transaction, as on D1.
function d1(db) {
  const sql = (query, args = []) => ({ bind: (...values) => sql(query, values), first: async () => db.prepare(query).get(...args) || null,
    all: async () => ({ results: db.prepare(query).all(...args) }),
    run: async () => { const stmt = db.prepare(query); if (stmt.columns().length) return { results: stmt.all(...args), meta: { changes: 0 } }; const r = stmt.run(...args); return { results: [], meta: { changes: Number(r.changes), last_row_id: Number(r.lastInsertRowid) } }; } });
  return { prepare: sql, batch: async statements => { db.exec('BEGIN'); try { const out = []; for (const s of statements) out.push(await s.run()); db.exec('COMMIT'); return out; } catch (e) { db.exec('ROLLBACK'); throw e; } } };
}
const MC = (id, answer) => `('${id}','Math','Algebra','Linear functions','Hard','<p>${id} stem</p>','[{"letter":"A","content":"a"},{"letter":"B","content":"b"}]','${answer}','<p>EXPL_${id}</p>','OFFICIAL')`;
function world(t) {
  const db = new DatabaseSync(':memory:'); db.exec(schema);
  db.exec(`INSERT INTO questions(id,section,domain,skill,difficulty,stem_html,choices_json,correct_answer,explanation_html,source) VALUES ${MC('q1','B')},${MC('q2','A')},${MC('q3','')},${MC('q4','B')};
    INSERT INTO users(id,email,role) VALUES('teacher','t@ccs.us','admin'),('alice','a@ccs.us','student'),('bob','b@ccs.us','student'),('carol','c@ccs.us','student');
    INSERT INTO membership(user_id,email,status) VALUES('teacher','t@ccs.us','approved'),('alice','a@ccs.us','approved'),('bob','b@ccs.us','approved'),('carol','c@ccs.us','approved');
    INSERT INTO lessons(id,title,mode,created_by) VALUES(1,'Self set','self','teacher'),(2,'Paced','instructor','teacher');`);
  t.after(() => db.close());
  const env = { DB: d1(db), AI_DB: { prepare: () => ({ all: async () => ({ results: [] }), bind: () => ({ first: async () => null }) }) }, ASSETS: { fetch: async () => new Response('asset') } };
  return { db, env };
}
const items = [{ question_id: 'q1', time_limit_sec: 60, notes: 'NOTE_q1 **why**' }, { question_id: 'q2', time_limit_sec: 60, notes: '' },
  { question_id: 'q3', time_limit_sec: 60, notes: '' }, { question_id: 'q4', time_limit_sec: 60, notes: 'NOTE_q4' }];
function session(db, id, lessonId, mode, participants) {
  db.prepare("INSERT INTO lesson_sessions(id,lesson_id,join_code,status,snapshot_json) VALUES(?,?,?,'live',?)").run(id, lessonId, 'CODE' + String(id).padStart(2, 'A'), JSON.stringify({ title: mode === 'self' ? 'Self set' : 'Paced', mode, items }));
  for (const [userId, assigned] of Object.entries(participants)) db.prepare('INSERT INTO session_participants(session_id,user_id,assigned_question_ids_json) VALUES(?,?,?)').run(id, userId, JSON.stringify(assigned));
}
async function room(env) {
  const { LessonRoom } = await import('../src/lesson-room.js');
  const data = new Map();
  const ctx = { storage: { get: async k => data.get(k), put: async (k, v) => data.set(k, structuredClone(v)), delete: async k => data.delete(k),
    setAlarm: async () => {}, deleteAlarm: async () => {} }, getWebSockets: () => [] };
  return { r: new LessonRoom(ctx, env), data };
}
async function normalized(ids) {
  const { normalizeQuestion } = await stats();
  const q = id => normalizeQuestion({ id, section: 'Math', stem_html: `<p>${id}</p>`, choices_json: '[{"letter":"A"},{"letter":"B"}]', correct_answer: { q1: 'B', q2: 'A', q3: '', q4: 'B' }[id], explanation_html: '' });
  return Object.fromEntries(ids.map(id => [id, q(id)]));
}
// A finished self-paced set: alice answered q1 right, left q2 blank; bob (late joiner, q1+q4) got q1 wrong
// after one change. q3 has no stored answer and is unscorable.
async function selfState(env) {
  const now = Date.now();
  return { id: 7, code: 'CODEAG', title: 'Self set', owner: 'teacher', mode: 'self', items, questions: await normalized(['q1','q2','q3','q4']),
    difficulty: {}, status: 'live', phase: 'ANSWERING', index: 0, startedAt: now - 60000, endsAt: now - 1000, lockedJoin: false, kicked: [],
    roster: { alice: 'Alice', bob: 'Bob' }, joinedAt: {}, positions: {}, submitted: { alice: now - 5000 }, clock: {}, joinRemaining: { bob: 120000 }, reviewed: [],
    assigned: { alice: ['q1','q2','q3','q4'], bob: ['q1','q4'] },
    responses: { alice: { q1: { answer: 'B', changes: 0, history: [{ answer: 'B', atMs: 3000 }], ms: 17000 }, q2: { answer: null, changes: 0, history: [], ms: 4000 },
      q3: { answer: 'A', changes: 0, history: [{ answer: 'A', atMs: 9000 }], ms: 2000 } },
      bob: { q1: { answer: 'A', changes: 1, history: [{ answer: 'B', atMs: 1000 }, { answer: 'A', atMs: 2000 }], ms: 5000 } } } };
}

test('nextProgress is the marker rule: Red wrong, Orange right after Red, Green right', async () => {
  const { nextProgress, attemptRow } = await stats();
  const red = nextProgress(undefined, 'q', false, 'T1', 10);
  assert.deepEqual(red, { question_id: 'q', attempts: 1, corrects: 0, marker: 'Red', last_reviewed: 'T1', time_taken_ms: 10 });
  const orange = nextProgress(red, 'q', true, 'T2', 20);
  assert.deepEqual([orange.marker, orange.attempts, orange.corrects], ['Orange', 2, 1]);
  assert.equal(nextProgress(orange, 'q', true, 'T3', 5).marker, 'Green');
  assert.equal(nextProgress({ marker: 'Green', attempts: 4, corrects: 4 }, 'q', false, 'T4', 5).marker, 'Red');
  assert.equal(red.marker, 'Red', 'previous row is not mutated');
  assert.deepEqual(attemptRow('q', null, 'T', 5, null, 0, []), { question_id: 'q', ts: 'T', correct: 0, time_taken_ms: 5, picked: '', changes: 0 });
  assert.equal(attemptRow('q', true, 'T', 5, 'B', 1, [{ answer: 'B', atMs: 1 }]).answer_history_json, '[{"answer":"B","atMs":1}]');
  const page = readFileSync(__dirname + '/../public/index.html', 'utf8');
  // The client record path moved into lesson-ui/record.ts; it is handed the page's Stats, so there is still one copy of both rules.
  const record = readFileSync(__dirname + '/../lesson-ui/record.ts', 'utf8');
  assert.match(record, /env\.stats\.nextProgress\(/);
  assert.match(record, /env\.stats\.attemptRow\(/);
  assert.match(page, /createRecorder\(\{ stats: Stats,/);
});

test('usage filter, lesson score and shown questions', async () => {
  const { lessonUsageVisible, lessonScore, shownQuestionIds, USAGE_MODES } = await lesson();
  assert.deepEqual(USAGE_MODES, ['show-all', 'hide-attended', 'hide-all']);
  const attended = new Set(['00003']);
  const cases = { none: [], mine: ['00003'], other: ['00004'], both: ['00003', '00004'] };
  const visible = mode => Object.keys(cases).filter(k => lessonUsageVisible(cases[k], mode, attended));
  assert.deepEqual(visible('show-all'), ['none', 'mine', 'other', 'both']);
  assert.deepEqual(visible('hide-attended'), ['none', 'other']);
  assert.deepEqual(visible('hide-all'), ['none']);
  assert.equal(lessonUsageVisible(undefined, 'hide-all', attended), true);
  assert.deepEqual(lessonScore([{ is_correct: 1 }, { is_correct: 0 }, { is_correct: null }, { is_correct: 1 }]), { right: 2, scorable: 3 });
  const base = { items, startedAt: 1, index: 1, status: 'live' };
  assert.deepEqual(shownQuestionIds(base), ['q1', 'q2']);
  assert.deepEqual(shownQuestionIds({ ...base, status: 'lobby', startedAt: undefined }), []);
  assert.deepEqual(shownQuestionIds({ ...base, mode: 'self', status: 'review', assigned: { a: ['q4', 'q1'], b: ['q2'] } }), ['q1', 'q2', 'q4']);
});

test('0010 upgrades a pre-0010 database and matches the fresh snapshot', () => {
  // A pre-0010 database has neither 0010's column nor the later 0012 one; it reaches the snapshot through both, in order.
  const old = schema.replace(/  lesson_session_id INTEGER,\r?\n/, '').replace(/^CREATE UNIQUE INDEX IF NOT EXISTS attempts_lesson.*$/m, '')
    .replace(/^  -- 0012_study_plan\.sql.*\r?\n  plan_step TEXT,\r?\n/m, '');
  const db = new DatabaseSync(':memory:'); db.exec(old);
  db.exec("INSERT INTO attempts(user_id,question_id,ts) VALUES('u','q','t')");
  db.exec(migration);
  db.exec(readFileSync(__dirname + '/../migrations/0012_study_plan.sql', 'utf8'));
  assert.equal(db.prepare("SELECT lesson_session_id FROM attempts").get().lesson_session_id, null);
  assert.throws(() => db.exec(migration), /duplicate column/);
  const fresh = new DatabaseSync(':memory:'); fresh.exec(schema);
  const shape = d => [d.prepare('PRAGMA table_info(attempts)').all().map(c => c.name).join(), d.prepare("SELECT sql FROM sqlite_master WHERE name='attempts_lesson'").get().sql.replace(/IF NOT EXISTS /, '')];
  assert.deepEqual(shape(db), shape(fresh));
  for (const d of [db, fresh]) {
    d.exec("INSERT INTO attempts(user_id,question_id,ts,lesson_session_id) VALUES('u','q','t1',5)");
    assert.throws(() => d.exec("INSERT INTO attempts(user_id,question_id,ts,lesson_session_id) VALUES('u','q','t2',5)"), /UNIQUE/);
    d.exec("INSERT INTO attempts(user_id,question_id,ts) VALUES('u','q','t3')");
  }
  db.close(); fresh.close();
});

test('self-paced completion writes attempts and progress once, through the shared path', async t => {
  const { db, env } = world(t);
  session(db, 7, 1, 'self', { alice: ['q1','q2','q3','q4'], bob: ['q1','q4'] });
  db.exec("INSERT INTO progress(user_id,question_id,attempts,corrects,marker) VALUES('alice','q1',1,0,'Red'),('bob','q1',2,2,'Green')");
  const { r, data } = await room(env);
  const s = await selfState(env);
  await r.save(s);
  await r.completeSet(s);
  const at = new Date(s.finishedAt).toISOString();
  const attempts = db.prepare('SELECT user_id,question_id,ts,correct,picked,changes,time_taken_ms,answer_history_json,lesson_session_id FROM attempts ORDER BY user_id,question_id').all().map(x => ({ ...x }));
  assert.deepEqual(attempts, [
    { user_id: 'alice', question_id: 'q1', ts: at, correct: 1, picked: 'B', changes: 0, time_taken_ms: 17000, answer_history_json: '[{"answer":"B","atMs":3000}]', lesson_session_id: 7 },
    { user_id: 'alice', question_id: 'q2', ts: at, correct: 0, picked: null, changes: 0, time_taken_ms: 4000, answer_history_json: null, lesson_session_id: 7 },
    { user_id: 'alice', question_id: 'q4', ts: at, correct: 0, picked: null, changes: 0, time_taken_ms: 0, answer_history_json: null, lesson_session_id: 7 },
    { user_id: 'bob', question_id: 'q1', ts: at, correct: 0, picked: 'A', changes: 1, time_taken_ms: 5000, answer_history_json: '[{"answer":"B","atMs":1000},{"answer":"A","atMs":2000}]', lesson_session_id: 7 },
    { user_id: 'bob', question_id: 'q4', ts: at, correct: 0, picked: null, changes: 0, time_taken_ms: 0, answer_history_json: null, lesson_session_id: 7 }],
    'assigned scorable only: no q3 (unscorable), nothing unassigned; blanks are picked null, wrong');
  const progress = () => db.prepare('SELECT user_id,question_id,attempts,corrects,marker,last_reviewed,time_taken_ms FROM progress ORDER BY user_id,question_id').all().map(x => ({ ...x }));
  const once = progress();
  assert.deepEqual(once, [
    { user_id: 'alice', question_id: 'q1', attempts: 2, corrects: 1, marker: 'Orange', last_reviewed: at, time_taken_ms: 17000 },
    { user_id: 'alice', question_id: 'q2', attempts: 1, corrects: 0, marker: 'Red', last_reviewed: at, time_taken_ms: 4000 },
    { user_id: 'alice', question_id: 'q4', attempts: 1, corrects: 0, marker: 'Red', last_reviewed: at, time_taken_ms: 0 },
    { user_id: 'bob', question_id: 'q1', attempts: 3, corrects: 2, marker: 'Red', last_reviewed: at, time_taken_ms: 5000 },
    { user_id: 'bob', question_id: 'q4', attempts: 1, corrects: 0, marker: 'Red', last_reviewed: at, time_taken_ms: 0 }]);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM session_responses').get().n, 6, 'every assigned response, q3 included');
  assert.equal(db.prepare('SELECT status FROM lesson_sessions WHERE id=7').get().status, 'review');
  // A crash between the D1 commit and deleting `pending` replays the same batch: nothing moves twice.
  data.set('pending', { rows: attempts.map(a => ({ userId: a.user_id, questionId: a.question_id, answer: a.picked, correct: a.correct, locked: false, ms: a.time_taken_ms, changes: a.changes, history: [] })),
    end: false, review: true, writeBack: { at: s.finishedAt } });
  await r.flush(await r.state());
  assert.deepEqual(progress(), once);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM attempts').get().n, 5);
});

test('instructor-paced finalize and end write no attempt or progress; usage rows record what was shown', async t => {
  const { db, env } = world(t);
  session(db, 8, 2, 'instructor', { alice: ['q1','q2','q3','q4'], bob: ['q1','q2','q3','q4'] });
  const { r } = await room(env);
  const now = Date.now();
  const s = { id: 8, code: 'CODEAH', title: 'Paced', owner: 'teacher', items, questions: await normalized(['q1','q2','q3','q4']), status: 'live', phase: 'ANSWERING',
    index: 1, startedAt: now - 20000, endsAt: now - 1000, lockedJoin: false, kicked: [], roster: { alice: 'Alice', bob: 'Bob' }, joinedAt: {},
    responses: { alice: { q2: { answer: 'B', locked: false, changes: 0, history: [{ answer: 'B', atMs: 1 }] } }, bob: {} } };
  await r.save(s);
  await r.advance(s);
  assert.equal(db.prepare("SELECT COUNT(*) n FROM session_responses WHERE question_id='q2'").get().n, 2);
  const admin = { deserializeAttachment: () => ({ role: 'admin', userId: 'teacher' }), send() {}, close() {} };
  r.ctx.getWebSockets = () => [admin];
  await r.webSocketMessage(admin, JSON.stringify({ type: 'endSession' }));
  assert.equal(db.prepare('SELECT status FROM lesson_sessions WHERE id=8').get().status, 'ended');
  assert.equal(db.prepare('SELECT COUNT(*) n FROM attempts').get().n, 0);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM progress').get().n, 0);
  assert.deepEqual(db.prepare('SELECT question_id FROM question_lesson_usage WHERE session_id=8 ORDER BY question_id').all().map(x => x.question_id), ['q1', 'q2']);
});

test('self-paced End session records the union of assigned sets; a lobby end records none', async t => {
  const { db, env } = world(t);
  session(db, 7, 1, 'self', { alice: ['q1','q2','q3','q4'], bob: ['q1','q4'] });
  const { r } = await room(env);
  const s = await selfState(env);
  s.assigned = { alice: ['q2'], bob: ['q1','q4'] };
  await r.save(s); await r.completeSet(s);
  const admin = { deserializeAttachment: () => ({ role: 'admin', userId: 'teacher' }), send() {}, close() {} };
  r.ctx.getWebSockets = () => [admin];
  await r.webSocketMessage(admin, JSON.stringify({ type: 'endSession' }));
  assert.deepEqual(db.prepare('SELECT question_id FROM question_lesson_usage WHERE session_id=7 ORDER BY question_id').all().map(x => x.question_id), ['q1', 'q2', 'q4']);
  session(db, 9, 1, 'self', {});
  const lobby = await room(env);
  lobby.r.ctx.getWebSockets = () => [admin];
  await lobby.r.save({ ...(await selfState(env)), id: 9, status: 'lobby', phase: 'READY', startedAt: undefined, endsAt: null, assigned: { alice: ['q1'] } });
  await lobby.r.webSocketMessage(admin, JSON.stringify({ type: 'endSession' }));
  assert.equal(db.prepare('SELECT status FROM lesson_sessions WHERE id=9').get().status, 'ended');
  assert.equal(db.prepare('SELECT COUNT(*) n FROM question_lesson_usage WHERE session_id=9').get().n, 0);
});

test('history API: ended only, participants only; list, bank usage, source tags and admin Lessons tab', async t => {
  const { db, env } = world(t);
  const { handleRequest } = await import('../src/index.js');
  const who = { 'Bearer teacher': { id: 'teacher', email: 't@ccs.us' }, 'Bearer alice': { id: 'alice', email: 'a@ccs.us' },
    'Bearer bob': { id: 'bob', email: 'b@ccs.us' }, 'Bearer carol': { id: 'carol', email: 'c@ccs.us' } };
  const get = async (path, token) => handleRequest(new Request(origin + path, { headers: { Authorization: 'Bearer ' + token } }), env, async req => who[req.headers.get('Authorization')] || null);
  const json = async res => { assert.equal(res.status, 200, await res.clone().text()); return res.json(); };
  session(db, 7, 1, 'self', { alice: ['q1','q2','q3','q4'], bob: ['q1','q4'] });
  session(db, 8, 2, 'instructor', { alice: ['q1','q2','q3','q4'] });
  const { r } = await room(env);
  const s = await selfState(env);
  await r.save(s); await r.completeSet(s);
  db.exec(`INSERT INTO session_question_review VALUES(7,'q1','[{"type":"highlight","id":"m1","nodeId":"p:0","startOffset":0,"endOffset":2,"color":"#ffe066"}]','{"expressions":{"list":[]}}');
    INSERT INTO session_responses(session_id,user_id,question_id,final_answer,is_correct) VALUES(8,'alice','q1','A',0);`);
  assert.equal((await get('/api/lesson-history/7', 'alice')).status, 404, 'in review: notes not unlocked yet (G6)');
  const listed = await json(await get('/api/lesson-history', 'alice'));
  assert.deepEqual(listed.attended, ['00008', '00007']);
  assert.deepEqual(listed.sessions, [], 'only ended sessions open');
  db.exec("UPDATE lesson_sessions SET status='ended'; INSERT INTO question_lesson_usage(question_id,session_id) VALUES('q1',7),('q2',7),('q3',7),('q4',7),('q1',8)");
  assert.equal((await get('/api/lesson-history/7', 'carol')).status, 404, 'non-participant');
  assert.equal((await get('/api/lesson-history/99', 'alice')).status, 404);
  assert.equal((await get('/api/lesson-history/abc', 'alice')).status, 404);
  const mine = await json(await get('/api/lesson-history', 'alice'));
  // Usage for the questions of attended sessions, so the page can refresh badges after a lesson ends.
  assert.deepEqual(mine.usage, { q1: ['00007', '00008'], q2: ['00007'], q3: ['00007'], q4: ['00007'] });
  assert.deepEqual((await json(await get('/api/lesson-history', 'carol'))).usage, {});
  assert.deepEqual(mine.sessions.map(x => [x.paddedId, x.mode, x.score]), [['00008', 'instructor', { right: 0, scorable: 1 }], ['00007', 'self', { right: 1, scorable: 3 }]]);
  const detail = await json(await get('/api/lesson-history/7', 'alice'));
  assert.deepEqual(detail.questions.map(x => [x.number, x.question.id, x.answer, x.correct, x.inSet]), [[1, 'q1', 'B', 1, true], [2, 'q2', null, 0, true], [3, 'q3', 'A', null, true], [4, 'q4', null, 0, true]]);
  assert.equal(detail.questions[0].notes, 'NOTE_q1 **why**');
  assert.equal(detail.questions[0].question.explanation_html, '<p>EXPL_q1</p>');
  assert.equal(detail.questions[0].annotations[0].id, 'm1');
  assert.deepEqual(detail.questions[0].desmos, { expressions: { list: [] } });
  const late = await json(await get('/api/lesson-history/7', 'bob'));
  assert.deepEqual(late.questions.map(x => [x.question.id, x.inSet]), [['q1', true], ['q2', false], ['q3', false], ['q4', true]]);
  assert.deepEqual((await json(await get('/api/lesson-history/8', 'alice'))).questions.map(x => x.question.id), ['q1'], 'instructor-paced: shown questions only');
  const bank = await json(await get('/api/questions', 'alice'));
  assert.deepEqual(bank.find(q => q.id === 'q1').usedInLesson, ['00007', '00008']);
  assert.deepEqual(bank.find(q => q.id === 'q2').usedInLesson, ['00007']);
  const log = await json(await get('/api/attempts', 'alice'));
  assert.deepEqual([...new Set(log.map(x => x.lesson_session_id))], [7]);
  const student = await json(await get('/api/admin/students/alice', 'teacher'));
  assert.deepEqual(student.lessons.map(x => [x.paddedId, x.mode, x.counted, x.score]), [['00008', 'instructor', false, { right: 0, scorable: 1 }], ['00007', 'self', true, { right: 1, scorable: 3 }]]);
  assert.deepEqual(student.mistakes.map(m => [m.question_id, m.lessonSessionId]), [['q2', '00007'], ['q4', '00007']]);
  assert.equal((await json(await get('/api/admin/students/alice/history', 'teacher'))).results[0].lesson_session_id, 7);
  const builder = async mode => (await json(await get('/api/admin/questions?lessonUsage=' + mode, 'teacher'))).questions.map(q => q.id);
  assert.deepEqual(await builder('show-all'), ['q1', 'q2', 'q3', 'q4']);
  assert.deepEqual(await builder('hide-attended'), []);
  assert.deepEqual(await builder('hide-all'), []);
  assert.equal((await get('/api/admin/questions?lessonUsage=bogus', 'teacher')).status, 400);
});
