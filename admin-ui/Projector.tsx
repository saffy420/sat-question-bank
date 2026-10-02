import { useEffect, useRef, useState } from "react";
import { Expand, Users } from "lucide-react";
import { mountLesson } from "../lesson-ui/index";
import type { Bridge, Laser, Mark, Snapshot } from "../lesson-ui/types";
import { formatTime, mathify } from "./helpers";

// The classroom projector window (opened from the live room's Projector button). It holds its own
// read-only socket (`?view=projector`, src/lesson-room.js): the student projection with nobody's
// answer in it, plus the join code. The presenter's own socket and dashboard are untouched.
type View = Omit<Snapshot, "poll"> & {
  code: string;
  lockedJoin: boolean;
  // Self-paced status (class-wide counts only).
  takers?: number;
  submittedCount?: number;
  poll?: { endsAt: number; choices: { questionId: string; number: number }[] };
};

// The projector only shows: nothing it could press reaches the room.
const noop = () => {};
const bridge: Bridge = { select: noop, lock: noop, leave: noop, mathify, report: noop, suggest: noop };
const HOST = "roadto1600.org";

export function Projector({ id }: { id: string }) {
  const [s, setState] = useState<View>();
  const [connected, setConnected] = useState(false);
  const [ended, setEnded] = useState("");
  const [now, setNow] = useState(Date.now());
  const [full, setFull] = useState(false);
  const offset = useRef(0);
  const stage = useRef<HTMLDivElement>(null);
  const player = useRef<ReturnType<typeof mountLesson> | null>(null);
  const pending = useRef<{ annotate?: Mark; laser?: Laser }>({});
  useEffect(() => {
    document.title = "Projector · SAT Club";
    const change = () => setFull(!!document.fullscreenElement);
    document.addEventListener("fullscreenchange", change);
    return () => document.removeEventListener("fullscreenchange", change);
  }, []);
  useEffect(() => {
    let alive = true,
      best = Infinity,
      tries = 0,
      socket: WebSocket | null = null,
      retry: ReturnType<typeof setTimeout>;
    const send = (m: object) => {
      if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify(m));
    };
    const connect = () => {
      if (!alive) return;
      const ws = new WebSocket(
        `${location.protocol === "https:" ? "wss:" : "ws:"}//${location.host}/api/lessons/${id}/ws?view=projector`,
      );
      socket = ws;
      ws.onopen = () => {
        if (!alive) return;
        tries = 0;
        setConnected(true);
        send({ type: "ping", sentAt: Date.now() });
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
          if (m.status === "ended" || m.phase === "ENDED") setEnded("Session ended");
          setState((old) =>
            // Throttled count refreshes leave question bodies out; keep the one on screen.
            old && old.questionId === m.questionId && !m.question && old.question ? { ...m, question: old.question } : m,
          );
        } else if (m.type === "eliminations")
          setState((old) => (old && old.questionId === m.questionId ? { ...old, eliminations: m.letters } : old));
        else if (m.type === "desmos")
          setState((old) => (old && old.questionId === m.questionId ? { ...old, desmos: m.state } : old));
        else if (m.type === "annotate") {
          setState((old) =>
            !old || old.questionId !== m.questionId
              ? old
              : {
                  ...old,
                  annotations:
                    m.op.type === "clear"
                      ? []
                      : m.op.type === "erase"
                        ? (old.annotations || []).filter((x) => x.id !== m.op.id)
                        : [...(old.annotations || []), m.op],
                },
          );
          pending.current.annotate = m.op;
        } else if (m.type === "laser") {
          if (player.current) player.current.laser(m);
        }
      };
      ws.onclose = (e) => {
        if (!alive || socket !== ws) return;
        setConnected(false);
        if (e.code === 4001) {
          setEnded("The projector was opened in another window.");
          return;
        }
        // An ended (or deleted) session refuses the socket: ask once why before retrying.
        fetch(`/api/lessons/${id}`)
          .then((r) => {
            if (!alive) return;
            if (r.status === 410 || r.status === 404) setEnded("Session ended");
            else retry = setTimeout(connect, Math.min(15000, 1000 * 2 ** tries++));
          })
          .catch(() => {
            if (alive) retry = setTimeout(connect, Math.min(15000, 1000 * 2 ** tries++));
          });
      };
    };
    connect();
    const clock = setInterval(() => {
      setNow(Date.now());
      send({ type: "ping", sentAt: Date.now() });
    }, 1000);
    const tick = setInterval(() => setNow(Date.now()), 250);
    return () => {
      alive = false;
      clearTimeout(retry);
      clearInterval(clock);
      clearInterval(tick);
      socket?.close(1000);
    };
  }, [id]);
  // The student Player draws the question, ink, laser, eliminations, graph and reveal.
  const question = !!s && !ended && s.status !== "lobby" && (s.mode !== "self" || !!s.reviewMode);
  useEffect(() => {
    if (!question || !stage.current) return;
    const view = mountLesson(stage.current, bridge);
    player.current = view;
    return () => {
      player.current = null;
      view.destroy();
    };
  }, [question]);
  useEffect(() => {
    if (!question || !s || !player.current) return;
    player.current.update({
      snapshot: s as Snapshot,
      picked: "",
      lockPending: false,
      remaining: s.endsAt ? Math.max(0, s.endsAt - now - offset.current) : 0,
      connected: true,
      name: "",
    });
    const mark = pending.current.annotate;
    pending.current.annotate = undefined;
    if (mark) player.current.annotate(mark);
  });
  const left = (end?: number | null) => (end ? formatTime(Math.ceil(Math.max(0, end - now - offset.current) / 1000)) : "—");
  const joinLine = (
    <p className="projector-join-line">
      Join at <strong>{HOST}</strong> → <strong>Join lesson</strong>
    </p>
  );
  const students = (n: number) => `${n} ${n === 1 ? "student" : "students"} joined`;
  let card = null;
  if (ended) card = <section className="projector-card projector-ended" role="status"><h1>{ended}</h1></section>;
  else if (!s) card = <section className="projector-card" role="status"><p>Connecting…</p></section>;
  else if (s.status === "lobby")
    card = (
      <section className="projector-card projector-lobby">
        <span className="projector-title">{s.title}</span>
        {joinLine}
        <strong id="projector-code" className="projector-code" aria-label={`Join code ${s.code.split("").join(" ")}`}>
          {s.code}
        </strong>
        <p id="projector-count" className="projector-count">
          <Users aria-hidden="true" />
          {students(s.count)}
        </p>
        <p className="projector-wait">{s.lockedJoin ? "Joining is locked." : "Waiting for the instructor to start"}</p>
      </section>
    );
  else if (s.mode === "self" && !s.reviewMode)
    card = (
      <section className="projector-card projector-status">
        <span className="projector-title">{s.title}</span>
        {s.poll ? (
          <>
            <h1>Vote: which question should we review?</h1>
            <p className="projector-big">{left(s.poll.endsAt)}</p>
            <p>Questions {s.poll.choices.map((c) => `Q${c.number}`).join(" · ")}</p>
          </>
        ) : s.pollResult ? (
          <>
            <h1>Reviewing question {s.pollResult.number}</h1>
            <p>
              {s.pollResult.one} voted to review the most-missed question · {s.pollResult.two} picked their own
            </p>
          </>
        ) : s.status === "live" ? (
          <>
            <h1>Working on the set</h1>
            <p id="projector-remaining" className="projector-big">{left(s.endsAt)}</p>
            <p id="projector-submitted">
              Submitted {s.submittedCount ?? 0} of {s.takers ?? 0}
            </p>
          </>
        ) : (
          <>
            <h1>Set finished</h1>
            <p id="projector-submitted">
              Submitted {s.submittedCount ?? 0} of {s.takers ?? 0}
            </p>
            <p className="projector-wait">Review starts soon</p>
          </>
        )}
      </section>
    );
  return (
    <div className="projector">
      <div id="lesson-live" className="projector-live" inert>
        {question ? <div ref={stage} id="lesson-content" /> : <div className="projector-screen">{card}</div>}
      </div>
      {s && !ended && s.status !== "lobby" && (
        <div id="projector-badge" className={`projector-badge${s.lockedJoin ? " locked" : ""}`} aria-label={`Join at ${HOST}, code ${s.code}`}>
          <span>{HOST}</span>
          <strong>{s.code}</strong>
        </div>
      )}
      {!connected && !ended && s && (
        <div className="projector-reconnect" role="status">
          Reconnecting…
        </div>
      )}
      {!full && (
        <button
          id="projector-fullscreen"
          className="projector-fullscreen"
          onClick={() => document.documentElement.requestFullscreen?.().catch(() => {})}
        >
          <Expand aria-hidden="true" />
          Fullscreen
        </button>
      )}
    </div>
  );
}
