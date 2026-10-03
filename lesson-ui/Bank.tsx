import { useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { createRoot } from 'react-dom/client';
import { flushSync } from 'react-dom';
import { Check, X, Highlighter, House, Calculator, NotebookPen, Copy, Eraser, Lightbulb, BookOpen, ChevronDown, ChevronLeft, ChevronRight, Flag } from 'lucide-react';
import { Stage } from './Stage';
import { CalculatorShell, useCalculator } from './Calculator';
import { HideButton, More, PositionPill, QuestionGrid } from './Chrome';
import { DesmosSolution } from './Desmos';
import { targetOf } from '/shared/stats.js';
import { SHOW_ANSWER_AFTER } from './record';
import type { BankBridge, BankModel, Mark } from './types';
import './bank.css';

type Clock = { text: string; over: boolean; late: boolean };
function createClock() {
  let value: Clock = { text: '', over: false, late: false };
  const subs = new Set<() => void>();
  return {
    get: () => value,
    set(text: string, over: boolean, late = false) { if (value.text === text && value.over === over && value.late === late) return; value = { text, over, late }; subs.forEach(f => f()); },
    subscribe(f: () => void) { subs.add(f); return () => { subs.delete(f); }; }
  };
}
type ClockStore = ReturnType<typeof createClock>;

const NONE: Mark[] = [];
const NO_LETTERS: string[] = [];
const GRID_VALUE = /^[-\d./]{1,32}$/;
const STATE_LABEL = { none: 'not answered', correct: 'correct', wrong: 'wrong', corrected: 'corrected', unscored: 'not scored', answered: 'answered' } as const;

// A modal <dialog> the screen opens and closes with its state.
function useModal(open: boolean, onClose: () => void) {
  const ref = useRef<HTMLDialogElement>(null);
  useLayoutEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal(); else if (!open && d.open) d.close();
  }, [open]);
  return { ref, onCancel: (e: React.SyntheticEvent) => { e.preventDefault(); onClose(); } };
}

function Notes({ qid, value, onSave, onClose }: { qid: string; value: string; onSave: (qid: string, body: string) => void; onClose: () => void }) {
  const [text, setText] = useState(value);
  const [saved, setSaved] = useState(!!value);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const latest = useRef({ qid, text, dirty: false });
  // Next/Back saves what was typed (under the question it was typed on) and loads the next question's note.
  useLayoutEffect(() => {
    setText(value); setSaved(!!value); latest.current = { qid, text: value, dirty: false };
    return () => { clearTimeout(timer.current); const l = latest.current; if (l.dirty) onSave(l.qid, l.text); };
  }, [qid]);
  const save = () => { clearTimeout(timer.current); const l = latest.current; if (l.dirty) { l.dirty = false; onSave(l.qid, l.text); setSaved(true); } };
  return <aside className="lesson-desmos bank-notes" id="bank-notes" aria-label="Notes">
    <div className="lesson-desmos-bar"><strong>Notes</strong><button id="bank-notes-close" onClick={() => { save(); onClose(); }}>Close</button></div>
    <div className="bank-notes-body">
      <textarea id="bank-notes-text" value={text} placeholder="Notes while you solve. Saved to this question and shown with it later."
        onChange={e => { setText(e.target.value); latest.current.text = e.target.value; latest.current.dirty = true; setSaved(false); clearTimeout(timer.current); timer.current = setTimeout(save, 1000); }}
        onBlur={save}/>
      <p className="bank-notes-msg" role="status">{saved && text ? 'Saved ✓' : ''}</p>
    </div>
  </aside>;
}

function Player({ model, bridge, clock }: { model: BankModel; bridge: BankBridge; clock: ClockStore }) {
  const q = model.question;
  const calc = useCalculator();
  const time = useSyncExternalStore(clock.subscribe, clock.get);
  const [hiddenClock, hideClock] = useState(false);
  const [privateOn, setPrivateOn] = useState(false);
  // Private, memory-only marks and cross-outs, kept per question for the session.
  const [privateMarks, setPrivateMarks] = useState<Record<string, Mark[]>>({});
  const [strikeMode, setStrikeMode] = useState(false);
  const [struck, setStruck] = useState<Record<string, string[]>>({});
  const [navOpen, setNavOpen] = useState(false);
  const [notesOpen, setNotesOpen] = useState(false);
  const [explOpen, setExplOpen] = useState(false);
  const [directions, setDirections] = useState(false);
  const [exit, setExit] = useState(false);
  const [ending, setEnding] = useState(false);
  const [copied, setCopied] = useState(false);
  const [exported, setExported] = useState('');
  const [draft, setDraft] = useState(model.picked);
  const explanation = useRef<HTMLDivElement>(null);
  const prev = useRef({ id: '', closed: false });
  const open = !model.closed;
  const active = open && !model.paused;
  const ownMarks = privateMarks[q.id] || NONE;
  const ownStruck = struck[q.id] || NO_LETTERS;
  const setOwnStruck = (letters: string[]) => setStruck(all => ({ ...all, [q.id]: letters }));
  const last = model.index === model.total - 1;
  const value = q.spr ? draft.trim() : model.picked;
  const set = model.set;
  // A Study Plan set has no Check: a pick is the answer, scored when the set ends.
  const canCheck = !set && active && (q.spr ? GRID_VALUE.test(value) : !!value && !model.missed.includes(value));
  const label = canCheck ? 'Check' : set && last ? (set.final ? 'Finish set' : 'Next section') : last ? 'Finish' : 'Next';
  const closeMore = () => document.querySelector('#bank-live .lesson-more')?.removeAttribute('open');

  const select = (letter: string) => {
    if (q.spr || !active || model.missed.includes(letter)) return;
    if (ownStruck.includes(letter)) setOwnStruck(ownStruck.filter(x => x !== letter));
    bridge.pick(letter);
  };
  const strike = (letter: string) => {
    const on = !ownStruck.includes(letter);
    setOwnStruck(on ? [...ownStruck, letter] : ownStruck.filter(x => x !== letter));
    if (on && active && model.picked === letter) bridge.pick('');
  };
  // A grid-in draft is the answer once the student moves on (a value that is not a grid-in entry clears it).
  const keepDraft = () => { if (set && q.spr && active && value !== model.picked) bridge.commit(GRID_VALUE.test(value) ? value : ''); };
  const primary = () => {
    if (canCheck) return bridge.check(q.spr ? value : undefined);
    keepDraft();
    if (set && last) setEnding(true); else bridge.next();
  };
  const copy = async () => {
    const text = bridge.exportText();
    try { await navigator.clipboard.writeText(text); setCopied(true); setTimeout(() => setCopied(false), 1600); }
    catch { closeMore(); setExported(text); }
  };

  // A grid-in draft follows the committed value (a wrong Check clears it) and starts empty on a new question.
  useLayoutEffect(() => { setDraft(model.picked); }, [q.id, model.picked]);
  useLayoutEffect(() => { setNavOpen(false); }, [q.id]);
  // The question closing after a miss: open the explanation and the note box beside it (setting "Note on a miss").
  // Never while it is open, and never after a right first try.
  useLayoutEffect(() => {
    const p = prev.current;
    if (p.id !== q.id) setExplOpen(false);
    else if (!p.closed && model.closed && model.missed.length && model.noteOnMiss) { setExplOpen(true); setNotesOpen(true); }
    else if (!p.closed && model.closed && model.explainOnClose) setExplOpen(true);
    prev.current = { id: q.id, closed: model.closed };
  }, [q.id, model.closed]);
  // The explanation only exists in the page once the question is closed.
  useLayoutEffect(() => {
    if (!explanation.current || !model.closed) return;
    explanation.current.innerHTML = q.explanation_html || '<p>No explanation available for this question.</p>';
    bridge.mathify(explanation.current);
  }, [model.closed, q.id, q.explanation_html]);
  // A status that just appeared is brought on screen below a long passage.
  const status = model.closed ? '.bank-reveal' : model.missed.length ? '.bank-status' : '';
  useLayoutEffect(() => { if (status) document.querySelector(`#bank-live ${status}`)?.scrollIntoView({ block: 'nearest' }); }, [status, q.id, model.missed.length]);

  const keys = useRef({ q, model, active, select, keepDraft });
  keys.current = { q, model, active, select, keepDraft };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey || (e.target as Element).closest?.('input, textarea, select, dialog, summary, [contenteditable]')) return;
      const k = keys.current;
      if (e.key === 'ArrowRight') { if (!(k.model.set && k.model.index === k.model.total - 1)) { k.keepDraft(); bridge.next(); } }
      else if (e.key === 'ArrowLeft') { k.keepDraft(); bridge.back(); }
      else if (/^[1-4]$/.test(e.key) && !k.q.spr) { const c = k.q.choices[Number(e.key) - 1]; if (c) k.select(c.letter); }
    };
    addEventListener('keydown', onKey);
    return () => removeEventListener('keydown', onKey);
  }, []);

  const directionsDialog = useModal(directions, () => setDirections(false));
  const exitDialog = useModal(exit, () => setExit(false));
  const exportDialog = useModal(!!exported, () => setExported(''));
  const endDialog = useModal(ending, () => setEnding(false));
  const over = time.over ? '#bd2424' : undefined;
  const targetSec = Math.round(targetOf(q) / 1000);
  const info: [string, string | undefined][] = [['Domain', q.domain], ['Skill', q.skill], ['Difficulty', q.difficulty], ['Source', q.source || 'CollegeBoard'], ['ID', q.id]];
  const missedNote = model.missed.length > 0;
  // The clock re-renders this screen every second; the navigator cells (one per question in the set) only when the model changes.
  const gridItems = useMemo(() => model.cells.map((c, n) => ({ id: c.id, state: c.state, flagged: c.flagged, current: n === model.index, label: STATE_LABEL[c.state] })), [model.cells, model.index]);

  return <>
    <span hidden id="lesson-check-icon"><Check size={20} aria-label="Correct"/></span><span hidden id="lesson-x-icon"><X size={20} aria-label="Incorrect"/></span>
    <header className="lesson-header">
      <div className="lesson-title">
        <h1>{model.title}</h1>
        <div className="lesson-phase bank-sub">
          <button id="bank-directions" className="bank-link" onClick={() => setDirections(true)}>Directions <ChevronDown aria-hidden="true"/></button>
          {set && <span className="bank-chip" id="bank-segment">{set.segment}</span>}
          {q.ai && <span className="bank-chip">AI · Level {q.level}</span>}
        </div>
      </div>
      <div className="lesson-timer"><strong id="bank-clock" className={time.late && !time.over ? 'late' : undefined} style={{ visibility: hiddenClock ? 'hidden' : 'visible', color: over }}>{time.text}</strong>
        {!set && <span id="bank-target" className="bank-target" style={{ visibility: hiddenClock ? 'hidden' : 'visible' }}>Target {Math.floor(targetSec / 60)}:{String(targetSec % 60).padStart(2, '0')}</span>}
        <span className="bank-timer-actions"><HideButton hidden={hiddenClock} onToggle={() => hideClock(!hiddenClock)}/>{!set && <button id="bank-pause" onClick={bridge.pause}>{model.paused ? 'Resume' : 'Pause'}</button>}</span></div>
      <nav className="lesson-tools" aria-label="Practice tools">
        <button id="bank-dashboard" onClick={() => setExit(true)}><House aria-hidden="true"/><span>Dashboard</span></button>
        {calc.math && <button id="bank-calc-toggle" aria-pressed={calc.open} onClick={calc.toggle}><Calculator aria-hidden="true"/><span>Calculator</span></button>}
        <button id="bank-annotate" aria-pressed={privateOn} onClick={() => setPrivateOn(!privateOn)}><Highlighter aria-hidden="true"/><span>Annotate</span></button>
        <button id="bank-notes-toggle" aria-pressed={notesOpen} onClick={() => setNotesOpen(!notesOpen)}><NotebookPen aria-hidden="true"/><span>Notes</span></button>
        <More>
          <button id="bank-clear-eliminations" onClick={() => { setOwnStruck([]); closeMore(); }}><Eraser aria-hidden="true"/>Clear eliminations</button>
          <button id="bank-clear-marks" onClick={() => { setPrivateMarks(all => ({ ...all, [q.id]: [] })); closeMore(); }}><Eraser aria-hidden="true"/>Clear annotations</button>
          {model.closed && <button id="bank-show-explanation" onClick={() => { setExplOpen(true); closeMore(); setTimeout(() => document.querySelector('#bank-live .bank-reveal')?.scrollIntoView({ block: 'nearest' }), 0); }}><BookOpen aria-hidden="true"/>Show explanation</button>}
          <button id="bank-export" onClick={copy}><Copy aria-hidden="true"/>{copied ? '✓ Copied' : 'Copy for AI'}</button>
          <button id="bank-suggest" onClick={() => { closeMore(); bridge.suggest(); }}><Lightbulb aria-hidden="true"/>Suggest a feature</button>
        </More>
      </nav>
    </header>
    <main className={`lesson-main bank-main${notesOpen ? ' with-desmos' : ''}${calc.math && calc.open ? ' with-calc' : ''}${model.paused ? ' paused' : ''}`}>
      {model.paused && <p className="bank-paused" role="status">Paused. Press Resume to continue.</p>}
      <div className="bank-stage">
        <Stage key={q.id} id="bank-card" question={q} number={model.index + 1} picked={q.spr ? draft : model.picked} active={active}
          revealed={model.closed && !model.unscored} missed={q.spr ? NO_LETTERS : model.missed} mathify={bridge.mathify}
          onReport={card => bridge.report({ questionId: q.id, element: card })} flagged={model.flagged} onFlag={bridge.flag}
          onSelect={select} onDraft={q.spr ? setDraft : undefined} onCommit={q.spr && active ? v => { if (v) bridge.commit(v); } : undefined} onEnter={() => { if (canCheck) primary(); }} noPick
          strikeMode={strikeMode} struck={ownStruck} onStrikeMode={() => setStrikeMode(!strikeMode)} onStrike={strike}
          privateMarks={ownMarks} annotating={privateOn}
          onPrivate={privateOn ? mark => setPrivateMarks(all => ({ ...all, [q.id]: [...(all[q.id] || []), mark] })) : undefined}/>
      </div>
      {open && missedNote && <p className="bank-status" id="bank-status" role="status"><X size={18} aria-hidden="true"/>{q.spr ? 'Not right. Try again.' : 'Not quite. Choose another answer.'}</p>}
      {open && q.spr && model.missed.length >= SHOW_ANSWER_AFTER && <button id="bank-show-answer" className="bank-show" onClick={bridge.showAnswer}>Show answer</button>}
      {model.closed && <section className="lesson-reveal bank-reveal" id="bank-reveal">
        <div className={`lesson-verdict${model.shown ? ' shown' : ''}`} id="bank-verdict">
          {model.unscored ? <span>Not auto-scored: this question has no stored answer. See the explanation.</span>
            : model.shown ? <><X aria-label="Answer shown"/><span>Correct answer: {q.answer}</span></>
            : <><Check aria-label="Correct"/><span>Correct</span></>}
        </div>
        <details open={explOpen} onToggle={e => setExplOpen(e.currentTarget.open)}><summary>Official explanation</summary><div ref={explanation}/></details>
        {/* Inside the closed-question section only: it never shows before the question is answered or revealed. */}
        {q.has_desmos ? <DesmosSolution key={q.id} questionId={q.id} load={bridge.desmosSolution}/> : null}
        <details><summary>Question info</summary><dl className="bank-info">{info.map(([k, v]) => <div key={k}><dt>{k}</dt><dd>{v || '—'}</dd></div>)}</dl></details>
      </section>}
      {model.note && <button className="bank-note-chip" id="bank-note-chip" onClick={() => setNotesOpen(true)}><b>Your note</b>{model.note}</button>}
    </main>
    {notesOpen && <Notes qid={q.id} value={model.note} onSave={bridge.saveNote} onClose={() => setNotesOpen(false)}/>}
    <footer className="lesson-footer bank-footer">
      <span>{model.name}</span>
      <PositionPill id="bank-nav" panelId="bank-navigator" label={`Question ${model.index + 1} of ${model.total}`} open={navOpen} onToggle={() => setNavOpen(!navOpen)}>
        {set ? <p className="self-legend"><span className="self-key answered"/>Answered <Flag aria-hidden="true"/>Marked</p>
          : <p className="self-legend"><span className="self-key correct"/>Correct <span className="self-key wrong"/>Wrong <span className="self-key corrected"/>Corrected <Flag aria-hidden="true"/>Marked</p>}
        <QuestionGrid attr="data-bank-q" onPick={id => { setNavOpen(false); keepDraft(); bridge.goto(model.cells.findIndex(c => c.id === id)); }}
          items={gridItems}/>
      </PositionPill>
      <span className="bank-actions">
        <button id="bank-back" disabled={model.index === 0} onClick={() => { keepDraft(); bridge.back(); }}><ChevronLeft aria-hidden="true"/>Back</button>
        <button id="bank-primary" className="lesson-submit" disabled={model.paused} data-mode={label === 'Check' ? 'check' : set && last ? 'finish' : label.toLowerCase()} onClick={primary}>{label}{label !== 'Check' && <ChevronRight aria-hidden="true"/>}</button>
      </span>
    </footer>
    <dialog className="lesson-confirm-dialog" id="bank-directions-dialog" {...directionsDialog}>
      {q.section === 'Math'
        ? <><p>For each question, choose the best answer or enter your response in the grid-in field. You may use a calculator and the provided Desmos graphing calculator.</p><p>All variables and expressions represent real numbers unless indicated otherwise. Figures are drawn to scale unless noted.</p></>
        : <p>Each passage or pair of passages is followed by a question. Choose the best answer to each question based on what is stated or implied in the passage(s) or in the supplementary material.</p>}
      <div><button id="bank-directions-ok" onClick={() => setDirections(false)}>Got it</button></div>
    </dialog>
    <dialog className="lesson-confirm-dialog" id="bank-exit-dialog" {...exitDialog}>
      <p>{set ? 'Leave this set? Your answers so far are kept and the clock stops until you come back to it from your plan.'
        : <>End this practice session? {model.signedIn ? 'Progress on answered questions is saved.' : 'You are not signed in, so this session’s answers are not kept.'}</>}</p>
      <div><button id="bank-exit-cancel" onClick={() => setExit(false)}>Cancel</button><button id="bank-exit-confirm" className="lesson-submit" onClick={() => { setExit(false); bridge.exit(); }}>Confirm</button></div>
    </dialog>
    {set && <dialog className="lesson-confirm-dialog" id="bank-end-dialog" {...endDialog}>
      <p>{set.endText}{set.unanswered ? ` ${set.unanswered} question${set.unanswered === 1 ? ' is' : 's are'} unanswered and will count as wrong.` : ''}</p>
      <div><button id="bank-end-cancel" onClick={() => setEnding(false)}>Keep working</button><button id="bank-end-confirm" className="lesson-submit" onClick={() => { setEnding(false); bridge.endSegment(); }}>{set.final ? 'Finish set' : 'Start next section'}</button></div>
    </dialog>}
    <dialog className="lesson-confirm-dialog bank-export" id="bank-export-dialog" {...exportDialog}>
      <p>Copy this into your AI assistant</p>
      <textarea readOnly value={exported} onFocus={e => e.currentTarget.select()}/>
      <div><button id="bank-export-close" onClick={() => setExported('')}>Close</button></div>
    </dialog>
  </>;
}

export function mountBank(root: HTMLElement, bridge: BankBridge) {
  const react = createRoot(root);
  const clock = createClock();
  let model: BankModel | null = null;
  const render = () => flushSync(() => react.render(model
    ? <CalculatorShell embed math={model.question.section === 'Math'}><Player model={model} bridge={bridge} clock={clock}/></CalculatorShell>
    : null));
  return {
    update(next: BankModel) { model = next; render(); },
    clock(text: string, over: boolean, late = false) { clock.set(text, over, late); },
    reset() { model = null; render(); },
    destroy() { react.unmount(); }
  };
}
