import { useState } from "react";
import { Check, X } from "lucide-react";
import { Stage } from "../lesson-ui/Stage";
import type { Question } from "../lesson-ui/types";
import { formatTime, mathify, notesHTML } from "./helpers";
import { Badge, Empty, HTML } from "./ui";

// [answer, correct, ms], graded by the room.
type Cell = [string | null, boolean | null, number];
type Group = {
  label: string;
  count: number;
  correct: boolean;
  users: number[];
};
export type SelfRoom = {
  status: string;
  phase: string;
  roster: Record<string, string>;
  students: string[];
  items: { questionId: string; timeLimitSec: number }[];
  positions: Record<string, string>;
  submitted: Record<string, boolean>;
  lateJoin: Record<string, number>;
  grid: Record<string, Record<string, Cell>>;
  cards: Record<
    string,
    {
      assigned: number;
      answered: number;
      right: number;
      avgMs: number | null;
      groups: Group[];
    }
  >;
  questions?: Record<string, Question & { notes: string }>;
  // After the set (§8.6–8.7).
  overview?: Overview;
  reviewed?: string[];
  poll?: { endsAt: number; mostMissed: string; missed: number; choices: string[]; one: number; two: number; picks: Record<string, number>; voted: number; connected: number };
  pollResult?: { questionId: string; number: number; winner: 1 | 2; one: number; two: number; endsAt: number };
};
export type Overview = {
  students: Record<string, { assigned: number; scorable: number; right: number; answered: number; ms: number }>;
  questions: { questionId: string; assigned: number; answered: number; wrong: number; right: number; skill: string; difficulty: string }[];
  ranking: string[];
  mean: number | null;
  median: number | null;
  takers: number;
  completed: number;
};

const clock = (ms: number | null) =>
  ms == null ? "—" : formatTime(Math.round(ms / 1000));

// Self-paced instructor grid (§8.4): rows = students, columns = questions, graded by the room.
export function SelfGrid({ s }: { s: SelfRoom }) {
  const [column, setColumn] = useState<string | null>(null);
  const running = s.status === "live" && s.phase === "ANSWERING";
  const students = Object.entries(s.roster).sort((a, b) =>
    a[1].localeCompare(b[1]),
  );
  return (
    <div className="self-live">
      <section className="panel self-grid-panel">
        <p className="self-legend">
          <span className="cell" data-state="right">■</span> right
          <span className="cell" data-state="wrong">□</span> wrong
          <span className="cell" data-state="unreached" data-current="true">◆</span> currently on
          <span className="cell" data-state="unreached">·</span> not reached
          <span className="cell" data-state="unassigned">░</span> not assigned (late join)
        </p>
        <div className="self-grid-scroll">
          <table id="self-grid">
            <thead>
              <tr>
                <th scope="col">Student</th>
                {s.items.map((item, i) => (
                  <th scope="col" key={item.questionId}>
                    <button
                      data-col={item.questionId}
                      aria-pressed={column === item.questionId}
                      onClick={() =>
                        setColumn(column === item.questionId ? null : item.questionId)
                      }
                    >
                      Q{i + 1}
                    </button>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {students.map(([id, name]) => (
                <tr key={id} data-student={id}>
                  <th scope="row">
                    {name}
                    {id in s.lateJoin && <Badge>late join</Badge>}
                    {s.submitted[id] && <Badge tone="green">submitted</Badge>}
                  </th>
                  {s.items.map(({ questionId }) => {
                    const cell = s.grid[id]?.[questionId];
                    const current = running && !s.submitted[id] && s.positions[id] === questionId;
                    const state = !cell
                      ? "unassigned"
                      : !cell[0]
                        ? "unreached"
                        : cell[1]
                          ? "right"
                          : "wrong";
                    return (
                      <td
                        key={questionId}
                        className="cell"
                        data-cell={`${id}:${questionId}`}
                        data-state={state}
                        data-current={current}
                        title={cell ? `${cell[0] || "blank"} · ${clock(cell[2])}` : "Not assigned"}
                      >
                        {current
                          ? "◆"
                          : { unassigned: "░", unreached: "·", right: "■", wrong: "□" }[state]}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
          {!students.length && <Empty>No students yet.</Empty>}
        </div>
        <p className="self-hint">Select a question number to open its card.</p>
      </section>
      {column && <QuestionCard s={s} id={column} close={() => setColumn(null)} />}
    </div>
  );
}

export function QuestionCard({ s, id, close }: { s: SelfRoom; id: string; close: () => void }) {
  const [group, setGroup] = useState<number | null>(null);
  const card = s.cards[id];
  const index = s.items.findIndex((x) => x.questionId === id);
  const q = s.questions?.[id];
  if (!card) return null;
  const max = Math.max(1, ...card.groups.map((g) => g.count));
  return (
    <section id="self-card" className="panel self-card" aria-label={`Question ${index + 1} card`}>
      <div className="section-head">
        <h3>Q{index + 1}</h3>
        <button className="icon-button" aria-label="Close question card" onClick={close}>
          <X />
        </button>
      </div>
      <p className="self-card-facts">
        <span data-fact="answered">
          answered {card.answered}/{card.assigned} assigned
        </span>
        <span data-fact="accuracy">
          accuracy {card.answered ? Math.round((card.right / card.answered) * 100) : 0}%
        </span>
        <span data-fact="avg" data-ms={card.avgMs ?? ""}>
          avg time {clock(card.avgMs)} (set {formatTime(s.items[index].timeLimitSec)})
        </span>
      </p>
      <div className="distribution">
        {card.groups.map((g, i) => (
          <div className="distribution-row" key={g.label}>
            <button
              data-group={i}
              className={g.correct ? "correct" : ""}
              aria-expanded={group === i}
              onClick={() => setGroup(group === i ? null : i)}
            >
              <span className="bar-label">
                <span>
                  {g.label}
                  {g.correct && <Check aria-label="Correct choice" />}
                </span>
                <strong>{g.count}</strong>
              </span>
              <span className="track">
                <span style={{ width: `${(g.count / max) * 100}%`, background: g.correct ? "#448a3b" : "#7771b1" }} />
              </span>
            </button>
            {group === i && (
              <div id="self-group" className="names-popover" role="status">
                <strong>{g.label}</strong>
                {g.users.map((n) => {
                  const userId = s.students[n];
                  const ms = s.grid[userId]?.[id]?.[2] ?? 0;
                  return (
                    <p key={userId} data-ms={ms}>
                      {s.roster[userId]}
                      <span>{clock(ms)}</span>
                    </p>
                  );
                })}
                {!g.users.length && <p>No students</p>}
              </div>
            )}
          </div>
        ))}
      </div>
      {q && (
        <details className="self-card-details">
          <summary>Question, explanation & notes</summary>
          <Stage key={id} question={q} number={index + 1} id="self-card-stage" revealed mathify={mathify} />
          <h3>Official explanation</h3>
          <HTML html={q.explanation_html || "<p>Explanation unavailable.</p>"} />
          <h3>My notes</h3>
          <HTML html={notesHTML(q.notes || "")} />
        </details>
      )}
    </section>
  );
}
