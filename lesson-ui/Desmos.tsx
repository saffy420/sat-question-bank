import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { loadDesmos, syncOut, serialize, FOLLOW_OPTIONS, EDIT_OPTIONS } from '/shared/desmos.js';

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

// Student panel: mirrors the instructor until "Try it yourself" forks an editable copy.
export function DesmosFollower({ apiKey, state }: { apiKey?: string | null; state: DesmosState }) {
  const { host, calc, error } = useCalculator(apiKey, FOLLOW_OPTIONS);
  const [forked, setForked] = useState(false);
  const applied = useRef('');
  useLayoutEffect(() => {
    const text = serialize(state);
    if (!calc || forked || !state || text === applied.current) return;
    calc.setState(state, { allowUndo: false });
    applied.current = text;
  }, [calc, state, forked]);
  // Following is read-only but still scrollable: block every input except the wheel.
  useEffect(() => {
    const el = host.current;
    if (!el || forked) return;
    // Touch only stops propagation so touchscreen scrolling still works.
    const block = (e: Event) => { if (e.type !== 'touchstart') e.preventDefault(); e.stopPropagation(); };
    const unfocus = (e: FocusEvent) => { (e.target as HTMLElement).blur?.(); };
    const types = ['pointerdown', 'mousedown', 'click', 'dblclick', 'touchstart', 'keydown', 'keypress', 'beforeinput', 'input', 'paste', 'drop', 'contextmenu'];
    for (const type of types) el.addEventListener(type, block, { capture: true, passive: false });
    el.addEventListener('focusin', unfocus, { capture: true });
    if (el.contains(document.activeElement)) (document.activeElement as HTMLElement).blur?.();
    return () => { for (const type of types) el.removeEventListener(type, block, { capture: true }); el.removeEventListener('focusin', unfocus, { capture: true }); };
  }, [calc, forked]);
  const fork = () => { calc?.updateSettings(EDIT_OPTIONS); setForked(true); };
  const back = () => {
    if (!calc) return;
    calc.updateSettings(FOLLOW_OPTIONS);
    applied.current = '';
    setForked(false);
  };
  return <aside className="lesson-desmos" id="lesson-desmos" data-mode={forked ? 'fork' : 'follow'} aria-label="Graphing calculator">
    <div className="lesson-desmos-bar">
      <strong>{forked ? 'Your copy' : 'Instructor’s graph'}</strong>
      {forked
        ? <button id="lesson-desmos-back" onClick={back} disabled={!calc}>Back to instructor view</button>
        : <button id="lesson-desmos-fork" onClick={fork} disabled={!calc}>Try it yourself</button>}
    </div>
    {error ? <p role="alert">{error}</p> : null}
    <div className="lesson-desmos-calc" ref={host} data-ready={calc ? 'true' : undefined}/>
  </aside>;
}

// Instructor panel: editable; changes go out throttled and de-duplicated while `live`.
export function DesmosLeader({ apiKey, initial, live, send }: { apiKey?: string | null; initial: DesmosState; live: boolean; send: (state: object) => void }) {
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
  return <aside className="live-desmos" id="live-desmos" aria-label="Desmos graphing calculator">
    {error ? <p role="alert">{error}</p> : null}
    {!live && !error ? <p className="live-desmos-note">Students see your graph after the reveal.</p> : null}
    <div className="live-desmos-calc" ref={host} data-ready={calc ? 'true' : undefined}/>
  </aside>;
}
