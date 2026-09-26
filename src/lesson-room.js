import { normalizeQuestion, isRight } from '../public/shared/stats.js';
import { GRACE_MS, MAX_FRAME, validAction, lessonQuestion, responseGroups } from '../public/shared/lesson.js';

export class LessonRoom {
  constructor(ctx, env) {
    this.ctx = ctx;
    this.env = env;
  }
  async state() { return await this.ctx.storage.get('room'); }
  async save(s) { await this.ctx.storage.put('room', s); }
  send(ws, data) { ws.send(JSON.stringify({ ...data, serverNow: Date.now() })); }
  sockets(role) { return this.ctx.getWebSockets().filter(ws => !role || ws.deserializeAttachment()?.role === role); }
  active(ws) { const a = ws.deserializeAttachment(); return !!a && this.sockets(a.role).filter(other => other.deserializeAttachment()?.userId === a.userId).at(-1) === ws; }
  snapshot(s, a) {
    const item = s.items[s.index];
    const r = a.role === 'student' ? Object.hasOwn(s.responses, a.userId) ? s.responses[a.userId]?.[item?.question_id] : null : null;
    const revealed = s.phase === 'REVEALED' || s.phase === 'ENDED';
    return { type: 'snapshot', sessionId: s.id, role: a.role, title: s.title, phase: s.phase, status: s.status,
      questionId: item?.question_id || null, index: s.index, total: s.items.length, endsAt: s.endsAt,
      assignedQuestionIds: a.role === 'student' ? s.items.map(x => x.question_id) : undefined,
      question: item ? lessonQuestion(s.questions[item.question_id], revealed || a.role === 'admin') : null,
      ownSelection: r?.answer || null, locked: !!r?.locked, count: Object.keys(s.responses).length,
      classResults: !!s.classResults, annotations: revealed && item ? s.annotations?.[item.question_id] || [] : [],
      ...(revealed && item && (a.role === 'admin' || s.classResults) ? { distribution: responseGroups(s.questions[item.question_id], Object.fromEntries(Object.entries(s.responses).map(([id, answers]) => [id, answers[item.question_id]])))
        .map(g => a.role === 'admin' ? { ...g, users: g.users.map(u => ({ name: s.roster[u.userId], ms: u.ms })) } : { label: g.label, count: g.count, correct: g.correct }) } : {}),
      ...(a.role === 'admin' ? { code: s.code, lockedJoin: s.lockedJoin, roster: s.roster,
        responses: s.responses, notes: item?.notes || '' } : {}) };
  }
  broadcast(s, selection = false, userId = null) {
    for (const ws of this.sockets(selection ? 'student' : undefined)) {
      if (selection && ws.deserializeAttachment()?.userId !== userId) continue;
      try { this.send(ws, this.snapshot(s, ws.deserializeAttachment())); } catch { /* disconnected */ }
    }
    if (selection && !this.responseTimer) {
      this.responseTimer = setTimeout(async () => {
        this.responseTimer = null;
        const latest = await this.state();
        if (!latest) return;
        for (const ws of this.sockets('admin')) {
          try { this.send(ws, this.snapshot(latest, ws.deserializeAttachment())); } catch { /* disconnected */ }
        }
      }, 250);
    }
  }
  async initialize(sessionId) {
    let s = await this.state();
    if (s) return s;
    const row = await this.env.DB.prepare(`SELECT s.id, s.join_code, s.status, s.snapshot_json, l.created_by
      FROM lesson_sessions s JOIN lessons l ON l.id=s.lesson_id WHERE s.id=?`).bind(sessionId).first();
    if (!row || row.status === 'ended') return null;
    const frozen = JSON.parse(row.snapshot_json);
    if (frozen.mode !== 'instructor' || !Array.isArray(frozen.items) || !frozen.items.length || frozen.items.length > 500) return null;
    const questions = {};
    for (const item of frozen.items) {
      if (questions[item.question_id]) throw Error('duplicate question');
      const core = await this.env.DB.prepare('SELECT id,section,stem_html,choices_json,correct_answer,explanation_html,source FROM questions WHERE id=?').bind(item.question_id).first();
      const ai = core || await this.env.AI_DB.prepare('SELECT id,section,stem_html,choices_json,correct_answer,explanation_html,source FROM questions WHERE id=?').bind(item.question_id).first();
      if (!ai) throw Error('missing frozen question');
      questions[item.question_id] = normalizeQuestion(ai);
    }
    const participants = await this.env.DB.prepare('SELECT p.user_id, p.joined_at, u.name, u.email FROM session_participants p JOIN users u ON u.id=p.user_id WHERE p.session_id=? AND p.left_at IS NULL').bind(sessionId).all();
    s = { id: row.id, code: row.join_code, title: frozen.title, owner: row.created_by, items: frozen.items, questions,
      status: row.status, phase: 'READY', index: 0, endsAt: null, lockedJoin: false, kicked: [], responses: {}, roster: {}, joinedAt: {} };
    for (const p of participants.results || []) { s.responses[p.user_id] = {}; s.roster[p.user_id] = p.name || p.email || p.user_id; s.joinedAt[p.user_id] = Date.parse(p.joined_at + 'Z') || Date.now(); }
    await this.save(s);
    return s;
  }
  async flush(s) {
    const pending = await this.ctx.storage.get('pending');
    if (!pending) return;
    try {
      if (pending.rows.length) await this.env.DB.batch(pending.rows.map(r => this.env.DB.prepare(`INSERT INTO session_responses
        (session_id,user_id,question_id,final_answer,is_correct,locked_early,time_spent_ms,answer_changes,answer_history_json)
        VALUES (?,?,?,?,?,?,?,?,?) ON CONFLICT(session_id,user_id,question_id) DO NOTHING`)
        .bind(s.id, r.userId, pending.questionId, r.answer, r.correct, r.locked ? 1 : 0, r.ms, r.changes, JSON.stringify(r.history))));
      if (pending.annotations) await this.env.DB.prepare(`INSERT INTO session_question_review (session_id,question_id,annotations_json)
        VALUES (?,?,?) ON CONFLICT(session_id,question_id) DO UPDATE SET annotations_json=excluded.annotations_json`)
        .bind(s.id,pending.questionId,JSON.stringify(pending.annotations)).run();
      if (pending.end) await this.env.DB.prepare("UPDATE lesson_sessions SET status='ended', ended_at=COALESCE(ended_at,datetime('now')) WHERE id=? AND status!='ended'").bind(s.id).run();
      await this.ctx.storage.delete('pending');
      const next = await this.ctx.storage.get('nextPending');
      if (next) { await this.ctx.storage.put('pending', next); await this.ctx.storage.delete('nextPending'); await this.flush(s); }
    } catch (e) {
      await this.ctx.storage.setAlarm(Date.now() + 5000);
      throw e;
    }
  }
  async advance(s) {
    if (s.phase !== 'ANSWERING' || Date.now() < s.endsAt + GRACE_MS) return;
    const item = s.items[s.index];
    const rows = Object.entries(s.responses).map(([userId, responses]) => {
      const r = responses[item.question_id] || {};
      const q = s.questions[item.question_id], correct = q.answer ? isRight(q, r.answer || null) : null;
      return { userId, answer: r.answer || null, correct: correct === null ? null : correct ? 1 : 0,
        locked: !!r.locked, ms: Math.max(0, Math.min(r.lockedAt || s.endsAt, s.endsAt, Date.now()) - Math.max(s.startedAt || s.endsAt, s.joinedAt?.[userId] || s.startedAt || s.endsAt)),
        changes: r.changes || 0, history: r.history || [] };
    });
    if (await this.ctx.storage.get('pending')) throw Error('pending D1 flush');
    for (const r of rows) (s.responses[r.userId][item.question_id] ||= {}).ms = r.ms;
    await this.ctx.storage.put('pending', { questionId: item.question_id, rows, end: false });
    s.phase = 'REVEALED'; await this.save(s);
    await this.flush(s);
    this.broadcast(s);
  }
  async alarm() {
    const s = await this.state(); if (!s) return;
    try { await this.advance(s); await this.flush(s); }
    catch { await this.ctx.storage.setAlarm(Date.now() + 5000); }
  }
  async fetch(req) {
    if (req.headers.get('X-Lesson-Internal') !== 'room') return new Response('not found', { status: 404 });
    const ws = req.method === 'GET' && req.headers.get('Upgrade')?.toLowerCase() === 'websocket';
    if (!ws && req.method !== 'POST') return new Response('not found', { status: 404 });
    let a; try { a = ws ? JSON.parse(req.headers.get('X-Lesson-Context') || 'null') : await req.json(); }
    catch { return Response.json({ error: 'invalid request' }, { status: 400 }); }
    if (!a || a.ws !== ws || (a.role === 'student' && a.join && !/^[0-9a-f-]{36}$/i.test(a.clientId || '')) || !Number.isInteger(a.sessionId) || typeof a.userId !== 'string' || a.userId.length > 128 || !['admin','student'].includes(a.role)) return Response.json({ error: 'invalid request' }, { status: 400 });
    const s = await this.initialize(a.sessionId);
    if (!s || s.status === 'ended') return Response.json({ error: 'session ended or unsupported' }, { status: 410 });
    // D1 owner and membership/role checked at the Worker. No direct public DO endpoint.
    if (a.role === 'admin' && a.userId !== s.owner) return Response.json({ error: 'forbidden' }, { status: 403 });
    try { await this.advance(s); await this.flush(s); }
    catch { return Response.json({ error: 'persistence unavailable' }, { status: 503 }); }
    if (a.role === 'student') {
      if (s.kicked.includes(a.userId)) return Response.json({ error: 'removed' }, { status: 403 });
      if (a.ws && !s.clients?.[a.userId]) return Response.json({ error: 'join first' }, { status: 403 });
       if (!a.join && (a.ws || a.clientId) && s.clients?.[a.userId] && s.clients[a.userId] !== a.clientId) return Response.json({ error: 'replaced by another tab' }, { status: 409 });
      if (!s.responses[a.userId] && !a.join) return Response.json({ error: 'not joined' }, { status: 403 });
      if (!s.responses[a.userId] && s.lockedJoin) return Response.json({ error: 'joining locked' }, { status: 423 });
      if (!s.responses[a.userId] && Object.keys(s.responses).length >= 500) return Response.json({ error: 'room full' }, { status: 429 });
      if (!s.responses[a.userId]) {
        await this.env.DB.prepare(`INSERT INTO session_participants (session_id,user_id,assigned_question_ids_json) VALUES (?,?,?)
          ON CONFLICT(session_id,user_id) DO UPDATE SET left_at=NULL`).bind(s.id,a.userId,JSON.stringify(s.items.map(x => x.question_id))).run();
        s.responses[a.userId] = {};
        s.roster[a.userId] = a.name || a.userId;
        s.joinedAt[a.userId] = Date.now();
        await this.save(s); this.broadcast(s);
        if (s.phase === 'REVEALED') {
          await this.ctx.storage.put('pending', { questionId: s.items[s.index].question_id, end: false,
            rows: [{ userId: a.userId, answer: null, correct: s.questions[s.items[s.index].question_id].answer ? 0 : null,
              locked: false, ms: 0, changes: 0, history: [] }] });
          await this.flush(s);
        }
      }
    }
    if (!a.ws) {
      if (a.join) {
        s.clients ||= {}; s.clients[a.userId] = a.clientId; await this.save(s);
        for (const old of this.sockets('student')) if (old.deserializeAttachment()?.userId === a.userId) old.close(4001, 'Replaced by another tab');
      }
      return Response.json({ ...this.snapshot(s, a), ...(a.join ? { clientId: a.clientId } : {}), serverNow: Date.now() });
    }
    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    if (a.role === 'student') { s.clients ||= {}; s.clients[a.userId] = a.clientId; await this.save(s); }
    for (const old of this.sockets(a.role)) if (old.deserializeAttachment()?.userId === a.userId) old.close(4001, 'Replaced by another tab');
    this.ctx.acceptWebSocket(server);
    server.serializeAttachment({ role: a.role, userId: a.userId, clientId: a.clientId });
    this.send(server, this.snapshot(s, a));
    this.broadcast(s);
    return new Response(null, { status: 101, webSocket: client });
  }
  async webSocketMessage(ws, raw) {
    const a = ws.deserializeAttachment();
    if (!a || !this.active(ws) || typeof raw !== 'string' || new TextEncoder().encode(raw).length > MAX_FRAME) { ws.close(1008, 'Invalid frame'); return; }
    let m; try { m = JSON.parse(raw); } catch { this.send(ws, { type: 'error', error: 'invalid JSON' }); return; }
    if (!validAction(m, a.role)) { this.send(ws, { type: 'error', error: 'invalid action' }); return; }
    const s = await this.state();
    if (!s) { ws.close(1011, 'Room unavailable'); return; }
    if (a.role === 'student' && (!s.responses[a.userId] || (s.clients?.[a.userId] && s.clients[a.userId] !== a.clientId))) { ws.close(4001, 'Replaced or removed'); return; }
    if (m.type === 'ping') { this.send(ws, { type: 'pong', sentAt: m.sentAt }); return; }
    try { await this.advance(s); await this.flush(s); }
    catch { this.send(ws, { type: 'error', error: 'persistence unavailable' }); return; }
    if (m.type === 'endSession' && a.role === 'admin' && s.phase === 'ANSWERING') {
      s.endsAt = Date.now() - GRACE_MS;
      await this.save(s);
      await this.advance(s);
      await this.flush(s);
    }
    let err = null, changed = false;
    const item = s.items[s.index];
    if (s.status === 'ended') err = 'ended';
    if (err) { this.send(ws, { type: 'error', error: err }); return; }
    if (m.type === 'annotate' || m.type === 'laser') {
      if (a.role !== 'admin' || s.phase !== 'REVEALED' || item.question_id !== m.questionId) { this.send(ws,{ type:'error',error:'invalid phase' }); return; }
      if (m.type === 'laser') {
        // Presenter sends ~30 Hz; the floor sheds anything faster. A hide is never dropped.
        if (!m.hide && Date.now() - (this.lastLaser || 0) < 25) return;
        this.lastLaser = Date.now();
        // Relay to everyone except the sender (it draws its own dot) and without serverNow.
        const frame = JSON.stringify(m.hide ? { type:'laser', questionId:m.questionId, hide:true } : { type:'laser', questionId:m.questionId, x:m.x, y:m.y, ...(m.a ? { a:m.a } : {}) });
        for (const peer of this.sockets()) if (peer !== ws) try { peer.send(frame); } catch { /* disconnected */ }
        return;
      } else {
        const layer = s.annotations?.[m.questionId] || [];
        const op = m.op;
        if (op.type === 'highlight' || op.type === 'strike') {
          const q = s.questions[item.question_id];
          const choice = op.nodeId.startsWith('c:') && q.choices.find(c => c.letter === op.nodeId.slice(2));
          const index = Number(op.nodeId.slice(2));
          const blocks = (q.stem_html.match(/<(?:p|li|h[1-4]|blockquote)\b/gi) || []).length;
          const source = choice ? choice.content : /^(?:p|s):/.test(op.nodeId) && Number.isInteger(index) && index < Math.max(1,blocks) ? q.stem_html : null;
          if (!source || op.endOffset > source.length) { this.send(ws,{ type:'error',error:'invalid anchor' }); return; }
        }
        if (op.type === 'erase') {
          if (!layer.some(mark => mark.id === op.id)) { this.send(ws,{ type:'error',error:'unknown mark' }); return; }
        } else if (op.type !== 'clear' && (layer.length >= 512 || layer.some(mark => mark.id === op.id))) { this.send(ws,{ type:'error',error:'layer full or duplicate mark' }); return; }
        const next = op.type === 'clear' ? [] : op.type === 'erase' ? layer.filter(mark => mark.id !== op.id) : [...layer, op];
        if (JSON.stringify(next).length > 64000) { this.send(ws,{ type:'error',error:'layer full' }); return; }
        (s.annotations ||= {})[m.questionId] = next;
        await this.save(s);
      }
      for (const peer of this.sockets()) try { this.send(peer, { type:'annotate', questionId:m.questionId, op:m.op }); } catch { /* disconnected */ }
      return;
    }
    if (a.role === 'student') {
      if (!s.responses[a.userId]) err = 'removed';
      else if (s.phase !== 'ANSWERING' || Date.now() > s.endsAt + GRACE_MS || item.question_id !== m.questionId) err = 'question closed';
      else {
        const current = s.responses[a.userId][m.questionId] || { answer: null, locked: false, changes: 0, history: [], joinedAt: Date.now() };
        if (current.locked) err = 'answer locked';
        else if (m.type === 'select') {
          const q = s.questions[m.questionId];
          if (m.answer === '') { if (current.answer) { current.answer = null; changed = true; } }
          else if (q.spr ? !/^[-\d./]{1,32}$/.test(m.answer) : !q.choices.some(c => c.letter === m.answer)) err = 'invalid answer';
          else if (m.answer !== current.answer) {
            if (current.answer) current.changes++;
            current.answer = m.answer;
            if (current.history.length < 128) current.history.push({ answer: m.answer, atMs: Date.now() - s.startedAt });
            changed = true;
          }
        } else { current.locked = true; current.lockedAt = Date.now(); changed = true; }
        if (changed) s.responses[a.userId][m.questionId] = current;
      }
    } else {
      if (s.phase === 'ENDED') err = 'ended';
      else if (m.type === 'kick') {
        if (!s.responses[m.userId]) err = 'not joined';
        else {
          await this.env.DB.prepare('UPDATE session_participants SET left_at=datetime(\'now\') WHERE session_id=? AND user_id=?').bind(s.id,m.userId).run();
          delete s.responses[m.userId]; delete s.roster[m.userId]; delete s.joinedAt[m.userId]; if (s.clients) delete s.clients[m.userId]; s.kicked.push(m.userId); changed = true;
          for (const old of this.sockets('student')) if (old.deserializeAttachment()?.userId === m.userId) old.close(4002, 'Removed');
        }
      } else if (m.type === 'lockJoin') { s.lockedJoin = m.bool; changed = true; }
      else if (m.type === 'classResults' && s.phase !== 'ENDED') { s.classResults = m.bool; changed = true; }
      else if (m.type === 'start' && s.status === 'lobby') {
        await this.env.DB.prepare("UPDATE lesson_sessions SET status='live',started_at=COALESCE(started_at,datetime('now')) WHERE id=? AND status='lobby'").bind(s.id).run();
        s.status = 'live'; s.phase = 'ANSWERING'; s.startedAt = Date.now(); s.endsAt = s.startedAt + item.time_limit_sec * 1000; changed = true;
      } else if (m.type === 'startQuestion' && s.phase === 'READY' && s.status === 'live') {
        s.phase = 'ANSWERING'; s.startedAt = Date.now(); s.endsAt = s.startedAt + item.time_limit_sec * 1000; changed = true;
      } else if (m.type === 'addTime' && s.phase === 'ANSWERING' && Date.now() < s.endsAt) {
        s.endsAt += 15000; changed = true;
      } else if (m.type === 'endNow' && s.phase === 'ANSWERING') {
        s.endsAt = Date.now(); changed = true;
      } else if (m.type === 'next' && s.phase === 'REVEALED' && s.index + 1 < s.items.length) {
        await this.ctx.storage.put(await this.ctx.storage.get('pending') ? 'nextPending' : 'pending', { questionId: item.question_id, rows: [], end: false, ...(s.annotations?.[item.question_id] ? { annotations:s.annotations[item.question_id] } : {}) });
        s.index++; s.phase = 'READY'; s.endsAt = null; changed = true;
      } else if (m.type === 'endSession') {
        await this.ctx.storage.put(await this.ctx.storage.get('pending') ? 'nextPending' : 'pending', { questionId: item.question_id, rows: [], end: true, ...(s.phase === 'REVEALED' && s.annotations?.[item.question_id] ? { annotations:s.annotations[item.question_id] } : {}) });
        s.phase = 'ENDED'; s.status = 'ended'; changed = true;
      } else err = 'invalid phase';
    }
    if (err) { this.send(ws, { type: 'error', error: err }); return; }
    if (changed) {
      await this.save(s);
      if (m.type === 'next') await this.flush(s).catch(() => {});
      if (s.phase === 'ANSWERING') await this.ctx.storage.setAlarm(s.endsAt + GRACE_MS);
      else if (s.phase === 'ENDED') { await this.ctx.storage.deleteAlarm(); await this.flush(s).catch(() => {}); }
      this.broadcast(s, a.role === 'student', a.userId);
      if (m.type === 'endNow') await this.advance(s);
    } else this.send(ws, this.snapshot(s, a));
  }
  async webSocketClose(ws, code, reason) {
    ws.close(code, reason);
    if (ws.deserializeAttachment()?.role !== 'admin') return;
    // Presenter gone: take their laser off every student screen.
    const s = await this.state(), item = s?.items[s.index];
    if (item) for (const peer of this.sockets('student')) try { peer.send(JSON.stringify({ type:'laser', questionId:item.question_id, hide:true })); } catch { /* disconnected */ }
  }
  webSocketError(ws) { ws.close(1011, 'Socket error'); }
}
