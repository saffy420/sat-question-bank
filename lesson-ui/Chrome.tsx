import type { ReactNode } from 'react';
import { ChevronUp, EllipsisVertical, Flag } from 'lucide-react';

// Header and footer pieces shared by the lesson screens (Player, SelfPlayer) and the practice bank (Bank.tsx), so the
// three keep one markup and one set of styles (lesson.css).

// The "Hide" / "Show" link under the clock.
export function HideButton({ hidden, onToggle }: { hidden: boolean; onToggle: () => void }) {
  return <button aria-label={hidden ? 'Show timer' : 'Hide timer'} onClick={onToggle}>{hidden ? 'Show' : 'Hide'}</button>;
}

// The More tool: icon over label, its items in a popover.
export function More({ children }: { children: ReactNode }) {
  return <details className="lesson-more"><summary><EllipsisVertical aria-hidden="true"/><span>More</span></summary><div>{children}</div></details>;
}

export type GridItem = { id: string; state: string; flagged: boolean; current: boolean; label: string };
// The question navigator: one numbered cell per question, its state as an underline colour, a flag for marked ones.
export function QuestionGrid({ items, attr, onPick }: { items: GridItem[]; attr: string; onPick: (id: string) => void }) {
  return <ol className="self-grid">{items.map((it, n) =>
    <li key={it.id}><button {...{ [attr]: it.id }} data-state={it.state} data-flagged={it.flagged} aria-current={it.current ? 'step' : undefined}
      aria-label={`Question ${n + 1}, ${it.label}${it.flagged ? ', flagged' : ''}`} onClick={() => onPick(it.id)}>{n + 1}{it.flagged && <Flag aria-hidden="true"/>}</button></li>)}</ol>;
}

// The `Question n of N` pill that opens the navigator above it.
export function PositionPill({ id, panelId, label, open, onToggle, children }: { id: string; panelId: string; label: string; open: boolean; onToggle: () => void; children: ReactNode }) {
  return <span className="self-position-wrap">
    <button id={id} className="lesson-position" aria-expanded={open} onClick={onToggle}>{label}<ChevronUp aria-hidden="true"/></button>
    {open && <section id={panelId} className="self-navigator" aria-label="Question navigator">{children}</section>}
  </span>;
}
