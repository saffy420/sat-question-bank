import { createContext, useContext, useEffect, useLayoutEffect, useRef, useState, type ReactNode, type PointerEvent as ReactPointerEvent } from 'react';
import { X } from 'lucide-react';
import { loadDesmos, EDIT_OPTIONS } from '/shared/desmos.js';

// The student's own graphing calculator (Bluebook-style floating window). It never sends
// anything: its state stays in this tab's memory for the lesson session.
type Calculator = {
  setState: (state: object, options?: object) => void;
  getState: () => { expressions?: { list?: { type?: string; latex?: string }[] } };
  resize: () => void;
  destroy: () => void;
};
// Docked on the left between the header and the footer (lesson.css). While it is open the question column reflows to
// its right, so it never covers the question. Only its width is adjustable, from the handle on its right edge; the
// CSS default is clamp(300px, 28vw, 440px), and the column keeps at least MIN_COLUMN px.
const MIN_W = 280, MIN_COLUMN = 480, GUTTERS = 48;
// The instructor's graph dock (right) takes its share too, so both docks together never squeeze the column.
const maxWidth = () => {
  const follower = document.querySelector<HTMLElement>('.lesson-desmos')?.getBoundingClientRect().width || 0;
  return Math.max(MIN_W, innerWidth - MIN_COLUMN - GUTTERS - (follower ? follower + 24 : 0));
};
const clampWidth = (w: number) => Math.round(Math.min(maxWidth(), Math.max(MIN_W, w)));

// Empty = no expression, text, table, folder or image with content (the fresh single blank row).
export function isBlank(state: ReturnType<Calculator['getState']> | null | undefined) {
  return !(state?.expressions?.list || []).some(item => item.type !== 'expression' || !!item.latex?.trim());
}

type Controls = { math: boolean; open: boolean; toggle: () => void; tryIt: (state: object) => void };
const CalcContext = createContext<Controls>({ math: false, open: false, toggle() {}, tryIt() {} });
export const useCalculator = () => useContext(CalcContext);

// Mounted for one lesson view (mountLesson.reset unmounts it on Leave or a new join), so a shared
// Chromebook never hands one student's calculator to the next.
// `embed` is the practice bank's College Board iframe (Graphing / Scientific, no API key); lessons use the Desmos API.
export const EMBED_SRC = { graphing: 'https://www.desmos.com/testing/collegeboard/graphing', scientific: 'https://www.desmos.com/testing/collegeboard/scientific' };
export function CalculatorShell({ apiKey, math, embed, children }: { apiKey?: string | null; math: boolean; embed?: boolean; children: ReactNode }) {
  const [kind, setKind] = useState<keyof typeof EMBED_SRC>('graphing');
  const [open, setOpen] = useState(false);
  // Created on first open and then kept alive (hidden when closed or off a math question).
  const [made, setMade] = useState(false);
  // null = the CSS default width until the student drags the handle.
  const [width, setWidth] = useState<number | null>(null);
  const [confirm, setConfirm] = useState<object | null>(null);
  const host = useRef<HTMLDivElement>(null);
  const calc = useRef<Calculator | null>(null);
  const queued = useRef<object | null>(null);
  const [error, setError] = useState('');
  const dialog = useRef<HTMLDialogElement>(null);
  const shown = open && math;
  // Fetch the Desmos API during the lobby so slow Wi-Fi is not paying for it at the first question.
  useEffect(() => { if (!embed) loadDesmos(apiKey).catch(() => {}); }, [apiKey, embed]);
  useEffect(() => {
    if (!made || embed) return;
    let alive = true;
    loadDesmos(apiKey).then((Desmos: { GraphingCalculator: (el: HTMLElement, o: object) => Calculator }) => {
      if (!alive || !host.current) return;
      const c = Desmos.GraphingCalculator(host.current, EDIT_OPTIONS);
      if (queued.current) c.setState(queued.current, { allowUndo: false });
      queued.current = null;
      calc.current = c;
      host.current.dataset.ready = 'true';
    }).catch((e: Error) => { if (alive) setError(e.message); });
    return () => { alive = false; calc.current?.destroy(); calc.current = null; };
  }, [made, apiKey, embed]);
  // The dock width drives the question's left padding too, so it lives on the lesson root as --calc-w.
  useLayoutEffect(() => {
    const root = document.querySelector<HTMLElement>(':is(#lesson-live, #bank-live):not(.hide)');
    if (!root || width == null) return;
    root.style.setProperty('--calc-w', `${width}px`);
    return () => { root.style.removeProperty('--calc-w'); };
  }, [width]);
  useEffect(() => {
    const onResize = () => setWidth(w => w == null ? w : clampWidth(w));
    addEventListener('resize', onResize);
    return () => removeEventListener('resize', onResize);
  }, []);
  // Desmos sizes itself from its container; tell it when the dock is shown or resized.
  useLayoutEffect(() => { if (shown) calc.current?.resize(); }, [shown, width]);
  // Mounted only while asking, so the question text is not part of the lesson screen otherwise.
  useLayoutEffect(() => { if (confirm && !dialog.current?.open) dialog.current?.showModal(); }, [confirm]);
  const replace = (state: object) => {
    if (calc.current) calc.current.setState(state, { allowUndo: false }); else queued.current = state;
    setMade(true); setOpen(true);
  };
  const controls: Controls = {
    math, open,
    toggle: () => { setMade(true); setOpen(!open); },
    tryIt: state => {
      const current = calc.current ? calc.current.getState() : queued.current;
      if (isBlank(current as ReturnType<Calculator['getState']>)) replace(state); else setConfirm(state);
    }
  };
  // Width handle on the dock's right edge; the pointer stays captured so the drag survives leaving it.
  const size = (down: ReactPointerEvent<HTMLElement>) => {
    if (down.button !== 0) return;
    down.preventDefault();
    const el = down.currentTarget, dock = el.closest<HTMLElement>('.lesson-calc')!;
    const start = dock.getBoundingClientRect().width, x0 = down.clientX;
    el.setPointerCapture(down.pointerId);
    const move = (e: PointerEvent) => setWidth(clampWidth(start + e.clientX - x0));
    const end = () => { el.removeEventListener('pointermove', move); el.removeEventListener('pointerup', end); el.removeEventListener('pointercancel', end); };
    el.addEventListener('pointermove', move); el.addEventListener('pointerup', end); el.addEventListener('pointercancel', end);
  };
  const nudge = (e: React.KeyboardEvent<HTMLElement>) => {
    const dock = (e.currentTarget.closest('.lesson-calc') as HTMLElement).getBoundingClientRect().width;
    if (e.key === 'ArrowRight') setWidth(clampWidth(dock + 20));
    else if (e.key === 'ArrowLeft') setWidth(clampWidth(dock - 20));
    else return;
    e.preventDefault();
  };
  return <CalcContext.Provider value={controls}>
    {children}
    {made && <section className="lesson-calc" id="lesson-calc" hidden={!shown} aria-label="Your calculator">
      <div className="lesson-calc-bar">
        <strong>Calculator</strong>
        <button id="lesson-calc-close" aria-label="Close calculator" onClick={() => setOpen(false)}><X aria-hidden="true"/></button>
      </div>
      {error ? <p role="alert">{error}</p> : null}
      {embed
        ? <div className="lesson-calc-embed">
            <div className="lesson-calc-tabs" role="tablist">{(Object.keys(EMBED_SRC) as (keyof typeof EMBED_SRC)[]).map(k => <button key={k} role="tab" aria-selected={kind === k} id={`bank-calc-${k}`} onClick={() => setKind(k)}>{k === 'graphing' ? 'Graphing' : 'Scientific'}</button>)}</div>
            <div className="lesson-calc-frame"><iframe key={kind} title={`${kind} calculator`} src={EMBED_SRC[kind]} allow="fullscreen"/></div>
          </div>
        : <div className="lesson-calc-body" ref={host}/>}
      <button className="lesson-calc-resize" id="lesson-calc-resize" aria-label="Resize calculator" title="Drag to resize" onPointerDown={size} onKeyDown={nudge}/>
    </section>}
    {confirm && <dialog className="lesson-confirm-dialog" id="lesson-calc-confirm" ref={dialog} onCancel={() => setConfirm(null)}>
      <p>This will delete everything in your calculator and replace it with your instructor's graph.</p>
      <div><button id="lesson-calc-cancel" onClick={() => setConfirm(null)}>Cancel</button><button id="lesson-calc-replace" onClick={() => { const state = confirm; setConfirm(null); if (state) replace(state); }}>Replace</button></div>
    </dialog>}
  </CalcContext.Provider>;
}
