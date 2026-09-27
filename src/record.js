import { nextProgress, attemptRow, isRight, normalizeQuestion } from '../public/shared/stats.js';
import { lessonScore, lessonQuestion } from '../public/shared/lesson.js';

const str = (v, n) => (typeof v === 'string' ? v.slice(0, n) : '');
export const padSessionId = id => String(id).padStart(5, '0');
const KNOWN = `EXISTS(SELECT 1 FROM questions WHERE id = ?) OR EXISTS(SELECT 1 FROM ai_ids WHERE id = ?)`;

// The one progress and attempt writer: POST /api/progress, POST /api/attempts and the
// self-paced lesson write-back (§10) all bind these, so a row lands the same way from each.
// `onlyOnce` (a lesson session ID) skips the progress row when that lesson attempt already
// exists, which keeps a retried write-back from moving the record twice.
export function progressStatement(db, userId, r, onlyOnce = null) {
  const qid = str(r.question_id, 64);
  return db.prepare(
    `INSERT INTO progress
       SELECT ?,?,?,?,?,?,?,? WHERE (${KNOWN})${onlyOnce == null ? '' : `
         AND NOT EXISTS(SELECT 1 FROM attempts WHERE lesson_session_id = ? AND user_id = ? AND question_id = ?)`}
     ON CONFLICT(user_id, question_id) DO UPDATE SET
       attempts=excluded.attempts, corrects=excluded.corrects, marker=excluded.marker,
       last_reviewed=excluded.last_reviewed, time_taken_ms=excluded.time_taken_ms,
       stars=MAX(progress.stars, excluded.stars)`
  ).bind(userId, qid, r.attempts | 0, r.corrects | 0, str(r.marker, 16) || 'Red', str(r.last_reviewed, 32) || null,
    r.time_taken_ms | 0, r.stars | 0, qid, qid, ...(onlyOnce == null ? [] : [onlyOnce, userId, qid]));
}
export function attemptStatement(db, userId, r, lessonSessionId = null) {
  const qid = str(r.question_id, 64);
  return db.prepare(
    `INSERT OR IGNORE INTO attempts
       (user_id, question_id, ts, correct, time_taken_ms, picked, changes, answer_history_json, lesson_session_id)
      SELECT ?,?,?,?,?,?,?,?,? WHERE ${KNOWN}`
  ).bind(userId, qid, str(r.ts, 32), r.correct ? 1 : 0, r.time_taken_ms | 0,
    str(r.picked, 32) || null, r.changes | 0, r.answer_history_json ?? null, lessonSessionId, qid, qid);
}

// §10 self-paced write-back: one attempt and one record move per assigned scorable question,
// through the same helpers the question bank uses. Blank scorable = picked null, wrong (G3);
// unscorable questions record nothing, as in practice. `rows` are the finalized responses.
export async function lessonWriteBack(db, sessionId, at, rows, questions) {
  const now = new Date(at).toISOString();
  const scored = rows.filter(r => questions[r.questionId] && isRight(questions[r.questionId], '?') !== null);
  const statements = [];
  for (const userId of [...new Set(scored.map(r => r.userId))]) {
    const held = await db.prepare('SELECT question_id, attempts, corrects, marker, last_reviewed, time_taken_ms, stars FROM progress WHERE user_id = ?').bind(userId).all();
    const prog = Object.fromEntries((held.results || []).map(p => [p.question_id, p]));
    for (const r of scored.filter(x => x.userId === userId)) {
      const ok = isRight(questions[r.questionId], r.answer || null);
      const history = r.answer ? r.history : [];
      statements.push(progressStatement(db, userId, nextProgress(prog[r.questionId], r.questionId, ok, now, r.ms), sessionId),
        attemptStatement(db, userId, attemptRow(r.questionId, ok, now, r.ms, r.answer, r.changes, history), sessionId));
    }
  }
  return statements;
}

// Sessions a student has a participant row for, newest first, with their own score.
export async function attendedSessions(db, userId) {
  const rows = await db.prepare(`SELECT s.id, s.status, s.snapshot_json, s.created_at, s.started_at, s.ended_at
    FROM session_participants p JOIN lesson_sessions s ON s.id = p.session_id WHERE p.user_id = ? ORDER BY s.id DESC`).bind(userId).all();
  const responses = await db.prepare('SELECT session_id, is_correct FROM session_responses WHERE user_id = ?').bind(userId).all();
  return (rows.results || []).map(s => {
    let frozen = {}; try { frozen = JSON.parse(s.snapshot_json); } catch { /* unreadable snapshot */ }
    return { sessionId: s.id, paddedId: padSessionId(s.id), title: frozen.title || '', mode: frozen.mode || '', status: s.status,
      date: s.started_at || s.created_at, endedAt: s.ended_at,
      score: lessonScore((responses.results || []).filter(r => r.session_id === s.id)) };
  });
}

// §9.1 one ended session for one participant: the questions it showed, in lesson order, with
// their own answer, the official answer and explanation, the notes as the Breakdown, and the
// instructor's saved review. Nothing here is served before the session has ended (G6).
export async function lessonHistory(db, aiDb, userId, sessionId) {
  const s = await db.prepare(`SELECT s.id, s.status, s.snapshot_json, s.created_at, s.started_at, p.assigned_question_ids_json
    FROM lesson_sessions s JOIN session_participants p ON p.session_id = s.id AND p.user_id = ? WHERE s.id = ?`).bind(userId, sessionId).first();
  if (!s || s.status !== 'ended') return null;
  const frozen = JSON.parse(s.snapshot_json);
  const [shown, responses, reviews] = await Promise.all([
    db.prepare('SELECT question_id FROM question_lesson_usage WHERE session_id = ?').bind(sessionId).all(),
    db.prepare('SELECT question_id, final_answer, is_correct FROM session_responses WHERE session_id = ? AND user_id = ?').bind(sessionId, userId).all(),
    db.prepare('SELECT question_id, annotations_json, desmos_state_json FROM session_question_review WHERE session_id = ?').bind(sessionId).all()]);
  const shownIds = new Set((shown.results || []).map(r => r.question_id));
  const own = new Map((responses.results || []).map(r => [r.question_id, r]));
  const review = new Map((reviews.results || []).map(r => [r.question_id, r]));
  let assigned = null; try { assigned = frozen.mode === 'self' ? JSON.parse(s.assigned_question_ids_json) : null; } catch { assigned = []; }
  const parse = text => { try { return text ? JSON.parse(text) : null; } catch { return null; } };
  const cols = 'id,section,difficulty,skill,stem_html,choices_json,correct_answer,explanation_html,source';
  const questions = [];
  for (const [position, item] of frozen.items.entries()) {
    if (!shownIds.has(item.question_id)) continue;
    const row = await db.prepare(`SELECT ${cols} FROM questions WHERE id=?`).bind(item.question_id).first() ||
      await aiDb.prepare(`SELECT ${cols} FROM questions WHERE id=?`).bind(item.question_id).first();
    if (!row) continue;
    const r = own.get(item.question_id), saved = review.get(item.question_id);
    questions.push({ number: position + 1, question: lessonQuestion(normalizeQuestion(row), true), notes: item.notes || '',
      inSet: !assigned || assigned.includes(item.question_id), recorded: !!r, answer: r?.final_answer || null,
      correct: r ? r.is_correct : null, annotations: parse(saved?.annotations_json) || [], desmos: parse(saved?.desmos_state_json) });
  }
  const score = lessonScore(responses.results || []);
  return { sessionId: s.id, paddedId: padSessionId(s.id), title: frozen.title || '', mode: frozen.mode, date: s.started_at || s.created_at, score, questions };
}
