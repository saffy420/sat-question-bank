// free-02 (docs/perf/FREE-PLAN-BRIEF.md §5): the CPU changes keep every response identical. The
// references below are the pre-free-02 computations (whole bank, full rows, per-student reads).
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { DatabaseSync } = require('node:sqlite');
const { readFileSync } = require('node:fs');
const root = __dirname + '/../';
const origin = 'https://roadto1600.org';

function d1(db, log) {
  const stmt = (query, args = []) => ({
    bind: (...v) => stmt(query, v),
    all: async () => { log.push(query); const s = db.prepare(query); return { results: s.columns().length ? s.all(...args) : (s.run(...args), []), meta: { changes: 0 } }; },
    first: async col => { log.push(query); const r = db.prepare(query).get(...args); return r == null ? null : col ? r[col] : r; },
    run: async () => { log.push(query); const s = db.prepare(query); if (s.columns().length) return { results: s.all(...args), meta: { changes: 0 } }; return { results: [], meta: { changes: Number(s.run(...args).changes) } }; },
    _q: query, _a: args
  });
  return { prepare: q => stmt(q), batch: async list => { const out = []; for (const s of list) out.push(await stmt(s._q, s._a).run()); return out; } };
}
function cacheStub() {
  const store = new Map(), calls = [];
  const cache = {
    match: async k => { calls.push(['match', k]); const v = store.get(k); return v ? new Response(v) : undefined; },
    put: async (k, res) => { calls.push(['put', k]); store.set(k, await res.text()); }
  };
  return { open: async name => { calls.push(['open', name]); return cache; }, store, calls };
}
async function fixture(t, { cache = false } = {}) {
  const db = new DatabaseSync(':memory:'); db.exec(readFileSync(root + 'schema.sql', 'utf8'));
  const ai = new DatabaseSync(':memory:'); ai.exec(readFileSync(root + 'schema_ai.sql', 'utf8'));
  db.exec(`INSERT INTO questions (id,section,domain,skill,difficulty,stem_html,choices_json,correct_answer,explanation_html,source) VALUES
    ('mc1','Math','Algebra','Linear functions','Easy','<p>One</p>','[{"letter":"A","content":"wrong ΓÇö one","trap":"sign"},{"letter":"B","content":"right"},{"letter":"","content":"blank letter"}]','B','<p>B.</p>','College Board'),
    ('mc2','Reading & Writing','Craft and Structure','Words in Context','Hard','<p>Two</p>','[{"letter":"A","content":"a"},{"letter":"B","content":"b","trap":"scope"}]','["A"]','<p>A.</p>','College Board'),
    ('spr1','Math','Advanced Math','Nonlinear functions','Medium','<p>Three</p>','[]','','<p>The correct answer is 3/4 or .75.</p>','College Board'),
    ('spr2','Math','Algebra','Linear functions','Hard','<p>Four</p>','[]','1.50','','College Board'),
    ('bad','Math','Algebra','Systems','Medium','<p>Five</p>','not json','C','<p>x</p>','College Board'),
    ('idle','Reading & Writing','Information and Ideas','Inferences','Easy','<p>Six</p>','[{"letter":"A"},{"letter":"B"}]','B','','College Board');`);
  ai.exec(`INSERT INTO questions (id,section,domain,skill,difficulty,stem_html,choices_json,correct_answer,explanation_html,source,level) VALUES
    ('ai1','Reading & Writing','Craft and Structure','Words in Context','Hard','<p>AI</p>','[{"letter":"A","trap":"tone"},{"letter":"B"}]','A','<p>A.</p>','AI',5);`);
  db.exec("INSERT INTO ai_ids (id) VALUES ('ai1')");
  const users = [['admin', 'admin'], ['s1', 'student'], ['s2', 'student'], ['s3', 'student']];
  for (const [id, role] of users) {
    db.prepare('INSERT INTO users (id,email,name,role) VALUES (?,?,?,?)').run(id, id + '@ccs.us', 'Name ' + id, role);
    db.prepare("INSERT INTO membership (user_id,email,status) VALUES (?,?,'approved')").run(id, id + '@ccs.us');
  }
  const prog = db.prepare('INSERT INTO progress (user_id,question_id,attempts,corrects,marker,last_reviewed,time_taken_ms) VALUES (?,?,?,?,?,?,?)');
  const att = db.prepare('INSERT INTO attempts (user_id,question_id,ts,correct,time_taken_ms,picked,changes,answer_history_json,lesson_session_id) VALUES (?,?,?,?,?,?,?,?,?)');
  prog.run('s1', 'mc1', 2, 1, 'Orange', '2026-09-02T00:00:00Z', 50000); prog.run('s1', 'spr1', 1, 0, 'Red', '2026-09-03T00:00:00Z', 90000);
  prog.run('s1', 'ai1', 1, 1, 'Green', '2026-09-04T00:00:00Z', 30000); prog.run('s1', 'gone', 1, 0, 'Red', '2026-09-04T00:00:00Z', 1);
  att.run('s1', 'mc1', '2026-09-01T00:00:00Z', 0, 20000, 'A', 1, '[{"answer":"B","atMs":1},{"answer":"A","atMs":2}]', null);
  att.run('s1', 'mc1', '2026-09-02T00:00:00Z', 1, 50000, 'B', 0, null, 7);
  att.run('s1', 'spr1', '2026-09-03T00:00:00Z', 0, 90000, '0.7', 2, '[{"answer":".75","atMs":1},{"answer":"0.7","atMs":9}]', null);
  att.run('s1', 'ai1', '2026-09-04T00:00:00Z', 1, 30000, 'A', 0, null, null);
  att.run('s1', 'gone', '2026-09-05T00:00:00Z', 0, 1000, 'C', 0, null, null);
  prog.run('s2', 'mc2', 1, 0, 'Red', '2026-09-06T00:00:00Z', 200000); prog.run('s2', 'spr2', 1, 1, 'Green', '2026-09-06T00:00:00Z', 10000);
  att.run('s2', 'mc2', '2026-09-06T00:00:00Z', 0, 200000, 'B', 0, null, null);
  att.run('s2', 'spr2', '2026-09-06T00:00:01Z', 1, 10000, '1.5', 0, null, null);
  db.exec("INSERT INTO question_lesson_usage (question_id,session_id,used_at) VALUES ('mc1',3,'2026-09-01 10:00:00')");
  const log = [];
  const env = { DB: d1(db, log), AI_DB: d1(ai, log), ASSETS: { fetch: async () => new Response('asset') } };
  const saved = globalThis.caches, stub = cache ? cacheStub() : null;
  if (stub) globalThis.caches = stub; else delete globalThis.caches;
  t.after(() => { if (saved) globalThis.caches = saved; else delete globalThis.caches; db.close(); ai.close(); });
  const { handleRequest } = await import('../src/index.js');
  const get = (path, user = 'admin') => handleRequest(new Request(origin + path), env, async () => user ? { id: user, email: user + '@ccs.us' } : null);
  return { db, ai, env, log, stub, get, prog, att };
}

// Pre-free-02 references (src/index.js before this task), kept here as the oracle.
async function reference({ db, ai }) {
  const S = await import('../public/shared/stats.js'), { padSessionId } = await import('../src/index.js');
  const cols = 'id, external_id, section, domain, difficulty, skill, stem_html, choices_json, correct_answer, explanation_html, source, source_page, has_figure';
  const bank = [...db.prepare(`SELECT ${cols} FROM questions`).all(), ...ai.prepare(`SELECT ${cols}, level FROM questions`).all()].map(r => ({ ...r }));
  const qs = bank.map(S.normalizeQuestion);
  const data = id => {
    const prog = Object.fromEntries(db.prepare('SELECT question_id, attempts, corrects, marker, last_reviewed, time_taken_ms FROM progress WHERE user_id = ?').all(id).map(p => [p.question_id, { ...p }]));
    const log = db.prepare('SELECT question_id, ts, correct, time_taken_ms, picked, changes, answer_history_json, lesson_session_id FROM attempts WHERE user_id = ? ORDER BY ts').all(id).map(r => ({ ...r }));
    return { prog, log, stats: S.breakdown(qs, prog, log) };
  };
  const listRow = id => {
    const { stats } = data(id);
    const weak = Object.entries(stats.skills).filter(([, v]) => v.a).sort((a, b) => a[1].c / a[1].a - b[1].c / b[1].a || a[0].localeCompare(b[0]))[0];
    const vals = Object.values(stats.paceSection), n = vals.reduce((s, x) => s + x.n, 0);
    return { done: stats.tally.att, accuracy: stats.tally.att ? Math.round(100 * stats.tally.corr / stats.tally.att) : null, weakest: weak?.[0] || null,
      avgMs: n ? vals.reduce((s, x) => s + x.ms, 0) / n : null, targetMs: n ? vals.reduce((s, x) => s + x.target, 0) / n : null,
      guessRate: stats.guessing.n ? stats.guessing.changedN / stats.guessing.n : null, lastActive: stats.lastActive };
  };
  const detail = id => {
    const { prog, log, stats } = data(id), byId = new Map(qs.map(q => [q.id, q]));
    const directions = { 'right-to-wrong': 0, 'wrong-to-right': 0, unchanged: 0, unknown: 0 };
    log.forEach(x => { directions[S.direction(byId.get(x.question_id) || { answer: '', choices: [] }, x)]++; });
    const latest = new Map();
    for (const x of log) if (!latest.has(x.question_id) || x.ts >= latest.get(x.question_id).ts) latest.set(x.question_id, x);
    const mistakes = qs.filter(q => ['Red', 'Orange'].includes(prog[q.id]?.marker)).map(q => ({ question_id: q.id, marker: prog[q.id].marker,
      picked: latest.get(q.id)?.picked || null, lessonSessionId: latest.get(q.id)?.lesson_session_id ? padSessionId(latest.get(q.id).lesson_session_id) : null, question: q }));
    return JSON.parse(JSON.stringify({ stats, directions, mistakes, totalHistory: log.length }));
  };
  const usage = new Map();
  for (const r of db.prepare('SELECT question_id, session_id FROM question_lesson_usage ORDER BY used_at, session_id').all())
    (usage.get(r.question_id) || usage.set(r.question_id, []).get(r.question_id)).push(padSessionId(r.session_id));
  const questions = JSON.stringify(bank.map(q => ({ ...q, usedInLesson: usage.get(q.id) || [] })));
  return { listRow, detail, questions };
}

for (const cache of [false, true]) {
  test(`admin students list and detail match the whole-bank computation (cache ${cache ? 'on' : 'absent'})`, async t => {
    const f = await fixture(t, { cache });
    const ref = await reference(f);
    for (let round = 0; round < 2; round++) {
      const list = await (await f.get('/api/admin/students?page=1')).json();
      assert.deepEqual(list.students.map(({ id, email, name, status, ...row }) => [id, row]), ['s1', 's2', 's3'].map(id => [id, ref.listRow(id)]));
      for (const id of ['s1', 's2', 's3']) {
        const { stats, directions, mistakes, totalHistory } = await (await f.get('/api/admin/students/' + id)).json();
        assert.deepEqual({ stats, directions, mistakes, totalHistory }, ref.detail(id), id);
      }
    }
  });
}

test('lean stats read the explanation only for grid-ins whose answer comes out empty', async t => {
  const f = await fixture(t);
  await f.get('/api/admin/students/s1');
  const reads = f.log.filter(q => /explanation_html FROM questions WHERE id IN/.test(q));
  assert.equal(reads.length, 1);
  assert.ok(!f.log.some(q => /stem_html/.test(q) && !/WHERE id IN/.test(q)), 'no whole-bank HTML read');
});

test('cached admin stats move with a new attempt or progress write and are reused otherwise', async t => {
  const f = await fixture(t, { cache: true });
  const row = async id => (await (await f.get('/api/admin/students?page=1')).json()).students.find(x => x.id === id);
  assert.equal((await row('s2')).done, 2);
  f.log.length = 0;
  assert.equal((await row('s2')).done, 2);
  assert.ok(!f.log.some(q => /FROM attempts WHERE user_id IN .* ORDER BY ts/.test(q)), 'warm list reads no attempt rows');
  f.prog.run('s2', 'idle', 1, 1, 'Green', '2026-09-07T00:00:00Z', 5000);
  f.att.run('s2', 'idle', '2026-09-07T00:00:00Z', 1, 5000, 'B', 0, null, null);
  const fresh = await reference(f);
  assert.deepEqual((({ id, email, name, status, ...r }) => r)(await row('s2')), fresh.listRow('s2'));
  const detail = await (await f.get('/api/admin/students/s2')).json();
  assert.equal(detail.totalHistory, 3);
  // A progress rewrite with no new attempt (e.g. a Red corrected elsewhere) also moves the stamp.
  f.db.prepare("UPDATE progress SET marker='Orange', corrects=1, last_reviewed='2026-09-08T00:00:00Z' WHERE user_id='s2' AND question_id='mc2'").run();
  assert.deepEqual((await (await f.get('/api/admin/students/s2')).json()).stats, (await reference(f)).detail('s2').stats);
  // Nothing a student can read: the stats caches are opened only behind the admin check.
  f.stub.calls.length = 0;
  assert.equal((await f.get('/api/admin/students?page=1', 's1')).status, 403);
  assert.deepEqual(f.stub.calls, []);
});

test('/api/questions is served whole from the bank cache, after auth, and moves with new questions or usage', async t => {
  const f = await fixture(t, { cache: true });
  assert.equal((await f.get('/api/questions', null)).status, 401);
  assert.deepEqual(f.stub.calls, [], 'no cache access before authentication');
  const first = await f.get('/api/questions', 's1');
  assert.equal(first.headers.get('Cache-Control'), 'private, no-store');
  assert.equal(await first.text(), (await reference(f)).questions);
  f.log.length = 0;
  const again = await f.get('/api/questions', 's2');
  assert.equal(again.headers.get('Cache-Control'), 'private, no-store');
  assert.equal(await again.text(), (await reference(f)).questions);
  assert.ok(!f.log.some(q => /stem_html/.test(q)), 'hit reads no question rows');
  f.db.exec("INSERT INTO question_lesson_usage (question_id,session_id,used_at) VALUES ('mc2',4,'2026-09-09 10:00:00')");
  assert.equal(await (await f.get('/api/questions', 's1')).text(), (await reference(f)).questions);
  f.ai.exec("INSERT INTO questions (id,section,domain,skill,difficulty,stem_html,choices_json,correct_answer,source,level) VALUES ('ai2','Math','Algebra','Linear functions','Hard','<p>New</p>','[]','2','AI',4)");
  assert.equal(await (await f.get('/api/questions', 's1')).text(), (await reference(f)).questions);
  const denied = await f.get('/api/questions', 'nobody');
  assert.equal(denied.status, 403);
});

test('demoji and normalizeQuestion fast paths return what the full paths return', async () => {
  const S = await import('../public/shared/stats.js');
  const MOJIBAKE = [['ΓêÆ', '−'], ['ΓåÆ', '→'], ['ΓêÜ', '√'], ['ΓÇö', '—'], ['ΓÇô', '–'], ['ΓÇÖ', '’'],
    ['ΓÇ£', '“'], ['ΓÇ¥', '”'], ['ΓÇª', '…'], ['Γëñ', '≤'], ['ΓëÑ', '≥'], ['Γëá', '≠'],
    ['Γëê', '≈'], ['¤Ç', 'π'], ['├ù', '×'], ['┬°', '°'], ['┬╗', '·'], ['┬▓', '²']];
  const oldDemoji = h => MOJIBAKE.reduce((a, [bad, good]) => a.split(bad).join(good), h || '');
  const oldAnswer = q => { let answer; try { const a = typeof q.correct_answer === 'string' ? JSON.parse(q.correct_answer) : (q.correct_answer || []); answer = Array.isArray(a) ? a.join('') : String(a); } catch { answer = q.correct_answer || ''; } return answer; };
  for (const h of ['', null, undefined, 'plain', 'a ΓÇö b', '┬°C', '├ù and ¤Ç', 'Γ alone'])
    assert.equal(S.demoji(h), oldDemoji(h), JSON.stringify(h));
  const answers = ['B', ' B', '["A"]', '[" A","B"]', '12', ' 12', '1.50', '-3', '"x"', 'true', 'false', 'null', 'nope', 'fail', '', ' "x"', '\t"y"', '{"a":1}', 'A — because', '3/4', '.5', 7, null, ['C'], 'ΓêÆ1'];
  for (const a of answers) {
    const got = S.normalizeQuestion({ choices_json: '[{"letter":"A"},{"letter":"B"},{"letter":"C"}]', correct_answer: a }).answer;
    let want = oldAnswer({ correct_answer: a });
    want = oldDemoji(String(want || '').replace(/\\u([0-9a-f]{4})/gi, (_, x) => String.fromCharCode(parseInt(x, 16))));
    const m = want.match(/^\s*([A-D])\s*[—–-]\s*\S/); if (m) want = m[1];
    assert.equal(got, want, JSON.stringify(a));
  }
});
