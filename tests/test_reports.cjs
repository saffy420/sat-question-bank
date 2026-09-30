// report-and-suggest: the patch validator, the Claude triage (API mocked, never called), rate limits,
// the admin approve/reject path and the suggestion round trip.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { DatabaseSync } = require('node:sqlite');
const { readFileSync } = require('node:fs');
const root = __dirname + '/../';
const schema = readFileSync(root + 'schema.sql', 'utf8'), aiSchema = readFileSync(root + 'schema_ai.sql', 'utf8'), migration = readFileSync(root + 'migrations/0011_reports.sql', 'utf8');
const origin = 'https://roadto1600.org';
const reports = () => import('../src/reports.js');

function d1(db) {
  const sql = (query, args = []) => ({ bind: (...values) => sql(query, values), first: async () => db.prepare(query).get(...args) || null,
    all: async () => ({ results: db.prepare(query).all(...args) }),
    run: async () => { const stmt = db.prepare(query); if (stmt.columns().length) return { results: stmt.all(...args), meta: { changes: 0 } }; const r = stmt.run(...args); return { results: [], meta: { changes: Number(r.changes), last_row_id: Number(r.lastInsertRowid) } }; } });
  return { prepare: sql, batch: async statements => { db.exec('BEGIN'); try { const out = []; for (const s of statements) out.push(await s.run()); db.exec('COMMIT'); return out; } catch (e) { db.exec('ROLLBACK'); throw e; } } };
}
const CHOICES = '[{"letter":"A","content":"5"},{"letter":"B","content":"6"},{"letter":"C","content":"7"},{"letter":"D","content":"8"}]';
const MATH = { id: 'mq', stem_html: '<p>What is $3 + 4$?</p>', choices_json: CHOICES, correct_answer: 'C', explanation_html: '<p>3 + 4 = 7</p>', section: 'Math' };
function world(t, over = {}) {
  const db = new DatabaseSync(':memory:'), ai = new DatabaseSync(':memory:');
  db.exec(schema); ai.exec(aiSchema);
  db.prepare("INSERT INTO questions (id,section,domain,skill,difficulty,stem_html,choices_json,correct_answer,explanation_html,source) VALUES (?,?,?,?,?,?,?,?,?,?)")
    .run(MATH.id, 'Math', 'Algebra', 'Linear', 'Easy', MATH.stem_html, MATH.choices_json, MATH.correct_answer, MATH.explanation_html, 'CB');
  db.prepare("INSERT INTO questions (id,section,domain,skill,difficulty,stem_html,choices_json,correct_answer,explanation_html,source) VALUES ('other','Math','Algebra','Linear','Easy','<p>Other</p>',?,'A','<p>x</p>','CB')").run(CHOICES);
  db.prepare("INSERT INTO questions (id,section,domain,skill,difficulty,stem_html,choices_json,correct_answer,explanation_html,source) VALUES ('spr','Math','Algebra','Linear','Easy','<p>Enter it.</p>','[]','','<p>The correct answer is 3/4.</p>','CB')").run();
  db.prepare("INSERT INTO ai_ids (id) VALUES ('aiq')").run();
  ai.prepare("INSERT INTO questions (id,section,domain,skill,difficulty,stem_html,choices_json,correct_answer,explanation_html,source,level) VALUES ('aiq','Math','Algebra','Linear','Hard','<p>AI $x$</p>',?,'B','<p>y</p>','AI',4)").run(CHOICES);
  db.exec(`INSERT INTO users(id,email,role) VALUES('admin','admin@ccs.us','admin'),('alice','a@ccs.us','student'),('bob','b@ccs.us','student');
    INSERT INTO membership(user_id,email,status) VALUES('admin','admin@ccs.us','approved'),('alice','a@ccs.us','approved'),('bob','b@ccs.us','approved');`);
  t.after(() => { db.close(); ai.close(); });
  const env = { DB: d1(db), AI_DB: d1(ai), ANTHROPIC_API_KEY: 'test-key', ASSETS: { fetch: async () => new Response('asset') }, ...over };
  return { db, ai, env };
}
const reply = out => async () => new Response(JSON.stringify({ stop_reason: 'end_turn', content: [{ type: 'thinking', thinking: '' }, { type: 'text', text: typeof out === 'string' ? out : JSON.stringify(out) }] }));
const spy = handler => { const calls = []; const fn = async (url, init) => { calls.push({ url, init, body: JSON.parse(init.body) }); return handler(url, init); }; fn.calls = calls; return fn; };
const FIX = { action: 'fix', reason: 'Dollar signs are not math delimiters', patch: { stem_html: '<p>What is \\(3 + 4\\)?</p>' } };
const body = (over = {}) => JSON.stringify({ question_id: 'mq', category: 'formatting', note: 'Shows dollar signs', seen_in: 'bank',
  viewport: { w: 1366, h: 768 }, zoom: 1.1, dpr: 1, html: '<div class="stem">What is $3 + 4$?</div>', ...over });
const submit = async (env, user, text, deps) => { const r = await (await reports()).submitReport(env, { id: user }, text, deps); await r.done; return r; };

// ---------------------------------------------------------------- validator
test('validator accepts markup, math, table and figure-reference fixes and keeps only real changes', async () => {
  const { checkPatch } = await reports();
  const row = { ...MATH, stem_html: '<p>What is $3 + 4$?</p><img src="/qimg/a.png">', explanation_html: '<p>Row: a  b</p>' };
  let r = checkPatch(row, { stem_html: '<p>What is \\(3 + 4\\)?</p><img src="/qimg/b.png">', explanation_html: row.explanation_html });
  assert.deepEqual([r.ok, Object.keys(r.fields)], [true, ['stem_html']], 'unchanged explanation is dropped from the patch');
  r = checkPatch(row, { explanation_html: '<table><tr><td>Row:</td><td>a</td><td>b</td></tr></table>' });
  assert.equal(r.ok, true, 'text laid out as a table');
  r = checkPatch(row, { choices_json: CHOICES.replace('"6"', '"<b>6</b>"') });
  assert.equal(r.ok, true, 'markup inside one choice');
  r = checkPatch(row, { stem_html: '<p>What is \\left( 3 + 4 \\right) \\text{?}</p>' });
  assert.equal(r.ok, false, 'a real change to the words is not tolerated');
  assert.equal(checkPatch(row, { stem_html: '<p>What is 3 \\, + 4?</p><img src="/qimg/a.png">' }).ok, true, 'TeX spacing is tolerated');
});
test('validator rejects answer key, choice, text, unsafe markup and foreign-field changes', async () => {
  const { checkPatch } = await reports();
  const no = (patch, why, row = MATH) => { const r = checkPatch(row, patch); assert.equal(r.ok, false, JSON.stringify(patch)); assert.match(r.reason, why); };
  no({ correct_answer: 'B' }, /correct_answer may not be changed/);
  no({ section: 'Reading & Writing' }, /section may not be changed/);
  no({}, /empty/);
  no({ stem_html: MATH.stem_html }, /changes nothing/);
  no({ choices_json: '[{"letter":"A","content":"5"},{"letter":"B","content":"7"},{"letter":"C","content":"6"},{"letter":"D","content":"8"}]' }, /visible text changed/, MATH);
  no({ choices_json: '[{"letter":"C","content":"7"},{"letter":"B","content":"6"},{"letter":"A","content":"5"},{"letter":"D","content":"8"}]' }, /letters or order/);
  no({ choices_json: '[{"letter":"A","content":"5"},{"letter":"B","content":"6"},{"letter":"C","content":"7"}]' }, /number of choices/);
  no({ choices_json: '[{"letter":"A","content":"5","correct":true},{"letter":"B","content":"6"},{"letter":"C","content":"7"},{"letter":"D","content":"8"}]' }, /other than content/);
  no({ choices_json: 'not json' }, /not valid JSON/);
  no({ stem_html: '<p>What is $3 + 5$?</p>' }, /visible text changed/);
  no({ stem_html: '<p>What is $3 + 4$? Teh</p>' }, /visible text changed/, MATH);
  no({ stem_html: '<p>What is $3 + 4$?</p><script>alert(1)</script>' }, /script/);
  no({ stem_html: '<p onclick="x()">What is $3 + 4$?</p>' }, /onclick/);
  no({ stem_html: '<p>What is $3 + 4$?</p><img src="https://evil.example/a.png">' }, /new URL/);
  no({ stem_html: '<p>What is $3 + 4$?</p><a href="javascript:alert(1)"></a>' }, /script or data URL|new URL/);
  no({ stem_html: '<p>What is $3 + 4$?</p><iframe src="/qimg/a.png"></iframe>' }, /iframe/);
  no({ stem_html: 42 }, /must be a string/);
  // Same visible text, but the grid-in answer the app reads out of the explanation would change.
  no({ explanation_html: '<p>The correct answer is 3<b>/</b>4.</p>' }, /answer key would change/, { id: 'spr', section: 'Math', stem_html: '<p>Enter it.</p>', choices_json: '[]', correct_answer: '', explanation_html: '<p>The correct answer is 3/4.</p>' });
});

// ---------------------------------------------------------------- triage
test('a valid fix becomes a pending item, not a change; the question row is untouched', async t => {
  const { db, env } = world(t);
  const fetchSpy = spy(reply(FIX));
  const r = await submit(env, 'alice', body(), { fetch: fetchSpy });
  assert.deepEqual([r.status, r.body], [200, { ok: true }]);
  assert.equal(fetchSpy.calls.length, 1);
  const call = fetchSpy.calls[0];
  assert.equal(call.url, 'https://api.anthropic.com/v1/messages');
  assert.equal(call.init.headers['x-api-key'], 'test-key');
  assert.equal(call.body.model, (await reports()).TRIAGE_MODEL);
  const sent = call.body.messages[0].content;
  assert.match(sent, /Shows dollar signs/); assert.match(sent, /What is \$3 \+ 4\$\?/); assert.match(sent, /"correct_answer":"C"/); assert.match(sent, /<rendered>\n<div class="stem">/);
  const item = db.prepare('SELECT * FROM question_triage').get();
  assert.deepEqual([item.kind, item.status, item.called], ['fix', 'pending', 1]);
  assert.deepEqual(JSON.parse(item.patch_json).fields, { stem_html: '<p>What is \\(3 + 4\\)?</p>' });
  assert.equal(db.prepare("SELECT stem_html FROM questions WHERE id='mq'").get().stem_html, MATH.stem_html, 'never auto-applied');
  assert.equal(db.prepare("SELECT COUNT(*) n FROM question_reports WHERE status='open'").get().n, 1);
});
test('a fix that changes the answer key is rejected and escalated with the reason', async t => {
  const { db, env } = world(t);
  const bad = { action: 'fix', reason: 'Fix the answer', patch: { correct_answer: 'B', stem_html: '<p>What is \\(3 + 4\\)?</p>' } };
  await submit(env, 'alice', body(), { fetch: spy(reply(bad)) });
  const item = db.prepare('SELECT * FROM question_triage').get();
  assert.deepEqual([item.kind, item.status], ['escalation', 'pending']);
  assert.match(item.reason, /rejected: correct_answer may not be changed/);
  assert.deepEqual(Object.keys(JSON.parse(item.patch_json).rejected), ['correct_answer', 'stem_html']);
  const order = { action: 'fix', reason: 'r', patch: { choices_json: '[{"letter":"C","content":"7"},{"letter":"B","content":"6"},{"letter":"A","content":"5"},{"letter":"D","content":"8"}]' } };
  const b = world(t);
  await submit(b.env, 'alice', body(), { fetch: spy(reply(order)) });
  assert.match(b.db.prepare('SELECT reason FROM question_triage').get().reason, /letters or order/);
});
test('escalation, refusal, bad JSON, HTTP error, timeout and a missing key all end as an escalation', async t => {
  const cases = [
    ['model escalates', reply({ action: 'escalate', reason: 'Needs a renderer change' }), /Needs a renderer change/],
    ['json in a fence', async () => new Response(JSON.stringify({ stop_reason: 'end_turn', content: [{ type: 'text', text: '```json\n{"action":"escalate","reason":"fenced"}\n```' }] })), /fenced/],
    ['refusal', async () => new Response(JSON.stringify({ stop_reason: 'refusal', content: [] })), /declined/],
    ['max tokens', async () => new Response(JSON.stringify({ stop_reason: 'max_tokens', content: [{ type: 'text', text: '{' }] })), /ran out/],
    ['not json', reply('sorry'), /did not return JSON/],
    ['http 500', async () => new Response('x', { status: 500 }), /answered 500/],
    ['timeout', async () => { throw Object.assign(new Error('t'), { name: 'TimeoutError' }); }, /timed out/],
    ['unknown action', reply({ action: 'shrug' }), /person to look/]
  ];
  for (const [name, handler, reason] of cases) {
    const { db, env } = world(t);
    await submit(env, 'alice', body(), { fetch: spy(handler) });
    const item = db.prepare('SELECT kind, status, reason FROM question_triage').get();
    assert.deepEqual([item.kind, item.status], ['escalation', 'pending'], name);
    assert.match(item.reason, reason, name);
  }
  const { db, env } = world(t, { ANTHROPIC_API_KEY: undefined });
  const never = spy(reply(FIX));
  await submit(env, 'alice', body(), { fetch: never });
  assert.equal(never.calls.length, 0);
  assert.match(db.prepare('SELECT reason FROM question_triage').get().reason, /ANTHROPIC_API_KEY/);
});
test('wrong-answer reports never call Claude and escalate at once', async t => {
  const { db, env } = world(t);
  const f = spy(reply(FIX));
  await submit(env, 'alice', body({ category: 'wrong_answer', note: 'It is B' }), { fetch: f });
  await submit(env, 'bob', body({ category: 'wrong_answer' }), { fetch: f });
  assert.equal(f.calls.length, 0);
  const rows = db.prepare('SELECT kind, called, status FROM question_triage').all();
  assert.deepEqual(rows.map(r => ({ ...r })), [{ kind: 'escalation', called: 0, status: 'pending' }], 'one pending escalation per question');
  assert.equal(db.prepare("SELECT COUNT(*) n FROM question_reports WHERE status='open'").get().n, 2);
});
test('test mode refuses any API address but loopback, so a test can never reach the real API', async t => {
  const { apiTarget } = await reports();
  assert.equal(apiTarget({}), 'https://api.anthropic.com/v1/messages');
  assert.equal(apiTarget({ E2E_TEST_MODE: '1' }), null);
  assert.equal(apiTarget({ E2E_TEST_MODE: '1', ANTHROPIC_API_URL: 'https://api.anthropic.com/v1/messages' }), null);
  assert.equal(apiTarget({ E2E_TEST_MODE: '1', ANTHROPIC_API_URL: 'http://127.0.0.1:8790/v1/messages' }), 'http://127.0.0.1:8790/v1/messages');
  const { db, env } = world(t, { E2E_TEST_MODE: '1' });
  const f = spy(reply(FIX));
  await submit(env, 'alice', body(), { fetch: f });
  assert.equal(f.calls.length, 0);
  assert.match(db.prepare('SELECT reason FROM question_triage').get().reason, /not allowed in test mode/);
});

// ---------------------------------------------------------------- limits
test('10 reports per user per day; one open report per user per question', async t => {
  const { db, env } = world(t);
  const { REPORTS_PER_USER_PER_DAY } = await reports();
  assert.equal(REPORTS_PER_USER_PER_DAY, 10);
  const f = spy(reply({ action: 'escalate', reason: 'r' }));
  const first = await submit(env, 'alice', body(), { fetch: f });
  assert.equal(first.status, 200);
  const dup = await submit(env, 'alice', body({ note: 'again' }), { fetch: f });
  assert.deepEqual([dup.status, dup.done], [409, undefined]);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM question_reports').get().n, 1);
  // Another user, and another question, are unaffected.
  assert.equal((await submit(env, 'bob', body(), { fetch: f })).status, 200);
  for (let i = 0; i < 8; i++) { db.prepare("INSERT INTO questions (id,section,stem_html,choices_json,correct_answer) VALUES (?,?,?,?,?)").run('x' + i, 'Math', '<p>x</p>', CHOICES, 'A'); }
  for (let i = 0; i < 8; i++) assert.equal((await submit(env, 'alice', body({ question_id: 'x' + i }), { fetch: f })).status, 200, 'report ' + (i + 2));
  assert.equal(db.prepare("SELECT COUNT(*) n FROM question_reports WHERE user_id='alice'").get().n, 9);
  assert.equal((await submit(env, 'alice', body({ question_id: 'other' }), { fetch: f })).status, 200, 'the 10th is accepted');
  const eleventh = await submit(env, 'alice', body({ question_id: 'aiq' }), { fetch: f });
  assert.deepEqual([eleventh.status, eleventh.body.error], [429, 'daily report limit reached']);
  // Rows older than a day no longer count.
  db.prepare("UPDATE question_reports SET created_at=datetime('now','-2 days') WHERE user_id='alice'").run();
  assert.equal((await submit(env, 'alice', body({ question_id: 'aiq' }), { fetch: f })).status, 200);
});
test('reports are validated: unknown question, bad category, oversized html, no viewport', async t => {
  const { env } = world(t);
  const f = spy(reply(FIX));
  for (const [over, status] of [[{ question_id: 'nope' }, 404], [{ category: 'spam' }, 400], [{ seen_in: 'moon' }, 400], [{ html: 'x'.repeat(100001) }, 400],
    [{ viewport: null }, 400], [{ note: 'n'.repeat(1001) }, 400], [{ zoom: 'big' }, 400]]) {
    assert.equal((await submit(env, 'alice', body(over), { fetch: f })).status, status, JSON.stringify(over).slice(0, 40));
  }
  assert.equal((await submit(env, 'alice', 'x'.repeat(150001), { fetch: f })).status, 413);
  assert.equal((await submit(env, 'alice', '{', { fetch: f })).status, 400);
  assert.equal(f.calls.length, 0);
});
test('at most one Claude call per question per 24 h; duplicates wait and are batched into the next call', async t => {
  const { db, env } = world(t);
  const f = spy(reply({ action: 'escalate', reason: 'first look' }));
  await submit(env, 'alice', body({ note: 'ONE' }), { fetch: f });
  await submit(env, 'bob', body({ note: 'TWO' }), { fetch: f });
  assert.equal(f.calls.length, 1, 'the second report inside the window makes no call');
  assert.equal(db.prepare("SELECT COUNT(*) n FROM question_reports WHERE status='open'").get().n, 2);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM question_triage WHERE called=1').get().n, 1);
  // Another question is independent.
  await submit(env, 'alice', body({ question_id: 'other' }), { fetch: f });
  assert.equal(f.calls.length, 2);
  // A day later the next report carries every report that was not looked at yet.
  db.prepare("UPDATE question_triage SET created_at=datetime('now','-25 hours') WHERE question_id='mq'").run();
  await submit(env, 'alice', body({ question_id: 'aiq', note: 'other question' }), { fetch: f });
  assert.equal(f.calls.length, 3);
  db.prepare("UPDATE question_reports SET status='closed' WHERE user_id='alice' AND question_id='mq'").run();
  await submit(env, 'alice', body({ note: 'THREE' }), { fetch: f });
  assert.equal(f.calls.length, 4);
  const message = f.calls[3].body.messages[0].content;
  assert.match(message, /TWO/); assert.match(message, /THREE/); assert.doesNotMatch(message, /ONE/, 'closed reports are not sent');
  assert.equal(db.prepare("SELECT COUNT(*) n FROM question_triage WHERE question_id='mq' AND status='superseded'").get().n, 1, 'the older pending item is replaced');
});
test('the monthly call cap turns further reports into escalations without a call', async t => {
  const { db, env } = world(t);
  const f = spy(reply({ action: 'escalate', reason: 'r' }));
  const cfg = { monthlyCap: 2 };
  await submit(env, 'alice', body({ question_id: 'mq' }), { fetch: f, cfg });
  await submit(env, 'alice', body({ question_id: 'other' }), { fetch: f, cfg });
  await submit(env, 'alice', body({ question_id: 'spr' }), { fetch: f, cfg });
  assert.equal(f.calls.length, 2);
  const capped = db.prepare("SELECT kind, called, reason FROM question_triage WHERE question_id='spr'").get();
  assert.deepEqual([capped.kind, capped.called], ['escalation', 0]);
  assert.match(capped.reason, /monthly limit/);
  db.prepare("UPDATE question_triage SET created_at=datetime('now','-40 days') WHERE called=1").run();
  await submit(env, 'bob', body({ question_id: 'aiq' }), { fetch: f, cfg });
  assert.equal(f.calls.length, 3, 'a new month starts with a clean count');
  assert.ok((await reports()).MONTHLY_CALL_CAP > 0);
});
test('two reports landing together make one call: the claim is a single conditional insert', async t => {
  const { env } = world(t);
  const f = spy(async () => { await new Promise(r => setTimeout(r, 20)); return reply({ action: 'escalate', reason: 'r' })(); });
  const { submitReport } = await reports();
  const [a, b] = await Promise.all([submitReport(env, { id: 'alice' }, body(), { fetch: f }), submitReport(env, { id: 'bob' }, body(), { fetch: f })]);
  await Promise.all([a.done, b.done]);
  assert.equal(f.calls.length, 1);
});

// ---------------------------------------------------------------- admin decisions
async function app(t, over) {
  const w = world(t, over);
  const { handleRequest } = await import('../src/index.js');
  const pending = [];
  const identity = async req => ({ admin: { id: 'admin', email: 'admin@ccs.us' }, alice: { id: 'alice', email: 'a@ccs.us' }, bob: { id: 'bob', email: 'b@ccs.us' } })[(req.headers.get('Authorization') || '').slice(7)] || null;
  const request = (path, token, method = 'GET', data) => handleRequest(new Request(origin + path, { method, headers: { ...(token ? { Authorization: 'Bearer ' + token } : {}), ...(method !== 'GET' ? { Origin: origin } : {}) },
    ...(data === undefined ? {} : { body: typeof data === 'string' ? data : JSON.stringify(data) }) }), w.env, identity, { waitUntil: p => pending.push(p) });
  return { ...w, request, settle: () => Promise.all(pending.splice(0)) };
}
test('the student gets Thanks before the API answers; the admin sees the fix next to the real question', async t => {
  const a = await app(t);
  let release; const gate = new Promise(r => { release = r; });
  const original = globalThis.fetch;
  globalThis.fetch = async (url, init) => { assert.match(String(url), /api\.anthropic\.com/); await gate; return reply(FIX)(); };
  t.after(() => { globalThis.fetch = original; });
  const res = await a.request('/api/reports', 'alice', 'POST', body());
  assert.deepEqual([res.status, await res.json()], [200, { ok: true }], 'answered while the API call is still waiting');
  assert.equal(a.db.prepare("SELECT status FROM question_triage").get().status, 'running');
  release(); await a.settle();
  assert.equal(a.db.prepare("SELECT kind, status FROM question_triage").get().kind, 'fix');
  assert.equal((await a.request('/api/admin/reports', 'alice')).status, 403, 'students cannot read triage');
  const list = await (await a.request('/api/admin/reports', 'admin')).json();
  assert.equal(list.groups.length, 1);
  const [g] = list.groups;
  assert.deepEqual([g.questionId, g.state, g.items[0].kind, g.items[0].changed], ['mq', 'fix', 'fix', ['stem_html']]);
  assert.match(g.question.stem_html, /\$3 \+ 4\$/); assert.match(g.items[0].after.stem_html, /\\\(3 \+ 4\\\)/);
  assert.equal(g.reports[0].name, null); assert.equal(g.reports[0].context.viewport.w, 1366);
  assert.equal(g.question.answer, 'C'); assert.equal(list.usage.calls, 1);
  const html = await (await a.request(`/api/admin/reports/${g.reports[0].id}/html`, 'admin')).json();
  assert.match(html.html, /class="stem"/);
});
test('Approve writes the row (core), closes every open report on the question and the bank shows the fix at once', async t => {
  const a = await app(t);
  a.env.ANTHROPIC_API_KEY = 'k';
  const original = globalThis.fetch; globalThis.fetch = reply(FIX); t.after(() => { globalThis.fetch = original; });
  await a.request('/api/reports', 'alice', 'POST', body()); await a.settle();
  await a.request('/api/reports', 'bob', 'POST', body({ note: 'me too' })); await a.settle();
  const stem = async () => (await (await a.request('/api/questions', 'alice')).json()).find(q => q.id === 'mq').stem_html;
  assert.match(await stem(), /\$3/);
  const [g] = (await (await a.request('/api/admin/reports', 'admin')).json()).groups;
  assert.equal(g.reports.length, 2);
  assert.equal((await a.request('/api/admin/reports/decision', 'alice', 'POST', { question_id: 'mq', triage_id: g.items[0].id, decision: 'approve' })).status, 403);
  const done = await a.request('/api/admin/reports/decision', 'admin', 'POST', { question_id: 'mq', triage_id: g.items[0].id, decision: 'approve' });
  assert.deepEqual([done.status, await done.json()], [200, { ok: true }]);
  assert.match(await stem(), /\\\(3 \+ 4\\\)/, 'the student sees the fixed question (bank cache key moved)');
  assert.equal(a.db.prepare("SELECT correct_answer, choices_json FROM questions WHERE id='mq'").get().correct_answer, 'C');
  assert.deepEqual(a.db.prepare("SELECT status, COUNT(*) n FROM question_reports GROUP BY status").all().map(r => ({ ...r })), [{ status: 'closed', n: 2 }]);
  assert.equal(a.db.prepare('SELECT status FROM question_triage').get().status, 'applied');
  assert.deepEqual((await (await a.request('/api/admin/reports', 'admin')).json()).groups, []);
  // Closed reports free the slot: alice may report the question again.
  assert.equal((await a.request('/api/reports', 'alice', 'POST', body())).status, 200); await a.settle();
});
test('Approve on an AI question writes AI_DB; a changed question or a repeated approve is refused or idempotent', async t => {
  const a = await app(t);
  const original = globalThis.fetch;
  globalThis.fetch = reply({ action: 'fix', reason: 'math', patch: { stem_html: '<p>AI \\(x\\)</p>' } }); t.after(() => { globalThis.fetch = original; });
  await a.request('/api/reports', 'alice', 'POST', body({ question_id: 'aiq' })); await a.settle();
  const [g] = (await (await a.request('/api/admin/reports', 'admin')).json()).groups;
  assert.equal(g.question.ai, true);
  // The row moved after the triage: refuse.
  a.ai.prepare("UPDATE questions SET stem_html='<p>edited elsewhere $x$</p>' WHERE id='aiq'").run();
  const stale = await a.request('/api/admin/reports/decision', 'admin', 'POST', { question_id: 'aiq', triage_id: g.items[0].id, decision: 'approve' });
  assert.deepEqual([stale.status, (await stale.json()).error], [409, 'the question changed since this fix was proposed']);
  assert.equal(a.db.prepare("SELECT COUNT(*) n FROM question_reports WHERE status='open'").get().n, 1, 'nothing closed on a refused approve');
  a.ai.prepare("UPDATE questions SET stem_html='<p>AI $x$</p>' WHERE id='aiq'").run();
  assert.equal((await a.request('/api/admin/reports/decision', 'admin', 'POST', { question_id: 'aiq', triage_id: g.items[0].id, decision: 'approve' })).status, 200);
  assert.equal(a.ai.prepare("SELECT stem_html FROM questions WHERE id='aiq'").get().stem_html, '<p>AI \\(x\\)</p>');
  assert.equal(a.db.prepare("SELECT COUNT(*) n FROM questions WHERE id='aiq'").get().n, 0);
  assert.equal((await a.request('/api/admin/reports/decision', 'admin', 'POST', { question_id: 'aiq', triage_id: g.items[0].id, decision: 'approve' })).status, 404, 'no second approve');
});
test('Reject and Close settle the reports without touching the question; escalations are grouped by question', async t => {
  const a = await app(t);
  const original = globalThis.fetch; globalThis.fetch = reply({ action: 'escalate', reason: 'Needs a renderer change' }); t.after(() => { globalThis.fetch = original; });
  await a.request('/api/reports', 'alice', 'POST', body()); await a.settle();
  await a.request('/api/reports', 'alice', 'POST', body({ question_id: 'other', category: 'typo' })); await a.settle();
  await a.request('/api/reports', 'bob', 'POST', body({ category: 'wrong_answer' })); await a.settle();
  const list = await (await a.request('/api/admin/reports', 'admin')).json();
  assert.deepEqual(list.groups.map(g => [g.questionId, g.state, g.reports.length]).sort(), [['mq', 'escalation', 2], ['other', 'escalation', 1]]);
  assert.equal(list.groups.find(g => g.questionId === 'mq').items.length, 2, 'the model escalation and the wrong-answer one');
  const r = await a.request('/api/admin/reports/decision', 'admin', 'POST', { question_id: 'mq', decision: 'reject' });
  assert.equal(r.status, 200);
  assert.equal(a.db.prepare("SELECT stem_html FROM questions WHERE id='mq'").get().stem_html, MATH.stem_html);
  assert.equal((await (await a.request('/api/admin/reports', 'admin')).json()).groups.length, 1);
  assert.equal(a.db.prepare("SELECT COUNT(*) n FROM question_triage WHERE question_id='mq' AND status IN ('pending','running')").get().n, 0);
  assert.equal((await a.request('/api/admin/reports/decision', 'admin', 'POST', { question_id: 'mq', decision: 'maybe' })).status, 400);
});
test('AUTO_APPLY_FORMATTING_FIXES is off, and when on applies only validated fixes for formatting reports', async t => {
  const { AUTO_APPLY_FORMATTING_FIXES } = await reports();
  assert.equal(AUTO_APPLY_FORMATTING_FIXES, false);
  let w = world(t);
  await submit(w.env, 'alice', body(), { fetch: spy(reply(FIX)), cfg: { autoApply: true } });
  assert.match(w.db.prepare("SELECT stem_html FROM questions WHERE id='mq'").get().stem_html, /\\\(3 \+ 4\\\)/);
  assert.deepEqual([w.db.prepare('SELECT status FROM question_triage').get().status, w.db.prepare("SELECT status FROM question_reports").get().status], ['applied', 'closed']);
  w = world(t);
  await submit(w.env, 'alice', body({ category: 'typo' }), { fetch: spy(reply(FIX)), cfg: { autoApply: true } });
  assert.equal(w.db.prepare('SELECT status FROM question_triage').get().status, 'pending', 'a typo report is never auto-applied');
  w = world(t);
  await submit(w.env, 'alice', body(), { fetch: spy(reply({ action: 'fix', reason: 'r', patch: { stem_html: '<p>What is $3 + 9$?</p>' } })), cfg: { autoApply: true } });
  assert.equal(w.db.prepare("SELECT stem_html FROM questions WHERE id='mq'").get().stem_html, MATH.stem_html, 'an invalid fix is never applied');
});

// ---------------------------------------------------------------- suggestions
test('suggestion round trip: 5 per user per day, newest first, mark done or dismiss', async t => {
  const a = await app(t);
  const send = (token, data) => a.request('/api/suggestions', token, 'POST', data);
  assert.equal((await send('alice', { body: '   ' })).status, 400);
  assert.equal((await send('alice', { body: 'x', area: 'moon' })).status, 400);
  assert.equal((await send('alice', { body: 'y'.repeat(2001) })).status, 400);
  assert.equal((await send(null, { body: 'x' })).status, 401);
  for (const [i, area] of ['bank', 'lessons', 'plan', 'other', null].entries()) assert.equal((await send('alice', { body: 'Idea ' + i, area })).status, 200, 'suggestion ' + (i + 1));
  const sixth = await send('alice', { body: 'Idea 6' });
  assert.deepEqual([sixth.status, (await sixth.json()).error], [429, 'daily suggestion limit reached']);
  assert.equal((await send('bob', { body: 'From Bob' })).status, 200, 'the limit is per user');
  assert.equal((await a.request('/api/admin/suggestions', 'alice')).status, 403);
  const list = (await (await a.request('/api/admin/suggestions', 'admin')).json()).suggestions;
  assert.deepEqual(list.map(s => s.body), ['From Bob', 'Idea 4', 'Idea 3', 'Idea 2', 'Idea 1', 'Idea 0'], 'newest first');
  assert.equal(list[4].area, 'lessons');
  assert.equal((await a.request(`/api/admin/suggestions/${list[0].id}`, 'admin', 'POST', { status: 'done' })).status, 200);
  assert.equal((await a.request(`/api/admin/suggestions/${list[1].id}`, 'admin', 'POST', { status: 'dismissed' })).status, 200);
  assert.equal((await a.request(`/api/admin/suggestions/${list[1].id}`, 'admin', 'POST', { status: 'weird' })).status, 400);
  assert.equal((await a.request('/api/admin/suggestions/99999', 'admin', 'POST', { status: 'done' })).status, 404);
  assert.equal((await (await a.request('/api/admin/suggestions', 'admin')).json()).suggestions.length, 4, 'handled ones leave the default list');
  assert.equal((await (await a.request('/api/admin/suggestions?status=all', 'admin')).json()).suggestions.length, 6);
});

test('0011 upgrade creates the same tables and indexes as the snapshot', () => {
  const base = new DatabaseSync(':memory:'), upgraded = new DatabaseSync(':memory:');
  base.exec(schema);
  upgraded.exec(schema.slice(0, schema.indexOf('-- Question reports, their AI triage'))); upgraded.exec(migration);
  const shape = db => db.prepare("SELECT name, sql FROM sqlite_master WHERE name LIKE 'question_reports%' OR name LIKE 'question_triage%' OR name LIKE 'feature_suggestions%' ORDER BY name").all().map(r => ({ ...r }));
  assert.equal(shape(base).length, 10);
  assert.deepEqual(shape(upgraded), shape(base));
});
