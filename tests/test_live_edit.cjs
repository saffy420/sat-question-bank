const { test } = require('node:test');
const assert = require('node:assert/strict');
globalThis.WebSocketPair = function WebSocketPair() { const stub = () => ({ accepted:false, send(){}, close(){}, serializeAttachment(){} }); return { 0: stub(), 1: stub() }; };
const protocol = () => import('../public/shared/lesson.js');
const roomModule = () => import('../src/lesson-room.js');
const edit = (nodeId, i, text) => ({ type:'edit', id:`edit:${nodeId}:${i}`, nodeId, i, text });

test('integration: projector receives fit updates and edits before reveal; edits prune anchored text boxes', async () => {
  const { LessonRoom } = await roomModule(); const f = fixture(), room = new LessonRoom(f.ctx, f.env);
  await room.save(f.s);
  const teacher = f.socket('teacher', 'admin'), alice = f.socket('alice'), projector = f.socket('teacher', 'projector');
  const say = m => room.webSocketMessage(teacher.ws, JSON.stringify(m));
  const view = { w: 1200, fs: 19, u: 15, vw: 1920 };
  await say({ type: 'view', ...view });
  for (const peer of [alice, projector]) assert.deepEqual(peer.sent.filter(m => m.type === 'view').map(({ serverNow, ...m }) => m), [{ type: 'view', ...view }]);
  const box = (id, a) => ({ type: 'text', id, a, x: 0, y: 0, text: id, color: '#ffe066' });
  for (const op of [box('em', 's:0~3'), box('px', 's:0@3'), box('other', 's:1~0')]) await say({ type: 'annotate', questionId: 'q', op });
  for (const peer of [alice, projector]) assert.deepEqual(peer.sent.filter(m => m.type === 'annotate'), [], 'text boxes stay hidden');
  await say({ type: 'annotate', questionId: 'q', op: edit('s:0', 0, 'Which is ') });
  assert.deepEqual((await room.state()).annotations.q.map(m => m.id), ['other', 'edit:s:0:0']);
  for (const peer of [alice, projector]) assert.deepEqual(peer.sent.filter(m => m.type === 'annotate').map(m => m.op), [edit('s:0', 0, 'Which is ')]);
  const early = room.snapshot(await room.state(), { role: 'projector', userId: 'teacher' });
  assert.deepEqual(early.view, view);
  assert.deepEqual(early.annotations, [edit('s:0', 0, 'Which is ')]);
  assert.equal(early.question.answer, undefined);
  const s = await room.state(); s.endsAt = Date.now() - 10000; await room.save(s); await room.alarm();
  const revealed = room.snapshot(await room.state(), { role: 'projector', userId: 'teacher' });
  assert.equal(revealed.phase, 'REVEALED');
  assert.deepEqual(revealed.view, view);
  assert.deepEqual(revealed.annotations.map(m => m.id), ['other', 'edit:s:0:0']);
  assert.equal(revealed.ownSelection, null);
});

// Same room fixture shape as tests/test_lesson_room.cjs.
function fixture() {
  const data = new Map(), sockets = [], writes = [];
  const storage = { get: async k => data.get(k), put: async (k,v) => data.set(k, structuredClone(v)), delete: async k => data.delete(k),
    setAlarm: async n => { data.set('alarm', n); }, deleteAlarm: async () => data.delete('alarm') };
  const ctx = { storage, getWebSockets: () => sockets, acceptWebSocket: ws => sockets.push(ws) };
  const env = { DB: { batch: async statements => { for (const stmt of statements) await stmt.run(); }, prepare: sql => ({ bind: (...args) => ({ run: async () => { writes.push([sql,args]); }, all: async () => ({ results: [] }) }) }) } };
  const s = { id: 7, code: 'ABCDEF', title: 'Edits', owner: 'teacher', status: 'live', phase: 'ANSWERING', index: 0,
    endsAt: Date.now()+60000, startedAt: Date.now(), lockedJoin: false, kicked: [], roster: { alice:'Alice' }, reached: 0, played: 0,
    items: [{ question_id:'q',time_limit_sec:60,notes:'' }, { question_id:'q2',time_limit_sec:60,notes:'' }],
    questions: { q: { id:'q', section:'Math', stem_html:'<p>What is \\(3 + 4\\)?</p><p>Pick one.</p>', choices:[{letter:'A',content:'5'},{letter:'B',content:'7'}], answer:'B', explanation_html:'', spr:false } },
    responses: { alice:{} } };
  s.questions.q2 = { ...s.questions.q, id:'q2' };
  const socket = (userId, role='student') => { const sent=[]; const ws={ deserializeAttachment:()=>({userId,role}), send:x=>sent.push(JSON.parse(x)), close:(code)=>{ ws.code=code; sockets.splice(sockets.indexOf(ws),1); } }; sockets.push(ws); return {ws,sent}; };
  return { ctx, env, storage, writes, s, socket };
}

test('validMark: edit marks name one text node of one block, with bounded text', async () => {
  const { validMark, validAction, MAX_FRAME } = await protocol();
  assert.equal(validMark(edit('s:0', 0, 'Which is')), true);
  assert.equal(validMark(edit('p:12', 999, '')), true, 'emptying a text node is still a text change');
  assert.equal(validMark(edit('c:B', 0, 'seven')), true);
  assert.equal(validMark({ ...edit('s:0', 0, 'x'), id:'s:0:0' }), false, 'id must be edit:<node>:<i>');
  assert.equal(validMark({ ...edit('s:0', 0, 'x'), id:'edit:s:0:1' }), false, 'id must match the index');
  assert.equal(validMark({ ...edit('s:0', 0, 'x'), id:'edit:s:1:0' }), false, 'id must match the node');
  assert.equal(validMark(edit('s:0', 0, 'x'.repeat(1501))), false, 'oversize text');
  assert.equal(validMark(edit('s:0', 0, 'x'.repeat(1500))), true);
  for (const nodeId of ['c:E', 'x:0', 's:', 's:12345', 'i:0', 'P']) assert.equal(validMark(edit(nodeId, 0, 'x')), false, nodeId);
  for (const i of [-1, 1000, 1.5, '0']) assert.equal(validMark({ ...edit('s:0', 0, 'x'), i, id:`edit:s:0:${i}` }), false, String(i));
  assert.equal(validMark({ ...edit('s:0', 0, 'x'), color:'#ffe066' }), false, 'no extra fields');
  assert.equal(validMark({ ...edit('s:0', 0, 1) }), false, 'text must be a string');
  // A maximal ASCII edit fits one frame.
  const frame = JSON.stringify({ type:'annotate', questionId:'e2e-core-math', op: edit('p:999', 999, 'x'.repeat(1500)) });
  assert.ok(new TextEncoder().encode(frame).length < MAX_FRAME);
  assert.equal(validAction(JSON.parse(frame), 'admin'), true);
  assert.equal(validAction(JSON.parse(frame), 'student'), false);
});

test('room: an edit replaces the same node by id, prunes only its own block, and reaches students before the reveal', async () => {
  const { LessonRoom } = await roomModule(); const f = fixture(), room = new LessonRoom(f.ctx, f.env);
  await room.save(f.s);
  const alice = f.socket('alice'), teacher = f.socket('teacher', 'admin');
  const say = op => room.webSocketMessage(teacher.ws, JSON.stringify({ type:'annotate', questionId:'q', op }));
  const ids = async () => (await room.state()).annotations.q.map(m => m.id);
  await say({ type:'highlight', id:'h-s0', nodeId:'s:0', startOffset:0, endOffset:4, color:'#ffe066' });
  await say({ type:'strike', id:'k-s1', nodeId:'s:1', startOffset:0, endOffset:4, color:'#ffe066' });
  await say({ type:'stroke', id:'ink-s0', points:[[0,0]], color:'#ff7676', a:'s:0~3' });
  await say({ type:'stroke', id:'ink-s0px', points:[[0,0]], color:'#ff7676', a:'s:0@3' });
  await say({ type:'stroke', id:'ink-s10', points:[[0,0]], color:'#ff7676', a:'s:10~3' });
  await say({ type:'stroke', id:'ink-card', points:[[0.5,0.5]], color:'#ff7676' });
  await say({ type:'stroke', id:'ink-block', points:[[0.5,0.5]], color:'#ff7676', a:'s:0' });
  assert.deepEqual(alice.sent.filter(m => m.type === 'annotate'), [], 'the ordinary layer stays hidden');

  await say(edit('s:0', 0, 'Which is'));
  assert.deepEqual(await ids(), ['k-s1', 'ink-s10', 'ink-card', 'ink-block', 'edit:s:0:0'], 'glyph-anchored ink and highlights on s:0 go; other blocks keep theirs');
  const teacherOps = teacher.sent.filter(m => m.type === 'annotate').slice(-4).map(m => m.op);
  assert.deepEqual(teacherOps.map(op => op.type === 'erase' ? `erase ${op.id}` : op.id), ['erase h-s0', 'erase ink-s0', 'erase ink-s0px', 'edit:s:0:0']);
  // The student gets the edit (never hidden) but not the erases of marks they never saw.
  assert.deepEqual(alice.sent.filter(m => m.type === 'annotate').map(m => m.op), [edit('s:0', 0, 'Which is')]);

  // Same text node again: replaced, not a duplicate error.
  await say(edit('s:0', 0, 'Whatever is'));
  assert.deepEqual(await ids(), ['k-s1', 'ink-s10', 'ink-card', 'ink-block', 'edit:s:0:0']);
  assert.equal((await room.state()).annotations.q.at(-1).text, 'Whatever is');
  assert.equal(teacher.sent.some(m => m.type === 'error'), false);
  assert.deepEqual(alice.sent.filter(m => m.type === 'annotate').slice(-2).map(m => m.op), [{ type:'erase', id:'edit:s:0:0' }, edit('s:0', 0, 'Whatever is')], 'students drop the old edit, then take the new one');
  await say(edit('c:B', 0, 'seven'));

  // Snapshots: during ANSWERING a student (late joiner, reconnect) gets edits only; the instructor everything.
  const early = room.snapshot(await room.state(), { role:'student', userId:'alice' });
  assert.deepEqual(early.annotations.map(m => m.id), ['edit:s:0:0', 'edit:c:B:0']);
  const own = room.snapshot(await room.state(), { role:'admin', userId:'teacher' });
  assert.deepEqual(own.annotations.map(m => m.id), ['k-s1', 'ink-s10', 'ink-card', 'ink-block', 'edit:s:0:0', 'edit:c:B:0']);
  // The answer key is untouched by a text fix.
  assert.equal((await room.state()).questions.q.answer, 'B');

  // Clear all keeps text fixes: it goes out as erases of the rest, to the instructor only while hidden.
  const seen = alice.sent.length;
  await say({ type:'clear' });
  assert.deepEqual(await ids(), ['edit:s:0:0', 'edit:c:B:0']);
  assert.deepEqual(alice.sent.slice(seen).filter(m => m.type === 'annotate'), []);
  assert.deepEqual(teacher.sent.filter(m => m.type === 'annotate').slice(-4).map(m => m.op), ['k-s1', 'ink-s10', 'ink-card', 'ink-block'].map(id => ({ type:'erase', id })));
  // A bad block index is refused.
  await say(edit('s:9', 0, 'x'));
  assert.equal(teacher.sent.at(-1).error, 'invalid anchor');
  await say(edit('c:D', 0, 'x'));
  assert.equal(teacher.sent.at(-1).error, 'invalid anchor');
});

test('room: edits persist with the review row and come back in the revealed snapshot', async () => {
  const { LessonRoom } = await roomModule(); const f = fixture(), room = new LessonRoom(f.ctx, f.env);
  f.s.phase = 'REVEALED'; f.s.played = 1; await room.save(f.s);
  const alice = f.socket('alice'), teacher = f.socket('teacher', 'admin');
  const say = m => room.webSocketMessage(teacher.ws, JSON.stringify(m));
  await say({ type:'annotate', questionId:'q', op:{ type:'highlight', id:'h1', nodeId:'s:1', startOffset:0, endOffset:4, color:'#ffe066' } });
  await say({ type:'annotate', questionId:'q', op: edit('s:0', 1, '!') });
  // Revealed: everything is live for everyone.
  assert.deepEqual(alice.sent.filter(m => m.type === 'annotate').map(m => m.op.id), ['h1', 'edit:s:0:1']);
  assert.deepEqual(room.snapshot(await room.state(), { role:'student', userId:'alice' }).annotations.map(m => m.id), ['h1', 'edit:s:0:1']);
  await say({ type:'next' });
  await new LessonRoom(f.ctx, f.env).alarm();
  const review = f.writes.filter(([sql]) => sql.includes('session_question_review'));
  assert.equal(review.length, 1);
  assert.deepEqual(JSON.parse(review[0][1][2]), [{ type:'highlight', id:'h1', nodeId:'s:1', startOffset:0, endOffset:4, color:'#ffe066' }, edit('s:0', 1, '!')]);
});
