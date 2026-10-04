// The Analytics tab (rail tab id `dash`). public/index.html owns QS, PROG and LOG and hands them in; this island keeps
// the range, draws the cards and asks the page to start a set when a "Practice →" is clicked. Every number comes from
// ./analytics.ts (unit tests: tests/test_analytics.ts) or from the existing /shared/stats.js functions, unchanged.
import { useRef, useState, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { flushSync } from 'react-dom';
import * as Stats from '/shared/stats.js';
import * as A from './analytics';
import type { AAttempt, AProgress, AQuestion, Cell, LowRow, SlowRow } from './analytics';
import './analytics.css';

export type AnalyticsQuestion = AQuestion & { choices?: { letter: string; trap?: string }[] };
export type AnalyticsModel = { questions: AnalyticsQuestion[]; progress: Record<string, AProgress & { marker?: string; corrects?: number }>; log: AAttempt[] };
export type AnalyticsBridge = { practice(items: AnalyticsQuestion[]): void };
type Acc = { a: number; c: number };
type Tally = { sec: Record<string, Acc>; dom: Record<string, Acc>; skill: Record<string, Acc> };

// Bluebook blue, and an ordinal ramp of it for Easy -> Hard (dataviz validate_palette --ordinal: all checks pass).
const BLUE = '#2345be';
const TRACK = '#e7ebf6';
const DIFF_COLOR: Record<string, string> = { Easy: '#9db0ec', Medium: '#5a77d8', Hard: '#2345be' };
const RANGES: [number, string][] = [[1, 'Today'], [7, '7 days'], [30, '30 days'], [365, '12 months'], [0, 'All time']];
const RANGE_LABEL: Record<number, string> = { 0: 'all time', 1: 'today', 7: 'the last 7 days', 30: 'the last 30 days', 365: 'the last 12 months' };
const SEC_SHORT: Record<string, string> = { 'Reading & Writing': 'R&W', Math: 'Math' };
const targetOf = (q: AQuestion) => Stats.targetOf(q as Parameters<typeof Stats.targetOf>[0]);

// "—" and how many more answers it takes. Used everywhere a rate would rest on too few answers.
function Need({ n, what = 'answer' }: { n: number; what?: string }) {
  return <span className="an-need"><b>—</b><span>{what} {n} more to see this</span></span>;
}

function Card({ id, title, sub, take, need, wide, children, right }: { id: string; title: string; sub?: string; take: string | null; need?: number; wide?: boolean; children: ReactNode; right?: ReactNode }) {
  return <section className={`an-card${wide ? ' wide' : ''}`} data-card={id}>
    <header className="an-h"><div><h3>{title}</h3>{sub ? <p className="an-sub">{sub}</p> : null}</div>{right}</header>
    {take != null || need != null ? <p className="an-take" data-take>{take ?? `Answer ${need} more to see this.`}</p> : null}
    {children}
  </section>;
}

// One circle; each arc runs from `from` to `to` (0..1, clockwise from 12 o'clock). Round caps for a single value,
// butt caps with a 2px surface gap between the segments of a share.
type Arc = { from: number; to: number; color: string; title?: string };
function Ring({ arcs, size, stroke, r, round }: { arcs: Arc[]; size: number; stroke: number; r?: number; round?: boolean }) {
  const rad = r ?? (size - stroke) / 2, C = 2 * Math.PI * rad, gap = round ? 0 : arcs.length > 1 ? 2 : 0;
  return <g transform={`rotate(-90 ${size / 2} ${size / 2})`}>
    <circle cx={size / 2} cy={size / 2} r={rad} fill="none" stroke={TRACK} strokeWidth={stroke}/>
    {arcs.map((a, i) => {
      const len = Math.max(0, (a.to - a.from) * C - gap);
      return len > 0 ? <circle key={i} cx={size / 2} cy={size / 2} r={rad} fill="none" stroke={a.color} strokeWidth={stroke}
        strokeLinecap={round ? 'round' : 'butt'} strokeDasharray={`${len} ${C}`} strokeDashoffset={-a.from * C}>{a.title ? <title>{a.title}</title> : null}</circle> : null;
    })}
  </g>;
}
function Dial({ size, label, center, sub, children }: { size: number; label: string; center: string; sub?: string; children: ReactNode }) {
  return <div className="an-dial" style={{ width: size, height: size }}>
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} role="img" aria-label={label}>{children}</svg>
    <div className="an-dial-c"><b>{center}</b>{sub ? <span>{sub}</span> : null}</div>
  </div>;
}
const pctArc = (p: number | null, color = BLUE): Arc[] => p ? [{ from: 0, to: p / 100, color }] : [];
function MiniRing({ pct }: { pct: number }) {
  return <svg className="an-mini" width="22" height="22" viewBox="0 0 22 22" aria-hidden="true"><Ring arcs={pctArc(pct)} size={22} stroke={3.5} round/></svg>;
}

// Bars and heat squares share one pointer tooltip, moved by hand so a hover never re-renders the cards.
function useTip() {
  const tip = useRef<HTMLDivElement>(null);
  const move = (e: React.MouseEvent) => {
    const el = tip.current, t = (e.target as Element).closest<HTMLElement>('[data-tip]');
    if (!el) return;
    if (!t) { el.classList.remove('on'); return; }
    el.replaceChildren();
    const b = document.createElement('b'); b.textContent = t.dataset.tipT || ''; el.append(b, document.createElement('br'), t.dataset.tip || '');
    el.style.left = e.clientX + 'px'; el.style.top = (e.clientY - 14) + 'px';
    el.classList.add('on');
  };
  return { tip, on: { onMouseMove: move, onMouseLeave: () => tip.current?.classList.remove('on') } };
}

function ActivityChart({ bs, unit }: { bs: A.Bucket[]; unit: string }) {
  const max = A.niceMax(Math.max(1, ...bs.map(x => x.ok + x.no)));
  const h = (n: number) => `${(n / max * 100).toFixed(2)}%`;
  const step = Math.ceil(bs.length / 12);
  const span = bs.length > 1 ? `${bs[0].full} – ${bs[bs.length - 1].full}` : bs[0].full;
  return <>
    <div className="chart-wrap">
      <div className="chart-y"><span>{max}</span><span>{max / 2}</span><span>0</span></div>
      <div className="chart-plot">
        <div className="chart">{bs.map(x => {
          const tot = x.ok + x.no;
          return <span key={x.k} className="cbar" data-tip-t={x.full}
            data-tip={tot ? `${tot} answered · ${x.ok} right · ${x.no} wrong · ${Math.round(x.ok / tot * 100)}%` : 'No practice'}>
            {tot ? <><i className="no" style={{ height: h(x.no) }}/><i className="ok" style={{ height: h(x.ok) }}/></> : <i className="zero"/>}
          </span>;
        })}</div>
        <div className="chart-x">{bs.map((x, i) => <span key={x.k}>{i % step ? '' : x.lab}</span>)}</div>
      </div>
    </div>
    <div className="chart-cap">Up: questions answered &nbsp;&middot;&nbsp; across: one bar per {unit} &nbsp;&middot;&nbsp; {span}</div>
  </>;
}

function Heat({ h }: { h: ReturnType<typeof A.heat> }) {
  const day = (d: Date) => d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });
  return <>
    <div className="heat-wrap">
      <div className="heat-d"><span/><span>Mon</span><span/><span>Wed</span><span/><span>Fri</span><span/></div>
      <div>
        <div className="heat-m" style={{ gridTemplateColumns: `repeat(${A.HEAT_WEEKS},11px)` }}>
          {h.months.map(m => <span key={m.col} style={{ gridColumn: m.col }}>{m.date.toLocaleDateString(undefined, { month: 'short' })}</span>)}
        </div>
        <div className="heat">{h.cells.map(c => {
          const n = c.ok + c.no;
          return c.future ? <i key={c.key} className="fut"/>
            : <i key={c.key} className={A.heatLevel(n)} data-tip-t={day(c.date)} data-tip={n ? `${n} answered · ${c.ok} right · ${c.no} wrong` : 'No practice'}/>;
        })}</div>
      </div>
    </div>
    <div className="heat-key">One square is one day &nbsp;&middot;&nbsp; last {A.HEAT_WEEKS} weeks
      <span style={{ flex: 1 }}/>Fewer <i/><i className="l1"/><i className="l2"/><i className="l3"/><i className="l4"/> More</div>
  </>;
}

// A row with a bar: accuracy, or a share. Below the floor the bar is empty and the number is a "—".
function BarRow({ name, pct, tail, need, swatch }: { name: ReactNode; pct: number | null; tail: ReactNode; need?: number; swatch?: string }) {
  return <div className="an-row">
    <b>{swatch ? <i className="an-sw" style={{ background: swatch }}/> : null}{name}</b>
    <span className="an-bar"><i style={{ width: `${pct ?? 0}%` }}/></span>
    <span className="an-val">{pct == null && need ? <Need n={need}/> : tail}</span>
  </div>;
}
const accTail = (v: Acc) => { const p = A.rate(v); return <><b>{p == null ? '—' : `${p}%`}</b> &middot; {v.c}/{v.a}</>; };
const accRows = (keys: string[], map: Record<string, Acc>) => keys.map(k =>
  <BarRow key={k} name={k} pct={A.rate(map[k])} tail={accTail(map[k])} need={A.short(map[k].a)}/>);

function SectionAccuracy({ g }: { g: Record<string, A.SectionGroup> }) {
  return <div className="an-dials">{A.SECTIONS.map(s => {
    const v = g[s], p = A.rate(v);
    return <figure key={s} className="an-fig" data-section={s}>
      <Dial size={132} label={`${s} accuracy ${p == null ? 'not enough answers' : p + '%'}`} center={p == null ? '—' : `${p}%`} sub={`${v.c}/${v.a} right`}>
        <Ring arcs={pctArc(p)} size={132} stroke={12} round/>
      </Dial>
      <figcaption>{s}{p == null ? <Need n={A.short(v.a)}/> : null}</figcaption>
    </figure>;
  })}</div>;
}

function DifficultyCard({ section, g }: { section: string; g: A.SectionGroup }) {
  const size = 132, stroke = 9;
  const p = A.rate(g);
  return <Card id={`difficulty-${SEC_SHORT[section]}`} title={section} sub="Accuracy by difficulty · right / answered" take={A.takeDifficulty(section, g)}
    need={Math.min(...A.DIFFS.map(d => A.short(g.diff[d].a)))}>
    <div className="an-split">
      <Dial size={size} label={`${section} accuracy by difficulty`} center={p == null ? '—' : `${p}%`} sub="overall">
        {A.DIFFS.map((d, i) => {
          const dp = A.rate(g.diff[d]);
          return <Ring key={d} arcs={dp ? [{ from: 0, to: dp / 100, color: DIFF_COLOR[d], title: `${d}: ${dp}%` }] : []} size={size} stroke={stroke} r={(size - stroke) / 2 - i * (stroke + 3)} round/>;
        })}
      </Dial>
      <div className="an-legend">{A.DIFFS.map(d => {
        const v = g.diff[d], dp = A.rate(v);
        return <div key={d} className="an-lrow" data-diff={d}>
          <span className="an-lk"><i className="an-sw" style={{ background: DIFF_COLOR[d] }}/>{d}</span>
          {dp == null ? <Need n={A.short(v.a)}/> : <span className="an-lv"><b>{dp}%</b><span>{v.c}/{v.a} right</span></span>}
        </div>;
      })}</div>
    </div>
  </Card>;
}

function TimeCard({ section, g }: { section: string; g: A.SectionGroup }) {
  const size = 132, total = g.ms, enough = g.timed >= A.MIN_SAMPLE;
  let from = 0;
  const arcs: Arc[] = enough ? A.DIFFS.flatMap(d => {
    const share = total ? g.diff[d].ms / total : 0, a = { from, to: from + share, color: DIFF_COLOR[d], title: `${d}: ${Math.round(share * 100)}% of the time` };
    from += share;
    return share ? [a] : [];
  }) : [];
  return <Card id={`time-${SEC_SHORT[section]}`} title={section} sub="Time share by difficulty · average vs recommended time" take={A.takeTime(section, g)}
    need={Math.min(...A.DIFFS.map(d => A.short(g.diff[d].timed)))}>
    <div className="an-split">
      <Dial size={size} label={`${section} time share by difficulty`} center={enough ? A.fmtTime(total) : '—'} sub={enough ? 'total' : `${A.short(g.timed)} more timed`}>
        <Ring arcs={arcs} size={size} stroke={14}/>
      </Dial>
      <div className="an-legend">{A.DIFFS.map(d => {
        const v = g.diff[d], avg = A.avgMs(v), tgt = A.targetMs(v);
        return <div key={d} className="an-lrow" data-diff={d}>
          <span className="an-lk"><i className="an-sw" style={{ background: DIFF_COLOR[d] }}/>{d}{enough && v.ms ? <em>{Math.round(v.ms / total * 100)}%</em> : null}</span>
          {avg == null || tgt == null ? <Need n={A.short(v.timed)} what="time"/>
            : <span className="an-lv"><b>{A.fmtTime(avg)}</b><span>target {A.fmtTime(tgt)} · <span className={avg > tgt ? 'an-over' : 'an-under'}>{A.overLabel(avg - tgt)}</span></span></span>}
        </div>;
      })}</div>
    </div>
  </Card>;
}

function LowestList({ rows, practice }: { rows: LowRow[]; practice: (skill: string) => void }) {
  return <ol className="an-list">{rows.map((r, i) =>
    <li key={r.skill} className="an-item" data-skill={r.skill}>
      <span className="an-rank">{String(i + 1).padStart(2, '0')}</span>
      <div className="an-name"><span className="an-meta">{r.section} · {r.a} answers · {r.c} right</span><b>{r.skill}</b></div>
      <span className="an-pct"><MiniRing pct={r.pct}/><b>{r.pct}%</b></span>
      <button type="button" className="an-go" data-practice={r.skill} onClick={() => practice(r.skill)}>Practice →</button>
    </li>)}</ol>;
}

function SlowList({ rows, practice }: { rows: SlowRow[]; practice: (skill: string) => void }) {
  return <ol className="an-list">{rows.map((r, i) =>
    <li key={r.skill} className="an-item" data-skill={r.skill}>
      <span className="an-rank">{String(i + 1).padStart(2, '0')}</span>
      <div className="an-name"><span className="an-meta">{r.section} · {r.timed} timed</span><b>{r.skill}</b></div>
      <span className="an-times"><span><b data-avg>{A.fmtTime(r.avgMs)}</b> avg</span><span data-target>target {A.fmtTime(r.targetMs)}</span>
        <span className={r.overMs > 0 ? 'an-over' : 'an-under'} data-over>{A.overLabel(r.overMs)} · {r.overPct > 0 ? '+' : r.overPct < 0 ? '−' : ''}{Math.abs(r.overPct)}%</span></span>
      <button type="button" className="an-go" data-practice={r.skill} onClick={() => practice(r.skill)}>Practice →</button>
    </li>)}</ol>;
}

function Analytics({ model, bridge }: { model: AnalyticsModel; bridge: AnalyticsBridge }) {
  const [range, setRange] = useState(30);
  const { tip, on } = useTip();
  const { questions: qs, progress: prog, log: all } = model;
  const now = new Date();
  const log = A.inRange(all, range, now);
  const label = RANGE_LABEL[range];
  const tot = A.totals(qs, log, targetOf), acc = A.rate(tot);
  const sec = A.sectionStats(qs, log, targetOf);
  const skills = A.skillStats(qs, log, targetOf);
  const low = A.lowestAccuracy(skills), slow = A.slowestVsTarget(skills);
  const nearest = (f: (r: Cell) => number) => A.short(Math.max(0, ...skills.map(f)));
  const bs = A.buckets(log, range, now);
  const h = A.heat(all, now), run = A.streak(all, now);
  const t = Stats.tally(qs as Parameters<typeof Stats.tally>[0], prog) as unknown as Tally;
  const domSec: Record<string, string> = {};
  qs.forEach(q => { if (q.domain) domSec[q.domain] ||= q.section || 'Other'; });
  const tried = (m: Record<string, Acc>) => Stats.cbSort(Object.keys(m).filter(k => m[k].a)) as string[];
  const traps = Stats.trapCounts(qs, log) as [string, number][];
  const pc = Stats.pacing(qs, log) as { rushed: number; onPace: number; slow: number; ms: Record<string, number>; n: Record<string, number> };
  const pn = pc.rushed + pc.onPace + pc.slow;
  const g = Stats.guessing(log) as { n: number; mean: number; changedN: number; changedAcc: number | null; steadyAcc: number | null };
  const lv = (Stats.breakdown(qs, prog, log) as unknown as { level: Record<string, Acc> }).level;
  const practice = (skill: string) => bridge.practice(A.skillDrill(qs, prog, skill));

  return <div className="an">
    <div className="an-top">
      <div className="seg" id="db-range" role="group" aria-label="Range">{RANGES.map(([r, lab]) =>
        <button key={r} type="button" data-r={r} className={r === range ? 'on' : ''} aria-pressed={r === range} onClick={() => setRange(r)}>{lab}</button>)}</div>
      <span className="an-range">Showing {label}</span>
    </div>

    <div className="cards" id="db-overview">
      <div className="card" data-stat="answered"><div className="k">Answered</div><div className="v">{tot.a.toLocaleString()}</div></div>
      <div className="card" data-stat="accuracy"><div className="k">Accuracy</div><div className="v">{acc == null ? '—' : `${acc}%`}</div>
        {acc == null ? <div className="s">answer {A.short(tot.a)} more to see this</div> : <div className="s">{tot.c}/{tot.a} right</div>}</div>
      <div className="card" data-stat="time"><div className="k">Time practiced</div><div className="v">{A.fmtTime(tot.ms)}</div>
        <div className="s">{A.avgMs(tot) == null ? `time ${A.short(tot.timed)} more for an average` : `${A.fmtTime(A.avgMs(tot)!)} per question`}</div></div>
      <div className="card" data-stat="streak"><div className="k">Day streak</div><div className="v">{run}</div><div className="s">{run === 1 ? 'day' : 'days'} in a row</div></div>
    </div>

    <Card id="sections" title="Accuracy by section" sub={`Right / answered over ${label}`} take={A.takeSections(sec)}
      need={A.short(Math.max(...A.SECTIONS.map(s => sec[s].a)))} wide><SectionAccuracy g={sec}/></Card>

    <div className="an-grid">{A.SECTIONS.map(s => <DifficultyCard key={s} section={s} g={sec[s]}/>)}</div>
    <div className="an-grid">{A.SECTIONS.map(s => <TimeCard key={s} section={s} g={sec[s]}/>)}</div>

    <Card id="lowest" title="5 lowest-accuracy skills" sub={`Skills with ${A.MIN_SAMPLE}+ answers over ${label}`} take={A.takeLowest(low)} need={nearest(r => r.a)} wide>
      {low.length ? <LowestList rows={low} practice={practice}/> : <div className="an-empty"><Need n={nearest(r => r.a)}/> <span>in one skill</span></div>}
    </Card>
    <Card id="slowest" title="5 skills slowest vs target" sub={`Skills with ${A.MIN_SAMPLE}+ timed answers · target is the recommended time for the questions you answered`}
      take={A.takeSlowest(slow)} need={nearest(r => r.timed)} wide>
      {slow.length ? <SlowList rows={slow} practice={practice}/> : <div className="an-empty"><Need n={nearest(r => r.timed)} what="time"/> <span>in one skill</span></div>}
    </Card>

    <div {...on}>
      <Card id="activity" title="Questions answered" sub={`${tot.a.toLocaleString()} over ${label}`} take={A.takeActivity(bs, label)} need={1} wide
        right={<div className="legend"><span><i style={{ background: BLUE }}/>Right</span><span><i style={{ background: 'var(--red)' }}/>Wrong</span></div>}>
        {all.length ? <ActivityChart bs={bs} unit={A.byMonth(range) ? 'month' : 'day'}/> : <div className="an-empty">Answer a question and this fills in.</div>}
      </Card>
      <Card id="heat" title="Practice activity" sub={`${all.length.toLocaleString()} answered across ${h.days} day${h.days === 1 ? '' : 's'} · not affected by the range`}
        take={A.takeHeat(h.days, run)} need={1} wide><Heat h={h}/></Card>
    </div>

    <div className="an-grid">
      <Card id="domains" title="Accuracy by domain" sub="Where each question stands now (corrected counts as right) · all time" take={A.takeWeakest(t.dom, 'domain')} need={A.short(Math.max(0, ...Object.values(t.dom).map(v => v.a)))}>
        {tried(t.dom).length ? A.SECTIONS.concat('Other').map(s => {
          const ds = tried(t.dom).filter(d => (domSec[d] || 'Other') === s);
          return ds.length ? <div key={s} className="an-group"><BarRow name={s} pct={A.rate(t.sec[s] || { a: 0, c: 0 })} tail={accTail(t.sec[s] || { a: 0, c: 0 })} need={A.short((t.sec[s] || { a: 0 }).a)}/>{accRows(ds, t.dom)}</div> : null;
        }) : <div className="an-empty">No answers yet.</div>}
      </Card>
      <Card id="skills" title="Accuracy by skill" sub="Where each question stands now (corrected counts as right) · all time" take={A.takeStrongSkills(t.skill)} need={A.short(Math.max(0, ...Object.values(t.skill).map(v => v.a)))}>
        {tried(t.skill).length ? accRows(tried(t.skill), t.skill) : <div className="an-empty">No answers yet.</div>}
      </Card>
      <Card id="traps" title="Traps you fall for" sub={`Which wrong choice a miss picked · ${label}`} take={A.takeTraps(traps)}>
        {traps.length ? traps.slice(0, 10).map(([name, n]) => <BarRow key={name} name={name} pct={Math.round(n / traps[0][1] * 100)} tail={<b>{n}</b>}/>)
          : <div className="an-empty">Nothing yet. Miss a question and the trap it used shows up here.</div>}
      </Card>
      <Card id="pacing" title="Pacing" sub={`Each timed answer against its recommended time · ${label}`} take={A.takePacing(pc)} need={A.short(pn)}>
        {pn >= A.MIN_SAMPLE ? <>
          {([['rushed', 'Rushed (under 60%)'], ['onPace', 'On pace'], ['slow', 'Slow (over 140%)']] as const).map(([k, lab]) =>
            <BarRow key={k} name={lab} pct={Math.round(pc[k] / pn * 100)} tail={<><b>{Math.round(pc[k] / pn * 100)}%</b> &middot; {pc[k]}</>}/>)}
          {A.SECTIONS.filter(s => pc.n[s]).map(s => {
            const avg = pc.ms[s] / pc.n[s], tgt = Stats.TARGET_MS[s as keyof typeof Stats.TARGET_MS] || 85000;
            return <BarRow key={s} name={`${s} average`} pct={pc.n[s] >= A.MIN_SAMPLE ? Math.min(100, Math.round(avg / tgt * 100)) : null}
              tail={<><b>{A.fmtTime(avg)}</b> vs {A.fmtTime(tgt)}</>} need={A.short(pc.n[s])}/>;
          })}
        </> : <div className="an-empty"><Need n={A.short(pn)} what="time"/></div>}
      </Card>
      <Card id="guessing" title="Second-guessing" sub={`Accuracy when you changed your answer vs kept it · ${label}`} take={A.takeGuessing(g)}
        need={Math.max(A.short(g.changedN), A.short(g.n - g.changedN))}>
        {g.n ? <>
          <BarRow name="Changed answer" pct={g.changedN >= A.MIN_SAMPLE ? g.changedAcc : null} tail={<><b>{g.changedAcc}%</b> &middot; {g.changedN}</>} need={A.short(g.changedN)}/>
          <BarRow name="Kept first pick" pct={g.n - g.changedN >= A.MIN_SAMPLE ? g.steadyAcc : null} tail={<><b>{g.steadyAcc}%</b> &middot; {g.n - g.changedN}</>} need={A.short(g.n - g.changedN)}/>
          <p className="an-foot">{g.mean.toFixed(2)} switches per question</p>
        </> : <div className="an-empty">No answers logged since switch tracking shipped.</div>}
      </Card>
      <Card id="levels" title="Accuracy by level" sub={`Levels 4 and 5 are the AI bank · ${label}`} take={A.takeLevels(lv)} need={A.short(Math.max(0, ...Object.values(lv).map(v => v.a)))}>
        {Object.keys(lv).length ? Object.keys(lv).sort().map(k =>
          <BarRow key={k} name={`Level ${k}${Number(k) >= 4 ? ' · AI' : ''}`} pct={A.rate(lv[k])} tail={accTail(lv[k])} need={A.short(lv[k].a)}/>)
          : <div className="an-empty">No answers yet.</div>}
      </Card>
    </div>
    <div className="tip" ref={tip}/>
  </div>;
}

export function mountAnalytics(root: HTMLElement, bridge: AnalyticsBridge) {
  const react = createRoot(root);
  let model: AnalyticsModel | null = null;
  const render = () => flushSync(() => react.render(model ? <Analytics model={model} bridge={bridge}/> : <p className="an-empty">Loading…</p>));
  render();
  return {
    update(next: AnalyticsModel) { model = next; render(); },
    destroy() { react.unmount(); }
  };
}
