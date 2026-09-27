import { useEffect, useState } from "react";
import { ArrowDown, ArrowLeft, ArrowUp, Search } from "lucide-react";
import { cbSort, DOM_ORDER } from "/shared/stats.js";
import { fmt, pct, time, type BankQuestion } from "./helpers";
import { Badge, Empty, Pagination, Pending, Preview, useResource } from "./ui";

type Student = {
  id: string;
  name: string;
  email: string;
  done: number;
  accuracy: number | null;
  weakest: string | null;
  avgMs: number | null;
  targetMs: number | null;
  guessRate: number | null;
  lastActive: string | null;
};
type Count = { a: number; c: number };
type Skill = Count & { avgMs: number | null; trend: number[] };
type Pace = { ms: number; n: number; target: number };
type Mistake = {
  question_id: string;
  question: BankQuestion;
  marker: string;
  picked: string;
  lessonSessionId: string | null;
};
type Lesson = {
  sessionId: number;
  paddedId: string;
  title: string;
  mode: string;
  status: string;
  date: string;
  score: { right: number; scorable: number };
  counted: boolean;
};
type Detail = {
  totalHistory: number;
  student: Student;
  directions: Record<string, number>;
  mistakes: Mistake[];
  lessons: Lesson[];
  stats: {
    tally: { att: number; corr: number; dom: Record<string, Count> };
    lastActive: string | null;
    diff: Record<string, Count>;
    skills: Record<string, Skill>;
    traps: [string, { count: number; examples: string[] }][];
    pacing: { rushed: number; onPace: number; slow: number };
    paceSection: Record<string, Pace>;
    paceDiff: Record<string, Pace>;
    guessing: {
      n: number;
      changedN: number;
      mean: number;
      changedAcc: number | null;
      steadyAcc: number | null;
    };
  };
};
const tabs = [
  "Overview",
  "By skill",
  "Mistakes",
  "Traps",
  "Pacing",
  "Second-guessing",
  "History",
  "Lessons",
];
const columns = [
  ["name", "Name"],
  ["done", "Questions done"],
  ["accuracy", "Overall current accuracy"],
  ["weakest", "Weakest skill"],
  ["avgMs", "Avg pace vs target"],
  ["guessRate", "Second-guess rate"],
  ["lastActive", "Last active"],
];

export function Students() {
  const [id, setId] = useState<string>();
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState("name");
  const [asc, setAsc] = useState(true);
  useEffect(() => {
    const timer = setTimeout(() => {
      setQuery(search);
      setPage(1);
    }, 400);
    return () => clearTimeout(timer);
  }, [search]);
  const { data, error, retry } = useResource<{
    students: Student[];
    total: number;
    page: number;
    pages: number;
  }>(
    `/api/admin/students?page=${page}&search=${encodeURIComponent(query)}&sort=${sort}&order=${asc ? "asc" : "desc"}`,
  );
  if (id) return <StudentDetail id={id} back={() => setId(undefined)} />;
  return (
    <>
      <p id="message" role="status">
        {data
          ? `${data.total} club member${data.total === 1 ? "" : "s"} (approved and pending)`
          : "Loading students…"}
      </p>
      <section className="panel">
        <label className="student-search">
          Search name or email
          <div>
            <Search />
            <input
              id="search"
              value={search}
              placeholder="Find a student…"
              autoComplete="off"
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
        </label>
        {!data ? (
          <Pending error={error} retry={retry} />
        ) : (
          <>
            <div className="table-scroll">
              <table>
                <thead>
                  <tr>
                    {columns.map(([key, label]) => (
                      <th
                        key={key}
                        aria-sort={
                          sort === key
                            ? asc
                              ? "ascending"
                              : "descending"
                            : "none"
                        }
                      >
                        <button
                          data-sort={key}
                          onClick={() => {
                            setAsc(sort === key ? !asc : true);
                            setSort(key);
                            setPage(1);
                          }}
                        >
                          {label}
                          {sort === key && (asc ? <ArrowUp /> : <ArrowDown />)}
                        </button>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {data.students.map((s) => (
                    <tr key={s.id}>
                      <td>
                        <button
                          data-id={s.id}
                          className="student-name"
                          onClick={() => setId(s.id)}
                        >
                          <span className="avatar">
                            {(s.name || s.email || s.id).slice(0, 1)}
                          </span>
                          <span>
                            {s.name || s.email || s.id}
                            <small>{s.email}</small>
                          </span>
                        </button>
                      </td>
                      <td>{s.done}</td>
                      <td>
                        <Badge tone={s.accuracy == null ? "" : "blue"}>
                          {fmt(s.accuracy)}
                        </Badge>
                      </td>
                      <td>{s.weakest || "Unavailable"}</td>
                      <td>
                        {s.avgMs == null
                          ? "Unavailable"
                          : `${time(s.avgMs)} vs ${time(s.targetMs)}`}
                      </td>
                      <td>
                        {fmt(
                          s.guessRate == null
                            ? null
                            : Math.round(s.guessRate * 100),
                        )}
                      </td>
                      <td>{s.lastActive || "Unavailable"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {!data.students.length && <Empty>No students found.</Empty>}
            <Pagination page={data.page} pages={data.pages} onPage={setPage} />
          </>
        )}
      </section>
    </>
  );
}
function Metric({
  label,
  value,
  n,
}: {
  label: string;
  value: string;
  n: number | null;
}) {
  return (
    <div className="metric">
      <span>{label}</span>
      <div className="bar">
        <i
          style={{ width: `${n == null ? 0 : Math.max(0, Math.min(n, 100))}%` }}
        />
      </div>
      <strong>{value}</strong>
    </div>
  );
}
function StudentDetail({ id, back }: { id: string; back: () => void }) {
  const { data, error, retry } = useResource<Detail>(
    `/api/admin/students/${encodeURIComponent(id)}`,
  );
  const [tab, setTab] = useState("Overview");
  if (!data) return <Pending error={error} retry={retry} />;
  const { student, stats } = data,
    t = stats.tally;
  return (
    <>
      <button id="back" className="back" onClick={back}>
        <ArrowLeft />
        Students
      </button>
      <div className="student-header">
        <span className="avatar large">
          {(student.name || student.email || student.id).slice(0, 1)}
        </span>
        <div>
          <h2>{student.name || student.email || student.id}</h2>
          <p id="message">
            {student.email} · {t.att} questions done ·{" "}
            {fmt(t.att ? Math.round((100 * t.corr) / t.att) : null)} current
            accuracy · Last active: {stats.lastActive || "Unavailable"}
          </p>
        </div>
      </div>
      <div className="tabs" role="tablist" aria-label="Student details">
        {tabs.map((x) => (
          <button
            id={`tab-${x.replaceAll(" ", "-")}`}
            role="tab"
            key={x}
            data-tab={x}
            aria-selected={tab === x}
            aria-controls="tab-content"
            tabIndex={tab === x ? 0 : -1}
            onKeyDown={(e) => {
              if (["ArrowLeft", "ArrowRight"].includes(e.key)) {
                e.preventDefault();
                const next =
                  tabs[
                    (tabs.indexOf(x) +
                      (e.key === "ArrowRight" ? 1 : tabs.length - 1)) %
                      tabs.length
                  ];
                setTab(next);
                document
                  .getElementById(`tab-${next.replaceAll(" ", "-")}`)
                  ?.focus();
              }
            }}
            onClick={() => setTab(x)}
          >
            {x}
          </button>
        ))}
      </div>
      <section
        className="panel student-tab"
        id="tab-content"
        role="tabpanel"
        aria-labelledby={`tab-${tab.replaceAll(" ", "-")}`}
      >
        {!t.att && !data.totalHistory ? (
          <Empty>No practice attempts yet</Empty>
        ) : (
          <Tab key={tab} tab={tab} detail={data} />
        )}
      </section>
    </>
  );
}
function Tab({ tab, detail }: { tab: string; detail: Detail }) {
  const { stats, directions } = detail;
  if (tab === "Overview")
    return (
      <>
        <h2>Current accuracy by domain</h2>
        <div className="domain-grid">
          {["Reading & Writing", "Math"].map((sec) => (
            <section key={sec}>
              <h3>{sec}</h3>
              {DOM_ORDER.filter((d) =>
                sec === "Math"
                  ? DOM_ORDER.indexOf(d) >= 4
                  : DOM_ORDER.indexOf(d) < 4,
              ).map((d) => (
                <Metric
                  key={d}
                  label={d}
                  value={`${fmt(pct(stats.tally.dom[d]))} · ${stats.tally.dom[d]?.a || 0} attempted`}
                  n={pct(stats.tally.dom[d])}
                />
              ))}
            </section>
          ))}
        </div>
        <h2>Historical attempt accuracy by difficulty</h2>
        {["Easy", "Medium", "Hard"].map((d) => (
          <Metric
            key={d}
            label={d}
            value={`${fmt(pct(stats.diff[d]))} · ${stats.diff[d]?.a || 0} attempts`}
            n={pct(stats.diff[d])}
          />
        ))}
        <h2>Weak spots</h2>
        {Object.entries(stats.skills)
          .filter(([, v]) => v.a)
          .sort((a, b) => a[1].c / a[1].a - b[1].c / b[1].a)
          .slice(0, 5)
          .map(([k, v]) => (
            <Metric key={k} label={k} value={fmt(pct(v))} n={pct(v)} />
          ))}
      </>
    );
  if (tab === "By skill")
    return (
      <>
        <h2>Skills · current accuracy; historical timed-attempt mean</h2>
        {(cbSort(Object.keys(stats.skills)) as string[])
          .sort(
            (a, b) =>
              (pct(stats.skills[a]) ?? Infinity) -
              (pct(stats.skills[b]) ?? Infinity),
          )
          .map((k) => {
            const v = stats.skills[k];
            return (
              <div key={k}>
                <Metric
                  label={k}
                  value={`${v.a} attempted · ${fmt(pct(v))} · ${time(v.avgMs)}`}
                  n={pct(v)}
                />
                <div className="skill-trend" aria-label={`${k} trend`}>
                  {v.trend.length ? (
                    <svg
                      width="100"
                      height="26"
                      viewBox="0 0 100 26"
                      role="img"
                      aria-label={`Trend: ${v.trend.map((x) => (x ? "correct" : "missed")).join(", ")}`}
                    >
                      <polyline
                        fill="none"
                        stroke="var(--accent)"
                        strokeWidth="2"
                        points={v.trend
                          .map(
                            (x, i) =>
                              `${v.trend.length === 1 ? 50 : Math.round((i * 96) / (v.trend.length - 1)) + 2},${x ? 4 : 22}`,
                          )
                          .join(" ")}
                      />
                    </svg>
                  ) : (
                    "Unavailable"
                  )}
                </div>
              </div>
            );
          })}
      </>
    );
  if (tab === "Mistakes") return <Mistakes mistakes={detail.mistakes} />;
  if (tab === "Traps")
    return (
      <>
        <h2>Tagged distractor misses</h2>
        <p className="muted">
          Counts cover tagged wrong picks only; untagged/blank attempts
          excluded.
        </p>
        {stats.traps.map(([tag, v]) => (
          <div className="trap-card" key={tag}>
            <strong>{tag}</strong>: {v.count} · examples:{" "}
            {v.examples.join(", ")}
          </div>
        ))}
        {!stats.traps.length && (
          <Empty>
            Unavailable: no tagged distractor misses (official traps may be
            untagged).
          </Empty>
        )}
      </>
    );
  if (tab === "Pacing") {
    const p = stats.pacing,
      n = p.rushed + p.onPace + p.slow;
    return (
      <>
        <h2>Timed attempts only · {n} with time</h2>
        {(["rushed", "onPace", "slow"] as const).map((k) => (
          <Metric
            key={k}
            label={k}
            value={`${p[k]} of ${n}`}
            n={n ? Math.round((p[k] / n) * 100) : null}
          />
        ))}
        {[
          ["Section", stats.paceSection],
          ["Difficulty", stats.paceDiff],
        ].map(([label, values]) => (
          <section key={String(label)}>
            <h3>{String(label)}</h3>
            {Object.entries(values as Record<string, Pace>).map(([k, v]) => (
              <Metric
                key={k}
                label={k}
                value={`${time(v.ms / v.n)} vs target ${time(v.target / v.n)} · ${v.n} timed`}
                n={null}
              />
            ))}
            {!Object.keys(values).length && <p>Unavailable</p>}
          </section>
        ))}
      </>
    );
  }
  if (tab === "Second-guessing") {
    const g = stats.guessing;
    return (
      <>
        <h2>Answer changes (known: {g.n})</h2>
        <p>
          {g.n
            ? `${g.changedN} changed (${Math.round((g.changedN / g.n) * 100)}%); mean ${g.mean.toFixed(2)} switches per attempt`
            : "Unavailable: no recorded changes."}
        </p>
        <div className="stat-card">
          Changed accuracy: {fmt(g.changedAcc)} · kept first: {fmt(g.steadyAcc)}
        </div>
        <h3>First vs final scored selection per attempt</h3>
        <p>
          Right-to-wrong: {directions["right-to-wrong"]} · Wrong-to-right:{" "}
          {directions["wrong-to-right"]} · Same correctness:{" "}
          {directions.unchanged} · Unknown (legacy, blank or unscorable):{" "}
          {directions.unknown}
        </p>
      </>
    );
  }
  if (tab === "History") return <History id={detail.student.id} />;
  return (
    <>
      <h2>Lessons</h2>
      {detail.lessons.length ? (
        <table id="student-lessons">
          <thead>
            <tr>
              <th>Session</th>
              <th>Title</th>
              <th>Mode</th>
              <th>Date</th>
              <th>Score</th>
              <th>Counts toward stats</th>
            </tr>
          </thead>
          <tbody>
            {detail.lessons.map((x) => (
              <tr key={x.sessionId}>
                <td>{x.paddedId}</td>
                <td>{x.title}</td>
                <td>
                  {x.mode === "self" ? "Self-paced" : "Instructor-paced"}
                  {x.status !== "ended" && ` · ${x.status}`}
                </td>
                <td>{x.date}</td>
                <td>
                  {x.score.scorable
                    ? `${x.score.right} / ${x.score.scorable} (${Math.round((100 * x.score.right) / x.score.scorable)}%)`
                    : "Unavailable"}
                </td>
                <td>{x.counted ? "Yes" : "No"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <Empty>No lessons attended yet.</Empty>
      )}
    </>
  );
}
function History({ id }: { id: string }) {
  const [page, setPage] = useState(1);
  const { data, error, retry } = useResource<{
    page: number;
    pages: number;
    total: number;
    results: {
      ts: string;
      question_id: string;
      correct: boolean;
      picked: string;
      time_taken_ms: number | null;
      lesson_session_id: number | null;
    }[];
  }>(`/api/admin/students/${encodeURIComponent(id)}/history?page=${page}`);
  if (!data) return <Pending error={error} retry={retry} />;
  return (
    <>
      <h2>Question attempt history · newest first</h2>
      {data.results.map((x, n) => (
        <p className="history-row" key={n}>
          {x.ts} · {x.question_id} ·{" "}
          <Badge tone={x.correct ? "green" : "red"}>
            {x.correct ? "Correct" : "Incorrect"}
          </Badge>{" "}
          · picked {x.picked || "blank"} · {time(x.time_taken_ms)}
          {x.lesson_session_id != null && (
            <>
              {" "}
              <Badge tone="blue">
                Lesson {String(x.lesson_session_id).padStart(5, "0")}
              </Badge>
            </>
          )}
        </p>
      ))}
      {!data.results.length && <Empty>No practice attempts yet</Empty>}
      <Pagination
        page={data.page}
        pages={data.pages}
        total={data.total}
        prev="h-prev"
        next="h-next"
        onPage={setPage}
      />
    </>
  );
}
function Mistakes({ mistakes }: { mistakes: Mistake[] }) {
  const [domain, setDomain] = useState(""),
    [skill, setSkill] = useState(""),
    [diff, setDiff] = useState("");
  const [preview, setPreview] = useState<Mistake>();
  const selected = mistakes.filter(
    (m) =>
      (!domain || m.question.domain === domain) &&
      (!skill || m.question.skill === skill) &&
      (!diff || m.question.difficulty === diff),
  );
  return (
    <>
      <h2>Mistakes · Red needs work, Orange corrected</h2>
      <div className="mistake-filters">
        {[
          [
            "Domain",
            "md-domain",
            domain,
            setDomain,
            cbSort([...new Set(mistakes.map((m) => m.question.domain))]),
          ],
          [
            "Skill",
            "md-skill",
            skill,
            setSkill,
            cbSort([...new Set(mistakes.map((m) => m.question.skill))]),
          ],
          ["Difficulty", "md-diff", diff, setDiff, ["Easy", "Medium", "Hard"]],
        ].map(([label, id, value, set, options]) => (
          <label key={String(id)}>
            {String(label)}
            <select
              id={String(id)}
              value={String(value)}
              onChange={(e) => (set as (s: string) => void)(e.target.value)}
            >
              <option value="">All</option>
              {(options as string[]).map((x) => (
                <option key={x}>{x}</option>
              ))}
            </select>
          </label>
        ))}
      </div>
      <div id="mistakes">
        {selected.map((m) => (
          <p className="mistake-row" key={m.question_id}>
            <button data-question={m.question_id} onClick={() => setPreview(m)}>
              {m.question_id}
            </button>
            <Badge tone={m.marker.toLowerCase() === "red" ? "red" : "orange"}>
              {m.marker}
            </Badge>{" "}
            · {m.question.skill} · {m.question.difficulty}
            {m.lessonSessionId && (
              <>
                {" "}
                <Badge tone="blue">Lesson {m.lessonSessionId}</Badge>
              </>
            )}
          </p>
        ))}
        {!selected.length && <p>No mistakes for these filters.</p>}
      </div>
      <div id="preview">
        {preview && (
          <section className="preview panel">
            <button id="close-preview" onClick={() => setPreview(undefined)}>
              Close preview
            </button>
            <h3>
              {preview.question.id} · {preview.question.section} ·{" "}
              {preview.question.difficulty}
            </h3>
            <Preview q={preview.question} picked={preview.picked} />
          </section>
        )}
      </div>
    </>
  );
}
