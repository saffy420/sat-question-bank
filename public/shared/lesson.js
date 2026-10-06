import { isRight } from './stats.js';

// Shared lesson protocol.
export const GRACE_MS = 750;
export const CODE = /^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{6}$/;
export const ADMIN_ACTIONS = ['start', 'startQuestion', 'addTime', 'endNow', 'next', 'endSession', 'kick', 'lockJoin', 'classResults', 'annotate', 'laser', 'desmos', 'startPoll', 'goto', 'eliminate', 'view', 'draft'];
export const STUDENT_ACTIONS = ['select', 'lock', 'navigate', 'time', 'submitAll', 'vote'];
// Review polls (§8.7): 30 s to vote, then the result stays on screen for 3 s.
export const POLL_MS = 30000;
export const RESULT_MS = 3000;
export const MAX_FRAME = 2048;
// Desmos getState() is instructor-only and far larger than any other frame.
export const MAX_DESMOS_BYTES = 48 * 1024;
export const MAX_DESMOS_FRAME = MAX_DESMOS_BYTES + 256;
export function validAction(m, role) {
  if (!m || typeof m !== 'object' || Array.isArray(m) || typeof m.type !== 'string') return false;
  const fields = { ping: ['type', 'sentAt'], start: ['type'], startQuestion: ['type'], addTime: ['type', 'sec'], endNow: ['type'], next: ['type'], endSession: ['type'], kick: ['type', 'userId'], lockJoin: ['type', 'bool'], classResults: ['type', 'bool'], annotate: ['type', 'questionId', 'op'], laser: ['type', 'questionId', 'x', 'y', 'a', 'hide'], desmos: ['type', 'questionId', 'state'], select: ['type', 'questionId', 'answer'], lock: ['type', 'questionId'], navigate: ['type', 'questionId'], time: ['type', 'questionId', 'deltaMs', 'seq'], submitAll: ['type'], startPoll: ['type'], goto: ['type', 'questionId'], vote: ['type', 'option', 'questionId'], eliminate: ['type', 'questionId', 'letter', 'on'], view: ['type', 'w', 'fs', 'u', 'vw'], draft: ['type', 'questionId', 'op'] };
  if (!Object.hasOwn(fields, m.type) || Object.keys(m).some(k => !fields[m.type].includes(k))) return false;
  if (m.type !== 'ping' && !(role === 'admin' ? ADMIN_ACTIONS : STUDENT_ACTIONS).includes(m.type)) return false;
  if (m.type === 'ping') return Number.isSafeInteger(m.sentAt) && m.sentAt >= 0;
  // Explicit hide (tool off, pointer left the stage, presenter gone); otherwise a position.
  if (m.type === 'laser') return validId(m.questionId) && (m.hide === true ? !('x' in m) && !('y' in m) && !('a' in m) : !('hide' in m) && anchored(m.a, [m.x, m.y]));
  if (m.type === 'annotate') return validId(m.questionId) && validMark(m.op);
  // A text box being typed (live-mathtype): the box so far under its final id, or an erase of that id when the
  // editor closes without committing. Drafts live in the room's memory only, never in storage or D1.
  if (m.type === 'draft') return validId(m.questionId) && validMark(m.op) && (m.op.type === 'text' || m.op.type === 'erase');
  if (m.type === 'desmos') return validId(m.questionId) && (m.state === null || validDesmos(m.state));
  // The instructor crosses a choice out (on: true) or restores it (on: false) for the whole class.
  if (m.type === 'eliminate') return validId(m.questionId) && typeof m.letter === 'string' && /^[A-D]$/.test(m.letter) && typeof m.on === 'boolean';
  // Presenter fit (live-fit): the presenter's stage width, question type and chrome unit in CSS px, and its
  // viewport width (the stage's vw-based paddings), so revealed students lay the stage out exactly as it does.
  if (m.type === 'view') return Number.isSafeInteger(m.w) && m.w >= 320 && m.w <= 4000 && within(10, 40)(m.fs) && within(8, 30)(m.u) && within(320, 8000)(m.vw);
  if (m.type === 'addTime') return m.sec === 15;
  if (m.type === 'lockJoin' || m.type === 'classResults') return typeof m.bool === 'boolean';
  if (m.type === 'kick') return typeof m.userId === 'string' && m.userId.length > 0 && m.userId.length <= 128;
  // An empty answer clears the selection (a struck-out choice deselects itself).
  if (m.type === 'select') return typeof m.questionId === 'string' && m.questionId.length <= 64 && typeof m.answer === 'string' && m.answer.length <= 32;
  if (m.type === 'lock') return typeof m.questionId === 'string' && m.questionId.length <= 64;
  if (m.type === 'navigate' || m.type === 'goto') return validId(m.questionId);
  // Option 2 names the dropdown pick; option 1 carries none.
  if (m.type === 'vote') return m.option === 1 ? !Object.hasOwn(m, 'questionId') : m.option === 2 && (m.questionId === undefined || validId(m.questionId));
  // seq is the replay key for a time segment (G5): the room ignores any seq it has already accepted.
  if (m.type === 'time') return validId(m.questionId) && Number.isSafeInteger(m.deltaMs) && m.deltaMs >= 0 && m.deltaMs <= 3 * 3600 * 1000 && Number.isSafeInteger(m.seq) && m.seq > 0;
  return true;
}
const validId = x => typeof x === 'string' && x.length > 0 && x.length <= 64;
export function validDesmos(state) {
  if (!state || typeof state !== 'object' || Array.isArray(state)) return false;
  try { return new TextEncoder().encode(JSON.stringify(state)).length <= MAX_DESMOS_BYTES; } catch { return false; }
}
const unit = x => typeof x === 'number' && Number.isFinite(x) && x >= 0 && x <= 1;
// Pointer anchors (see annotations.js): glyph anchors carry em offsets ('~') or px offsets ('@', marks saved
// before em anchors), element anchors fractions of the element (a stroke may leave it), no anchor means
// fractions of the whole card.
const NODE = /^(?:[ps]:\d{1,4}|c:[A-D])$/;
const within = (lo, hi) => x => typeof x === 'number' && Number.isFinite(x) && x >= lo && x <= hi;
const GLYPH = /^([^@~]+)([@~])(\d{1,5})$/;
function anchored(a, values) {
  if (a === undefined) return values.every(unit);
  if (typeof a !== 'string' || a.length > 16) return false;
  const glyph = GLYPH.exec(a);
  if (glyph) return NODE.test(glyph[1]) && values.every(glyph[2] === '~' ? within(-400, 400) : within(-4000, 4000));
  return (NODE.test(a) || /^(?:i:\d{1,2}|P|Q)$/.test(a)) && values.every(within(-4, 5));
}
// TeX in a math box or a math edit: one line, at most MAX_TEX bytes as JSON, so its frame stays under MAX_FRAME.
export const MAX_TEX = 1400;
const validTex = tex => typeof tex === 'string' && tex.trim().length > 0 && !/[\u0000-\u001f]/.test(tex) && new TextEncoder().encode(JSON.stringify(tex)).length <= MAX_TEX;
export function validMark(op) {
  if (!op || typeof op !== 'object' || Array.isArray(op) || !['highlight','strike','stroke','erase','clear','text','edit','edit-math'].includes(op.type)) return false;
  const fields = { highlight:['type','id','nodeId','startOffset','endOffset','color'], strike:['type','id','nodeId','startOffset','endOffset','color'], stroke:['type','id','points','color','a'], erase:['type','id'], clear:['type'], text:['type','id','a','x','y','text','tex','color'], edit:['type','id','nodeId','i','text'], 'edit-math':['type','id','nodeId','k','tex'] };
  if (Object.keys(op).some(k => !fields[op.type].includes(k))) return false;
  if (op.type === 'clear') return true;
  if (!validId(op.id)) return false;
  if (op.type === 'erase') return true;
  // Live text fix: text node `i` of a block (counted on the clean block, KaTeX excluded) becomes `text`.
  // One mark per text node, so the id names it; 1500 chars keeps the frame under MAX_FRAME.
  if (op.type === 'edit') return typeof op.nodeId === 'string' && NODE.test(op.nodeId) && Number.isSafeInteger(op.i) && op.i >= 0 && op.i <= 999
    && typeof op.text === 'string' && op.text.length <= 1500 && op.id === `edit:${op.nodeId}:${op.i}`;
  // Live math fix: formula `k` of a block (its k-th top-level .katex) is re-rendered from `tex`.
  if (op.type === 'edit-math') return typeof op.nodeId === 'string' && NODE.test(op.nodeId) && Number.isSafeInteger(op.k) && op.k >= 0 && op.k <= 99
    && validTex(op.tex) && op.id === `edit-math:${op.nodeId}:${op.k}`;
  if (!['#ffe066','#ff7676','#75dbaa'].includes(op.color)) return false;
  // A typed box, placed like one pen point (em or fraction anchor): either text (1-280 characters on at most
  // 6 lines) or math (`tex`, drawn with KaTeX), never both.
  if (op.type === 'text') return anchored(op.a, [op.x, op.y]) && ('tex' in op ? !('text' in op) && validTex(op.tex)
    : typeof op.text === 'string' && op.text.trim().length > 0 && op.text.length <= 280 && op.text.split('\n').length <= 6);
  if (op.type === 'stroke') return Array.isArray(op.points) && op.points.length >= 1 && op.points.length <= 32 && op.points.every(p => Array.isArray(p) && p.length === 2 && anchored(op.a, p));
  return /^([ps]:\d+|c:[A-D])$/.test(op.nodeId) && Number.isSafeInteger(op.startOffset) && Number.isSafeInteger(op.endOffset) && op.startOffset >= 0 && op.endOffset > op.startOffset && op.endOffset <= 20000;
}
// Never project by copying a full normalized bank row or choices (trap tags).
// Exact parsed numeric values share a bucket; grading still uses isRight unchanged.
export function responseGroups(q, responses) {
  const groups = new Map();
  const numeric = text => {
    const v = String(text).replace(/[\s,$]/g, '');
    const m = /^(-?(?:\d+(?:\.\d*)?|\.\d+))(?:\/(-?(?:\d+(?:\.\d*)?|\.\d+)))?$/.exec(v);
    if (!m) return null;
    const n = Number(m[1]) / (m[2] === undefined ? 1 : Number(m[2]));
    return Number.isFinite(n) ? String(n) : null;
  };
  for (const [userId, r] of Object.entries(responses)) {
    const answer = r?.answer || '';
    const value = q.spr && answer ? numeric(answer) : null;
    const key = !answer ? 'blank' : q.spr ? value ?? answer.trim() : answer;
    const group = groups.get(key) || { key, label: !answer ? 'blank' : value ?? answer, count: 0, correct: answer ? isRight(q, answer) : false, users: [] };
    group.count++;
    group.users.push({ userId, ms: r?.ms ?? null });
    groups.set(key, group);
  }
  if (!q.spr) for (const c of q.choices) if (!groups.has(c.letter)) groups.set(c.letter, { key: c.letter, label: c.letter, count: 0, correct: isRight(q, c.letter), users: [] });
  if (!groups.has('blank')) groups.set('blank', { key: 'blank', label: 'blank', count: 0, correct: false, users: [] });
  const sorted = [...groups.values()].sort((a,b) => q.spr ? b.count-a.count || a.label.localeCompare(b.label) : a.key === 'blank' ? 1 : b.key === 'blank' ? -1 : q.choices.findIndex(c => c.letter === a.key) - q.choices.findIndex(c => c.letter === b.key));
  if (q.spr && sorted.length > 7) {
    const keep = sorted.slice(0,6);
    const correct = sorted.slice(6).find(g => g.correct);
    if (correct) keep.push(correct);
    const other = sorted.filter(g => !keep.includes(g));
    keep.push({ key: 'other', label: 'other', count: other.reduce((n,g) => n+g.count,0), correct: false, users: other.flatMap(g => g.users) });
    return keep;
  }
  return sorted;
}
// Self-paced late join (§8.2): longest first (ties: Hard > Medium > Easy, then lesson
// position), take whatever still fits the remaining clock, return in lesson order.
const RANK = { Hard: 3, Medium: 2, Easy: 1 };
export function lateJoinSet(items, remainingMs, difficultyOf = () => '') {
  const order = items.map((item, position) => ({ item, position }))
    .sort((a, b) => b.item.time_limit_sec - a.item.time_limit_sec || (RANK[difficultyOf(b.item)] || 0) - (RANK[difficultyOf(a.item)] || 0) || a.position - b.position);
  let budget = remainingMs;
  const chosen = new Set();
  for (const { item, position } of order) if (item.time_limit_sec * 1000 <= budget) { budget -= item.time_limit_sec * 1000; chosen.add(position); }
  return items.filter((_, position) => chosen.has(position)).map(item => item.question_id);
}
// Finished self-paced set (§8.6): the single source for the overview and the poll's most-missed.
// Only assigned students count toward a question; a blank on a scorable question is wrong (G3);
// an unscorable question is never right or wrong.
const scorable = q => isRight(q, '?') !== null;
export function setResults({ items, questions, assigned, responses }) {
  const perQuestion = Object.fromEntries(items.map(x => [x.question_id, { questionId: x.question_id, assigned: 0, answered: 0, wrong: 0, right: 0 }]));
  const students = {};
  for (const [userId, ids] of Object.entries(assigned)) {
    if (!responses[userId]) continue;
    const row = students[userId] = { assigned: ids.length, scorable: 0, right: 0, answered: 0, ms: 0 };
    for (const id of ids) {
      const q = questions[id], p = perQuestion[id], r = responses[userId][id] || {};
      if (!q || !p) continue;
      p.assigned++; row.ms += r.ms || 0;
      if (r.answer) { p.answered++; row.answered++; }
      if (!scorable(q)) continue;
      row.scorable++;
      if (isRight(q, r.answer || null)) { p.right++; row.right++; } else p.wrong++;
    }
  }
  const scores = Object.values(students).filter(x => x.assigned && x.scorable).map(x => x.right / x.scorable).sort((a, b) => a - b);
  const mid = scores.length >> 1;
  return { students, questions: items.map(x => perQuestion[x.question_id]),
    mean: scores.length ? scores.reduce((n, x) => n + x, 0) / scores.length : null,
    median: scores.length ? scores.length % 2 ? scores[mid] : (scores[mid - 1] + scores[mid]) / 2 : null,
    takers: Object.values(students).filter(x => x.assigned).length,
    completed: Object.values(students).filter(x => x.assigned && x.answered === x.assigned).length };
}
// Most wrong first; ties keep lesson order. Reviewed questions are left out.
export function mostMissed(results, reviewed = []) {
  return results.questions.filter(x => !reviewed.includes(x.questionId)).map((x, i) => ({ x, i })).sort((a, b) => b.x.wrong - a.x.wrong || a.i - b.i).map(({ x }) => x);
}
// §8.7: option 2 must win outright, otherwise most-missed. Among dropdown picks: most picked,
// then more students wrong, then lesson order.
export function pollWinner({ votes, mostMissed: missed, wrong, order }) {
  const all = Object.values(votes);
  const two = all.filter(v => v.option === 2 && v.questionId);
  if (two.length <= all.length - two.length) return missed;
  const picks = {};
  for (const v of two) picks[v.questionId] = (picks[v.questionId] || 0) + 1;
  return Object.keys(picks).sort((a, b) => picks[b] - picks[a] || (wrong[b] || 0) - (wrong[a] || 0) || order.indexOf(a) - order.indexOf(b))[0];
}
// 11b instructor navigator: a plain-text lead-in for each question (admin snapshots only).
export function stemSnippet(html, max = 90) {
  const text = String(html || '').replace(/<(script|style)\b[\s\S]*?<\/\1>|<h3>\s*Prompt\s*<\/h3>/gi, ' ').replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/g, ' ').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&')
    .replace(/\\[()[\]]/g, '').replace(/\s+/g, ' ').trim();
  return text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text;
}
export function lessonQuestion(q, reveal = false) {
  return { id: q.id, section: q.section, stem_html: (q.stem_html || '').replace(/<p>\s*(?:<strong>\s*)?Rationale\b[\s\S]*$/i, '').replace(/<blockquote[^>]*>[\s\S]*?<\/blockquote>/gi, ''),
    choices: (q.choices || []).map(c => ({ letter: c.letter, content: c.content || '', img: c.img || '' })), spr: q.spr,
    ...(reveal ? { answer: q.answer, explanation_html: q.explanation_html || '' } : {}) };
}
// §2 usedInLesson: the questions a session actually put in front of students. Instructor-paced
// shows items 0..reached (the furthest opened, 11b; the navigator can be back on an earlier one)
// once it leaves the lobby; self-paced shows every assigned set.
export function shownQuestionIds(s) {
  if (s.status === 'lobby' || !s.startedAt) return [];
  if (s.mode !== 'self') return s.items.slice(0, Math.max(s.reached ?? 0, s.index) + 1).map(x => x.question_id);
  const shown = new Set(Object.values(s.assigned || {}).flat());
  return s.items.map(x => x.question_id).filter(id => shown.has(id));
}
// §9.2 "Lesson questions": one three-option control, shared by the student bank and the builder.
export const USAGE_MODES = ['show-all', 'hide-attended', 'hide-all'];
export function lessonUsageVisible(used, mode, attended) {
  if (mode === 'hide-all') return !used?.length;
  if (mode === 'hide-attended') return !used?.some(id => attended.has(id));
  return true;
}
// A student's session score: right over scorable (is_correct null = unscorable, left out).
export function lessonScore(rows) {
  const scored = rows.filter(r => r.is_correct != null);
  return { right: scored.filter(r => r.is_correct === 1).length, scorable: scored.length };
}
