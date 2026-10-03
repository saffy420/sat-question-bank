import { useEffect, useLayoutEffect, useRef, useState, type PointerEvent as ReactPointerEvent, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import { loadDesmos, syncOut, serialize, FOLLOW_OPTIONS, EDIT_OPTIONS } from '/shared/desmos.js';
import type { DesmosSolution as Solution } from './types';

type Calculator = {
  setState: (state: object, options?: object) => void;
  getState: () => object;
  updateSettings: (options: object) => void;
  destroy: () => void;
};
type DesmosState = object | null | undefined;

function useCalculator(apiKey: string | null | undefined, options: object) {
  const host = useRef<HTMLDivElement>(null);
  const [calc, setCalc] = useState<Calculator | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    let alive = true, made: Calculator | null = null;
    loadDesmos(apiKey).then((Desmos: { GraphingCalculator: (el: HTMLElement, o: object) => Calculator }) => {
      if (!alive || !host.current) return;
      made = Desmos.GraphingCalculator(host.current, options);
      setCalc(made);
    }).catch((e: Error) => { if (alive) setError(e.message); });
    return () => { alive = false; made?.destroy(); };
  }, [apiKey]);
  return { host, calc, error };
}

// Student panel: always a read-only mirror of the instructor's graph. "Try it yourself" copies the
// latest instructor state into the student's own calculator (Calculator.tsx) instead of forking here.
// readOnly (lesson history, §9.1): the instructor's final graph with no copy button.
export function DesmosFollower({ apiKey, state, readOnly = false, onTry }: { apiKey?: string | null; state: DesmosState; readOnly?: boolean; onTry?: (state: object) => void }) {
  const { host, calc, error } = useCalculator(apiKey, FOLLOW_OPTIONS);
  const applied = useRef('');
  useLayoutEffect(() => {
    const text = serialize(state);
    if (!calc || !state || text === applied.current) return;
    calc.setState(state, { allowUndo: false });
    applied.current = text;
  }, [calc, state]);
  // Following is read-only but still scrollable: block every input except the wheel.
  useEffect(() => {
    const el = host.current;
    if (!el) return;
    // Touch only stops propagation so touchscreen scrolling still works.
    const block = (e: Event) => { if (e.type !== 'touchstart') e.preventDefault(); e.stopPropagation(); };
    const unfocus = (e: FocusEvent) => { (e.target as HTMLElement).blur?.(); };
    const types = ['pointerdown', 'mousedown', 'click', 'dblclick', 'touchstart', 'keydown', 'keypress', 'beforeinput', 'input', 'paste', 'drop', 'contextmenu'];
    for (const type of types) el.addEventListener(type, block, { capture: true, passive: false });
    el.addEventListener('focusin', unfocus, { capture: true });
    if (el.contains(document.activeElement)) (document.activeElement as HTMLElement).blur?.();
    return () => { for (const type of types) el.removeEventListener(type, block, { capture: true }); el.removeEventListener('focusin', unfocus, { capture: true }); };
  }, [calc]);
  return <aside className="lesson-desmos" id="lesson-desmos" data-mode="follow" aria-label="Instructor’s graph">
    <div className="lesson-desmos-bar">
      <strong>Instructor’s graph</strong>
      {readOnly || !onTry ? null : <button id="lesson-desmos-fork" onClick={() => { if (state) onTry(state); }} disabled={!state}>Try it yourself</button>}
    </div>
    {error ? <p role="alert">{error}</p> : null}
    <div className="lesson-desmos-calc" ref={host} data-ready={calc ? 'true' : undefined}/>
  </aside>;
}

// Instructor panel: editable; changes go out throttled and de-duplicated while `live`. `resize` (admin only) adds a
// drag handle on the panel's left edge: it reports the wanted width in px and the parent clamps and stores it.
export type PanelResize = { width: number; min: number; max: number; onChange: (width: number) => void };
export function DesmosLeader({ apiKey, initial, live, send, resize }: { apiKey?: string | null; initial: DesmosState; live: boolean; send: (state: object) => void; resize?: PanelResize }) {
  const { host, calc, error } = useCalculator(apiKey, EDIT_OPTIONS);
  const liveRef = useRef(live);
  liveRef.current = live;
  const dirty = useRef(false);
  const sync = useRef<ReturnType<typeof syncOut> | null>(null);
  useEffect(() => {
    if (!calc) return;
    if (initial) calc.setState(initial, { allowUndo: false });
    const out = syncOut(calc, (state: object) => {
      dirty.current = true;
      if (!liveRef.current) return false;
      send(state);
      return true;
    });
    // A restored state is already on the server; do not echo it back.
    out.mark(initial ? calc.getState() : null);
    sync.current = out;
    return () => { out.stop(); sync.current = null; };
  }, [calc]);
  // Work done before the reveal goes out once the question is revealed.
  useEffect(() => { if (live && dirty.current) sync.current?.flush(); }, [live]);
  // Desmos only re-measures itself on window resize, so tell it when the panel's own width changes.
  useLayoutEffect(() => { (calc as unknown as { resize?: () => void } | null)?.resize?.(); }, [calc, resize?.width]);
  const drag = (down: ReactPointerEvent<HTMLElement>) => {
    if (!resize || down.button !== 0) return;
    down.preventDefault();
    const el = down.currentTarget, start = resize.width, x0 = down.clientX;
    el.setPointerCapture(down.pointerId);
    // The handle is on the left edge: dragging left widens the panel.
    const move = (e: PointerEvent) => resize.onChange(start + x0 - e.clientX);
    const end = () => { el.removeEventListener('pointermove', move); el.removeEventListener('pointerup', end); el.removeEventListener('pointercancel', end); };
    el.addEventListener('pointermove', move); el.addEventListener('pointerup', end); el.addEventListener('pointercancel', end);
  };
  const key = (e: ReactKeyboardEvent<HTMLElement>) => {
    if (!resize) return;
    const step = e.shiftKey ? 60 : 20;
    if (e.key === 'ArrowLeft') resize.onChange(resize.width + step);
    else if (e.key === 'ArrowRight') resize.onChange(resize.width - step);
    else if (e.key === 'Home') resize.onChange(resize.min);
    else if (e.key === 'End') resize.onChange(resize.max);
    else return;
    e.preventDefault();
  };
  return <aside className="live-desmos" id="live-desmos" aria-label="Desmos graphing calculator" style={resize ? { width: resize.width } : undefined}>
    {resize && <div className="live-desmos-handle" id="live-desmos-handle" role="separator" aria-orientation="vertical" aria-label="Resize Desmos panel" aria-valuemin={resize.min} aria-valuemax={resize.max} aria-valuenow={resize.width} tabIndex={0} title="Drag to resize" onPointerDown={drag} onKeyDown={key}/>}
    {error ? <p role="alert">{error}</p> : null}
    {!live && !error ? <p className="live-desmos-note">Students see your graph after the reveal.</p> : null}
    <div className="live-desmos-calc" ref={host} data-ready={calc ? 'true' : undefined}/>
  </aside>;
}

// Practice bank (Bank.tsx): a community solution graph from Prepzy, shown under the explanation once the
// question is closed. The state and key are fetched only when the student asks; the graph can be panned and
// explored, and nothing done to it is saved.
const SOLUTION_OPTIONS = Object.freeze({ keypad: false, expressionsTopbar: false, settingsMenu: false, zoomButtons: true, lockViewport: false, border: false });
function SolutionGraph({ apiKey, state }: { apiKey: string | null; state: object }) {
  const { host, calc, error } = useCalculator(apiKey, SOLUTION_OPTIONS);
  useLayoutEffect(() => { calc?.setState(state, { allowUndo: false }); }, [calc, state]);
  return <>
    {error ? <p role="alert">{error}</p> : null}
    <div className="bank-desmos-calc" id="bank-desmos-calc" ref={host} data-ready={calc ? 'true' : undefined}/>
  </>;
}
export function DesmosSolution({ questionId, load }: { questionId: string; load: (questionId: string) => Promise<Solution> }) {
  const [solution, setSolution] = useState<Solution | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const alive = useRef(true);
  useEffect(() => () => { alive.current = false; }, []);
  const open = () => {
    setLoading(true); setError('');
    load(questionId).then(s => { if (alive.current) setSolution(s); })
      .catch((e: Error) => { if (alive.current) setError(e.message || 'Could not load the Desmos solution.'); })
      .finally(() => { if (alive.current) setLoading(false); });
  };
  return <div className="bank-desmos" id="bank-desmos">
    {solution ? <SolutionGraph apiKey={solution.key} state={solution.state}/>
      : <button id="bank-desmos-open" onClick={open} disabled={loading}>{loading ? 'Loading Desmos solution…' : 'Desmos solution'}</button>}
    {error ? <p role="alert" className="bank-desmos-error">{error}</p> : null}
    {solution ? <p className="bank-desmos-credit" id="bank-desmos-credit">{solution.credit ? `Solution by ${solution.credit} via Prepzy` : 'Solution via Prepzy'}</p> : null}
  </div>;
}
