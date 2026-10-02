// The question bank home's model and bridge. public/index.html owns the state (F, QS, PROG, LOG)
// and builds the model; the island only draws it and reports clicks back.
export type Tally = { a: number; c: number; n: number };
export type HomeSkill = { name: string; tally: Tally; picked: boolean };
export type HomeDomain = { name: string; tally: Tally; skills: HomeSkill[] };
export type HomeSection = { name: string; tally: Tally; domains: HomeDomain[] };
export type HomeFilters = {
  diff: string[] | null;
  count: number;
  rand: boolean;
  bank: string[] | null;
  lesson: string;
  extra: Record<string, unknown>;
};
export type HomeModel = {
  sections: HomeSection[];
  skills: string[] | null;
  filters: HomeFilters;
  matching: number;
  mode: 'all' | 'focus';
};
export type HomeBridge = {
  setFilters(partial: Partial<HomeFilters> & { skills?: string[] | null }): void;
  setMode(mode: 'all' | 'focus'): void;
  start(): void;
  startReview(): void;
};
