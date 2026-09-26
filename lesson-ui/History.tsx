import { useLayoutEffect, useRef, useState } from 'react';
import { Check, X, ChevronLeft, ChevronRight } from 'lucide-react';
import { Stage } from './Stage';
import { DesmosFollower } from './Desmos';
import { notesHTML } from './notes';
import type { LessonHistory } from './types';

// §9.1 My Lessons: one ended session, one question at a time (one Desmos at a time on a
// Chromebook). Everything is read-only: the saved review marks, the final graph, the answers.
export function HistoryView({ history, mathify, close }: { history: LessonHistory; mathify: (el: HTMLElement) => void; close: () => void }) {
  const [at, setAt] = useState(0);
  const explanation = useRef<HTMLDivElement>(null);
  const breakdown = useRef<HTMLDivElement>(null);
  const item = history.questions[at];
  useLayoutEffect(() => {
    if (!item) return;
    if (explanation.current) { explanation.current.innerHTML = item.question.explanation_html || ''; mathify(explanation.current); }
    if (breakdown.current) { breakdown.current.innerHTML = notesHTML(item.notes); mathify(breakdown.current); }
  }, [item]);
  const verdict = !item ? null : !item.inSet ? <div className="lesson-verdict" id="history-not-in-set">Not in your set</div>
    : !item.recorded ? <div className="lesson-verdict" id="history-no-response">No response recorded</div>
    : <div className="lesson-verdict" id="history-verdict"><span>{item.correct === 1 ? <Check aria-label="Correct"/> : item.correct === 0 ? <X aria-label="Incorrect"/> : null}</span>{item.answer ? `Your answer: ${item.answer}` : 'No answer selected'}</div>;
  return <>
    <span hidden id="lesson-check-icon"><Check size={20} aria-label="Correct"/></span><span hidden id="lesson-x-icon"><X size={20} aria-label="Incorrect"/></span>
    <header className="lesson-header history-header">
      <h1>Lesson {history.paddedId} · {history.title}</h1>
      <div className="history-score">{history.score.scorable ? `${history.score.right} / ${history.score.scorable} correct` : ''}</div>
      <nav className="lesson-tools"><button id="history-close" onClick={close}>Back to My Lessons</button></nav>
    </header>
    <nav className="history-nav" aria-label="Questions">
      {history.questions.map((q, i) => <button key={q.question.id} aria-current={i === at ? 'true' : undefined} onClick={() => setAt(i)}>{q.number}</button>)}
    </nav>
    <main className={`lesson-main${item?.desmos ? ' with-desmos' : ''}`}>
      {!item ? <p className="lesson-terminal">No questions were shown in this lesson.</p> : <>
        <Stage key={item.question.id} question={item.question} number={item.number} picked={item.inSet ? item.answer || '' : ''} active={false} revealed marks={item.annotations} mathify={mathify}/>
        <section className="lesson-reveal" id="history-reveal">
          <p id="history-correct">Correct answer: {item.question.answer}</p>
          {verdict}
          <details open><summary>Official explanation</summary><div ref={explanation} id="history-explanation"/></details>
          <section className="history-breakdown"><h2>Breakdown</h2>{item.notes.trim() ? <div ref={breakdown} id="history-breakdown"/> : <p>No breakdown for this question.</p>}</section>
        </section>
      </>}
    </main>
    {item?.desmos && <DesmosFollower key={item.question.id} apiKey={history.desmosKey} state={item.desmos} readOnly/>}
    <footer className="lesson-footer">
      <button id="history-prev" disabled={at === 0} onClick={() => setAt(at - 1)}><ChevronLeft size={18} aria-hidden="true"/>Back</button>
      <span className="lesson-position">Question {item?.number ?? 0} · {at + 1} of {history.questions.length}</span>
      <button id="history-next" className="lesson-submit" disabled={at >= history.questions.length - 1} onClick={() => setAt(at + 1)}>Next<ChevronRight size={18} aria-hidden="true"/></button>
    </footer>
  </>;
}
