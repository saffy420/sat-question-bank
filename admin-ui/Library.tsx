import { useState } from "react";
import {
  BookOpen,
  Copy,
  Pencil,
  Play,
  Plus,
  Trash2,
  History,
  Clock,
} from "lucide-react";
import { api, formatTime, type LessonCard, type Session } from "./helpers";
import { Badge, Dialog, Empty, ErrorText, Pending, useResource } from "./ui";
import { SessionResults, averageText, localDate } from "./SessionResults";

export function Library({ navigate }: { navigate: (path: string) => void }) {
  const { data, error, retry } =
    useResource<LessonCard[]>("/api/admin/lessons");
  const [deleting, setDeleting] = useState<LessonCard>();
  const [mutation, setMutation] = useState("");
  const [working, setWorking] = useState(false);
  const [past, setPast] = useState<number>();
  if (!data) return <Pending error={error} retry={retry} />;
  return (
    <>
      <div className="page-actions">
        <p className="lede">A great lesson starts with the right questions.</p>
        <button
          id="new-lesson"
          className="primary"
          onClick={() => navigate("/admin/lessons/new")}
        >
          <Plus />
          New lesson
        </button>
      </div>
      <ErrorText>{mutation}</ErrorText>
      <div className="library">
        {data.map((l) => (
          <article key={l.id} className="panel lesson-card">
            <div className="card-art">
              <BookOpen />
              <Badge>{l.mode}</Badge>
            </div>
            <h2>{l.title}</h2>
            <div className="card-stats">
              <span>{l.questionCount} questions</span>
              <span>
                <Clock />
                {formatTime(l.totalSec)}
              </span>
            </div>
            <p className="muted">
              {l.timesRun} runs · Last run {l.lastRun || "never"}
            </p>
            <button
              className="primary start-session"
              data-start={l.id}
              onClick={() => navigate(`/admin/lessons/${l.id}/edit?start=1`)}
            >
              <Play />
              Start session
            </button>
            <div className="card-actions">
              <button
                data-edit={l.id}
                onClick={() => navigate(`/admin/lessons/${l.id}/edit`)}
              >
                <Pencil />
                Edit
              </button>
              <button
                data-copy={l.id}
                disabled={working}
                onClick={async () => {
                  setWorking(true);
                  try {
                    const copy = await api<LessonCard>(
                      `/api/admin/lessons/${l.id}/duplicate`,
                      "POST",
                    );
                    navigate(`/admin/lessons/${copy.id}/edit`);
                  } catch (e) {
                    setMutation((e as Error).message);
                  } finally {
                    setWorking(false);
                  }
                }}
              >
                <Copy />
                Duplicate
              </button>
              <button
                data-past={l.id}
                onClick={() => setPast(past === l.id ? undefined : l.id)}
              >
                <History />
                View past sessions
              </button>
              <button
                data-delete={l.id}
                onClick={() => {
                  setMutation("");
                  setDeleting(l);
                }}
              >
                <Trash2 />
                Delete
              </button>
            </div>
            {past === l.id && <PastSessions id={l.id} />}
          </article>
        ))}
      </div>
      {!data.length && <Empty>No lessons yet.</Empty>}
      {deleting && (
        <Dialog
          title={`Delete “${deleting.title}”?`}
          close={() => {
            if (!working) setDeleting(undefined);
          }}
        >
          <p>
            The lesson will leave your library. Past sessions, responses and
            reviews are kept.
          </p>
          <ErrorText>{mutation}</ErrorText>
          <div className="actions">
            <button disabled={working} onClick={() => setDeleting(undefined)}>
              Cancel
            </button>
            <button
              className="danger"
              disabled={working}
              onClick={async () => {
                setWorking(true);
                try {
                  await api(`/api/admin/lessons/${deleting.id}`, "DELETE");
                  setDeleting(undefined);
                  setMutation("");
                  retry();
                } catch (e) {
                  setMutation((e as Error).message);
                } finally {
                  setWorking(false);
                }
              }}
            >
              Delete lesson
            </button>
          </div>
        </Dialog>
      )}
    </>
  );
}
function PastSessions({ id }: { id: number }) {
  const { data, error, retry } = useResource<Session[]>(
    `/api/admin/lessons/${id}/sessions`,
  );
  const [open, setOpen] = useState<number>();
  return (
    <section id={`past-${id}`} className="past-sessions">
      <h3>Past sessions</h3>
      {!data ? (
        <Pending error={error} retry={retry} />
      ) : data.length ? (
        data.map((s) => {
          const line = [
            localDate(s.started_at || s.created_at),
            s.join_code,
            `${s.joined ?? 0} joined`,
            ...(s.average ? [`avg ${averageText(s.average)}`] : []),
          ].join(" · ");
          return s.status === "ended" ? (
            <button
              key={s.id}
              className="past-session"
              data-session={s.id}
              onClick={() => setOpen(s.id)}
            >
              <strong>Session {s.paddedId}</strong>
              <Badge>{s.status}</Badge>
              <span>{line}</span>
            </button>
          ) : (
            <div key={s.id} data-session={s.id}>
              <strong>Session {s.paddedId}</strong>
              <Badge>{s.status}</Badge>
              <p>{line}</p>
              <a href={`/admin/live/${s.id}`}>Open live room</a>
            </div>
          );
        })
      ) : (
        <Empty>No sessions yet.</Empty>
      )}
      {open != null && (
        <SessionResults id={open} close={() => setOpen(undefined)} />
      )}
    </section>
  );
}
