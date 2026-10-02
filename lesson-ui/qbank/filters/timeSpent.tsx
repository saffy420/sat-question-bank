// Time spent: a two-thumb slider over the TIME_LABELS buckets (reference: oneprep's Time Spent card).
// The thumbs are role="slider" elements driven by pointer and keyboard rather than two native range inputs,
// so they can sit on the same bucket without one covering the other.
import { useRef, type CSSProperties, type KeyboardEvent, type PointerEvent } from 'react';
import type { FilterDef } from '../filterTypes.ts';
import { TIME_INITIAL, TIME_LABELS, timeActive, timeRange, timeSummary, timeTest, type TimeRange } from './predicates.ts';

const LAST = TIME_LABELS.length - 1;
const clamp = (n: number) => Math.min(LAST, Math.max(0, n));
const pct = (i: number) => `${(i / LAST) * 100}%`;
const ACCENT = 'var(--blue, #2563eb)';
const RAIL = 'var(--border, #e5e7eb)';

function TimeControl({ value, onChange }: { value: TimeRange; onChange: (value: TimeRange) => void }) {
  const [lo, hi] = timeRange(value);
  const rail = useRef<HTMLDivElement>(null);
  const grab = useRef<'lo' | 'hi' | null>(null);
  const set = (which: 'lo' | 'hi', i: number) => {
    const next: TimeRange = which === 'lo' ? [Math.min(clamp(i), hi), hi] : [lo, Math.max(clamp(i), lo)];
    if (next[0] !== lo || next[1] !== hi) onChange(next);
  };
  const at = (e: PointerEvent) => {
    const b = rail.current!.getBoundingClientRect();
    return clamp(Math.round(((e.clientX - b.left) / b.width) * LAST));
  };
  // The thumb nearest the press moves. With both on one bucket, the side the pointer moves toward decides.
  const move = (e: PointerEvent) => {
    const i = at(e);
    if (!grab.current) {
      if (lo === hi) { if (i === lo) return; grab.current = i < lo ? 'lo' : 'hi'; }
      else grab.current = Math.abs(i - lo) <= Math.abs(i - hi) ? 'lo' : 'hi';
    }
    set(grab.current, i);
  };
  const keys = (which: 'lo' | 'hi') => (e: KeyboardEvent) => {
    const now = which === 'lo' ? lo : hi;
    const to = e.key === 'ArrowLeft' || e.key === 'ArrowDown' ? now - 1 : e.key === 'ArrowRight' || e.key === 'ArrowUp' ? now + 1 : e.key === 'Home' ? 0 : e.key === 'End' ? LAST : null;
    if (to === null) return;
    e.preventDefault();
    set(which, to);
  };

  const row: CSSProperties = { display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 12 };
  const thumb = (which: 'lo' | 'hi'): CSSProperties => ({
    position: 'absolute', top: '50%', left: pct(which === 'lo' ? lo : hi), width: 20, height: 20, marginLeft: -10, marginTop: -10, boxSizing: 'border-box',
    borderRadius: '50%', background: '#fff', border: `2px solid ${ACCENT}`, boxShadow: '0 1px 3px rgba(0,0,0,.25)', cursor: 'grab', outlineOffset: 2,
    // The thumb last moved stays on top when both share a bucket.
    zIndex: grab.current === which ? 2 : 1
  });
  return <div style={{ width: 300, maxWidth: '100%', color: 'var(--text, #111827)' }}>
    <div style={row}>
      <strong style={{ fontSize: 13 }}>Time spent</strong>
      <span data-time-summary role="status" style={{ fontSize: 13, fontWeight: 600, color: ACCENT }}>{timeSummary([lo, hi])}</span>
    </div>
    <div style={{ padding: '0 14px' }}>
      <div ref={rail} data-time-rail style={{ position: 'relative', height: 36, touchAction: 'none', cursor: 'pointer' }}
        onPointerDown={e => { grab.current = null; e.currentTarget.setPointerCapture(e.pointerId); move(e); }}
        onPointerMove={e => { if (e.buttons || e.pointerType === 'touch') { if (e.currentTarget.hasPointerCapture(e.pointerId)) move(e); } }}
        onPointerUp={e => { grab.current = null; e.currentTarget.releasePointerCapture(e.pointerId); }}
        onPointerCancel={() => { grab.current = null; }}>
        <div style={{ position: 'absolute', left: 0, right: 0, top: '50%', height: 4, marginTop: -2, borderRadius: 2, background: RAIL }}/>
        <div style={{ position: 'absolute', left: pct(lo), right: `${100 - (hi / LAST) * 100}%`, top: '50%', height: 4, marginTop: -2, borderRadius: 2, background: ACCENT }}/>
        {(['lo', 'hi'] as const).map(which => {
          const v = which === 'lo' ? lo : hi;
          return <div key={which} role="slider" tabIndex={0} data-time-thumb={which} aria-label={which === 'lo' ? 'Shortest time' : 'Longest time'}
            aria-orientation="horizontal" aria-valuemin={which === 'lo' ? 0 : lo} aria-valuemax={which === 'lo' ? hi : LAST} aria-valuenow={v} aria-valuetext={TIME_LABELS[v]}
            style={thumb(which)} onKeyDown={keys(which)}/>;
        })}
      </div>
      <div aria-hidden="true" style={{ position: 'relative', height: 14 }}>
        {TIME_LABELS.map((label, i) => <span key={label} style={{ position: 'absolute', left: pct(i), transform: 'translateX(-50%)', fontSize: 10, whiteSpace: 'nowrap', color: i >= lo && i <= hi ? ACCENT : 'var(--dim, #6b7280)', fontWeight: i >= lo && i <= hi ? 600 : 400 }}>{label}</span>)}
      </div>
    </div>
  </div>;
}

export const timeSpent: FilterDef<TimeRange> = {
  key: 'timeSpent',
  label: 'Time spent',
  initial: TIME_INITIAL,
  isActive: timeActive,
  summary: timeSummary,
  test: timeTest,
  Control: TimeControl
};
