import { useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  BookOpen,
  Check,
  CircleHelp,
  ExternalLink,
  LibraryBig,
  PanelLeftClose,
  PanelLeftOpen,
  Radio,
  Users,
  X,
} from "lucide-react";
import { Builder, QuestionBrowser, type Guard } from "./Builder";
import { Library } from "./Library";
import { Live, LiveRooms } from "./Live";
import { Students } from "./Students";
import { api } from "./helpers";
import lessonStyles from "../lesson-ui/lesson.css?inline";
import adminStyles from "./admin.css?inline";

const style = document.createElement("style");
style.textContent = lessonStyles + "\n" + adminStyles;
document.head.append(style);
function App() {
  const [path, setPath] = useState(location.pathname + location.search);
  const [collapsed, setCollapsed] = useState(false);
  const guard: Guard = useRef(null);
  const navigate = (next: string) => {
    const go = () => {
      history.replaceState(null, "", next);
      setPath(next);
    };
    if (guard.current) guard.current(go);
    else go();
  };
  useEffect(() => {
    const pop = () => setPath(location.pathname + location.search);
    window.addEventListener("popstate", pop);
    return () => window.removeEventListener("popstate", pop);
  }, []);
  const editor = /^\/admin\/lessons\/(new|\d+\/edit)/.exec(path);
  const live = /^\/admin\/live\/([1-9]\d{0,8})$/.exec(path);
  const section = path.includes("/lessons")
    ? "Lessons"
    : path.includes("/live")
      ? "Live"
      : path.includes("/questions")
        ? "Question Bank"
        : "Students";
  useEffect(() => {
    document.title = `${section} · SAT Club`;
  }, [section]);
  return (
    <div className={`admin-shell ${collapsed ? "sidebar-collapsed" : ""}`}>
      <aside id="side" className={collapsed ? "collapsed" : ""}>
        <div className="brand">
          <BookOpen />
          <span className="label">
            SAT Club<small>Teaching workspace</small>
          </span>
        </div>
        <button
          id="collapse"
          className="collapse"
          aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          aria-expanded={!collapsed}
          onClick={() => setCollapsed(!collapsed)}
        >
          {collapsed ? <PanelLeftOpen /> : <PanelLeftClose />}
          <span className="label">Collapse sidebar</span>
        </button>
        <nav aria-label="Admin navigation">
          {[
            ["Students", "/admin", Users],
            ["Lessons", "/admin/lessons", LibraryBig],
            ["Live", "/admin/live", Radio],
            ["Question Bank", "/admin/questions", CircleHelp],
          ].map(([name, url, Icon]) => {
            const I = Icon as typeof Users;
            return (
              <button
                key={String(name)}
                data-section={name}
                title={String(name)}
                aria-current={section === name ? "page" : undefined}
                onClick={() => navigate(String(url))}
              >
                <I />
                <span className="label">{String(name)}</span>
              </button>
            );
          })}
        </nav>
        <a
          className="student-app"
          href="/app"
          onClick={(e) => {
            if (guard.current) {
              e.preventDefault();
              guard.current(() => location.assign("/app"));
            }
          }}
        >
          <ExternalLink />
          <span className="label">Student app</span>
        </a>
      </aside>
      <main>
        <SyncBanner path={path} />
        {!live && (
          <header className="page-header">
            <div>
              <span className="eyebrow">Instructor workspace</span>
              <h1 id="title">{editor ? "Lesson builder" : section}</h1>
            </div>
            <BadgeLabel />
          </header>
        )}
        <div id="body">
          {editor ? (
            <Builder
              key={path.split("?")[0]}
              id={editor[1] === "new" ? undefined : editor[1].split("/")[0]}
              start={path.includes("start=1")}
              guard={guard}
              navigate={navigate}
            />
          ) : live ? (
            <Live key={live[1]} id={live[1]} />
          ) : section === "Live" ? (
            <LiveRooms />
          ) : section === "Lessons" ? (
            <Library navigate={navigate} />
          ) : section === "Question Bank" ? (
            <div className="bank">
              <QuestionBrowser />
            </div>
          ) : (
            <Students />
          )}
        </div>
      </main>
      <span id="lesson-check-icon" hidden>
        <Check />
      </span>
      <span id="lesson-x-icon" hidden>
        <X />
      </span>
    </div>
  );
}
// A lesson room is holding results D1 refused (daily limit or overload) and will retry
// (src/lesson-room.js flushFailed). Checked on load, on navigation and every 5 minutes.
function SyncBanner({ path }: { path: string }) {
  const [at, setAt] = useState<number | null>(null);
  useEffect(() => {
    let alive = true;
    const check = () =>
      api<{ pending: { at: number }[] }>("/api/admin/lesson-sync")
        .then((r) => alive && setAt(r.pending.length ? Math.max(...r.pending.map((x) => x.at)) : null))
        .catch(() => {});
    check();
    const timer = setInterval(check, 300000);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [path]);
  if (at === null) return null;
  const when = new Date(at).toLocaleString([], { weekday: "short", hour: "numeric", minute: "2-digit" });
  return (
    <div className="sync-banner" role="status">
      Lesson results saved locally, will sync after {when}.
    </div>
  );
}
function BadgeLabel() {
  return (
    <span className="workspace-label">
      <span />
      Admin
    </span>
  );
}
createRoot(document.getElementById("admin-root")!).render(<App />);
