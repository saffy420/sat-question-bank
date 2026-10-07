import { useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { flushSync } from 'react-dom';
import { Check, X, Highlighter, Focus, Circle, LogOut, Eraser, Users, LockKeyhole, Calculator, Lightbulb } from 'lucide-react';
import { isRight } from '/shared/stats.js';
import * as Ink from '/shared/annotations.js';
import { Stage, followStage } from './Stage';
import { HideButton, More } from './Chrome';
import { DesmosFollower } from './Desmos';
import { CalculatorShell, useCalculator } from './Calculator';
import { SelfPlayer } from './Self';
import { PollScreen } from './Poll';
import { HistoryScreen } from './History';
import { Reflection } from './Reflection';
import type { Bridge, PlayerModel, Mark, Laser, LessonHistory, HistoryOptions, ReflectionOptions, View } from './types';
import type { StageProps } from './Stage';
import './lesson.css';
export { Stage } from './Stage';
export { notesHTML } from './notes';
export type { StageProps } from './Stage';

const NONE: Mark[] = [];
const NO_LETTERS: string[] = [];

// Presenter fit (live-fit). Once a question is revealed the stage is laid out at the presenter's stage width,
// type size and viewport width, then scaled uniformly to this student's column: the same layout gives the same
// line breaks, so ink, highlights and the laser land on the same words everywhere. The box takes the scaled
// height so the page scrolls as usual. Without a view (or while answering) both wrappers are plain blocks and
// the stage stays fluid; the tree is the same either way, so switching never remounts the stage.
function PresenterFit({ view, children }: { view: View | null; children: ReactNode }) {
  const box = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const outer = box.current, inner = outer?.firstElementChild as HTMLElement | null;
    if (!view || !outer || !inner) return;
    const fit = () => {
      const k = outer.getBoundingClientRect().width / view.w, transform = `scale(${k})`;
      outer.style.height = `${inner.offsetHeight * k}px`;
      if (inner.style.transform === transform) return;
      inner.style.transform = transform;
      inner.querySelector('.lesson-stage')?.dispatchEvent(new Event('stage:scale'));
    };
    const observer = new ResizeObserver(fit);
    observer.observe(outer); observer.observe(inner);
    fit();
    return () => { observer.disconnect(); outer.style.height = ''; inner.style.transform = ''; };
  }, [view?.w]);
  const style = view ? { width: `${view.w}px`, '--fs': `${view.fs}px`, '--u': `${view.u}px`, '--vw': `${view.vw / 100}px` } as CSSProperties : undefined;
  return <div className={`stage-fit-box${view ? ' fitted' : ''}`} ref={box}><div className={view ? 'stage-fit' : undefined} style={style}>{children}</div></div>;
}

function Player({ model, bridge, terminal, followMark }: { model: PlayerModel; bridge: Bridge; terminal: string; followMark: Mark | null }) {
  const { snapshot: s, picked, remaining } = model;
  const calc = useCalculator();
  const [hiddenClock, hideClock] = useState(false);
  const [privateOn, setPrivateOn] = useState(false);
  // Private, memory-only marks keyed by question so they survive moving between questions.
  const [privateMarks, setPrivateMarks] = useState<Record<string, Mark[]>>({});
  const [follow, setFollow] = useState(true);
  const [confirm, setConfirm] = useState<string | null>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  const explanation = useRef<HTMLDivElement>(null);
  const revealed = s.phase === 'REVEALED' || s.phase === 'ENDED';
  const active = s.phase === 'ANSWERING' && remaining > 0 && !s.locked && !model.lockPending && !terminal;
  const ownMarks = privateMarks[s.questionId] || NONE;
  // Cross-outs are private and memory-only, kept per question for the session.
  const [strikeMode, setStrikeMode] = useState(false);
  const [struck, setStruck] = useState<Record<string, string[]>>({});
  const ownStruck = struck[s.questionId] || NO_LETTERS;
  const setOwnStruck = (letters: string[]) => setStruck(all => ({ ...all, [s.questionId]: letters }));
  const strike = (letter: string) => {
    const on = !ownStruck.includes(letter);
    setOwnStruck(on ? [...ownStruck, letter] : ownStruck.filter(x => x !== letter));
    if (on && active && picked === letter) bridge.select(s.questionId, '');
  };
  const select = (answer: string) => {
    if (ownStruck.includes(answer)) setOwnStruck(ownStruck.filter(x => x !== answer));
    bridge.select(s.questionId, answer);
  };
  useLayoutEffect(() => { setConfirm(null); }, [s.questionId]);
  useLayoutEffect(() => { if (!active) setConfirm(null); }, [active]);
  useLayoutEffect(() => {
    const card = document.getElementById('lesson-card');
    if (card && s.phase !== 'REVEALED') Ink.laser(card).hide();
  }, [s.phase, s.questionId]);
  useLayoutEffect(() => {
    if (confirm) dialog.current?.showModal();
    else dialog.current?.close();
  }, [confirm]);
  useLayoutEffect(() => {
    if (!explanation.current || !revealed) return;
    explanation.current.innerHTML = s.question?.explanation_html || '';
    bridge.mathify(explanation.current);
  }, [revealed, s.questionId, s.question?.explanation_html]);
  useLayoutEffect(() => {
    const card = document.getElementById('lesson-card');
    if (card && follow && followMark) followStage(card, followMark);
  }, [followMark]);
  // Below a long passage, a status that just appeared (lock, reveal, class results) is brought on screen.
  const status = revealed ? (s.classResults && s.distribution ? '.lesson-results' : '.lesson-reveal') : s.locked || model.lockPending ? '.lesson-locked' : '';
  useLayoutEffect(() => { if (status) document.querySelector(status)?.scrollIntoView({ block: 'nearest' }); }, [status, s.questionId]);
  if (terminal) return <div className="lesson-terminal" role="status"><h2>{terminal}</h2></div>;
  return <>
    <span hidden id="lesson-check-icon"><Check size={20} aria-label="Correct"/></span><span hidden id="lesson-x-icon"><X size={20} aria-label="Incorrect"/></span>
    <header className="lesson-header">
      <div className="lesson-title"><h1>{s.title}</h1><div className="lesson-phase">{s.phase === 'READY' && s.status === 'lobby' ? '' : s.reviewMode ? 'REVIEW' : s.phase}</div></div>
      <div className="lesson-timer"><strong id="lesson-clock" style={{ visibility: hiddenClock ? 'hidden' : 'visible', color: s.phase === 'ANSWERING' && remaining <= 5000 ? '#bd2424' : s.phase === 'ANSWERING' && remaining <= 10000 ? '#b56a00' : undefined }}>{s.endsAt ? `${Math.floor(Math.ceil(remaining / 1000) / 60)}:${String(Math.ceil(remaining / 1000) % 60).padStart(2, '0')}` : ''}</strong>{!s.reviewMode && <HideButton hidden={hiddenClock} onToggle={() => hideClock(!hiddenClock)}/>}</div>
      <nav className="lesson-tools" aria-label="Lesson tools">
        {calc.math && <button id="lesson-calc-toggle" aria-pressed={calc.open} onClick={calc.toggle}><Calculator aria-hidden="true"/><span>Calculator</span></button>}
        <button id="lesson-private" aria-pressed={privateOn} onClick={() => setPrivateOn(!privateOn)}><Highlighter aria-hidden="true"/><span>Annotate</span></button>
        <label className="lesson-follow-tool"><Focus aria-hidden="true"/><span>Follow me</span><input id="lesson-follow" type="checkbox" checked={follow} onChange={e => setFollow(e.target.checked)} /></label>
        <More><button id="lesson-private-clear" onClick={() => setPrivateMarks(all => ({ ...all, [s.questionId]: [] }))}><Eraser aria-hidden="true"/>Clear annotations</button><button id="lesson-suggest" onClick={bridge.suggest}><Lightbulb aria-hidden="true"/>Suggest a feature</button><button id="lesson-leave" onClick={bridge.leave}><LogOut aria-hidden="true"/>Leave view</button></More>
        <span id="lesson-connection" role="status" aria-label={model.connected ? 'Connected' : 'Reconnecting…'}><Circle fill="currentColor" size={9} aria-hidden="true"/><span className="lesson-sr">{model.connected ? 'Connected' : 'Reconnecting…'}</span></span>
      </nav>
    </header>
    {!model.connected && <div className="lesson-reconnect" role="status">Reconnecting…</div>}
    <main className={`lesson-main${revealed && s.desmos ? ' with-desmos' : ''}${calc.math && calc.open ? ' with-calc' : ''}`}>
      {s.status === 'lobby' ? <section className="lesson-lobby"><Users size={36} aria-hidden="true"/><h2>Waiting for the instructor to start…</h2><p>{s.count} joined</p></section> : s.question && <>
        <PresenterFit view={s.phase === 'REVEALED' && s.view ? s.view : null}><Stage key={s.questionId} question={s.question} number={s.index + 1} onReport={card => bridge.report({ questionId: s.questionId, element: card })} picked={picked} active={active} revealed={revealed} marks={s.annotations} privateMarks={ownMarks} mathify={bridge.mathify} onSelect={select} strikeMode={strikeMode} struck={ownStruck} eliminated={s.eliminations} onStrikeMode={() => setStrikeMode(!strikeMode)} onStrike={strike} annotating={privateOn} onPrivate={privateOn ? mark => setPrivateMarks(all => ({ ...all, [s.questionId]: [...(all[s.questionId] || []), mark] })) : undefined}/></PresenterFit>
        {!revealed && (s.locked || model.lockPending) && <p className="lesson-locked" role="status"><LockKeyhole size={18} aria-hidden="true"/>Answer locked in. Waiting for time to end…</p>}
        {revealed && <section className="lesson-reveal"><p>Correct answer: {s.question.answer}{s.question.spr && !s.notInSet && <> · Your answer: {picked || 'blank'} · {isRight(s.question, picked) ? 'Correct' : 'Incorrect'}</>}</p>{s.notInSet ? <div className="lesson-verdict" id="lesson-not-in-set">Not in your set</div> : <div className="lesson-verdict"><span>{isRight(s.question, picked) ? <Check aria-label="Correct"/> : <X aria-label="Incorrect"/>}</span>{picked ? `Your answer: ${picked}` : 'No answer selected'}</div>}<details key={s.questionId}><summary>Official explanation</summary><div ref={explanation}/></details>
          {s.classResults && s.distribution && <section className="lesson-results"><h3>Class results</h3>{s.distribution.map((g, index) => <div className="lesson-result" key={g.label}><span>{g.label}</span><span className="lesson-result-track"><i style={{ width: `${100 * g.count / Math.max(1, ...s.distribution!.map(row => row.count))}%`, background: ['#1182a4', '#126bb3', '#706caf', '#398437'][index % 4] }}/></span><strong>{g.count}</strong>{g.correct && <Check size={18} aria-label="Correct"/>}</div>)}</section>}
        </section>}
      </>}
      <p id="lesson-error" role="alert">{model.error}</p>
    </main>
    {revealed && s.desmos && <DesmosFollower key={s.questionId} apiKey={s.desmosKey} state={s.desmos} onTry={calc.tryIt}/>}
    <footer className="lesson-footer"><span>{model.name}</span><span className="lesson-position">Question {s.index + 1} of {s.total}</span>{!s.reviewMode && <button id="lesson-lock" className="lesson-submit" disabled={!active} onClick={() => setConfirm(s.questionId)}>Submit</button>}</footer>
    <dialog className="lesson-confirm-dialog" ref={dialog} onCancel={() => setConfirm(null)}><p>Have you double checked your answer and made sure it's right?</p><div><button id="lesson-back" onClick={() => { setConfirm(null); document.getElementById('lesson-lock')?.focus(); }}>Go back</button><button id="lesson-confirm" onClick={() => { const id = confirm; setConfirm(null); if (id && active && id === s.questionId) bridge.lock(id); }}>Yes, submit</button></div></dialog>
  </>;
}

// A math question is on screen (the Calculator button and window follow it).
function mathOnScreen({ snapshot: s, self }: PlayerModel) {
  if (s.mode === 'self' && self && !s.reviewMode) {
    if (s.poll || s.pollResult || s.status !== 'live' || s.phase !== 'ANSWERING' || s.submitted || self.review) return false;
    return s.questions?.find(q => q.id === self.position)?.section === 'Math';
  }
  return s.status !== 'lobby' && s.question?.section === 'Math';
}

export function mountLesson(root: HTMLElement, bridge: Bridge) {
  const react = createRoot(root);
  let model: PlayerModel;
  let followMark: Mark | null = null;
  let terminal = '';
  let expiry: ReturnType<typeof setTimeout>;
  const screen = () => terminal ? <div className="lesson-terminal" role="status"><h2>{terminal}</h2></div> : model.snapshot.mode === 'self' && model.self && !model.snapshot.reviewMode ? model.snapshot.poll || model.snapshot.pollResult ? <PollScreen key={model.snapshot.poll?.endsAt ?? 'result'} model={model} bridge={bridge}/> : <SelfPlayer model={model} bridge={bridge}/> : <Player model={model} bridge={bridge} terminal={terminal} followMark={followMark}/>;
  // The student's own calculator lives above the screens so it survives questions, polls and review.
  const render = () => { if (model) flushSync(() => react.render(model.snapshot.hasMath && model.snapshot.desmosKey
    ? <CalculatorShell apiKey={model.snapshot.desmosKey} math={!terminal && mathOnScreen(model)}>{screen()}</CalculatorShell>
    : screen())); };
  const dot = () => { const card = document.getElementById('lesson-card'); return card ? Ink.laser(card) : null; };
  return {
    update(next: PlayerModel) { model = next; render(); },
    annotate(mark: Mark) { followMark = mark; render(); },
    // No React render per packet. The presenter heartbeats every 2.5 s while idle, so the dot
    // stays put until an explicit hide; the long expiry only covers a silently dropped presenter.
    laser(point: Laser) {
      clearTimeout(expiry);
      if (point.hide) { dot()?.hide(); return; }
      dot()?.show(point);
      expiry = setTimeout(() => dot()?.hide(), 8000);
    },
    terminal(text: string) { terminal = text; render(); },
    reset() { terminal = ''; followMark = null; clearTimeout(expiry); flushSync(() => react.render(null)); },
    destroy() { clearTimeout(expiry); react.unmount(); }
  };
}

export function mountStage(root: HTMLElement, props: StageProps) {
  const react = createRoot(root);
  flushSync(() => react.render(<Stage {...props}/>));
  return () => react.unmount();
}

export function mountHistory(root: HTMLElement, source: LessonHistory | number, mathify: (el: HTMLElement) => void, close: () => void, report: (r: { questionId: string; element: HTMLElement }) => void, options?: HistoryOptions) {
  const react = createRoot(root);
  let resolve: (history: LessonHistory | null) => void;
  const ready = new Promise<LessonHistory | null>(done => { resolve = done; });
  flushSync(() => react.render(<HistoryScreen source={source} options={options} mathify={mathify} close={close} report={report} ready={history => resolve(history)}/>));
  return Object.assign(() => { resolve(null); react.unmount(); }, { ready });
}

export function mountReflection(root: HTMLElement, options: ReflectionOptions) {
  const react = createRoot(root);
  flushSync(() => react.render(<Reflection {...options}/>));
  return () => react.unmount();
}

export { mountBank } from './Bank';
export { createRecorder, pick, commit, remember, firstTry, outcome, SHOW_ANSWER_AFTER } from './record';
export * as Plan from './plan';
export { mountBankHome } from './qbank/BankHome';
export { mountHome } from './home/HomeScreen';
export { applyExtraFilters } from './qbank/filterTypes';
export { EXTRA_FILTERS } from './qbank/extraFilters';
export { migrateSection } from './qbank/selection';
export { loadSaved, setSaved, savedIds, subscribe as subscribeSaved } from './qbank/saved';
export { mountAnalytics } from './analytics/AnalyticsView';
export { buckets as analyticsBuckets } from './analytics/analytics';
