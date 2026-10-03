import { useEffect, useState } from "react";
import { ArrowLeft, Check, Minus, X } from "lucide-react";
import { api, formatTime } from "./helpers";
import { Dialog, Empty } from "./ui";

// GET /api/admin/sessions/:id/results (src/session-results.js).
type Average = { right: number; scorable: number; percent: number } | null;
type Row = {
  questionId: string;
  recorded: boolean;
  answer: string | null;
  correct: boolean | null;
  timeMs: number | null;
  changes: number;
  lockedEarly: boolean;
};
type Student = {
  userId: string;
  name: string;
  joinedAt: string;
  leftAt: string | null;
  right: number;
  scorable: number;
  answered: number;
  totalMs: number;
  rows: Row[];
};
type Question = {
  questionId: string;
  number: number;
  shown: boolean;
  section: string;
  skill: string;
  difficulty: string;
  correctAnswer: string;
  scorable: boolean;
  snippet: string;
  notes: string;
  explainMs: number | null;
  answerMs: number | null;
  right: number;
  wrong: number;
  blank: number;
  responses: number;
  avgMs: number | null;
  distribution: { label: string; count: number; correct: boolean | null }[];
};
export type Results = {
  session: {
    id: number;
    paddedId: string;
    title: string;
    mode: string;
    join_code: string;
    created_at: string;
    started_at: string | null;
    ended_at: string | null;
    durationMs: number | null;
  };
  questions: Question[];
  students: Student[];
  average: Average;
};

const POLL_MS = 1500;
const WAIT_MS = 30000;
const clock = (ms: number | null | undefined) =>
  ms == null ? "—" : formatTime(Math.round(ms / 1000));
const one = (x: number) => String(Math.round(x * 10) / 10);
// "7/10": the class's mean right over mean scorable.
export const averageText = (a: Average | undefined) =>
  a ? `${one(a.right)}/${one(a.scorable)}` : "—";
const percent = (right: number, of: number) =>
  of ? `${Math.round((right / of) * 100)}%` : "—";
// D1 times are UTC without a zone.
export const localDate = (sql: string | null | undefined) => {
  const t = sql ? Date.parse(sql.replace(" ", "T") + "Z") : NaN;
  return Number.isFinite(t)
    ? new Date(t).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })
    : "—";
};
const topic = (q: Question | undefined) =>
  [q?.skill, q?.difficulty].filter(Boolean).join(" · ") || "—";

// Ended-session overview: Students (default) and Questions tabs. The room writes the ended row
// in its own flush, so right after End session the API can still answer 409 for a moment.
export function SessionResults({ id, close }: { id: number; close: () => void }) {
  const [data, setData] = useState<Results>();
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [tab, setTab] = useState<"students" | "questions">("students");
  const [student, setStudent] = useState<string | null>(null);
  useEffect(() => {
    let alive = true,
      timer: ReturnType<typeof setTimeout>;
    const since = Date.now();
    setError("");
    const load = () =>
      api<Results>(`/api/admin/sessions/${id}/results`)
        .then((d) => {
          if (!alive) return;
          setSaving(false);
          setData(d);
        })
        .catch((e: Error) => {
          if (!alive) return;
          if (e.message === "session still running" && Date.now() - since < WAIT_MS) {
            setSaving(true);
            timer = setTimeout(load, POLL_MS);
          } else {
            setSaving(false);
            setError(
              e.message === "session still running"
                ? "Results are still being saved"
                : e.message,
            );
          }
        });
    load();
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [id, attempt]);
  const title = data ? `${data.session.title || "Session"} results` : "Session results";
  return (
    <Dialog title={title} close={close} slide>
      <div className="session-results" id="session-results">
        {!data ? (
          <div className="panel" role={error ? "alert" : "status"}>
            {error ? (
              <>
                <p>{error}. Try again.</p>
                <button id="results-retry" onClick={() => setAttempt((n) => n + 1)}>
                  Retry
                </button>
              </>
            ) : saving ? (
              "Saving results…"
            ) : (
              "Loading…"
            )}
          </div>
        ) : (
          <Body
            data={data}
            tab={tab}
            setTab={(t) => {
              setTab(t);
              setStudent(null);
            }}
            student={student}
            setStudent={setStudent}
          />
        )}
      </div>
    </Dialog>
  );
}

function Body({
  data,
  tab,
  setTab,
  student,
  setStudent,
}: {
  data: Results;
  tab: "students" | "questions";
  setTab: (t: "students" | "questions") => void;
  student: string | null;
  setStudent: (id: string | null) => void;
}) {
  const { session, questions, students, average } = data;
  const byId = new Map(questions.map((q) => [q.questionId, q]));
  const picked = students.find((x) => x.userId === student);
  return (
    <>
      <p className="results-facts" id="results-facts">
        <span>Session {session.paddedId}</span>
        <span>{localDate(session.started_at || session.created_at)}</span>
        <span data-fact="duration">Duration {clock(session.durationMs)}</span>
        <span>Code {session.join_code}</span>
        <span data-fact="joined">{students.length} joined</span>
        <span data-fact="average">
          Class average {averageText(average)}
          {average ? ` (${Math.round(average.percent * 100)}%)` : ""}
        </span>
      </p>
      <div className="tabs" role="tablist">
        {(["students", "questions"] as const).map((t) => (
          <button
            key={t}
            role="tab"
            data-tab={t}
            aria-selected={tab === t}
            onClick={() => setTab(t)}
          >
            {t === "students" ? "Students" : "Questions"}
          </button>
        ))}
      </div>
      {tab === "students" && !picked && (
        <div className="table-scroll" role="tabpanel">
          <table id="results-students" className="review-table">
            <thead>
              <tr>
                <th scope="col">Name</th>
                <th scope="col">Score</th>
                <th scope="col">%</th>
                <th scope="col">Total time</th>
              </tr>
            </thead>
            <tbody>
              {students.map((x) => (
                <tr key={x.userId} data-student={x.userId}>
                  <th scope="row">
                    <button onClick={() => setStudent(x.userId)}>{x.name}</button>
                    {x.leftAt && <small> removed</small>}
                  </th>
                  <td data-fact="score">
                    {x.right} / {x.scorable}
                  </td>
                  <td>{percent(x.right, x.scorable)}</td>
                  <td>{clock(x.totalMs)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {!students.length && <Empty>No students joined.</Empty>}
        </div>
      )}
      {tab === "students" && picked && (
        <section
          id="results-student"
          className="results-student"
          role="tabpanel"
          aria-label={`${picked.name} answers`}
        >
          <button className="results-back" onClick={() => setStudent(null)}>
            <ArrowLeft />
            All students
          </button>
          <h3>
            {picked.name}{" "}
            <span className="muted">
              {picked.right} / {picked.scorable} · {clock(picked.totalMs)}
            </span>
          </h3>
          <ol className="results-rows">
            {picked.rows.map((r) => {
              const q = byId.get(r.questionId);
              const state = !r.recorded
                ? "absent"
                : !r.answer
                  ? "blank"
                  : r.correct === true
                    ? "right"
                    : r.correct === false
                      ? "wrong"
                      : "unscored";
              return (
                <li key={r.questionId} data-q={r.questionId} data-state={state} className={`${state}${r.correct === false ? " missed" : ""}`}>
                  <strong>Q{q?.number}</strong>
                  <span className="results-topic">{topic(q)}</span>
                  <span>
                    {r.recorded ? r.answer || "blank" : "not there"}
                    <span className="muted"> · correct {q?.correctAnswer || "—"}</span>
                  </span>
                  <span className="results-mark">
                    {state === "right" ? (
                      <Check aria-label="Correct" className="right-icon" />
                    ) : state === "wrong" || (state === "blank" && r.correct === false) ? (
                      <X aria-label="Incorrect" className="wrong-icon" />
                    ) : (
                      <Minus aria-label={state === "unscored" ? "Not scored" : "Blank"} />
                    )}
                  </span>
                  <span data-fact="time">
                    {clock(r.timeMs)}
                    <span className="muted"> (class {clock(q?.avgMs)})</span>
                  </span>
                </li>
              );
            })}
          </ol>
          {!picked.rows.length && <p>No questions recorded for this student.</p>}
        </section>
      )}
      {tab === "questions" && (
        <ol id="results-questions" className="results-questions" role="tabpanel">
          {questions.map((q) => {
            const total = q.distribution.reduce((n, g) => n + g.count, 0);
            return (
              <li key={q.questionId} data-q={q.questionId}>
                <header>
                  <strong>Q{q.number}</strong>
                  <span className="results-topic">{topic(q)}</span>
                  {!q.shown && <span className="muted">not shown</span>}
                </header>
                <p className="results-qfacts">
                  <span data-fact="correct">
                    {q.scorable ? `${percent(q.right, q.responses)} correct` : "not scored"}
                  </span>
                  <span>avg student {clock(q.avgMs)}</span>
                  <span data-fact="explain">
                    {q.explainMs == null ? "Explained —" : `You explained ${clock(q.explainMs)}`}
                  </span>
                </p>
                {total > 0 && (
                  <div className="results-dist" aria-label="Answer distribution">
                    {q.distribution
                      .filter((g) => g.count)
                      .map((g) => (
                        <span
                          key={g.label}
                          className={g.correct ? "correct" : g.label === "blank" ? "blank" : ""}
                          style={{ flexGrow: g.count }}
                          title={`${g.label}: ${g.count}`}
                        >
                          {g.label} {g.count}
                        </span>
                      ))}
                  </div>
                )}
              </li>
            );
          })}
        </ol>
      )}
    </>
  );
}
