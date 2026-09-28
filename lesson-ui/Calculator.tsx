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
type Rect = { x: number; y: number; w: number; h: number };

// Default window: left edge, between the header (and its phase label) and the footer. lesson.css shifts the question
// right by CALC_SHIFT while the window is open so this position never covers it.
// Header 102px + phase label 26px; footer 80px.
const HEADER = 128, FOOTER = 80, GAP = 8, MIN_W = 300, MIN_H = 260;
export const CALC_LEFT = 16, CALC_WIDTH = 400;
const defaultRect = (): Rect => {
  const vw = innerWidth, vh = innerHeight;
  const w = Math.min(CALC_WIDTH, vw - 2 * CALC_LEFT);
  return clamp({ x: CALC_LEFT, y: HEADER + GAP, w, h: vh - HEADER - FOOTER - 2 * GAP });
};
const clamp = (r: Rect): Rect => {
  const vw = innerWidth, vh = innerHeight;
  const w = Math.min(vw, Math.max(Math.min(MIN_W, vw), r.w)), h = Math.min(vh, Math.max(Math.min(MIN_H, vh), r.h));
  return { w, h, x: Math.min(vw - w, Math.max(0, r.x)), y: Math.min(vh - h, Math.max(0, r.y)) };
};

// Empty = no expression, text, table, folder or image with content (the fresh single blank row).
export function isBlank(state: ReturnType<Calculator['getState']> | null | undefined) {
  return !(state?.expressions?.list || []).some(item => item.type !== 'expression' || !!item.latex?.trim());
}

type Controls = { math: boolean; open: boolean; toggle: () => void; tryIt: (state: object) => void };
const CalcContext = createContext<Controls>({ math: false, open: false, toggle() {}, tryIt() {} });
export const useCalculator = () => useContext(CalcContext);

// Mounted for one lesson view (mountLesson.reset unmounts it on Leave or a new join), so a shared
// Chromebook never hands one student's calculator to the next.
export function CalculatorShell({ apiKey, math, children }: { apiKey?: string | null; math: boolean; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  // Created on first open and then kept alive (hidden when closed or off a math question).
  const [made, setMade] = useState(false);
  const [rect, setRect] = useState<Rect>(defaultRect);
  const [confirm, setConfirm] = useState<object | null>(null);
  const host = useRef<HTMLDivElement>(null);
  const calc = useRef<Calculator | null>(null);
  const queued = useRef<object | null>(null);
  const [error, setError] = useState('');
  const dialog = useRef<HTMLDialogElement>(null);
  const shown = open && math;
  // Fetch the Desmos API during the lobby so slow Wi-Fi is not paying for it at the first question.
  useEffect(() => { loadDesmos(apiKey).catch(() => {}); }, [apiKey]);
  useEffect(() => {
    if (!made) return;
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
  }, [made, apiKey]);
  useEffect(() => {
    const onResize = () => setRect(r => clamp(r));
    addEventListener('resize', onResize);
    return () => removeEventListener('resize', onResize);
  }, []);
  // Desmos sizes itself from its container; tell it when the window is shown or resized.
  useLayoutEffect(() => { if (shown) calc.current?.resize(); }, [shown, rect.w, rect.h]);
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
  // Title-bar drag and corner resize; both stay inside the viewport.
  const gesture = (kind: 'move' | 'size') => (down: ReactPointerEvent<HTMLElement>) => {
    if (down.button !== 0 || (down.target as Element).closest('button:not(.lesson-calc-resize)')) return;
    down.preventDefault();
    const el = down.currentTarget, start = rect, x0 = down.clientX, y0 = down.clientY;
    el.setPointerCapture(down.pointerId);
    const move = (e: PointerEvent) => {
      const dx = e.clientX - x0, dy = e.clientY - y0;
      setRect(clamp(kind === 'move' ? { ...start, x: start.x + dx, y: start.y + dy }
        : { ...start, w: Math.min(start.w + dx, innerWidth - start.x), h: Math.min(start.h + dy, innerHeight - start.y) }));
    };
    const end = () => { el.removeEventListener('pointermove', move); el.removeEventListener('pointerup', end); el.removeEventListener('pointercancel', end); };
    el.addEventListener('pointermove', move); el.addEventListener('pointerup', end); el.addEventListener('pointercancel', end);
  };
  return <CalcContext.Provider value={controls}>
    {children}
    {made && <section className="lesson-calc" id="lesson-calc" hidden={!shown} aria-label="Your calculator" style={{ left: rect.x, top: rect.y, width: rect.w, height: rect.h }}>
      <div className="lesson-calc-bar" onPointerDown={gesture('move')}>
        <strong>Calculator</strong>
        <button id="lesson-calc-close" aria-label="Close calculator" onClick={() => setOpen(false)}><X aria-hidden="true"/></button>
      </div>
      {error ? <p role="alert">{error}</p> : null}
      <div className="lesson-calc-body" ref={host}/>
      <button className="lesson-calc-resize" id="lesson-calc-resize" aria-label="Resize calculator" tabIndex={-1} onPointerDown={gesture('size')}/>
    </section>}
    {confirm && <dialog className="lesson-confirm-dialog" id="lesson-calc-confirm" ref={dialog} onCancel={() => setConfirm(null)}>
      <p>This will delete everything in your calculator and replace it with your instructor's graph.</p>
      <div><button id="lesson-calc-cancel" onClick={() => setConfirm(null)}>Cancel</button><button id="lesson-calc-replace" onClick={() => { const state = confirm; setConfirm(null); if (state) replace(state); }}>Replace</button></div>
    </dialog>}
  </CalcContext.Provider>;
}
