import { escapeHTML } from "../lesson-ui/escape.ts";
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
  join_code: string;
};
export const defaultTime = (q: Pick<Question, "section">) =>
  q.section === "Math" ? 90 : 60;
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
export const notesHTML = (text: string) =>
  escapeHTML(text)
    .split(/\n\s*\n/)
    .map((block) => {
      const lines = block.split("\n");
      const inline = (s: string) =>
        s.replace(/(`[^`\n]+`|\*\*[^*\n]+\*\*|\*[^*\n]+\*)/g, (token) =>
          token.startsWith("`")
            ? `<code>${token.slice(1, -1)}</code>`
            : token.startsWith("**")
              ? `<strong>${token.slice(2, -2)}</strong>`
              : `<em>${token.slice(1, -1)}</em>`,
        );
      return lines.every((s) => /^[-*] /.test(s))
        ? `<ul>${lines.map((s) => `<li>${inline(s.slice(2))}</li>`).join("")}</ul>`
        : `<p>${lines.map(inline).join("<br>")}</p>`;
    })
    .join("");
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
