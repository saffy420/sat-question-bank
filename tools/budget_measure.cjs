// Free-plan budget driver (docs/perf/FREE-PLAN-BRIEF.md §4-§5). Drives every measured flow
// over HTTP + WebSocket as the real clients do (same endpoints, bodies and message shapes) and
// groups the BUDGET_TRACE lines by flow.
//   node tools/budget_measure.cjs local            fresh local state on :8790, writes docs/perf/budget-local.json
//   node tools/budget_measure.cjs staging [flows]  STAGING_URL / STAGING_TEST_TOKEN from .e2e.staging.env,
//                                                   traces from X-Budget-Trace + `wrangler tail`
// Local only ever touches .wrangler/state-budget; staging only the roadto1600-staging Worker.
const { spawn, spawnSync } = require('node:child_process');
const { resolve, join } = require('node:path');
const { rmSync, writeFileSync, readFileSync, existsSync, mkdirSync } = require('node:fs');
const { build, CONFIG } = require('./budget_seed.cjs');
const root = resolve(__dirname, '..');
const target = process.argv[2];
if (!['local', 'staging'].includes(target)) throw new Error('usage: node tools/budget_measure.cjs local|staging [flow,...]');
const only = process.argv[3] ? new Set(process.argv[3].split(',')) : null;
const wranglerBin = resolve(root, 'node_modules/wrangler/bin/wrangler.js');
const childEnv = { ...process.env, CLOUDFLARE_LOAD_DEV_VARS_FROM_DOT_ENV: 'false' };
delete childEnv.E2E_TEST_MODE;

let BASE, STAGING_TOKEN = null;
const traces = [], httpTraces = [];
const onLine = line => {
  const at = line.indexOf('BUDGET_TRACE ');
  if (at < 0) return;
  try { traces.push({ ...JSON.parse(line.slice(at + 13)), seen: Date.now() }); } catch { /* partial line */ }
};
const lineReader = stream => { let buf = ''; stream.on('data', d => { buf += d; const parts = buf.split('\n'); buf = parts.pop(); parts.forEach(onLine); }); };
const sleep = ms => new Promise(r => setTimeout(r, ms));

// --- local server -----------------------------------------------------------------------
function d1(binding, file) {
  const r = spawnSync(process.execPath, [wranglerBin, 'd1', 'execute', binding, '--local', '--config', 'wrangler.e2e.toml', '--persist-to', '.wrangler/state-budget', '--file', file],
    { cwd: root, env: childEnv, encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`seed ${file} failed: ${r.stderr || r.stdout}`);
}
async function startLocal() {
  rmSync(join(root, '.wrangler/state-budget'), { recursive: true, force: true });
  const dir = join(root, '.wrangler/budget'); mkdirSync(dir, { recursive: true });
  spawnSync(process.execPath, [join(__dirname, 'budget_seed.cjs'), dir], { stdio: 'inherit' });
  for (const [b, f] of [['DB', 'schema.sql'], ['AI_DB', 'schema_ai.sql'], ['AI_DB', join(dir, 'budget_ai.sql')],
    ...['questions', 'accounts', 'history', 'past', 'live'].map(p => ['DB', join(dir, `budget_${p}.sql`)])]) d1(b, f);
  const child = spawn(process.execPath, [wranglerBin, 'dev', '--local', '--config', 'wrangler.e2e.toml', '--persist-to', '.wrangler/state-budget',
    '--ip', '127.0.0.1', '--port', '8790', '--local-protocol', 'http', '--show-interactive-dev-session=false', '--inspector-port', '9239',
    '--var', 'E2E_TEST_MODE:1', '--var', 'BUDGET_TRACE:1', '--env-file', 'tools/e2e_unset.env'], { cwd: root, env: childEnv });
  lineReader(child.stdout); lineReader(child.stderr);
  BASE = 'http://127.0.0.1:8790';
  for (let i = 0; i < 120; i++) { try { if ((await fetch(BASE + '/login')).ok) return child; } catch { /* starting */ } await sleep(500); }
  child.kill(); throw new Error('local worker did not start');
}
// Staging DO events only reach `wrangler tail`; Worker invocations also carry X-Budget-Trace.
function startTail() {
  const child = spawn(process.execPath, [wranglerBin, 'tail', 'roadto1600-staging', '--format', 'json'], { cwd: root, env: childEnv });
  let buf = '';
  child.stdout.on('data', d => {
    buf += d;
    // wrangler prints one pretty JSON object per event; split on top-level boundaries.
    let depth = 0, start = -1, inStr = false, esc = false, cut = 0;
    for (let i = 0; i < buf.length; i++) {
      const c = buf[i];
      if (inStr) { if (esc) esc = false; else if (c === '\\') esc = true; else if (c === '"') inStr = false; continue; }
      if (c === '"') inStr = true; else if (c === '{') { if (!depth++) start = i; } else if (c === '}' && !--depth) {
        try {
          const ev = JSON.parse(buf.slice(start, i + 1));
          const log = (ev.logs || []).map(l => [].concat(l.message).join(' ')).find(m => m.startsWith('BUDGET_TRACE '));
          if (log) traces.push({ ...JSON.parse(log.slice(13)), cpuMs: ev.cpuTime, tailWallMs: ev.wallTime, outcome: ev.outcome, seen: Date.now() });
          // A killed invocation never prints its trace line; keep its outcome and CPU.
          else if (ev.outcome && ev.outcome !== 'ok') traces.push({ kind: ev.entrypoint ? 'do' : 'worker', label: ev.event?.request?.url?.replace(/^https?:\/\/[^/]+/, '') || '', outcome: ev.outcome, cpuMs: ev.cpuTime, tailWallMs: ev.wallTime, killed: true, seen: Date.now() });
        } catch { /* not an event */ }
        cut = i + 1;
      }
    }
    buf = buf.slice(cut);
  });
  return child;
}

// --- clients ------------------------------------------------------------------------------
const headers = (u, extra = {}) => ({ Origin: BASE, ...(u ? { Authorization: 'Bearer ' + u.token } : {}), ...(STAGING_TOKEN ? { 'X-Staging-Test-Token': STAGING_TOKEN } : {}), ...extra });
async function api(u, method, path, body) {
  const r = await fetch(BASE + path, { method, headers: headers(u, body ? { 'Content-Type': 'application/json' } : {}), body: body ? JSON.stringify(body) : undefined });
  const text = await r.text();
  // Staging: the Worker's own trace rides on the response; tail events can arrive late or drop.
  const h = r.headers.get('X-Budget-Trace');
  if (h && target === 'staging') httpTraces.push({ ...JSON.parse(h), status: r.status });
  if (target === 'staging' && !r.ok) httpTraces.push({ kind: 'worker', label: method + ' ' + path.split('?')[0], status: r.status, failed: true });
  if (!r.ok) throw new Error(`${method} ${path} -> ${r.status} ${(/Error \d{4}[^<]*|<title>[^<]*/.exec(text) || [text])[0].slice(0, 200)}`);
  try { return JSON.parse(text); } catch { return text; }
}
async function login(account) {
  const r = await fetch(BASE + '/api/e2e/login', { method: 'POST', headers: headers(null, { 'Content-Type': 'application/json' }), body: JSON.stringify({ account }) });
  if (!r.ok) throw new Error('login ' + account + ' ' + r.status);
  const b = await r.json();
  return { id: account, token: b.token };
}
function socket(u, sessionId, client) {
  const url = BASE.replace(/^http/, 'ws') + `/api/lessons/${sessionId}/ws${client ? '?client=' + client : ''}`;
  const ws = new WebSocket(url, { headers: headers(u) });
  const s = { ws, last: null, messages: [], waiters: [] };
  ws.onmessage = e => { const m = JSON.parse(e.data); s.messages.push(m); if (m.type === 'snapshot') s.last = m; s.waiters = s.waiters.filter(w => !w(m)); };
  s.open = new Promise((ok, fail) => { ws.onopen = ok; ws.onerror = fail; });
  s.send = m => ws.send(JSON.stringify(m));
  s.until = (pred, ms = 30000) => new Promise((ok, fail) => {
    if (s.last && pred(s.last)) return ok(s.last);
    const t = setTimeout(() => fail(new Error('timeout waiting on ' + u.id + ' ' + pred)), ms);
    s.waiters.push(m => m.type === 'snapshot' && pred(m) ? (clearTimeout(t), ok(m), true) : false);
  });
  return s;
}

// --- flows --------------------------------------------------------------------------------
const results = {};
async function flow(name, fn) {
  if (only && !only.has(name)) return;
  const from = traces.length, fromHttp = httpTraces.length, t = Date.now();
  let extra = {};
  // A failed flow is a finding (e.g. Error 1102, CPU limit): record it and carry on.
  try { extra = await fn() || {}; } catch (e) { extra = { error: String(e.message).replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').slice(0, 400) }; console.log(name + ' FAILED: ' + extra.error); }
  await sleep(target === 'staging' ? 8000 : 800);
  const list = traces.slice(from);
  results[name] = { ms: Date.now() - t, ...extra, invocations: list.map(({ seen, ...x }) => x), ...(target === 'staging' ? { responses: httpTraces.slice(fromHttp) } : {}) };
  const sum = k => list.reduce((n, x) => n + (x[k] || 0), 0);
  console.log(`${name}: ${list.length} invocations, ${sum('statements')} statements, ${sum('rowsRead')} rows read, ${sum('rowsWritten')} rows written`);
}

async function main() {
  let server = null, tail = null;
  if (target === 'local') server = await startLocal();
  else {
    const env = Object.fromEntries(readFileSync(join(root, '.e2e.staging.env'), 'utf8').split('\n').filter(Boolean).map(l => l.split(/=(.*)/s).slice(0, 2)));
    BASE = env.STAGING_URL; STAGING_TOKEN = env.STAGING_TEST_TOKEN;
    tail = startTail(); await sleep(10000);
  }
  const bank = build(target === 'local' ? CONFIG : { ...CONFIG, ...CONFIG.staging });
  try {
    const admin = await login('e2e-admin');
    const students = [];
    for (let i = 1; i <= 25; i++) students.push(await login('e2e-budget-' + String(i).padStart(2, '0')));
    const s1 = students[0];

    await flow('student-boot', async () => {
      // public/index.html boot: /app, POST /api/auth/session (4066), load() (1492-1509), loadProgress() (1230-1245), loadSettings() (1302).
      await fetch(BASE + '/app', { headers: headers(s1) }).then(r => r.text());
      await api(s1, 'POST', '/api/auth/session');
      const qs = await api(s1, 'GET', '/api/questions');
      await fetch(BASE + '/exams.json', { headers: headers(s1) }).then(r => r.text());
      for (const p of ['/api/progress', '/api/notes', '/api/attempts', '/api/sessions', '/api/lesson-history', '/api/settings']) await api(s1, 'GET', p);
      return { questions: qs.length, questionsBytes: JSON.stringify(qs).length };
    });
    await flow('bank-filter', async () => {
      // Student filters are client-side (no request). The lesson-builder search is server-side:
      // each of the three lesson-usage options, then a section + domain filter change.
      for (const usage of ['show-all', 'hide-attended', 'hide-all']) await api(admin, 'GET', '/api/admin/questions?page=1&lessonUsage=' + usage);
      await api(admin, 'GET', '/api/admin/questions?page=1&section=Math&domain=Algebra&lessonUsage=show-all');
    });
    await flow('practice-answer', async () => {
      // One Check: progress + attempt pushes (public/index.html:1344-1345).
      const qid = 'bq-02999', ts = new Date().toISOString();
      await api(s1, 'POST', '/api/progress', [{ question_id: qid, attempts: 1, corrects: 1, marker: 'Green', last_reviewed: ts, time_taken_ms: 51000, stars: 0 }]);
      await api(s1, 'POST', '/api/attempts', [{ question_id: qid, ts, correct: 1, time_taken_ms: 51000, picked: 'A', changes: 0, answer_history_json: JSON.stringify([{ answer: 'A', atMs: 51000 }]) }]);
    });
    await flow('admin-students', async () => { await api(admin, 'GET', '/api/admin/students?page=1&search=&sort=name&order=asc'); });
    await flow('admin-student-detail', async () => {
      // Overview / By skill / Mistakes / Traps / Pacing / Second-guessing share one detail call; History pages.
      await api(admin, 'GET', '/api/admin/students/' + s1.id);
      await api(admin, 'GET', '/api/admin/students/' + s1.id + '/history?page=1');
    });
    let savedLesson;
    await flow('builder-search-save', async () => {
      await api(admin, 'GET', '/api/admin/lessons');
      await api(admin, 'GET', '/api/admin/questions?page=1&search=linear&lessonUsage=show-all');
      const items = bank.counts && Array.from({ length: 20 }, (_, k) => ({ question_id: 'bq-' + String(100 + k).padStart(5, '0'), time_limit_sec: 90, notes: '' }));
      savedLesson = await api(admin, 'POST', '/api/admin/lessons', { title: 'Budget builder lesson', mode: 'instructor', items });
      // One debounced autosave after an edit (admin-ui/Builder.tsx:475).
      items[0].notes = 'edited';
      await api(admin, 'PUT', '/api/admin/lessons/' + savedLesson.id, { title: 'Budget builder lesson', mode: 'instructor', items });
    });

    // Answer letters from the seed itself (SPR: the key and a wrong number).
    const answers = Object.fromEntries(Object.entries(bank.answers).map(([id, a]) => [id, a.choices.length ? a.choices : [String(a.correct).split(',')[0], '0']]));
    const run = async (lessonId) => {
      const session = await api(admin, 'POST', `/api/admin/lessons/${lessonId}/sessions`);
      const a = socket(admin, session.sessionId); await a.open; await a.until(() => true);
      const socks = [];
      for (const u of students) {
        const j = await api(u, 'POST', '/api/lessons/join', { code: session.joinCode });
        const s = socket(u, session.sessionId, j.clientId); await s.open; await s.until(() => true);
        socks.push(s);
      }
      return { session, a, socks };
    };
    let instructorExtra = {};
    await flow('instructor-lesson', async () => {
      const { session, a, socks } = await run(910001);
      a.send({ type: 'start' });
      const perQuestion = [];
      for (let i = 0; i < CONFIG.lessonQuestions; i++) {
        const snap = await a.until(m => m.phase === 'ANSWERING' && m.index === i);
        const qid = snap.questionId;
        const mark = traces.length;
        socks.forEach((s, k) => { s.send({ type: 'select', questionId: qid, answer: answers[qid][k % answers[qid].length] }); s.send({ type: 'lock', questionId: qid }); });
        await a.until(m => Object.values(m.responses || {}).filter(r => r[qid]?.locked).length === socks.length);
        a.send({ type: 'endNow' });
        await a.until(m => m.phase === 'REVEALED' && m.index === i);
        // Review sync on the revealed question: a few marks, a laser sweep, Desmos states.
        for (let k = 0; k < 3; k++) a.send({ type: 'annotate', questionId: qid, op: { type: 'stroke', id: `m${i}-${k}`, color: '#ff7676', points: [[0.1, 0.1], [0.2, 0.2]] } });
        for (let k = 0; k < 20; k++) { a.send({ type: 'laser', questionId: qid, x: 0.1 + k / 100, y: 0.5 }); await sleep(30); }
        for (let k = 0; k < 3; k++) a.send({ type: 'desmos', questionId: qid, state: { version: 11, expressions: { list: [{ id: '1', latex: 'y=' + k + 'x' }] } } });
        await sleep(200);
        perQuestion.push(traces.length - mark);
        if (i + 1 < CONFIG.lessonQuestions) { a.send({ type: 'next' }); await a.until(m => m.phase === 'READY' && m.index === i + 1); a.send({ type: 'startQuestion' }); }
      }
      a.send({ type: 'endSession' });
      await a.until(m => m.status === 'ended');
      [a, ...socks].forEach(s => s.ws.close());
      instructorExtra = { sessionId: session.sessionId };
      return { sessionId: session.sessionId, students: socks.length, questions: CONFIG.lessonQuestions, wsMessagesPerQuestion: perQuestion };
    });
    let selfSession;
    await flow('self-paced-end', async () => {
      const { session, a, socks } = await run(910002);
      a.send({ type: 'start' });
      await Promise.all(socks.map(s => s.until(m => m.phase === 'ANSWERING' && m.assignedQuestionIds?.length)));
      let seq = 0;
      // Every student works the set: navigate, pick (one change of mind on every 4th), leave (time).
      await Promise.all(socks.map(async (s, k) => {
        const ids = s.last.assignedQuestionIds; let n = 0;
        for (const qid of ids) {
          s.send({ type: 'navigate', questionId: qid });
          if (n % 4 === 0) s.send({ type: 'select', questionId: qid, answer: answers[qid][(k + 1) % answers[qid].length] });
          s.send({ type: 'select', questionId: qid, answer: answers[qid][k % answers[qid].length] });
          s.send({ type: 'time', questionId: qid, deltaMs: 20000 + n * 100, seq: ++n });
          await sleep(15);
        }
        await sleep(300);
        s.send({ type: 'submitAll' });
      }));
      await a.until(m => m.status === 'review', 60000);
      selfSession = { session, a, socks };
      return { sessionId: session.sessionId, students: socks.length, questions: CONFIG.lessonQuestions };
    });
    await flow('poll-review', async () => {
      const { a, socks } = selfSession;
      a.send({ type: 'startPoll' });
      await Promise.all(socks.map(s => s.until(m => m.phase === 'POLL')));
      socks.forEach((s, k) => s.send(k % 2 ? { type: 'vote', option: 1 } : { type: 'vote', option: 2, questionId: s.last.poll.choices[1].questionId }));
      await a.until(m => m.phase === 'REVEALED', 20000);
      const qid = a.last.questionId;
      for (let k = 0; k < 3; k++) a.send({ type: 'annotate', questionId: qid, op: { type: 'stroke', id: `r${k}`, color: '#ff7676', points: [[0.1, 0.1], [0.3, 0.3]] } });
      await sleep(200);
      a.send({ type: 'next' });
      await a.until(m => m.phase === 'FINISHED');
      a.send({ type: 'endSession' });
      await a.until(m => m.status === 'ended');
      [a, ...socks].forEach(s => s.ws.close());
      return { sessionId: selfSession.session.sessionId };
    });
    await flow('my-lessons', async () => {
      const h = await api(students[1], 'GET', '/api/lesson-history');
      await api(students[1], 'GET', '/api/lesson-history/' + (selfSession?.session.sessionId || h.sessions[0].sessionId));
    });
    return { config: target === 'local' ? CONFIG : { ...CONFIG, ...CONFIG.staging }, seed: bank.counts, instructor: instructorExtra };
  } finally {
    await sleep(target === 'staging' ? 5000 : 500);
    server?.kill(); tail?.kill();
  }
}
main().then(meta => {
  const file = join(root, `docs/perf/budget-${target}.json`);
  const prev = existsSync(file) && only ? JSON.parse(readFileSync(file, 'utf8')) : { flows: {} };
  writeFileSync(file, JSON.stringify({ target, at: new Date().toISOString(), ...meta, flows: { ...prev.flows, ...results } }, null, 1));
  console.log('wrote ' + file);
  process.exit(0);
}).catch(e => { console.error(e); process.exit(1); });
