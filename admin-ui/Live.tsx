import { useEffect, useRef, useState } from "react";
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
} from "lucide-react";
import { Stage } from "../lesson-ui/Stage";
import { DesmosLeader } from "../lesson-ui/Desmos";
import { SelfGrid, type SelfRoom } from "./SelfLive";
import type { Snapshot, Laser, Mark } from "../lesson-ui/types";
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

export function Live({ id }: { id: string }) {
  const [s, setState] = useState<Room>();
  const room = useRef<Room | undefined>(undefined);
  room.current = s;
  const [error, setError] = useState("");
  const [version, setVersion] = useState(0);
  const [connected, setConnected] = useState(false);
  const [now, setNow] = useState(Date.now());
  const [laser, setLaser] = useState<Laser | null>(null);
  const socket = useRef<WebSocket | null>(null);
  const offset = useRef(0);
  const [sort, setSort] = useState("name");
  const [group, setGroup] = useState<number | null>(null);
  const send: Send = (type, fields = {}) => {
    if (socket.current?.readyState === WebSocket.OPEN)
      socket.current.send(JSON.stringify({ type, ...fields }));
  };
  useEffect(() => {
    let alive = true,
      best = Infinity,
      retry: ReturnType<typeof setTimeout>,
      laserTimer: ReturnType<typeof setTimeout>;
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
          // Self-paced roster refreshes leave question bodies out; keep the ones we have.
          setState((old) =>
            m.mode === "self" && !m.questions && old?.sessionId === m.sessionId
              ? { ...m, questions: old!.questions }
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
        else if (m.type === "laser" && room.current?.questionId === m.questionId) {
          setLaser(m);
          clearTimeout(laserTimer);
          laserTimer = setTimeout(() => setLaser(null), 300);
        } else if (m.type === "error") {
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
      clearTimeout(laserTimer);
      clearInterval(clock);
      socket.current?.close(1000);
      socket.current = null;
    };
  }, [id, version]);
  useEffect(() => {
    setGroup(null);
    setLaser(null);
  }, [s?.questionId]);
  useEffect(() => {
    const esc = (e: KeyboardEvent) => {
      if (e.key === "Escape") setGroup(null);
    };
    window.addEventListener("keydown", esc);
    return () => window.removeEventListener("keydown", esc);
  }, []);
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
  const rows = Object.entries(s.roster || {}).map(([id, name]) => ({
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
  const remaining = s.endsAt && !(self && s.status !== "live")
    ? Math.ceil(Math.max(0, s.endsAt - now - offset.current) / 1000)
    : null;
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
  return (
    <div className="live-view">
      <header className="live-top">
        <div>
          <Badge tone="green">
            {s.status === "lobby"
              ? "LOBBY"
              : self
                ? { live: "SELF-PACED SET", review: "SET FINISHED", ended: "SESSION ENDED" }[s.status] || s.status
                : s.phase}
          </Badge>
          <h2>{s.title}</h2>
        </div>
        <div className="live-facts">
          <strong>{s.code}</strong>
          <span>
            <Users />
            {s.count} joined
          </span>
          {self ? (
            <span id="live-submitted">
              Submitted {Object.keys(self.submitted).length}
            </span>
          ) : (
            <span>
              Q {s.index + 1} / {s.total}
            </span>
          )}
          <strong
            id="live-timer"
            className={remaining != null && remaining <= 10 ? "urgent" : ""}
          >
            <Clock />
            {remaining == null ? "—" : formatTime(remaining)}
          </strong>
        </div>
      </header>
      {s.status === "lobby" ? (
        <div className="lobby-grid">
          <section className="panel lobby">
            <span className="eyebrow">Ready when you are</span>
            <h2>Let’s bring everyone in.</h2>
            <p>Enter this code to join the lesson</p>
            <strong className="join-code">{s.code}</strong>
            <p>
              Join URL:{" "}
              <a href={`${location.origin}/app?join=${s.code}`}>
                {location.origin}/app?join={s.code}
              </a>
            </p>
            <label className="toggle">
              <input
                id="live-lock"
                type="checkbox"
                checked={s.lockedJoin}
                onChange={(e) =>
                  toggle("lockedJoin", "lockJoin", e.target.checked)
                }
              />
              <LockKeyhole />
              Lock joining
            </label>
          </section>
          <section className="panel">
            <h2>
              Students <Badge>{s.count}</Badge>
            </h2>
            {roster}
          </section>
        </div>
      ) : self ? (
        <>
          <SelfGrid s={self} />
          <details className="roster-details panel">
            <summary>Manage students</summary>
            <label className="toggle">
              <input
                id="live-lock"
                type="checkbox"
                checked={s.lockedJoin}
                disabled={s.status === "ended"}
                onChange={(e) =>
                  toggle("lockedJoin", "lockJoin", e.target.checked)
                }
              />
              Lock joining
            </label>
            {roster}
          </details>
        </>
      ) : (
        <div className="live-grid">
          <nav className="question-rail" aria-label="Lesson questions">
            {Array.from({ length: s.total }, (_, i) => (
              <div
                key={i}
                className={i === s.index ? "current" : ""}
                aria-current={i === s.index ? "step" : undefined}
              >
                <span>{i + 1}</span>
                {i < s.index ? (
                  <Check aria-label="Done" />
                ) : (
                  <span className="mini-slide" />
                )}
              </div>
            ))}
          </nav>
          <section className="stage-panel">
            {s.question && (
              <InstructorStage
                key={s.questionId}
                s={s}
                laser={laser}
                send={send}
              />
            )}
          </section>
          <aside className="responses panel">
            <div className="section-head">
              <h3>
                Responses · {received}/{rows.length} in
              </h3>
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
            <details className="roster-details">
              <summary>Manage students</summary>
              <label className="toggle">
                <input
                  id="live-lock"
                  type="checkbox"
                  checked={s.lockedJoin}
                  disabled={s.phase === "ENDED"}
                  onChange={(e) =>
                    toggle("lockedJoin", "lockJoin", e.target.checked)
                  }
                />
                Lock joining
              </label>
              {roster}
            </details>
          </aside>
        </div>
      )}
      <p id="live-error" className="error" role="alert">
        {error}
      </p>
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
          {s.status === "live" && s.phase === "READY" && (
            <button
              className="primary"
              data-live="startQuestion"
              onClick={() => send("startQuestion")}
            >
              <Play />
              Start question
            </button>
          )}
          {s.phase === "ANSWERING" && !self && (
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
          {s.phase === "REVEALED" && s.index + 1 < s.total && (
            <button
              className="primary"
              data-live="next"
              onClick={() => send("next")}
            >
              Next
              <SkipForward />
            </button>
          )}
        </div>
        {!self && (
          <span className="response-count">
            {received} of {rows.length} Responses
          </span>
        )}
        <span id="live-link">
          {connected ? <Wifi /> : <WifiOff />}
          {connected ? "Connected" : "Reconnecting…"}
        </span>
        {!self && (
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
        )}
        <button
          data-live="endSession"
          disabled={s.phase === "ENDED"}
          onClick={() => send("endSession")}
        >
          End session
        </button>
      </footer>
    </div>
  );
}

function InstructorStage({
  s,
  laser,
  send,
}: {
  s: Room;
  laser: Laser | null;
  send: Send;
}) {
  const [tool, setTool] = useState("highlight");
  const [color, setColor] = useState(colors[0]);
  const [clear, setClear] = useState(false);
  const [card, setCard] = useState<HTMLDivElement | null>(null);
  const [desmos, setDesmos] = useState(!!s.desmos);
  const latest = useRef({ s, send });
  latest.current = { s, send };
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
      lastLaser = 0;
    card.style.cursor = !tool
      ? ""
      : ["pen", "erase", "laser"].includes(tool)
        ? "crosshair"
        : "text";
    const point = (e: PointerEvent) => {
      const r = card.getBoundingClientRect();
      return [
        Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)),
        Math.max(0, Math.min(1, (e.clientY - r.top) / r.height)),
      ];
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
      });
      points = drawing ? points.slice(-1) : [];
    };
    const down = (e: PointerEvent) => {
      if (tool !== "pen") return;
      e.preventDefault();
      card.setPointerCapture(e.pointerId);
      drawing = true;
      points = [point(e)];
      interval = setInterval(() => {
        if (points.length > 1) flush();
      }, 50);
    };
    const move = (e: PointerEvent) => {
      if (tool === "pen" && card.hasPointerCapture(e.pointerId)) {
        points.push(point(e));
        if (points.length >= 32) flush();
      }
      if (tool === "laser" && Date.now() - lastLaser >= 50) {
        lastLaser = Date.now();
        const [x, y] = point(e);
        latest.current.send("laser", {
          questionId: latest.current.s.questionId,
          x,
          y,
        });
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
      if (tool === "highlight" || tool === "strike") {
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
            [x, y] = point(e);
          const stroke = latest.current.s.annotations?.find(
            (m) =>
              m.type === "stroke" &&
              m.points?.some(
                ([px, py]) =>
                  Math.hypot((px - x) * r.width, (py - y) * r.height) < 12,
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
    return () => {
      clearInterval(interval);
      card.removeEventListener("pointerdown", down);
      card.removeEventListener("pointermove", move);
      card.removeEventListener("pointerup", up);
      card.removeEventListener("pointercancel", up);
      card.style.cursor = "";
    };
  }, [card, tool, color, s.phase]);
  return (
    <>
      <div className="stage-heading">
        <span className="eyebrow">Question {s.index + 1}</span>
        <span>{s.questionId}</span>
        <Badge tone="green">
          <Check />
          Correct: {s.question?.answer || "Unavailable"}
        </Badge>
        {s.question?.section === "Math" && (
          <button
            id="live-desmos-toggle"
            aria-pressed={desmos}
            onClick={() => setDesmos(!desmos)}
          >
            <Calculator />
            Desmos
          </button>
        )}
      </div>
      {s.phase === "REVEALED" && (
        <div id="live-tools" role="toolbar" aria-label="Annotation tools">
          {Object.entries(tools).map(([key, Icon]) => (
            <button
              key={key}
              data-tool={key}
              title={labels[key as keyof typeof labels]}
              aria-label={labels[key as keyof typeof labels]}
              aria-pressed={tool === key}
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
          <div className="swatches">
            {colors.map((c) => (
              <button
                key={c}
                style={{ background: c }}
                aria-label={`Color ${c}`}
                aria-pressed={color === c}
                onClick={() => setColor(c)}
              />
            ))}
          </div>
        </div>
      )}
      <div className="instructor-content">
        <div id="live-stage">
          <Stage
            question={s.question!}
            number={s.index + 1}
            id="live-card"
            revealed
            marks={s.annotations}
            laser={laser}
            mathify={mathify}
            onReady={setCard}
          />
        </div>
        <details className="instructor-drawer">
          <summary>Instructor notes & explanation</summary>
          <h3>Official explanation</h3>
          <HTML
            html={
              s.question?.explanation_html || "<p>Explanation unavailable.</p>"
            }
          />
          <h3>My notes</h3>
          <HTML html={notesHTML(s.notes || "")} />
        </details>
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
