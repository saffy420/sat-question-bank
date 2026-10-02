import { targetOf } from "../public/shared/stats.js";
import type { Question } from "../lesson-ui/types";
export type BankQuestion = Question & {
  domain: string;
  skill: string;
  difficulty: string;
  usedInLesson: string[];
};
export type Item = {
  question_id: string;
  time_limit_sec: number;
  notes: string;
};
export type Lesson = {
  id?: number;
  title: string;
  mode: string;
  items: Item[];
};
export type LessonCard = Lesson & {
  id: number;
  questionCount: number;
  totalSec: number;
  timesRun: number;
  lastRun: string | null;
};
export type Session = {
  id: number;
  paddedId: string;
  status: string;
  created_at: string;
  started_at?: string | null;
  join_code: string;
  // Past sessions row (GET /api/admin/lessons/:id/sessions).
  joined?: number;
  average?: { right: number; scorable: number; percent: number } | null;
};
export const defaultTime = (
  q: Pick<BankQuestion, "section" | "skill" | "difficulty" | "domain"> & {
    level?: number;
  },
) => Math.min(10800, Math.max(5, Math.round(targetOf(q) / 1000)));
export const totalTime = (items: Item[]) =>
  items.reduce((n, x) => n + x.time_limit_sec, 0);
export const formatTime = (sec: number) =>
  `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, "0")}`;
export const parseTime = (text: string) => {
  const m = /^(\d{1,3}):([0-5]\d)$/.exec(text);
  if (!m) return null;
  const n = Number(m[1]) * 60 + Number(m[2]);
  return n >= 5 && n <= 10800 ? n : null;
};
export const fmt = (x: number | null | undefined) =>
  x == null ? "Unavailable" : `${x}%`;
export const time = (x: number | null | undefined) =>
  x == null ? "Unavailable" : `${Math.round(x / 1000)}s`;
export const pct = (v?: { a: number; c: number }) =>
  v?.a ? Math.round((v.c / v.a) * 100) : null;
export { notesHTML } from "../lesson-ui/notes.ts";
export async function api<T>(
  url: string,
  method = "GET",
  data?: unknown,
): Promise<T> {
  const r = await fetch(url, {
    method,
    ...(data === undefined
      ? {}
      : {
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(data),
        }),
  });
  if (r.status === 401) {
    location.replace("/login");
    throw Error("Sign in required");
  }
  if (r.status === 403) {
    location.replace("/app");
    throw Error("Admin access required");
  }
  if (!r.ok)
    throw Error(
      (await r.json().catch(() => ({}))).error ||
        `Request failed (${r.status})`,
    );
  return r.json();
}
export function mathify(root: HTMLElement) {
  const render = (
    window as Window & {
      renderMathInElement?: (el: HTMLElement, options: unknown) => void;
    }
  ).renderMathInElement;
  try {
    render?.(root, {
      delimiters: [
        { left: "\\(", right: "\\)", display: false },
        { left: "\\[", right: "\\]", display: true },
      ],
      throwOnError: false,
    });
  } catch {
    /* Malformed authored math must not blank previews. */
  }
}
// College Board rationales often run every choice together in one paragraph; give each
// "Choice X is/isn't/does…" explanation its own paragraph. DOM-based so inline markup and
// TeX survive the split.
const CHOICE_START = /Choice [A-D] (?:is|isn[’']t|does|doesn[’']t|was|can|can[’']t)\b/g;
export function rationaleHTML(html: string, doc: Document = document) {
  const box = doc.createElement("div");
  box.innerHTML = html;
  if (![...box.childNodes].some((n) => n.nodeName === "P")) {
    const p = doc.createElement("p");
    p.append(...box.childNodes);
    box.append(p);
  }
  for (let p of [...box.querySelectorAll<HTMLParagraphElement>(":scope > p")]) {
    for (;;) {
      const walker = doc.createTreeWalker(p, NodeFilter.SHOW_TEXT);
      let pos = 0,
        split: [Text, number] | null = null;
      for (let node = walker.nextNode() as Text | null; node && !split; node = walker.nextNode() as Text | null) {
        for (const m of node.data.matchAll(CHOICE_START))
          if (pos + m.index! > 0 && /[.!?]["”’)]?\s*$/.test(p.textContent!.slice(0, pos + m.index!))) {
            split = [node, m.index!];
            break;
          }
        pos += node.data.length;
      }
      if (!split) break;
      const range = doc.createRange();
      range.setStart(split[0], split[1]);
      range.setEndAfter(p.lastChild!);
      const next = doc.createElement("p");
      next.append(range.extractContents());
      p.after(next);
      p = next as HTMLParagraphElement;
    }
  }
  return box.innerHTML;
}
