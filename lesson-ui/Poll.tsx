import { useState } from 'react';
import { Circle, EllipsisVertical, LogOut, Vote } from 'lucide-react';
import type { Bridge, PlayerModel } from './types';

const marks = { right: '✓', wrong: '✗', unassigned: 'not in your set', unscored: '—' };
const clock = (ms: number) => { const s = Math.ceil(ms / 1000); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };

// Review poll (§8.7): most-missed vs. a question the student picks. Option 2 needs a pick.
export function PollScreen({ model, bridge }: { model: PlayerModel; bridge: Bridge }) {
  const s = model.snapshot, poll = s.poll, result = s.pollResult;
  const [option, setOption] = useState<1 | 2 | null>(poll?.vote?.option ?? null);
  const [pick, setPick] = useState(poll?.vote?.questionId || '');
  const open = !!poll && model.remaining > 0;
  const counted = poll?.vote && (poll.vote.option === 1 ? 'Most-missed question' : `Q${poll.choices.find(c => c.questionId === poll.vote!.questionId)?.number}`);
  return <>
    <header className="lesson-header">
      <h1>{s.title}<span className="self-count"> · Review poll</span></h1>
      <div className="lesson-timer"><strong id="lesson-clock">{poll ? clock(model.remaining) : ''}</strong></div>
      <nav className="lesson-tools" aria-label="Lesson tools">
        <details className="lesson-more"><summary><EllipsisVertical aria-hidden="true"/><span>More</span></summary><div><button id="lesson-leave" onClick={bridge.leave}><LogOut aria-hidden="true"/>Leave view</button></div></details>
        <span id="lesson-connection" role="status" aria-label={model.connected ? 'Connected' : 'Reconnecting…'}><Circle fill="currentColor" size={9} aria-hidden="true"/><span className="lesson-sr">{model.connected ? 'Connected' : 'Reconnecting…'}</span></span>
      </nav>
    </header>
    {!model.connected && <div className="lesson-reconnect" role="status">Reconnecting…</div>}
    <main className="lesson-main self-main">
      {result ? <section id="poll-result" className="lesson-lobby lesson-poll" role="status">
        <Vote size={36} aria-hidden="true"/>
        <h2>Reviewing Q{result.number}</h2>
        <p>Most-missed question {result.one} · A question I choose {result.two}</p>
      </section> : poll && <section id="poll" className="lesson-poll" aria-labelledby="poll-title">
        <h2 id="poll-title">Which question should we review?</h2>
        <label className="poll-option"><input id="poll-1" type="radio" name="poll" checked={option === 1} disabled={!open} onChange={() => setOption(1)}/>
          <span>Most-missed question: <strong>Q{poll.mostMissed.number} ({poll.mostMissed.missed} {poll.mostMissed.missed === 1 ? 'person' : 'people'} missed it)</strong></span></label>
        <label className="poll-option"><input id="poll-2" type="radio" name="poll" checked={option === 2} disabled={!open} onChange={() => setOption(2)}/>
          <span>A question I choose</span></label>
        {option === 2 && <label className="poll-pick">Question
          <select id="poll-pick" value={pick} disabled={!open} onChange={e => setPick(e.target.value)}>
            <option value="">Choose a question…</option>
            {poll.choices.map(c => <option key={c.questionId} value={c.questionId}>Q{c.number} {marks[c.mark]}</option>)}
          </select></label>}
        <button id="poll-vote" className="lesson-submit" disabled={!open || !option || (option === 2 && !pick)} onClick={() => bridge.vote?.(option!, option === 2 ? pick : undefined)}>{poll.vote ? 'Change vote' : 'Vote'}</button>
        <p id="poll-status" role="status">{!open ? 'Poll closed.' : option === 2 && !pick ? 'Pick a question from the list for your vote to count.' : counted ? `Vote counted: ${counted}.` : ''}</p>
      </section>}
      <p id="lesson-error" role="alert">{model.error}</p>
    </main>
  </>;
}
