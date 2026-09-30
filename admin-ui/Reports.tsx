import { useState } from "react";
import { Check, X } from "lucide-react";
import { api, type BankQuestion } from "./helpers";
import { Badge, Empty, ErrorText, Pending, Preview, useResource } from "./ui";

type Report = {
  id: number;
  user_id: string;
  name: string | null;
  email: string | null;
  category: string;
  note: string;
  seen_in: string;
  created_at: string;
  context: { viewport?: { w: number; h: number }; zoom?: number | null; dpr?: number | null; session_id?: number | null };
};
type Item = {
  id: number;
  kind: "fix" | "escalation";
  reason: string;
  called: boolean;
  createdAt: string;
  after: BankQuestion | null;
  changed: string[];
  rejected: string[];
};
type Group = {
  questionId: string;
  state: "fix" | "escalation" | "awaiting";
  question: BankQuestion | null;
  items: Item[];
  reports: Report[];
};
type Data = { groups: Group[]; usage: { calls: number; cap: number } };

const CATEGORY: Record<string, string> = {
  formatting: "Formatting / display",
  wrong_answer: "Wrong answer or explanation",
  typo: "Typo",
  other: "Other",
};
const SEEN: Record<string, string> = { bank: "Question bank", lesson: "Lesson", history: "Lesson history" };
const STATE: Record<Group["state"], [string, string]> = {
  fix: ["Fix proposed", "green"],
  escalation: ["Needs a person", "red"],
  awaiting: ["Waiting for triage", ""],
};

// What the student saw, for the reporter row: the rendered HTML is loaded only when asked for.
function Seen({ id }: { id: number }) {
  const [html, setHtml] = useState<string>();
  const [error, setError] = useState("");
  return (
    <details
      onToggle={(e) => {
        if ((e.currentTarget as HTMLDetailsElement).open && html === undefined)
          api<{ html: string }>(`/api/admin/reports/${id}/html`).then((r) => setHtml(r.html), (x) => setError(x.message));
      }}
    >
      <summary>What they saw (HTML)</summary>
      {error ? <ErrorText>{error}</ErrorText> : <pre className="report-html">{html ?? "Loading…"}</pre>}
    </details>
  );
}

function GroupCard({ group, done }: { group: Group; done: () => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const decide = async (decision: "approve" | "reject", triage_id?: number) => {
    setBusy(true);
    setError("");
    try {
      await api("/api/admin/reports/decision", "POST", { question_id: group.questionId, decision, triage_id });
      done();
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  };
  const [label, tone] = STATE[group.state];
  const q = group.question;
  const fix = group.items.find((i) => i.kind === "fix");
  return (
    <article className="panel report-group" data-question={group.questionId} data-state={group.state}>
      <header className="report-head">
        <h2 className="mono">{group.questionId}</h2>
        <Badge tone={tone}>{label}</Badge>
        {q && <Badge>{q.difficulty}</Badge>}
        {q && <span className="muted">{q.skill}</span>}
        <span className="muted report-count">
          {group.reports.length} open report{group.reports.length === 1 ? "" : "s"}
        </span>
      </header>
      <ul className="report-list">
        {group.reports.map((r) => (
          <li key={r.id} data-report={r.id}>
            <div>
              <Badge>{CATEGORY[r.category] || r.category}</Badge> <span className="muted">
                {r.name || r.email || r.user_id} · {SEEN[r.seen_in] || r.seen_in}
                {r.context.session_id ? ` (lesson ${String(r.context.session_id).padStart(5, "0")})` : ""} · {r.created_at}
                {r.context.viewport ? ` · ${r.context.viewport.w}×${r.context.viewport.h}` : ""}
                {r.context.zoom ? ` · zoom ${r.context.zoom}` : ""}
              </span>
            </div>
            {r.note && <p className="report-note">{r.note}</p>}
            <Seen id={r.id} />
          </li>
        ))}
      </ul>
      {group.items.map((item) => (
        <section key={item.id} className="report-item" data-kind={item.kind}>
          <p>
            <strong>{item.kind === "fix" ? "Proposed fix" : "Escalation"}:</strong> {item.reason}
          </p>
          {item.rejected.length > 0 && <p className="muted">Rejected patch touched: {item.rejected.join(", ")}.</p>}
          {item.kind === "fix" && q && item.after && (
            <>
              <p className="muted">Changes {item.changed.join(", ")}. Both sides use the real question renderer.</p>
              <div className="report-diff">
                <div data-side="before">
                  <h3>Before</h3>
                  <Preview q={q} />
                </div>
                <div data-side="after">
                  <h3>After</h3>
                  <Preview q={item.after} />
                </div>
              </div>
            </>
          )}
        </section>
      ))}
      {group.state === "escalation" && q && (
        <details className="report-current">
          <summary>Question as stored</summary>
          <Preview q={q} />
        </details>
      )}
      {group.state === "awaiting" && <p className="muted">One AI check per question per 24 hours: these reports go into the next one.</p>}
      <ErrorText>{error}</ErrorText>
      <div className="report-actions">
        {fix && (
          <button className="primary" data-approve={fix.id} disabled={busy} onClick={() => decide("approve", fix.id)}>
            <Check />
            Approve fix, close {group.reports.length} report{group.reports.length === 1 ? "" : "s"}
          </button>
        )}
        <button data-reject={group.questionId} disabled={busy} onClick={() => decide("reject")}>
          <X />
          {fix ? "Reject" : "Close reports"}
        </button>
      </div>
    </article>
  );
}

export function Reports() {
  const { data, error, retry } = useResource<Data>("/api/admin/reports");
  if (!data) return <Pending error={error} retry={retry} />;
  return (
    <>
      <p className="lede">
        Student reports grouped by question. Fixes are never applied on their own: Approve writes the question. AI checks this month: {data.usage.calls} of {data.usage.cap}.
      </p>
      {data.groups.length === 0 ? (
        <div className="panel">
          <Empty>No open reports.</Empty>
        </div>
      ) : (
        <div className="report-groups">
          {data.groups.map((g) => (
            <GroupCard key={g.questionId} group={g} done={retry} />
          ))}
        </div>
      )}
    </>
  );
}
