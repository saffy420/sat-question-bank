import { useState } from "react";
import { ArrowDownUp, Check, Eye, Vote, X } from "lucide-react";
import { QuestionCard, SelfGrid, type SelfRoom } from "./SelfLive";
import { formatTime } from "./helpers";
import { Badge, Empty } from "./ui";

type Send = (type: string, fields?: Record<string, unknown>) => void;
const pct = (x: number | null) => (x == null ? "—" : `${Math.round(x * 100)}%`);
const clock = (ms: number) => formatTime(Math.round(ms / 1000));
const number = (s: SelfRoom, id: string) =>
  s.items.findIndex((x) => x.questionId === id) + 1;

// Post-set overview and poll launcher (§8.6).
export function Overview({ s, send }: { s: SelfRoom; send: Send }) {
  const o = s.overview!;
  const [sort, setSort] = useState<{ key: string; dir: number }>({ key: "name", dir: 1 });
  const [student, setStudent] = useState<string | null>(null);
  const [card, setCard] = useState<string | null>(null);
  const [target, setTarget] = useState(s.items[0]?.questionId || "");
  const reviewed = s.reviewed || [];
  const open = s.items.filter((x) => !reviewed.includes(x.questionId));
  const rows = Object.entries(o.students).map(([id, r]) => ({
    id,
    name: s.roster[id] || id,
    r,
    score: r.scorable ? r.right / r.scorable : -1,
    submitted: !!s.submitted[id],
    late: id in s.lateJoin,
  }));
  const value = (row: (typeof rows)[number]) =>
    ({ name: row.name, score: row.score, time: row.r.ms, submitted: +row.submitted, late: +row.late })[sort.key]!;
  rows.sort((a, b) => {
    const x = value(a), y = value(b);
    return (typeof x === "string" ? x.localeCompare(y as string) : x - (y as number)) * sort.dir || a.name.localeCompare(b.name);
  });
  const head = (key: string, label: string) => (
    <th scope="col" aria-sort={sort.key === key ? (sort.dir > 0 ? "ascending" : "descending") : undefined}>
      <button data-sort={key} onClick={() => setSort({ key, dir: sort.key === key ? -sort.dir : 1 })}>
        {label}
        <ArrowDownUp aria-hidden="true" />
      </button>
    </th>
  );
  return (
    <div className="review-overview">
      <section className="panel review-launcher" aria-label="Review">
        <button className="primary" data-live="startPoll" disabled={!open.length} onClick={() => send("startPoll")}>
          <Vote />
          Start review poll
        </button>
        <label>
          Review a specific question
          <select id="review-target" value={target} onChange={(e) => setTarget(e.target.value)}>
            {s.items.map((x, i) => (
              <option key={x.questionId} value={x.questionId}>
                Q{i + 1}
                {reviewed.includes(x.questionId) ? " (reviewed)" : ""}
              </option>
            ))}
          </select>
        </label>
        <button data-live="goto" onClick={() => send("goto", { questionId: target })}>
          <Eye />
          Review
        </button>
        {!open.length && <p>Every question has been reviewed.</p>}
      </section>
      <section className="panel review-summary" id="review-summary" aria-label="Class summary">
        <p><span>Average score</span><strong data-fact="mean">{pct(o.mean)}</strong></p>
        <p><span>Median</span><strong data-fact="median">{pct(o.median)}</strong></p>
        <p><span>Completed (answered every question)</span><strong data-fact="completed">{o.completed} of {o.takers}</strong></p>
      </section>
      <div className="review-columns">
        <section className="panel">
          <h3>Students</h3>
          <table id="review-students" className="review-table">
            <thead>
              <tr>
                {head("name", "Name")}
                {head("score", "Score")}
                {head("time", "Time used")}
                {head("submitted", "Submitted early")}
                {head("late", "Late join")}
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id} data-student={row.id} aria-selected={student === row.id}>
                  <th scope="row">
                    <button onClick={() => setStudent(student === row.id ? null : row.id)}>{row.name}</button>
                  </th>
                  <td data-fact="score">{row.r.assigned ? `${row.r.right} / ${row.r.assigned}` : "no set"}</td>
                  <td>{clock(row.r.ms)}</td>
                  <td>{row.submitted ? "yes" : "no"}</td>
                  <td>{row.late ? "yes" : "no"}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {!rows.length && <Empty>No students.</Empty>}
          {student && (
            <div id="review-student" className="review-student" role="region" aria-label={`${s.roster[student]} answers`}>
              <h4>{s.roster[student]}</h4>
              {s.items.filter((x) => s.grid[student]?.[x.questionId]).map((x) => {
                const [answer, correct, ms] = s.grid[student][x.questionId];
                return (
                  <p key={x.questionId} data-q={x.questionId}>
                    <span>Q{number(s, x.questionId)}</span>
                    <span>{answer || "blank"}</span>
                    {correct ? <Check aria-label="Correct" className="right-icon" /> : <X aria-label="Incorrect" className="wrong-icon" />}
                    <span>{clock(ms)}</span>
                  </p>
                );
              })}
              {!Object.keys(s.grid[student] || {}).length && <p>Not in the set (joined too late).</p>}
            </div>
          )}
        </section>
        <section className="panel">
          <h3>Most missed</h3>
          <ol id="review-missed" className="review-missed">
            {o.ranking.map((id) => {
              const q = o.questions.find((x) => x.questionId === id)!;
              return (
                <li key={id}>
                  <button data-missed={id} onClick={() => setCard(card === id ? null : id)}>
                    <strong>Q{number(s, id)}</strong> — {q.wrong} of {q.assigned} wrong ({q.assigned ? Math.round((q.wrong / q.assigned) * 100) : 0}%)
                    {q.skill && <> · {q.skill}</>}
                    {q.difficulty && <> · {q.difficulty}</>}
                  </button>
                  {reviewed.includes(id) && <Badge>reviewed</Badge>}
                </li>
              );
            })}
          </ol>
        </section>
      </div>
      {card && <QuestionCard s={s} id={card} close={() => setCard(null)} />}
      <details className="panel roster-details">
        <summary>Set grid</summary>
        <SelfGrid s={s} />
      </details>
    </div>
  );
}

// Instructor side of a running poll (§8.7): live tallies only, the room decides when it closes.
export function PollPanel({ s }: { s: SelfRoom }) {
  const p = s.poll!;
  return (
    <section id="review-poll" className="panel review-poll" aria-label="Review poll">
      <h2>Review poll</h2>
      <p data-fact="voted">
        Votes {p.voted} of {p.connected} connected
      </p>
      <p data-option="1">
        Most-missed question: Q{number(s, p.mostMissed)} ({p.missed} missed it) <strong>{p.one}</strong>
      </p>
      <p data-option="2">
        A question they choose <strong>{p.two}</strong>
      </p>
      <ul>
        {Object.entries(p.picks).map(([id, n]) => (
          <li key={id} data-pick={id}>
            Q{number(s, id)} × {n}
          </li>
        ))}
      </ul>
    </section>
  );
}

export function ResultPanel({ s }: { s: SelfRoom }) {
  const r = s.pollResult!;
  return (
    <section id="review-result" className="panel review-poll" role="status">
      <h2>Reviewing Q{r.number}</h2>
      <p>
        Most-missed question {r.one} · A question they choose {r.two}
      </p>
    </section>
  );
}
