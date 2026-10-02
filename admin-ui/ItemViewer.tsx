import { useEffect, useRef, useState } from "react";
import { Check, ChevronLeft, ChevronRight, Trash2, X } from "lucide-react";
import {
  defaultTime,
  formatTime,
  notesHTML,
  parseTime,
  rationaleHTML,
  type BankQuestion,
  type Item,
} from "./helpers";
import { notesSnippet } from "./itemLabel.ts";
import { questionHTML, typing } from "./QuestionViewer";
import { Badge, HTML } from "./ui";

const CHIPS: [number, string][] = [
  [30, "30s"],
  [45, "45s"],
  [60, "1m"],
  [90, "1m30"],
  [120, "2m"],
  [180, "3m"],
];

// Lesson-item pop-up: the question on the left; the lesson's own outline, time limit and notes
// on the right. Previous/Next walk the lesson's items, not the bank's.
export function ItemViewer(props: {
  items: Item[];
  index: number;
  questions: Record<string, BankQuestion>;
  setIndex: (n: number) => void;
  edit: (part: Partial<Item>) => void;
  remove: () => void;
  close: () => void;
}) {
  const { items, index, questions } = props;
  const item = items[index];
  const q = item && questions[item.question_id];
  const ref = useRef<HTMLDialogElement>(null);
  const [reveal, setReveal] = useState(false);
  const [custom, setCustom] = useState(formatTime(item?.time_limit_sec ?? 0));
  const [timeError, setTimeError] = useState("");
  const latest = useRef(props);
  latest.current = props;
  useEffect(() => {
    const el = ref.current!,
      focus = document.activeElement as HTMLElement;
    el.showModal();
    // On the document, not the dialog: a focused Previous/Next that becomes disabled drops focus.
    const key = (e: KeyboardEvent) => {
      if (e.altKey || e.ctrlKey || e.metaKey || typing(e.target)) return;
      const p = latest.current;
      if (e.key === "ArrowLeft" && p.index > 0) p.setIndex(p.index - 1);
      else if (e.key === "ArrowRight" && p.index < p.items.length - 1)
        p.setIndex(p.index + 1);
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
  // A new item resets the draft time, the error and both panes' scroll, and brings its outline row into view.
  useEffect(() => {
    setCustom(formatTime(item?.time_limit_sec ?? 0));
    setTimeError("");
    const el = ref.current;
    el?.querySelectorAll(".qv-question").forEach((pane) => pane.scrollTo(0, 0));
    el?.querySelector('[aria-current="true"]')?.scrollIntoView({ block: "nearest" });
  }, [item?.question_id]);
  if (!item) return null;
  const commit = () => {
    const n = parseTime(custom);
    if (n == null) setTimeError("Use mm:ss (5 seconds to 180 minutes)");
    else {
      props.edit({ time_limit_sec: n });
      setTimeError("");
    }
  };
  return (
    <dialog
      ref={ref}
      className="question-viewer item-viewer"
      aria-label={`Lesson question ${index + 1}`}
      onCancel={(e) => {
        e.preventDefault();
        props.close();
      }}
    >
      <header>
        <div className="qv-title">
          <h2>Question {index + 1}</h2>
          {q && (
            <>
              <Badge tone={q.difficulty.toLowerCase()}>{q.difficulty}</Badge>
              <span className="qv-skill">
                {q.domain}
                {q.skill && <> · {q.skill}</>}
              </span>
            </>
          )}
          <span className="qv-skill">{item.question_id}</span>
        </div>
        <button className="icon-button" aria-label="Close" onClick={props.close}>
          <X />
        </button>
      </header>
      <div className="qv-body iv-body" aria-busy={!q || undefined}>
        <section className="qv-question" aria-label="Question">
          {q ? (
            <>
              <HTML className="question-preview" html={questionHTML(q)} />
              <label className="toggle qv-toggle iv-reveal">
                <input
                  id="iv-reveal"
                  type="checkbox"
                  checked={reveal}
                  onChange={(e) => setReveal(e.target.checked)}
                />
                Show answer & explanation
              </label>
              {reveal && (
                <div className="iv-answer">
                  <p className="qv-correct">
                    {q.answer
                      ? `The correct answer is ${q.answer}.`
                      : "Correct answer unavailable."}
                  </p>
                  <HTML
                    className="qv-rationale"
                    html={rationaleHTML(
                      q.explanation_html || "<p>Explanation unavailable.</p>",
                    )}
                  />
                </div>
              )}
            </>
          ) : (
            <p>Loading question…</p>
          )}
        </section>
        <aside className="iv-side" aria-label="Lesson outline and settings">
          <h3>Lesson outline</h3>
          <ol className="iv-outline">
            {items.map((i, n) => {
              const oq = questions[i.question_id];
              return (
                <li key={i.question_id}>
                  <button
                    data-outline={n}
                    title={i.question_id}
                    aria-current={n === index ? "true" : undefined}
                    onClick={() => props.setIndex(n)}
                  >
                    <span className="iv-row-top">
                      <strong>
                        {n + 1} · {oq?.skill || "…"}
                      </strong>
                      {oq && (
                        <Badge tone={oq.difficulty.toLowerCase()}>
                          {oq.difficulty}
                        </Badge>
                      )}
                      <small>{formatTime(i.time_limit_sec)}</small>
                    </span>
                    <span className="iv-snippet">{notesSnippet(i.notes)}</span>
                  </button>
                </li>
              );
            })}
          </ol>
          <h3>Time limit</h3>
          <div className="time-chips">
            {CHIPS.map(([sec, label]) => (
              <button
                data-time={sec}
                key={sec}
                aria-pressed={item.time_limit_sec === sec}
                onClick={() => props.edit({ time_limit_sec: sec })}
              >
                {label}
              </button>
            ))}
            {q && (
              <button
                id="recommended-time"
                aria-pressed={item.time_limit_sec === defaultTime(q)}
                onClick={() => props.edit({ time_limit_sec: defaultTime(q) })}
              >
                Recommended {formatTime(defaultTime(q))}
              </button>
            )}
          </div>
          <label>
            Custom mm:ss
            <input
              id="custom-time"
              value={custom}
              inputMode="numeric"
              onChange={(e) => setCustom(e.target.value)}
              onBlur={commit}
              onKeyDown={(e) => e.key === "Enter" && commit()}
            />
          </label>
          <p id="time-error" className="error" role="alert">
            {timeError}
          </p>
          <label>
            Notes (you see these during the lesson; students see them as the
            breakdown when reviewing afterwards).
            <textarea
              id="lesson-notes"
              maxLength={4000}
              value={item.notes}
              onChange={(e) => props.edit({ notes: e.target.value })}
            />
          </label>
          <h4>Notes preview</h4>
          <HTML id="notes-preview" html={notesHTML(item.notes)} />
        </aside>
      </div>
      <footer>
        <button id="iv-remove" onClick={props.remove}>
          <Trash2 />
          Remove from lesson
        </button>
        <span className="qv-position" role="status">
          Question {index + 1} of {items.length}
        </span>
        <div className="qv-actions">
          <button
            id="iv-prev"
            disabled={index === 0}
            onClick={() => props.setIndex(index - 1)}
          >
            <ChevronLeft />
            Previous
          </button>
          <button
            id="iv-next"
            disabled={index >= items.length - 1}
            onClick={() => props.setIndex(index + 1)}
          >
            Next
            <ChevronRight />
          </button>
          <button id="close-editor" onClick={props.close}>
            <Check />
            Close
          </button>
        </div>
      </footer>
    </dialog>
  );
}
