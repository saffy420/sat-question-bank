import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
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
  EyeOff,
  TextCursorInput,
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
  edit: TextCursorInput,
  erase: Eraser,
  clear: Trash2,
  laser: Focus,
};
const labels = {
  pen: "Pen",
  highlight: "Highlight",
  strike: "Strikethrough",
  edit: "Edit text",
  erase: "Erase",
  clear: "Clear all",
  laser: "Laser",
};
const colors = ["#ffe066", "#ff7676", "#75dbaa"];
// 11d: before the reveal the instructor still annotates, but the room keeps the layer to
// instructor screens (src/lesson-room.js hidden()) and publishes it all at the reveal.
const hiddenLayer = (s: Room) =>
  s.mode !== "self" &&
  s.status === "live" &&
  (s.phase === "READY" || s.phase === "ANSWERING");
const canAnnotate = (s: Room) => s.phase === "REVEALED" || hiddenLayer(s);

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
  // Cross-out mode is local; crossed-out choices are shared with the class.
  const [strikeMode, setStrikeMode] = useState(false);
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
        } else if (m.type === "eliminations")
          setState((old) =>
            !old || old.questionId !== m.questionId
              ? old
              : { ...old, eliminations: m.letters },
          );
        else if (m.type === "annotate")
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
              struck={s.eliminations}
              onStrikeMode={() => setStrikeMode(!strikeMode)}
              onStrike={(letter) =>
                send("eliminate", {
                  questionId: s.questionId,
                  letter,
                  on: !s.eliminations?.includes(letter),
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

// Instructor Desmos panel width (px): remembered on this browser only, across close/reopen, questions and reloads.
const DESMOS_KEY = "lessons.desmosWidth";
const DESMOS_DEFAULT = 420, DESMOS_MIN = 280, DESMOS_MAX = 720, DESMOS_READABLE = 360;
const storedDesmosWidth = () => {
  try {
    const n = Number(localStorage.getItem(DESMOS_KEY));
    return Number.isFinite(n) && n >= DESMOS_MIN ? n : DESMOS_DEFAULT;
  } catch {
    return DESMOS_DEFAULT;
  }
};

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
  // Chosen width is kept as asked; what is drawn is clamped so the question keeps DESMOS_READABLE px.
  const [desmosWidth, setDesmosWidth] = useState(storedDesmosWidth);
  const [bodyWidth, setBodyWidth] = useState(0);
  const body = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = body.current;
    if (!el) return;
    const observer = new ResizeObserver(() => setBodyWidth(el.clientWidth));
    observer.observe(el);
    setBodyWidth(el.clientWidth);
    return () => observer.disconnect();
  }, []);
  const desmosMax = Math.max(DESMOS_MIN, Math.min(DESMOS_MAX, (bodyWidth || 1e4) - DESMOS_READABLE));
  const desmosShown = Math.round(Math.min(desmosMax, Math.max(DESMOS_MIN, desmosWidth)));
  const chooseDesmosWidth = (width: number) => {
    const next = Math.round(Math.min(desmosMax, Math.max(DESMOS_MIN, width)));
    setDesmosWidth(next);
    try {
      localStorage.setItem(DESMOS_KEY, String(next));
    } catch {
      /* private mode: the width just lasts for this page */
    }
  };
  const latest = useRef({ s, send });
  latest.current = { s, send };
  // Where the laser pointer rests over the stage (null once it leaves), kept across phase changes.
  const resting = useRef<[number, number] | null>(null);
  const hidden = hiddenLayer(s);
  const annotating = canAnnotate(s);
  // Edit text: committed fixes are shown until the room echoes them, so the block never flashes the old text,
  // and the marks the room will drop from an edited block (see src/lesson-room.js) are not repainted meanwhile.
  const [pending, setPending] = useState<Mark[]>([]);
  const [editNote, setEditNote] = useState("");
  useEffect(() => setPending([]), [s.questionId]);
  useEffect(() => {
    setPending((old) => {
      const left = old.filter(
        (p) => !s.annotations?.some((m) => m.id === p.id && m.text === p.text),
      );
      return left.length === old.length ? old : left;
    });
  }, [s.annotations]);
  useEffect(() => {
    if (!editNote) return;
    const timer = setTimeout(() => setEditNote(""), 4000);
    return () => clearTimeout(timer);
  }, [editNote]);
  const shown = useMemo(
    () =>
      pending.length
        ? [
            ...(s.annotations || []).filter(
              (m) =>
                !pending.some(
                  (p) =>
                    p.id === m.id ||
                    (m.type !== "edit" &&
                      (m.nodeId === p.nodeId ||
                        !!m.a?.startsWith(`${p.nodeId}~`) ||
                        !!m.a?.startsWith(`${p.nodeId}@`))),
                ),
            ),
            ...pending,
          ]
        : s.annotations,
    [s.annotations, pending],
  );
  // Edit text: one passage/stem block or choice text at a time becomes editable. KaTeX (and any image) is
  // locked; the block's text nodes must come back the same in number and the markup the same in shape, so
  // only prose changes. Each changed text node goes out as one `edit` mark, counted on the clean block.
  useEffect(() => {
    if (!card || !annotating || tool !== "edit") return;
    let block: HTMLElement | null = null,
      saved: Node[] = [],
      before: string[] = [],
      shape = 0;
    // Choice text sits in the choice buttons, disabled on this screen (the presenter never selects). Clicks
    // never reach a disabled button's text, so they are enabled while the tool is on; with no `active`
    // Stage prop a click still selects nothing.
    const buttons = [...card.querySelectorAll<HTMLButtonElement>("button[data-lesson-choice]")];
    for (const b of buttons) b.disabled = false;
    const shapeOf = (el: HTMLElement) => el.getElementsByTagName("*").length;
    const locked = (el: HTMLElement) => [
      ...el.querySelectorAll<HTMLElement>(".katex, img, svg, .fv"),
    ].filter((n) => !n.parentElement?.closest(".katex, .fv"));
    const end = (commit: boolean) => {
      const el = block;
      if (!el) return;
      block = null;
      el.removeEventListener("keydown", key);
      el.removeEventListener("focusout", away);
      el.removeEventListener("beforeinput", guard);
      el.removeEventListener("input", check);
      const nodes = Ink.textNodes(el) as Text[];
      const same = nodes.length === before.length && shapeOf(el) === shape;
      const changed = nodes
        .map((n, i) => ({ i, text: n.data }))
        .filter(({ i, text }) => same && text !== before[i]);
      const ops = changed.map(({ i, text }) => ({
        type: "edit" as const,
        id: `edit:${el.dataset.annNode}:${i}`,
        nodeId: el.dataset.annNode,
        i,
        text,
      }));
      // The room closes a socket on a frame over MAX_FRAME (2048 bytes), so a long fix is refused here.
      const fits = ops.every(
        (op) =>
          op.text.length <= 1500 &&
          new TextEncoder().encode(
            JSON.stringify({ type: "annotate", questionId: latest.current.s.questionId, op }),
          ).length < 2000,
      );
      const keep = commit && same && fits;
      if (!keep) {
        if (same) nodes.forEach((n, i) => (n.data = before[i]));
        else el.replaceChildren(...saved);
        if (commit && !same)
          setEditNote("Only text can be changed — math and formatting are locked");
        else if (commit) setEditNote("That edit is too long to send at once");
      }
      el.removeAttribute("contenteditable");
      el.spellcheck = true;
      delete el.dataset.annEditing;
      for (const n of locked(el)) {
        n.removeAttribute("contenteditable");
        n.classList.remove("ann-locked");
        if (n.classList.contains("katex")) n.removeAttribute("title");
      }
      if (keep && ops.length) {
        setPending((old) => [
          ...old.filter((p) => !ops.some((op) => op.id === p.id)),
          ...ops,
        ]);
        for (const op of ops)
          latest.current.send("annotate", {
            questionId: latest.current.s.questionId,
            op,
          });
      } else Ink.paint(card, latest.current.s.annotations || []);
    };
    const key = (e: KeyboardEvent) => {
      if (e.key === "Enter") {
        e.preventDefault();
        end(true);
      } else if (e.key === "Escape") {
        // Esc only cancels the edit; the tool stays selected.
        e.preventDefault();
        e.stopPropagation();
        end(false);
      }
    };
    const away = () => end(true);
    // Markup can't be typed: Enter commits (handled on keydown), a line break is refused. The caret is noted
    // so a refused input (below) can put it back.
    const guard = (e: InputEvent) => {
      if (e.inputType === "insertParagraph" || e.inputType === "insertLineBreak") e.preventDefault();
      const el = block, at = window.getSelection();
      if (el && at?.anchorNode) {
        const nodes = Ink.textNodes(el) as Node[];
        caret = [nodes.indexOf(at.anchorNode), at.anchorOffset];
      }
    };
    // Browsers delete a locked inline (KaTeX) as one unit and report it inconsistently beforehand, so each
    // input is checked after the fact: anything that changed the block's shape is put back at once.
    let good: Node[] = [],
      caret: [number, number] = [-1, 0];
    const check = () => {
      const el = block;
      if (!el) return;
      if (Ink.textNodes(el).length === before.length && shapeOf(el) === shape) {
        good = [...el.childNodes].map((n) => n.cloneNode(true));
        return;
      }
      el.replaceChildren(...good.map((n) => n.cloneNode(true)));
      const node = (Ink.textNodes(el) as Text[])[caret[0]];
      if (node) {
        const range = document.createRange();
        range.setStart(node, Math.min(caret[1], node.length));
        window.getSelection()?.removeAllRanges();
        window.getSelection()?.addRange(range);
      }
      setEditNote("Only text can be changed — math and formatting are locked");
    };
    const start = (el: HTMLElement, x: number, y: number) => {
      if (el.closest("table") || el.querySelector("table")) return;
      Ink.unpaint(card);
      el.dataset.annEditing = "true";
      // Repaint every other block's marks; this one stays clean while it is edited.
      Ink.paint(card, latest.current.s.annotations || []);
      saved = [...el.childNodes].map((n) => n.cloneNode(true));
      before = (Ink.textNodes(el) as Text[]).map((n) => n.data);
      shape = shapeOf(el);
      for (const n of locked(el)) {
        n.contentEditable = "false";
        n.classList.add("ann-locked");
        if (n.classList.contains("katex")) n.title = "Math can't be edited";
      }
      try {
        el.contentEditable = "plaintext-only";
      } catch {
        el.contentEditable = "true";
      }
      el.spellcheck = false;
      good = [...el.childNodes].map((n) => n.cloneNode(true));
      block = el;
      el.addEventListener("keydown", key);
      el.addEventListener("focusout", away);
      el.addEventListener("beforeinput", guard);
      el.addEventListener("input", check);
      el.focus();
      const point = document.caretRangeFromPoint?.(x, y);
      if (point && el.contains(point.startContainer)) {
        const selection = window.getSelection();
        selection?.removeAllRanges();
        selection?.addRange(point);
      }
    };
    const click = (e: MouseEvent) => {
      const el = (e.target as Element).closest<HTMLElement>("[data-ann-node]");
      if (!el || el === block || !card.contains(el) || (e.target as Element).closest(".badge, .fv-bar"))
        return;
      e.preventDefault();
      end(true);
      start(el, e.clientX, e.clientY);
    };
    card.addEventListener("click", click, true);
    return () => {
      card.removeEventListener("click", click, true);
      end(false);
      for (const b of buttons) b.disabled = true;
    };
  }, [card, tool, annotating, s.questionId]);
  useEffect(() => {
    const esc = (e: KeyboardEvent) => {
      if (e.key === "Escape") setTool("");
    };
    window.addEventListener("keydown", esc);
    return () => window.removeEventListener("keydown", esc);
  }, []);
  useEffect(() => {
    if (!card || !annotating) return;
    // Pen points are kept in client px and converted per chunk: each ~50 ms chunk anchors to the glyph
    // under its first point (em units, see Ink.locateGlyph), so a stroke that wraps over two lines here
    // still lands on the same words where the line breaks differ. A stroke that started on a figure
    // (or anywhere else without text) keeps that one anchor for the whole gesture.
    let raw: [number, number][] = [],
      drawing = false,
      interval: ReturnType<typeof setInterval> | undefined,
      anchor: string | undefined,
      glyphMode = false;
    for (const name of Object.keys(tools))
      card.classList.toggle(`tool-${name}`, tool === name);
    const limits = (a: string | undefined) =>
      !a ? [0, 1] : /[@~]/.test(a) ? [-400, 400] : [-4, 5];
    const convert = (chunk: [number, number][]) => {
      if (glyphMode) {
        const g = Ink.locateGlyph(card, chunk[0][0], chunk[0][1]);
        if (g) anchor = g.a;
      }
      const f = Ink.frame(card, anchor);
      if (!f) return null;
      const [lo, hi] = limits(anchor);
      return chunk.map(([x, y]) =>
        f.fromClient(x, y).map((v: number) => Math.max(lo, Math.min(hi, v))),
      );
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
      // Only where the room takes a laser; students drop the old card's dot anyway.
      if (sent && canAnnotate(latest.current.s)) laserSend({ hide: true });
      sent = null;
    };
    const mark = (op: Partial<Mark>) =>
      latest.current.send("annotate", {
        questionId: latest.current.s.questionId,
        op,
      });
    const flush = () => {
      if (!raw.length) return;
      const chunk = raw.slice(0, 32);
      const points = convert(chunk);
      if (points)
        mark({
          type: "stroke",
          id: crypto.randomUUID(),
          points,
          color,
          ...(anchor ? { a: anchor } : {}),
        });
      raw = drawing ? [chunk[chunk.length - 1]] : [];
    };
    const down = (e: PointerEvent) => {
      // The figure toolbar keeps working while the pen is out (capturing here would swallow its clicks).
      if (tool !== "pen" || (e.target as Element).closest(".fv-bar")) return;
      e.preventDefault();
      card.setPointerCapture(e.pointerId);
      drawing = true;
      const start = Ink.locate(card, e.clientX, e.clientY);
      anchor = "a" in start ? start.a : undefined;
      // Only a stroke that started on a figure keeps one anchor; anywhere else it may pick up a glyph anchor.
      glyphMode = !anchor?.startsWith("i:");
      raw = [[e.clientX, e.clientY]];
      interval = setInterval(() => {
        if (raw.length > 1) flush();
      }, 50);
    };
    const move = (e: PointerEvent) => {
      if (tool === "pen" && card.hasPointerCapture(e.pointerId)) {
        raw.push([e.clientX, e.clientY]);
        if (raw.length >= 32) flush();
      }
      if (tool === "laser") {
        aim = resting.current = [e.clientX, e.clientY];
        if (!frame) frame = requestAnimationFrame(pump);
      }
    };
    const up = (e: PointerEvent) => {
      if (interval) {
        clearInterval(interval);
        interval = undefined;
        if (raw.length) {
          raw.push([e.clientX, e.clientY]);
          drawing = false;
          flush();
        }
        raw = [];
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
            scale = Ink.scaleOf(card, r),
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
    const leave = () => {
      resting.current = null;
      laserOff();
    };
    card.addEventListener("pointerleave", leave);
    // 11d: at the reveal the pointer may already rest on a word; send it again so students get the dot.
    if (tool === "laser" && resting.current) {
      aim = resting.current;
      frame = requestAnimationFrame(pump);
    }
    return () => {
      clearInterval(interval);
      clearInterval(heartbeat);
      laserOff();
      card.removeEventListener("pointerleave", leave);
      card.removeEventListener("pointerdown", down);
      card.removeEventListener("pointermove", move);
      card.removeEventListener("pointerup", up);
      card.removeEventListener("pointercancel", up);
      for (const name of Object.keys(tools))
        card.classList.remove(`tool-${name}`);
    };
  }, [card, tool, color, s.phase, annotating]);
  return (
    <>
      {/* Annotation tools are shown in every phase so the row is never empty. They work on a live
          question (privately until the reveal) and in review mode, not in the lobby. */}
      <div id="live-tools" role="toolbar" aria-label="Annotation tools">
        {Object.entries(tools).map(([key, Icon]) => (
          <button
            key={key}
            data-tool={key}
            title={
              annotating
                ? labels[key as keyof typeof labels]
                : `${labels[key as keyof typeof labels]} (once the question is live)`
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
        {editNote && (
          <span id="live-edit-note" className="live-hidden" role="alert">
            {editNote}
          </span>
        )}
        {hidden && (
          <span
            className="live-hidden"
            role="status"
            title="Students see your annotations, cross-outs and laser when the question is revealed. Text edits reach them at once."
          >
            <EyeOff aria-hidden="true" />
            Hidden until reveal
          </span>
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
      <div className="live-body" ref={body}>
        <div id="live-stage">
          <Stage
            question={s.question!}
            number={s.index + 1}
            id="live-card"
            revealed
            marks={shown}
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
            resize={{
              width: desmosShown,
              min: DESMOS_MIN,
              max: desmosMax,
              onChange: chooseDesmosWidth,
            }}
          />
        )}
        {children}
      </div>
      {clear && (
        <Dialog
          title="Clear all shared annotations?"
          close={() => setClear(false)}
        >
          <p>
            This clears the shared layer for this question. Text edits stay.
          </p>
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
