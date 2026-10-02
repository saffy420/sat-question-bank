import { normalizeQuestion, isRight } from '../public/shared/stats.js';
import { GRACE_MS, POLL_MS, RESULT_MS, MAX_FRAME, MAX_DESMOS_FRAME, validAction, lessonQuestion, responseGroups, lateJoinSet, setResults, mostMissed, pollWinner, shownQuestionIds, stemSnippet } from '../public/shared/lesson.js';
import { lessonWriteBack } from './record.js';
import { traceDurableObject } from './budget.js';
import { d1Failure, retryAt, chunkGroups } from './flush.js';
import { faultInjection } from './fault.js';

const SCHEDULED = Symbol('flush retry scheduled');
const sqlTime = ms => new Date(ms).toISOString().slice(0, 19).replace('T', ' ');
const review = (s, item) => s.desmos?.questionId === item.question_id ? { desmos: s.desmos.state } : {};
// Pending review entries; pending work from before 11b carries one question's layer at the top level.
const reviewsOf = p => [...(p.reviews || []), ...(p.annotations || p.desmos ? [{ questionId: p.questionId, annotations: p.annotations || null, desmos: p.desmos || null }] : [])];
// Store shared marks and instructor eliminations in the existing review annotations column.
const reviewRow = (s, item) => {
  const id = item.question_id;
  const annotations = [...(s.annotations?.[id] || []), ...(s.eliminations?.[id] || []).map(letter => ({ type:'eliminate', id:'eliminate:' + letter, nodeId:'c:' + letter }))];
  const desmos = review(s, item).desmos || null;
  return annotations.length || desmos ? { questionId: id, annotations: annotations.length ? annotations : null, desmos } : null;
};
// Session results timing: s.timing[questionId] = { explainMs, answerMs }, kept in room storage and
// written once with the ended UPDATE. `revealedAt` stamps the current REVEALED interval; leaving
// REVEALED (any path) adds it to the question being left, so revisits accumulate.
const timingOf = (s, id) => (s.timing ||= {})[id] ||= {};
const openReveal = s => { s.revealedAt = Date.now(); };
const closeReveal = s => {
  const id = s.items[s.index]?.question_id;
  if (s.revealedAt != null && id) { const t = timingOf(s, id); t.explainMs = (t.explainMs || 0) + Math.max(0, Date.now() - s.revealedAt); }
  s.revealedAt = null;
};

class Room {
  constructor(ctx, env) {
    this.ctx = ctx;
    this.env = env;
  }
  // The latest Desmos state lives under its own key so frequent room saves stay small.
  async state() { const s = await this.ctx.storage.get('room'); return s && { ...s, desmos: await this.ctx.storage.get('desmos') || null }; }
  async save(s) { const { desmos, ...room } = s; await this.ctx.storage.put('room', room); }
  send(ws, data) { ws.send(JSON.stringify({ ...data, serverNow: Date.now() })); }
  sockets(role) { return this.ctx.getWebSockets().filter(ws => !role || ws.deserializeAttachment()?.role === role); }
  // Everything students see live also goes to the classroom projector window (admin-ui/Projector.tsx).
  audience() { return this.ctx.getWebSockets().filter(ws => ['student', 'projector'].includes(ws.deserializeAttachment()?.role)); }
  active(ws) { const a = ws.deserializeAttachment(); return !!a && this.sockets(a.role).filter(other => other.deserializeAttachment()?.userId === a.userId).at(-1) === ws; }
  snapshot(s, a, full = true) {
    if (s.mode === 'self') return this.selfSnapshot(s, a, full);
    // The projector is the student projection with nobody's answer in it, plus the join code.
    if (a.role === 'projector') return { ...this.snapshot(s, { ...a, role: 'student', userId: null }, full), role: 'projector', assignedQuestionIds: undefined, code: s.code, lockedJoin: s.lockedJoin };
    const item = s.items[s.index];
    const r = a.role === 'student' && a.userId ? Object.hasOwn(s.responses, a.userId) ? s.responses[a.userId]?.[item?.question_id] : null : null;
    const revealed = s.phase === 'REVEALED' || s.phase === 'ENDED', { reached, played } = this.frontier(s);
    return { type: 'snapshot', sessionId: s.id, role: a.role, title: s.title, phase: s.phase, status: s.status,
      questionId: item?.question_id || null, index: s.index, total: s.items.length, endsAt: s.endsAt, revisit: s.index < reached,
      assignedQuestionIds: a.role === 'student' ? s.items.map(x => x.question_id) : undefined,
      question: item ? lessonQuestion(s.questions[item.question_id], revealed || a.role === 'admin') : null,
      ownSelection: r?.answer || null, locked: !!r?.locked, count: Object.keys(s.responses).length,
      classResults: !!s.classResults, annotations: item ? (s.annotations?.[item.question_id] || []).filter(x => revealed || a.role === 'admin' || x.type === 'edit') : [],
      eliminations: item ? this.sharedEliminations(s, item.question_id, a.role) : [],
      hasMath: s.items.some(x => s.questions[x.question_id]?.section === 'Math'), desmosKey: a.desmosKey || null,
      desmos: revealed && item && s.desmos?.questionId === item.question_id ? s.desmos.state : null,
      view: s.view || null,
      ...(revealed && item && (a.role === 'admin' || s.classResults) ? { distribution: responseGroups(s.questions[item.question_id], Object.fromEntries(Object.entries(s.responses).map(([id, answers]) => [id, answers[item.question_id]])))
        .map(g => a.role === 'admin' ? { ...g, users: g.users.map(u => ({ name: s.roster[u.userId], ms: u.ms })) } : { label: g.label, count: g.count, correct: g.correct }) } : {}),
      ...(a.role === 'admin' ? { code: s.code, lockedJoin: s.lockedJoin, roster: s.roster,
        responses: s.responses, notes: item?.notes || '', reached, played,
        ...(full ? { outline: s.items.map(x => ({ questionId: x.question_id, snippet: stemSnippet(lessonQuestion(s.questions[x.question_id]).stem_html) })) } : {}) } : {}) };
  }
  // 11b navigator (instructor-paced). `reached` is the furthest lesson index opened; `played` counts
  // revealed questions, so items 0..played-1 are done. An index below `reached` is a revisit: it shows
  // REVEALED from the saved responses, annotations and graph, answers never reopen and no clock runs.
  // Rooms saved before 11b derive both from the current index and phase.
  frontier(s) {
    return { reached: s.reached ?? s.index, played: s.played ?? (s.phase === 'REVEALED' || s.phase === 'ENDED' ? s.index + 1 : s.index) };
  }
  // ‹ / › / drawer, and Next (the move to index + 1). Only played questions and the next unplayed one
  // are reachable, and not while a question is open for answers. Returns an error or null.
  async move(s, to) {
    const { reached, played } = this.frontier(s), item = s.items[s.index];
    if (s.status !== 'live' || (s.phase !== 'READY' && s.phase !== 'REVEALED')) return 'invalid phase';
    if (!Number.isInteger(to) || to < 0 || to >= s.items.length || to === s.index || to > played) return 'question not reachable';
    // A laser frame held by the rate floor belongs to the question being left (and may be headed for students).
    clearTimeout(this.laserHeld); this.laserHeld = null;
    // Leaving a revealed question lands its shared layer, as Next always has.
    const row = s.phase === 'REVEALED' ? reviewRow(s, item) : null;
    if (row) await this.queue({ questionId: item.question_id, rows: [], end: false, reviews: [row] });
    if (s.phase === 'REVEALED') closeReveal(s);
    // The graph stays with its question (desmos:<id>) for a revisit; `desmos` holds the current one.
    if (s.desmos?.questionId === item.question_id) await this.ctx.storage.put(`desmos:${item.question_id}`, s.desmos);
    s.desmos = await this.ctx.storage.get(`desmos:${s.items[to].question_id}`) || null;
    if (s.desmos) await this.ctx.storage.put('desmos', s.desmos); else await this.ctx.storage.delete('desmos');
    s.index = to; s.reached = Math.max(reached, to); s.played = played; s.endsAt = null;
    s.phase = to < played ? 'REVEALED' : 'READY';
    if (s.phase === 'REVEALED') openReveal(s);
    return null;
  }
  // Review-only work waits behind an in-flight flush in `nextPending`, where entries for different
  // questions merge instead of replacing each other.
  async queue(work) {
    if (!await this.ctx.storage.get('pending')) { await this.ctx.storage.put('pending', work); return; }
    const held = await this.ctx.storage.get('nextPending');
    if (held) {
      const reviews = [...reviewsOf(held).filter(r => !work.reviews?.some(w => w.questionId === r.questionId)), ...(work.reviews || [])];
      work = { ...held, ...work, end: !!(held.end || work.end), usage: work.usage || held.usage, reviews, annotations: undefined, desmos: undefined };
    }
    await this.ctx.storage.put('nextPending', work);
  }
  // Self-paced (§8): a student gets only their own set, selections and position, never
  // answers, grades or notes. Question bodies ride only on full snapshots (join, connect,
  // start, resync); selection acks and throttled roster refreshes leave them out.
  selfSnapshot(s, a, full) {
    const base = { type: 'snapshot', mode: 'self', sessionId: s.id, role: a.role, title: s.title, phase: s.phase, status: s.status,
      endsAt: s.endsAt, count: Object.keys(s.responses).length };
    // Projector: the class-wide status only (clock, submitted count), never one student's set.
    if (a.role === 'projector') {
      const takers = Object.keys(s.responses).filter(userId => s.assigned[userId]?.length);
      return { ...base, total: s.items.length, questionId: null, index: 0, code: s.code, lockedJoin: s.lockedJoin,
        takers: takers.length, submittedCount: takers.filter(userId => s.submitted[userId]).length,
        ...(s.phase === 'POLL' ? { poll: { endsAt: s.poll.endsAt, choices: s.poll.choices.map(id => ({ questionId: id, number: s.items.findIndex(x => x.question_id === id) + 1 })) } } : {}),
        ...(s.phase === 'POLL_RESULT' ? { pollResult: s.pollResult } : {}),
        ...(this.reviewing(s) ? this.reviewPayload(s, a) : {}) };
    }
    if (a.role === 'student') {
      const ids = s.assigned[a.userId] || [];
      const own = s.responses[a.userId] || {};
      const position = ids.includes(s.positions[a.userId]) ? s.positions[a.userId] : ids[0] || null;
      return { ...base, total: ids.length, assignedQuestionIds: ids, questionId: position, index: Math.max(0, ids.indexOf(position)),
        selections: Object.fromEntries(ids.filter(id => own[id]?.answer).map(id => [id, own[id].answer])),
        submitted: !!s.submitted[a.userId], timeSeq: s.clock[a.userId]?.seq || 0,
        lateJoin: Object.hasOwn(s.joinRemaining, a.userId), joinRemainingMs: s.joinRemaining[a.userId] ?? null, reviewed: (s.reviewed || []).length,
        // The student's own calculator (lessons-11c) needs the public Desmos key during the set too.
        hasMath: s.items.some(x => s.questions[x.question_id]?.section === 'Math'), desmosKey: a.desmosKey || null,
        ...(full && s.status === 'live' ? { questions: ids.map(id => lessonQuestion(s.questions[id])) } : {}),
        ...(s.phase === 'POLL' ? { poll: this.studentPoll(s, a.userId) } : {}),
        ...(s.phase === 'POLL_RESULT' ? { pollResult: s.pollResult } : {}),
        ...(this.reviewing(s) ? this.reviewPayload(s, a) : {}) };
    }
    // Compact on purpose: this refresh runs up to 4/s. grid[userId][questionId] = [answer, correct, ms]
    // for assigned questions only; card groups list students by their index in `students`.
    const students = Object.keys(s.roster);
    const grid = {}, cards = {};
    for (const userId of students) {
      grid[userId] = {};
      for (const id of s.assigned[userId] || []) {
        const r = s.responses[userId]?.[id];
        grid[userId][id] = [r?.answer || null, r?.answer ? isRight(s.questions[id], r.answer) : null, r?.ms || 0];
      }
    }
    for (const item of s.items) {
      const id = item.question_id, q = s.questions[id];
      const assigned = students.filter(userId => s.assigned[userId]?.includes(id));
      const answered = assigned.filter(userId => grid[userId][id][0]);
      const visitors = assigned.filter(userId => grid[userId][id][2] > 0 || s.positions[userId] === id);
      cards[id] = { assigned: assigned.length, answered: answered.length, right: answered.filter(userId => grid[userId][id][1]).length,
        avgMs: visitors.length ? Math.round(visitors.reduce((n, userId) => n + grid[userId][id][2], 0) / visitors.length) : null,
        groups: responseGroups(q, Object.fromEntries(assigned.map(userId => [userId, s.responses[userId]?.[id] || {}])))
          .map(g => ({ label: g.label, count: g.count, correct: g.correct, users: g.users.map(u => students.indexOf(u.userId)) })) };
    }
    return { ...base, total: s.items.length, questionId: null, index: 0, code: s.code, lockedJoin: s.lockedJoin, roster: s.roster, students,
      items: s.items.map(x => ({ questionId: x.question_id, timeLimitSec: x.time_limit_sec })),
      positions: s.positions, submitted: Object.fromEntries(Object.keys(s.submitted).map(userId => [userId, true])),
      lateJoin: s.joinRemaining, grid, cards,
      ...(full ? { questions: Object.fromEntries(s.items.map(x => [x.question_id, { ...lessonQuestion(s.questions[x.question_id], true), notes: x.notes || '' }])) } : {}),
      ...(s.status === 'review' || s.status === 'ended' ? { overview: this.overview(s), reviewed: s.reviewed || [] } : {}),
      ...(s.phase === 'POLL' ? { poll: this.adminPoll(s) } : {}),
      ...(s.phase === 'POLL_RESULT' ? { pollResult: s.pollResult } : {}),
      ...(this.reviewing(s) ? this.reviewPayload(s, a) : {}) };
  }
  // lessons-11d: while students work on an instructor-paced question (READY / ANSWERING) the
  // instructor's pen, highlight, strike, eliminations and laser reach admin sockets only. The reveal's
  // snapshot publishes the whole layer at once; from REVEALED on (revisits too) it is live again.
  // Self-paced review is REVEALED, so it is unaffected.
  hidden(s) { return s.mode !== 'self' && (s.phase === 'READY' || s.phase === 'ANSWERING'); }
  // The instructor's crossed-out choices (A1). Every elimination a client receives comes from here:
  // snapshots call sharedEliminations, live changes go out only through broadcastEliminations as one
  // `eliminations` message type. Students' own cross-outs never reach the room.
  sharedEliminations(s, questionId, role) { return role !== 'admin' && this.hidden(s) ? [] : s.eliminations?.[questionId] || []; }
  broadcastEliminations(s, questionId) {
    for (const ws of this.sockets(this.hidden(s) ? 'admin' : undefined)) {
      try { this.send(ws, { type: 'eliminations', questionId, letters: this.sharedEliminations(s, questionId, ws.deserializeAttachment()?.role) }); } catch { /* disconnected */ }
    }
  }
  // Review mode (§8.7) is instructor-paced REVEALED on one lesson question: s.index points at it.
  reviewing(s) { return s.mode === 'self' && s.status === 'review' && s.phase === 'REVEALED'; }
  reviewPayload(s, a) {
    const item = s.items[s.index], id = item.question_id, q = s.questions[id];
    const takers = Object.keys(s.responses).filter(userId => s.assigned[userId]?.includes(id));
    const groups = s.classResults || a.role === 'admin' ? responseGroups(q, Object.fromEntries(takers.map(userId => [userId, s.responses[userId][id] || {}]))) : null;
    // Review is untimed: the finished set's clock must not keep counting on screen.
    const common = { questionId: id, index: s.index, total: s.items.length, question: lessonQuestion(q, true), reviewMode: true, endsAt: null,
      annotations: s.annotations?.[id] || [], eliminations: this.sharedEliminations(s, id, a.role), desmos: s.desmos?.questionId === id ? s.desmos.state : null, view: s.view || null, classResults: !!s.classResults,
      hasMath: s.items.some(x => s.questions[x.question_id]?.section === 'Math'), desmosKey: a.desmosKey || null };
    if (a.role === 'admin') return { ...common, notes: item.notes || '',
      responses: Object.fromEntries(takers.map(userId => [userId, { [id]: { answer: s.responses[userId][id]?.answer, locked: true } }])),
      distribution: groups.map(g => ({ ...g, users: g.users.map(u => ({ name: s.roster[u.userId], ms: u.ms })) })) };
    if (a.role === 'projector') return { ...common, ownSelection: null, locked: true, notInSet: false,
      ...(groups ? { distribution: groups.map(g => ({ label: g.label, count: g.count, correct: g.correct })) } : {}) };
    const inSet = !!s.assigned[a.userId]?.includes(id);
    return { ...common, ownSelection: inSet ? s.responses[a.userId]?.[id]?.answer || null : null, locked: true, notInSet: !inSet,
      ...(groups ? { distribution: groups.map(g => ({ label: g.label, count: g.count, correct: g.correct })) } : {}) };
  }
  overview(s) {
    const results = setResults(s);
    return { ...results, ranking: mostMissed(results).map(x => x.questionId),
      questions: results.questions.map(x => ({ ...x, skill: s.questions[x.questionId]?.skill || '', difficulty: s.difficulty?.[x.questionId] || '' })) };
  }
  // A student's poll: the shared options plus their own ✓ / ✗ / not-in-set marks. Nothing about peers.
  studentPoll(s, userId) {
    const number = id => s.items.findIndex(x => x.question_id === id) + 1;
    const mark = id => {
      if (!s.assigned[userId]?.includes(id)) return 'unassigned';
      const verdict = isRight(s.questions[id], s.responses[userId]?.[id]?.answer || '?');
      return verdict === null ? 'unscored' : verdict && s.responses[userId]?.[id]?.answer ? 'right' : 'wrong';
    };
    return { endsAt: s.poll.endsAt, mostMissed: { questionId: s.poll.mostMissed, number: number(s.poll.mostMissed), missed: s.poll.missed },
      choices: s.poll.choices.map(id => ({ questionId: id, number: number(id), mark: mark(id) })), vote: s.poll.votes[userId] || null };
  }
  adminPoll(s) {
    const votes = Object.values(s.poll.votes), picks = {};
    for (const v of votes) if (v.option === 2) picks[v.questionId] = (picks[v.questionId] || 0) + 1;
    return { endsAt: s.poll.endsAt, mostMissed: s.poll.mostMissed, missed: s.poll.missed, choices: s.poll.choices,
      one: votes.filter(v => v.option === 1).length, two: votes.filter(v => v.option === 2).length, picks,
      voted: votes.length, connected: this.connected(s).length };
  }
  connected(s, gone = null) { return [...new Set(this.sockets('student').filter(ws => ws !== gone).map(ws => ws.deserializeAttachment()?.userId))].filter(userId => s.responses[userId]); }
  // Early close: every connected student has a counted vote (G6: zero-assignment students vote too).
  allVoted(s, gone = null) { const users = this.connected(s, gone); return users.length > 0 && users.every(userId => s.poll.votes[userId]); }
  async pollAdvance(s, gone = null) {
    if (s.phase === 'POLL' && (Date.now() >= s.poll.endsAt + GRACE_MS || this.allVoted(s, gone))) {
      const results = setResults(s), votes = Object.values(s.poll.votes);
      const questionId = pollWinner({ votes: s.poll.votes, mostMissed: s.poll.mostMissed, order: s.items.map(x => x.question_id),
        wrong: Object.fromEntries(results.questions.map(x => [x.questionId, x.wrong])) });
      const one = votes.filter(v => v.option === 1).length, two = votes.length - one;
      s.pollResult = { questionId, number: s.items.findIndex(x => x.question_id === questionId) + 1, winner: two > one ? 2 : 1, one, two, endsAt: Date.now() + RESULT_MS };
      s.poll = null; s.phase = 'POLL_RESULT';
      await this.save(s); await this.ctx.storage.setAlarm(s.pollResult.endsAt);
      this.broadcast(s);
    } else if (s.phase === 'POLL_RESULT' && Date.now() >= s.pollResult.endsAt) await this.enterReview(s, s.pollResult.questionId);
  }
  async enterReview(s, questionId) {
    s.index = s.items.findIndex(x => x.question_id === questionId);
    s.phase = 'REVEALED'; s.poll = null; s.pollResult = null; openReveal(s);
    if (!(s.reviewed ||= []).includes(questionId)) s.reviewed.push(questionId);
    await this.save(s);
    this.broadcast(s);
  }
  broadcast(s, selection = false, userId = null, full = !selection) {
    for (const ws of this.sockets(selection ? 'student' : undefined)) {
      if (selection && ws.deserializeAttachment()?.userId !== userId) continue;
      try { this.send(ws, this.snapshot(s, ws.deserializeAttachment(), full)); } catch { /* disconnected */ }
    }
    if (selection && !this.responseTimer) {
      this.responseTimer = setTimeout(async () => {
        this.responseTimer = null;
        const latest = await this.state();
        if (!latest) return;
        for (const ws of [...this.sockets('admin'), ...this.sockets('projector')]) {
          try { this.send(ws, this.snapshot(latest, ws.deserializeAttachment(), false)); } catch { /* disconnected */ }
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
    if (!['instructor','self'].includes(frozen.mode) || !Array.isArray(frozen.items) || !frozen.items.length || frozen.items.length > 500) return null;
    const questions = {}, difficulty = {};
    for (const item of frozen.items) {
      if (questions[item.question_id]) throw Error('duplicate question');
      const core = await this.env.DB.prepare('SELECT id,section,difficulty,skill,stem_html,choices_json,correct_answer,explanation_html,source FROM questions WHERE id=?').bind(item.question_id).first();
      const ai = core || await this.env.AI_DB.prepare('SELECT id,section,difficulty,skill,stem_html,choices_json,correct_answer,explanation_html,source FROM questions WHERE id=?').bind(item.question_id).first();
      if (!ai) throw Error('missing frozen question');
      questions[item.question_id] = normalizeQuestion(ai);
      difficulty[item.question_id] = ai.difficulty || '';
    }
    const participants = await this.env.DB.prepare('SELECT p.user_id, p.joined_at, p.assigned_question_ids_json, u.name, u.email FROM session_participants p JOIN users u ON u.id=p.user_id WHERE p.session_id=? AND p.left_at IS NULL').bind(sessionId).all();
    s = { id: row.id, code: row.join_code, title: frozen.title, owner: row.created_by, items: frozen.items, questions,
      status: row.status, phase: 'READY', index: 0, endsAt: null, lockedJoin: false, kicked: [], responses: {}, roster: {}, joinedAt: {} };
    if (frozen.mode !== 'self') Object.assign(s, { reached: 0, played: 0 });
    if (frozen.mode === 'self') Object.assign(s, { mode: 'self', difficulty, assigned: {}, positions: {}, submitted: {}, clock: {}, joinRemaining: {}, reviewed: [], poll: null, pollResult: null });
    for (const p of participants.results || []) {
      s.responses[p.user_id] = {}; s.roster[p.user_id] = p.name || p.email || p.user_id; s.joinedAt[p.user_id] = Date.parse(p.joined_at + 'Z') || Date.now();
      if (s.mode === 'self') { try { s.assigned[p.user_id] = JSON.parse(p.assigned_question_ids_json); } catch { s.assigned[p.user_id] = []; } }
    }
    await this.save(s);
    return s;
  }
  // One flush at a time per object: events interleave while D1 answers, and callers that arrive
  // mid-flush share its outcome instead of racing it over `pending` / `nextPending`.
  flush(s) {
    if (!this.flushing) this.flushing = this.flushOnce(s).finally(() => { this.flushing = null; });
    return this.flushing;
  }
  async flushOnce(s) {
    const pending = await this.ctx.storage.get('pending');
    if (!pending) return;
    try {
      // Each student's responses, finish time and (self-paced, §10) practice write-back land together,
      // a few students per batch (src/flush.js). Students in `done` already landed; every statement is
      // idempotent too, so a batch retried after an unrecorded success changes nothing.
      const done = new Set(pending.done || []), finished = pending.finished || [];
      const users = [...new Set([...pending.rows.map(r => r.userId), ...finished.map(f => f.userId)])].filter(u => !done.has(u));
      const chunks = chunkGroups(users.map(userId => ({ userId,
        size: pending.rows.filter(r => r.userId === userId).length * (pending.writeBack ? 3 : 1) + finished.filter(f => f.userId === userId).length })));
      const tail = pending.review ? [this.env.DB.prepare("UPDATE lesson_sessions SET status='review' WHERE id=? AND status='live'").bind(s.id)] : [];
      for (const [i, chunk] of chunks.entries()) {
        const ids = new Set(chunk.map(g => g.userId)), rows = pending.rows.filter(r => ids.has(r.userId));
        await this.env.DB.batch([...rows.map(r => this.env.DB.prepare(`INSERT INTO session_responses
          (session_id,user_id,question_id,final_answer,is_correct,locked_early,time_spent_ms,answer_changes,answer_history_json)
          VALUES (?,?,?,?,?,?,?,?,?) ON CONFLICT(session_id,user_id,question_id) DO NOTHING`)
          .bind(s.id, r.userId, r.questionId || pending.questionId, r.answer, r.correct, r.locked ? 1 : 0, r.ms, r.changes, JSON.stringify(r.history))),
          ...finished.filter(f => ids.has(f.userId)).map(f => this.env.DB.prepare("UPDATE session_participants SET finished_at=? WHERE session_id=? AND user_id=? AND finished_at IS NULL").bind(sqlTime(f.at), s.id, f.userId)),
          ...(pending.writeBack ? await lessonWriteBack(this.env.DB, s.id, pending.writeBack.at, rows, s.questions) : []),
          ...(i === chunks.length - 1 ? tail : [])]);
        if (i < chunks.length - 1) { pending.done = [...done, ...chunks.slice(0, i + 1).flat().map(g => g.userId)]; await this.ctx.storage.put('pending', pending); }
      }
      if (!chunks.length && tail.length) await this.env.DB.batch(tail);
      // Idempotent upserts, so a retry after a partial run changes nothing.
      for (const r of reviewsOf(pending)) await this.env.DB.prepare(`INSERT INTO session_question_review (session_id,question_id,annotations_json,desmos_state_json)
        VALUES (?,?,?,?) ON CONFLICT(session_id,question_id) DO UPDATE SET annotations_json=COALESCE(excluded.annotations_json,annotations_json),
        desmos_state_json=COALESCE(excluded.desmos_state_json,desmos_state_json)`)
        .bind(s.id,r.questionId,r.annotations ? JSON.stringify(r.annotations) : null,r.desmos ? JSON.stringify(r.desmos) : null).run();
      // §2 usedInLesson: every question the session showed, recorded with the end.
      if (pending.end) await this.env.DB.batch([...(pending.usage || []).map(questionId => this.env.DB.prepare('INSERT OR IGNORE INTO question_lesson_usage (question_id,session_id) VALUES (?,?)').bind(questionId, s.id)),
        this.env.DB.prepare("UPDATE lesson_sessions SET status='ended', ended_at=COALESCE(ended_at,datetime('now')), timing_json=COALESCE(?,timing_json) WHERE id=? AND status!='ended'")
          .bind(pending.timing ? JSON.stringify(pending.timing) : null, s.id)]);
      await this.ctx.storage.delete('pending');
      if (await this.ctx.storage.get('flushRetry')) { await this.ctx.storage.delete('flushRetry'); await this.syncStatus(s, null); }
      const next = await this.ctx.storage.get('nextPending');
      if (next) { await this.ctx.storage.put('pending', next); await this.ctx.storage.delete('nextPending'); await this.flushOnce(s); }
    } catch (e) {
      if (!e?.[SCHEDULED]) await this.flushFailed(s, e);
      throw e;
    }
  }
  // The unflushed work stays in `pending` (DO storage) until D1 takes it. A daily-limit error waits
  // for the 00:00 UTC reset with backoff probes before it; anything else backs off to 5 minutes
  // (src/flush.js). While a retry is scheduled, failures from messages leave it alone.
  async flushFailed(s, e) {
    const held = await this.ctx.storage.get('flushRetry'), now = Date.now();
    if (held && !this.retrying && now < held.at) return;
    const kind = d1Failure(e), failures = (held?.failures || 0) + 1, retry = { kind, failures, since: held?.since || now, at: retryAt(kind, failures, now) };
    await this.ctx.storage.put('flushRetry', retry);
    await this.ctx.storage.setAlarm(retry.at);
    await this.syncStatus(s, retry);
    if (e && typeof e === 'object') e[SCHEDULED] = true;
  }
  // Admin banner (GET /api/admin/lesson-sync) reads the registry, which needs no D1. Best effort.
  async syncStatus(s, retry) {
    try {
      await this.env.LESSON_SYNC?.getByName('all').fetch(new Request('https://lesson.internal/', { method: 'POST',
        headers: { 'X-Lesson-Internal': 'sync', 'Content-Type': 'application/json' },
        body: JSON.stringify(retry ? { sessionId: s.id, at: retry.at, kind: retry.kind, since: retry.since } : { sessionId: s.id, clear: true }) }));
    } catch { /* the banner is informational */ }
  }
  async advance(s) {
    if (s.phase === 'POLL' || s.phase === 'POLL_RESULT') return this.pollAdvance(s);
    if (s.phase !== 'ANSWERING' || Date.now() < s.endsAt + GRACE_MS) return;
    if (s.mode === 'self') return this.completeSet(s);
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
    // Actual answering time: the question's start to the close of its clock (End now / time up /
    // End session, which pulls endsAt back past the grace and stamps the real close in closedAt).
    const t = timingOf(s, item.question_id);
    t.answerMs = (t.answerMs || 0) + Math.max(0, (s.closedAt ?? Math.min(Date.now(), s.endsAt)) - (s.startedAt || s.endsAt));
    delete s.closedAt;
    openReveal(s);
    s.phase = 'REVEALED'; s.reached = s.index; s.played = s.index + 1; await this.save(s);
    await this.flush(s);
    this.broadcast(s);
  }
  // Set completion (G6): current selections become final, submitted ones keep locked_early, blanks
  // stay null (is_correct 0 when scorable), unassigned questions get no row. Runs once.
  async completeSet(s) {
    if (s.mode !== 'self' || s.phase !== 'ANSWERING') return;
    const rows = [];
    for (const [userId, ids] of Object.entries(s.assigned)) {
      if (!s.responses[userId]) continue;
      for (const questionId of ids) {
        const r = s.responses[userId][questionId] || {}, q = s.questions[questionId];
        const correct = q.answer ? isRight(q, r.answer || null) : null;
        rows.push({ userId, questionId, answer: r.answer || null, correct: correct === null ? null : correct ? 1 : 0,
          locked: !!s.submitted[userId], ms: r.ms || 0, changes: r.changes || 0, history: r.history || [] });
      }
    }
    if (await this.ctx.storage.get('pending')) throw Error('pending D1 flush');
    const at = Date.now();
    await this.ctx.storage.put('pending', { rows, end: false, review: true, writeBack: { at },
      finished: Object.entries(s.submitted).filter(([userId]) => s.responses[userId]).map(([userId, at]) => ({ userId, at })) });
    s.phase = 'FINISHED'; s.status = 'review'; s.finishedAt = at;
    await this.save(s);
    await this.flush(s);
    this.broadcast(s);
  }
  async alarm() {
    const s = await this.state(); if (!s) return;
    this.retrying = true;
    try { await this.advance(s); await this.flush(s); }
    catch {
      const held = await this.ctx.storage.get('flushRetry');
      await this.ctx.storage.setAlarm(held?.at > Date.now() ? held.at : Date.now() + 5000);
      return;
    } finally { this.retrying = false; }
    // A retry alarm can replace a poll deadline; re-arm whichever deadline is still ahead.
    const due = s.phase === 'POLL' ? s.poll.endsAt + GRACE_MS : s.phase === 'POLL_RESULT' ? s.pollResult.endsAt : null;
    if (due) await this.ctx.storage.setAlarm(due);
  }
  async fetch(req) {
    if (req.headers.get('X-Lesson-Internal') !== 'room') return new Response('not found', { status: 404 });
    const ws = req.method === 'GET' && req.headers.get('Upgrade')?.toLowerCase() === 'websocket';
    if (!ws && req.method !== 'POST') return new Response('not found', { status: 404 });
    let a; try { a = ws ? JSON.parse(req.headers.get('X-Lesson-Context') || 'null') : await req.json(); }
    catch { return Response.json({ error: 'invalid request' }, { status: 400 }); }
    if (!a || a.ws !== ws || (a.desmosKey != null && !/^[0-9a-f]{32}$/.test(a.desmosKey)) || (a.role === 'student' && a.join && !/^[0-9a-f-]{36}$/i.test(a.clientId || '')) || !Number.isInteger(a.sessionId) || typeof a.userId !== 'string' || a.userId.length > 128 || !['admin','student','projector'].includes(a.role) || (a.role === 'projector' && !a.ws)) return Response.json({ error: 'invalid request' }, { status: 400 });
    const s = await this.initialize(a.sessionId);
    if (!s || s.status === 'ended') return Response.json({ error: 'session ended or unsupported' }, { status: 410 });
    // D1 owner and membership/role checked at the Worker. No direct public DO endpoint.
    if (a.role !== 'student' && a.userId !== s.owner) return Response.json({ error: 'forbidden' }, { status: 403 });
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
        let ids = s.items.map(x => x.question_id);
        // Self-paced late join (§8.2): fitted once to the clock the server has left, stored, never
        // recomputed. Review-only arrivals (G6) get no set.
        if (s.mode === 'self' && s.status !== 'lobby') {
          const remaining = s.phase === 'ANSWERING' ? Math.max(0, s.endsAt - Date.now()) : 0;
          ids = remaining ? lateJoinSet(s.items, remaining, item => s.difficulty[item.question_id]) : [];
          s.joinRemaining[a.userId] = remaining;
        }
        await this.env.DB.prepare(`INSERT INTO session_participants (session_id,user_id,assigned_question_ids_json) VALUES (?,?,?)
          ON CONFLICT(session_id,user_id) DO UPDATE SET left_at=NULL`).bind(s.id,a.userId,JSON.stringify(ids)).run();
        s.responses[a.userId] = {};
        s.roster[a.userId] = a.name || a.userId;
        s.joinedAt[a.userId] = Date.now();
        if (s.mode === 'self') {
          s.assigned[a.userId] = ids; s.clock[a.userId] = { boundary: Date.now(), seq: 0 };
          if (s.status === 'live' && ids.length) s.positions[a.userId] = ids[0];
        }
        await this.save(s); this.broadcast(s, false, null, false);
        if (s.mode !== 'self' && s.phase === 'REVEALED') {
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
    server.serializeAttachment({ role: a.role, userId: a.userId, clientId: a.clientId, desmosKey: a.desmosKey || null });
    this.send(server, this.snapshot(s, a));
    if (a.role !== 'projector') this.broadcast(s);
    return new Response(null, { status: 101, webSocket: client });
  }
  async webSocketMessage(ws, raw) {
    const a = ws.deserializeAttachment();
    const bytes = typeof raw === 'string' ? new TextEncoder().encode(raw).length : Infinity;
    if (!a || !this.active(ws) || bytes > (a.role === 'admin' ? MAX_DESMOS_FRAME : MAX_FRAME)) { ws.close(1008, 'Invalid frame'); return; }
    let m; try { m = JSON.parse(raw); } catch { m = undefined; }
    // The projector only watches: a ping for its clock, nothing else.
    if (a.role === 'projector') { this.send(ws, m?.type === 'ping' && validAction(m, a.role) ? { type: 'pong', sentAt: m.sentAt } : { type: 'error', error: 'invalid action' }); return; }
    // Only a Desmos state may use the larger admin frame.
    if (bytes > MAX_FRAME && m?.type !== 'desmos') { ws.close(1008, 'Invalid frame'); return; }
    if (m === undefined) { this.send(ws, { type: 'error', error: 'invalid JSON' }); return; }
    if (!validAction(m, a.role)) { this.send(ws, { type: 'error', error: 'invalid action' }); return; }
    const s = await this.state();
    if (!s) { ws.close(1011, 'Room unavailable'); return; }
    if (a.role === 'student' && (!s.responses[a.userId] || (s.clients?.[a.userId] && s.clients[a.userId] !== a.clientId))) { ws.close(4001, 'Replaced or removed'); return; }
    if (m.type === 'ping') { this.send(ws, { type: 'pong', sentAt: m.sentAt }); return; }
    try { await this.advance(s); await this.flush(s); }
    catch { this.send(ws, { type: 'error', error: 'persistence unavailable' }); return; }
    if (s.mode === 'self' && a.role === 'student') return this.selfMessage(ws, s, a, m);
    // First End session during a self-paced set finishes the set (review); a second ends the session.
    if (s.mode === 'self' && m.type === 'endSession' && s.phase === 'ANSWERING') {
      try { await this.completeSet(s); } catch { this.send(ws, { type: 'error', error: 'persistence unavailable' }); }
      return;
    }
    if (m.type === 'endSession' && a.role === 'admin' && s.phase === 'ANSWERING') {
      s.closedAt = Date.now(); s.endsAt = s.closedAt - GRACE_MS;
      await this.save(s);
      await this.advance(s);
      await this.flush(s);
    }
    let err = null, changed = false;
    const item = s.items[s.index];
    if (s.status === 'ended') err = 'ended';
    if (err) { this.send(ws, { type: 'error', error: err }); return; }
    if (m.type === 'view') {
      // Presenter fit: session-wide (kept across questions); students use it once a question is revealed.
      const view = { w: m.w, fs: m.fs, u: m.u, vw: m.vw };
      if (JSON.stringify(s.view) === JSON.stringify(view)) return;
      s.view = view;
      await this.save(s);
      for (const peer of this.sockets('student')) try { this.send(peer, { type:'view', ...view }); } catch { /* disconnected */ }
      return;
    }
    if (m.type === 'desmos') {
      // Same gate as annotations: a graph can give the answer away before reveal.
      if (a.role !== 'admin' || s.phase !== 'REVEALED' || item.question_id !== m.questionId) { this.send(ws,{ type:'error',error:'invalid phase' }); return; }
      if (s.desmos?.questionId === m.questionId && JSON.stringify(s.desmos.state) === JSON.stringify(m.state)) return;
      await this.ctx.storage.put('desmos', { questionId: m.questionId, state: m.state });
      for (const peer of this.sockets()) if (peer !== ws) try { this.send(peer, { type:'desmos', questionId:m.questionId, state:m.state }); } catch { /* disconnected */ }
      return;
    }
    if (m.type === 'eliminate') {
      // Live question (instructor-paced) or the question under review (self-paced).
      const open = s.mode === 'self' ? this.reviewing(s) : s.status === 'live' && ['READY', 'ANSWERING', 'REVEALED'].includes(s.phase);
      if (!open || item.question_id !== m.questionId) { this.send(ws, { type:'error', error:'invalid phase' }); return; }
      if (!s.questions[m.questionId].choices.some(c => c.letter === m.letter)) { this.send(ws, { type:'error', error:'invalid choice' }); return; }
      const letters = s.eliminations?.[m.questionId] || [];
      if (letters.includes(m.letter) === m.on) return;
      (s.eliminations ||= {})[m.questionId] = m.on ? [...letters, m.letter].sort() : letters.filter(x => x !== m.letter);
      await this.save(s);
      this.broadcastEliminations(s, m.questionId);
      return;
    }
    if (m.type === 'annotate' || m.type === 'laser') {
      // Revealed (live), or a live instructor-paced question before the reveal (instructor only, 11d).
      const open = s.phase === 'REVEALED' || (s.status === 'live' && this.hidden(s)), to = this.hidden(s) ? 'admin' : undefined;
      if (a.role !== 'admin' || !open || item.question_id !== m.questionId) { this.send(ws,{ type:'error',error:'invalid phase' }); return; }
      if (m.type === 'laser') {
        // Relay to everyone except the sender (it draws its own dot) and without serverNow.
        const frame = JSON.stringify(m.hide ? { type:'laser', questionId:m.questionId, hide:true } : { type:'laser', questionId:m.questionId, x:m.x, y:m.y, ...(m.a ? { a:m.a } : {}) });
        const relay = text => { this.lastLaser = Date.now(); for (const peer of this.sockets(to)) if (peer !== ws) try { peer.send(text); } catch { /* disconnected */ } };
        // Presenter sends ~30 Hz, but Wi-Fi delivers frames in bursts. The 25 ms floor holds the newest
        // frame of a burst and sends it when the floor opens, so the position the pointer comes to rest
        // on always arrives (dropping it left students' dots on a word the pointer only passed over).
        // A hide goes out at once and cancels any held frame.
        clearTimeout(this.laserHeld); this.laserHeld = null;
        const wait = m.hide ? 0 : 25 - (Date.now() - (this.lastLaser || 0));
        if (wait > 0) this.laserHeld = setTimeout(() => { this.laserHeld = null; relay(frame); }, wait);
        else relay(frame);
        return;
      } else {
        const layer = s.annotations?.[m.questionId] || [];
        const op = m.op;
        if (op.type === 'highlight' || op.type === 'strike' || op.type === 'edit') {
          const q = s.questions[item.question_id];
          const choice = op.nodeId.startsWith('c:') && q.choices.find(c => c.letter === op.nodeId.slice(2));
          const index = Number(op.nodeId.slice(2));
          const blocks = (q.stem_html.match(/<(?:p|li|h[1-4]|blockquote)\b/gi) || []).length;
          const source = choice ? choice.content : /^(?:p|s):/.test(op.nodeId) && Number.isInteger(index) && index < Math.max(1,blocks) ? q.stem_html : null;
          if (!source || (op.type !== 'edit' && op.endOffset > source.length)) { this.send(ws,{ type:'error',error:'invalid anchor' }); return; }
        }
        // An edit replaces the block's earlier edit of the same text node (same id). Its block's highlights,
        // strikes and glyph-anchored ink pointed at the old text, so they go with it. Clients learn both as
        // erase ops, which every client already applies, ahead of the edit itself.
        const stale = op.type === 'edit' ? layer.filter(x => x.id === op.id || (x.type !== 'edit' && ((x.type === 'highlight' || x.type === 'strike') ? x.nodeId === op.nodeId : typeof x.a === 'string' && (x.a.startsWith(`${op.nodeId}~`) || x.a.startsWith(`${op.nodeId}@`))))) : [];
        // Clear all leaves text fixes standing: with edits in the layer it goes out as erases of the rest.
        const keep = op.type === 'clear' ? layer.filter(x => x.type === 'edit') : [];
        if (op.type === 'erase') {
          if (!layer.some(mark => mark.id === op.id)) { this.send(ws,{ type:'error',error:'unknown mark' }); return; }
        } else if (op.type !== 'clear' && (layer.length - stale.length >= 512 || (op.type !== 'edit' && layer.some(mark => mark.id === op.id)))) { this.send(ws,{ type:'error',error:'layer full or duplicate mark' }); return; }
        const next = op.type === 'clear' ? keep : op.type === 'erase' ? layer.filter(mark => mark.id !== op.id) : [...layer.filter(x => !stale.includes(x)), op];
        if (JSON.stringify(next).length > 64000) { this.send(ws,{ type:'error',error:'layer full' }); return; }
        (s.annotations ||= {})[m.questionId] = next;
        await this.save(s);
        // Edits are never hidden: a typo fix reaches students in every phase, while the rest of the layer keeps
        // the hidden-until-reveal rule (11d).
        const ops = op.type === 'clear' && keep.length ? layer.filter(x => x.type !== 'edit').map(x => ({ type:'erase', id:x.id })) : [...stale.map(x => ({ type:'erase', id:x.id })), op];
        const edit = x => x.type === 'edit' || (x.type === 'erase' && layer.find(y => y.id === x.id)?.type === 'edit');
        for (const peer of this.sockets()) {
          const shown = !to || peer.deserializeAttachment()?.role === to ? ops : ops.filter(edit);
          for (const x of shown) try { this.send(peer, { type:'annotate', questionId:m.questionId, op:x }); } catch { /* disconnected */ }
        }
        return;
      }
    }
    if (a.role === 'student') {
      if (m.type !== 'select' && m.type !== 'lock') err = 'invalid action';
      else if (!s.responses[a.userId]) err = 'removed';
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
      else if (s.mode === 'self' && !['start', 'endSession', 'kick', 'lockJoin', 'startPoll', 'goto', 'next', 'classResults'].includes(m.type)) err = 'invalid phase';
      else if (s.mode !== 'self' && (m.type === 'next' || m.type === 'goto')) {
        err = await this.move(s, m.type === 'next' ? s.index + 1 : s.items.findIndex(x => x.question_id === m.questionId));
        changed = !err;
      }
      else if (m.type === 'startPoll' || m.type === 'goto') {
        // §8.6 launcher: a poll over the questions not yet reviewed, or straight to one question.
        const open = s.items.map(x => x.question_id).filter(id => !(s.reviewed || []).includes(id));
        if (s.mode !== 'self' || s.status !== 'review' || s.phase !== 'FINISHED') err = 'invalid phase';
        else if (m.type === 'goto') {
          if (!s.questions[m.questionId]) err = 'unknown question';
          else { await this.enterReview(s, m.questionId); return; }
        } else if (!open.length) err = 'Every question has been reviewed';
        else {
          const top = mostMissed(setResults(s), s.reviewed)[0];
          s.poll = { endsAt: Date.now() + POLL_MS, mostMissed: top.questionId, missed: top.wrong, choices: open, votes: {} };
          s.phase = 'POLL'; changed = true;
        }
      }
      else if (m.type === 'start' && s.mode === 'self' && s.status === 'lobby') {
        s.startedAt = Date.now(); s.endsAt = s.startedAt + s.items.reduce((n, x) => n + x.time_limit_sec, 0) * 1000;
        await this.env.DB.prepare("UPDATE lesson_sessions SET status='live',started_at=COALESCE(started_at,datetime('now')),ends_at=? WHERE id=? AND status='lobby'").bind(sqlTime(s.endsAt), s.id).run();
        s.status = 'live'; s.phase = 'ANSWERING';
        for (const userId of Object.keys(s.responses)) {
          s.clock[userId] = { boundary: s.startedAt, seq: s.clock[userId]?.seq || 0 };
          s.positions[userId] ||= s.assigned[userId]?.[0];
        }
        changed = true;
      } else if (m.type === 'kick') {
        if (!s.responses[m.userId]) err = 'not joined';
        else {
          await this.env.DB.prepare('UPDATE session_participants SET left_at=datetime(\'now\') WHERE session_id=? AND user_id=?').bind(s.id,m.userId).run();
          delete s.responses[m.userId]; delete s.roster[m.userId]; delete s.joinedAt[m.userId]; if (s.clients) delete s.clients[m.userId]; s.kicked.push(m.userId); changed = true;
          if (s.poll) delete s.poll.votes[m.userId];
          if (s.mode === 'self') { delete s.assigned[m.userId]; delete s.positions[m.userId]; delete s.submitted[m.userId]; delete s.joinRemaining[m.userId]; }
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
      } else if (m.type === 'next' && s.phase === 'REVEALED' && this.reviewing(s)) {
        // Self-paced review: Next brings the poll launcher back.
        const row = reviewRow(s, item);
        if (row) await this.queue({ questionId: item.question_id, rows: [], end: false, reviews: [row] });
        await this.ctx.storage.delete('desmos'); s.desmos = null;
        closeReveal(s);
        s.phase = 'FINISHED';
        changed = true;
      } else if (m.type === 'endSession') {
        const row = s.phase === 'REVEALED' ? reviewRow(s, item) : null;
        if (s.phase === 'REVEALED') closeReveal(s);
        await this.queue({ questionId: item.question_id, rows: [], end: true, usage: shownQuestionIds(s), reviews: row ? [row] : [], timing: s.timing || {} });
        s.phase = 'ENDED'; s.status = 'ended'; changed = true;
      } else err = 'invalid phase';
    }
    if (err) { this.send(ws, { type: 'error', error: err }); return; }
    if (changed) {
      await this.save(s);
      if (m.type === 'next' || m.type === 'goto') await this.flush(s).catch(() => {});
      if (s.phase === 'ANSWERING') await this.ctx.storage.setAlarm(s.endsAt + GRACE_MS);
      else if (s.phase === 'POLL') await this.ctx.storage.setAlarm(s.poll.endsAt + GRACE_MS);
      else if (s.phase === 'ENDED') { await this.ctx.storage.deleteAlarm(); await this.flush(s).catch(() => {}); }
      this.broadcast(s, a.role === 'student', a.userId);
      if (m.type === 'endNow') await this.advance(s);
      if (m.type === 'kick' && this.allSubmitted(s)) await this.completeSet(s).catch(() => {});
      if (m.type === 'kick' && s.phase === 'POLL') await this.pollAdvance(s);
    } else this.send(ws, this.snapshot(s, a));
  }
  // Everyone with a non-empty set has submitted (G6: zero-assignment students don't count).
  allSubmitted(s) {
    if (s.mode !== 'self' || s.phase !== 'ANSWERING') return false;
    const takers = Object.keys(s.responses).filter(userId => s.assigned[userId]?.length);
    return takers.length > 0 && takers.every(userId => s.submitted[userId]);
  }
  async selfMessage(ws, s, a, m) {
    if (m.type === 'vote') return this.vote(ws, s, a, m);
    const ids = s.assigned[a.userId] || [];
    let err = null;
    if (s.status !== 'live' || s.phase !== 'ANSWERING' || Date.now() > s.endsAt + GRACE_MS) err = 'set closed';
    else if (s.submitted[a.userId]) err = 'submitted';
    else if (m.type === 'lock') err = 'invalid action';
    else if (m.type !== 'submitAll' && !ids.includes(m.questionId)) err = 'not in your set';
    if (err) { this.send(ws, { type: 'error', error: err }); return; }
    const own = s.responses[a.userId];
    const r = m.questionId ? own[m.questionId] ||= { answer: null, changes: 0, history: [], ms: 0 } : null;
    if (m.type === 'select') {
      const q = s.questions[m.questionId];
      if (m.answer && (q.spr ? !/^[-\d./]{1,32}$/.test(m.answer) : !q.choices.some(c => c.letter === m.answer))) { this.send(ws, { type: 'error', error: 'invalid answer' }); return; }
      if (m.answer !== (r.answer || '')) {
        if (r.answer) r.changes++;
        r.answer = m.answer || null;
        if (m.answer && r.history.length < 128) r.history.push({ answer: m.answer, atMs: Date.now() - s.startedAt });
      }
    } else if (m.type === 'navigate') s.positions[a.userId] = m.questionId;
    else if (m.type === 'time') {
      // §8.5 + G5: accumulate every visit, never more than server time elapsed since the last
      // accepted boundary (the excess is dropped); a seq already accepted is a replay.
      const c = s.clock[a.userId] ||= { boundary: s.startedAt, seq: 0 };
      if (m.seq <= c.seq) return;
      const now = Math.min(Date.now(), s.endsAt + GRACE_MS);
      r.ms = (r.ms || 0) + Math.max(0, Math.min(m.deltaMs, now - c.boundary));
      c.boundary = now; c.seq = m.seq;
    } else s.submitted[a.userId] = Date.now();
    await this.save(s);
    if (this.allSubmitted(s)) {
      try { await this.completeSet(s); } catch { this.send(ws, { type: 'error', error: 'persistence unavailable' }); }
      return;
    }
    // Navigation and time need no reply; the throttled instructor refresh still runs.
    this.broadcast(s, true, m.type === 'select' || m.type === 'submitAll' ? a.userId : null);
  }
  // §8.7: option 2 counts only with a pick from this poll's list. A student may change their vote until close.
  async vote(ws, s, a, m) {
    let err = null;
    if (s.phase !== 'POLL' || Date.now() > s.poll.endsAt + GRACE_MS) err = 'poll closed';
    else if (m.option === 2 && !m.questionId) err = 'Pick a question from the list for your vote to count.';
    else if (m.option === 2 && !s.poll.choices.includes(m.questionId)) err = 'not in this poll';
    if (err) { this.send(ws, { type: 'error', error: err }); return; }
    s.poll.votes[a.userId] = m.option === 2 ? { option: 2, questionId: m.questionId } : { option: 1 };
    await this.save(s);
    if (this.allVoted(s)) return this.pollAdvance(s);
    this.broadcast(s, true, a.userId);
  }
  // The last connected student who hasn't voted leaving also completes the poll (§8.7).
  async webSocketClose(ws, code, reason) {
    if (ws.deserializeAttachment()?.role === 'student') {
      const s = await this.state();
      if (s?.phase === 'POLL') await this.pollAdvance(s, ws).catch(() => {});
    }
    ws.close(code, reason);
    if (ws.deserializeAttachment()?.role !== 'admin') return;
    // Presenter gone: take their laser off every student screen.
    const s = await this.state(), item = s?.items[s.index];
    if (item && !this.hidden(s)) for (const peer of this.audience()) try { peer.send(JSON.stringify({ type:'laser', questionId:item.question_id, hide:true })); } catch { /* disconnected */ }
  }
  webSocketError(ws) { ws.close(1011, 'Socket error'); }
}
// BUDGET_TRACE=1 only: one D1 trace per object event (src/budget.js); otherwise a pass-through.
export const LessonRoom = traceDurableObject(faultInjection(Room));
