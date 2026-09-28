// Rebuilds the generated sections of docs/perf/free-plan-budget.md from the measured traces
// (docs/perf/budget-local.json, docs/perf/budget-staging.json) and the model config block in
// the report itself. Edit the JSON under "Daily model" and rerun:
//   node tools/budget_report.cjs
const { readFileSync, writeFileSync, existsSync } = require('node:fs');
const { join } = require('node:path');
const root = join(__dirname, '..');
const reportFile = join(root, 'docs/perf/free-plan-budget.md');
const local = JSON.parse(readFileSync(join(root, 'docs/perf/budget-local.json'), 'utf8'));
const staging = existsSync(join(root, 'docs/perf/budget-staging.json')) ? JSON.parse(readFileSync(join(root, 'docs/perf/budget-staging.json'), 'utf8')) : { flows: {} };
let report = readFileSync(reportFile, 'utf8');
const cfg = JSON.parse(/<!-- model-config -->\s*```json\n([\s\S]*?)```/.exec(report)[1]);

const CAPS = { workerRequests: 100000, d1RowsRead: 5000000, d1RowsWritten: 100000, doRequests: 100000, doGbS: 13000, doStorageRowsRead: 5000000, doStorageRowsWritten: 100000 };
const LIMITS = { queries: 1000, briefQueries: 50, cpuMs: 10, params: 100, batchS: 30 };
const TITLES = {
  'student-boot': 'Student sign-in + first page load', 'bank-filter': 'Question bank load + filter change (builder search, 3 usage options) ★',
  'practice-answer': 'Answer one practice question', 'admin-students': 'Admin students list, 30 students ★', 'admin-student-detail': 'Admin student detail, every tab ★',
  'builder-search-save': 'Lesson builder search + save', 'instructor-lesson': 'Instructor-paced lesson, 25 students × 20 questions',
  'self-paced-end': 'Self-paced, 25 × 20, through end + write-back ★', 'poll-review': 'Poll + review (after the self-paced set)', 'my-lessons': 'My Lessons list + one session' };

function stats(flow) {
  const inv = flow?.invocations || [];
  const sum = (k, f = () => true) => inv.filter(f).reduce((n, x) => n + (x[k] || 0), 0);
  const isDo = x => x.kind.startsWith('do.');
  const ws = inv.filter(x => x.kind === 'do.webSocketMessage').length;
  const storage = k => inv.reduce((n, x) => n + (x.storage?.[k] || 0), 0);
  const worst = inv.reduce((w, x) => (x.queries || 0) + (x.batches || 0) > (w ? w.queries + w.batches : -1) ? x : w, null);
  return {
    workerRequests: inv.filter(x => x.kind === 'worker').length, doRequests: inv.filter(isDo).length, wsMessages: ws,
    doRequestsBilled: inv.filter(isDo).length - ws + ws / 20,
    queries: sum('queries') + sum('batches'), statements: sum('statements'), rowsRead: sum('rowsRead'), rowsWritten: sum('rowsWritten'),
    worstQueries: worst ? worst.queries + worst.batches : 0, worstLabel: worst ? `${worst.kind} ${worst.label}`.trim() : '',
    maxBatch: Math.max(0, ...inv.flatMap(x => x.batchStatements || [])), maxParams: Math.max(0, ...inv.map(x => x.maxParams || 0)),
    maxInvRowsWritten: Math.max(0, ...inv.map(x => x.rowsWritten || 0)), maxInvWallMs: Math.max(0, ...inv.map(x => x.wallMs || 0)),
    doStorageWritten: storage('put') + storage('delete') + storage('setAlarm') + storage('deleteAlarm') + storage('deleteAll'),
    doStorageRead: storage('get') + storage('list') + storage('getAlarm'), doWallMs: sum('wallMs', isDo)
  };
}
function cpu(name) {
  const f = staging.flows[name];
  if (!f) return null;
  const inv = f.invocations.filter(x => x.cpuMs != null);
  return { max: Math.max(0, ...inv.map(x => x.cpuMs)), killed: inv.filter(x => x.outcome && x.outcome !== 'ok').map(x => `${x.label.split('?')[0]} (${x.outcome}, ${x.cpuMs} ms)`),
    worst: inv.reduce((w, x) => x.cpuMs > (w?.cpuMs ?? -1) ? x : w, null), error: f.error || null, at: staging.at };
}
const S = Object.fromEntries(Object.keys(TITLES).map(k => [k, stats(local.flows[k])]));
// `<flow>@warm`: the same flow again right after, served from the free-02 caches (budget_measure --warm).
const W = Object.fromEntries(Object.keys(TITLES).map(k => [k, local.flows[k + '@warm'] ? stats(local.flows[k + '@warm']) : S[k]]));
const n = x => typeof x === 'number' ? (Number.isInteger(x) ? x.toLocaleString('en-US') : x.toLocaleString('en-US', { maximumFractionDigits: 1 })) : x;
const pct = (v, cap) => (100 * v / cap).toFixed(1) + '%';

// --- per-flow table ------------------------------------------------------------------------
const flowRows = Object.entries(TITLES).map(([k, title]) => {
  const s = S[k], c = cpu(k);
  const cpuText = c ? (c.killed.length ? `**killed: ${c.killed.join('; ')}**` : `${c.max} ms (${c.worst?.label.split('?')[0] || ''})`) + ' [staging]' : '— (not a ★ flow)';
  return `| ${title} | ${n(s.workerRequests)} | ${n(s.doRequests)}${s.wsMessages ? ` (${n(s.wsMessages)} WS msgs)` : ''} | ${n(s.worstQueries)} (${s.worstLabel}) | ${s.maxBatch || '—'} | ${n(s.rowsRead)} | ${n(s.rowsWritten)} | ${n(s.doStorageWritten)} | ${cpuText} |`;
});
const perFlow = [
  `Measured [local] on ${local.at.slice(0, 10)} with the seed in \`tools/budget_seed.cjs\` (${n(local.seed.core)} core + ${n(local.seed.ai)} AI questions, 30 students × ${n(local.config.historyAttempts)} attempts, ${local.config.pastSessions} past lessons). CPU column [staging] (${staging.at ? staging.at.slice(0, 16) + 'Z' : 'not run'}; staging history is smaller, see "Staging seed").`,
  '',
  '| Flow | Worker invocations | DO invocations | Worst invocation: D1 queries (batch = 1) | Largest batch (statements) | D1 rows read | D1 rows written | DO storage rows written | Max CPU per invocation |',
  '|---|---|---|---|---|---|---|---|---|', ...flowRows, '',
  'Flow details [local]:',
  `- Student boot: \`/api/questions\` reads ${n(local.flows['student-boot'].invocations.find(x => x.label === 'GET /api/questions')?.rowsRead)} rows when it rebuilds the cached body (full scans of both banks + \`question_lesson_usage\`) and ${n(local.flows['student-boot@warm']?.invocations.find(x => x.label === 'GET /api/questions')?.rowsRead)} when served from the cache; \`/api/lesson-history\` reads ${n(local.flows['student-boot'].invocations.find(x => x.label === 'GET /api/lesson-history')?.rowsRead)}.`,
  `- Practice answer: ${n(S['practice-answer'].rowsWritten)} rows written and ${n(S['practice-answer'].rowsRead)} read per Check; \`POST /api/attempts\` counts the student's whole log (\`SELECT COUNT(*)\`), so its reads grow with history.`,
  `- Admin students list: ${n(S['admin-students'].worstQueries)} queries and ${n(S['admin-students'].rowsRead)} rows read when every student is recomputed; ${n(W['admin-students'].worstQueries)} queries and ${n(W['admin-students'].rowsRead)} rows from the stats cache (the per-student stamps are one batch).`,
  `- Builder: create = batch of ${local.flows['builder-search-save'].invocations.find(x => x.label === 'POST /api/admin/lessons')?.batchStatements.join(' + ')} statements; one autosave (PUT) writes ${n(local.flows['builder-search-save'].invocations.find(x => x.label.startsWith('PUT'))?.rowsWritten)} rows.`,
  `- Instructor-paced: per question the end-of-question flush writes ${n(Math.round(avg(local.flows['instructor-lesson'].invocations.filter(x => x.label === 'endNow' || x.kind === 'do.alarm').map(x => x.rowsWritten))))} D1 rows on average; ${n(S['instructor-lesson'].wsMessages)} WS messages for the lesson; ${n(countLabel('instructor-lesson', 'do.alarm'))} alarms; DO storage: ${fmtStorage('instructor-lesson')}.`,
  `- Self-paced end: the finishing \`submitAll\` runs ${n(worstOf('self-paced-end').queries)} separate queries (one progress SELECT per student) + ${n(worstOf('self-paced-end').batches)} write batches of at most ${n(S['self-paced-end'].maxBatch)} statements (free-03 chunks; free-02 sent one batch of 1,526), writing ${n(S['self-paced-end'].maxInvRowsWritten)} rows in ${n(S['self-paced-end'].maxInvWallMs)} ms [local]; DO storage: ${fmtStorage('self-paced-end')}.`,
  `- My Lessons: the session view runs ${n(local.flows['my-lessons'].invocations.at(-1)?.queries)} queries (one question lookup per item); the list reads ${n(local.flows['my-lessons'].invocations[0]?.rowsRead)} rows.`,
  `- Largest bound-parameter count on any statement: ${Math.max(...Object.values(S).map(s => s.maxParams))} (limit 100).`
].join('\n');
function avg(a) { return a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0; }
function countLabel(f, kind) { return local.flows[f].invocations.filter(x => x.kind === kind).length; }
function worstOf(f) { return local.flows[f].invocations.reduce((w, x) => (x.rowsWritten || 0) > (w?.rowsWritten ?? -1) ? x : w, null); }
function fmtStorage(f) { const t = {}; local.flows[f].invocations.forEach(x => Object.entries(x.storage || {}).forEach(([k, v]) => t[k] = (t[k] || 0) + v)); return Object.entries(t).map(([k, v]) => `${k} ${n(v)}`).join(', '); }

// --- daily model ---------------------------------------------------------------------------
const scale = (cfg.lessonStudents * cfg.lessonQuestions) / (25 * 20);
const parts = [
  ['Student boots, bank cache miss', Math.min(cfg.bankCacheMisses ?? Infinity, cfg.practiceStudents * cfg.bootsPerStudent), S['student-boot'], { workerRequests: cfg.staticAssetsPerBoot }],
  ['Student boots, bank cache hit', Math.max(0, cfg.practiceStudents * cfg.bootsPerStudent - (cfg.bankCacheMisses ?? Infinity)), W['student-boot'], { workerRequests: cfg.staticAssetsPerBoot }],
  ['Practice answers', cfg.practiceStudents * cfg.practiceQuestionsPerStudent, S['practice-answer'], { workerRequests: cfg.figureCropsPerPracticeQuestion, d1RowsRead: cfg.figureCropsPerPracticeQuestion }],
  ['Admin dashboard views (list + detail), recomputed', Math.min(cfg.adminColdViews ?? Infinity, cfg.adminViews), sumStats(S['admin-students'], S['admin-student-detail'])],
  ['Admin dashboard views (list + detail), cached', Math.max(0, cfg.adminViews - (cfg.adminColdViews ?? Infinity)), sumStats(W['admin-students'], W['admin-student-detail'])],
  ['Lessons built', cfg.lessonsBuilt, builder()],
  ['Instructor-paced lessons', cfg.instructorLessons, scaleStats(S['instructor-lesson'], scale)],
  ['Self-paced lessons (+ poll/review)', cfg.selfPacedLessons, scaleStats(sumStats(S['self-paced-end'], S['poll-review']), scale)],
  ['My Lessons views', cfg.myLessonsViews, S['my-lessons']]
];
function sumStats(...list) { const out = {}; for (const s of list) for (const [k, v] of Object.entries(s)) if (typeof v === 'number') out[k] = (out[k] || 0) + v; return out; }
function scaleStats(s, f) { return Object.fromEntries(Object.entries(s).map(([k, v]) => [k, typeof v === 'number' ? v * f : v])); }
function builder() {
  const inv = local.flows['builder-search-save'].invocations;
  const search = inv.find(x => x.label === 'GET /api/admin/questions'), put = inv.find(x => x.label.startsWith('PUT'));
  const base = S['builder-search-save'];
  return { ...base, workerRequests: base.workerRequests + (cfg.builderSearchesPerLesson - 1) + (cfg.builderAutosavesPerLesson - 1),
    rowsRead: base.rowsRead + (cfg.builderSearchesPerLesson - 1) * search.rowsRead + (cfg.builderAutosavesPerLesson - 1) * put.rowsRead,
    rowsWritten: base.rowsWritten + (cfg.builderAutosavesPerLesson - 1) * put.rowsWritten };
}
const metric = {
  workerRequests: s => s.workerRequests, d1RowsRead: s => s.rowsRead, d1RowsWritten: s => s.rowsWritten,
  doRequests: s => s.doRequests, doGbS: s => s.doWallMs / 1000 * 0.125,
  doStorageRowsRead: s => s.doStorageRead, doStorageRowsWritten: s => s.doStorageWritten };
const totals = Object.fromEntries(Object.keys(CAPS).map(k => [k, 0]));
const lines = parts.map(([label, count, s, extra = {}]) => {
  const row = {};
  for (const k of Object.keys(CAPS)) { row[k] = count * ((metric[k](s) || 0) + (extra[k] || 0)); totals[k] += row[k]; }
  return `| ${label} | ${n(count)} | ${n(Math.round(row.workerRequests))} | ${n(Math.round(row.d1RowsRead))} | ${n(Math.round(row.d1RowsWritten))} | ${n(Math.round(row.doRequests))} | ${n(Math.round(row.doStorageRowsWritten))} |`;
});
// DO duration: per-event wall time is a floor; the ceiling keeps each lesson object active the whole lesson.
const lessonGbSCeiling = (cfg.instructorLessons + cfg.selfPacedLessons) * cfg.lessonMinutes * 60 * 0.125;
const daily = [
  '| Part of the day | Count | Worker requests | D1 rows read | D1 rows written | DO requests | DO storage rows written |', '|---|---|---|---|---|---|---|', ...lines,
  `| **Total** | | **${n(Math.round(totals.workerRequests))}** | **${n(Math.round(totals.d1RowsRead))}** | **${n(Math.round(totals.d1RowsWritten))}** | **${n(Math.round(totals.doRequests))}** | **${n(Math.round(totals.doStorageRowsWritten))}** |`,
  '',
  '| Daily cap | Heavy day | % of cap | Basis |', '|---|---|---|---|',
  `| Worker requests (100,000) | ${n(Math.round(totals.workerRequests))} | ${pct(totals.workerRequests, CAPS.workerRequests)} | measured-local flows + estimated static assets/crops |`,
  `| D1 rows read (5,000,000) | ${n(Math.round(totals.d1RowsRead))} | ${pct(totals.d1RowsRead, CAPS.d1RowsRead)} | measured-local × model |`,
  `| D1 rows written (100,000) | ${n(Math.round(totals.d1RowsWritten))} | ${pct(totals.d1RowsWritten, CAPS.d1RowsWritten)} | measured-local × model |`,
  `| DO requests (100,000; WS messages 1:1) | ${n(Math.round(totals.doRequests))} | ${pct(totals.doRequests, CAPS.doRequests)} | measured-local × model |`,
  `| DO duration (13,000 GB-s) | ${n(Math.round(totals.doGbS))}–${n(Math.round(lessonGbSCeiling))} GB-s | ${pct(totals.doGbS, CAPS.doGbS)}–${pct(lessonGbSCeiling, CAPS.doGbS)} | estimated: event wall time (floor) to object active for the whole lesson (ceiling) |`,
  `| DO storage rows read (5,000,000) | ${n(Math.round(totals.doStorageRowsRead))} | ${pct(totals.doStorageRowsRead, CAPS.doStorageRowsRead)} | measured-local call counts, 1 row per key [est] |`,
  `| DO storage rows written (100,000) | ${n(Math.round(totals.doStorageRowsWritten))} | ${pct(totals.doStorageRowsWritten, CAPS.doStorageRowsWritten)} | measured-local call counts, 1 row per key [est] |`
].join('\n');

// --- per-invocation worst ------------------------------------------------------------------
const all = Object.entries(local.flows).flatMap(([f, x]) => x.invocations.map(i => ({ ...i, flow: f })));
const worstQ = all.reduce((w, x) => x.queries + x.batches > w.queries + w.batches ? x : w);
const worstB = all.reduce((w, x) => Math.max(0, ...(x.batchStatements || [])) > Math.max(0, ...(w.batchStatements || [])) ? x : w);
const worstP = all.reduce((w, x) => (x.maxParams || 0) > (w.maxParams || 0) ? x : w);
const cpuAll = Object.entries(staging.flows).flatMap(([f, x]) => x.invocations.filter(i => i.cpuMs != null).map(i => ({ ...i, flow: f })));
const worstC = cpuAll.reduce((w, x) => x.cpuMs > (w?.cpuMs ?? -1) ? x : w, null);
const perInvocation = [
  '| Per-invocation limit | Worst single invocation | % of limit |', '|---|---|---|',
  `| D1 queries (1,000 verified; brief assumed 50) | ${worstQ.queries + worstQ.batches} — ${worstQ.flow}: ${worstQ.kind} ${worstQ.label} [local] | ${pct(worstQ.queries + worstQ.batches, LIMITS.queries)} (${pct(worstQ.queries + worstQ.batches, LIMITS.briefQueries)} of 50) |`,
  `| Statements in one batch | ${Math.max(...worstB.batchStatements)} — ${worstB.flow}: ${worstB.kind} ${worstB.label} [local] | counts as 1 query; per-statement limits apply |`,
  `| Bound parameters per statement (100) | ${worstP.maxParams} — ${worstP.flow}: ${worstP.kind} ${worstP.label} [local] | ${pct(worstP.maxParams, LIMITS.params)} |`,
  `| CPU (10 ms) | ${worstC ? `${worstC.cpuMs} ms — ${worstC.flow}: ${worstC.label.split('?')[0]} (${worstC.outcome}) [staging]` : 'not measured'} | ${worstC ? pct(worstC.cpuMs, LIMITS.cpuMs) : ''} |`,
  `| Batch duration (30 s) | ${n(S['self-paced-end'].maxInvWallMs)} ms whole invocation incl. every write-back batch [local]; 177–187 ms for a 1,500-statement read batch [staging] | ${pct(S['self-paced-end'].maxInvWallMs / 1000, LIMITS.batchS)} |`
].join('\n');

const replace = (tag, body) => { report = report.replace(new RegExp(`(<!-- ${tag}:start -->)[\\s\\S]*?(<!-- ${tag}:end -->)`), `$1\n${body}\n$2`); };
replace('per-flow', perFlow); replace('daily', daily); replace('per-invocation', perInvocation);
writeFileSync(reportFile, report);
console.log(JSON.stringify(Object.fromEntries(Object.entries(totals).map(([k, v]) => [k, pct(v, CAPS[k])]))));
