import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { flushSync } from 'react-dom';
import { ChevronDown, SlidersHorizontal } from 'lucide-react';
import { EXTRA_FILTERS } from './extraFilters';
import { allPicked, toggleOption, toggleSkills } from './selection';
import type { HomeBridge, HomeFilters, HomeModel, Tally } from './types';
import './qbank.css';

const DIFFS = ['Easy', 'Medium', 'Hard'];
const BANKS: [string, string][] = [['official', 'Official'], ['ai', 'AI']];
const COUNTS: [number, string][] = [[10, '10'], [20, '20'], [30, '30'], [50, '50'], [0, 'All']];
const LESSON: [string, string][] = [['show-all', 'Show all'], ['hide-attended', 'Hide questions from lessons I attended'], ['hide-all', 'Hide all lesson questions']];
const LESSON_SHORT: Record<string, string> = { 'hide-attended': 'Hide attended', 'hide-all': 'Hide all' };

const pct = (t: Tally) => t.a ? Math.round(t.c / t.a * 100) : null;
function Acc({ t }: { t: Tally }) {
  const p = pct(t);
  return <span className={`qb-acc${p == null ? '' : p >= 80 ? ' good' : p >= 60 ? ' ok' : ' low'}`}>{p == null ? '—' : `${p}%`}</span>;
}

// A chip that opens a small card under it. Outside click and Escape close it.
function Menu({ id, label, active, badge, children, wide, closeOnPick }: { id: string; label: ReactNode; active?: boolean; badge?: number; children: ReactNode; wide?: boolean; closeOnPick?: boolean }) {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const away = (e: Event) => { if (!box.current?.contains(e.target as Node)) setOpen(false); };
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') { setOpen(false); box.current?.querySelector('button')?.focus(); } };
    document.addEventListener('pointerdown', away);
    document.addEventListener('keydown', key);
    return () => { document.removeEventListener('pointerdown', away); document.removeEventListener('keydown', key); };
  }, [open]);
  return <div className="qb-menu" ref={box}>
    <button id={id} type="button" className={`qb-chip${active ? ' active' : ''}`} aria-haspopup="true" aria-expanded={open} onClick={() => setOpen(!open)}>
      {label}{badge ? <span className="qb-badge">{badge}</span> : null}<ChevronDown size={14} aria-hidden="true"/>
    </button>
    {open && <div className={`qb-pop${wide ? ' wide' : ''}`} role="group" aria-labelledby={id}
      onClick={e => { if (closeOnPick && (e.target as Element).closest('.qb-opt')) setOpen(false); }}>{children}</div>}
  </div>;
}

function Options<V extends string | number | boolean>({ name, options, on, pick }: { name: string; options: [V, string][]; on: (v: V) => boolean; pick: (v: V) => void }) {
  return <div className="qb-opts">{options.map(([v, label]) =>
    <button key={String(v)} type="button" className="qb-opt" data-opt={name} data-v={String(v)} aria-pressed={on(v)} onClick={() => pick(v)}>{label}</button>)}</div>;
}

type Popover = { key: string; label: string; active: boolean; summary: string; control: ReactNode };

// The Filters card: one chip per filter; a chip opens its control under the row.
function FiltersCard({ items, reset }: { items: Popover[]; reset: () => void }) {
  const [open, setOpen] = useState<string | null>(null);
  const current = items.find(x => x.key === open);
  return <>
    <div className="qb-fchips">{items.map(x =>
      <button key={x.key} type="button" className={`qb-chip small${x.active ? ' active' : ''}`} data-filter={x.key} aria-expanded={open === x.key} onClick={() => setOpen(open === x.key ? null : x.key)}>
        <span>{x.label}{x.active && x.summary ? <span className="qb-sum">: {x.summary}</span> : null}</span><ChevronDown size={13} aria-hidden="true"/>
      </button>)}</div>
    {current && <div className="qb-fbody" data-filter-body={current.key}><div className="qb-flab">{current.label}</div>{current.control}</div>}
    <div className="qb-freset"><button type="button" id="qb-reset" onClick={reset} disabled={!items.some(x => x.active)}>Reset filters</button></div>
  </>;
}

function Home({ model, bridge }: { model: HomeModel; bridge: HomeBridge }) {
  const f = model.filters;
  const set = (partial: Partial<HomeFilters> & { skills?: string[] | null }) => bridge.setFilters(partial);
  const extraValue = (key: string, initial: unknown) => Object.hasOwn(f.extra, key) ? f.extra[key] : initial;
  const popovers: Popover[] = [
    { key: 'bank', label: 'Question set', active: !!f.bank, summary: (f.bank || []).map(v => BANKS.find(b => b[0] === v)?.[1] || v).join(', '),
      control: <Options name="bank" options={BANKS} on={v => !!f.bank?.includes(v)} pick={v => set({ bank: toggleOption(f.bank, v, BANKS.map(b => b[0])) })}/> },
    { key: 'lesson', label: 'Lesson questions', active: f.lesson !== 'show-all', summary: LESSON_SHORT[f.lesson] || '',
      control: <Options name="lesson" options={LESSON} on={v => f.lesson === v} pick={v => set({ lesson: v })}/> },
    ...EXTRA_FILTERS.map(def => {
      const value = extraValue(def.key, def.initial);
      const Control = def.Control;
      return { key: def.key, label: def.label, active: def.isActive(value), summary: def.isActive(value) ? def.summary(value) : '',
        control: <Control value={value} onChange={v => set({ extra: { ...f.extra, [def.key]: v } })}/> };
    })
  ];
  const activeCount = popovers.filter(x => x.active).length;
  const review = model.mode === 'focus';
  const rows = Math.max(1, ...model.sections.map(s => s.domains.reduce((n, d) => n + 1 + d.skills.length, 0)));
  return <div className="qb">
    <div className="qb-top">
      <div className="qb-chips" role="toolbar" aria-label="Practice filters">
        <Menu id="qb-diff" active={!!f.diff} label={<span>Difficulty{f.diff ? <span className="qb-sum">: {f.diff.join(', ')}</span> : null}</span>}>
          <Options name="diff" options={DIFFS.map(d => [d, d] as [string, string])} on={v => !!f.diff?.includes(v)} pick={v => set({ diff: toggleOption(f.diff, v, DIFFS) })}/>
        </Menu>
        <Menu id="qb-count" closeOnPick label={<span>Questions: <b>{f.count > 0 ? f.count : 'All'}</b></span>}>
          <Options name="count" options={COUNTS} on={v => f.count === v} pick={v => set({ count: v })}/>
        </Menu>
        <Menu id="qb-order" closeOnPick label={<span>Order: <b>{f.rand ? 'Random' : 'Normal'}</b></span>}>
          <Options name="order" options={[[false, 'Normal'], [true, 'Random']]} on={v => f.rand === v} pick={v => set({ rand: v })}/>
        </Menu>
        <Menu id="qb-filters" wide active={activeCount > 0} badge={activeCount} label={<><SlidersHorizontal size={14} aria-hidden="true"/>Filters</>}>
          <FiltersCard items={popovers} reset={() => set({ diff: null, bank: null, lesson: 'show-all', extra: {} })}/>
        </Menu>
      </div>
      <div className="qb-start">
        <div className="qb-seg" role="group" aria-label="Practice mode">
          <button type="button" data-mode="all" aria-pressed={!review} onClick={() => bridge.setMode('all')}>All questions</button>
          <button type="button" data-mode="focus" aria-pressed={review} onClick={() => bridge.setMode('focus')}>Review</button>
        </div>
        {!review && <span id="start-count" className="qb-count">{model.matching.toLocaleString()} matching question{model.matching === 1 ? '' : 's'}</span>}
        <button type="button" id="btn-start" className="qb-go" disabled={!review && model.matching === 0} onClick={() => review ? bridge.startReview() : bridge.start()}>
          {review ? 'Start review set' : 'Start practice'}
        </button>
      </div>
    </div>
    <div className="qb-cols">{model.sections.map(sec => {
      const secSkills = sec.domains.flatMap(d => d.skills.map(s => s.name));
      return <section key={sec.name} className="qb-col" data-section={sec.name} aria-label={sec.name}>
        <button type="button" className="qb-row qb-sec" data-section={sec.name} aria-pressed={allPicked(model.skills, secSkills)} disabled={!secSkills.length}
          onClick={() => set({ skills: toggleSkills(model.skills, secSkills) })}>
          <span className="qb-name">{sec.name}</span>
          <span className="qb-num">{sec.tally.a}/{sec.tally.n} done</span><Acc t={sec.tally}/>
        </button>
        <div className="qb-rows" style={{ gridTemplateRows: `repeat(${rows}, minmax(22px, 34px))` }}>
          {sec.domains.length ? sec.domains.map(d => {
            const names = d.skills.map(s => s.name);
            return [
              <button key={'d:' + d.name} type="button" className="qb-row qb-dom" data-domain={d.name} aria-pressed={allPicked(model.skills, names)}
                onClick={() => set({ skills: toggleSkills(model.skills, names) })}>
                <span className="qb-name">{d.name}</span><span className="qb-num">{d.tally.a}/{d.tally.n}</span><Acc t={d.tally}/>
              </button>,
              ...d.skills.map(s =>
                <button key={'s:' + s.name} type="button" className="qb-row qb-skill" data-skill={s.name} aria-pressed={s.picked}
                  onClick={() => set({ skills: toggleSkills(model.skills, [s.name]) })}>
                  <span className="qb-name">{s.name}</span>
                  <span className="qb-bar" aria-hidden="true"><i style={{ width: `${s.tally.n ? Math.round(s.tally.a / s.tally.n * 100) : 0}%` }}/></span>
                  <span className="qb-num">{s.tally.a}/{s.tally.n}</span><Acc t={s.tally}/>
                </button>)
            ];
          }) : <p className="qb-empty">No topics match these filters.</p>}
        </div>
      </section>;
    })}</div>
  </div>;
}

export function mountBankHome(root: HTMLElement, bridge: HomeBridge) {
  const react = createRoot(root);
  let model: HomeModel | null = null;
  const render = () => flushSync(() => react.render(model ? <Home model={model} bridge={bridge}/> : <p className="qb-loading">Loading questions…</p>));
  render();
  return {
    update(next: HomeModel) { model = next; render(); },
    destroy() { react.unmount(); }
  };
}
