// Analytics (the rail's Analytics tab, tab id `dash`): every number the page draws, as pure functions over the bank,
// the progress rows and the attempt log. Analytics.tsx draws them; tests/test_analytics.ts checks them by hand.
//
// Type-stripping safe on purpose (no enums, namespaces or parameter properties, no '/shared' imports), like record.ts:
// the unit test loads this file directly, so `targetOf` from /shared/stats.js is handed in, never copied.
//
// Rates and averages come from the attempt log, one row per graded first try, so a re-drill counts again. Dates are
// local calendar days (CLAUDE.md): an answer at 11pm belongs to the day you were sitting there, not to tomorrow.

// [DEFAULT] No rate or average is shown from fewer answers than this: the card says how many more it needs.
export const MIN_SAMPLE = 5;
export const TOP_N = 5;
// [DEFAULT] Questions in a "Practice →" set from a top-5 row.
export const DRILL_N = 10;
export const SECTIONS = ['Reading & Writing', 'Math'];
export const DIFFS = ['Easy', 'Medium', 'Hard'];
export const HEAT_WEEKS = 26;

export type AQuestion = { id: string; section?: string; domain?: string; skill?: string; difficulty?: string; level?: number };
export type AAttempt = { question_id: string; ts: string; correct?: number | boolean | null; time_taken_ms?: number | null };
export type AProgress = { attempts?: number; last_reviewed?: string | null };
export type TargetOf = (q: AQuestion) => number;

// One group of answers: answered, right, total time over the timed ones, and the recommended time for those same ones.
export type Cell = { a: number; c: number; ms: number; timed: number; target: number };
export type SectionGroup = Cell & { diff: Record<string, Cell> };
export type SkillRow = Cell & { skill: string; section: string };

const cell = (): Cell => ({ a: 0, c: 0, ms: 0, timed: 0, target: 0 });
const pad2 = (n: number) => String(n).padStart(2, '0');
export const dayKey = (d: Date) => d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate());
export const monthKey = (d: Date) => d.getFullYear() + '-' + pad2(d.getMonth() + 1);

// Accuracy as a whole percent, or null below the sample floor: never 0% from one wrong answer.
export const rate = (v: { a: number; c: number }, min = MIN_SAMPLE) => v.a >= min && v.a > 0 ? Math.round(v.c / v.a * 100) : null;
// How many more answers a card needs before it shows a number.
export const short = (n: number, min = MIN_SAMPLE) => Math.max(0, min - n);
export const avgMs = (v: Cell, min = MIN_SAMPLE) => v.timed >= min && v.timed > 0 ? v.ms / v.timed : null;
export const targetMs = (v: Cell) => v.timed ? v.target / v.timed : null;

// 46s, 1m 14s, 1h 37m.
export function fmtTime(ms: number) {
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m${s % 60 ? ` ${s % 60}s` : ''}`;
  const m = Math.round(s / 60);
  return `${Math.floor(m / 60)}h${m % 60 ? ` ${m % 60}m` : ''}`;
}
const signed = (s: number) => (s > 0 ? '+' : s < 0 ? '−' : '±') + Math.abs(s);

// --- range: 1, 7, 30 are days ending today; 365 is the twelve calendar months ending this one; 0 is all time.
export const byMonth = (range: number) => range === 0 || range > 90;
export function rangeStart(range: number, now: Date): Date | null {
  if (!range) return null;
  if (!byMonth(range)) return new Date(now.getFullYear(), now.getMonth(), now.getDate() - (range - 1));
  return new Date(now.getFullYear(), now.getMonth() - (Math.round(range / 30) - 1), 1);
}
export function inRange<T extends AAttempt>(log: T[], range: number, now: Date): T[] {
  const start = rangeStart(range, now);
  return start ? log.filter(x => new Date(x.ts) >= start) : log.slice();
}

// --- activity chart: one column per day for the short ranges, per month once a year of them would not fit.
export type Bucket = { k: string; lab: string; full: string; ok: number; no: number; ms: number };
export function buckets(log: AAttempt[], range: number, now: Date): Bucket[] {
  const out: Bucket[] = [], months = byMonth(range);
  if (!months) {
    for (let i = range - 1; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() - i);
      out.push({ k: dayKey(d), lab: range <= 7 ? d.toLocaleDateString(undefined, { weekday: 'short' }) : d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }),
        full: d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' }), ok: 0, no: 0, ms: 0 });
    }
  } else {
    let first = rangeStart(range, now) || new Date(now.getFullYear(), now.getMonth(), 1);
    if (!range && log.length) {
      const e = new Date(log.reduce((m, x) => (x.ts < m ? x.ts : m), log[0].ts));
      first = new Date(e.getFullYear(), e.getMonth(), 1);
    }
    for (const d = new Date(first); d <= now; d.setMonth(d.getMonth() + 1))
      out.push({ k: monthKey(d), lab: d.toLocaleDateString(undefined, { month: 'short' }),
        full: d.toLocaleDateString(undefined, { month: 'long', year: 'numeric' }), ok: 0, no: 0, ms: 0 });
  }
  const idx = new Map(out.map(x => [x.k, x]));
  for (const x of log) {
    const t = new Date(x.ts), slot = idx.get(months ? monthKey(t) : dayKey(t));
    if (!slot) continue;
    if (x.correct) slot.ok++; else slot.no++;
    slot.ms += x.time_taken_ms || 0;
  }
  return out;
}

// A bar's height stands for a number, so the axis runs to a rounded ceiling, not to the tallest day.
export function niceMax(n: number) {
  if (n <= 4) return 4;
  const p = 10 ** Math.floor(Math.log10(n));
  return p * ([1, 2, 3, 4, 5, 6, 8, 10].find(m => p * m >= n) || 10);
}

// --- heat map: HEAT_WEEKS columns of seven days, Sunday on top, running to the end of this week.
export type HeatCell = { key: string; date: Date; ok: number; no: number; future: boolean };
export function heat(log: AAttempt[], now: Date, weeks = HEAT_WEEKS) {
  const per: Record<string, { ok: number; no: number }> = {};
  for (const x of log) {
    const v = per[dayKey(new Date(x.ts))] ||= { ok: 0, no: 0 };
    if (x.correct) v.ok++; else v.no++;
  }
  const end = new Date(now.getFullYear(), now.getMonth(), now.getDate() + (6 - now.getDay()));
  const cells: HeatCell[] = [], months: { col: number; date: Date }[] = [];
  let lastM = -1;
  for (let j = 0; j < weeks * 7; j++) {
    const d = new Date(end.getFullYear(), end.getMonth(), end.getDate() - (weeks * 7 - 1 - j));
    if (j % 7 === 0 && d.getMonth() !== lastM) { lastM = d.getMonth(); months.push({ col: j / 7 + 1, date: d }); }
    const v = per[dayKey(d)] || { ok: 0, no: 0 };
    cells.push({ key: dayKey(d), date: d, ok: v.ok, no: v.no, future: d > now });
  }
  return { cells, months, days: cells.filter(c => c.ok + c.no).length };
}
export const heatLevel = (n: number) => !n ? '' : n < 3 ? 'l1' : n < 8 ? 'l2' : n < 20 ? 'l3' : 'l4';

// Days in a row, counting back. An empty today does not break yesterday's run until the day is over.
export function streak(log: AAttempt[], now: Date) {
  const days = new Set(log.map(x => dayKey(new Date(x.ts))));
  const d = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  if (!days.has(dayKey(d))) d.setDate(d.getDate() - 1);
  let n = 0;
  while (days.has(dayKey(d))) { n++; d.setDate(d.getDate() - 1); }
  return n;
}

// --- aggregation. Rows without a verdict (correct null) are skipped, as Stats.breakdown does.
function add(v: Cell, x: AAttempt, q: AQuestion, targetOf: TargetOf) {
  v.a++;
  if (x.correct) v.c++;
  if ((x.time_taken_ms || 0) > 0) { v.ms += x.time_taken_ms as number; v.timed++; v.target += targetOf(q); }
}
const graded = (log: AAttempt[], qs: AQuestion[]) => {
  const byId = new Map(qs.map(q => [q.id, q]));
  return log.flatMap(x => { const q = byId.get(x.question_id); return q && x.correct != null ? [[x, q] as const] : []; });
};

export function totals(qs: AQuestion[], log: AAttempt[], targetOf: TargetOf): Cell {
  const t = cell();
  for (const [x, q] of graded(log, qs)) add(t, x, q, targetOf);
  return t;
}

// Per section, and per Easy/Medium/Hard inside it. AI questions are Hard (levels 4-5) and count as Hard here.
export function sectionStats(qs: AQuestion[], log: AAttempt[], targetOf: TargetOf): Record<string, SectionGroup> {
  const out: Record<string, SectionGroup> = {};
  for (const s of SECTIONS) out[s] = { ...cell(), diff: Object.fromEntries(DIFFS.map(d => [d, cell()])) };
  for (const [x, q] of graded(log, qs)) {
    const g = out[q.section || 'Other'] ||= { ...cell(), diff: Object.fromEntries(DIFFS.map(d => [d, cell()])) };
    add(g, x, q, targetOf);
    const d = g.diff[q.difficulty || ''];
    if (d) add(d, x, q, targetOf);
  }
  return out;
}

export function skillStats(qs: AQuestion[], log: AAttempt[], targetOf: TargetOf): SkillRow[] {
  const out = new Map<string, SkillRow>();
  for (const [x, q] of graded(log, qs)) {
    const k = q.skill || 'Other';
    let v = out.get(k);
    if (!v) out.set(k, v = { ...cell(), skill: k, section: q.section || 'Other' });
    add(v, x, q, targetOf);
  }
  return [...out.values()];
}

// "5 lowest-accuracy skills": at least `min` answers; lowest accuracy first, then the one with more answers behind it.
export type LowRow = { skill: string; section: string; a: number; c: number; pct: number };
export function lowestAccuracy(rows: SkillRow[], n = TOP_N, min = MIN_SAMPLE): LowRow[] {
  return rows.filter(r => r.a >= min)
    .sort((x, y) => x.c / x.a - y.c / y.a || y.a - x.a || x.skill.localeCompare(y.skill))
    .slice(0, n).map(r => ({ skill: r.skill, section: r.section, a: r.a, c: r.c, pct: Math.round(r.c / r.a * 100) }));
}

// "5 skills slowest vs target": at least `min` timed answers. The target is the mean recommended time (targetOf: skill
// x difficulty) of the questions actually answered, so a student drilling Hard questions is held to the Hard time.
// Ranked by how far over in percent, so a 60s skill 30s over outranks a 120s skill 30s over.
export type SlowRow = { skill: string; section: string; timed: number; avgMs: number; targetMs: number; overMs: number; overPct: number };
export function slowestVsTarget(rows: SkillRow[], n = TOP_N, min = MIN_SAMPLE): SlowRow[] {
  return rows.filter(r => r.timed >= min && r.target > 0)
    .sort((x, y) => y.ms / y.target - x.ms / x.target || (y.ms - y.target) / y.timed - (x.ms - x.target) / x.timed || x.skill.localeCompare(y.skill))
    .slice(0, n).map(r => ({ skill: r.skill, section: r.section, timed: r.timed, avgMs: r.ms / r.timed, targetMs: r.target / r.timed,
      overMs: (r.ms - r.target) / r.timed, overPct: Math.round((r.ms / r.target - 1) * 100) }));
}

// "Practice →": one skill, both banks, unseen first, then longest since seen; levels taken in turn so the focus
// ladder has something to climb into (the same rule focusSet uses across skills).
export function skillDrill<Q extends AQuestion>(qs: Q[], progress: Record<string, AProgress>, skill: string, n = DRILL_N): Q[] {
  const lvl = (q: Q) => q.level || 2;
  const pool = qs.filter(q => (q.skill || 'Other') === skill).sort((a, b) => {
    const pa = progress[a.id], pb = progress[b.id];
    return (pa ? 1 : 0) - (pb ? 1 : 0) || String(pa?.last_reviewed || '').localeCompare(String(pb?.last_reviewed || '')) || lvl(a) - lvl(b);
  });
  const out: Q[] = [], used: Record<number, number> = {};
  while (out.length < n && pool.length) {
    let bi = 0, bs = Infinity;
    for (let i = 0; i < pool.length; i++) {
      const k = used[lvl(pool[i])] || 0;
      if (k < bs) { bs = k; bi = i; if (!k) break; }
    }
    const q = pool.splice(bi, 1)[0];
    used[lvl(q)] = (used[lvl(q)] || 0) + 1;
    out.push(q);
  }
  return out;
}

// --- one-line takeaways. Each returns null when there is not enough to say; the card then says what it needs.
const SHORT: Record<string, string> = { 'Reading & Writing': 'Reading & Writing', Math: 'Math' };

export function takeSections(g: Record<string, SectionGroup>): string | null {
  const [rw, m] = SECTIONS.map(s => rate(g[s]));
  if (rw != null && m != null) return rw === m ? `Both sections are at ${rw}%.`
    : rw > m ? `Reading & Writing is your stronger section: ${rw}% vs ${m}% in Math.` : `Math is your stronger section: ${m}% vs ${rw}% in Reading & Writing.`;
  if (rw != null) return `Reading & Writing is at ${rw}%. Answer ${short(g.Math.a)} more Math to compare.`;
  if (m != null) return `Math is at ${m}%. Answer ${short(g['Reading & Writing'].a)} more Reading & Writing to compare.`;
  return null;
}

export function takeDifficulty(section: string, g: SectionGroup): string | null {
  const known = DIFFS.map(d => [d, rate(g.diff[d])] as const).filter(([, p]) => p != null) as [string, number][];
  if (!known.length) return null;
  if (known.length === 1) return `${known[0][0]} ${SHORT[section] || section}: ${known[0][1]}% right so far.`;
  const worst = known.reduce((a, b) => (b[1] < a[1] ? b : a));
  return `${worst[0]} ${SHORT[section] || section} is where you lose the most: ${worst[1]}% right.`;
}

export function takeTime(section: string, g: SectionGroup): string | null {
  const known = DIFFS.flatMap(d => { const avg = avgMs(g.diff[d]), tgt = targetMs(g.diff[d]); return avg != null && tgt != null ? [[d, avg - tgt] as const] : []; });
  if (!known.length) return null;
  const worst = known.reduce((a, b) => (b[1] > a[1] ? b : a));
  const s = Math.round(worst[1] / 1000);
  return s > 0 ? `${worst[0]} ${SHORT[section] || section} is ${s}s over target on average.`
    : `Every ${SHORT[section] || section} difficulty you have timed is within target.`;
}

export function takeLowest(rows: LowRow[]): string | null {
  return rows.length ? `${rows[0].skill} is your weakest skill: ${rows[0].pct}% over ${rows[0].a} answers.` : null;
}

export function takeSlowest(rows: SlowRow[]): string | null {
  if (!rows.length) return null;
  const r = rows[0], s = Math.round(r.overMs / 1000);
  return s > 0 ? `${r.skill} runs ${s}s (${r.overPct}%) over target.` : 'No skill you have timed is over target.';
}

export function takeActivity(bs: Bucket[], label: string): string | null {
  const done = bs.reduce((n, x) => n + x.ok + x.no, 0);
  if (!done) return null;
  if (bs.length === 1) return `${done.toLocaleString()} answered ${label}.`;
  const top = bs.reduce((a, b) => (b.ok + b.no > a.ok + a.no ? b : a));
  return `${done.toLocaleString()} answered over ${label}. Busiest ${top.k.length === 7 ? 'month' : 'day'}: ${top.full}, with ${top.ok + top.no}.`;
}

export function takeHeat(days: number, run: number): string | null {
  if (!days) return null;
  return `You practiced on ${days} day${days === 1 ? '' : 's'} in the last ${HEAT_WEEKS} weeks. Current streak: ${run} day${run === 1 ? '' : 's'}.`;
}

// Current-state accuracy (Stats.tally: Orange counts as right): the weakest group with enough answers behind it.
export function takeWeakest(map: Record<string, { a: number; c: number }>, noun: string): string | null {
  const known = Object.entries(map).flatMap(([k, v]) => { const p = rate(v); return p != null ? [[k, p] as const] : []; });
  if (!known.length) return null;
  const worst = known.reduce((a, b) => (b[1] < a[1] ? b : a));
  return `Your weakest ${noun} right now is ${worst[0]} at ${worst[1]}%.`;
}

export function takeStrongSkills(map: Record<string, { a: number; c: number }>): string | null {
  const known = Object.values(map).map(v => rate(v)).filter(p => p != null) as number[];
  if (!known.length) return null;
  const good = known.filter(p => p >= 80).length;
  return `${good} of ${known.length} skill${known.length === 1 ? '' : 's'} with ${MIN_SAMPLE}+ answers ${known.length === 1 ? 'is' : 'are'} at 80% or better.`;
}

export function takeTraps(traps: [string, number][]): string | null {
  return traps.length ? `Your most common trap is ${traps[0][0]}: ${traps[0][1]} miss${traps[0][1] === 1 ? '' : 'es'}.` : null;
}

export function takePacing(p: { rushed: number; onPace: number; slow: number }): string | null {
  const n = p.rushed + p.onPace + p.slow;
  if (n < MIN_SAMPLE) return null;
  const pc = (k: number) => Math.round(k / n * 100);
  return `${pc(p.onPace)}% of your timed answers are on pace; ${pc(p.rushed)}% rushed, ${pc(p.slow)}% slow.`;
}

export function takeGuessing(g: { n: number; changedN: number; changedAcc: number | null; steadyAcc: number | null }): string | null {
  if (g.changedN < MIN_SAMPLE || g.n - g.changedN < MIN_SAMPLE || g.changedAcc == null || g.steadyAcc == null) return null;
  const d = g.changedAcc - g.steadyAcc;
  return d > 0 ? `Changing your answer pays off: ${g.changedAcc}% right vs ${g.steadyAcc}% when you kept your first pick.`
    : d < 0 ? `Changing your answer costs you: ${g.changedAcc}% right vs ${g.steadyAcc}% when you kept your first pick.`
    : `Changing your answer makes no difference: ${g.changedAcc}% either way.`;
}

export function takeLevels(levels: Record<string, { a: number; c: number }>): string | null {
  const known = Object.keys(levels).sort().flatMap(k => { const p = rate(levels[k]); return p != null ? [[k, p] as const] : []; });
  if (!known.length) return null;
  if (known.length === 1) return `Level ${known[0][0]}: ${known[0][1]}% right so far.`;
  const worst = known.reduce((a, b) => (b[1] < a[1] ? b : a));
  return `Level ${worst[0]} is your weakest at ${worst[1]}%.`;
}

// Signed seconds for the slowest list: +18s, −4s.
export const overLabel = (ms: number) => `${signed(Math.round(ms / 1000))}s`;
