import { useState } from "react";
import { Check, X } from "lucide-react";
import { api } from "./helpers";
import { Badge, Empty, ErrorText, Pending, useResource } from "./ui";

type Suggestion = {
  id: number;
  user_id: string;
  name: string | null;
  email: string | null;
  area: string | null;
  body: string;
  status: "new" | "done" | "dismissed";
  created_at: string;
};
const AREA: Record<string, string> = { bank: "Question bank", lessons: "Lessons", plan: "Study plan", other: "Other" };

export function Suggestions() {
  const [all, setAll] = useState(false);
  const [error, setError] = useState("");
  const { data, error: loadError, retry } = useResource<{ suggestions: Suggestion[] }>(`/api/admin/suggestions${all ? "?status=all" : ""}`);
  const mark = async (id: number, status: Suggestion["status"]) => {
    setError("");
    try {
      await api(`/api/admin/suggestions/${id}`, "POST", { status });
      retry();
    } catch (e) {
      setError((e as Error).message);
    }
  };
  if (!data) return <Pending error={loadError} retry={retry} />;
  return (
    <>
      <div className="page-actions">
        <p className="lede">Feature ideas from students, newest first.</p>
        <label className="suggestion-filter">
          <input id="show-handled" type="checkbox" checked={all} onChange={(e) => setAll(e.target.checked)} /> Show done and dismissed
        </label>
      </div>
      <ErrorText>{error}</ErrorText>
      {data.suggestions.length === 0 ? (
        <div className="panel">
          <Empty>{all ? "No suggestions yet." : "No new suggestions."}</Empty>
        </div>
      ) : (
        <ul className="suggestion-list">
          {data.suggestions.map((s) => (
            <li key={s.id} className="panel suggestion" data-suggestion={s.id} data-status={s.status}>
              <div className="suggestion-meta">
                {s.area && <Badge>{AREA[s.area] || s.area}</Badge>}
                {s.status !== "new" && <Badge tone={s.status === "done" ? "green" : ""}>{s.status === "done" ? "Done" : "Dismissed"}</Badge>}
                <span className="muted">
                  {s.name || s.email || s.user_id} · {s.created_at}
                </span>
              </div>
              <p className="suggestion-body">{s.body}</p>
              <div className="report-actions">
                {s.status === "new" ? (
                  <>
                    <button className="primary" data-done={s.id} onClick={() => mark(s.id, "done")}>
                      <Check />
                      Mark done
                    </button>
                    <button data-dismiss={s.id} onClick={() => mark(s.id, "dismissed")}>
                      <X />
                      Dismiss
                    </button>
                  </>
                ) : (
                  <button data-reopen={s.id} onClick={() => mark(s.id, "new")}>
                    Reopen
                  </button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
