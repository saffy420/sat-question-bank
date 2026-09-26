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
  phase: 'READY' | 'ANSWERING' | 'REVEALED' | 'ENDED';
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
};
export type PlayerModel = {
  snapshot: Snapshot;
  picked: string;
  lockPending: boolean;
  remaining: number;
  connected: boolean;
  name: string;
  error?: string;
};
export type Bridge = {
  select: (questionId: string, answer: string) => void;
  lock: (questionId: string) => void;
  leave: () => void;
  mathify: (element: HTMLElement) => void;
};
