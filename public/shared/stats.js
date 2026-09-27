// Shared by student dashboard/focus and admin Worker. Inputs never read global account state.
const MOJIBAKE = [
  ['\u0393\u00ea\u00c6', '\u2212'], ['\u0393\u00e5\u00c6', '\u2192'], ['\u0393\u00ea\u00dc', '\u221a'],
  ['\u0393\u00c7\u00f6', '\u2014'], ['\u0393\u00c7\u00f4', '\u2013'], ['\u0393\u00c7\u00d6', '\u2019'],
  ['\u0393\u00c7\u00a3', '\u201c'], ['\u0393\u00c7\u00a5', '\u201d'], ['\u0393\u00c7\u00aa', '\u2026'],
  ['\u0393\u00eb\u00f1', '\u2264'], ['\u0393\u00eb\u00d1', '\u2265'], ['\u0393\u00eb\u00e1', '\u2260'],
  ['\u0393\u00eb\u00ea', '\u2248'], ['\u00a4\u00c7', '\u03c0'], ['\u251c\u00f9', '\u00d7'],
  ['\u252c\u00b0', '\u00b0'], ['\u252c\u2557', '\u00b7'], ['\u252c\u2593', '\u00b2']
];
// Every mojibake sequence starts with one of these characters; text without them is returned as is.
const MOJIBAKE_LEAD = /[\u0393\u00a4\u251c\u252c]/;
export const demoji = h => typeof h === 'string' && !MOJIBAKE_LEAD.test(h) ? h : MOJIBAKE.reduce((a, [bad, good]) => a.split(bad).join(good), h || '');
export const levelOf = q => q.level || ({ easy: 1, medium: 2, hard: 3 })[String(q.difficulty || '').toLowerCase()] || 2;
export const TARGET_MS = { Math: 95000, 'Reading & Writing': 71000 };
export const targetOf = q => TARGET_MS[q.section] || 85000;
export const DOM_ORDER = ['Information and Ideas', 'Craft and Structure', 'Expression of Ideas', 'Standard English Conventions',
  'Algebra', 'Advanced Math', 'Problem-Solving and Data Analysis', 'Geometry and Trigonometry'];
export const SKILL_ORDER = ['Central Ideas and Details', 'Inferences', 'Command of Evidence', 'Words in Context',
  'Text Structure and Purpose', 'Cross-Text Connections', 'Rhetorical Synthesis', 'Transitions', 'Boundaries',
  'Form, Structure, and Sense', 'Linear equations in one variable', 'Linear functions', 'Linear equations in two variables',
  'Systems of two linear equations in two variables', 'Linear inequalities in one or two variables', 'Equivalent expressions',
  'Nonlinear equations in one variable', 'Nonlinear functions', 'Ratios, rates, proportional relationships, and units',
  'Percentages', 'One-variable data: Distributions and measures of center and spread',
  'Two-variable data: Models and scatterplots', 'Probability and conditional probability',
  'Inference from sample statistics and margin of error', 'Evaluating statistical claims: Observational studies and experiments',
  'Area and volume', 'Lines, angles, and triangles', 'Right triangles and trigonometry', 'Circles'];
const cbIdx = k => { const i = DOM_ORDER.indexOf(k), j = SKILL_ORDER.indexOf(k); return i >= 0 ? i : j >= 0 ? 100 + j : 1e9; };
export const cbSort = list => list.slice().sort((a, b) => cbIdx(a) - cbIdx(b) || a.localeCompare(b));
export const everWrong = (progress, id) => ['Red', 'Orange'].includes(progress[id]?.marker);
export function weakness(list, progress) {
  const acc = new Map(), byId = new Map();
  list.forEach(q => { const k = q.skill || 'Other'; if (!acc.has(k)) acc.set(k, { a: 0, m: 0 }); byId.set(q.id, k); });
  Object.entries(progress).forEach(([id, p]) => {
    const k = byId.get(id); if (!k || !p.attempts) return;
    const v = acc.get(k); v.a += p.attempts; v.m += p.attempts - (p.corrects || 0);
  });
  const out = new Map();
  acc.forEach((v, k) => out.set(k, (v.m + 1) / (v.a + 2)));
  return out;
}
export function tally(list, progress) {
  const byId = new Map(list.map(q => [q.id, q]));
  const t = { att: 0, corr: 0, ms: 0, sec: {}, dom: {}, skill: {} };
  const b = (m, k) => (m[k] = m[k] || { a: 0, c: 0, n: 0 });
  byId.forEach(q => { b(t.sec, q.section || 'Other').n++; b(t.dom, q.domain || 'Other').n++; b(t.skill, q.skill || 'Other').n++; });
  Object.entries(progress).forEach(([id, p]) => {
    const q = byId.get(id); if (!q || !p.attempts) return;
    const right = p.marker === 'Green' || p.marker === 'Orange';
    t.att++; if (right) t.corr++; t.ms += p.time_taken_ms || 0;
    [b(t.sec, q.section || 'Other'), b(t.dom, q.domain || 'Other'), b(t.skill, q.skill || 'Other')]
      .forEach(x => { x.a++; if (right) x.c++; });
  });
  return t;
}
export function trapExamples(questions, log) {
  const byId = new Map(questions.map(q => [q.id, q]));
  const out = {};
  log.forEach(x => {
    if (x.correct || !x.picked) return;
    const q = byId.get(x.question_id);
    const c = q?.choices?.find(c => c.letter === x.picked);
    if (c?.trap) { const v = out[c.trap] ||= { count: 0, examples: [] }; v.count++; if (!v.examples.includes(q.id)) v.examples.push(q.id); }
  });
  return Object.entries(out).sort((a, b) => b[1].count - a[1].count || a[0].localeCompare(b[0]));
}
export const trapCounts = (qs, log) => trapExamples(qs, log).map(([k, v]) => [k, v.count]);
export function pacing(qs, log) {
  const byId = new Map(qs.map(q => [q.id, q]));
  const out = { rushed: 0, onPace: 0, slow: 0, ms: {}, n: {} };
  log.forEach(x => {
    const q = byId.get(x.question_id); if (!q || !x.time_taken_ms) return;
    const r = x.time_taken_ms / targetOf(q);
    out[r < 0.6 ? 'rushed' : r > 1.4 ? 'slow' : 'onPace']++;
    out.ms[q.section] = (out.ms[q.section] || 0) + x.time_taken_ms;
    out.n[q.section] = (out.n[q.section] || 0) + 1;
  });
  return out;
}
export function guessing(log) {
  const seen = log.filter(x => x.changes != null);
  const tot = seen.reduce((n, x) => n + (x.changes | 0), 0);
  const ch = seen.filter(x => (x.changes | 0) > 0), st = seen.filter(x => !(x.changes | 0));
  const acc = l => l.length ? Math.round(l.filter(x => x.correct).length / l.length * 100) : null;
  return { mean: seen.length ? tot / seen.length : 0, n: seen.length,
    changedAcc: acc(ch), steadyAcc: acc(st), changedN: ch.length };
}
export function isRight(q, val) {
  if (!val || val === 'TIMEOUT') return false;
  const a = String(q.answer || '').trim().toUpperCase();
  if (!a) return null;
  if (q.spr) {
    const clean = s => String(s).toUpperCase().replace(/[\s,$]/g, '');
    const num = s => { const m = /^(-?[0-9]+(?:\.[0-9]+)?)\/(-?[0-9]+(?:\.[0-9]+)?)$/.exec(s); return m ? Number(m[1]) / Number(m[2]) : parseFloat(s); };
    const vv = clean(val), vf = num(vv), dp = (vv.split('.')[1] || '').length;
    return a.split(/\s+OR\s+|,/).map(clean).filter(Boolean).some(av => {
      const af = num(av);
      if (isNaN(af) || isNaN(vf)) return av === vv;
      if (Math.abs(af - vf) < 1e-9) return true;
      // ponytail: grid precision proxy; use explicit grid width if model ever stores one.
      if (dp < 3) return false;
      const f = Math.pow(10, dp);
      return Math.round(af * f) / f === vf || Math.trunc(af * f) / f === vf;
    });
  }
  if (!q.choices.some(c => String(c.letter || '').trim().toUpperCase() === a)) return null;
  return a === String(val).trim().toUpperCase();
}
// The record moves once per graded question: Red is wrong, Orange is right after a Red,
// Green is right. Practice, exams and the self-paced lesson write-back all go through here.
export function nextProgress(prev, questionId, ok, now, ms) {
  const p = { ...(prev || { question_id: questionId, attempts: 0, corrects: 0 }) };
  p.attempts = (p.attempts | 0) + 1;
  p.corrects = (p.corrects | 0) + (ok === true ? 1 : 0);
  p.marker = ok === true ? (p.marker === 'Red' ? 'Orange' : 'Green') : 'Red';
  p.last_reviewed = now;
  p.time_taken_ms = ms;
  return p;
}
export function attemptRow(questionId, ok, now, ms, picked, changes, history) {
  const ev = { question_id: questionId, ts: now, correct: ok === true ? 1 : 0, time_taken_ms: ms,
    picked: String(picked == null ? '' : picked).slice(0, 32), changes: changes | 0 };
  if (history?.length) ev.answer_history_json = JSON.stringify(history);
  return ev;
}
export function normalizeQuestion(q) {
  let choices; try { choices = typeof q.choices_json === 'string' ? JSON.parse(q.choices_json) : (q.choices_json || []); if (!Array.isArray(choices)) choices = []; } catch { choices = []; }
  choices.forEach((c, i) => { if (!String(c.letter ?? '').trim()) c.letter = 'ABCD'[i] || String(i + 1); });
  // JSON text can only start with one of these after JSON whitespace; anything else would throw, so it
  // takes the same fallback without a thrown exception per question.
  let answer;
  if (typeof q.correct_answer === 'string' && !/^[\t\n\r ]*[-[{"0-9tfn]/.test(q.correct_answer)) answer = q.correct_answer || '';
  else try { const a = typeof q.correct_answer === 'string' ? JSON.parse(q.correct_answer) : (q.correct_answer || []); answer = Array.isArray(a) ? a.join('') : String(a); } catch { answer = q.correct_answer || ''; }
  answer = String(answer || '').replace(/\\u([0-9a-f]{4})/gi, (_, hex) => String.fromCharCode(parseInt(hex, 16)));
  answer = demoji(answer);
  const spr = !choices.length;
  if (!spr) { const m = answer.match(/^\s*([A-D])\s*[\u2014\u2013-]\s*\S/); if (m) answer = m[1]; }
  if (!answer && spr) {
    const t = (q.explanation_html || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
    const m = t.match(/correct answer is\s*:?\s*(?:either\s+)?(\.?[0-9][0-9.\/]*(?:\s*,?\s*(?:or|and)\s*\.?[0-9][0-9.\/]*|\s*,\s*\.?[0-9][0-9.\/]*)*)/i)
      || t.match(/Note that\s+(\.?[0-9][0-9.\/]*(?:\s*,?\s*(?:or|and)\s*\.?[0-9][0-9.\/]*|\s*,\s*\.?[0-9][0-9.\/]*)*)\s+are examples of ways to enter a correct answer/i);
    const alts = m ? (m[1].match(/\.?[0-9][0-9.\/]*/g) || []).map(x => x.replace(/\.$/, '')) : [];
    if (alts.length) answer = alts.join(' or ');
  }
  choices.forEach(c => { if (c.content) c.content = demoji(c.content); });
  return { ...q, choices, answer, spr, ai: q.source === 'AI', level: levelOf(q) };
}
export function direction(q, row) {
  if (!row.answer_history_json) return 'unknown';
  let history; try { history = JSON.parse(row.answer_history_json); } catch { return 'unknown'; }
  if (!Array.isArray(history) || !history.length || !history.every(v => v && typeof v.answer === 'string') ||
      history.at(-1).answer !== row.picked || !history[0].answer) return 'unknown';
  const first = isRight(q, history[0].answer), last = isRight(q, history.at(-1).answer);
  if (first == null || last == null) return 'unknown';
  return first === last ? 'unchanged' : first ? 'right-to-wrong' : 'wrong-to-right';
}
export function breakdown(qs, progress, log) {
  const t = tally(qs, progress), byId = new Map(qs.map(q => [q.id, q]));
  const diff = {}, level = {}, skills = {}, paceDiff = {}, trends = {}, paceSection = {};
  for (const q of qs) skills[q.skill || 'Other'] ||= { ...t.skill[q.skill || 'Other'], ms: 0, timed: 0, trend: [] };
  for (const x of log) {
    const q = byId.get(x.question_id); if (!q || x.correct == null) continue;
    for (const [map, key] of [[diff, q.difficulty || 'Unknown'], [level, levelOf(q)]]) {
      const v = map[key] ||= { a: 0, c: 0 }; v.a++; if (x.correct) v.c++;
    }
    const sk = skills[q.skill || 'Other'];
    (trends[q.skill || 'Other'] ||= []).push({ ts: x.ts, correct: x.correct });
    if (x.time_taken_ms > 0) {
      sk.ms += x.time_taken_ms; sk.timed++;
      const v = paceDiff[q.difficulty || 'Unknown'] ||= { ms: 0, target: 0, n: 0 };
      v.ms += x.time_taken_ms; v.target += targetOf(q); v.n++;
      const sec = paceSection[q.section] ||= { ms: 0, target: 0, n: 0 };
      sec.ms += x.time_taken_ms; sec.target += targetOf(q); sec.n++;
    }
  }
  Object.entries(skills).forEach(([k, v]) => { v.trend = (trends[k] || []).sort((a, b) => a.ts.localeCompare(b.ts)).map(x => x.correct); v.avgMs = v.timed ? v.ms / v.timed : null; });
  return { tally: t, diff, level, skills, paceDiff, paceSection, pacing: pacing(qs, log), traps: trapExamples(qs, log),
    guessing: guessing(log), lastActive: log.reduce((max, x) => x.ts > max ? x.ts : max, '') || null };
}
