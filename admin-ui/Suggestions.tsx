import { useState } from "react";
import { Check, X } from "lucide-react";
import { api } from "./helpers";
import { Badge, Empty, ErrorText, Pending, useResource } from "./ui";

type Suggestion = {
  id: number;
  user_id: string | null;
  is_anonymous: number;
  name: string | null;
  email: string | null;
  area: string | null;
  category: "teaching" | "app" | "other";
  session_id: number | null;
  body: string;
  status: "new" | "done" | "dismissed";
  created_at: string;
};
const AREA: Record<string, string> = { bank: "Question bank", lessons: "Lessons", plan: "Study plan", other: "Other" };
const categories = ["all", "teaching", "app", "other"] as const;
const CATEGORY = { all: "All", teaching: "Teaching", app: "App", other: "Other" };

export function Suggestions() {
  const [all, setAll] = useState(false);
  const [category, setCategory] = useState<(typeof categories)[number]>("all");
  const [error, setError] = useState("");
  const params = new URLSearchParams();
  if (category !== "all") params.set("category", category);
  if (all) params.set("status", "all");
  const { data, error: loadError, retry } = useResource<{ suggestions: Suggestion[] }>(`/api/admin/suggestions${params.size ? `?${params}` : ""}`);
  const mark = async (id: number, status: Suggestion["status"]) => {
    setError("");
    try {
      await api(`/api/admin/suggestions/${id}`, "POST", { status });
      retry();
    } catch (e) {
      setError((e as Error).message);
    }
  };
  return (
    <>
      <p className="lede">Feature ideas and lesson feedback from students, newest first.</p>
      <div className="suggestion-controls">
        <div className="tabs" role="tablist" aria-label="Suggestion category">
          {categories.map((c) => (
            <button
              id={`suggestion-tab-${c}`}
              key={c}
              role="tab"
              data-tab={c}
              aria-selected={category === c}
              aria-controls="suggestion-content"
              tabIndex={category === c ? 0 : -1}
              onKeyDown={(e) => {
                if (["ArrowLeft", "ArrowRight"].includes(e.key)) {
                  e.preventDefault();
                  const next = categories[(categories.indexOf(c) + (e.key === "ArrowRight" ? 1 : categories.length - 1)) % categories.length];
                  setCategory(next);
                  document.getElementById(`suggestion-tab-${next}`)?.focus();
                }
              }}
              onClick={() => setCategory(c)}
            >
              {CATEGORY[c]}
            </button>
          ))}
        </div>
        <label className="suggestion-filter">
          <input id="show-handled" type="checkbox" checked={all} onChange={(e) => setAll(e.target.checked)} /> Show done and dismissed
        </label>
      </div>
      <ErrorText>{error}</ErrorText>
      <div id="suggestion-content" role="tabpanel" aria-labelledby={`suggestion-tab-${category}`}>
        {!data ? (
          <Pending error={loadError} retry={retry} />
        ) : data.suggestions.length === 0 ? (
          <div className="panel">
            <Empty>{all ? "No suggestions yet." : "No new suggestions."}</Empty>
          </div>
        ) : (
          <ul className="suggestion-list">
            {data.suggestions.map((s) => (
              <li key={s.id} className="panel suggestion" data-suggestion={s.id} data-status={s.status} data-category={s.category}>
                <div className="suggestion-meta">
                  <Badge tone="blue">{CATEGORY[s.category]}</Badge>
                  {s.area && <span className="suggestion-area">{AREA[s.area] || s.area}</span>}
                  {!s.is_anonymous && s.session_id != null && <span className="muted">Lesson {String(s.session_id).padStart(5, "0")}</span>}
                  {s.status !== "new" && <Badge tone={s.status === "done" ? "green" : ""}>{s.status === "done" ? "Done" : "Dismissed"}</Badge>}
                  <span className="muted">
                    {s.is_anonymous ? "Anonymous" : s.name || s.email || s.user_id} · {/^\d{4}-\d{2}-\d{2}$/.test(s.created_at) ? new Date(`${s.created_at}T00:00:00`).toLocaleDateString() : s.created_at}
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
      </div>
    </>
  );
}
