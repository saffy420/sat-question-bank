// Home (the first screen after login): greeting, the plan's next step, the SAT countdown, current and target score,
// and four stat cards. `public/index.html` builds the model from the plan JSON and the shared tallies and redraws it;
// edits go back through the bridge to the plan's own save path (/api/plan with its rev check).
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { flushSync } from 'react-dom';
import { Play, ChevronRight, Pencil, ChartColumn, Target } from 'lucide-react';
import { readScore, upcomingSatDates, type ProfilePatch } from '../plan';
import { countdown, firstName, greeting, nextLabel, type NextStep } from './home';
import './home.css';

export type HomeModel = {
  name: string;
  // The plan's guest path, a load in flight or failed, or ready (with or without a plan).
  plan: 'guest' | 'loading' | 'error' | 'ready';
  next: NextStep | null;
  goal: number | null;
  current: { score: number; date: string } | null;
  satDate: string | null;
  stats: { attempted: number; accuracy: number | null; saved: number; recent: number };
};
export type HomeBridge = {
  startNext(): void; openLog(): void; weekly(): void; mistakes(): void; signIn(): void; retry(): void;
  saveProfile(patch: ProfilePatch): Promise<boolean>;
};

const pad = (n: number) => String(n).padStart(2, '0');
const localDay = (ms: number) => { const d = new Date(ms); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
const fmtDay = (day: string) => { const [y, m, d] = day.split('-').map(Number); return new Date(y, m - 1, d).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }); };

// The clock, ticking on each minute boundary (the countdown shows minutes; the greeting follows the hour).
function useMinute() {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    const tick = () => { setNow(Date.now()); timer = setTimeout(tick, 60000 - Date.now() % 60000 + 50); };
    timer = setTimeout(tick, 60000 - Date.now() % 60000 + 50);
    return () => clearTimeout(timer);
  }, []);
  return now;
}

const EditIcon = ({ label, onClick, id }: { label: string; onClick: () => void; id: string }) =>
  <button type="button" className="hm-pencil" id={id} aria-label={label} title={label} onClick={onClick}><Pencil size={14} aria-hidden="true"/></button>;

// A score shown big with a pencil; the pencil opens an inline field (Enter saves, Escape cancels, empty clears).
function ScoreField({ id, label, value, what, sub, onSave }: { id: string; label: string; value: number | null; what: string; sub?: ReactNode; onSave: (n: number | null) => Promise<boolean> }) {
  const [text, setText] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => { if (text !== null) input.current?.focus(); }, [text !== null]);
  const close = () => { setText(null); setError(''); };
  const save = async () => {
    if (text === null || busy) return;
    const r = readScore(text, 400, 1600, what);
    if ('error' in r) { setError(r.error); return; }
    if (r.value === value) { close(); return; }
    setBusy(true);
    const ok = await onSave(r.value);
    setBusy(false);
    if (ok) close(); else setError('Could not save. Check your connection and try again.');
  };
  return <div className="hm-score" id={id}>
    <span className="hm-k">{label}</span>
    {text !== null
      ? <form className="hm-edit" onSubmit={e => { e.preventDefault(); save(); }}>
          <input ref={input} id={id + '-input'} inputMode="numeric" placeholder="400–1600" aria-label={label} value={text} disabled={busy}
            onChange={e => { setText(e.target.value); setError(''); }} onKeyDown={e => { if (e.key === 'Escape') close(); }}/>
          <button type="submit" className="hm-save" id={id + '-save'} disabled={busy}>Save</button>
          <button type="button" className="hm-cancel" onClick={close} disabled={busy}>Cancel</button>
          {error && <p className="hm-err" role="alert" id={id + '-error'}>{error}</p>}
        </form>
      : value
        ? <div className="hm-val"><b className="hm-num" id={id + '-value'}>{value}</b><EditIcon id={id + '-edit'} label={`Edit ${label.toLowerCase()}`} onClick={() => setText(String(value))}/></div>
        : <button type="button" className="hm-set" id={id + '-set'} onClick={() => setText('')}>Set score</button>}
    {text === null && sub}
  </div>;
}

function Countdown({ satDate, now, onSave }: { satDate: string | null; now: number; onSave: (d: string | null) => Promise<boolean> }) {
  const [editing, setEditing] = useState(false);
  const [error, setError] = useState('');
  const select = useRef<HTMLSelectElement>(null);
  const today = localDay(now);
  const date = satDate && satDate >= today ? satDate : null;   // a past SAT date counts as unset, as on the plan
  const dates = upcomingSatDates(today);
  useEffect(() => { if (editing) select.current?.focus(); }, [editing]);
  const pick = async (d: string) => {
    const next = d || null;
    if (next === date) { setEditing(false); return; }
    const ok = await onSave(next);
    if (ok) { setEditing(false); setError(''); } else setError('Could not save. Try again.');
  };
  const left = date ? countdown(date, now) : null;
  return <section className="hm-count" id="home-countdown" aria-label="SAT countdown">
    <div className="hm-count-l">
      <span className="hm-k">SAT countdown</span>
      {editing
        ? <select ref={select} id="home-sat-select" defaultValue={date || ''} aria-label="SAT date" onChange={e => pick(e.target.value)}
            onKeyDown={e => { if (e.key === 'Escape') setEditing(false); }} onBlur={() => setEditing(false)}>
            <option value="">Not scheduled yet</option>
            {dates.map(d => <option key={d.date} value={d.date}>{fmtDay(d.date)}{d.anticipated ? ' (anticipated)' : ''}</option>)}
          </select>
        : date
          ? <div className="hm-date"><span id="home-sat-date">{fmtDay(date)}</span><EditIcon id="home-sat-edit" label="Change SAT date" onClick={() => setEditing(true)}/></div>
          : <button type="button" className="hm-set" id="home-sat-set" onClick={() => setEditing(true)}>Set date</button>}
      {error && <p className="hm-err" role="alert">{error}</p>}
    </div>
    <div className="hm-clock" id="home-clock" aria-live="off">
      {(['days', 'hrs', 'min'] as const).map(k => <div key={k} className="hm-unit"><b data-unit={k}>{left ? (k === 'days' ? left[k] : pad(left[k])) : '–'}</b><span>{k}</span></div>)}
    </div>
  </section>;
}

function Stat({ id, label, value, action, onClick }: { id: string; label: string; value: string; action?: string; onClick?: () => void }) {
  return <div className="hm-stat" id={id}>
    <span className="hm-k">{label}</span>
    <div className="hm-stat-v"><b className="hm-num">{value}</b>{action && <button type="button" className="hm-chip" onClick={onClick}>{action}</button>}</div>
  </div>;
}

function Home({ model: m, bridge }: { model: HomeModel; bridge: HomeBridge }) {
  const now = useMinute();
  const name = firstName(m.name);
  const ready = m.plan === 'ready';
  const s = m.stats;
  const current = m.current;
  return <div className="hm">
    <header className="hm-top">
      <div className="hm-hello">
        <h1 id="home-greet">Good {greeting(new Date(now).getHours())}{name && <>, <span className="hm-name">{name}</span></>}</h1>
        <div className="hm-actions">
          {m.plan === 'guest'
            ? <button type="button" className="hm-primary" id="home-next" onClick={bridge.signIn}>Sign in to build a study plan</button>
            : <button type="button" className="hm-primary" id="home-next" disabled={!ready} onClick={m.next ? bridge.startNext : bridge.openLog}>
                <Play size={14} fill="currentColor" aria-hidden="true"/>{nextLabel(m.next)}</button>}
          <button type="button" className="hm-secondary" id="home-weekly" onClick={bridge.weekly}>See weekly plan<ChevronRight size={16} aria-hidden="true"/></button>
        </div>
      </div>
      {ready ? <Countdown satDate={m.satDate} now={now} onSave={d => bridge.saveProfile({ satDate: d })}/>
        : <section className="hm-count hm-note" id="home-countdown">
            {m.plan === 'guest' ? <p>Sign in to build a study plan, set your target score and count down to your SAT.</p>
              : m.plan === 'error' ? <p>Your study plan could not be loaded. <button type="button" className="hm-chip" id="home-retry" onClick={bridge.retry}>Try again</button></p>
              : <p>Loading your study plan…</p>}
          </section>}
    </header>

    <section className="hm-sec" aria-labelledby="home-stats-h">
      <h2 id="home-stats-h"><ChartColumn size={18} aria-hidden="true"/>Your practice</h2>
      <div className="hm-stats">
        <Stat id="home-attempted" label="Questions attempted" value={s.attempted.toLocaleString()}/>
        <Stat id="home-accuracy" label="Accuracy" value={s.accuracy === null ? '—' : s.accuracy + '%'}/>
        <Stat id="home-saved" label="Saved questions" value={s.saved.toLocaleString()} action="View" onClick={bridge.mistakes}/>
        <Stat id="home-recent" label="Errors, last 7 days" value={s.recent.toLocaleString()} action="Review" onClick={bridge.mistakes}/>
      </div>
    </section>

    {ready && <section className="hm-sec" aria-labelledby="home-score-h">
      <h2 id="home-score-h"><Target size={18} aria-hidden="true"/>Your score</h2>
      <div className="hm-scores">
        <ScoreField id="home-current" label="Current score" value={current ? current.score : null} what="Your current score"
          sub={current && <small className="hm-sub">As of {fmtDay(current.date)}</small>}
          onSave={n => bridge.saveProfile({ current: n === null ? null : { score: n, date: localDay(Date.now()) } })}/>
        <ScoreField id="home-goal" label="Target score" value={m.goal} what="Your target score" onSave={n => bridge.saveProfile({ goal: n })}/>
        <svg className="hm-target" viewBox="0 0 120 120" aria-hidden="true">
          <circle cx="60" cy="60" r="52" fill="#e8ecfa"/><circle cx="60" cy="60" r="38" fill="#fff"/><circle cx="60" cy="60" r="38" fill="none" stroke="#2345be" strokeWidth="8"/>
          <circle cx="60" cy="60" r="20" fill="#2345be"/><circle cx="60" cy="60" r="7" fill="#fff"/>
        </svg>
      </div>
    </section>}
  </div>;
}

export function mountHome(root: HTMLElement, bridge: HomeBridge) {
  const react = createRoot(root);
  let model: HomeModel | null = null;
  const render = () => flushSync(() => react.render(model ? <Home model={model} bridge={bridge}/> : null));
  return {
    update(next: HomeModel) { model = next; render(); },
    destroy() { react.unmount(); }
  };
}
