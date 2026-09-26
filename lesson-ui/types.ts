export type Question = {
  id: string;
  section: string;
  stem_html: string;
  choices: { letter: string; content?: string; img?: string }[];
  spr: boolean;
  answer?: string;
  explanation_html?: string;
};
export type Mark = {
  type: 'stroke' | 'highlight' | 'strike' | 'erase' | 'clear';
  id: string;
  color?: string;
  points?: number[][];
  nodeId?: string;
  startOffset?: number;
  endOffset?: number;
};
export type Laser = { x: number; y: number };
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
  classResults?: boolean;
  distribution?: { label: string; count: number; correct: boolean }[];
  hasMath?: boolean;
  desmosKey?: string | null;
  desmos?: object | null;
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
};
