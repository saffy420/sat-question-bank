import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  Check,
  X,
  PenLine,
  Highlighter,
  Strikethrough,
  Eraser,
  Trash2,
  Focus,
  Play,
  Plus,
  Square,
  SkipForward,
  Users,
  Wifi,
  WifiOff,
  Clock,
  LockKeyhole,
  Calculator,
  ChevronLeft,
  ChevronRight,
  NotebookText,
} from "lucide-react";
import { Stage } from "../lesson-ui/Stage";
import { DesmosLeader } from "../lesson-ui/Desmos";
import { SelfGrid, type SelfRoom } from "./SelfLive";
import { Overview, PollPanel, ResultPanel } from "./Review";
import type { Snapshot, Mark } from "../lesson-ui/types";
import * as Ink from "/shared/annotations.js";
import { isRight } from "/shared/stats.js";
import {
  api,
  formatTime,
  mathify,
  notesHTML,
  time,
  type LessonCard,
  type Session,
} from "./helpers";
import { Badge, Dialog, Empty, HTML, Pending } from "./ui";

type Response = { answer?: string; locked?: boolean };
type Group = {
  label: string;
  count: number;
  correct: boolean;
  users: { name: string; ms: number | null }[];
};
type Room = Omit<Snapshot, "distribution"> & {
  sessionId: number;
  code: string;
  lockedJoin: boolean;
  roster: Record<string, string>;
  responses: Record<string, Record<string, Response>>;
  notes: string;
  distribution?: Group[];
  // B3 navigator (instructor-paced): see src/lesson-room.js move().
  outline?: { questionId: string; snippet: string }[];
  reached?: number;
  played?: number;
};
type Send = (type: string, fields?: Record<string, unknown>) => void;
const tools = {
  pen: PenLine,
  highlight: Highlighter,
  strike: Strikethrough,
  erase: Eraser,
  clear: Trash2,
  laser: Focus,
};
const labels = {
  pen: "Pen",
  highlight: "Highlight",
  strike: "Strikethrough",
  erase: "Erase",
  clear: "Clear all",
  laser: "Laser",
};
const colors = ["#ffe066", "#ff7676", "#75dbaa"];

export function LiveRooms() {
  const [rooms, setRooms] = useState<Session[]>();
  const [error, setError] = useState("");
  const [version, setVersion] = useState(0);
  useEffect(() => {
    let alive = true;
    api<LessonCard[]>("/api/admin/lessons?includeArchived=1")
      .then((ls) =>
        Promise.all(
          ls.map((l) => api<Session[]>(`/api/admin/lessons/${l.id}/sessions`)),
        ),
      )
      .then((rows) => {
        if (alive) setRooms(rows.flat().filter((s) => s.status !== "ended"));
      })
      .catch((e) => {
        if (alive) setError(e.message);
      });
    return () => {
      alive = false;
    };
  }, [version]);
  if (!rooms)
    return (
      <Pending
        error={error}
        retry={() => {
          setError("");
          setVersion((n) => n + 1);
        }}
      />
    );
  return (
    <>
      <p className="lede">Pick up where your class left off.</p>
      <div className="library">
        {rooms.map((s) => (
          <article className="panel" key={s.id}>
            <Badge tone="green">{s.status}</Badge>
            <h2>Session {s.paddedId}</h2>
            <p>Join code {s.join_code}</p>
            <a className="button primary" href={`/admin/live/${s.id}`}>
              Open live room
              <Play />
            </a>
          </article>
        ))}
      </div>
      {!rooms.length && <Empty>No open rooms.</Empty>}
    </>
  );
}

export function Live({
  id,
  collapseSidebar,
}: {
  id: string;
  collapseSidebar?: () => void;
}) {
  const [s, setState] = useState<Room>();
  const [error, setError] = useState("");
  const [version, setVersion] = useState(0);
  const [connected, setConnected] = useState(false);
  const [now, setNow] = useState(Date.now());
  const socket = useRef<WebSocket | null>(null);
  const offset = useRef(0);
  const [sort, setSort] = useState("name");
  const [group, setGroup] = useState<number | null>(null);
  // Presenter overlays: the Responses popup, the notes drawer and the question navigator drawer.
  const [popup, setPopup] = useState(false);
  const [notes, setNotes] = useState(false);
  const [drawer, setDrawer] = useState(false);
  const layers = useRef({ group, popup, drawer });
  layers.current = { group, popup, drawer };
  const popupAnchor = useRef<HTMLDivElement>(null);
  const drawerRef = useRef<HTMLElement>(null);
  const navButton = useRef<HTMLButtonElement>(null);
  const collapsed = useRef(false);
  // The presenter's own cross-outs: local only, never sent or shown to students.
  const [strikeMode, setStrikeMode] = useState(false);
  const [struck, setStruck] = useState<Record<string, string[]>>({});
  const send: Send = (type, fields = {}) => {
    if (socket.current?.readyState === WebSocket.OPEN)
      socket.current.send(JSON.stringify({ type, ...fields }));
  };
  useEffect(() => {
    let alive = true,
      best = Infinity,
      retry: ReturnType<typeof setTimeout>;
    offset.current = 0;
    setState(undefined);
    setError("");
    const connect = () => {
      if (!alive) return;
      const ws = new WebSocket(
        `${location.protocol === "https:" ? "wss:" : "ws:"}//${location.host}/api/lessons/${id}/ws`,
      );
      socket.current = ws;
      ws.onopen = () => {
        if (alive) {
          setConnected(true);
          send("ping", { sentAt: Date.now() });
        }
      };
      ws.onmessage = (e) => {
        if (!alive) return;
        const m = JSON.parse(e.data);
        if (m.type === "pong") {
          const rtt = Date.now() - m.sentAt;
          if (rtt >= 0 && rtt < best) {
            best = rtt;
            offset.current = m.serverNow - m.sentAt - rtt / 2;
          }
        } else if (m.type === "snapshot") {
          // Throttled refreshes leave question bodies (self-paced) and the navigator outline
          // (instructor-paced) out; keep the ones we have.
          setState((old) =>
            old?.sessionId !== m.sessionId
              ? m
              : m.mode === "self" && !m.questions
                ? { ...m, questions: old!.questions }
                : m.mode !== "self" && !m.outline
                  ? { ...m, outline: old!.outline }
                  : m,
          );
          setError("");
        } else if (m.type === "annotate")
          setState((old) =>
            !old || old.questionId !== m.questionId
              ? old
              : {
                  ...old,
                  annotations:
                    m.op.type === "clear"
                      ? []
                      : m.op.type === "erase"
                        ? old.annotations?.filter((x) => x.id !== m.op.id)
                        : [...(old.annotations || []), m.op],
                },
          );
        else if (m.type === "error") {
          setError(m.error);
          api<Room>(`/api/lessons/${id}`)
            .then((room) => {
              if (alive) setState(room);
            })
            .catch(() => {});
        }
      };
      ws.onclose = (e) => {
        if (!alive) return;
        setConnected(false);
        if (e.code === 4001) {
          setError("Opened in another tab. Reload to reconnect.");
          return;
        }
        retry = setTimeout(connect, 1500);
      };
    };
    api<Room>(`/api/lessons/${id}`)
      .then((room) => {
        if (alive) {
          setState(room);
          connect();
        }
      })
      .catch((e) => {
        if (alive) setError(e.message);
      });
    const clock = setInterval(() => {
      setNow(Date.now());
      send("ping", { sentAt: Date.now() });
    }, 1000);
    return () => {
      alive = false;
      clearTimeout(retry);
      clearInterval(clock);
      socket.current?.close(1000);
      socket.current = null;
    };
  }, [id, version]);
  useEffect(() => {
    setGroup(null);
  }, [s?.questionId]);
  // Esc closes the innermost layer: the names popover first, then the popup and drawers.
  useEffect(() => {
    const esc = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      if (layers.current.group !== null) setGroup(null);
      else {
        setPopup(false);
        setDrawer(false);
        setNotes(false);
      }
    };
    window.addEventListener("keydown", esc);
    return () => window.removeEventListener("keydown", esc);
  }, []);
  // A click outside closes the Responses popup and the navigator drawer.
  useEffect(() => {
    if (!popup && !drawer) return;
    const down = (e: PointerEvent) => {
      const target = e.target as Node;
      if (layers.current.popup && !popupAnchor.current?.contains(target))
        setPopup(false);
      if (
        layers.current.drawer &&
        !drawerRef.current?.contains(target) &&
        !navButton.current?.contains(target)
      )
        setDrawer(false);
    };
    document.addEventListener("pointerdown", down);
    return () => document.removeEventListener("pointerdown", down);
  }, [popup, drawer]);
  // Once the session has started the app sidebar collapses; the instructor can expand it again.
  useEffect(() => {
    if (s && s.status !== "lobby" && !collapsed.current) {
      collapsed.current = true;
      collapseSidebar?.();
    }
  }, [s?.status]);
  if (!s)
    return <Pending error={error} retry={() => setVersion((n) => n + 1)} />;
  const toggle = (
    field: "lockedJoin" | "classResults",
    action: string,
    bool: boolean,
  ) => {
    if (socket.current?.readyState !== WebSocket.OPEN) return;
    setState((old) => (old ? { ...old, [field]: bool } : old));
    send(action, { bool });
  };
  const revealed = s.phase === "REVEALED" || s.phase === "ENDED";
  const self = s.mode === "self" ? (s as unknown as SelfRoom) : null;
  // Self-paced review mode (§8.7) reuses the instructor-paced question layout below.
  const reviewMode = !!s.reviewMode;
  const rows = Object.entries(s.roster || {})
    .filter(([id]) => !reviewMode || s.responses?.[id])
    .map(([id, name]) => ({
      id,
      name,
      r: s.responses?.[id]?.[s.questionId],
    }));
  rows.sort(
    (a, b) =>
      (sort === "status"
        ? Number(!!b.r?.locked) * 2 +
          Number(!!b.r?.answer) -
          Number(!!a.r?.locked) * 2 -
          Number(!!a.r?.answer)
        : 0) || a.name.localeCompare(b.name),
  );
  const received = rows.filter((x) => x.r?.answer).length;
  // A finished self-paced set has no clock left to show.
  const end = self?.poll ? self.poll.endsAt : self && s.status !== "live" ? null : s.endsAt;
  const remaining = end
    ? Math.ceil(Math.max(0, end - now - offset.current) / 1000)
    : null;
  const clock = (
    <strong
      id="live-timer"
      className={remaining != null && remaining <= 10 ? "urgent" : ""}
    >
      <Clock />
      {remaining == null ? "—" : formatTime(remaining)}
    </strong>
  );
  const connection = (
    <span id="live-link">
      {connected ? <Wifi /> : <WifiOff />}
      {connected ? "Connected" : "Reconnecting…"}
    </span>
  );
  const roster = (
    <div id="live-roster" className="roster">
      {rows.map((r) => (
        <div key={r.id}>
          <span className="avatar">{r.name.slice(0, 1)}</span>
          <span>{r.name}</span>
          <button
            data-kick={r.id}
            aria-label={`Remove ${r.name}`}
            disabled={s.phase === "ENDED"}
            onClick={() => send("kick", { userId: r.id })}
          >
            <X />
            Remove
          </button>
        </div>
      ))}
      {!rows.length && <Empty>No students yet.</Empty>}
    </div>
  );
  const lockJoin = (
    <label className="toggle">
      <input
        id="live-lock"
        type="checkbox"
        checked={s.lockedJoin}
        disabled={s.phase === "ENDED" || s.status === "ended"}
        onChange={(e) => toggle("lockedJoin", "lockJoin", e.target.checked)}
      />
      <LockKeyhole />
      Lock joining
    </label>
  );
  const lobby = (
    <div className="lobby-grid">
      <section className="panel lobby">
        <span className="eyebrow">{self ? "Ready when you are" : s.title}</span>
        <h2>Let’s bring everyone in.</h2>
        <p>Enter this code to join the lesson</p>
        <strong className="join-code">{s.code}</strong>
        <p>
          Join URL:{" "}
          <a href={`${location.origin}/app?join=${s.code}`}>
            {location.origin}/app?join={s.code}
          </a>
        </p>
        {lockJoin}
      </section>
      <section className="panel">
        <h2>
          Students <Badge>{s.count}</Badge>
        </h2>
        {roster}
      </section>
    </div>
  );
  const endSession = (
    <button
      data-live="endSession"
      disabled={s.phase === "ENDED"}
      onClick={() => send("endSession")}
    >
      End session
    </button>
  );
  const errorLine = (
    <p id="live-error" className="error" role="alert">
      {error}
    </p>
  );
  // Self-paced set, poll and overview screens keep their header and footer.
  if (self && !reviewMode)
    return (
      <div className="live-view">
        <header className="live-top">
          <div>
            <Badge tone="green">
              {s.status === "lobby"
                ? "LOBBY"
                : self.poll || self.pollResult
                  ? "REVIEW POLL"
                  : { live: "SELF-PACED SET", review: "SET FINISHED", ended: "SESSION ENDED" }[s.status] || s.status}
            </Badge>
            <h2>{s.title}</h2>
          </div>
          <div className="live-facts">
            <strong>{s.code}</strong>
            <span>
              <Users />
              {s.count} joined
            </span>
            <span id="live-submitted">
              Submitted {Object.keys(self.submitted).length}
            </span>
            {clock}
          </div>
        </header>
        {s.status === "lobby" ? (
          lobby
        ) : (
          <>
            {s.status === "live" ? (
              <SelfGrid s={self} />
            ) : self.poll ? (
              <PollPanel s={self} />
            ) : self.pollResult ? (
              <ResultPanel s={self} />
            ) : (
              self.overview && <Overview s={self} send={send} />
            )}
            <details className="roster-details panel">
              <summary>Manage students</summary>
              {lockJoin}
              {roster}
            </details>
          </>
        )}
        {errorLine}
        <footer className="live-bottom">
          <div className="actions">
            {s.status === "lobby" && (
              <button
                className="primary"
                data-live="start"
                onClick={() => send("start")}
              >
                <Play />
                Start lesson
              </button>
            )}
          </div>
          {connection}
          {endSession}
        </footer>
      </div>
    );
  // B3 navigator. Questions before `played` have been revealed; `reached` is the furthest one opened.
  // Only played questions and the next unplayed one can be opened, and never while answers are open.
  const outline = s.outline || [];
  const played = s.played ?? (revealed ? s.index + 1 : s.index);
  const reached = s.reached ?? s.index;
  const movable =
    !self && s.status === "live" && (s.phase === "READY" || s.phase === "REVEALED");
  const reachable = (i: number) =>
    movable && i >= 0 && i < s.total && i !== s.index && i <= played;
  const go = (i: number) => {
    if (!reachable(i)) return;
    // › on the furthest question reached is exactly Next.
    if (i === s.index + 1 && s.index === reached) send("next");
    else send("goto", { questionId: outline[i]?.questionId });
    setDrawer(false);
  };
  const answered = (questionId: string) =>
    Object.values(s.responses || {}).filter((r) => r[questionId]?.answer).length;
  return (
    <div className="live-view live-present" data-phase={s.phase}>
      {s.status === "lobby" ? (
        lobby
      ) : (
        <section className="live-area" aria-label="Question">
          {s.question && (
            <InstructorStage
              key={s.questionId}
              s={s}
              send={send}
              strikeMode={strikeMode}
              struck={struck[s.questionId]}
              onStrikeMode={() => setStrikeMode(!strikeMode)}
              onStrike={(letter) =>
                setStruck((all) => {
                  const list = all[s.questionId] || [];
                  return {
                    ...all,
                    [s.questionId]: list.includes(letter)
                      ? list.filter((x) => x !== letter)
                      : [...list, letter],
                  };
                })
              }
            >
              {!self && (
                <aside
                  id="live-nav-drawer"
                  ref={drawerRef}
                  className={`live-drawer left${drawer ? " open" : ""}`}
                  aria-label="Lesson questions"
                  aria-hidden={!drawer}
                  inert={!drawer}
                >
                  <h3>Questions</h3>
                  <ol>
                    {outline.map((q, i) => {
                      const count = answered(q.questionId);
                      return (
                        <li key={q.questionId}>
                          <button
                            data-nav-index={i}
                            aria-current={i === s.index ? "step" : undefined}
                            disabled={i !== s.index && !reachable(i)}
                            onClick={() => (i === s.index ? setDrawer(false) : go(i))}
                          >
                            <span className="nav-number">{i + 1}</span>
                            <span className="nav-text">
                              <span className="nav-snippet">{q.snippet}</span>
                              <span className="nav-meta">
                                {q.questionId} · {count}{" "}
                                {count === 1 ? "response" : "responses"}
                              </span>
                            </span>
                          </button>
                        </li>
                      );
                    })}
                  </ol>
                </aside>
              )}
              <aside
                id="live-notes-drawer"
                className={`live-drawer right${notes ? " open" : ""}`}
                aria-label="Instructor notes and explanation"
                aria-hidden={!notes}
                inert={!notes}
              >
                <div className="drawer-head">
                  <h3>Notes</h3>
                  <button
                    className="icon-button"
                    aria-label="Close notes"
                    onClick={() => setNotes(false)}
                  >
                    <X />
                  </button>
                </div>
                <h4>Official explanation</h4>
                <HTML
                  html={
                    s.question.explanation_html ||
                    "<p>Explanation unavailable.</p>"
                  }
                />
                <h4>My notes</h4>
                <HTML html={notesHTML(s.notes || "")} />
              </aside>
            </InstructorStage>
          )}
        </section>
      )}
      {s.status !== "lobby" && (
        <div id="live-join" className="live-join" aria-label={`Join code ${s.code}`}>
          <span>Join code</span>
          <strong>{s.code}</strong>
        </div>
      )}
      {errorLine}
      <footer className="live-bar">
        <div className="live-nav">
          {reviewMode ? (
            <>
              <span className="live-nav-label">
                Question {s.index + 1} of {s.total}
              </span>
              {s.phase === "REVEALED" && (
                <button
                  className="bar-primary"
                  data-live="next"
                  onClick={() => send("next")}
                >
                  Next
                  <SkipForward />
                </button>
              )}
            </>
          ) : (
            <>
              <button
                id="live-prev"
                aria-label="Previous question"
                disabled={!reachable(s.index - 1)}
                onClick={() => go(s.index - 1)}
              >
                <ChevronLeft />
              </button>
              <button
                id="live-nav"
                ref={navButton}
                aria-expanded={drawer}
                aria-controls="live-nav-drawer"
                disabled={s.status === "lobby"}
                onClick={() => setDrawer(!drawer)}
              >
                Question {s.index + 1} of {s.total}
              </button>
              <button
                id="live-next"
                data-live="next"
                aria-label="Next question"
                disabled={!reachable(s.index + 1)}
                onClick={() => go(s.index + 1)}
              >
                <ChevronRight />
              </button>
            </>
          )}
        </div>
        {!reviewMode && (
          <div className="live-clock">
            {s.phase === "ENDED" ? (
              <strong id="live-timer">Session ended</strong>
            ) : (
              clock
            )}
            {s.status === "lobby" && (
              <button
                className="bar-primary"
                data-live="start"
                onClick={() => send("start")}
              >
                <Play />
                Start lesson
              </button>
            )}
            {s.status === "live" && s.phase === "READY" && (
              <button
                className="bar-primary"
                data-live="startQuestion"
                onClick={() => send("startQuestion")}
              >
                <Play />
                Start question
              </button>
            )}
            {s.phase === "ANSWERING" && (
              <>
                <button
                  data-live="addTime"
                  onClick={() => send("addTime", { sec: 15 })}
                >
                  <Plus />
                  15s
                </button>
                <button data-live="endNow" onClick={() => send("endNow")}>
                  <Square />
                  End now
                </button>
              </>
            )}
          </div>
        )}
        <div className="live-pop-anchor" ref={popupAnchor}>
          <button
            id="live-responses"
            aria-expanded={popup}
            aria-controls="live-responses-popup"
            onClick={() => setPopup(!popup)}
          >
            <Users />
            {received} of {rows.length} responses
          </button>
          {popup && (
            <div
              id="live-responses-popup"
              className="live-popup"
              role="dialog"
              aria-label="Responses"
            >
              <div className="section-head">
                <h3>Responses</h3>
                <span className="live-joined">{s.count} joined</span>
                <label>
                  Sort
                  <select
                    id="live-sort"
                    value={sort}
                    onChange={(e) => setSort(e.target.value)}
                  >
                    <option value="name">Name</option>
                    <option value="status">Status</option>
                  </select>
                </label>
                <button
                  className="icon-button"
                  aria-label="Close responses"
                  onClick={() => setPopup(false)}
                >
                  <X />
                </button>
              </div>
              <div className="response-list">
                {rows.map(({ id, name, r }) => (
                  <div className="response-row" key={id} data-response={id}>
                    <span>{name}</span>
                    <Badge tone={r?.locked ? "green" : r?.answer ? "blue" : ""}>
                      {r?.locked ? "locked" : r?.answer ? "selected" : "nothing"}
                    </Badge>
                    <strong>{r?.answer || "—"}</strong>
                    {revealed &&
                      r?.answer &&
                      s.question &&
                      (isRight(s.question, r.answer) ? (
                        <Check className="right-icon" aria-label="Correct" />
                      ) : (
                        <X className="wrong-icon" aria-label="Incorrect" />
                      ))}
                  </div>
                ))}
                {!rows.length && <Empty>No students yet.</Empty>}
              </div>
              {revealed && s.distribution && (
                <section className="distribution">
                  <h3>Distribution</h3>
                  {s.distribution.map((g, i) => (
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
                          <span
                            style={{
                              width: `${rows.length ? (g.count / rows.length) * 100 : 0}%`,
                              background: [
                                "#1286a5",
                                "#1869b6",
                                "#7771b1",
                                "#448a3b",
                                "#8a929f",
                              ][i % 5],
                            }}
                          />
                        </span>
                      </button>
                      {group === i && (
                        <div
                          id="live-group"
                          className="names-popover"
                          role="status"
                        >
                          <button
                            className="icon-button"
                            aria-label="Close distribution details"
                            onClick={() => setGroup(null)}
                          >
                            <X />
                          </button>
                          <strong>{g.label}</strong>
                          {g.users.map((u, n) => (
                            <p key={n}>
                              {u.name}
                              <span>{time(u.ms)}</span>
                            </p>
                          ))}
                          {!g.users.length && <p>No students</p>}
                        </div>
                      )}
                    </div>
                  ))}
                </section>
              )}
              <label className="toggle">
                <input
                  id="live-class"
                  type="checkbox"
                  checked={!!s.classResults}
                  disabled={s.phase === "ENDED"}
                  onChange={(e) =>
                    toggle("classResults", "classResults", e.target.checked)
                  }
                />
                Show class results
              </label>
              <details className="roster-details">
                <summary>Manage students</summary>
                {lockJoin}
                {roster}
              </details>
            </div>
          )}
        </div>
        <button
          id="live-notes"
          aria-expanded={notes}
          aria-controls="live-notes-drawer"
          disabled={!s.question}
          onClick={() => setNotes(!notes)}
        >
          <NotebookText />
          Notes
        </button>
        {connection}
        {endSession}
      </footer>
    </div>
  );
}

function InstructorStage({
  s,
  send,
  strikeMode,
  struck,
  onStrikeMode,
  onStrike,
  children,
}: {
  s: Room;
  send: Send;
  strikeMode: boolean;
  struck?: string[];
  onStrikeMode: () => void;
  onStrike: (letter: string) => void;
  // Drawers that overlay the question (navigator, notes).
  children?: ReactNode;
}) {
  const [tool, setTool] = useState("highlight");
  const [color, setColor] = useState(colors[0]);
  const [clear, setClear] = useState(false);
  const [card, setCard] = useState<HTMLDivElement | null>(null);
  const [desmos, setDesmos] = useState(!!s.desmos);
  const latest = useRef({ s, send });
  latest.current = { s, send };
  const annotating = s.phase === "REVEALED";
  useEffect(() => {
    const esc = (e: KeyboardEvent) => {
      if (e.key === "Escape") setTool("");
    };
    window.addEventListener("keydown", esc);
    return () => window.removeEventListener("keydown", esc);
  }, []);
  useEffect(() => {
    if (!card || s.phase !== "REVEALED") return;
    let points: number[][] = [],
      drawing = false,
      interval: ReturnType<typeof setInterval> | undefined,
      // One content anchor per pen gesture (see Ink.locate), so strokes land on the same
      // words for students whose stage is laid out at a different width.
      anchor: string | undefined,
      toAnchor: ReturnType<typeof Ink.frame> = null;
    card.style.cursor = ["pen", "erase", "laser"].includes(tool)
      ? "crosshair"
      : "";
    card.classList.toggle(
      "tool-highlight",
      tool === "highlight" || tool === "strike",
    );
    const point = (e: PointerEvent) => {
      const [lo, hi] = !anchor ? [0, 1] : anchor.includes("@") ? [-4000, 4000] : [-4, 5];
      return toAnchor!
        .fromClient(e.clientX, e.clientY)
        .map((v) => Math.max(lo, Math.min(hi, v)));
    };
    // Laser: coalesce pointermoves into at most one send per animation frame and
    // ~30 Hz, skip unchanged positions, heartbeat while idle, hide explicitly.
    const dot = Ink.laser(card);
    type Aim = { x: number; y: number; a?: string };
    // Latest pointer position; resolved to a content anchor only when a frame is sent.
    let aim: [number, number] | null = null,
      sent: Aim | null = null,
      sentAt = 0,
      frame = 0;
    const laserSend = (fields: Record<string, unknown>, now = performance.now()) => {
      latest.current.send("laser", {
        questionId: latest.current.s.questionId,
        ...fields,
      });
      sentAt = now;
    };
    // Frame timestamps: every second 60 Hz frame (~30 Hz); 28 ms absorbs frame jitter.
    const pump = (now: number) => {
      frame = 0;
      if (!aim) return;
      if (now - sentAt < 28) {
        frame = requestAnimationFrame(pump);
        return;
      }
      const at: Aim = Ink.locate(card, aim[0], aim[1]);
      aim = null;
      dot.show(at);
      if (sent && at.x === sent.x && at.y === sent.y && at.a === sent.a) return;
      sent = at;
      laserSend(at, now);
    };
    const heartbeat =
      tool === "laser"
        ? setInterval(() => {
            if (sent && performance.now() - sentAt > 2400) laserSend(sent);
          }, 2500)
        : undefined;
    const laserOff = () => {
      cancelAnimationFrame(frame);
      frame = 0;
      aim = null;
      dot.hide();
      // After Next/End the room is no longer REVEALED; students drop the old card's dot anyway.
      if (sent && latest.current.s.phase === "REVEALED") laserSend({ hide: true });
      sent = null;
    };
    const mark = (op: Partial<Mark>) =>
      latest.current.send("annotate", {
        questionId: latest.current.s.questionId,
        op,
      });
    const flush = () => {
      if (!points.length) return;
      mark({
        type: "stroke",
        id: crypto.randomUUID(),
        points: points.slice(0, 32),
        color,
        ...(anchor ? { a: anchor } : {}),
      });
      points = drawing ? points.slice(-1) : [];
    };
    const down = (e: PointerEvent) => {
      if (tool !== "pen") return;
      e.preventDefault();
      card.setPointerCapture(e.pointerId);
      drawing = true;
      const start = Ink.locate(card, e.clientX, e.clientY);
      anchor = start.a;
      toAnchor = Ink.frame(card, anchor);
      points = [[start.x, start.y]];
      interval = setInterval(() => {
        if (points.length > 1) flush();
      }, 50);
    };
    const move = (e: PointerEvent) => {
      if (tool === "pen" && card.hasPointerCapture(e.pointerId)) {
        points.push(point(e));
        if (points.length >= 32) flush();
      }
      if (tool === "laser") {
        aim = [e.clientX, e.clientY];
        if (!frame) frame = requestAnimationFrame(pump);
      }
    };
    const up = (e: PointerEvent) => {
      if (interval) {
        clearInterval(interval);
        interval = undefined;
        if (points.length) {
          points.push(point(e));
          drawing = false;
          flush();
        }
        points = [];
      }
      if (
        (tool === "highlight" || tool === "strike") &&
        !(e.target as Element).closest(".badge")
      ) {
        const range = Ink.anchor(card, window.getSelection());
        if (range)
          mark({ type: tool, id: crypto.randomUUID(), ...range, color });
        window.getSelection()?.removeAllRanges();
      } else if (tool === "erase") {
        const id = (e.target as Element).closest<HTMLElement>("[data-ann-mark]")
          ?.dataset.annMark;
        if (id) mark({ type: "erase", id });
        else {
          const r = card.getBoundingClientRect(),
            scale = r.width / card.offsetWidth || 1,
            x = (e.clientX - r.left) / scale,
            y = (e.clientY - r.top) / scale;
          const stroke = latest.current.s.annotations?.find(
            (m) =>
              m.type === "stroke" &&
              Ink.strokePoints(card, m).some(
                ([px, py]: number[]) => Math.hypot(px - x, py - y) < 12,
              ),
          );
          if (stroke) mark({ type: "erase", id: stroke.id });
        }
      }
    };
    card.addEventListener("pointerdown", down);
    card.addEventListener("pointermove", move);
    card.addEventListener("pointerup", up);
    card.addEventListener("pointercancel", up);
    card.addEventListener("pointerleave", laserOff);
    return () => {
      clearInterval(interval);
      clearInterval(heartbeat);
      laserOff();
      card.removeEventListener("pointerleave", laserOff);
      card.removeEventListener("pointerdown", down);
      card.removeEventListener("pointermove", move);
      card.removeEventListener("pointerup", up);
      card.removeEventListener("pointercancel", up);
      card.style.cursor = "";
      card.classList.remove("tool-highlight");
    };
  }, [card, tool, color, s.phase]);
  return (
    <>
      {/* Annotation tools are shown in every phase so the row is never empty, but only work once
          the question is revealed (the room rejects annotations before that). */}
      <div id="live-tools" role="toolbar" aria-label="Annotation tools">
        {Object.entries(tools).map(([key, Icon]) => (
          <button
            key={key}
            data-tool={key}
            title={
              annotating
                ? labels[key as keyof typeof labels]
                : `${labels[key as keyof typeof labels]} (after the reveal)`
            }
            aria-label={labels[key as keyof typeof labels]}
            aria-pressed={annotating && tool === key}
            disabled={!annotating}
            onClick={() =>
              key === "clear"
                ? setClear(true)
                : (setTool(tool === key ? "" : key),
                  setColor(key === "pen" ? "#ff7676" : "#ffe066"))
            }
          >
            <Icon />
            <span>{labels[key as keyof typeof labels]}</span>
          </button>
        ))}
        {s.question?.section === "Math" && (
          <button
            id="live-desmos-toggle"
            title="Desmos"
            aria-pressed={desmos}
            onClick={() => setDesmos(!desmos)}
          >
            <Calculator />
            <span>Desmos</span>
          </button>
        )}
        <div className="swatches">
          {colors.map((c) => (
            <button
              key={c}
              style={{ background: c }}
              aria-label={`Color ${c}`}
              aria-pressed={color === c}
              disabled={!annotating}
              onClick={() => setColor(c)}
            />
          ))}
        </div>
      </div>
      <div className="live-body">
        <div id="live-stage">
          <Stage
            question={s.question!}
            number={s.index + 1}
            id="live-card"
            revealed
            marks={s.annotations}
            mathify={mathify}
            onReady={setCard}
            strikeMode={strikeMode}
            struck={struck}
            onStrikeMode={onStrikeMode}
            onStrike={onStrike}
          />
        </div>
        {desmos && (
          <DesmosLeader
            apiKey={s.desmosKey}
            initial={s.desmos}
            live={s.phase === "REVEALED"}
            send={(state) =>
              send("desmos", { questionId: s.questionId, state })
            }
          />
        )}
        {children}
      </div>
      {clear && (
        <Dialog
          title="Clear all shared annotations?"
          close={() => setClear(false)}
        >
          <p>This clears the shared layer for this question.</p>
          <div className="actions">
            <button onClick={() => setClear(false)}>Cancel</button>
            <button
              className="danger"
              onClick={() => {
                send("annotate", {
                  questionId: s.questionId,
                  op: { type: "clear" },
                });
                setClear(false);
              }}
            >
              Clear all
            </button>
          </div>
        </Dialog>
      )}
    </>
  );
}
