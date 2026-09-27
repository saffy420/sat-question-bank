import { useEffect, useRef, useState } from "react";
import { Check, ChevronLeft, ChevronRight, Plus, X } from "lucide-react";
import * as Renderer from "/shared/renderer.js";
import { rationaleHTML, type BankQuestion } from "./helpers";
import { Badge, HTML } from "./ui";

// Question body for the viewer's left pane: passage or figure, stem, then choices.
function questionHTML(q: BankQuestion) {
  const raw = q.stem_html || "";
  const at = q.section !== "Math" ? raw.indexOf("<h3>Prompt</h3>") : -1;
  const stem =
    at >= 0
      ? {
          context: Renderer.renderStem({ stem_html: raw.slice(0, at) }),
          body: Renderer.renderStem({ stem_html: raw.slice(at + 15) }),
        }
      : Renderer.splitContext(Renderer.renderStem(q), document);
  return `${stem.context ? `<div class="passage">${stem.context}</div>` : ""}<div class="qv-stem">${stem.body}</div>${
    q.spr
      ? '<p class="qv-spr">Student-produced response</p>'
      : `<div class="choices">${q.choices.map((c) => Renderer.choiceHTML(q, c, null, true)).join("")}</div>`
  }`;
}

const typing = (target: EventTarget | null) =>
  target instanceof HTMLElement &&
  (target.isContentEditable ||
    (["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName) &&
      (target as HTMLInputElement).type !== "checkbox"));

// College Board-style reviewer: question left, answer and rationale right, stepping through the
// current filtered result list. Shared by the lesson builder and the admin Question Bank.
export function QuestionViewer(props: {
  q: BankQuestion;
  position: number;
  total: number;
  loading?: boolean;
  hasPrev: boolean;
  hasNext: boolean;
  onPrev: () => void;
  onNext: () => void;
  close: () => void;
  added?: boolean;
  onAdd?: () => void;
  onRemove?: () => void;
}) {
  const { q, loading } = props;
  const ref = useRef<HTMLDialogElement>(null);
  const [reveal, setReveal] = useState(true);
  const latest = useRef(props);
  latest.current = props;
  useEffect(() => {
    const el = ref.current!,
      focus = document.activeElement as HTMLElement;
    el.showModal();
    // ←/→ step, A adds; Esc closes through the dialog's cancel event. On the document, not the
    // dialog: a focused Previous/Next that becomes disabled drops focus to <body>.
    const key = (e: KeyboardEvent) => {
      if (e.altKey || e.ctrlKey || e.metaKey || typing(e.target)) return;
      const p = latest.current;
      if (e.key === "ArrowLeft" && p.hasPrev && !p.loading) p.onPrev();
      else if (e.key === "ArrowRight" && p.hasNext && !p.loading) p.onNext();
      else if (e.key.toLowerCase() === "a" && p.onAdd && !p.added) p.onAdd();
      else return;
      e.preventDefault();
    };
    document.addEventListener("keydown", key);
    return () => {
      document.removeEventListener("keydown", key);
      el.close();
      focus?.focus();
    };
  }, []);
  // Each question starts at the top of both panes.
  useEffect(() => {
    ref.current
      ?.querySelectorAll(".qv-question, .qv-answer")
      .forEach((pane) => pane.scrollTo(0, 0));
  }, [q.id]);
  return (
    <dialog
      ref={ref}
      className="question-viewer"
      aria-label={`Question ${q.id}`}
      onCancel={(e) => {
        e.preventDefault();
        props.close();
      }}
    >
      <header>
        <div className="qv-title">
          <h2>Question {q.id}</h2>
          <Badge tone={q.difficulty.toLowerCase()}>{q.difficulty}</Badge>
          <span className="qv-skill">
            {q.domain}
            {q.skill && <> · {q.skill}</>}
          </span>
        </div>
        <button className="icon-button" aria-label="Close" onClick={props.close}>
          <X />
        </button>
      </header>
      <div className="qv-body" aria-busy={loading || undefined}>
        <section className="qv-question" aria-label="Question">
          <HTML className="question-preview" html={questionHTML(q)} />
        </section>
        <section className="qv-answer" aria-label="Answer and rationale">
          {reveal ? (
            <>
              <h3>Answer</h3>
              <p className="qv-correct">
                {q.answer
                  ? `The correct answer is ${q.answer}.`
                  : "Correct answer unavailable."}
              </p>
              <h3>Rationale</h3>
              <HTML
                className="qv-rationale"
                html={rationaleHTML(
                  q.explanation_html || "<p>Explanation unavailable.</p>",
                )}
              />
            </>
          ) : (
            <p className="qv-hidden">
              Answer and explanation hidden. Turn on “Show correct answer and
              explanation” to see them.
            </p>
          )}
        </section>
      </div>
      <footer>
        <label className="toggle qv-toggle">
          <input
            id="qv-reveal"
            type="checkbox"
            checked={reveal}
            onChange={(e) => setReveal(e.target.checked)}
          />
          Show correct answer and explanation
        </label>
        <span className="qv-position" role="status">
          {loading ? "Loading…" : `${props.position} of ${props.total}`}
        </span>
        <div className="qv-actions">
          <button
            id="qv-prev"
            disabled={!props.hasPrev || loading}
            onClick={props.onPrev}
          >
            <ChevronLeft />
            Previous
          </button>
          <button
            id="qv-next"
            disabled={!props.hasNext || loading}
            onClick={props.onNext}
          >
            Next
            <ChevronRight />
          </button>
          {props.onAdd &&
            (props.added ? (
              <span className="qv-added-group">
                <span className="qv-added" id="qv-added">
                  <Check />
                  Added
                </span>
                <button id="qv-remove" onClick={props.onRemove}>
                  Remove
                </button>
              </span>
            ) : (
              <button
                id="qv-add"
                className="primary"
                disabled={loading}
                onClick={props.onAdd}
                aria-keyshortcuts="A"
              >
                <Plus />
                Add to lesson
              </button>
            ))}
        </div>
      </footer>
    </dialog>
  );
}
