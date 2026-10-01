// Study Plan engine (docs/plan/BRIEF.md): a logged Bluebook practice test becomes per-skill misses and slows, those move
// each skill's cycle state, and the state becomes an ordered plan of drill, consolidation and maintenance sets. Pure
// functions over plain data: `public/index.html` hands in the bank, the progress rows and the practice-test map, and
// stores what comes back (one JSON row, /api/plan). Unit tests: tests/test_plan.ts.
//
// Type-stripping safe on purpose (no enums, namespaces or parameter properties, no '/shared' imports), like record.ts.

// [DEFAULT] Slows appear on the plan and break ties but never create a drill. true makes a slow count as a miss.
export const SLOWS_COUNT_AS_MISSES = false;
// [DEFAULT] Soft limit: at 0:00 the clock turns red and counts overtime. true ends the segment at 0:00 instead.
export const HARD_CUTOFF = false;
// [DEFAULT] Logging a test this many days or fewer after the previous one warns (and still saves).
export const MIN_DAYS_BETWEEN_TESTS = 5;
export const NEXT_TEST_DAYS = 7;
export const CLEAN_TESTS_FOR_MAINTENANCE = 2;
export const MISSES_TO_LEAVE_MAINTENANCE = 2;
// A drill is 10 medium in 10:00, then 5 hard in 7:30; consolidation and maintenance are 5 hard in 7:30.
// A short pool shrinks a segment and its limit with it (one minute per medium, 90 seconds per hard).
export const SHAPES = {
  drill: [{ level: 'Medium', n: 10, msPer: 60000 }, { level: 'Hard', n: 5, msPer: 90000 }],
  consolidate: [{ level: 'Hard', n: 5, msPer: 90000 }],
  maintain: [{ level: 'Hard', n: 5, msPer: 90000 }]
} as const;

export type Section = 'RW' | 'Math';
export type Route = 'easy' | 'hard';
export const SECTIONS: Section[] = ['RW', 'Math'];
export const SECTION_NAME: Record<Section, string> = { RW: 'Reading and Writing', Math: 'Math' };
export type ModuleIds = (string | null)[];
export type PracticeTest = { id: string; number: number; name: string } & Record<Section, { m1: ModuleIds | null; easy: ModuleIds | null; hard: ModuleIds | null }>;
export type TestMap = { tests: PracticeTest[] };

// One logged test. `marks` has one string per module ('RW1', 'RW2', 'Math1', 'Math2'), one character per question in
// display order: '.' right, 'W' wrong, 'S' right but slow.
export type TestLog = { testId: string; number: number; date: string; route: Record<Section, Route>; marks: Record<string, string>; at: string };
export type Mark = 'W' | 'S';

export type BankQ = { id: string; skill?: string; difficulty?: string; ai?: boolean; section?: string };
export type SkillCount = { misses: number; slows: number; missIds: string[]; slowIds: string[] };
export type SkillState = { status: 'drilling' | 'maintenance' | 'none'; clean: number; misses: number; slows: number; lastDue: boolean };

export type Segment = { level: 'Medium' | 'Hard'; n: number; limitMs: number; usedMs: number; overMs: number };
export type SetRun = {
  ids: string[]; segs: Segment[]; seg: number; i: number;
  ans: Record<string, string>; ms: Record<string, number>; changes: Record<string, number>; flags: Record<string, boolean>;
  short: boolean; startedAt: string; finishedAt?: string; right?: number; scored?: number; missed?: string[];
};
export type StepKind = 'drill' | 'consolidate' | 'maintain' | 'test';
export type Step = { id: string; kind: StepKind; skill?: string; misses?: number; slows?: number; number?: number; date?: string; run?: SetRun; done?: boolean };
export type Plan = { testId: string; number: number; date: string; counts: Record<string, SkillCount>; slowOnly: string[]; steps: Step[] };
export type PlanState = { v: 1; tests: TestLog[]; skills: Record<string, SkillState>; plan: Plan | null };

export const emptyState = (): PlanState => ({ v: 1, tests: [], skills: {}, plan: null });

// ---------------- the test and its modules ----------------
export const moduleKey = (section: Section, module: 1 | 2) => `${section}${module}`;
export function routesOf(test: PracticeTest, section: Section): Route[] {
  return (['easy', 'hard'] as Route[]).filter(r => !!test[section][r]);
}
// The modules a student who took `route` saw, in test order. A module nobody has exported yet comes back with ids null.
export function modulesOf(test: PracticeTest, route: Record<Section, Route>) {
  return SECTIONS.flatMap(s => [
    { key: moduleKey(s, 1), section: s, module: 1 as const, ids: test[s].m1 },
    { key: moduleKey(s, 2), section: s, module: 2 as const, ids: test[s][route[s]] }
  ]);
}

export type LoggedItem = { module: string; number: number; id: string | null; skill: string | null; mark: Mark | null };
// Every position of the logged modules with its bank question (null when unmapped or not in this bank) and its mark.
export function resolveLog(test: PracticeTest, log: TestLog, byId: Map<string, BankQ>): LoggedItem[] {
  return modulesOf(test, log.route).flatMap(m => (m.ids || []).map((raw, n) => {
    const q = raw ? byId.get(raw) : undefined;
    const c = (log.marks[m.key] || '')[n];
    return { module: m.key, number: n + 1, id: q ? q.id : null, skill: q ? (q.skill || 'Other') : null, mark: c === 'W' || c === 'S' ? c : null };
  }));
}

// Per skill (as the bank stores it): this test's misses and slows, with the question IDs behind them.
export function countBySkill(items: LoggedItem[]): Record<string, SkillCount> {
  const out: Record<string, SkillCount> = {};
  for (const it of items) {
    if (!it.skill || !it.id) continue;
    const c = out[it.skill] ||= { misses: 0, slows: 0, missIds: [], slowIds: [] };
    if (it.mark === 'W') { c.misses++; c.missIds.push(it.id); }
    if (it.mark === 'S') { c.slows++; c.slowIds.push(it.id); }
  }
  return out;
}
const effective = (c: { misses: number; slows: number }, slowsAsMisses: boolean) => c.misses + (slowsAsMisses ? c.slows : 0);

// ---------------- the cycle ----------------
// One test moves every skill it tested. A skill the test did not cover keeps its state.
//   not in maintenance: 1+ miss -> drilling, streak 0, drilled; 0 misses -> streak + 1, maintenance at 2 clean tests
//     (not due on the cycle it enters; then due every other cycle).
//   maintenance: 2+ misses -> back to drilling; exactly 1 -> stays, streak 0, due this cycle whatever the schedule;
//     0 -> streak + 1, due every other cycle.
export function advanceCycle(prev: Record<string, SkillState>, counts: Record<string, SkillCount>, slowsAsMisses = SLOWS_COUNT_AS_MISSES) {
  const skills: Record<string, SkillState> = { ...prev };
  const drill: string[] = [], due: string[] = [];
  for (const [skill, c] of Object.entries(counts)) {
    const p = prev[skill] || { status: 'none', clean: 0, misses: 0, slows: 0, lastDue: false };
    const m = effective(c, slowsAsMisses);
    const next: SkillState = { ...p, misses: c.misses, slows: c.slows };
    if (p.status === 'maintenance') {
      if (m >= MISSES_TO_LEAVE_MAINTENANCE) { Object.assign(next, { status: 'drilling', clean: 0, lastDue: false }); drill.push(skill); }
      else if (m === 1) { Object.assign(next, { clean: 0, lastDue: true }); due.push(skill); }
      else { const d = !p.lastDue; Object.assign(next, { clean: p.clean + 1, lastDue: d }); if (d) due.push(skill); }
    } else if (m >= 1) { Object.assign(next, { status: 'drilling', clean: 0 }); drill.push(skill); }
    else {
      next.clean = p.clean + 1;
      if (next.clean >= CLEAN_TESTS_FOR_MAINTENANCE) Object.assign(next, { status: 'maintenance', lastDue: false });
    }
    skills[skill] = next;
  }
  return { skills, drill, due };
}

// Most misses first; ties to more slows, then to lower lifetime bank accuracy (a skill with no answers counts as 0),
// then to the College Board order (`rank`).
export function orderSkills(skills: string[], counts: Record<string, SkillCount>, accuracy: Map<string, number | null>,
  rank: (skill: string) => number = () => 0, slowsAsMisses = SLOWS_COUNT_AS_MISSES): string[] {
  const acc = (k: string) => accuracy.get(k) ?? 0;
  return skills.slice().sort((a, b) =>
    effective(counts[b], slowsAsMisses) - effective(counts[a], slowsAsMisses) || counts[b].slows - counts[a].slows ||
    acc(a) - acc(b) || rank(a) - rank(b) || a.localeCompare(b));
}

export function addDays(date: string, days: number) {
  const d = new Date(date + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
export const daysBetween = (from: string, to: string) => Math.round((Date.parse(to + 'T00:00:00Z') - Date.parse(from + 'T00:00:00Z')) / 86400000);
// [DEFAULT] the warning: the newest logged test is fewer than MIN_DAYS_BETWEEN_TESTS days before this one.
export function tooSoon(state: PlanState, date: string): number | null {
  const last = state.tests.map(t => t.date).sort().at(-1);
  if (!last) return null;
  const d = daysBetween(last, date);
  return d < MIN_DAYS_BETWEEN_TESTS ? d : null;
}
// The test to take next: the lowest-numbered mapped test after this one that is not logged yet, else N + 1.
export function nextTestNumber(map: TestMap, logged: string[], number: number): number {
  const open = map.tests.filter(t => !logged.includes(t.id)).sort((a, b) => a.number - b.number);
  return (open.find(t => t.number > number) || { number: number + 1 }).number;
}

// Steps: drills -> consolidation (5 hard in each drilled skill) -> maintenance that is due -> the next test.
export function buildSteps(log: TestLog, drillOrder: string[], dueOrder: string[], counts: Record<string, SkillCount>, nextNumber: number): Step[] {
  const c = (k: string) => ({ misses: counts[k]?.misses || 0, slows: counts[k]?.slows || 0 });
  return [
    ...drillOrder.map((skill, n) => ({ id: `${log.testId}.d${n}`, kind: 'drill' as const, skill, ...c(skill) })),
    ...drillOrder.map((skill, n) => ({ id: `${log.testId}.c${n}`, kind: 'consolidate' as const, skill, ...c(skill) })),
    ...dueOrder.map((skill, n) => ({ id: `${log.testId}.m${n}`, kind: 'maintain' as const, skill, ...c(skill) })),
    { id: `${log.testId}.t`, kind: 'test', number: nextNumber, date: addDays(log.date, NEXT_TEST_DAYS) }
  ];
}

// The whole of logging a test: cycle state moved, plan rebuilt, log kept. `accuracy` is lifetime bank accuracy per
// skill with this test's answers included (the page computes it with the shared tally()).
export function logTest(state: PlanState, map: TestMap, log: TestLog, byId: Map<string, BankQ>, accuracy: Map<string, number | null>,
  rank?: (skill: string) => number, slowsAsMisses = SLOWS_COUNT_AS_MISSES) {
  const test = map.tests.find(t => t.id === log.testId);
  if (!test) throw new Error('Unknown practice test ' + log.testId);
  const items = resolveLog(test, log, byId);
  const counts = countBySkill(items);
  const cycle = advanceCycle(state.skills, counts, slowsAsMisses);
  const drillOrder = orderSkills(cycle.drill, counts, accuracy, rank, slowsAsMisses);
  const dueOrder = orderSkills(cycle.due, counts, accuracy, rank, slowsAsMisses);
  const logged = [...state.tests.map(t => t.testId), log.testId];
  const steps = buildSteps(log, drillOrder, dueOrder, counts, nextTestNumber(map, logged, test.number));
  const slowOnly = orderSkills(Object.keys(counts).filter(k => counts[k].slows && !effective(counts[k], slowsAsMisses)), counts, accuracy, rank, slowsAsMisses);
  const plan: Plan = { testId: log.testId, number: test.number, date: log.date, counts, slowOnly, steps };
  return { state: { v: 1 as const, tests: [...state.tests, log], skills: cycle.skills, plan }, items };
}

// ---------------- sets ----------------
// Every bank ID mapped to a practice test this student has not logged: never served, so later tests stay unseen.
export function blockedIds(map: TestMap, logged: string[]): Set<string> {
  const out = new Set<string>();
  for (const t of map.tests) if (!logged.includes(t.id))
    for (const s of SECTIONS) for (const m of ['m1', 'easy', 'hard'] as const) for (const id of t[s][m] || []) if (id) out.add(id);
  return out;
}

export type Progress = { attempts?: number; marker?: string; last_reviewed?: string };
// Seen: anything with a progress row or an attempt (bank, exams, self-paced lessons, logged tests), plus questions shown
// in lessons the student attended (instructor-paced lessons write no attempt).
export function seenIds(progress: Record<string, Progress>, attempts: { question_id: string }[], lessonSeen: Iterable<string> = []): Set<string> {
  const out = new Set<string>(lessonSeen);
  for (const [id, p] of Object.entries(progress)) if (p && (p.attempts || 0) > 0) out.add(id);
  for (const a of attempts) out.add(a.question_id);
  return out;
}

export type PoolContext = {
  questions: BankQ[];
  progress: Record<string, Progress>;
  seen: Set<string>;
  blocked: Set<string>;
  // In another unfinished set of this plan.
  reserved: Set<string>;
  // Has a stored answer (a set scores at the end; an unscorable question cannot be scored).
  scorable: (q: BankQ) => boolean;
  seed: string;
};
const hash = (s: string) => { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; };

// A set for one step: per segment, unseen questions of that skill and level (official before AI, in an order fixed by
// the step), then the least-recently-seen ones the student got right; a segment that is still short shrinks.
export function pickSet(kind: Exclude<StepKind, 'test'>, skill: string, ctx: PoolContext) {
  const chosen = new Set<string>();
  const segs: Segment[] = [];
  const ids: string[] = [];
  let short = false;
  for (const shape of SHAPES[kind]) {
    const level = shape.level.toLowerCase();
    const fits = ctx.questions.filter(q => (q.skill || 'Other') === skill && String(q.difficulty || '').toLowerCase() === level &&
      !ctx.blocked.has(q.id) && !ctx.reserved.has(q.id) && !chosen.has(q.id) && ctx.scorable(q));
    const unseen = fits.filter(q => !ctx.seen.has(q.id))
      .sort((a, b) => Number(!!a.ai) - Number(!!b.ai) || hash(ctx.seed + a.id) - hash(ctx.seed + b.id) || a.id.localeCompare(b.id));
    const right = fits.filter(q => ctx.seen.has(q.id) && ['Green', 'Orange'].includes(ctx.progress[q.id]?.marker || ''))
      .sort((a, b) => String(ctx.progress[a.id]?.last_reviewed || '').localeCompare(String(ctx.progress[b.id]?.last_reviewed || '')) || a.id.localeCompare(b.id));
    const take = [...unseen, ...right].slice(0, shape.n);
    if (take.length < shape.n) short = true;
    if (!take.length) continue;
    take.forEach(q => { chosen.add(q.id); ids.push(q.id); });
    segs.push({ level: shape.level, n: take.length, limitMs: take.length * shape.msPer, usedMs: 0, overMs: 0 });
  }
  return { ids, segs, short };
}

export function newRun(picked: { ids: string[]; segs: Segment[]; short: boolean }, now: string): SetRun {
  return { ...picked, seg: 0, i: 0, ans: {}, ms: {}, changes: {}, flags: {}, startedAt: now };
}
// The questions of the segment being played.
export function segmentIds(run: SetRun, seg = run.seg): string[] {
  const start = run.segs.slice(0, seg).reduce((n, s) => n + s.n, 0);
  return run.ids.slice(start, start + (run.segs[seg]?.n || 0));
}
// Time spent in a segment, with the overtime past its limit.
export function closeSegment(run: SetRun, usedMs: number) {
  const s = run.segs[run.seg];
  s.usedMs = Math.max(0, Math.round(usedMs));
  s.overMs = Math.max(0, s.usedMs - s.limitMs);
}
// Score at the end of the set. A blank is a miss on the score (and shows in the review), as in practice exams.
export function scoreRun(run: SetRun, byId: Map<string, BankQ>, isRight: (q: BankQ, v: string | null) => boolean | null) {
  let right = 0, scored = 0;
  const missed: string[] = [];
  for (const id of run.ids) {
    const q = byId.get(id); if (!q) continue;
    const ok = isRight(q, run.ans[id] || null);
    if (ok === null) continue;
    scored++;
    if (ok === true) right++; else missed.push(id);
  }
  Object.assign(run, { right, scored, missed });
  return { right, scored, missed };
}

// Plan order: the first step not done. The test step is done only by logging that test (which starts a new plan).
export const nextStep = (plan: Plan | null) => plan ? plan.steps.find(s => !s.done) || null : null;
export function stepTitle(s: Step) {
  if (s.kind === 'test') return `Take practice test ${s.number}`;
  return (s.kind === 'drill' ? 'Drill' : s.kind === 'consolidate' ? 'Consolidate' : 'Maintain') + ' · ' + s.skill;
}
export const stepSize = (s: Step) => s.kind === 'drill' ? '10 medium + 5 hard' : s.kind === 'test' ? '' : '5 hard';
