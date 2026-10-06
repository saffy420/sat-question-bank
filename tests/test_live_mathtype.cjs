const { test } = require('node:test');
const assert = require('node:assert/strict');
globalThis.WebSocketPair = function WebSocketPair() { const stub = () => ({ accepted:false, send(){}, close(){}, serializeAttachment(){} }); return { 0: stub(), 1: stub() }; };
const protocol = () => import('../public/shared/lesson.js');
const roomModule = () => import('../src/lesson-room.js');

// live-mathtype: math text boxes (`tex`), live drafts of a box being typed, and math edits (`edit-math`).
const box = (over = {}) => ({ type:'text', id:'t1', a:'s:0~3', x:0.5, y:0, text:'note', color:'#ffe066', ...over });
const mathBox = (over = {}) => { const { text, ...rest } = box(over); return { ...rest, tex:'\\sqrt{x}', ...over }; };
const editMath = (nodeId, k, tex) => ({ type:'edit-math', id:`edit-math:${nodeId}:${k}`, nodeId, k, tex });
const bytes = x => new TextEncoder().encode(JSON.stringify(x)).length;

test('validMark: a box holds text or tex, never both; old text boxes are unchanged', async () => {
  const { validMark, validAction } = await protocol();
  assert.equal(validMark(box()), true, 'a text box as before');
  assert.equal(validMark(mathBox()), true);
  assert.equal(validMark(mathBox({ tex:'\\frac{\\left(x+1\\right)}{2}' })), true);
  assert.equal(validMark({ ...mathBox(), text:'note' }), false, 'text and tex together');
  assert.equal(validMark(mathBox({ tex:'' })), false, 'empty');
  assert.equal(validMark(mathBox({ tex:'  ' })), false, 'blank');
  assert.equal(validMark(mathBox({ tex:'x\ny' })), false, 'one line');
  assert.equal(validMark(mathBox({ tex:42 })), false);
  assert.equal(validMark(mathBox({ color:'#000000' })), false, 'colours as for text boxes');
  assert.equal(validMark(mathBox({ a:'zz:1~2' })), false, 'anchored like a text box');
  // Drafts: a text box under its id, or an erase of that id. Nothing else, and only from the instructor.
  for (const op of [box(), mathBox(), { type:'erase', id:'t1' }]) assert.equal(validAction({ type:'draft', questionId:'q', op }, 'admin'), true, op.type);
  for (const op of [{ type:'clear' }, editMath('s:0', 0, 'x'), { type:'stroke', id:'s', points:[[0, 0]], color:'#ff7676' }, mathBox({ tex:'' })])
    assert.equal(validAction({ type:'draft', questionId:'q', op }, 'admin'), false, op.type);
  assert.equal(validAction({ type:'draft', questionId:'q', op:box() }, 'student'), false);
  assert.equal(validAction({ type:'draft', questionId:'q', op:box(), extra:1 }, 'admin'), false);
});

test('validMark: edit-math names one formula of one block', async () => {
  const { validMark } = await protocol();
  assert.equal(validMark(editMath('s:0', 0, '3+5')), true);
  assert.equal(validMark(editMath('c:B', 2, '\\frac{1}{2}')), true);
  assert.equal(validMark(editMath('p:12', 99, 'x')), true);
  assert.equal(validMark({ ...editMath('s:0', 0, 'x'), id:'edit-math:s:0:1' }), false, 'id must match the index');
  assert.equal(validMark({ ...editMath('s:0', 0, 'x'), id:'edit:s:0:0' }), false, 'id must name a math edit');
  for (const k of [-1, 100, 1.5, '0']) assert.equal(validMark({ ...editMath('s:0', 0, 'x'), k, id:`edit-math:s:0:${k}` }), false, String(k));
  for (const nodeId of ['c:E', 'x:0', 'i:0', 'P']) assert.equal(validMark(editMath(nodeId, 0, 'x')), false, nodeId);
  assert.equal(validMark(editMath('s:0', 0, '')), false, 'a formula is never emptied');
  assert.equal(validMark({ ...editMath('s:0', 0, 'x'), text:'x' }), false, 'no extra fields');
});

test('tex is capped so every frame that carries it stays under MAX_FRAME', async () => {
  const { validMark, validAction, MAX_FRAME, MAX_TEX } = await protocol();
  // Backslashes double and control characters are refused, so the cap is on the JSON bytes.
  const longest = '\\'.repeat((MAX_TEX - 2) / 2);
  assert.equal(bytes(longest), MAX_TEX);
  assert.equal(validMark(mathBox({ tex:longest })), true);
  assert.equal(validMark(mathBox({ tex:longest + '\\' })), false);
  assert.equal(validMark(mathBox({ tex:'≤'.repeat(Math.floor((MAX_TEX - 2) / 3) + 1) })), false, 'multi-byte characters count as bytes');
  const worstBox = mathBox({ id:'i'.repeat(64), tex:longest, a:'p:9999~99999', x:-399.9999, y:-399.9999 });
  const worstEdit = { ...editMath('p:9999', 99, longest) };
  for (const frame of [{ type:'annotate', questionId:'q'.repeat(64), op:worstBox }, { type:'draft', questionId:'q'.repeat(64), op:worstBox }, { type:'annotate', questionId:'q'.repeat(64), op:worstEdit }]) {
    assert.equal(validAction(frame, 'admin'), true, frame.type);
    // The room relays with serverNow added; that still fits.
    assert.ok(bytes({ ...frame, serverNow: Date.now() }) < MAX_FRAME, `${frame.type} ${bytes(frame)}`);
  }
});

test('drafts: hidden before the reveal, shown at it, relayed live after; never stored', async () => {
  const { LessonRoom } = await roomModule(); const f = fixture(), room = new LessonRoom(f.ctx, f.env);
  await room.save(f.s);
  const alice = f.socket('alice'), projector = f.socket('teacher', 'projector'), teacher = f.socket('teacher', 'admin');
  const say = m => room.webSocketMessage(teacher.ws, JSON.stringify(m));
  const draft = op => say({ type:'draft', questionId:'q', op });
  const seen = peer => peer.sent.filter(m => m.type === 'annotate').map(m => m.op);
  const saves = () => f.puts.filter(k => k === 'room').length;

  // ANSWERING: the presenter types; nothing leaves the room, in messages or in a fresh copy of the state.
  const before = saves();
  await draft(mathBox({ tex:'\\sqrt{x}' }));
  await draft(mathBox({ tex:'\\sqrt{x}+1' }));
  assert.equal(saves(), before, 'a draft is never saved');
  for (const peer of [alice, projector, teacher]) assert.deepEqual(seen(peer), []);
  assert.deepEqual(room.snapshot(await room.state(), { role:'student', userId:'alice' }).annotations, []);
  assert.deepEqual(room.snapshot(await room.state(), { role:'admin', userId:'teacher' }).annotations, [], 'the presenter has its own editor');
  assert.equal((await room.state()).annotations, undefined);

  // The reveal: the draft open at that moment is in the students' snapshot.
  const s = await room.state(); s.endsAt = Date.now() - 10000; await room.save(s); await room.alarm();
  const revealed = alice.sent.filter(m => m.type === 'snapshot').at(-1);
  assert.equal(revealed.phase, 'REVEALED');
  assert.deepEqual(revealed.annotations, [mathBox({ tex:'\\sqrt{x}+1' })]);
  assert.deepEqual(projector.sent.filter(m => m.type === 'snapshot').at(-1).annotations, [mathBox({ tex:'\\sqrt{x}+1' })]);

  // Revealed: each draft goes to students and the projector at once, under the same id, never back to the presenter.
  await draft(mathBox({ tex:'\\sqrt{x}+12' }));
  for (const peer of [alice, projector]) assert.deepEqual(seen(peer), [mathBox({ tex:'\\sqrt{x}+12' })]);
  assert.deepEqual(seen(teacher), []);
  // Esc on a new box: it goes for everyone.
  await draft({ type:'erase', id:'t1' });
  for (const peer of [alice, projector]) assert.deepEqual(seen(peer).at(-1), { type:'erase', id:'t1' });
  assert.deepEqual(room.snapshot(await room.state(), { role:'student', userId:'alice' }).annotations, []);

  // Commit: an ordinary annotate replaces the draft (same id) and ends it.
  await draft(mathBox({ tex:'x^{2}' }));
  await say({ type:'annotate', questionId:'q', op:mathBox({ tex:'x^{2}' }) });
  assert.deepEqual((await room.state()).annotations.q, [mathBox({ tex:'x^{2}' })]);
  assert.equal(room.drafts.size, 0);
  assert.deepEqual(seen(alice).slice(-2), [mathBox({ tex:'x^{2}' }), mathBox({ tex:'x^{2}' })]);

  // Editing that box: drafts lay over it; Esc puts the committed box back for everyone.
  await draft(mathBox({ tex:'x^{3}' }));
  assert.deepEqual(room.snapshot(await room.state(), { role:'student', userId:'alice' }).annotations, [mathBox({ tex:'x^{3}' })]);
  assert.deepEqual(room.snapshot(await room.state(), { role:'admin', userId:'teacher' }).annotations, [mathBox({ tex:'x^{2}' })]);
  await draft({ type:'erase', id:'t1' });
  assert.deepEqual(seen(alice).at(-1), mathBox({ tex:'x^{2}' }));
  assert.deepEqual(room.snapshot(await room.state(), { role:'student', userId:'alice' }).annotations, [mathBox({ tex:'x^{2}' })]);
  // Enter: the edited box replaces the old one in place (one box, same id).
  await draft(mathBox({ tex:'x^{3}' }));
  await say({ type:'annotate', questionId:'q', op:mathBox({ tex:'x^{3}' }) });
  assert.deepEqual((await room.state()).annotations.q, [mathBox({ tex:'x^{3}' })]);
  // A plain-text box drafts the same way.
  await draft(box({ id:'t2', text:'Look' }));
  assert.deepEqual(seen(alice).at(-1), box({ id:'t2', text:'Look' }));

  // A draft can't take the id of another kind of mark, nor reach another question.
  await say({ type:'annotate', questionId:'q', op:{ type:'stroke', id:'ink', points:[[0, 0]], color:'#ff7676', a:'s:0~3' } });
  await draft(box({ id:'ink' }));
  assert.equal(teacher.sent.at(-1).error, 'layer full or duplicate mark');
  await say({ type:'draft', questionId:'q2', op:box({ id:'t3' }) });
  assert.equal(teacher.sent.at(-1).error, 'invalid phase');
  // Students can't draft.
  await room.webSocketMessage(alice.ws, JSON.stringify({ type:'draft', questionId:'q', op:box({ id:'t4' }) }));
  assert.equal(alice.sent.at(-1).error, 'invalid action');

  // Leaving the question drops its drafts; nothing about them reaches D1.
  await say({ type:'next' });
  assert.equal(room.drafts.size, 0);
  await new LessonRoom(f.ctx, f.env).alarm();
  const review = f.writes.filter(([sql]) => sql.includes('session_question_review'));
  assert.deepEqual(JSON.parse(review[0][1][2]).map(m => m.id), ['t1', 'ink'], 'the review row has commits only');
});

test('Clear all ends drafts on the question', async () => {
  const { LessonRoom } = await roomModule(); const f = fixture(), room = new LessonRoom(f.ctx, f.env);
  f.s.phase = 'REVEALED'; f.s.played = 1; await room.save(f.s);
  const teacher = f.socket('teacher', 'admin');
  const say = m => room.webSocketMessage(teacher.ws, JSON.stringify(m));
  await say({ type:'draft', questionId:'q', op:mathBox() });
  await say({ type:'annotate', questionId:'q', op:{ type:'clear' } });
  assert.equal(room.drafts.size, 0);
});

test('edit-math: never hidden, replaces its own formula only, kept by Clear all, checked against the source', async () => {
  const { LessonRoom } = await roomModule(); const f = fixture(), room = new LessonRoom(f.ctx, f.env);
  await room.save(f.s);
  const alice = f.socket('alice'), projector = f.socket('teacher', 'projector'), teacher = f.socket('teacher', 'admin');
  const say = op => room.webSocketMessage(teacher.ws, JSON.stringify({ type:'annotate', questionId:'q', op }));
  const ids = async () => (await room.state()).annotations.q.map(m => m.id);
  await say({ type:'highlight', id:'h-s0', nodeId:'s:0', startOffset:0, endOffset:4, color:'#ffe066' });
  await say({ type:'stroke', id:'ink-s0', points:[[0, 0]], color:'#ff7676', a:'s:0~3' });
  await say(editMath('s:0', 0, '3+5'));
  // KaTeX never counts toward text offsets, so the highlight and ink on the block stay.
  assert.deepEqual(await ids(), ['h-s0', 'ink-s0', 'edit-math:s:0:0']);
  // Students and the projector get it during ANSWERING, and nothing else of the hidden layer.
  for (const peer of [alice, projector]) assert.deepEqual(peer.sent.filter(m => m.type === 'annotate').map(m => m.op), [editMath('s:0', 0, '3+5')]);
  assert.deepEqual(room.snapshot(await room.state(), { role:'student', userId:'alice' }).annotations, [editMath('s:0', 0, '3+5')]);
  // Again: replaced, students drop the old one first.
  await say(editMath('s:0', 0, '3+6'));
  assert.deepEqual(await ids(), ['h-s0', 'ink-s0', 'edit-math:s:0:0']);
  assert.equal((await room.state()).annotations.q.at(-1).tex, '3+6');
  assert.deepEqual(alice.sent.filter(m => m.type === 'annotate').slice(-2).map(m => m.op), [{ type:'erase', id:'edit-math:s:0:0' }, editMath('s:0', 0, '3+6')]);
  // A prose edit of the block keeps the math edit (and drops the highlight and ink, as before).
  await say({ type:'edit', id:'edit:s:0:0', nodeId:'s:0', i:0, text:'What equals ' });
  assert.deepEqual(await ids(), ['edit-math:s:0:0', 'edit:s:0:0']);
  // Clear all keeps both kinds of fix.
  await say({ type:'stroke', id:'ink2', points:[[0.5, 0.5]], color:'#ff7676' });
  await say({ type:'clear' });
  assert.deepEqual(await ids(), ['edit-math:s:0:0', 'edit:s:0:0']);
  // The stem's source has one formula, its choices none: other indexes are refused.
  await say(editMath('s:0', 1, 'x'));
  assert.equal(teacher.sent.at(-1).error, 'invalid anchor');
  await say(editMath('c:A', 0, 'x'));
  assert.equal(teacher.sent.at(-1).error, 'invalid anchor');
  // The answer key is untouched.
  assert.equal((await room.state()).questions.q.answer, 'B');
});

// Same room fixture shape as tests/test_live_edit.cjs, with the storage keys written.
function fixture() {
  const data = new Map(), sockets = [], writes = [], puts = [];
  const storage = { get: async k => data.get(k), put: async (k,v) => { puts.push(k); data.set(k, structuredClone(v)); }, delete: async k => data.delete(k),
    setAlarm: async n => { data.set('alarm', n); }, deleteAlarm: async () => data.delete('alarm') };
  const ctx = { storage, getWebSockets: () => sockets, acceptWebSocket: ws => sockets.push(ws) };
  const env = { DB: { batch: async statements => { for (const stmt of statements) await stmt.run(); }, prepare: sql => ({ bind: (...args) => ({ run: async () => { writes.push([sql,args]); }, all: async () => ({ results: [] }) }) }) } };
  const s = { id: 7, code: 'ABCDEF', title: 'Math boxes', owner: 'teacher', status: 'live', phase: 'ANSWERING', index: 0,
    endsAt: Date.now()+60000, startedAt: Date.now(), lockedJoin: false, kicked: [], roster: { alice:'Alice' }, reached: 0, played: 0,
    items: [{ question_id:'q',time_limit_sec:60,notes:'' }, { question_id:'q2',time_limit_sec:60,notes:'' }],
    questions: { q: { id:'q', section:'Math', stem_html:'<p>What is \\(3 + 4\\)?</p>', choices:[{letter:'A',content:'5'},{letter:'B',content:'7'}], answer:'B', explanation_html:'', spr:false } },
    responses: { alice:{} } };
  s.questions.q2 = { ...s.questions.q, id:'q2' };
  const socket = (userId, role='student') => { const sent=[]; const ws={ deserializeAttachment:()=>({userId,role}), send:x=>sent.push(JSON.parse(x)), close:(code)=>{ ws.code=code; sockets.splice(sockets.indexOf(ws),1); } }; sockets.push(ws); return {ws,sent}; };
  return { ctx, env, storage, writes, puts, s, socket };
}
