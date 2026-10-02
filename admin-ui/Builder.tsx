import { useEffect, useRef, useState, type MutableRefObject } from "react";
import {
  ArrowLeft,
  ArrowUp,
  ArrowDown,
  Check,
  ChevronDown,
  GripVertical,
  Pencil,
  Plus,
  X,
  Save,
  Play,
} from "lucide-react";
import { cbSort } from "/shared/stats.js";
import {
  api,
  defaultTime,
  formatTime,
  totalTime,
  type BankQuestion,
  type Lesson,
  type Item,
} from "./helpers";
import {
  Badge,
  Dialog,
  Empty,
  ErrorText,
  Pagination,
  Pending,
  useResource,
} from "./ui";
import { QuestionViewer } from "./QuestionViewer";
import { ItemViewer } from "./ItemViewer";
import { notesSnippet } from "./itemLabel.ts";

type Filters = {
  section: string;
  domains: string[];
  skills: string[];
  difficulties: string[];
  lessonUsage: string;
  search: string;
  page: number;
};
type Results = {
  questions: BankQuestion[];
  total: number;
  page: number;
  pages: number;
  skillsByDomain: Record<string, string[]>;
};
export type Guard = MutableRefObject<null | ((next: () => void) => void)>;
// Server page size for /api/admin/questions.
const PAGE = 25;
const initial: Filters = {
  section: "",
  domains: [],
  skills: [],
  difficulties: [],
  lessonUsage: "show-all",
  search: "",
  page: 1,
};
function Multi({
  title,
  values,
  selected,
  attr,
  change,
}: {
  title: string;
  values: string[];
  selected: string[];
  attr: string;
  change: (values: string[]) => void;
}) {
  return (
    <div className="multi">
      <details>
        <summary>
          {title}
          <Badge>{selected.length || "All"}</Badge>
          <ChevronDown />
        </summary>
        <div className="options">
          {values.map((v) => (
            <label key={v}>
              <input
                type="checkbox"
                {...{ [attr]: v }}
                checked={selected.includes(v)}
                onChange={(e) =>
                  change(
                    e.target.checked
                      ? [...selected, v]
                      : selected.filter((x) => x !== v),
                  )
                }
              />
              {v}
            </label>
          ))}
          {!values.length && <span>No options</span>}
        </div>
      </details>
      {selected.length > 0 && (
        <div className="chips">
          {selected.map((v) => (
            <button
              className="chip"
              key={v}
              aria-label={`Remove ${v} filter`}
              onClick={() => change(selected.filter((x) => x !== v))}
            >
              {v}
              <X />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
export function QuestionBrowser({
  items,
  add,
  remove,
  cache,
  openInLesson,
}: {
  items?: Item[];
  add?: (qs: BankQuestion[]) => void;
  remove?: (id: string) => void;
  cache?: (qs: BankQuestion[]) => void;
  openInLesson?: (id: string) => void;
}) {
  const [f, setF] = useState<Filters>(initial);
  const [search, setSearch] = useState("");
  // Viewer position in the current result page; stepping past either end loads the
  // neighbouring page and lands on its first/last question, so it follows the list order.
  const [view, setView] = useState<number | null>(null);
  const [shown, setShown] = useState<BankQuestion>();
  const landing = useRef<"first" | "last" | null>(null);
  const [taxonomy, setTaxonomy] = useState<Record<string, string[]>>({});
  const query = new URLSearchParams({
    section: f.section,
    lessonUsage: f.lessonUsage,
    search: f.search,
    page: String(f.page),
  });
  f.domains.forEach((x) => query.append("domain", x));
  f.skills.forEach((x) => query.append("skill", x));
  f.difficulties.forEach((x) => query.append("difficulty", x));
  const { data, error, retry } = useResource<Results>(
    `/api/admin/questions?${query}`,
  );
  useEffect(() => {
    const timer = setTimeout(
      () => setF((old) => ({ ...old, search, page: 1 })),
      350,
    );
    return () => clearTimeout(timer);
  }, [search]);
  useEffect(() => {
    if (data) {
      setTaxonomy(data.skillsByDomain);
      cache?.(data.questions);
      if (landing.current && data.questions.length)
        setView(landing.current === "first" ? 0 : data.questions.length - 1);
      landing.current = null;
    }
  }, [data]);
  const current = view == null ? undefined : data?.questions[view];
  useEffect(() => {
    if (current) setShown(current);
  }, [current]);
  const step = (delta: number) => {
    if (!data || view == null) return;
    const next = view + delta;
    if (next >= 0 && next < data.questions.length) setView(next);
    else if (next < 0 ? data.page > 1 : data.page < data.pages) {
      landing.current = next < 0 ? "last" : "first";
      setF((old) => ({ ...old, page: old.page + (next < 0 ? -1 : 1) }));
    }
  };
  const update = (part: Partial<Filters>) =>
    setF((old) => ({ ...old, ...part, page: 1 }));
  const domains: string[] = cbSort(Object.keys(taxonomy));
  const skills = cbSort([
    ...new Set(
      (f.domains.length ? f.domains : domains).flatMap(
        (d) => taxonomy[d] || [],
      ),
    ),
  ]);
  return (
    <>
      <section id="filters" className="filter-bar panel">
        <label>
          Section
          <select
            id="f-section"
            value={f.section}
            onChange={(e) =>
              update({ section: e.target.value, domains: [], skills: [] })
            }
          >
            <option value="">All sections</option>
            <option>Reading & Writing</option>
            <option>Math</option>
          </select>
        </label>
        <Multi
          title="Domain"
          values={domains}
          selected={f.domains}
          attr="data-domain"
          change={(domains) => update({ domains, skills: [] })}
        />
        <Multi
          title="Skill"
          values={skills}
          selected={f.skills}
          attr="data-skill"
          change={(skills) => update({ skills })}
        />
        <Multi
          title="Difficulty"
          values={["Easy", "Medium", "Hard"]}
          selected={f.difficulties}
          attr="data-diff"
          change={(difficulties) => update({ difficulties })}
        />
        <label>
          Lesson questions
          <select
            id="f-usage"
            value={f.lessonUsage}
            onChange={(e) => update({ lessonUsage: e.target.value })}
          >
            <option value="show-all">Show all</option>
            <option value="hide-attended">Hide questions from lessons I ran</option>
            <option value="hide-all">Hide all lesson questions</option>
          </select>
        </label>
        <label className="search-field">
          Search ID, skill or stem
          <input
            id="f-search"
            value={search}
            maxLength={100}
            placeholder="Find a question…"
            onChange={(e) => setSearch(e.target.value)}
          />
        </label>
      </section>
      <section className="panel question-results">
        <div className="section-head">
          <h2>Question bank</h2>
          <span>{data ? `${data.total} results` : "Loading…"}</span>
        </div>
        <div id="results">
          {!data ? (
            <Pending error={error} retry={retry} />
          ) : (
            <>
              {data.questions.map((q) => {
                const added = items?.some((i) => i.question_id === q.id);
                const stem =
                  new DOMParser().parseFromString(q.stem_html, "text/html").body
                    .textContent || "";
                return (
                  <div key={q.id} className="result-row">
                    {add && (
                      <button
                        data-add={q.id}
                        aria-label={added ? `Added ${q.id}` : `Add ${q.id}`}
                        disabled={added}
                        onClick={() => add([q])}
                      >
                        {added ? <Check /> : <Plus />}
                      </button>
                    )}
                    <button
                      className="result-preview"
                      data-preview={q.id}
                      onClick={() => setView(data.questions.indexOf(q))}
                    >
                      <span>
                        <strong>{q.id}</strong>
                        <Badge tone={q.difficulty.toLowerCase()}>
                          {q.difficulty}
                        </Badge>
                      </span>
                      <span className="stem-line">{stem}</span>
                      <small>{q.skill}</small>
                    </button>
                    {q.usedInLesson.map((id) => (
                      <small key={id} className="usage-badge">
                        {id}
                      </small>
                    ))}
                  </div>
                );
              })}
              {!data.questions.length && <Empty>No results.</Empty>}
              {add && (
                <button id="add-page" onClick={() => add(data.questions)}>
                  <Plus />
                  Add all on page
                </button>
              )}
              <Pagination
                page={data.page}
                pages={data.pages}
                prev="result-prev"
                next="result-next"
                onPage={(page) => setF((old) => ({ ...old, page }))}
              />
            </>
          )}
        </div>
        <p id="add-error" role="alert" />
      </section>
      {view != null && (current || shown) && (
        <QuestionViewer
          q={(current || shown)!}
          loading={!current}
          position={data ? (data.page - 1) * PAGE + view + 1 : 0}
          total={data?.total || 0}
          hasPrev={!!data && (view > 0 || data.page > 1)}
          hasNext={
            !!data && (view < data.questions.length - 1 || data.page < data.pages)
          }
          onPrev={() => step(-1)}
          onNext={() => step(1)}
          close={() => {
            setView(null);
            setShown(undefined);
          }}
          added={!!current && !!items?.some((i) => i.question_id === current.id)}
          onAdd={add ? () => current && add([current]) : undefined}
          onRemove={remove ? () => current && remove(current.id) : undefined}
          onOpenInLesson={
            openInLesson
              ? () => {
                  if (!current) return;
                  const id = current.id;
                  setView(null);
                  setShown(undefined);
                  openInLesson(id);
                }
              : undefined
          }
        />
      )}
    </>
  );
}

export function Builder({
  id,
  start,
  guard,
  navigate,
}: {
  id?: string;
  start?: boolean;
  guard: Guard;
  navigate: (path: string) => void;
}) {
  const [lesson, setLesson] = useState<Lesson>();
  const [loadError, setLoadError] = useState("");
  const [version, setVersion] = useState(0);
  const [status, setStatus] = useState("Saved");
  const [error, setError] = useState("");
  const [editor, setEditor] = useState(-1);
  const [questions, setQuestions] = useState<Record<string, BankQuestion>>({});
  const [exit, setExit] = useState<{ next: () => void }>();
  const [join, setJoin] = useState<{
    sessionId: number;
    paddedId: string;
    joinCode: string;
  }>();
  const current = useRef<Lesson | undefined>(undefined),
    revision = useRef(0),
    saved = useRef(0),
    timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined),
    chain = useRef(Promise.resolve()),
    alive = useRef(true),
    asked = useRef(new Set<string>());
  const save = async () => {
    clearTimeout(timer.current);
    const value = current.current!;
    const rev = revision.current;
    const data = {
      title: value.title,
      mode: value.mode,
      items: value.items.map((i) => ({ ...i })),
    };
    if (!data.title.trim()) {
      setStatus("Error: title required");
      throw Error("Title required");
    }
    const work = chain.current.then(async () => {
      if (rev <= saved.current && value.id) return;
      if (alive.current) setStatus("Saving");
      try {
        const result = await api<Lesson>(
          value.id ? `/api/admin/lessons/${value.id}` : "/api/admin/lessons",
          value.id ? "PUT" : "POST",
          data,
        );
        value.id = result.id;
        if (current.current) current.current.id = result.id;
        saved.current = rev;
        if (alive.current) {
          setLesson({ ...current.current! });
          setStatus(revision.current === rev ? "Saved" : "Unsaved");
          history.replaceState(null, "", `/admin/lessons/${result.id}/edit`);
        }
      } catch (e) {
        if (alive.current) setStatus("Error: " + (e as Error).message);
        throw e;
      }
    });
    chain.current = work.catch(() => {});
    return work;
  };
  const saveLatest = async () => {
    do {
      await save();
    } while (revision.current > saved.current);
  };
  const startSession = async () => {
    try {
      await saveLatest();
      const s = await api<{
        sessionId: number;
        paddedId: string;
        joinCode: string;
      }>(`/api/admin/lessons/${current.current!.id}/sessions`, "POST");
      if (alive.current) {
        setJoin(s);
        setError("");
      }
    } catch (e) {
      if (alive.current) setError((e as Error).message);
    }
  };
  useEffect(() => {
    alive.current = true;
    let cancelled = false;
    (id
      ? api<Lesson>(`/api/admin/lessons/${id}`)
      : Promise.resolve<Lesson>({ title: "", mode: "instructor", items: [] })
    )
      .then((l) => {
        if (cancelled) return;
        current.current = l;
        setLesson(l);
        if (start) void startSession();
      })
      .catch((e) => {
        if (!cancelled) setLoadError(e.message);
      });
    return () => {
      cancelled = true;
      alive.current = false;
      clearTimeout(timer.current);
      guard.current = null;
    };
  }, [id, version]);
  const update = (part: Partial<Lesson>) => {
    const value = { ...current.current!, ...part };
    current.current = value;
    setLesson(value);
    revision.current++;
    setStatus("Unsaved");
    setError("");
    clearTimeout(timer.current);
    if (value.title.trim())
      timer.current = setTimeout(() => save().catch(() => {}), 600);
  };
  useEffect(() => {
    guard.current = (next) => {
      if (revision.current > saved.current) {
        clearTimeout(timer.current);
        setExit({ next });
      } else next();
    };
    const unload = (e: BeforeUnloadEvent) => {
      if (revision.current > saved.current) {
        e.preventDefault();
        e.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", unload);
    return () => window.removeEventListener("beforeunload", unload);
  });
  // Row labels and the item viewer need each item's question; fetch the ones the browser hasn't cached.
  const wanted = lesson?.items.map((i) => i.question_id).join("\n") || "";
  useEffect(() => {
    let cancelled = false;
    for (const id of wanted.split("\n").filter(Boolean)) {
      if (questions[id] || asked.current.has(id)) continue;
      asked.current.add(id);
      api<Results>(`/api/admin/questions?search=${encodeURIComponent(id)}`)
        .then((d) => {
          const q = d.questions.find((q) => q.id === id);
          if (q && !cancelled) setQuestions((old) => ({ ...old, [q.id]: q }));
          else asked.current.delete(id);
        })
        .catch((e) => {
          asked.current.delete(id);
          if (!cancelled) setError(e.message);
        });
    }
    return () => {
      cancelled = true;
    };
  }, [wanted]);
  if (!lesson)
    return (
      <Pending
        error={loadError}
        retry={() => {
          setLoadError("");
          setVersion((n) => n + 1);
        }}
      />
    );
  const items = lesson.items;
  const editItem = (part: Partial<Item>) =>
    update({
      items: items.map((i, n) => (n === editor ? { ...i, ...part } : i)),
    });
  const move = (a: number, b: number) => {
    if (a === b || a < 0 || a >= items.length || b < 0 || b >= items.length)
      return;
    const next = [...items];
    next.splice(b, 0, ...next.splice(a, 1));
    const editing = items[editor]?.question_id;
    setEditor(next.findIndex((i) => i.question_id === editing));
    update({ items: next });
  };
  return (
    <>
      <button
        id="library-back"
        className="back"
        onClick={() => navigate("/admin/lessons")}
      >
        <ArrowLeft />
        Library
      </button>
      <div className="builder">
        <QuestionBrowser
          items={items}
          openInLesson={(id) =>
            setEditor(items.findIndex((i) => i.question_id === id))
          }
          remove={(id) => {
            setEditor(-1);
            update({ items: items.filter((i) => i.question_id !== id) });
          }}
          cache={(qs) =>
            setQuestions((old) => ({
              ...old,
              ...Object.fromEntries(qs.map((q) => [q.id, q])),
            }))
          }
          add={(qs) => {
            const existing = new Set(
              current.current!.items.map((i) => i.question_id),
            );
            const added = qs
              .filter((q) => !existing.has(q.id))
              .map((q) => ({
                question_id: q.id,
                time_limit_sec: defaultTime(q),
                notes: "",
              }));
            if (added.length)
              update({ items: [...current.current!.items, ...added] });
          }}
        />
        <section className="panel lesson-editor">
          <div className="section-head">
            <h2>Your lesson</h2>
            <span id="save-status" role="status">
              {status}
            </span>
          </div>
          <label>
            Title
            <input
              id="lesson-title"
              maxLength={200}
              value={lesson.title}
              placeholder="Give your lesson a title"
              onChange={(e) => update({ title: e.target.value })}
            />
          </label>
          <fieldset className="mode">
            <legend>Mode</legend>
            {[
              ["instructor", "Instructor"],
              ["self", "Self-paced"],
            ].map(([value, label]) => (
              <label key={value}>
                <input
                  type="radio"
                  name="mode"
                  value={value}
                  checked={lesson.mode === value}
                  onChange={() => update({ mode: value })}
                />
                {label}
              </label>
            ))}
          </fieldset>
          <div className="section-head">
            <span>{items.length} questions</span>
            <span>
              Total time:{" "}
              <strong id="total-time">{formatTime(totalTime(items))}</strong>
            </span>
          </div>
          {!items.length && <Empty>Add questions to build your lesson.</Empty>}
          <ol id="lesson-items">
            {items.map((i, n) => (
              <li
                key={i.question_id}
                draggable
                data-index={n}
                onDragStart={(e) =>
                  e.dataTransfer.setData("text/plain", String(n))
                }
                onDragOver={(e) => e.preventDefault()}
                onDrop={(e) => {
                  e.preventDefault();
                  const a = Number(e.dataTransfer.getData("text/plain"));
                  if (Number.isInteger(a)) move(a, n);
                }}
              >
                <GripVertical className="drag-handle" />
                <span
                  className="item-title"
                  title={i.question_id}
                  onClick={() => setEditor(n)}
                >
                  <span className="item-top">
                    <strong>
                      {n + 1}. {questions[i.question_id]?.skill || "…"}
                    </strong>
                    {questions[i.question_id] && (
                      <Badge
                        tone={questions[i.question_id].difficulty.toLowerCase()}
                      >
                        {questions[i.question_id].difficulty}
                      </Badge>
                    )}
                    <small>{formatTime(i.time_limit_sec)}</small>
                  </span>
                  <small className="item-notes">{notesSnippet(i.notes)}</small>
                </span>
                <button
                  data-up={n}
                  aria-label={`Move ${i.question_id} up`}
                  disabled={n === 0}
                  onClick={() => move(n, n - 1)}
                >
                  <ArrowUp />
                </button>
                <button
                  data-down={n}
                  aria-label={`Move ${i.question_id} down`}
                  disabled={n === items.length - 1}
                  onClick={() => move(n, n + 1)}
                >
                  <ArrowDown />
                </button>
                <button
                  data-edit-item={n}
                  aria-label={`Edit ${i.question_id}`}
                  onClick={() => setEditor(n)}
                >
                  <Pencil />
                </button>
                <button
                  data-remove={n}
                  aria-label={`Remove ${i.question_id}`}
                  onClick={() => {
                    setEditor(-1);
                    update({ items: items.filter((_, index) => index !== n) });
                  }}
                >
                  <X />
                </button>
              </li>
            ))}
          </ol>
          <ErrorText>{error}</ErrorText>
          <div className="editor-actions">
            <button
              id="save-lesson"
              onClick={() => saveLatest().catch((e) => setError(e.message))}
            >
              <Save />
              Save
            </button>
            <button id="save-start" className="primary" onClick={startSession}>
              <Play />
              Save & start session
            </button>
            {status.startsWith("Error") && (
              <button
                id="retry-save"
                onClick={() => saveLatest().catch((e) => setError(e.message))}
              >
                Retry
              </button>
            )}
          </div>
          <div id="join-result" role="status">
            {join && (
              <div className="join-result">
                <p>Session {join.paddedId}</p>
                <strong className="join-code">{join.joinCode}</strong>
                <p>
                  Join URL:{" "}
                  <span>
                    {location.origin}/app?join={join.joinCode}
                  </span>
                </p>
                <a
                  className="button primary"
                  href={`/admin/live/${join.sessionId}`}
                >
                  Open live room
                </a>
              </div>
            )}
          </div>
        </section>
      </div>
      {editor >= 0 && items[editor] && (
        <ItemViewer
          items={items}
          index={editor}
          questions={questions}
          setIndex={setEditor}
          edit={editItem}
          remove={() => {
            // Stay in the lesson: land on the item that slides into this slot.
            const next = Math.min(editor, items.length - 2);
            update({ items: items.filter((_, n) => n !== editor) });
            setEditor(next);
          }}
          close={() => setEditor(-1)}
        />
      )}
      {exit && (
        <Dialog
          title="Save changes before leaving?"
          close={() => setExit(undefined)}
        >
          <p>Your latest changes haven’t been saved.</p>
          <ErrorText>{error}</ErrorText>
          <div className="actions">
            <button onClick={() => setExit(undefined)}>Cancel</button>
            <button
              onClick={async () => {
                clearTimeout(timer.current);
                await chain.current;
                exit.next();
              }}
            >
              Discard
            </button>
            <button
              className="primary"
              onClick={async () => {
                try {
                  await saveLatest();
                  exit.next();
                } catch (e) {
                  setError((e as Error).message);
                }
              }}
            >
              Save
            </button>
          </div>
        </Dialog>
      )}
    </>
  );
}
