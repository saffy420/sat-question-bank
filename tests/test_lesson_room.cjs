const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { Script } = require('node:vm');
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
test('live student inline module parses and uses shared renderer with confirmation', () => {
  const html = readFileSync(require('node:path').join(__dirname,'../public/index.html'),'utf8');
  const js = html.split('<script type="module">')[1].split('</script>')[0].replace(/^import .*;\r?\n/gm,'');
  new Script(js);
  assert.match(js, /SharedRenderer\.choiceHTML\(/);
  assert.match(js, /SharedRenderer\.splitContext\(/);
  const island = readFileSync(require('node:path').join(__dirname,'../lesson-ui/index.tsx'),'utf8');
  const stage = readFileSync(require('node:path').join(__dirname,'../lesson-ui/Stage.tsx'),'utf8');
  assert.match(island, /Have you double checked your answer and made sure it/);
  assert.match(stage, /Renderer\.choiceHTML\(/);
  assert.match(js, /mountLesson\(lessonRoot/);
});
test('origin/upgrade gate and role action allowlist', async () => {
  const { validAction } = await protocol();
  const { validLessonUpgrade } = await workerModule();
  const url = new URL(origin+'/api/lessons/7/ws');
  const req = headers => new Request(url, { headers });
  assert.equal(validLessonUpgrade(req({ Upgrade:'websocket', Origin:origin }),url),true);
  for (const headers of [{ Upgrade:'websocket', Origin:'https://evil.test' },{ Origin:origin },{ Upgrade:'websocket', Origin:origin,'Sec-Fetch-Site':'cross-site' }]) assert.equal(validLessonUpgrade(req(headers),url),false);
  assert.equal(validAction({type:'select',questionId:'q',answer:'A'},'student'),true);
  assert.equal(validAction({type:'select',questionId:'q',answer:''},'student'),true);
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
  // Crossing out the selected choice clears the selection.
  await room.webSocketMessage(ws,JSON.stringify({type:'select',questionId:'q',answer:''}));
  assert.equal((await room.state()).responses.alice.q.answer,null);
  assert.equal(sent.at(-1).ownSelection,null);
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
test('distribution uses exact SPR numeric values, leaves rounded answers distinct, counts choice blanks', async () => {
  const { responseGroups } = await protocol();
  const q = { spr:true, answer:'1/3', choices:[] };
  const groups = responseGroups(q, { a:{answer:'1/2'}, b:{answer:'2/4'}, c:{answer:'.5'}, d:{answer:'.333'}, e:{answer:'0.333'}, f:{}, g:{answer:'1/3'} });
  assert.equal(groups.find(g => g.key === '0.5').count, 3);
  assert.equal(groups.find(g => g.key === '0.333').count, 2);
  assert.equal(groups.find(g => g.key === 'blank').count, 1);
  assert.equal(groups.find(g => g.key === '0.333').correct, true);
  assert.equal(groups.find(g => g.key === String(1/3)).count,1);
  const mc = responseGroups({ spr:false, answer:'B', choices:[{letter:'A'},{letter:'B'},{letter:'C'}] }, { a:{answer:'A'}, b:{answer:'B'}, c:{} });
  assert.deepEqual(Object.fromEntries(mc.map(g => [g.key,g.count])), { A:1, B:1, C:0, blank:1 });
  assert.equal(mc.find(g => g.key === 'B').correct, true);
});
test('class results remain anonymous, admin sees names/time only after reveal, role gate persists toggle', async () => {
  const { LessonRoom } = await roomModule(), { validAction } = await protocol(); const f = fixture(), room = new LessonRoom(f.ctx,f.env);
  assert.equal(validAction({type:'classResults',bool:true},'student'),false);
  assert.equal(validAction({type:'classResults',bool:true},'admin'),true);
  f.s.classResults = true; f.s.responses.alice.q = { answer:'B', ms:1234 };
  const before = JSON.stringify(room.snapshot(f.s,{role:'student',userId:'bob'}));
  assert.equal(before.includes('distribution'),false);
  for (const secret of ['Alice','Bob','SECRET_EXPLANATION','PRIVATE_NOTE','TRAP_SECRET']) assert.equal(before.includes(secret),false);
  f.s.phase = 'REVEALED';
  const student = room.snapshot(f.s,{role:'student',userId:'bob'}), admin = room.snapshot(f.s,{role:'admin',userId:'teacher'});
  assert.equal(student.distribution.find(g => g.label === 'B').count,1);
  assert.equal(JSON.stringify(student).includes('Alice'),false);
  assert.equal(JSON.stringify(student).includes('1234'),false);
  assert.deepEqual(admin.distribution.find(g => g.label === 'B').users,[{name:'Alice',ms:1234}]);
  f.s.classResults = false; assert.equal(room.snapshot(f.s,{role:'student',userId:'bob'}).distribution,undefined);
  await room.save(f.s);
  const teacher = f.socket('teacher','admin'), bob = f.socket('bob');
  await room.webSocketMessage(bob.ws, JSON.stringify({type:'classResults',bool:true}));
  assert.equal(bob.sent.at(-1).error,'invalid action');
  await room.webSocketMessage(teacher.ws, JSON.stringify({type:'classResults',bool:true}));
  assert.equal((await room.state()).classResults,true);
});
test('admin selection snapshots throttle to four per second and eventually contain latest state', async () => {
  const { LessonRoom } = await roomModule(); const f = fixture(), room = new LessonRoom(f.ctx,f.env);
  const teacher = f.socket('teacher','admin'), alice = f.socket('alice'); await room.save(f.s);
  for (let i = 0; i < 8; i++) await room.webSocketMessage(alice.ws,JSON.stringify({type:'select',questionId:'q',answer:i % 2 ? 'B':'A'}));
  assert.equal(teacher.sent.length,0);
  await new Promise(resolve => setTimeout(resolve,300));
  assert.equal(teacher.sent.length,1);
  assert.equal(teacher.sent[0].responses.alice.q.answer,'B');
  assert.equal(f.writes.length,0);
});
test('deadline freezes selection, finalizes blank and early lock once with time', async () => {
  const { LessonRoom } = await roomModule(), { GRACE_MS } = await protocol(); const f = fixture(), room = new LessonRoom(f.ctx,f.env);
  const alice = f.socket('alice'); await room.save(f.s);
  await room.webSocketMessage(alice.ws,JSON.stringify({type:'select',questionId:'q',answer:'B'}));
  await room.webSocketMessage(alice.ws,JSON.stringify({type:'lock',questionId:'q'}));
  let s = await room.state(); s.startedAt = Date.now()-10000; s.responses.alice.q.lockedAt = s.startedAt+2000; s.endsAt = Date.now() - GRACE_MS - 10; await room.save(s);
  await room.alarm();
  const rows = f.writes.filter(([sql]) => sql.includes('session_responses'));
  assert.equal(rows.length,2);
  assert.deepEqual(rows.map(([,args]) => [args[1],args[3],args[4],args[5]]), [['alice','B',1,1],['bob',null,0,0]]);
  assert.equal(rows[0][1][6],2000);
  await room.alarm(); assert.equal(f.writes.length,2);
});
test('authored-text anchors retain exact offsets across reflow and exclude KaTeX DOM', async () => {
  const { anchor } = await import('../public/shared/annotations.js');
  const originalDocument=globalThis.document, originalFilter=globalThis.NodeFilter;
  globalThis.NodeFilter={SHOW_TEXT:4,FILTER_REJECT:2,FILTER_ACCEPT:1};
  const authored = text => ({length:text.length,textContent:text,parentElement:{closest:()=>null}});
  const word1=authored('Same '), word2=authored('words here');
  const katex=authored('generated math'); katex.parentElement.closest=()=>true;
  const container={querySelectorAll:()=>[],dataset:{},contains:n=>[word1,word2,katex].includes(n)};
  const card={querySelectorAll:q=>q === '.lesson-stem' ? [container] : []};
  globalThis.document={createTreeWalker:()=>{const nodes=[word1,katex,word2], filter={acceptNode:n=>n.parentElement.closest() ? 2 : 1}; let i=0; return {currentNode:null,nextNode(){ while (i<nodes.length) { const n=nodes[i++]; if (filter.acceptNode(n)===1) {this.currentNode=n;return true;} } return false; }};}};
  try {
    const selection={isCollapsed:false,rangeCount:1,getRangeAt:()=>({startContainer:word1,startOffset:0,endContainer:word2,endOffset:5})};
    const first=anchor(card,selection); assert.deepEqual(first,{nodeId:'s:0',startOffset:0,endOffset:10});
    container.clientWidth=320; assert.deepEqual(anchor(card,selection),first);
    container.clientWidth=1366; assert.deepEqual(anchor(card,selection),first);
    assert.equal(anchor(card,{...selection,getRangeAt:()=>({startContainer:katex,startOffset:0,endContainer:katex,endOffset:4})}),null);
  } finally {globalThis.document=originalDocument;globalThis.NodeFilter=originalFilter;}
});
test('annotation protocol gates role, shape, sizes and phase; laser never persists', async () => {
  const { LessonRoom } = await roomModule(), { validAction } = await protocol();
  const f = fixture(), room = new LessonRoom(f.ctx,f.env), teacher=f.socket('teacher','admin'), student=f.socket('alice');
  const mark = {type:'strike',id:'mark1',nodeId:'s:0',startOffset:0,endOffset:4,color:'#ffe066'};
  const msg = {type:'annotate',questionId:'q',op:mark};
  assert.equal(validAction(msg,'admin'),true); assert.equal(validAction(msg,'student'),false);
  for (const op of [{...mark,html:'<img>'},{...mark,endOffset:20001},{type:'stroke',id:'x',color:'#ffe066',points:Array(33).fill([0,0])},{type:'stroke',id:'x',color:'#ffe066',points:[[Infinity,0]]},{...mark,color:'url(javascript:1)'}]) assert.equal(validAction({...msg,op},'admin'),false);
  await room.save(f.s); await room.webSocketMessage(student.ws,JSON.stringify(msg)); assert.equal(student.sent.at(-1).error,'invalid action');
  await room.webSocketMessage(teacher.ws,JSON.stringify(msg)); assert.equal(teacher.sent.at(-1).error,'invalid phase');
  f.s.phase='REVEALED'; await room.save(f.s);
  await room.webSocketMessage(teacher.ws,JSON.stringify({...msg,questionId:'wrong'})); assert.equal(teacher.sent.at(-1).error,'invalid phase');
  await room.webSocketMessage(teacher.ws,JSON.stringify(msg));
  assert.deepEqual(new LessonRoom(f.ctx,f.env).snapshot(await room.state(),{role:'student',userId:'alice'}).annotations,[mark]);
  assert.deepEqual(student.sent.at(-1).op,mark); assert.equal(f.writes.length,0);
  await room.webSocketMessage(teacher.ws,JSON.stringify({type:'laser',questionId:'q',x:.5,y:.5}));
  assert.equal(student.sent.at(-1).type,'laser'); assert.deepEqual((await room.state()).annotations.q,[mark]);
  // Relayed to peers only (the presenter draws its own dot), without serverNow; hide bypasses the rate floor.
  const teacherFrames = teacher.sent.length;
  await room.webSocketMessage(teacher.ws,JSON.stringify({type:'laser',questionId:'q',hide:true}));
  assert.deepEqual(student.sent.at(-1),{type:'laser',questionId:'q',hide:true}); assert.equal(teacher.sent.length,teacherFrames);
  for (const m of [{type:'laser',questionId:'q',hide:true,x:.5,y:.5},{type:'laser',questionId:'q',hide:false,x:.5,y:.5},{type:'laser',questionId:'q',x:.5}]) assert.equal(validAction(m,'admin'),false);
  await room.webSocketClose(teacher.ws,1000,'bye');
  assert.deepEqual(student.sent.at(-1),{type:'laser',questionId:'q',hide:true});
  assert.equal(JSON.stringify(room.snapshot({...f.s,phase:'ANSWERING',annotations:{q:[mark]}},{role:'student',userId:'alice'})).includes('mark1'),false);
  assert.equal(JSON.stringify(room.snapshot({...await room.state()},{role:'student',userId:'alice'})).includes('PRIVATE_NOTE'),false);
  const again = f.socket('teacher','admin');
  await room.webSocketMessage(again.ws,'é'.repeat(1100));
  assert.equal(again.ws.code,1008);
});
test('strike, erase and clear persist to DO; review outbox flushes at boundary once and retries', async () => {
  const { LessonRoom } = await roomModule(); const f=fixture(), room=new LessonRoom(f.ctx,f.env), teacher=f.socket('teacher','admin');
  f.s.phase='REVEALED'; f.s.items.push({question_id:'q2',time_limit_sec:60}); await room.save(f.s);
  const send = op => room.webSocketMessage(teacher.ws,JSON.stringify({type:'annotate',questionId:'q',op}));
  await send({type:'strike',id:'first',nodeId:'s:0',startOffset:0,endOffset:4,color:'#ffe066'});
  await send({type:'highlight',id:'second',nodeId:'s:0',startOffset:1,endOffset:3,color:'#ffe066'});
  await send({type:'erase',id:'first'}); assert.deepEqual((await room.state()).annotations.q.map(x=>x.id),['second']);
  await send({type:'clear'}); assert.deepEqual((await room.state()).annotations.q,[]);
  await send({type:'strike',id:'last',nodeId:'s:0',startOffset:0,endOffset:4,color:'#ffe066'});
  assert.equal(f.writes.length,0);
  let fail=true; const prepare=f.env.DB.prepare;
  f.env.DB.prepare = sql => { const stmt=prepare(sql); return {bind:(...args)=>({run:async()=>{ if (fail && sql.includes('session_question_review')) { fail=false; throw Error('D1 down'); } return stmt.bind(...args).run(); }})}; };
  await room.webSocketMessage(teacher.ws,JSON.stringify({type:'next'}));
  assert.equal((await room.state()).phase,'READY'); assert.ok(await f.storage.get('pending'));
  await new LessonRoom(f.ctx,f.env).alarm();
  assert.equal(await f.storage.get('pending'),undefined);
  const review=f.writes.filter(([sql])=>sql.includes('session_question_review'));
  assert.equal(review.length,1); assert.deepEqual(JSON.parse(review[0][1][2]).map(x=>x.id),['last']);
  await room.alarm(); assert.equal(f.writes.filter(([sql])=>sql.includes('session_question_review')).length,1);
  let state=await room.state(); state.phase='REVEALED'; state.annotations.q2=[{type:'strike',id:'final',nodeId:'s:0',startOffset:0,endOffset:4,color:'#ffe066'}]; await room.save(state);
  await room.webSocketMessage(teacher.ws,JSON.stringify({type:'endSession'}));
  assert.equal(f.writes.filter(([sql])=>sql.includes('session_question_review')).length,2);
  assert.equal(f.writes.filter(([sql])=>sql.includes("UPDATE lesson_sessions SET status='ended'")).length,1);
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
