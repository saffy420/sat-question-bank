// Shared lesson protocol: only these actions exist in task03.
export const GRACE_MS = 750;
export const CODE = /^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{6}$/;
export const ADMIN_ACTIONS = ['start', 'startQuestion', 'addTime', 'endNow', 'next', 'endSession', 'kick', 'lockJoin'];
export const STUDENT_ACTIONS = ['select', 'lock'];
export const MAX_FRAME = 2048;
export function validAction(m, role) {
  if (!m || typeof m !== 'object' || Array.isArray(m) || typeof m.type !== 'string') return false;
  const fields = { ping: ['type', 'sentAt'], start: ['type'], startQuestion: ['type'], addTime: ['type', 'sec'], endNow: ['type'], next: ['type'], endSession: ['type'], kick: ['type', 'userId'], lockJoin: ['type', 'bool'], select: ['type', 'questionId', 'answer'], lock: ['type', 'questionId'] };
  if (!Object.hasOwn(fields, m.type) || Object.keys(m).some(k => !fields[m.type].includes(k))) return false;
  if (m.type !== 'ping' && !(role === 'admin' ? ADMIN_ACTIONS : STUDENT_ACTIONS).includes(m.type)) return false;
  if (m.type === 'ping') return Number.isSafeInteger(m.sentAt) && m.sentAt >= 0;
  if (m.type === 'addTime') return m.sec === 15;
  if (m.type === 'lockJoin') return typeof m.bool === 'boolean';
  if (m.type === 'kick') return typeof m.userId === 'string' && m.userId.length > 0 && m.userId.length <= 128;
  if (m.type === 'select') return typeof m.questionId === 'string' && m.questionId.length <= 64 && typeof m.answer === 'string' && m.answer.length > 0 && m.answer.length <= 32;
  if (m.type === 'lock') return typeof m.questionId === 'string' && m.questionId.length <= 64;
  return true;
}
// Never project by copying a full normalized bank row or choices (trap tags).
export function lessonQuestion(q, reveal = false) {
  return { id: q.id, section: q.section, stem_html: (q.stem_html || '').replace(/<p>\s*(?:<strong>\s*)?Rationale\b[\s\S]*$/i, '').replace(/<blockquote[^>]*>[\s\S]*?<\/blockquote>/gi, ''),
    choices: (q.choices || []).map(c => ({ letter: c.letter, content: c.content || '', img: c.img || '' })), spr: q.spr,
    ...(reveal ? { answer: q.answer, explanation_html: q.explanation_html || '' } : {}) };
}
