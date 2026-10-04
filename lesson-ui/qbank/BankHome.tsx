import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { flushSync } from 'react-dom';
import { Check as Tick, ChevronDown, Minus } from 'lucide-react';
import { EXTRA_FILTERS } from './extraFilters';
import { MIN_ATTEMPTS, accuracy, levelOf, pickState, toggleOption, toggleSkills } from './selection';
import type { PickState } from './selection';
import type { HomeBridge, HomeFilters, HomeModel, Tally } from './types';
import './qbank.css';

const DIFFS = ['Easy', 'Medium', 'Hard'];
const BANKS: [string, string][] = [['official', 'Official'], ['ai', 'AI']];
const COUNTS: [number, string][] = [[10, '10'], [20, '20'], [30, '30'], [50, '50'], [0, 'All']];
const LESSON: [string, string][] = [['show-all', 'Show all'], ['hide-attended', 'Hide questions from lessons I attended'], ['hide-all', 'Hide all lesson questions']];
const LESSON_SHORT: Record<string, string> = { 'hide-attended': 'Hide attended', 'hide-all': 'Hide all' };

function Acc({ t, tone }: { t: Tally; tone?: boolean }) {
  if (!t.a) return <span className="qb-acc"/>;
  const p = accuracy(t);
  if (p == null) return <span className="qb-acc" title={`Accuracy shows after ${MIN_ATTEMPTS} attempts (${t.a} so far)`}>—</span>;
  return <span className={`qb-acc${tone ? ` ${levelOf(p)}` : ''}`}>{p}%</span>;
}

function Check({ state }: { state: PickState }) {
  return <span className="qb-check" data-state={state} aria-hidden="true">
    {state === 'on' ? <Tick size={12} strokeWidth={3}/> : state === 'part' ? <Minus size={12} strokeWidth={3}/> : null}
  </span>;
}

// A chip that opens a small card under it. Outside click and Escape close it.
function Menu({ id, filter, label, active, children, wide, closeOnPick }: { id: string; filter?: string; label: ReactNode; active?: boolean; children: ReactNode; wide?: boolean; closeOnPick?: boolean }) {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const pop = useRef<HTMLDivElement>(null);
  const [flip, setFlip] = useState(false);
  // A card that would run off the right edge of the window opens leftwards instead.
  useLayoutEffect(() => {
    if (!open || !pop.current) return;
    setFlip(false);
    const r = pop.current.getBoundingClientRect();
    if (r.right > window.innerWidth - 8) setFlip(true);
  }, [open]);
  useEffect(() => {
    if (!open) return;
    const away = (e: Event) => { if (!box.current?.contains(e.target as Node)) setOpen(false); };
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') { setOpen(false); box.current?.querySelector('button')?.focus(); } };
    document.addEventListener('pointerdown', away);
    document.addEventListener('keydown', key);
    return () => { document.removeEventListener('pointerdown', away); document.removeEventListener('keydown', key); };
  }, [open]);
  return <div className="qb-menu" ref={box}>
    <button id={id} data-filter={filter} type="button" className={`qb-chip${active ? ' active' : ''}`} aria-haspopup="true" aria-expanded={open} onClick={() => setOpen(!open)}>
      {label}<ChevronDown size={14} aria-hidden="true"/>
    </button>
    {open && <div ref={pop} className={`qb-pop${wide ? ' wide' : ''}${flip ? ' flip' : ''}`} role="group" aria-labelledby={id}
      onClick={e => { if (closeOnPick && (e.target as Element).closest('.qb-opt')) setOpen(false); }}>{children}</div>}
  </div>;
}

function Options<V extends string | number | boolean>({ name, options, on, pick }: { name: string; options: [V, string][]; on: (v: V) => boolean; pick: (v: V) => void }) {
  return <div className="qb-opts">{options.map(([v, label]) =>
    <button key={String(v)} type="button" className="qb-opt" data-opt={name} data-v={String(v)} aria-pressed={on(v)} onClick={() => pick(v)}>{label}</button>)}</div>;
}

function Home({ model, bridge }: { model: HomeModel; bridge: HomeBridge }) {
  const f = model.filters;
  const set = (partial: Partial<HomeFilters> & { skills?: string[] | null }) => bridge.setFilters(partial);
  const extraValue = (key: string, initial: unknown) => Object.hasOwn(f.extra, key) ? f.extra[key] : initial;
  const chip = (label: string, summary: string) => <span>{label}{summary ? <span className="qb-sum">: {summary}</span> : null}</span>;
  const extras = EXTRA_FILTERS.map(def => {
    const value = extraValue(def.key, def.initial);
    const Control = def.Control;
    const active = def.isActive(value);
    return { def, active, node: <Menu key={def.key} id={`qb-f-${def.key}`} filter={def.key} active={active} wide={def.key === 'timeSpent'} label={chip(def.label, active ? def.summary(value) : '')}>
      <Control value={value} onChange={v => set({ extra: { ...f.extra, [def.key]: v } })}/>
    </Menu> };
  });
  const anyActive = !!f.diff || !!f.bank || f.lesson !== 'show-all' || extras.some(x => x.active);
  const review = model.mode === 'focus';
  const allSkills = model.sections.flatMap(sec => sec.domains.flatMap(d => d.skills.map(s => s.name)));
  const nSkills = model.skills ? allSkills.filter(s => model.skills!.includes(s)).length : allSkills.length;
  const rows = Math.max(1, ...model.sections.map(s => s.domains.reduce((n, d) => n + 1 + d.skills.length, 0)));
  const plural = (n: number, word: string) => `${n.toLocaleString()} ${word}${n === 1 ? '' : 's'}`;
  return <div className="qb">
    <div className="qb-top">
      <div className="qb-chips" role="toolbar" aria-label="Practice filters">
        <Menu id="qb-diff" filter="diff" active={!!f.diff} label={chip('Difficulty', (f.diff || []).join(', '))}>
          <Options name="diff" options={DIFFS.map(d => [d, d] as [string, string])} on={v => !!f.diff?.includes(v)} pick={v => set({ diff: toggleOption(f.diff, v, DIFFS) })}/>
        </Menu>
        <Menu id="qb-count" closeOnPick label={<span>Questions: <b>{f.count > 0 ? f.count : 'All'}</b></span>}>
          <Options name="count" options={COUNTS} on={v => f.count === v} pick={v => set({ count: v })}/>
        </Menu>
        <Menu id="qb-order" closeOnPick label={<span>Order: <b>{f.rand ? 'Random' : 'Normal'}</b></span>}>
          <Options name="order" options={[[false, 'Normal'], [true, 'Random']]} on={v => f.rand === v} pick={v => set({ rand: v })}/>
        </Menu>
        <Menu id="qb-f-bank" filter="bank" active={!!f.bank} label={chip('Question set', (f.bank || []).map(v => BANKS.find(b => b[0] === v)?.[1] || v).join(', '))}>
          <Options name="bank" options={BANKS} on={v => !!f.bank?.includes(v)} pick={v => set({ bank: toggleOption(f.bank, v, BANKS.map(b => b[0])) })}/>
        </Menu>
        <Menu id="qb-f-lesson" filter="lesson" wide active={f.lesson !== 'show-all'} label={chip('Lesson questions', LESSON_SHORT[f.lesson] || '')}>
          <Options name="lesson" options={LESSON} on={v => f.lesson === v} pick={v => set({ lesson: v })}/>
        </Menu>
        {extras.map(x => x.node)}
        <button type="button" id="qb-reset" className="qb-reset" disabled={!anyActive} onClick={() => set({ diff: null, bank: null, lesson: 'show-all', extra: {} })}>Reset filters</button>
      </div>
      <div className="qb-start">
        <div className="qb-seg" role="group" aria-label="Practice mode">
          <button type="button" data-mode="all" aria-pressed={!review} onClick={() => bridge.setMode('all')}>All questions</button>
          <button type="button" data-mode="focus" aria-pressed={review} onClick={() => bridge.setMode('focus')}>Review</button>
        </div>
        {!review && <span id="start-count" className="qb-count">
          <span>{plural(nSkills, 'skill')}</span> · <span data-matching={model.matching}>{plural(model.matching, 'question')}</span>
          {model.skills && <> · <button type="button" className="qb-clear" onClick={() => set({ skills: null })}>Clear</button></>}
        </span>}
        <button type="button" id="btn-start" className="qb-go" disabled={!review && model.matching === 0} onClick={() => review ? bridge.startReview() : bridge.start()}>
          {review ? 'Start review set' : `Practice ${model.matching.toLocaleString()}`}
        </button>
      </div>
    </div>
    <div className="qb-cols">{model.sections.map(sec => {
      const secSkills = sec.domains.flatMap(d => d.skills.map(s => s.name));
      const state = pickState(model.skills, secSkills);
      const pressed = (st: PickState) => st === 'on' ? true : st === 'part' ? 'mixed' : false;
      return <section key={sec.name} className="qb-col" data-section={sec.name} aria-label={sec.name}>
        <button type="button" className="qb-row qb-sec" data-section={sec.name} aria-pressed={pressed(state)} disabled={!secSkills.length}
          onClick={() => set({ skills: toggleSkills(model.skills, secSkills) })}>
          <Check state={state}/>
          <span className="qb-name" title={sec.name}>{sec.name}</span>
          <span className="qb-num">{sec.tally.a}/{sec.tally.n} done</span><Acc t={sec.tally}/>
        </button>
        <div className="qb-rows" style={{ gridTemplateRows: `repeat(${rows}, minmax(24px, 34px))` }}>
          {sec.domains.length ? sec.domains.map(d => {
            const names = d.skills.map(s => s.name);
            const ds = pickState(model.skills, names);
            return [
              <button key={'d:' + d.name} type="button" className="qb-row qb-dom" data-domain={d.name} aria-pressed={pressed(ds)}
                onClick={() => set({ skills: toggleSkills(model.skills, names) })}>
                <Check state={ds}/>
                <span className="qb-name" title={d.name}>{d.name}</span><span className="qb-bar-gap"/><span className="qb-num">{d.tally.a}/{d.tally.n}</span><Acc t={d.tally}/>
              </button>,
              ...d.skills.map(s => {
                const p = accuracy(s.tally);
                return <button key={'s:' + s.name} type="button" className="qb-row qb-skill" data-skill={s.name} aria-pressed={s.picked}
                  onClick={() => set({ skills: toggleSkills(model.skills, [s.name]) })}>
                  <Check state={s.picked ? 'on' : 'off'}/>
                  <span className="qb-name" title={s.name}>{s.name}</span>
                  <span className="qb-bar" aria-hidden="true">{p != null && <i className={levelOf(p)} style={{ width: `${p}%` }}/>}</span>
                  <span className="qb-num">{s.tally.a}/{s.tally.n}</span><Acc t={s.tally} tone/>
                </button>;
              })
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
