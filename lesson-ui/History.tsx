import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Check, X, ChevronLeft, ChevronRight } from 'lucide-react';
import { Stage } from './Stage';
import { PositionPill, QuestionGrid } from './Chrome';
import { DesmosFollower } from './Desmos';
import { notesHTML } from './notes';
import type { HistoryOptions, LessonHistory } from './types';

const POLL_MS = 1500;
const WAIT_MS = 30000;
const clock = (ms: number | null | undefined) => { const s = Math.round(Math.max(0, ms ?? 0) / 1000); return ms == null ? '—' : `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };
const state = (item: LessonHistory['questions'][number]) => !item.inSet ? 'unassigned' : item.correct === 1 ? 'correct' : item.correct === 0 ? 'wrong' : !item.recorded || !item.answer ? 'unanswered' : 'unscored';
const label = (item: LessonHistory['questions'][number]) => !item.inSet ? 'Not in your set' : !item.recorded || !item.answer ? 'Blank' : item.correct === 1 ? 'Right' : item.correct === 0 ? 'Wrong' : 'Unscored';

type Props = { mathify: (el: HTMLElement) => void; close: () => void; report: (r: { questionId: string; element: HTMLElement }) => void };

export function HistoryScreen({ source, options, ready, ...props }: Props & { source: LessonHistory | number; options?: HistoryOptions; ready: (history: LessonHistory) => void }) {
  const [history, setHistory] = useState<LessonHistory>();
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let alive = true, timer: ReturnType<typeof setTimeout>;
    const controller = new AbortController(), since = Date.now();
    setHistory(undefined); setError(''); setSaving(false);
    const accept = (data: LessonHistory) => {
      if (!alive) return;
      setSaving(false); setHistory(data);
    };
    const load = async () => {
      try {
        if (typeof source !== 'number') { accept(source); return; }
        if (!options?.headers) throw new Error('Sign in to load lesson results.');
        const headers = await options.headers();
        if (!alive) return;
        const response = await fetch(`/api/lesson-history/${source}`, { headers, signal: controller.signal });
        if (!alive) return;
        if (response.status === 404) {
          if (Date.now() - since < WAIT_MS) {
            setSaving(true);
            timer = setTimeout(load, Math.min(POLL_MS, WAIT_MS - (Date.now() - since)));
            return;
          }
          throw new Error('Results are still being saved');
        }
        if (!response.ok) throw new Error(response.status === 401 ? 'Please sign in again.' : 'Could not load lesson results.');
        const data: LessonHistory = await response.json();
        if (data.sessionId !== source) throw new Error('Lesson results did not match this session.');
        accept(data);
      } catch (e) {
        if (!alive) return;
        setSaving(false); setError(e instanceof Error ? e.message : 'Could not load lesson results.');
      }
    };
    load();
    return () => { alive = false; clearTimeout(timer); controller.abort(); };
  }, [source, attempt]);
  useLayoutEffect(() => {
    if (history) { ready(history); options?.onReady?.(history); }
  }, [history]);
  useEffect(() => {
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !document.querySelector('dialog[open]')) { event.preventDefault(); props.close(); }
    };
    document.addEventListener('keydown', escape);
    return () => document.removeEventListener('keydown', escape);
  }, [props.close]);
  return history ? <HistoryView key={history.sessionId} history={history} {...props}/> : <>
    <header className="lesson-header history-header"><h1>Lesson results</h1><nav className="lesson-tools"><button id="history-close" aria-label="Close lesson results" onClick={props.close}><X aria-hidden="true"/></button></nav></header>
    <main className="lesson-main"><section id="history-loading" className="lesson-terminal" role={error ? 'alert' : 'status'}>{error ? <><p>{error}</p><button id="history-retry" onClick={() => setAttempt(n => n + 1)}>Retry</button></> : saving ? 'Saving results…' : 'Loading…'}</section></main>
  </>;
}

export function HistoryView({ history, mathify, close, report }: Props & { history: LessonHistory }) {
  const [at, setAt] = useState<number | null>(null);
  const [navigator, setNavigator] = useState(false);
  const [show, setShow] = useState(false);
  const explanation = useRef<HTMLDivElement>(null);
  const breakdown = useRef<HTMLDivElement>(null);
  const item = at === null ? undefined : history.questions[at];
  const go = (position: number | null) => { setNavigator(false); setAt(position); };
  useLayoutEffect(() => { document.getElementById('lesson-live')?.scrollTo(0, 0); }, [at]);
  useLayoutEffect(() => {
    if (!item || !show) return;
    if (explanation.current) { explanation.current.innerHTML = item.question.explanation_html || ''; mathify(explanation.current); }
    if (breakdown.current) { breakdown.current.innerHTML = notesHTML(item.notes); mathify(breakdown.current); }
  }, [item, show]);
  const verdict = !item ? null : !item.inSet ? <div className="lesson-verdict" id="history-not-in-set">Not in your set</div>
    : !item.recorded ? <div className="lesson-verdict" id="history-no-response">No response recorded</div>
    : <div className="lesson-verdict" id="history-verdict"><span>{item.correct === 1 ? <Check aria-label="Correct"/> : item.correct === 0 ? <X aria-label="Incorrect"/> : null}</span>{item.answer ? `Your answer: ${item.answer}` : 'No answer selected'}</div>;
  return <>
    <span hidden id="lesson-check-icon"><Check size={20} aria-label="Correct"/></span><span hidden id="lesson-x-icon"><X size={20} aria-label="Incorrect"/></span>
    <header className="lesson-header history-header">
      <h1>Lesson {history.paddedId} · {history.title}</h1>
      <nav className="lesson-tools"><button id="history-close" aria-label="Close lesson results" onClick={close}><X aria-hidden="true"/></button></nav>
    </header>
    <main className={`lesson-main${show && item?.desmos ? ' with-desmos' : ''}`}>
      {at === null ? <section id="history-summary" className="history-summary" aria-labelledby="history-summary-title">
        <h2 id="history-summary-title">Summary</h2>
        <p id="history-score" className="history-score">Score <strong>{history.score.right} / {history.score.scorable}</strong></p>
        {history.questions.length ? <div className="history-table-wrap"><table id="history-summary-table"><thead><tr><th scope="col">Question</th><th scope="col">Skill</th><th scope="col">Your answer</th><th scope="col">Correct answer</th><th scope="col">Result</th>{history.mode === 'self' && <th scope="col">Time spent</th>}</tr></thead><tbody>
          {history.questions.map((q, i) => <tr key={q.question.id} data-history-row={q.question.id} data-state={state(q)} onClick={() => go(i)}><th scope="row"><button data-history-open={q.question.id} aria-label={`Review question ${q.number}`} onClick={event => { event.stopPropagation(); go(i); }}>{q.number}</button></th><td>{q.question.skill || '—'}</td><td>{q.inSet ? (q.recorded && q.answer) || 'Blank' : '—'}</td><td>{q.question.answer || '—'}</td><td className="history-result">{q.correct === 1 && q.answer ? <Check aria-hidden="true"/> : q.correct === 0 && q.answer ? <X aria-hidden="true"/> : null}{label(q)}</td>{history.mode === 'self' && <td data-fact="time">{clock(q.timeMs)}</td>}</tr>)}
        </tbody></table></div> : <p>No questions were shown in this lesson.</p>}
      </section> : item && <>
        <Stage key={`${item.question.id}:${show}`} question={item.question} number={item.number} onReport={card => report({ questionId: item.question.id, element: card })} picked={show && item.inSet ? item.answer || '' : ''} active={false} revealed={show} marks={show ? item.annotations : undefined} eliminated={show ? item.annotations.filter(m => m.type === 'eliminate' && m.nodeId).map(m => m.nodeId!.slice(2)) : undefined} mathify={mathify}/>
        {show && <section className="lesson-reveal" id="history-reveal">
          <p id="history-correct">Correct answer: {item.question.answer}</p>
          {verdict}
          <details open><summary>Official explanation</summary><div ref={explanation} id="history-explanation"/></details>
          <section className="history-breakdown"><h2>Breakdown</h2>{item.notes.trim() ? <div ref={breakdown} id="history-breakdown"/> : <p>No breakdown for this question.</p>}</section>
        </section>}
      </>}
    </main>
    {show && item?.desmos && <DesmosFollower key={item.question.id} apiKey={history.desmosKey} state={item.desmos} readOnly/>}
    {at !== null && <footer className="lesson-footer history-footer">
      <div className="history-footer-left"><label className="history-show"><input id="history-show" type="checkbox" checked={show} onChange={event => setShow(event.target.checked)}/>Show annotations &amp; answers</label><button id="history-prev" disabled={at === 0} onClick={() => go(at - 1)}><ChevronLeft size={18} aria-hidden="true"/>Back</button></div>
      <PositionPill id="history-position" panelId="history-navigator" label={`Question ${at + 1} of ${history.questions.length}`} open={navigator} onToggle={() => setNavigator(!navigator)}>
        <QuestionGrid attr="data-history-q" onPick={id => go(history.questions.findIndex(q => q.question.id === id))} items={history.questions.map((q, i) => ({ id: q.question.id, state: state(q), flagged: false, current: i === at, label: label(q) }))}/>
        <button id="history-go-summary" onClick={() => go(null)}>Summary</button>
      </PositionPill>
      <button id="history-next" className="lesson-submit" disabled={at >= history.questions.length - 1} onClick={() => go(at + 1)}>Next<ChevronRight size={18} aria-hidden="true"/></button>
    </footer>}
  </>;
}
