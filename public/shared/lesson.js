import { isRight } from './stats.js';

// Shared lesson protocol.
export const GRACE_MS = 750;
export const CODE = /^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{6}$/;
export const ADMIN_ACTIONS = ['start', 'startQuestion', 'addTime', 'endNow', 'next', 'endSession', 'kick', 'lockJoin', 'classResults', 'annotate', 'laser'];
export const STUDENT_ACTIONS = ['select', 'lock'];
export const MAX_FRAME = 2048;
export function validAction(m, role) {
  if (!m || typeof m !== 'object' || Array.isArray(m) || typeof m.type !== 'string') return false;
  const fields = { ping: ['type', 'sentAt'], start: ['type'], startQuestion: ['type'], addTime: ['type', 'sec'], endNow: ['type'], next: ['type'], endSession: ['type'], kick: ['type', 'userId'], lockJoin: ['type', 'bool'], classResults: ['type', 'bool'], annotate: ['type', 'questionId', 'op'], laser: ['type', 'questionId', 'x', 'y', 'a', 'hide'], select: ['type', 'questionId', 'answer'], lock: ['type', 'questionId'] };
  if (!Object.hasOwn(fields, m.type) || Object.keys(m).some(k => !fields[m.type].includes(k))) return false;
  if (m.type !== 'ping' && !(role === 'admin' ? ADMIN_ACTIONS : STUDENT_ACTIONS).includes(m.type)) return false;
  if (m.type === 'ping') return Number.isSafeInteger(m.sentAt) && m.sentAt >= 0;
  // Explicit hide (tool off, pointer left the stage, presenter gone); otherwise a position.
  if (m.type === 'laser') return validId(m.questionId) && (m.hide === true ? !('x' in m) && !('y' in m) && !('a' in m) : !('hide' in m) && anchored(m.a, [m.x, m.y]));
  if (m.type === 'annotate') return validId(m.questionId) && validMark(m.op);
  if (m.type === 'addTime') return m.sec === 15;
  if (m.type === 'lockJoin' || m.type === 'classResults') return typeof m.bool === 'boolean';
  if (m.type === 'kick') return typeof m.userId === 'string' && m.userId.length > 0 && m.userId.length <= 128;
  // An empty answer clears the selection (a struck-out choice deselects itself).
  if (m.type === 'select') return typeof m.questionId === 'string' && m.questionId.length <= 64 && typeof m.answer === 'string' && m.answer.length <= 32;
  if (m.type === 'lock') return typeof m.questionId === 'string' && m.questionId.length <= 64;
  return true;
}
const validId = x => typeof x === 'string' && x.length > 0 && x.length <= 64;
const unit = x => typeof x === 'number' && Number.isFinite(x) && x >= 0 && x <= 1;
// Pointer anchors (see annotations.js): glyph anchors carry px offsets, element anchors fractions of
// the element (a stroke may leave it), no anchor means fractions of the whole card.
const NODE = /^(?:[ps]:\d{1,4}|c:[A-D])$/;
const within = (lo, hi) => x => typeof x === 'number' && Number.isFinite(x) && x >= lo && x <= hi;
function anchored(a, values) {
  if (a === undefined) return values.every(unit);
  if (typeof a !== 'string' || a.length > 16) return false;
  const [node, offset, extra] = a.split('@');
  if (offset !== undefined) return extra === undefined && NODE.test(node) && /^\d{1,5}$/.test(offset) && values.every(within(-4000, 4000));
  return (NODE.test(a) || /^(?:i:\d{1,2}|P|Q)$/.test(a)) && values.every(within(-4, 5));
}
export function validMark(op) {
  if (!op || typeof op !== 'object' || Array.isArray(op) || !['highlight','strike','stroke','erase','clear'].includes(op.type)) return false;
  const fields = { highlight:['type','id','nodeId','startOffset','endOffset','color'], strike:['type','id','nodeId','startOffset','endOffset','color'], stroke:['type','id','points','color','a'], erase:['type','id'], clear:['type'] };
  if (Object.keys(op).some(k => !fields[op.type].includes(k))) return false;
  if (op.type === 'clear') return true;
  if (!validId(op.id)) return false;
  if (op.type === 'erase') return true;
  if (!['#ffe066','#ff7676','#75dbaa'].includes(op.color)) return false;
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
export function lessonQuestion(q, reveal = false) {
  return { id: q.id, section: q.section, stem_html: (q.stem_html || '').replace(/<p>\s*(?:<strong>\s*)?Rationale\b[\s\S]*$/i, '').replace(/<blockquote[^>]*>[\s\S]*?<\/blockquote>/gi, ''),
    choices: (q.choices || []).map(c => ({ letter: c.letter, content: c.content || '', img: c.img || '' })), spr: q.spr,
    ...(reveal ? { answer: q.answer, explanation_html: q.explanation_html || '' } : {}) };
}
