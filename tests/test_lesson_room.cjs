const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
globalThis.WebSocketPair = function WebSocketPair() { const stub = () => ({ accepted:false, send(){}, close(){}, serializeAttachment(){} }); return { 0: stub(), 1: stub() }; };
const origin = 'https://roadto1600.org';
const protocol = () => import('../public/shared/lesson.js');
// ESM loaded below: test script remains .cjs like neighboring tests.
const roomModule = () => import('../src/lesson-room.js');
const workerModule = () => import('../src/index.js');
function fixture() {
  const data = new Map(), sockets = [], writes = [];
  const storage = { get: async k => data.get(k), put: async (k,v) => data.set(k, structuredClone(v)), delete: async k => data.delete(k),
    setAlarm: async n => { data.set('alarm', n); }, deleteAlarm: async () => data.delete('alarm') };
  const ctx = { storage, getWebSockets: () => sockets, acceptWebSocket: ws => sockets.push(ws) };
  const env = { DB: { batch: async statements => { for (const stmt of statements) await stmt.run(); }, prepare: sql => ({ bind: (...args) => ({ run: async () => { writes.push([sql,args]); } }) }) } };
  const s = { id: 7, code: 'ABCDEF', title: 'Frozen', owner: 'teacher', status: 'live', phase: 'ANSWERING', index: 0,
    endsAt: Date.now()+5000, startedAt: Date.now(), lockedJoin: false, kicked: [], roster: { alice:'Alice', bob:'Bob' },
    items: [{ question_id:'q',time_limit_sec:60,notes:'PRIVATE_NOTE' }],
    questions: { q: { id:'q', section:'Math', stem_html:'<p>Stem</p><p>Rationale correct answer B</p>', choices:[{letter:'A',content:'no',trap:'TRAP_SECRET'},{letter:'B',content:'yes'}], answer:'B', explanation_html:'SECRET_EXPLANATION', spr:false } },
    responses: { alice:{}, bob:{} } };
  const socket = (userId, role='student') => { const sent=[]; const ws={ deserializeAttachment:()=>({userId,role}), send:x=>sent.push(JSON.parse(x)), close:(code)=>{ ws.code=code; sockets.splice(sockets.indexOf(ws),1); } }; sockets.push(ws); return {ws,sent}; };
  return { ctx, env, storage, sockets, writes, s, socket };
}
test('origin/upgrade gate and role action allowlist', async () => {
  const { validAction } = await protocol();
  const { validLessonUpgrade } = await workerModule();
  const url = new URL(origin+'/api/lessons/7/ws');
  const req = headers => new Request(url, { headers });
  assert.equal(validLessonUpgrade(req({ Upgrade:'websocket', Origin:origin }),url),true);
  for (const headers of [{ Upgrade:'websocket', Origin:'https://evil.test' },{ Origin:origin },{ Upgrade:'websocket', Origin:origin,'Sec-Fetch-Site':'cross-site' }]) assert.equal(validLessonUpgrade(req(headers),url),false);
  assert.equal(validAction({type:'select',questionId:'q',answer:'A'},'student'),true);
  for (const m of [{type:'start'}, {type:'select',questionId:'q',answer:'A',role:'admin'}, {type:'time',questionId:'q',deltaMs:100}, {type:'addTime',sec:500}]) assert.equal(validAction(m,'student'),false);
  assert.equal(validAction({type:'addTime',sec:15},'admin'),true);
  assert.equal(validAction({type:'kick',userId:'x'},'student'),false);
});
test('student projection excludes answers, notes, traps and peers; instructor has roster', async () => {
  const { LessonRoom } = await roomModule(); const f = fixture(), room = new LessonRoom(f.ctx,f.env);
  const before = JSON.stringify(room.snapshot(f.s,{role:'student',userId:'alice'}));
  for (const secret of ['PRIVATE_NOTE','SECRET_EXPLANATION','TRAP_SECRET','Alice','Bob','"answer":"B"','Rationale correct']) assert.equal(before.includes(secret),false,secret);
  assert.equal(JSON.stringify(room.snapshot(f.s,{role:'admin',userId:'teacher'})).includes('PRIVATE_NOTE'),true);
  f.s.phase='REVEALED'; assert.equal(room.snapshot(f.s,{role:'student',userId:'alice'}).question.answer,'B');
  assert.equal(JSON.stringify(room.snapshot(f.s,{role:'student',userId:'alice'})).includes('PRIVATE_NOTE'),false);
});
test('server grace and durable finalize persist once, late select rejected after reconnect', async () => {
  const { GRACE_MS } = await protocol();
  const { LessonRoom } = await roomModule(); const f = fixture(), room = new LessonRoom(f.ctx,f.env);
  const { ws, sent } = f.socket('alice');
  await room.save(f.s);
  await room.webSocketMessage(ws,JSON.stringify({type:'select',questionId:'q',answer:'A'}));
  assert.equal((await room.state()).responses.alice.q.answer,'A');
  assert.equal(f.writes.length,0);
  f.s = await room.state(); f.s.endsAt=Date.now()-GRACE_MS+100;
  await room.save(f.s);
  await room.webSocketMessage(ws,JSON.stringify({type:'select',questionId:'q',answer:'B'}));
  assert.equal((await room.state()).responses.alice.q.answer,'B');
  f.s = await room.state(); f.s.endsAt=Date.now()-GRACE_MS-10; await room.save(f.s);
  await room.alarm();
  assert.equal((await room.state()).phase,'REVEALED'); assert.equal(f.writes.filter(([sql])=>sql.includes('session_responses')).length,2);
  await room.alarm(); assert.equal(f.writes.length,2);
  const wake = new LessonRoom(f.ctx,f.env);
  await wake.webSocketMessage(ws,JSON.stringify({type:'select',questionId:'q',answer:'A'}));
  assert.equal(sent.at(-1).error,'question closed');
  assert.equal((await wake.state()).responses.alice.q.answer,'B');
});
test('join locked/ended, existing participant reconnect, unknown session rejected', async () => {
  const { LessonRoom } = await roomModule(); const f = fixture(), room = new LessonRoom(f.ctx,f.env);
  const call = (userId, join = true) => room.fetch(new Request('https://lesson.internal/', { method:'POST', headers:{ 'X-Lesson-Internal':'room' },
    body: JSON.stringify({ sessionId:7, userId, role:'student', join, ws:false, name:userId, clientId:crypto.randomUUID() }) }));
  f.s.lockedJoin = true; await room.save(f.s);
  assert.equal((await call('new')).status,423);
  assert.equal((await call('alice',false)).status,200);
  f.s.status = 'ended'; await room.save(f.s);
  assert.equal((await call('alice',false)).status,410);
  await f.storage.delete('room');
  f.env.DB.prepare = () => ({ bind:()=>({ first:async()=>null }) });
  assert.equal((await call('new')).status,410);
});
test('explicit join replaces existing tab; stale reconnect cannot retake ownership even when joining is locked', async () => {
  const { LessonRoom } = await roomModule(); const f = fixture(), room = new LessonRoom(f.ctx,f.env);
  const oldId = crypto.randomUUID(), newId = crypto.randomUUID();
  f.s.clients = { alice: oldId }; f.s.lockedJoin = true; await room.save(f.s);
  const old = f.socket('alice');
  const post = (userId, join, clientId) => room.fetch(new Request('https://lesson.internal/', { method:'POST', headers:{ 'X-Lesson-Internal':'room' },
    body: JSON.stringify({ sessionId:7, userId, role:'student', ws:false, join, clientId }) }));
  const upgrade = clientId => room.fetch(new Request('https://lesson.internal/', { headers:{ 'X-Lesson-Internal':'room', Upgrade:'websocket',
    'X-Lesson-Context':JSON.stringify({ sessionId:7, userId:'alice', role:'student', ws:true, join:false, clientId }) } }));
  assert.equal((await post('charlie',true,crypto.randomUUID())).status,423);
  assert.equal((await post('alice',true,newId)).status,200);
  assert.equal(old.ws.code,4001);
  assert.equal((await room.state()).clients.alice,newId);
  assert.equal((await post('alice',false,oldId)).status,409);
  assert.equal((await upgrade(oldId)).status,409);
  assert.equal((await post('alice',false,newId)).status,200);
  try { await upgrade(newId); assert.fail('Node Response cannot accept status 101'); }
  catch (e) { assert.match(String(e), /init\["status"\] must be in the range of 200 to 599/); }
  assert.equal((await room.state()).clients.alice,newId);
  assert.deepEqual((await room.state()).responses.alice,{});
});
test('reconnect ownership rejects wrong client without mutating selection', async () => {
  const { LessonRoom } = await roomModule(); const f = fixture(), room = new LessonRoom(f.ctx,f.env);
  f.s.clients = { alice: crypto.randomUUID() }; await room.save(f.s);
  const req = clientId => room.fetch(new Request('https://lesson.internal/', { headers: { 'X-Lesson-Internal':'room', 'Upgrade':'websocket', 'X-Lesson-Context':JSON.stringify({ sessionId:7, userId:'alice', role:'student', ws:true, join:false, clientId }) } }));
  assert.equal((await req(crypto.randomUUID())).status,409);
  try { await req(f.s.clients.alice); assert.fail('Node Response cannot accept status 101; runtime acceptance covered by dry-run'); }
  catch (e) { assert.match(String(e), /init\["status"\] must be in the range of 200 to 599/); }
  assert.deepEqual((await room.state()).responses.alice, {});
});
test('one live student socket replacement closes old transport; lock and selection persist across wake', async () => {
  const { LessonRoom } = await roomModule(); const f = fixture(), room = new LessonRoom(f.ctx,f.env);
  const first = f.socket('alice'), second = f.socket('alice');
  for (const old of room.sockets('student')) if (old !== second.ws && old.deserializeAttachment().userId === 'alice') old.close(4001,'Replaced');
  assert.equal(first.ws.code,4001); assert.equal(f.sockets.length,1);
  await room.save(f.s); await room.webSocketMessage(second.ws,JSON.stringify({type:'select',questionId:'q',answer:'A'}));
  await room.webSocketMessage(second.ws,JSON.stringify({type:'lock',questionId:'q'}));
  assert.equal(new LessonRoom(f.ctx,f.env).snapshot(await room.state(),{role:'student',userId:'alice'}).locked,true);
  await room.webSocketMessage(second.ws,JSON.stringify({type:'select',questionId:'q',answer:'B'}));
  assert.equal(second.sent.at(-1).error,'answer locked');
});
