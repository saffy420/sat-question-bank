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
  const env = { DB: { batch: async statements => { for (const stmt of statements) await stmt.run(); }, prepare: sql => ({ bind: (...args) => ({ run: async () => { writes.push([sql,args]); }, all: async () => ({ results: [] }) }) }) } };
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
  // Content anchors: glyph anchors carry bounded px offsets, element anchors bounded fractions.
  for (const [a, x, y, ok] of [['s:1@37',-12.5,8,true],['c:B@0',3999,-3999,true],['i:0',-.5,1.2,true],['P',.5,.5,true],[undefined,.5,.5,true],
    [undefined,1.5,.5,false],['s:1@37',4001,0,false],['i:0',6,0,false],['x:1',.5,.5,false],['s:1@3@4',0,0,false],['c:E@1',0,0,false],['s:1@',0,0,false]]) {
    assert.equal(validAction({type:'laser',questionId:'q',x,y,...(a === undefined ? {} : {a})},'admin'),ok,`laser ${a} ${x} ${y}`);
    assert.equal(validAction({type:'annotate',questionId:'q',op:{type:'stroke',id:'s1',color:'#ff7676',points:[[x,y]],...(a === undefined ? {} : {a})}},'admin'),ok,`stroke ${a} ${x} ${y}`);
  }
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
test('desmos protocol: admin only, bounded size, exact fields', async () => {
  const { validAction, MAX_DESMOS_BYTES } = await protocol();
  const msg = { type:'desmos', questionId:'q', state:{ version:11, expressions:{ list:[{ id:'1', latex:'y=x' }] } } };
  assert.equal(validAction(msg,'admin'),true); assert.equal(validAction(msg,'student'),false);
  assert.equal(validAction({...msg,extra:1},'admin'),false);
  assert.equal(validAction({...msg,state:[1]},'admin'),false);
  assert.equal(validAction({...msg,state:null},'admin'),false);
  assert.equal(validAction({...msg,state:{ big:'x'.repeat(MAX_DESMOS_BYTES) }},'admin'),false);
});
test('desmos state gated to REVEALED, stored in DO, sent to others once, hidden before reveal, flushed at boundary', async () => {
  const { LessonRoom } = await roomModule(); const f = fixture(), room = new LessonRoom(f.ctx,f.env);
  const teacher = f.socket('teacher','admin'), student = f.socket('alice'), other = f.socket('bob');
  const state = { version:11, expressions:{ list:[{ id:'1', latex:'y=x^2', note:'x'.repeat(4000) }] } };
  const msg = JSON.stringify({ type:'desmos', questionId:'q', state });
  assert.ok(new TextEncoder().encode(msg).length > 2048);
  await room.save(f.s);
  await room.webSocketMessage(student.ws, JSON.stringify({ type:'desmos', questionId:'q', state:{} }));
  assert.equal(student.sent.at(-1).error,'invalid action');
  await room.webSocketMessage(teacher.ws, msg);
  assert.equal(teacher.sent.at(-1).error,'invalid phase'); assert.equal(await f.storage.get('desmos'), undefined);
  const hidden = room.snapshot({ ...f.s, desmos:{ questionId:'q', state } }, { role:'student', userId:'alice' });
  assert.equal(hidden.desmos, null); assert.equal(JSON.stringify(hidden).includes('y=x^2'), false);
  f.s.phase = 'REVEALED'; await room.save(f.s);
  await room.webSocketMessage(teacher.ws, JSON.stringify({ type:'desmos', questionId:'wrong', state }));
  assert.equal(teacher.sent.at(-1).error,'invalid phase');
  const before = teacher.sent.length;
  await room.webSocketMessage(teacher.ws, msg);
  assert.deepEqual(await f.storage.get('desmos'), { questionId:'q', state });
  assert.equal(teacher.sent.length, before, 'sender gets no echo');
  for (const peer of [student, other]) { assert.equal(peer.sent.at(-1).type,'desmos'); assert.deepEqual(peer.sent.at(-1).state, state); assert.ok(peer.sent.at(-1).serverNow); }
  const counts = [student.sent.length, other.sent.length];
  await room.webSocketMessage(teacher.ws, msg);
  assert.deepEqual([student.sent.length, other.sent.length], counts, 'unchanged state is not resent');
  assert.equal(f.writes.length, 0, 'no per-event D1 writes');
  assert.equal((await f.storage.get('room')).desmos, undefined, 'room object stays small');
  const snap = new LessonRoom(f.ctx,f.env).snapshot(await room.state(), { role:'student', userId:'alice', desmosKey:'dcb31709b452b1cf9dc26972add0fda6' });
  assert.deepEqual(snap.desmos, state); assert.equal(snap.hasMath, true); assert.equal(snap.desmosKey, 'dcb31709b452b1cf9dc26972add0fda6');
  f.s.items.push({ question_id:'q2', time_limit_sec:60 }); const s = await room.state(); s.items = f.s.items; await room.save(s);
  await room.webSocketMessage(teacher.ws, JSON.stringify({ type:'next' }));
  const review = f.writes.filter(([sql]) => sql.includes('session_question_review'));
  assert.equal(review.length, 1); assert.deepEqual(JSON.parse(review[0][1][3]), state); assert.equal(review[0][1][2], null);
  assert.equal(await f.storage.get('desmos'), undefined); assert.equal((await room.state()).desmos, null);
  const next = await room.state(); next.phase = 'REVEALED'; await room.save(next);
  const later = { version:11, expressions:{ list:[{ id:'2', latex:'y=2' }] } };
  await room.webSocketMessage(teacher.ws, JSON.stringify({ type:'desmos', questionId:'q2', state:later }));
  await room.webSocketMessage(teacher.ws, JSON.stringify({ type:'endSession' }));
  const final = f.writes.filter(([sql]) => sql.includes('session_question_review'));
  assert.equal(final.length, 2); assert.equal(final[1][1][1], 'q2'); assert.deepEqual(JSON.parse(final[1][1][3]), later);
});
test('admin frames above MAX_FRAME must be desmos; room context rejects malformed desmos keys', async () => {
  const { LessonRoom } = await roomModule(); const f = fixture(), room = new LessonRoom(f.ctx,f.env), teacher = f.socket('teacher','admin');
  f.s.phase = 'REVEALED'; await room.save(f.s);
  await room.webSocketMessage(teacher.ws, JSON.stringify({ type:'annotate', questionId:'q', op:{ type:'clear' }, pad:'x'.repeat(3000) }));
  assert.equal(teacher.ws.code, 1008);
  const bad = await room.fetch(new Request('https://lesson.internal/', { method:'POST', headers:{ 'X-Lesson-Internal':'room' }, body: JSON.stringify({ ws:false, sessionId:7, userId:'teacher', role:'admin', desmosKey:'<script>' }) }));
  assert.equal(bad.status, 400);
});
test('self-paced late join: exact §8.2 cases, lesson order, difficulty tie-break', async () => {
  const { lateJoinSet } = await protocol();
  const lesson = (...groups) => groups.flatMap(([n, sec]) => Array.from({ length: n }, () => sec)).map((sec, i) => ({ question_id: `q${i}`, time_limit_sec: sec }));
  const secs = (items, ids) => ids.map(id => items.find(x => x.question_id === id).time_limit_sec);
  const a = lesson([4, 30], [10, 60]);
  assert.deepEqual(secs(a, lateJoinSet(a, 480000)), Array(8).fill(60));
  const b = lesson([4, 45], [6, 30], [5, 60]);
  const eight = lateJoinSet(b, 480000);
  assert.deepEqual(secs(b, eight).sort(), [...Array(4).fill(45), ...Array(5).fill(60)].sort());
  const eightThirty = lateJoinSet(b, 510000);
  assert.equal(eightThirty.length, 10);
  assert.deepEqual(eightThirty.filter(id => !eight.includes(id)).map(id => b.find(x => x.question_id === id).time_limit_sec), [30]);
  assert.deepEqual(eightThirty, b.map(x => x.question_id).filter(id => eightThirty.includes(id)), 'original lesson order');
  const tie = [{ question_id: 'easy', time_limit_sec: 60 }, { question_id: 'hard', time_limit_sec: 60 }, { question_id: 'medium', time_limit_sec: 60 }];
  assert.deepEqual(lateJoinSet(tie, 60000, x => ({ easy: 'Easy', hard: 'Hard', medium: 'Medium' })[x.question_id]), ['hard']);
  assert.deepEqual(lateJoinSet(tie, 59999), []);
  assert.deepEqual(lateJoinSet(tie, 60000), ['easy'], 'no difficulty: lesson position breaks the tie');
});
function selfFixture() {
  const f = fixture();
  const q = (id, answer, spr = false) => ({ id, section: 'Math', stem_html: `<p>${id}</p>`, choices: spr ? [] : [{ letter: 'A', content: 'a' }, { letter: 'B', content: 'b', trap: 'TRAP_SECRET' }], answer, explanation_html: 'SECRET_EXPLANATION', spr });
  Object.assign(f.s, { mode: 'self', status: 'live', phase: 'ANSWERING', startedAt: Date.now(), endsAt: Date.now() + 120000,
    items: [{ question_id: 'q1', time_limit_sec: 60, notes: 'PRIVATE_NOTE' }, { question_id: 'q2', time_limit_sec: 30, notes: '' }, { question_id: 'q3', time_limit_sec: 30, notes: '' }],
    questions: { q1: q('q1', 'B'), q2: q('q2', 'A'), q3: q('q3', '3', true) }, difficulty: { q1: 'Hard', q2: 'Easy', q3: 'Medium' },
    assigned: { alice: ['q1', 'q2', 'q3'], bob: ['q1', 'q2', 'q3'] }, positions: {}, submitted: {}, joinRemaining: {}, joinedAt: {},
    clock: { alice: { boundary: Date.now(), seq: 0 }, bob: { boundary: Date.now(), seq: 0 } } });
  return f;
}
test('self-paced student snapshots carry hasMath and the public Desmos key for the student calculator (lessons-11c)', async () => {
  const { LessonRoom } = await roomModule(); const f = selfFixture(), room = new LessonRoom(f.ctx, f.env);
  const key = 'dcb31709b452b1cf9dc26972add0fda6';
  const snap = room.snapshot(f.s, { role: 'student', userId: 'alice', desmosKey: key });
  assert.equal(snap.mode, 'self'); assert.equal(snap.hasMath, true); assert.equal(snap.desmosKey, key);
  assert.equal(room.snapshot(f.s, { role: 'student', userId: 'alice' }).desmosKey, null);
  for (const q of Object.values(f.s.questions)) q.section = 'Reading and Writing';
  assert.equal(room.snapshot(f.s, { role: 'student', userId: 'alice', desmosKey: key }).hasMath, false);
});
async function withClock(fn) {
  const real = Date.now; let now = real();
  Date.now = () => now;
  try { return await fn(ms => { now += ms; }, () => now); } finally { Date.now = real; }
}
test('self-paced time accumulates across visits: Q1 10s → Q2 5s → Q1 7s = 17s/5s; replay ignored; inflation cut', async () => withClock(async tick => {
  const { LessonRoom } = await roomModule(); const f = selfFixture(), room = new LessonRoom(f.ctx, f.env);
  f.s.startedAt = Date.now(); f.s.endsAt = Date.now() + 120000; f.s.clock.alice.boundary = Date.now();
  await room.save(f.s);
  const { ws } = f.socket('alice');
  const time = (questionId, deltaMs, seq) => room.webSocketMessage(ws, JSON.stringify({ type: 'time', questionId, deltaMs, seq }));
  tick(10000); await time('q1', 10000, 1);
  tick(5000); await time('q2', 5000, 2);
  tick(7000); await time('q1', 7000, 3);
  let r = (await room.state()).responses.alice;
  assert.equal(r.q1.ms, 17000); assert.equal(r.q2.ms, 5000);
  await time('q1', 7000, 3);
  assert.equal((await room.state()).responses.alice.q1.ms, 17000, 'replayed seq ignored');
  tick(2000); await time('q2', 60000, 4);
  r = (await room.state()).responses.alice;
  assert.equal(r.q2.ms, 7000, 'delta above elapsed server time is cut to elapsed');
  assert.equal(room.snapshot(await room.state(), { role: 'student', userId: 'alice' }).timeSeq, 4);
  assert.equal(f.writes.length, 0, 'no per-event D1 writes');
}));
test('self-paced student payload: own set only, no answers/grades/notes/peers; acks omit question bodies', async () => {
  const { LessonRoom } = await roomModule(); const f = selfFixture(), room = new LessonRoom(f.ctx, f.env);
  f.s.assigned.bob = ['q1'];
  await room.save(f.s);
  const full = room.snapshot(f.s, { role: 'student', userId: 'bob' });
  assert.deepEqual(full.assignedQuestionIds, ['q1']); assert.equal(full.total, 1);
  assert.deepEqual(full.questions.map(q => q.id), ['q1']);
  const text = JSON.stringify(full);
  for (const secret of ['PRIVATE_NOTE', 'SECRET_EXPLANATION', 'TRAP_SECRET', 'Alice', '"answer"', '"correct"', 'q2']) assert.equal(text.includes(secret), false, secret);
  const { ws, sent } = f.socket('bob');
  await room.webSocketMessage(ws, JSON.stringify({ type: 'select', questionId: 'q1', answer: 'A' }));
  assert.deepEqual(sent.at(-1).selections, { q1: 'A' });
  await room.webSocketMessage(ws, JSON.stringify({ type: 'select', questionId: 'q1', answer: '' }));
  assert.deepEqual(sent.at(-1).selections, {}, 'crossing out selected choice clears it');
  assert.equal((await room.state()).responses.bob.q1.answer, null);
  await room.webSocketMessage(ws, JSON.stringify({ type: 'select', questionId: 'q1', answer: 'A' }));
  assert.equal(Object.hasOwn(sent.at(-1), 'questions'), false);
  await room.webSocketMessage(ws, JSON.stringify({ type: 'select', questionId: 'q2', answer: 'A' }));
  assert.equal(sent.at(-1).error, 'not in your set');
  const admin = room.snapshot(await room.state(), { role: 'admin', userId: 'teacher' });
  assert.deepEqual(admin.grid.bob.q1, ['A', false, 0]); assert.equal(Object.hasOwn(admin.grid.bob, 'q2'), false);
  assert.deepEqual(admin.cards.q1.groups.find(g => g.label === 'A').users, [admin.students.indexOf('bob')]);
  assert.equal(JSON.stringify(admin.cards).includes('Bob'), false, 'card groups carry indexes, not repeated names');
  assert.equal(admin.cards.q1.assigned, 2); assert.equal(admin.cards.q2.assigned, 1); assert.equal(admin.questions.q1.notes, 'PRIVATE_NOTE');
});
test('self-paced late join is fitted once to the server clock and never recomputed', async () => withClock(async tick => {
  const { LessonRoom } = await roomModule(); const f = selfFixture(), room = new LessonRoom(f.ctx, f.env);
  f.s.endsAt = Date.now() + 65000; await room.save(f.s);
  const call = (join, clientId) => room.fetch(new Request('https://lesson.internal/', { method: 'POST', headers: { 'X-Lesson-Internal': 'room' },
    body: JSON.stringify({ sessionId: 7, userId: 'carol', role: 'student', join, ws: false, name: 'Carol', clientId }) }));
  const first = await (await call(true, crypto.randomUUID())).json();
  assert.deepEqual(first.assignedQuestionIds, ['q1']); assert.equal(first.joinRemainingMs, 65000); assert.equal(first.lateJoin, true);
  assert.deepEqual(JSON.parse(f.writes.find(([sql]) => sql.includes('session_participants'))[1][2]), ['q1']);
  assert.equal((await room.state()).positions.carol, 'q1', 'a late joiner is on their first question for the ◆ marker');
  tick(40000);
  const rejoin = await (await call(true, crypto.randomUUID())).json();
  assert.deepEqual(rejoin.assignedQuestionIds, ['q1'], 'explicit re-join keeps the stored set');
  assert.equal(f.writes.filter(([sql]) => sql.includes('session_participants')).length, 1);
  const s = await room.state();
  const reconnect = room.snapshot(s, { role: 'student', userId: 'carol' });
  assert.deepEqual(reconnect.assignedQuestionIds, ['q1']);
  tick(30000);
  const dave = await (await room.fetch(new Request('https://lesson.internal/', { method: 'POST', headers: { 'X-Lesson-Internal': 'room' },
    body: JSON.stringify({ sessionId: 7, userId: 'dave', role: 'student', join: true, ws: false, name: 'Dave', clientId: crypto.randomUUID() }) }))).json();
  assert.equal(dave.status, 'review'); assert.deepEqual(dave.assignedQuestionIds, [], 'review-only arrival gets no set');
}));
test('self-paced completion: auto at deadline once, early when all submitted, End session twice', async () => {
  const { GRACE_MS } = await protocol();
  const { LessonRoom } = await roomModule();
  let f = selfFixture(), room = new LessonRoom(f.ctx, f.env);
  f.s.assigned.bob = ['q1', 'q3'];
  await room.save(f.s);
  const alice = f.socket('alice'), bob = f.socket('bob');
  await room.webSocketMessage(alice.ws, JSON.stringify({ type: 'select', questionId: 'q1', answer: 'B' }));
  await room.webSocketMessage(alice.ws, JSON.stringify({ type: 'submitAll' }));
  await room.webSocketMessage(alice.ws, JSON.stringify({ type: 'select', questionId: 'q2', answer: 'A' }));
  assert.equal(alice.sent.at(-1).error, 'submitted');
  await room.webSocketMessage(bob.ws, JSON.stringify({ type: 'select', questionId: 'q1', answer: 'A' }));
  const s = await room.state(); s.endsAt = Date.now() - GRACE_MS - 1; await room.save(s);
  await room.alarm();
  const done = await room.state();
  assert.equal(done.phase, 'FINISHED'); assert.equal(done.status, 'review');
  const rows = f.writes.filter(([sql]) => sql.includes('session_responses')).map(([, args]) => args);
  assert.deepEqual(rows.map(r => [r[1], r[2], r[3], r[4], r[5]]), [
    ['alice', 'q1', 'B', 1, 1], ['alice', 'q2', null, 0, 1], ['alice', 'q3', null, 0, 1],
    ['bob', 'q1', 'A', 0, 0], ['bob', 'q3', null, 0, 0]]);
  assert.equal(f.writes.filter(([sql]) => sql.includes("status='review'")).length, 1);
  assert.equal(f.writes.filter(([sql]) => sql.includes('finished_at')).map(([, args]) => args[2]).join(), 'alice');
  const count = f.writes.length;
  await room.alarm(); assert.equal(f.writes.length, count, 'finalizes once');
  await room.webSocketMessage(bob.ws, JSON.stringify({ type: 'select', questionId: 'q1', answer: 'B' }));
  assert.equal(bob.sent.at(-1).error, 'set closed');
  const teacher = f.socket('teacher', 'admin');
  await room.webSocketMessage(teacher.ws, JSON.stringify({ type: 'endSession' }));
  assert.equal((await room.state()).status, 'ended');
  assert.equal(f.writes.filter(([sql]) => sql.includes("status='ended'")).length, 1);

  f = selfFixture(); room = new LessonRoom(f.ctx, f.env); await room.save(f.s);
  const a2 = f.socket('alice'), b2 = f.socket('bob');
  await room.webSocketMessage(a2.ws, JSON.stringify({ type: 'submitAll' }));
  assert.equal((await room.state()).phase, 'ANSWERING');
  await room.webSocketMessage(b2.ws, JSON.stringify({ type: 'submitAll' }));
  assert.equal((await room.state()).status, 'review', 'set ends early once every joined student submitted');

  f = selfFixture(); room = new LessonRoom(f.ctx, f.env); await room.save(f.s);
  const t3 = f.socket('teacher', 'admin');
  await room.webSocketMessage(t3.ws, JSON.stringify({ type: 'addTime', sec: 15 }));
  assert.equal(t3.sent.at(-1).error, 'invalid phase');
  await room.webSocketMessage(t3.ws, JSON.stringify({ type: 'endSession' }));
  assert.equal((await room.state()).status, 'review', 'first End session finishes the set only');
  assert.equal(f.writes.filter(([sql]) => sql.includes("status='ended'")).length, 0);
});
test('self-paced start puts every lobby student on their first question', async () => {
  const { LessonRoom } = await roomModule(); const f = selfFixture(), room = new LessonRoom(f.ctx, f.env);
  Object.assign(f.s, { status: 'lobby', phase: 'READY', endsAt: null, startedAt: null });
  await room.save(f.s);
  const teacher = f.socket('teacher', 'admin');
  await room.webSocketMessage(teacher.ws, JSON.stringify({ type: 'start' }));
  const s = await room.state();
  assert.equal(s.status, 'live'); assert.equal(s.endsAt - s.startedAt, 120000);
  assert.deepEqual(s.positions, { alice: 'q1', bob: 'q1' });
  assert.equal(f.writes.filter(([sql]) => sql.includes("status='live'")).length, 1);
});
test('set results: assigned denominators, blank scorable wrong, unscorable never, zero-assignment excluded; ranking ties by lesson order', async () => {
  const { setResults, mostMissed } = await protocol();
  const q = (id, answer, spr = false) => ({ id, answer, spr, choices: spr ? [] : [{ letter: 'A' }, { letter: 'B' }] });
  const items = ['q1', 'q2', 'q3', 'q4'].map(question_id => ({ question_id, time_limit_sec: 10 }));
  const questions = { q1: q('q1', 'A'), q2: q('q2', 'B'), q3: q('q3', '1/2', true), q4: q('q4', 'Z') };
  const assigned = { a: ['q1', 'q2', 'q3', 'q4'], b: ['q1', 'q2', 'q3', 'q4'], late: ['q2'], none: [] };
  const responses = { a: { q1: { answer: 'A', ms: 1000 }, q2: { answer: 'A' }, q3: { answer: '.5' }, q4: { answer: 'A' } },
    b: { q1: { answer: 'B', ms: 500 }, q3: {} }, late: { q2: { answer: 'A' } }, none: {} };
  const r = setResults({ items, questions, assigned, responses });
  assert.deepEqual(r.questions.map(x => [x.questionId, x.assigned, x.wrong, x.right]), [['q1', 2, 1, 1], ['q2', 3, 3, 0], ['q3', 2, 1, 1], ['q4', 2, 0, 0]]);
  assert.deepEqual(r.students.a, { assigned: 4, scorable: 3, right: 2, answered: 4, ms: 1000 });
  assert.equal(r.students.b.right, 0); assert.equal(r.students.b.answered, 1);
  assert.equal(r.takers, 3, 'zero-assignment student is not a taker'); assert.equal(r.completed, 2);
  assert.equal(r.mean, (2 / 3 + 0 + 0) / 3); assert.equal(r.median, 0);
  assert.deepEqual(mostMissed(r).map(x => x.questionId), ['q2', 'q1', 'q3', 'q4'], 'ties keep lesson order');
  assert.deepEqual(mostMissed(r, ['q2']).map(x => x.questionId), ['q1', 'q3', 'q4'], 'reviewed questions leave the ranking');
});
test('poll winner: option 2 must win outright; picks tie on more wrong, then lesson order', async () => {
  const { pollWinner } = await protocol();
  const order = ['q1', 'q2', 'q3'], wrong = { q1: 1, q2: 3, q3: 3 };
  const w = votes => pollWinner({ votes, mostMissed: 'q1', wrong, order });
  assert.equal(w({}), 'q1', 'no votes → most-missed');
  assert.equal(w({ a: { option: 1 }, b: { option: 2, questionId: 'q3' } }), 'q1', 'split vote → most-missed');
  assert.equal(w({ a: { option: 2, questionId: 'q3' } }), 'q3');
  assert.equal(w({ a: { option: 2, questionId: 'q1' }, b: { option: 2, questionId: 'q2' } }), 'q2', 'pick tie → more students wrong');
  assert.equal(w({ a: { option: 2, questionId: 'q3' }, b: { option: 2, questionId: 'q2' } }), 'q2', 'then lesson order');
  assert.equal(w({ a: { option: 2, questionId: 'q3' }, b: { option: 2, questionId: 'q3' }, c: { option: 2, questionId: 'q2' }, d: { option: 1 } }), 'q3');
});
function reviewFixture() {
  const f = selfFixture();
  Object.assign(f.s, { status: 'review', phase: 'FINISHED', reviewed: [], poll: null, pollResult: null, roster: { alice: 'Alice', bob: 'Bob', carol: 'Carol' },
    assigned: { alice: ['q1', 'q2', 'q3'], bob: ['q1', 'q2', 'q3'], carol: ['q2'] },
    responses: { alice: { q1: { answer: 'B' }, q2: { answer: 'B' }, q3: { answer: '3' } }, bob: { q1: { answer: 'A' }, q2: { answer: 'B' } }, carol: { q2: { answer: 'A' } } } });
  return f;
}
test('review poll: option 2 needs a pick, early close when every connected student voted, split → most-missed, 3 s result, review, exclusion', async () => withClock(async tick => {
  const { LessonRoom } = await roomModule(); const f = reviewFixture(), room = new LessonRoom(f.ctx, f.env);
  await room.save(f.s);
  const alice = f.socket('alice'), bob = f.socket('bob'), teacher = f.socket('teacher', 'admin');
  const say = (who, m) => room.webSocketMessage(who.ws, JSON.stringify(m));
  const overview = room.snapshot(f.s, { role: 'admin', userId: 'teacher' }).overview;
  assert.deepEqual(overview.ranking, ['q2', 'q1', 'q3']);
  assert.deepEqual(overview.questions.map(x => [x.assigned, x.wrong]), [[2, 1], [3, 2], [2, 1]]);
  await say(alice, { type: 'vote', option: 1 });
  assert.equal(alice.sent.at(-1).error, 'poll closed');
  await say(teacher, { type: 'startPoll' });
  let s = await room.state();
  assert.equal(s.phase, 'POLL'); assert.equal(s.poll.mostMissed, 'q2'); assert.equal(f.storage && (await f.storage.get('alarm')), s.poll.endsAt + 750);
  const poll = alice.sent.at(-1).poll;
  assert.deepEqual(poll.mostMissed, { questionId: 'q2', number: 2, missed: 2 });
  assert.deepEqual(poll.choices.map(c => [c.number, c.mark]), [[1, 'right'], [2, 'wrong'], [3, 'right']]);
  const text = JSON.stringify(alice.sent.at(-1));
  for (const secret of ['Bob', 'Carol', 'SECRET_EXPLANATION', 'PRIVATE_NOTE', '"answer"']) assert.equal(text.includes(secret), false, secret);
  await say(alice, { type: 'vote', option: 2 });
  assert.match(alice.sent.at(-1).error, /Pick a question/);
  await say(alice, { type: 'vote', option: 2, questionId: 'nope' });
  assert.equal(alice.sent.at(-1).error, 'not in this poll');
  assert.deepEqual((await room.state()).poll.votes, {}, 'option 2 without a valid pick is not counted');
  await say(alice, { type: 'vote', option: 2, questionId: 'q3' });
  assert.equal((await room.state()).phase, 'POLL', 'bob has not voted yet');
  assert.deepEqual(room.snapshot(await room.state(), { role: 'admin', userId: 'teacher' }).poll.picks, { q3: 1 });
  await say(bob, { type: 'vote', option: 1 });
  s = await room.state();
  assert.equal(s.phase, 'POLL_RESULT', 'closes early: every connected student voted (carol is not connected)');
  assert.deepEqual([s.pollResult.questionId, s.pollResult.winner, s.pollResult.one, s.pollResult.two], ['q2', 1, 1, 1], 'split vote → most-missed');
  assert.equal(JSON.stringify(bob.sent.at(-1)).includes('Alice'), false);
  tick(2999); await room.alarm(); assert.equal((await room.state()).phase, 'POLL_RESULT');
  tick(1); await room.alarm();
  s = await room.state();
  assert.equal(s.phase, 'REVEALED'); assert.equal(s.items[s.index].question_id, 'q2'); assert.deepEqual(s.reviewed, ['q2']);
  const review = alice.sent.at(-1);
  assert.equal(review.endsAt, null, 'review is untimed: no set clock on screen');
  assert.equal(review.question.answer, 'A'); assert.equal(review.ownSelection, 'B'); assert.equal(review.notInSet, false);
  assert.equal(JSON.stringify(review).includes('PRIVATE_NOTE'), false);
  assert.equal(room.snapshot(s, { role: 'student', userId: 'dave' }).notInSet, true);
  assert.equal(room.snapshot(s, { role: 'admin', userId: 'teacher' }).notes, '');
  await say(teacher, { type: 'annotate', questionId: 'q2', op: { type: 'stroke', id: 'm1', points: [[0.1, 0.1]], color: '#ff7676' } });
  assert.equal(alice.sent.at(-1).type, 'annotate', 'review mode reuses the REVEALED annotation gate');
  await say(alice, { type: 'select', questionId: 'q2', answer: 'A' });
  assert.equal(alice.sent.at(-1).error, 'set closed');
  await say(teacher, { type: 'next' });
  s = await room.state();
  assert.equal(s.phase, 'FINISHED');
  assert.equal(f.writes.filter(([sql]) => sql.includes('session_question_review')).length, 1, 'annotations flushed at Next');
  await say(teacher, { type: 'startPoll' });
  s = await room.state();
  assert.deepEqual(s.poll.choices, ['q1', 'q3'], 'reviewed question leaves the dropdown'); assert.equal(s.poll.mostMissed, 'q1');
  tick(30749); await room.alarm(); assert.equal((await room.state()).phase, 'POLL');
  tick(1); await room.alarm();
  s = await room.state(); assert.equal(s.pollResult.questionId, 'q1', 'deadline with no votes → most-missed');
  tick(3000); await room.alarm();
  await say(teacher, { type: 'next' });
  await say(teacher, { type: 'goto', questionId: 'q3' });
  s = await room.state();
  assert.equal(s.phase, 'REVEALED'); assert.deepEqual(s.reviewed, ['q2', 'q1', 'q3']);
  await say(teacher, { type: 'next' });
  await say(teacher, { type: 'startPoll' });
  assert.equal(teacher.sent.at(-1).error, 'Every question has been reviewed');
  assert.equal(f.writes.filter(([sql]) => sql.includes('session_responses')).length, 0, 'reviews write no responses');
  assert.deepEqual((await room.state()).responses, reviewFixture().s.responses, 'recorded answers unchanged');
  await say(teacher, { type: 'endSession' });
  assert.equal((await room.state()).status, 'ended');
}));
test('poll and goto are self-paced review only; instructor-paced students cannot lock through vote or navigate', async () => {
  const { LessonRoom } = await roomModule(); const f = fixture(), room = new LessonRoom(f.ctx, f.env);
  await room.save(f.s);
  const alice = f.socket('alice'), teacher = f.socket('teacher', 'admin');
  for (const m of [{ type: 'vote', option: 1 }, { type: 'navigate', questionId: 'q' }, { type: 'submitAll' }]) {
    await room.webSocketMessage(alice.ws, JSON.stringify(m));
    assert.equal(alice.sent.at(-1).error, 'invalid action');
  }
  assert.equal((await room.state()).responses.alice.q, undefined, 'nothing locked');
  await room.webSocketMessage(teacher.ws, JSON.stringify({ type: 'startPoll' }));
  assert.equal(teacher.sent.at(-1).error, 'invalid phase');
  const g = selfFixture(), self = new LessonRoom(g.ctx, g.env); await self.save(g.s);
  const t2 = g.socket('teacher', 'admin');
  await self.webSocketMessage(t2.ws, JSON.stringify({ type: 'goto', questionId: 'q1' }));
  assert.equal(t2.sent.at(-1).error, 'invalid phase', 'no review during the set');
});
test('review poll closes early when the last connected student who has not voted disconnects', async () => {
  const { LessonRoom } = await roomModule(); const f = reviewFixture(), room = new LessonRoom(f.ctx, f.env);
  await room.save(f.s);
  const alice = f.socket('alice'), bob = f.socket('bob'), teacher = f.socket('teacher', 'admin');
  await room.webSocketMessage(teacher.ws, JSON.stringify({ type: 'startPoll' }));
  await room.webSocketMessage(alice.ws, JSON.stringify({ type: 'vote', option: 1 }));
  assert.equal((await room.state()).phase, 'POLL', 'bob is connected and has not voted');
  await room.webSocketClose(bob.ws, 1000, 'bye');
  const s = await room.state();
  assert.equal(s.phase, 'POLL_RESULT'); assert.equal(s.pollResult.questionId, 'q2');
  await room.webSocketClose(teacher.ws, 1000, 'bye');
  assert.equal((await room.state()).phase, 'POLL_RESULT', 'instructor disconnects change nothing');
});
