// Self-check for the write queue in public/index.html.
//
// A refused write used to be a lost answer: it was reported once per page load and
// dropped, so after the first failure the rest of a session saved nothing and said
// nothing. These assertions are the ones that stop that coming back.
//
// The code lives inside the page's IIFE, so it is lifted by its markers rather
// than copied here - a copy would drift from the one that ships.
//
//   node tests/test_sync.cjs
const fs = require('fs');
const assert = require('assert');

const page = fs.readFileSync(__dirname + '/../public/index.html', 'utf8');
const block = page.slice(page.indexOf('// --- sync'), page.indexOf('// --- end sync ---'));
if (!block) throw new Error('sync block not found in public/index.html');

// Everything the block reaches for that a page would have provided.
const PRE = `
  let authToken = 'tok', uid = 'u1', loggingOut = false, SESS = {}, NOTES = {};
  let SET = { theme: 'dark' };
  const LS = { set() {} };
  const els = {};
  const $ = (id) => els[id] || null;
  // The toast is one div holding a message span and a close button; the stub
  // registers both children when innerHTML is set, which is all the block does.
  const document = { hidden: false, body: { appendChild: (e) => (els[e.id] = e, e) },
    createElement: () => ({ set innerHTML(v) { els['sync-msg'] = { textContent: '' }; els['sync-x'] = {}; },
                            remove() { delete els[this.id]; delete els['sync-msg']; delete els['sync-x']; } }) };
  const addEventListener = () => {};
  const sbHeaders = async () => ({ Authorization: 'Bearer tok' });
`;
const settings = page.slice(page.indexOf('async function saveSettings()'), page.indexOf('// A change to one setting:'));
const api = new Function(PRE + block + settings +
  '\nreturn { push, flush, PENDING, unsaved, warnSync, banner: () => ($("sync-bar") ? $("sync-msg").textContent : undefined), close: () => $("sync-x").onclick(), ' +
  'setToken: (t) => { authToken = t; }, setOwner: (id) => { uid = id; resetPending(id); }, saveSettings, deleteSession, saveSession, SESS };')();

// One fetch stub. `fail` decides what the server does; `sent` records every body.
let fail = false, sent = [];
global.fetch = async (url, opt) => {
  sent.push({ url, rows: JSON.parse(opt.body) });
  return fail ? { ok: false, status: 429 } : { ok: true, status: 200, json: async () => ({ saved: JSON.parse(opt.body).length, acknowledged: JSON.parse(opt.body) }) };
};
const P = api.PENDING;
const reset = () => { fail = false; sent = []; P['/api/progress'].length = 0; P['/api/attempts'].length = 0; api.warnSync(''); };

(async () => {
  // A write the server takes leaves nothing behind and no banner.
  reset();
  await api.push('/api/progress', [{ question_id: 'a', marker: 'Red' }]);
  assert.equal(sent.length, 1);
  assert.equal(api.unsaved(), 0, 'an accepted write must not stay queued');
  assert.equal(api.banner(), undefined, 'nothing to report');

  // A refused write is kept, not dropped, and it says so.
  reset();
  fail = true;
  await api.push('/api/progress', [{ question_id: 'a', marker: 'Red' }]);
  assert.equal(api.unsaved(), 1, 'a refused write must be kept');
  assert.match(api.banner(), /1 answer not saved/);

  // The next answer re-sends it, so a session that starts failing recovers whole.
  await api.push('/api/attempts', [{ question_id: 'a', ts: '1' }]);
  assert.equal(api.unsaved(), 2);
  fail = false;
  await api.push('/api/progress', [{ question_id: 'b', marker: 'Red' }]);
  assert.equal(P['/api/progress'].length, 0, 'the queue flushes on the next push');
  assert.deepEqual(sent[sent.length - 1].rows.map(r => r.question_id), ['a', 'b'],
    'the answer that failed goes up with the one that followed it');
  // The attempts queue is a separate endpoint and is still waiting.
  assert.equal(api.unsaved(), 1);
  await api.flush('/api/attempts');
  assert.equal(api.unsaved(), 0);
  assert.equal(api.banner(), undefined, 'the banner clears itself once nothing is waiting');

  // A progress row is the question's whole state, so a later answer to the same
  // question replaces the one waiting. Attempts are history and all are kept.
  reset();
  fail = true;
  await api.push('/api/progress', [{ question_id: 'a', attempts: 1 }]);
  await api.push('/api/progress', [{ question_id: 'a', attempts: 2 }]);
  assert.equal(P['/api/progress'].length, 1);
  assert.equal(P['/api/progress'][0].attempts, 2, 'the newer state wins');
  await api.push('/api/attempts', [{ question_id: 'a', ts: '1' }]);
  await api.push('/api/attempts', [{ question_id: 'a', ts: '2' }]);
  assert.equal(P['/api/attempts'].length, 2, 'every attempt is history');

  // More than one batch's worth drains in full rather than one batch per answer.
  reset();
  fail = true;
  await api.push('/api/progress', Array.from({ length: 450 }, (_, i) => ({ question_id: 'q' + i })));
  assert.equal(api.unsaved(), 450);
  fail = false; sent = [];
  await api.flush('/api/progress');
  assert.equal(api.unsaved(), 0, 'the whole queue drains');
  assert.deepEqual(sent.map(s => s.rows.length), [200, 200, 50], 'in batches the Worker will take');

  // Signed out there is no account to write to, and nothing is queued for one.
  reset();
  api.setToken('');
  await api.push('/api/progress', [{ question_id: 'a' }]);
  assert.equal(api.unsaved(), 0);
  assert.equal(sent.length, 0);
  api.setToken('tok');

  // A read failure is its own message and survives a successful write.
  reset();
  api.warnSync('Could not load all of your saved progress.');
  await api.push('/api/progress', [{ question_id: 'a' }]);
  assert.match(api.banner(), /Could not load/, 'a read failure is not cleared by a write succeeding');

  // The toast is failure-only and closable. Closed, it stays closed through further
  // failures; it comes back only once the queue has drained and a later flush fails.
  reset();
  fail = true;
  await api.push('/api/progress', [{ question_id: 'a' }]);
  assert.match(api.banner(), /1 answer not saved/);
  api.close();
  assert.equal(api.banner(), undefined, 'the cross hides the toast');
  await api.push('/api/progress', [{ question_id: 'b' }]);
  assert.equal(api.banner(), undefined, 'a further failure does not reopen a closed toast');
  fail = false;
  await api.push('/api/progress', [{ question_id: 'c' }]);
  assert.equal(api.unsaved(), 0);
  assert.equal(api.banner(), undefined, 'nothing is shown on success');
  fail = true;
  await api.push('/api/progress', [{ question_id: 'd' }]);
  assert.match(api.banner(), /1 answer not saved/, 'a new failure after a success shows the toast again');

  const normalFetch = global.fetch;
  const ack = (rows, saved = rows.length) => ({ ok: true, json: async () => ({ saved, acknowledged: rows }) });
  const tick = () => new Promise(resolve => setImmediate(resolve));
  reset();
  api.setOwner('u1');
  let release;
  global.fetch = (_url, opt) => new Promise(resolve => { release = () => resolve(ack(JSON.parse(opt.body))); });
  const original = { question_id: 'a', marker: 'Red', state: { n: 1 } };
  const writing = api.push('/api/progress', [original]);
  await tick();
  original.state.n = 99;
  assert.equal(P['/api/progress'][0].state.n, 1);
  await api.push('/api/progress', [{ question_id: 'a', marker: 'Green' }]);
  global.fetch = async () => ({ ok: false, status: 503 });
  release(); await writing;
  assert.equal(P['/api/progress'].length, 1);
  assert.equal(P['/api/progress'][0].marker, 'Green');

  for (const response of [
    { saved: 1 },
    { saved: 1, acknowledged: [{ question_id: 'other' }] },
    { saved: 1, acknowledged: [{ question_id: 'a', marker: 'Green' }] },
    { saved: 2, acknowledged: [{ question_id: 'a' }, { question_id: 'a' }] },
    { saved: -1, acknowledged: [{ question_id: 'a' }] },
    { saved: 2, acknowledged: [{ question_id: 'a' }] }
  ]) {
    api.setOwner('u1');
    global.fetch = async () => ({ ok: true, json: async () => response });
    await api.push('/api/progress', [{ question_id: 'a' }]);
    assert.equal(api.unsaved(), 1, JSON.stringify(response));
  }
  api.setOwner('u1');
  global.fetch = async () => ack([{ question_id: 'a' }], 0);
  await api.push('/api/attempts', [{ question_id: 'a' }]);
  assert.equal(api.unsaved(), 0, 'idempotently satisfied rows need no new writes');
  global.fetch = async () => ack([{ question_id: 'a' }]);
  await api.push('/api/progress', [{ question_id: 'a' }, { question_id: 'b' }]);
  assert.deepEqual(P['/api/progress'], [{ question_id: 'b' }]);

  api.setOwner('u1');
  global.fetch = (_url, opt) => new Promise(resolve => { release = () => resolve(ack(JSON.parse(opt.body))); });
  const oldWrite = api.push('/api/progress', [{ question_id: 'old' }]);
  await tick();
  api.setOwner('u2');
  global.fetch = async () => ({ ok: false, status: 503 });
  await api.push('/api/progress', [{ question_id: 'new' }]);
  release(); await oldWrite;
  assert.deepEqual(P['/api/progress'], [{ question_id: 'new' }]);
  api.setOwner('u1');
  let requests = 0;
  global.fetch = async () => { requests++; return ack([]); };
  const changing = api.push('/api/notes', [{ question_id: 'old', body: 'private' }]);
  api.setOwner('u2');
  await changing;
  assert.equal(requests, 0, 'account change while acquiring headers cancels request');

  api.setOwner('u1');
  global.fetch = normalFetch; fail = false; sent = [];
  await api.push('/api/sessions', Array.from({ length: 201 }, (_, i) => ({ id: 's' + i, state: { n: i } })));
  assert.deepEqual(sent.map(s => s.rows.length), [200, 1]);
  assert.equal(api.unsaved(), 0);
  global.fetch = async () => ({ ok: false, status: 500 });
  await api.saveSettings();
  assert.match(api.banner(), /Settings could not be saved/);
  api.SESS['a /%'] = { id: 'a /%' };
  assert.equal(await api.deleteSession('a /%'), false);
  assert.ok(api.SESS['a /%']);
  assert.match(api.banner(), /Session could not be deleted/);
  let deleteUrl;
  global.fetch = async url => { deleteUrl = url; return { ok: true }; };
  assert.equal(await api.deleteSession('a /%'), true);
  assert.equal(deleteUrl, '/api/sessions/a%20%2F%25');
  assert.equal(api.SESS['a /%'], undefined);
  global.fetch = async () => ({ ok: false, status: 503 });
  await api.push('/api/sessions', [{ id: 'pending', state: {} }]);
  api.SESS.pending = { id: 'pending' };
  assert.equal(await api.deleteSession('pending'), false);
  assert.ok(api.SESS.pending);

  console.log('test_sync: all assertions passed');
  process.exit(0);   // the retry timer would otherwise hold the process open
})();
