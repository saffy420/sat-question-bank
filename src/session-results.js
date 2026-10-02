import { normalizeQuestion, isRight } from '../public/shared/stats.js';
import { responseGroups, stemSnippet } from '../public/shared/lesson.js';
import { padSessionId } from './record.js';

// GET /api/admin/sessions/:id/results — one ended session for the instructor: who joined, each
// student's score and per-question rows, and per question the class counts plus the instructor's
// explain/answer time (lesson_sessions.timing_json, NULL for sessions from before it existed).
// A fixed handful of reads, whatever the class size: the session, participants, responses, shown
// questions, and the questions from both banks (50 IDs per read).
const parse = (text, fallback) => { try { return text ? JSON.parse(text) : fallback; } catch { return fallback; } };
const msOf = sqlTime => sqlTime ? Date.parse(sqlTime.replace(' ', 'T') + 'Z') : NaN;

export async function sessionResults(db, aiDb, sessionId) {
  const s = await db.prepare(`SELECT id, lesson_id, join_code, status, created_at, started_at, ended_at, snapshot_json, timing_json
    FROM lesson_sessions WHERE id = ?`).bind(sessionId).first();
  if (!s) return { status: 404, body: { error: 'not found' } };
  if (s.status !== 'ended') return { status: 409, body: { error: 'session still running' } };
  const frozen = parse(s.snapshot_json, {}), items = Array.isArray(frozen.items) ? frozen.items : [];
  const timing = parse(s.timing_json, null);
  const ids = items.map(x => x.question_id);
  const cols = 'id,section,difficulty,skill,stem_html,choices_json,correct_answer,explanation_html,source';
  // D1 caps bound parameters per statement, so the bank reads go 50 IDs at a time.
  const read = async bankDb => (await Promise.all(Array.from({ length: Math.ceil(ids.length / 50) }, (_, i) => ids.slice(i * 50, i * 50 + 50))
    .map(part => bankDb.prepare(`SELECT ${cols} FROM questions WHERE id IN (${part.map(() => '?').join(',')})`).bind(...part).all())))
    .flatMap(r => r.results || []);
  const [people, responses, usage, core, ai] = await Promise.all([
    db.prepare(`SELECT p.user_id, p.joined_at, p.left_at, p.assigned_question_ids_json, u.name, u.email
      FROM session_participants p LEFT JOIN users u ON u.id = p.user_id WHERE p.session_id = ? ORDER BY p.joined_at, p.user_id`).bind(sessionId).all(),
    db.prepare(`SELECT user_id, question_id, final_answer, is_correct, locked_early, time_spent_ms, answer_changes
      FROM session_responses WHERE session_id = ?`).bind(sessionId).all(),
    db.prepare('SELECT question_id FROM question_lesson_usage WHERE session_id = ?').bind(sessionId).all(),
    read(db), read(aiDb)]);
  const bank = new Map([...ai, ...core].map(r => [r.id, r]));
  const rows = responses.results || [];
  const byUser = new Map();
  for (const r of rows) (byUser.get(r.user_id) || byUser.set(r.user_id, new Map()).get(r.user_id)).set(r.question_id, r);
  // Shown questions (§2 usage, written with the end); sessions without usage rows fall back to answered ones.
  const shown = new Set((usage.results || []).map(r => r.question_id));
  if (!shown.size) for (const r of rows) shown.add(r.question_id);
  const self = frozen.mode === 'self';

  const questions = items.map((item, i) => {
    const raw = bank.get(item.question_id), q = raw ? normalizeQuestion(raw) : null;
    const taken = rows.filter(r => r.question_id === item.question_id);
    const times = taken.map(r => r.time_spent_ms || 0);
    const t = timing?.[item.question_id];
    return { questionId: item.question_id, number: i + 1, shown: shown.has(item.question_id),
      section: raw?.section || '', skill: raw?.skill || '', difficulty: raw?.difficulty || '', correctAnswer: q?.answer || '',
      scorable: q ? isRight(q, '?') !== null : false, snippet: q ? stemSnippet(q.stem_html) : '',
      notes: stemSnippet(item.notes || '', 140),
      explainMs: Number.isFinite(t?.explainMs) ? t.explainMs : null, answerMs: Number.isFinite(t?.answerMs) ? t.answerMs : null,
      right: taken.filter(r => r.is_correct === 1).length, wrong: taken.filter(r => r.is_correct === 0 && r.final_answer).length,
      blank: taken.filter(r => !r.final_answer).length, responses: taken.length,
      avgMs: times.length ? Math.round(times.reduce((n, x) => n + x, 0) / times.length) : null,
      distribution: q ? responseGroups(q, Object.fromEntries(taken.map(r => [r.user_id, { answer: r.final_answer }])))
        .map(g => ({ label: g.label, count: g.count, correct: g.correct })) : [] };
  });

  const students = (people.results || []).map(p => {
    const own = byUser.get(p.user_id) || new Map();
    const assigned = parse(p.assigned_question_ids_json, []);
    // Instructor-paced students are assigned the whole lesson; only the questions the session showed count.
    const mine = items.map(x => x.question_id).filter(id => (self ? assigned.includes(id) : shown.has(id)) || own.has(id));
    const studentRows = mine.map(questionId => {
      const r = own.get(questionId);
      return { questionId, recorded: !!r, answer: r?.final_answer || null, correct: r ? r.is_correct == null ? null : r.is_correct === 1 : null,
        timeMs: r ? r.time_spent_ms || 0 : null, changes: r?.answer_changes || 0, lockedEarly: !!r?.locked_early };
    });
    const recorded = studentRows.filter(r => r.recorded);
    return { userId: p.user_id, name: p.name || p.email || p.user_id, joinedAt: p.joined_at, leftAt: p.left_at,
      right: recorded.filter(r => r.correct === true).length, scorable: recorded.filter(r => r.correct !== null).length,
      answered: recorded.filter(r => r.answer).length, totalMs: recorded.reduce((n, r) => n + r.timeMs, 0), rows: studentRows };
  }).sort((a, b) => (b.scorable ? b.right / b.scorable : -1) - (a.scorable ? a.right / a.scorable : -1) || b.right - a.right || a.name.localeCompare(b.name));

  const started = msOf(s.started_at), ended = msOf(s.ended_at);
  return { status: 200, body: {
    session: { id: s.id, paddedId: padSessionId(s.id), lesson_id: s.lesson_id, title: frozen.title || '', mode: frozen.mode || '',
      join_code: s.join_code, created_at: s.created_at, started_at: s.started_at, ended_at: s.ended_at,
      durationMs: Number.isFinite(started) && Number.isFinite(ended) ? Math.max(0, ended - started) : null, timed: !!timing },
    questions, students, average: classAverage(students) } };
}

// Mean right and mean scorable over students with a scorable answer row (the "avg 7/10" figure).
export function classAverage(students) {
  const scored = students.filter(x => x.scorable > 0);
  if (!scored.length) return null;
  const mean = key => scored.reduce((n, x) => n + x[key], 0) / scored.length;
  return { right: mean('right'), scorable: mean('scorable'), percent: scored.reduce((n, x) => n + x.right / x.scorable, 0) / scored.length };
}
