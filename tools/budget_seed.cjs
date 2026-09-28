// Free-plan budget seed (docs/perf/FREE-PLAN-BRIEF.md §4). Writes SQL for a synthetic club:
// a question bank of CONFIG size (core rows are synthetic clones of the tracked AI items in
// tools/aiq, which are loaded as they are), 30 budget students with practice history, ended
// past lessons, and the two lessons the flow driver runs. No production data is read.
//   node tools/budget_seed.cjs <outDir> [--staging]
// --staging uses CONFIG.staging (smaller history) to keep staging under 10% of the daily caps.
// Output: budget_{questions,accounts,history,past,live}.sql (core DB) and budget_ai.sql.
const { readFileSync, readdirSync, writeFileSync, mkdirSync } = require('node:fs');
const { resolve, join } = require('node:path');
const root = resolve(__dirname, '..');

const CONFIG = {
  coreQuestions: 3000,        // [est] assumed size of the official bank; production was not read
  students: 30,               // e2e-budget-01..30 (index.e2e.js accepts 01..40)
  historyAttempts: 400,       // [est] attempts per student already in the log
  historyQuestions: 300,      // [est] distinct questions each student has a progress row for
  pastSessions: 10,           // [est] ended lessons before the measured day
  pastSessionSize: 20,
  lessonQuestions: 20,        // lessons the driver runs (25 students x 20 questions)
  // Staging writes count against production's daily caps; its history is smaller (see report).
  staging: { coreQuestions: 3000, historyAttempts: 30, historyQuestions: 20, pastSessions: 0 }
};

const q = v => v == null ? 'NULL' : typeof v === 'number' ? String(v) : "'" + String(v).replace(/'/g, "''") + "'";
const rows = (table, cols, list, verb = 'INSERT OR IGNORE') => {
  // D1 caps a statement at 100 KB: cut each multi-row INSERT at ~80 KB or 100 rows.
  const out = [], head = `${verb} INTO ${table} (${cols.join(',')}) VALUES\n`;
  let chunk = [], size = 0;
  const flush = () => { if (chunk.length) out.push(head + chunk.join(',\n') + ';'); chunk = []; size = 0; };
  for (const r of list) {
    const v = '(' + r.map(q).join(',') + ')';
    if (chunk.length && (size + v.length > 80000 || chunk.length >= 100)) flush();
    chunk.push(v); size += v.length;
  }
  flush();
  return out.join('\n');
};
const pad = (n, w) => String(n).padStart(w, '0');

function build(cfg) {
  const ai = [];
  for (const f of readdirSync(join(root, 'tools/aiq')).filter(f => f.endsWith('.jsonl')).sort())
    for (const line of readFileSync(join(root, 'tools/aiq', f), 'utf8').split('\n')) if (line.trim()) ai.push(JSON.parse(line));
  const levels = ['Easy', 'Medium', 'Hard'];
  const core = Array.from({ length: cfg.coreQuestions }, (_, i) => {
    const src = ai[i % ai.length];
    return { id: 'bq-' + pad(i + 1, 5), section: src.section, domain: src.domain, skill: src.skill, difficulty: levels[i % 3],
      stem_html: src.stem_html, choices_json: src.choices_json, correct_answer: src.correct_answer, explanation_html: src.explanation_html };
  });
  const coreCols = ['id', 'external_id', 'section', 'domain', 'difficulty', 'skill', 'stem_html', 'choices_json', 'correct_answer', 'explanation_html', 'source', 'has_figure'];
  const aiCols = [...coreCols, 'level'];
  const coreSql = rows('questions', coreCols, core.map(x => [x.id, x.id, x.section, x.domain, x.difficulty, x.skill, x.stem_html, x.choices_json, x.correct_answer, x.explanation_html, 'College Board', 0]));
  const aiSql = rows('questions', aiCols, ai.map(x => [x.id, x.id, x.section, x.domain, x.difficulty, x.skill, x.stem_html, x.choices_json, x.correct_answer, x.explanation_html, 'AI', 0, x.level || 4]));

  const students = Array.from({ length: cfg.students }, (_, i) => 'e2e-budget-' + pad(i + 1, 2));
  const users = students.map((id, i) => [id, id + '@e2e.test', 'Budget Student ' + pad(i + 1, 2), 'student']);
  const parts = { questions: coreSql + '\n' + rows('ai_ids', ['id'], ai.map(x => [x.id])) };
  const out = [

    rows('users', ['id', 'email', 'name', 'role'], [['e2e-admin', 'e2e-admin@e2e.test', 'E2E Admin', 'admin'], ...users]),
    "UPDATE users SET role='admin' WHERE id='e2e-admin';",
    rows('membership', ['user_id', 'email', 'status'], [['e2e-admin', 'e2e-admin@e2e.test', 'approved'], ...students.map(id => [id, id + '@e2e.test', 'approved'])])];
  parts.accounts = out.splice(0).join('\n');

  // Practice history: each student has worked `historyQuestions` questions, some twice.
  const bank = [...core.map(x => x.id), ...ai.map(x => x.id)];
  const prog = [], att = [];
  students.forEach((id, s) => {
    for (let k = 0; k < cfg.historyAttempts; k++) {
      const qid = bank[(s * 97 + (k % cfg.historyQuestions) * 13) % bank.length];
      const correct = (s + k) % 3 !== 0 ? 1 : 0;
      const day = pad(1 + (k % 26), 2);
      att.push([id, qid, `2026-09-${day}T${pad(10 + (k % 10), 2)}:${pad(k % 60, 2)}:00.000Z`, correct, 40000 + (k % 50) * 1000, correct ? 'A' : 'B', k % 4 === 0 ? 1 : 0, null, null]);
      if (k < cfg.historyQuestions) prog.push([id, qid, 1, correct, correct ? 'Green' : 'Red', `2026-09-${day}T12:00:00.000Z`, 60000, 0]);
    }
  });
  out.push(rows('progress', ['user_id', 'question_id', 'attempts', 'corrects', 'marker', 'last_reviewed', 'time_taken_ms', 'stars'], prog));
  out.push(rows('attempts', ['user_id', 'question_id', 'ts', 'correct', 'time_taken_ms', 'picked', 'changes', 'answer_history_json', 'lesson_session_id'], att));
  parts.history = out.splice(0).join('\n');

  // Ended past lessons (ids 920001..), so My Lessons, usedInLesson and the admin Lessons tab have data.
  const lessons = [], sessions = [], participants = [], resp = [], usage = [];
  for (let n = 0; n < cfg.pastSessions; n++) {
    const lid = 920001 + n, sid = 920001 + n;
    const items = Array.from({ length: cfg.pastSessionSize }, (_, k) => ({ question_id: bank[(n * 211 + k * 17) % bank.length], time_limit_sec: 60, notes: '' }));
    const mode = n % 2 ? 'self' : 'instructor';
    lessons.push([lid, 'Past lesson ' + (n + 1), mode, 'e2e-admin']);
    sessions.push([sid, lid, 'P' + pad(n, 5).replace(/0/g, 'Q'), 'ended', JSON.stringify({ title: 'Past lesson ' + (n + 1), mode, items }), `2026-09-${pad(1 + n, 2)} 15:00:00`, `2026-09-${pad(1 + n, 2)} 16:00:00`]);
    items.forEach(it => usage.push([it.question_id, sid, `2026-09-${pad(1 + n, 2)} 16:00:00`]));
    students.slice(0, 25).forEach((uid, s) => {
      participants.push([sid, uid, JSON.stringify(items.map(i => i.question_id))]);
      items.forEach((it, k) => resp.push([sid, uid, it.question_id, 'A', (s + k) % 2, 0, 30000, 0]));
    });
  }
  out.push(rows('lessons', ['id', 'title', 'mode', 'created_by'], lessons));
  out.push(rows('lesson_sessions', ['id', 'lesson_id', 'join_code', 'status', 'snapshot_json', 'started_at', 'ended_at'], sessions));
  out.push(rows('session_participants', ['session_id', 'user_id', 'assigned_question_ids_json'], participants));
  out.push(rows('session_responses', ['session_id', 'user_id', 'question_id', 'final_answer', 'is_correct', 'locked_early', 'time_spent_ms', 'answer_changes'], resp));
  out.push(rows('question_lesson_usage', ['question_id', 'session_id', 'used_at'], usage));
  parts.past = out.splice(0).join('\n');

  // The two lessons the driver runs: R&W, Math and SPR items (AI Math items with [] choices are SPR).
  const spr = ai.filter(x => x.choices_json === '[]').slice(0, 3).map(x => x.id);
  const pick = [...spr, ...core.slice(0, cfg.lessonQuestions - spr.length).map(x => x.id)];
  const live = [];
  for (const [lid, title, mode, sec] of [[910001, 'Budget instructor lesson', 'instructor', 30], [910002, 'Budget self-paced lesson', 'self', 60]]) {
    out.push(rows('lessons', ['id', 'title', 'mode', 'created_by'], [[lid, title, mode, 'e2e-admin']]));
    pick.forEach((qid, k) => live.push([lid, k, qid, sec, 'Budget note ' + k]));
  }
  out.push(rows('lesson_questions', ['lesson_id', 'position', 'question_id', 'time_limit_sec', 'notes'], live));
  parts.live = out.join('\n');
  const answers = Object.fromEntries([...core, ...ai].map(x => [x.id, { choices: JSON.parse(x.choices_json || '[]').map(c => c.letter), correct: x.correct_answer }]));
  return { parts, ai: aiSql, answers, counts: { core: core.length, ai: ai.length, progress: prog.length, attempts: att.length, sessionResponses: resp.length, usage: usage.length } };
}

if (require.main === module) {
  const dir = process.argv[2];
  if (!dir) throw new Error('usage: node tools/budget_seed.cjs <outDir> [--staging]');
  const cfg = process.argv.includes('--staging') ? { ...CONFIG, ...CONFIG.staging } : CONFIG;
  const built = build(cfg);
  mkdirSync(dir, { recursive: true });
  // One file per part (core DB) so staging can load them on different UTC days.
  for (const [name, sql] of Object.entries(built.parts)) writeFileSync(join(dir, `budget_${name}.sql`), sql);
  writeFileSync(join(dir, 'budget_ai.sql'), built.ai);
  console.log(JSON.stringify(built.counts));
}
module.exports = { CONFIG, build };
