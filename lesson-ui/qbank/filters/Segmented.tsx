// A compact one-of-N choice for a filter popover: a row of radio buttons styled as a segmented control.
import type { CSSProperties } from 'react';

export function Segmented<T extends string>({ label, options, value, onChange }: { label: string; options: { value: T; text: string }[]; value: T; onChange: (value: T) => void }) {
  const box: CSSProperties = { display: 'inline-flex', border: '1px solid var(--border, #e5e7eb)', borderRadius: 8, overflow: 'hidden', background: 'var(--panel, #fff)' };
  return <div role="radiogroup" aria-label={label} style={box}>
    {options.map((o, n) => {
      const on = o.value === value;
      const style: CSSProperties = {
        font: 'inherit', fontSize: 13, fontWeight: on ? 600 : 500, padding: '6px 12px', cursor: 'pointer', border: 0,
        borderLeft: n ? '1px solid var(--border, #e5e7eb)' : 0, whiteSpace: 'nowrap',
        background: on ? 'var(--blue-bg, #eff6ff)' : 'transparent', color: on ? 'var(--blue-dark, #1d4ed8)' : 'var(--text, #111827)'
      };
      return <button key={o.value} type="button" role="radio" aria-checked={on} data-value={o.value} style={style} onClick={() => onChange(o.value)}>{o.text}</button>;
    })}
  </div>;
}
