// The practice record path: what a pick, a Check and a wrong retry do to the answer state, the progress row and the
// attempt log. It was `grade()`, `rememberAnswer()`, `recordProgress()` and `recordAttempt()` in public/index.html;
// the practice player (Bank.tsx) and the practice-exam scorer both call it through `lesson.js`.
//
// Type-stripping safe on purpose (no enums, namespaces or parameter properties, no '/shared' imports): the unit test
// loads this file directly. The page's stats functions (`/shared/stats.js`) are handed in, so there is one copy of
// nextProgress/attemptRow/isRight and this module never forks them.

export type Choice = { letter: string };
export type Question = { id: string; answer?: string; spr?: boolean; choices: Choice[] };
export type HistoryEvent = { answer: string; atMs: number };
export type Progress = { question_id: string; attempts: number; corrects: number; marker: string; last_reviewed?: string; time_taken_ms?: number; stars?: number };
export type Attempt = { question_id: string; ts: string; correct: number; time_taken_ms: number; picked: string; changes: number; answer_history_json?: string };

type Verdict = boolean | null;
export type StatsFns = {
  isRight: (q: Question, value: string | null) => Verdict;
  nextProgress: (prev: Progress | undefined, questionId: string, ok: Verdict, now: string, ms: number) => Progress;
  attemptRow: (questionId: string, ok: Verdict, now: string, ms: number, picked: string | null | undefined, changes: number | undefined, history?: HistoryEvent[]) => Attempt;
};

// The part of the page's session object `S` the record path reads and writes.
export type PracticeState = {
  started: number;
  qStart: number;
  exam?: unknown;
  ans: Record<string, string>;
  // The pick (MC letter, SPR value) waiting for Check. Cleared by a wrong Check so the student must choose again.
  sel: Record<string, string | null | undefined>;
  tried: Record<string, boolean>;
  checked: Record<string, boolean>;
  // Every wrong answer given while the question was open, oldest first.
  miss: Record<string, string[]>;
  // The first Check's verdict: the only one that is recorded. Absent until the first scored Check.
  first?: Record<string, boolean>;
  // SPR closed by "Show answer" rather than a right answer.
  shown?: Record<string, boolean>;
  changes: Record<string, number>;
  history?: Record<string, HistoryEvent[]>;
};

export type Env = {
  stats: StatsFns;
  prog: () => Record<string, Progress>;
  log: () => Attempt[];
  saveProgress: (rows: Progress[]) => void;
  saveLog: (rows: Attempt[]) => void;
};

// [DEFAULT] wrong SPR Checks before "Show answer" is offered.
export const SHOW_ANSWER_AFTER = 3;
// ponytail: keep first and most recent 127 edits; raise bound only if real usage needs more.
const HISTORY_MAX = 128;

export type CheckResult = {
  // true right, false wrong, null = the question has no stored answer (nothing is scored).
  ok: Verdict;
  // First Check on this question: the one that moved the record.
  first: boolean;
  // The question is finished (right, or unscorable). A wrong Check leaves it open.
  closed: boolean;
  recorded: boolean;
};

// Edits of the answer, read back by the dashboard's second-guessing panel. A committed value, not every keystroke.
export function remember(S: PracticeState, q: Question, answer: string | null | undefined, now = Date.now()) {
  if (!S.history || !answer || answer.length > 32) return;
  const h = (S.history[q.id] ||= []);
  if (h.at(-1)?.answer === answer) return;
  if (q.spr && h.length && !S.exam) S.changes[q.id] = (S.changes[q.id] || 0) + 1;
  const event = { answer, atMs: Math.min(86400000, Math.max(0, now - (S.started || now))) };
  if (h.length >= HISTORY_MAX) h[h.length - 1] = event; else h.push(event);
}

// A multiple-choice pick. Switching is a second guess; choosing for the first time (or again after a wrong Check) is not.
export function pick(S: PracticeState, q: Question, letter: string, now = Date.now()) {
  if (!letter) { S.sel[q.id] = null; return; }
  if (S.sel[q.id] && S.sel[q.id] !== letter) S.changes[q.id] = (S.changes[q.id] || 0) + 1;
  S.sel[q.id] = letter;
  remember(S, q, letter, now);
}

// A committed grid-in value (blur, change, Check).
export function commit(S: PracticeState, q: Question, value: string, now = Date.now()) {
  S.sel[q.id] = value || null;
  remember(S, q, value, now);
}

export function createRecorder(env: Env) {
  // The record moves once per question: Red is wrong, Orange right after a Red, Green right.
  function recordProgress(q: Question, ok: Verdict, now: string, ms: number) {
    const p = env.stats.nextProgress(env.prog()[q.id], q.id, ok, now, ms);
    env.prog()[q.id] = p;
    env.saveProgress([p]);
  }
  function recordAttempt(q: Question, ok: Verdict, now: string, ms: number, picked: string | null | undefined, changes: number | undefined, history?: HistoryEvent[]) {
    const ev = env.stats.attemptRow(q.id, ok, now, ms, picked, changes, history);
    env.log().push(ev);
    env.saveLog([ev]);
  }

  // Check. The first Check on a question records the progress row and the attempt: `correct` is the first-try result and
  // `time_taken_ms` the time to that Check. A wrong Check leaves the question open with the wrong answer remembered;
  // later Checks only extend the answer history, so a student cannot walk a question to Green by trying every option.
  function check(S: PracticeState, q: Question, now = Date.now()): CheckResult | null {
    const id = q.id;
    const answer = S.sel[id];
    if (!answer) return null;
    S.ans[id] = answer;
    remember(S, q, answer, now);
    const ok = env.stats.isRight(q, answer);
    const first = !S.tried[id];
    S.tried[id] = true;
    if (ok === false) {
      (S.miss[id] ||= []).push(answer);
      S.sel[id] = null;
    } else S.checked[id] = true;
    if (ok === null) return { ok, first, closed: true, recorded: false };
    if (first) {
      (S.first ||= {})[id] = ok;
      const ts = new Date(now).toISOString(), ms = Math.round(now - S.qStart);
      recordProgress(q, ok, ts, ms);
      recordAttempt(q, ok, ts, ms, answer, S.changes[id], S.history?.[id]);
    }
    return { ok, first, closed: ok === true, recorded: first };
  }

  // "Show answer": closes an SPR after SHOW_ANSWER_AFTER wrong Checks. The first-try attempt already recorded stays wrong.
  function showAnswer(S: PracticeState, q: Question): boolean {
    if (!q.spr || S.checked[q.id] || (S.miss[q.id] || []).length < SHOW_ANSWER_AFTER) return false;
    (S.shown ||= {})[q.id] = true;
    S.checked[q.id] = true;
    return true;
  }

  return { recordProgress, recordAttempt, check, showAnswer };
}

// The first-try verdict. Sessions saved before the first-try rule carry only ans/checked, so fall back to those.
export function firstTry(S: PracticeState, q: Question, isRight: StatsFns['isRight']): boolean | undefined {
  const v = S.first?.[q.id];
  if (v !== undefined) return v;
  if (!S.checked[q.id]) return undefined;
  const ok = isRight(q, S.ans[q.id]);
  return ok === null ? undefined : ok;
}

export type Outcome = 'none' | 'correct' | 'corrected' | 'wrong' | 'unscored';
// Question-map and results state. Green first try, Orange when an earlier sitting missed it (the record says Orange),
// Red when the first Check was wrong, even once a retry solved it: accuracy is first-try based.
export function outcome(S: PracticeState, q: Question, marker: string | undefined, isRight: StatsFns['isRight']): Outcome {
  const v = firstTry(S, q, isRight);
  if (v === undefined) return S.checked[q.id] ? 'unscored' : 'none';
  if (v === false) return 'wrong';
  return marker === 'Orange' ? 'corrected' : 'correct';
}
