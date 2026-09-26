// Desmos API for live lessons. The practice bank keeps its College Board iframe.
export const DESMOS_SRC = 'https://www.desmos.com/api/v1.11/calculator.js';
export const SYNC_MS = 150;

// Students follow the instructor: no expression editing, no pan/zoom, no menus.
// The panel host is also made inert while following, so nothing can take focus.
export const FOLLOW_OPTIONS = Object.freeze({ keypad: false, expressionsTopbar: false, settingsMenu: false, zoomButtons: false, lockViewport: true, pointsOfInterest: false, trace: false, border: false });
export const EDIT_OPTIONS = Object.freeze({ keypad: true, expressionsTopbar: true, settingsMenu: false, zoomButtons: true, lockViewport: false, pointsOfInterest: true, trace: true, border: false });

let loading = null;
export function loadDesmos(key) {
  if (globalThis.Desmos?.GraphingCalculator) return Promise.resolve(globalThis.Desmos);
  if (!key) return Promise.reject(Error('Desmos unavailable: no API key configured'));
  loading ||= new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = `${DESMOS_SRC}?apiKey=${encodeURIComponent(key)}`;
    script.async = true;
    script.onload = () => globalThis.Desmos?.GraphingCalculator ? resolve(globalThis.Desmos) : reject(Error('Desmos failed to start'));
    script.onerror = () => { script.remove(); reject(Error('Desmos failed to load')); };
    document.head.append(script);
  }).catch(error => { loading = null; throw error; });
  return loading;
}

export const serialize = state => state ? JSON.stringify(state) : '';

// Trailing throttle over state changes and pans/zooms; unchanged states are never resent.
// send(state) returns true when it actually sent (e.g. only while revealed).
export function syncOut(calc, send, ms = SYNC_MS) {
  let timer = null, last = '';
  const push = () => {
    timer = null;
    const state = calc.getState(), text = serialize(state);
    if (text !== last && send(state)) last = text;
  };
  const schedule = () => { if (!timer) timer = setTimeout(push, ms); };
  calc.observeEvent('change', schedule);
  calc.observe('graphpaperBounds', schedule);
  return {
    flush() { clearTimeout(timer); push(); },
    mark(state) { last = serialize(state); },
    stop() { clearTimeout(timer); calc.unobserveEvent('change'); calc.unobserve('graphpaperBounds'); }
  };
}
