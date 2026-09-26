import { useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { ChevronLeft, ChevronRight, ChevronUp, Flag, Circle, EllipsisVertical, LogOut, Users, Hourglass, CircleCheck } from 'lucide-react';
import { Stage } from './Stage';
import type { Bridge, PlayerModel } from './types';

const clock = (ms: number) => { const s = Math.ceil(ms / 1000); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };

// Self-paced student view (§8.3): Bluebook-style Back / navigator / Next, flags, review page and
// Submit all. It shows no correctness: the server sends none until the session's review.
export function SelfPlayer({ model, bridge }: { model: PlayerModel; bridge: Bridge }) {
  const { snapshot: s, remaining } = model;
  const self = model.self!;
  const [flags, setFlags] = useState<string[]>([]);
  const [navigator, setNavigator] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const [hiddenClock, hideClock] = useState(false);
  const dialog = useRef<HTMLDialogElement>(null);
  const ids = s.assignedQuestionIds || [];
  const questions = s.questions || [];
  const index = self.position ? ids.indexOf(self.position) : -1;
  const question = questions.find(q => q.id === self.position);
  const running = s.status === 'live' && s.phase === 'ANSWERING' && remaining > 0 && !s.submitted && !self.submitting;
  useLayoutEffect(() => { if (confirm) dialog.current?.showModal(); else dialog.current?.close(); }, [confirm]);
  useLayoutEffect(() => { if (!running) { setConfirm(false); setNavigator(false); } }, [running]);
  const go = (id: string | null) => { setNavigator(false); bridge.navigate?.(id); };
  const state = (id: string) => self.selections[id] ? 'answered' : 'unanswered';
  const grid = (onPick: (id: string) => void) => <ol className="self-grid">{ids.map((id, n) =>
    <li key={id}><button data-self-q={id} data-state={state(id)} data-flagged={flags.includes(id)} aria-current={!self.review && id === self.position ? 'step' : undefined}
      aria-label={`Question ${n + 1}, ${state(id)}${flags.includes(id) ? ', flagged' : ''}`} onClick={() => onPick(id)}>{n + 1}{flags.includes(id) && <Flag aria-hidden="true"/>}</button></li>)}</ol>;
  let body;
  if (s.status === 'lobby') body = <section className="lesson-lobby"><Users size={36} aria-hidden="true"/><h2>Waiting for the instructor to start…</h2><p>{s.count} joined</p></section>;
  else if (s.status === 'ended') body = <Notice>Session ended.</Notice>;
  else if (s.status === 'review' && s.reviewed) body = <Notice>Waiting for the instructor to choose what to review next.</Notice>;
  else if (!ids.length) body = <Notice>{s.status === 'live' ? 'Not enough time left to join this set — you can join the review when it starts.' : 'The set has finished — you can join the review when it starts.'}</Notice>;
  else if (s.status !== 'live' || s.phase !== 'ANSWERING') body = <Notice>{s.submitted ? 'Set finished. Your answers were submitted.' : 'Time is up. Your answers were submitted automatically.'} Waiting for the instructor to start the review.</Notice>;
  else if (s.submitted) body = <Notice icon>Submitted. Waiting for the session to end.</Notice>;
  else if (self.review) body = <section id="self-review" className="self-review" aria-labelledby="self-review-title">
    <h2 id="self-review-title">Check your work</h2>
    <p>Answered {ids.filter(id => self.selections[id]).length} of {ids.length}. Select a question to go back to it.</p>
    <p className="self-legend"><span className="self-key answered"/>Answered <span className="self-key unanswered"/>Unanswered <Flag aria-hidden="true"/>Flagged for review</p>
    {grid(go)}
    <button id="self-submit" className="lesson-submit" disabled={!running} onClick={() => setConfirm(true)}>Submit all</button>
  </section>;
  else if (question) body = <Stage key={question.id} question={question} number={index + 1} picked={self.selections[question.id] || ''} active={running} revealed={false} mathify={bridge.mathify} onSelect={answer => bridge.select(question.id, answer)}/>;
  const live = s.status === 'live' && s.phase === 'ANSWERING' && ids.length > 0 && !s.submitted;
  return <>
    <header className="lesson-header">
      <h1>{s.title}{live && !self.review && index >= 0 && <span className="self-count"> · Q {index + 1} / {ids.length}</span>}</h1>
      <div className="lesson-timer"><strong id="lesson-clock" style={{ visibility: hiddenClock ? 'hidden' : 'visible', color: s.phase === 'ANSWERING' && remaining <= 60000 ? '#bd2424' : undefined }}>{s.endsAt && s.status === 'live' ? `${clock(remaining)}` : ''}</strong><span className="self-remaining">{s.endsAt && s.status === 'live' ? 'remaining' : ''}</span>{s.endsAt && s.status === 'live' && <button aria-label={hiddenClock ? 'Show timer' : 'Hide timer'} onClick={() => hideClock(!hiddenClock)}>{hiddenClock ? 'Show' : 'Hide'}</button>}</div>
      <nav className="lesson-tools" aria-label="Lesson tools">
        {live && !self.review && self.position && <button id="self-flag" aria-pressed={flags.includes(self.position)} onClick={() => setFlags(list => list.includes(self.position!) ? list.filter(x => x !== self.position) : [...list, self.position!])}><Flag aria-hidden="true"/><span>{flags.includes(self.position) ? 'Flagged' : 'Flag for review'}</span></button>}
        <details className="lesson-more"><summary><EllipsisVertical aria-hidden="true"/><span>More</span></summary><div><button id="lesson-leave" onClick={bridge.leave}><LogOut aria-hidden="true"/>Leave view</button></div></details>
        <span id="lesson-connection" role="status" aria-label={model.connected ? 'Connected' : 'Reconnecting…'}><Circle fill="currentColor" size={9} aria-hidden="true"/><span className="lesson-sr">{model.connected ? 'Connected' : 'Reconnecting…'}</span></span>
      </nav>
    </header>
    {!model.connected && <div className="lesson-reconnect" role="status">Reconnecting…</div>}
    <main className="lesson-main self-main">{body}<p id="lesson-error" role="alert">{model.error}</p></main>
    {live && <footer className="lesson-footer self-footer">
      <button id="self-back" disabled={!self.review && index <= 0} onClick={() => go(self.review ? ids[ids.length - 1] : ids[index - 1])}><ChevronLeft aria-hidden="true"/>Back</button>
      <span className="self-position-wrap">
        <button id="self-nav" className="lesson-position" aria-expanded={navigator} onClick={() => setNavigator(!navigator)}>{self.review ? 'Review page' : `Question ${index + 1} of ${ids.length}`}<ChevronUp aria-hidden="true"/></button>
        {navigator && <section id="self-navigator" className="self-navigator" aria-label="Question navigator">
          <p className="self-legend"><span className="self-key answered"/>Answered <span className="self-key unanswered"/>Unanswered <Flag aria-hidden="true"/>Flagged</p>
          {grid(go)}
          <button id="self-go-review" onClick={() => go(null)}>Go to Review Page</button>
        </section>}
      </span>
      {!self.review ? <button id="self-next" className="lesson-submit" onClick={() => go(index + 1 < ids.length ? ids[index + 1] : null)}>Next<ChevronRight aria-hidden="true"/></button> : <span/>}
    </footer>}
    <dialog className="lesson-confirm-dialog" ref={dialog} onCancel={() => setConfirm(false)}><p>Have you double checked your answer and made sure it's right?</p><div><button id="self-cancel" onClick={() => setConfirm(false)}>Go back</button><button id="self-confirm" onClick={() => { setConfirm(false); if (running) bridge.submitAll?.(); }}>Yes, submit</button></div></dialog>
  </>;
}

function Notice({ children, icon }: { children: ReactNode; icon?: boolean }) {
  return <section id="self-status" className="lesson-lobby" role="status">{icon ? <CircleCheck size={36} aria-hidden="true"/> : <Hourglass size={36} aria-hidden="true"/>}<h2>{children}</h2></section>;
}
