export type Question = {
  id: string;
  section: string;
  skill?: string;
  stem_html: string;
  choices: { letter: string; content?: string; img?: string }[];
  spr: boolean;
  answer?: string;
  explanation_html?: string;
};
export type Mark = {
  // `eliminate` marks only appear in a saved review layer (My Lessons): the instructor's crossed-out choices.
  // `edit` replaces text node `i` of block `nodeId` with `text` for this session only (live text fix);
  // `edit-math` redraws formula `k` of block `nodeId` from `tex` (live math fix).
  type: 'stroke' | 'highlight' | 'strike' | 'text' | 'edit' | 'edit-math' | 'erase' | 'clear' | 'eliminate';
  id: string;
  color?: string;
  points?: number[][];
  // Streaming chunks from one pen gesture share this ID for whole-stroke erasing.
  strokeId?: string;
  // `text` marks: a typed box at (x, y) of anchor `a`, like one pen point, holding `text` or math (`tex`).
  text?: string;
  tex?: string;
  k?: number;
  x?: number;
  y?: number;
  a?: string;
  nodeId?: string;
  startOffset?: number;
  endOffset?: number;
  i?: number;
};
export type Laser = { x: number; y: number; a?: string; hide?: boolean };
export type View = { w: number; fs: number; u: number; vw: number };
export type Snapshot = {
  title: string;
  mode?: 'self';
  phase: 'READY' | 'ANSWERING' | 'REVEALED' | 'ENDED' | 'FINISHED';
  status: string;
  questionId: string;
  question?: Question;
  index: number;
  total: number;
  count: number;
  endsAt?: number;
  locked?: boolean;
  ownSelection?: string;
  annotations?: Mark[];
  // Choices the instructor crossed out for the class (A1).
  eliminations?: string[];
  classResults?: boolean;
  distribution?: { label: string; count: number; correct: boolean }[];
  hasMath?: boolean;
  desmosKey?: string | null;
  desmos?: object | null;
  desmosVisible?: boolean;
  // Presenter fit (live-fit): the presenter's stage width, --fs, --u and viewport width in CSS px. Once a
  // question is revealed the student stage is laid out at these and scaled to fit, so line breaks match.
  view?: View | null;
  // Instructor-paced: the instructor went back to an already revealed question (11b navigator).
  revisit?: boolean;
  // Self-paced (§8): the student's own set only.
  assignedQuestionIds?: string[];
  questions?: Question[];
  selections?: Record<string, string>;
  submitted?: boolean;
  lateJoin?: boolean;
  joinRemainingMs?: number | null;
  // Self-paced review (§8.7): polls, results and review mode use lesson numbering.
  reviewed?: number;
  reviewMode?: boolean;
  notInSet?: boolean;
  poll?: Poll;
  pollResult?: PollResult;
};
export type Poll = {
  endsAt: number;
  mostMissed: { questionId: string; number: number; missed: number };
  choices: { questionId: string; number: number; mark: 'right' | 'wrong' | 'unassigned' | 'unscored' }[];
  vote: { option: 1 | 2; questionId?: string } | null;
};
export type PollResult = { questionId: string; number: number; winner: 1 | 2; one: number; two: number; endsAt: number };
export type SelfModel = { position: string | null; review: boolean; selections: Record<string, string>; submitting: boolean };
export type PlayerModel = {
  snapshot: Snapshot;
  picked: string;
  lockPending: boolean;
  remaining: number;
  connected: boolean;
  name: string;
  error?: string;
  self?: SelfModel;
};
export type Bridge = {
  select: (questionId: string, answer: string) => void;
  lock: (questionId: string) => void;
  // Self-paced: null opens the review page.
  navigate?: (questionId: string | null) => void;
  submitAll?: () => void;
  vote?: (option: 1 | 2, questionId?: string) => void;
  leave: () => void;
  mathify: (element: HTMLElement) => void;
  // Student report / feature suggestion dialogs live in /shared/report.js; the page supplies the auth.
  report: (r: { questionId: string; element: HTMLElement }) => void;
  suggest: () => void;
};
// §9.1 one ended session from /api/lesson-history/:id.
export type LessonHistory = {
  sessionId: number;
  paddedId: string;
  title: string;
  mode: 'instructor' | 'self';
  date: string;
  desmosKey?: string | null;
  score: { right: number; scorable: number };
  questions: {
    number: number;
    question: Question;
    notes: string;
    inSet: boolean;
    recorded: boolean;
    answer: string | null;
    correct: 0 | 1 | null;
    timeMs?: number | null;
    annotations: Mark[];
    desmos: object | null;
  }[];
};

export type LessonAuthHeaders = () => HeadersInit | Promise<HeadersInit>;
export type HistoryOptions = {
  headers?: LessonAuthHeaders;
  onReady?: (history: LessonHistory) => void;
};
export type ReflectionOptions = {
  sessionId: number;
  headers: LessonAuthHeaders;
  close: () => void;
};

// Practice bank screen (Bank.tsx). `public/index.html` owns the session state and draws this model from it.
// has_desmos: a community Desmos solution exists (desmos_solutions); it is fetched only when asked for.
export type BankQuestion = Question & { domain?: string; skill?: string; difficulty?: string; source?: string; ai?: boolean; level?: number; has_desmos?: number };
export type DesmosSolution = { state: object; credit: string | null; key: string | null };
export type BankCell = { id: string; state: 'none' | 'correct' | 'wrong' | 'corrected' | 'unscored' | 'answered'; flagged: boolean };
// A Study Plan set (drill, consolidation, maintenance): a timed mini test, no Check, scored at the end.
export type BankSet = {
  // The segment being played, e.g. "Medium · 1 of 2".
  segment: string;
  // Asked before the segment ends: what ending it means.
  endText: string;
  // The last segment: its end finishes the set.
  final: boolean;
  unanswered: number;
};
export type BankModel = {
  title: string;
  name: string;
  question: BankQuestion;
  index: number;
  total: number;
  // The pick waiting for Check; once the question is closed, the answer that closed it.
  picked: string;
  // Wrong answers given while the question was open.
  missed: string[];
  // Right, or no stored answer, or the answer was shown: the question is finished.
  closed: boolean;
  // Closed without a scoreable answer (the question has no stored key).
  unscored: boolean;
  // SPR closed by "Show answer": the answer that was given is still wrong.
  shown: boolean;
  flagged: boolean;
  cells: BankCell[];
  paused: boolean;
  note: string;
  // Settings "Note on a miss".
  noteOnMiss: boolean;
  signedIn: boolean;
  set?: BankSet;
  // Review after a Study Plan set: the explanation opens when the question closes, right first time or not.
  explainOnClose?: boolean;
};
export type BankBridge = {
  mathify: (element: HTMLElement) => void;
  // A multiple-choice pick ('' clears it). SPR values arrive with check().
  pick: (letter: string) => void;
  // A grid-in value the student has committed (blur or Enter).
  commit: (value: string) => void;
  // Check the pick, or the SPR value.
  check: (value?: string) => void;
  showAnswer: () => void;
  // "Explanation" on an open question: counts as wrong (once), then closes it with the answer shown.
  giveUp: () => void;
  next: () => void;
  back: () => void;
  goto: (index: number) => void;
  flag: () => void;
  pause: () => void;
  // Leave practice (the screen has already asked).
  exit: () => void;
  saveNote: (questionId: string, body: string) => void;
  // The question as text for an AI assistant (no answer or explanation until it is closed).
  exportText: () => string;
  report: (r: { questionId: string; element: HTMLElement }) => void;
  suggest: () => void;
  // Study Plan set: end the segment being played (the screen has already asked).
  endSegment: () => void;
  // One question's community Desmos solution (GET /api/desmos/:id); rejects when it cannot be had.
  desmosSolution: (questionId: string) => Promise<DesmosSolution>;
};
