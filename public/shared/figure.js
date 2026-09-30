// One figure viewer for every math graph, diagram and shape (bank, lessons, admin previews), after
// Bluebook: a frame with zoom in/out, the current %, Reset and Full Screen. Zoom and pan are local to
// this page: nothing here sends, stores or fetches anything (the overlay reuses the loaded image).

// [DEFAULT] 25 % steps from 100 % to 300 %.
export const ZOOM = { min: 1, max: 3, step: 0.25 };

// ---- pure geometry (unit-tested) ----
export const stepZoom = (z, dir) =>
  Math.min(ZOOM.max, Math.max(ZOOM.min, Math.round((z + dir * ZOOM.step) / ZOOM.step) * ZOOM.step));
// The content is centred in the view and scaled about its own centre, so the content point under the
// view centre is -t/z. Keeping it fixed across a zoom from z to next means t' = t * next / z.
export const zoomAbout = (t, z, next) => t * next / z;
// No gap may open between the figure and the frame edge: |t| <= (z * size - view) / 2, 0 if it fits.
export const clampPan = (t, z, size, view) => {
  const max = Math.max(0, (z * size - view) / 2);
  return Math.min(max, Math.max(-max, t)) || 0;
};

// ---- markup ----
const icon = d => `<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${d}</svg>`;
const ICONS = {
  in: icon('<circle cx="11" cy="11" r="7"/><path d="m20 20-4-4M11 8v6M8 11h6"/>'),
  out: icon('<circle cx="11" cy="11" r="7"/><path d="m20 20-4-4M8 11h6"/>'),
  full: icon('<path d="M4 9V4h5M15 4h5v5M20 15v5h-5M9 20H4v-5"/>'),
  close: icon('<path d="M6 6l12 12M18 6 6 18"/>')
};
const bar = full => `<div class="fv-bar" role="toolbar" aria-label="Figure tools">`
  + `<button type="button" class="fv-btn" data-fv="in" aria-label="Zoom in" data-tip="Zoom in">${ICONS.in}</button>`
  + `<button type="button" class="fv-btn" data-fv="out" aria-label="Zoom out" data-tip="Zoom out" aria-disabled="true">${ICONS.out}</button>`
  + `<span class="fv-pct" aria-live="polite">100%</span>`
  + `<button type="button" class="fv-btn fv-reset" data-fv="reset">Reset</button>`
  + `<span class="fv-div" aria-hidden="true"></span>`
  + (full ? `<button type="button" class="fv-btn" data-fv="close" aria-label="Close full screen" data-tip="Close">${ICONS.close}</button>`
    : `<button type="button" class="fv-btn" data-fv="full" aria-label="Full Screen" data-tip="Full Screen">${ICONS.full}</button>`)
  + `</div>`;
const shell = (full) => {
  const box = document.createElement('div');
  box.className = full ? 'fv fv-full' : 'fv';
  box.innerHTML = `${bar(full)}<div class="fv-view" tabindex="0" role="group" aria-label="Figure. Plus and minus zoom; drag or arrow keys pan when zoomed."><div class="fv-content"></div></div>`;
  return box;
};

// Math stems only: each `.qfig` holding an image, and each authored inline SVG graph, becomes a viewer in
// place. The element is moved, not re-created, so a decoded image is never requested again.
export function wrapFigures(root) {
  const figures = [...root.querySelectorAll('.qfig')].filter(n => n.querySelector('img') && !n.closest('.choice, .fv'))
    .concat([...root.querySelectorAll('svg[role="img"]')].filter(n => !n.closest('.qfig, .choice, .fv')));
  for (const figure of figures) {
    const box = shell(false);
    const content = box.querySelector('.fv-content');
    // Place the frame first: an inline SVG is itself the figure and moves into it.
    figure.before(box);
    if (figure.matches('svg')) content.append(figure); else { content.append(...figure.childNodes); figure.remove(); }
  }
  return figures.length;
}

// ---- fit: the figure never pushes the first choice off-screen ----
// 100 % is capped by --fv-h (a share of the window height). When the stem's text plus its figures would
// still push the first answer control (its first FIT_LINE px) below `bottom()`, the frames of that stem get a smaller cap, down
// to FIT_MIN px; below that the question scrolls as before. Re-run on window resize.
export const FIT_MIN = 140;
export const FIT_LINE = 80;
const fits = new Map();
export function fitFigures(stem, first, bottom) {
  const run = () => {
    const frames = [...stem.querySelectorAll('.fv')];
    const control = first();
    if (!frames.length || !control || !stem.isConnected) return;
    frames.forEach(f => f.style.removeProperty('--fv-h'));
    for (let pass = 0; pass < 3; pass++) {
      // The control's first line (a picture choice can be taller than the screen on its own).
      const r = control.getBoundingClientRect(), over = Math.min(r.bottom, r.top + FIT_LINE) - bottom();
      if (over <= 0.5) break;
      const tallest = Math.max(...frames.map(f => f.querySelector('.fv-content > *')?.getBoundingClientRect().height || 0));
      const cap = Math.max(FIT_MIN, Math.floor(tallest - over / frames.length));
      if (cap >= tallest) break;
      frames.forEach(f => f.style.setProperty('--fv-h', `${cap}px`));
    }
    frames.forEach(apply);
  };
  fits.set(stem, run);
  run();
}
let fitQueued = 0;
const refit = () => {
  if (fitQueued) return;
  fitQueued = requestAnimationFrame(() => {
    fitQueued = 0;
    for (const [stem, run] of fits) stem.isConnected ? run() : fits.delete(stem);
  });
};

// ---- behaviour: delegated, once per document ----
const states = new WeakMap();
const stateOf = box => { let s = states.get(box); if (!s) states.set(box, s = { z: 1, x: 0, y: 0 }); return s; };
function apply(box) {
  const s = stateOf(box), view = box.querySelector('.fv-view'), content = box.querySelector('.fv-content');
  if (!view || !content) return;
  s.x = clampPan(s.x, s.z, content.offsetWidth, view.clientWidth);
  s.y = clampPan(s.y, s.z, content.offsetHeight, view.clientHeight);
  content.style.transform = s.z === 1 ? '' : `translate(${s.x}px, ${s.y}px) scale(${s.z})`;
  box.classList.toggle('fv-zoomed', s.z > 1);
  box.dataset.zoom = String(Math.round(s.z * 100));
  box.querySelector('.fv-pct').textContent = `${Math.round(s.z * 100)}%`;
  box.querySelector('[data-fv="in"]').setAttribute('aria-disabled', String(s.z >= ZOOM.max));
  box.querySelector('[data-fv="out"]').setAttribute('aria-disabled', String(s.z <= ZOOM.min));
  box.dispatchEvent(new CustomEvent('fv:change', { bubbles: true }));
}
export function zoom(box, dir) {
  const s = stateOf(box), next = stepZoom(s.z, dir);
  if (next === s.z) return;
  s.x = zoomAbout(s.x, s.z, next); s.y = zoomAbout(s.y, s.z, next); s.z = next;
  apply(box);
}
export function reset(box) { Object.assign(stateOf(box), { z: 1, x: 0, y: 0 }); apply(box); }
function pan(box, dx, dy) { const s = stateOf(box); s.x += dx; s.y += dy; apply(box); }

// The instructor's pen, laser and eraser own a drag on the card; the figure pans only otherwise.
const DRAW_TOOLS = '.tool-pen, .tool-laser, .tool-erase';

function openFull(box) {
  const source = box.querySelector('.fv-content > *');
  if (!source) return;
  const dialog = document.createElement('dialog');
  dialog.className = 'fv-overlay';
  dialog.setAttribute('aria-label', 'Figure, full screen');
  const full = shell(true);
  // The loaded element itself moves to the overlay: a clone with a src starts a new load. A src-less <img>
  // of the same size holds its place, so the frame keeps its layout and lesson ink keeps its image index.
  const holder = document.createElement(source.tagName === 'IMG' ? 'img' : 'div');
  holder.alt = ''; holder.setAttribute('aria-hidden', 'true');
  holder.style.cssText = `display:block;width:${source.offsetWidth}px;height:${source.offsetHeight || source.getBoundingClientRect().height}px`;
  const sourceStyle = source.getAttribute('style');
  const figure = source;
  source.replaceWith(holder);
  full.querySelector('.fv-content').append(figure);
  dialog.append(full);
  // Inside an open modal dialog (admin question viewer) the overlay must join that top layer too.
  (box.closest('dialog[open]') || document.body).append(dialog);
  // Large and centred: fit the window, upscaling a small crop, keeping its proportions.
  const w = source.naturalWidth || source.viewBox?.baseVal?.width || source.getBoundingClientRect().width || 1;
  const h = source.naturalHeight || source.viewBox?.baseVal?.height || source.getBoundingClientRect().height || 1;
  const fit = () => {
    const view = full.querySelector('.fv-view').getBoundingClientRect();
    // 100 % is half the window-fitted size, so 200 % fills the screen with the dimmed app still around it
    // (Bluebook D) and 300 % overflows and pans. 72 px above and below keep it clear of the toolbar.
    const k = Math.min((view.width - 48) / w, (view.height - 144) / h) / 2;
    figure.style.width = `${Math.max(1, Math.floor(w * k))}px`;
    figure.style.height = `${Math.max(1, Math.floor(h * k))}px`;
    figure.style.maxWidth = figure.style.maxHeight = 'none';
    apply(full);
  };
  const back = box.querySelector('[data-fv="full"]');
  const onResize = () => fit();
  dialog.addEventListener('close', () => {
    window.removeEventListener('resize', onResize);
    if (sourceStyle == null) figure.removeAttribute('style'); else figure.setAttribute('style', sourceStyle);
    holder.replaceWith(figure);
    dialog.remove();
    apply(box);
    back?.focus();
  });
  // Keys used here never reach the page (the bank's own Escape handlers, the admin viewer's arrows).
  dialog.addEventListener('keydown', e => { if (e.key === 'Escape') e.stopPropagation(); });
  dialog.showModal();
  window.addEventListener('resize', onResize);
  fit();
  full.querySelector('.fv-view').focus();
}

export function install(doc = document) {
  const root = doc.documentElement;
  if (root.dataset.fvInstalled) return;
  root.dataset.fvInstalled = '1';
  const style = doc.createElement('style');
  style.id = 'fv-style';
  style.textContent = CSS;
  doc.head.append(style);
  doc.addEventListener('click', e => {
    const button = e.target.closest?.('.fv [data-fv]');
    if (!button) return;
    const box = button.closest('.fv');
    e.preventDefault();
    const act = button.dataset.fv;
    if (act === 'in') zoom(box, 1);
    else if (act === 'out') zoom(box, -1);
    else if (act === 'reset') reset(box);
    else if (act === 'full') openFull(box);
    else if (act === 'close') box.closest('dialog')?.close();
  });
  // Capture phase: runs before page-level shortcuts, which then never see the keys used here.
  doc.addEventListener('keydown', e => {
    const box = e.target.closest?.('.fv');
    if (!box || e.altKey || e.ctrlKey || e.metaKey) return;
    const s = stateOf(box), view = box.querySelector('.fv-view');
    const inView = e.target === view;
    let used = true;
    if (e.key === '+' || e.key === '=') zoom(box, 1);
    else if (e.key === '-' || e.key === '_') zoom(box, -1);
    else if (inView && s.z > 1 && e.key.startsWith('Arrow')) {
      const dx = view.clientWidth / 10, dy = view.clientHeight / 10;
      pan(box, e.key === 'ArrowLeft' ? dx : e.key === 'ArrowRight' ? -dx : 0, e.key === 'ArrowUp' ? dy : e.key === 'ArrowDown' ? -dy : 0);
    } else used = false;
    if (used) { e.preventDefault(); e.stopPropagation(); }
  }, true);
  doc.addEventListener('pointerdown', e => {
    const view = e.target.closest?.('.fv-view');
    if (!view || e.button > 0) return;
    const box = view.closest('.fv');
    if (stateOf(box).z <= 1 || view.closest(DRAW_TOOLS)) return;
    e.preventDefault();
    view.setPointerCapture(e.pointerId);
    view.classList.add('fv-drag');
    let lx = e.clientX, ly = e.clientY;
    // A card may be CSS-scaled (admin thumbnails); pan in layout px so the figure tracks the pointer.
    const r = view.getBoundingClientRect(), k = view.offsetWidth ? r.width / view.offsetWidth : 1;
    const move = ev => { if (ev.pointerId !== e.pointerId) return; pan(box, (ev.clientX - lx) / k, (ev.clientY - ly) / k); lx = ev.clientX; ly = ev.clientY; };
    const up = ev => {
      if (ev.pointerId !== e.pointerId) return;
      view.classList.remove('fv-drag');
      view.removeEventListener('pointermove', move); view.removeEventListener('pointerup', up); view.removeEventListener('pointercancel', up);
    };
    view.addEventListener('pointermove', move); view.addEventListener('pointerup', up); view.addEventListener('pointercancel', up);
  });
  doc.defaultView?.addEventListener('resize', refit);
  doc.addEventListener('dragstart', e => { if (e.target.closest?.('.fv-content')) e.preventDefault(); });
}

const CSS = `
.fv { --fv-line: #c9ccd1; --fv-bar: #f1f2f4; --fv-ink: #1f2937; --fv-h: clamp(150px, 28vh, 440px);
  display: flex; flex-direction: column; width: max-content; min-width: 280px; max-width: 100%; box-sizing: border-box;
  margin: .6em auto; border: 1px solid var(--fv-line); border-radius: 8px; background: #fff; }
:root[data-theme="dark"] .fv { --fv-line: #4a4f57; --fv-bar: #2a2d33; --fv-ink: #e6e8eb; }
.fv-bar { display: flex; align-items: center; justify-content: flex-end; gap: 2px; padding: 4px 8px;
  background: var(--fv-bar); border-bottom: 1px solid var(--fv-line); color: var(--fv-ink); font: 500 14px/1 system-ui, sans-serif;
  user-select: none; }
:is(#fv, html) .fv-btn { position: relative; display: inline-flex; align-items: center; justify-content: center; min-width: 34px; height: 32px;
  padding: 0 6px; border: 0; border-radius: 6px; background: transparent; color: inherit; font: inherit; cursor: pointer; }
:is(#fv, html) .fv-btn:hover { background: rgba(127,127,127,.16); }
:is(#fv, html) .fv-btn:focus-visible, .fv-view:focus-visible { outline: 2px solid #2563eb; outline-offset: -2px; }
:is(#fv, html) .fv-btn[aria-disabled="true"] { opacity: .4; cursor: default; }
:is(#fv, html) .fv-btn[aria-disabled="true"]:hover { background: transparent; }
.fv-reset { padding: 0 8px; }
.fv-pct { min-width: 44px; text-align: center; font-variant-numeric: tabular-nums; }
.fv-div { width: 1px; height: 20px; margin: 0 6px; background: var(--fv-line); }
:is(#fv, html) .fv-btn[data-tip]:hover::after, :is(#fv, html) .fv-btn[data-tip]:focus-visible::after { content: attr(data-tip); position: absolute; bottom: calc(100% + 8px);
  left: 50%; transform: translateX(-50%); padding: 5px 10px; border-radius: 8px; border: 1px solid rgba(255,255,255,.7);
  background: #1f2937; color: #fff; font: 500 13px/1.2 system-ui, sans-serif; white-space: nowrap; pointer-events: none; z-index: 5; }
.fv-bar { border-radius: 7px 7px 0 0; }
.fv-view { position: relative; overflow: hidden; display: flex; align-items: center; justify-content: center;
  background: #fff; border-radius: 0 0 7px 7px; touch-action: pan-x pan-y; }
.fv-zoomed .fv-view { cursor: grab; touch-action: none; }
.fv-view.fv-drag { cursor: grabbing; }
.fv-content { transform-origin: 50% 50%; flex: none; max-width: 100%; }
.fv-content > img, .fv-content > svg { display: block; max-width: 100%; max-height: var(--fv-h); width: auto; height: auto;
  margin: 0; border-radius: 0; background: #fff; padding: 0; filter: none; mix-blend-mode: normal; user-select: none; -webkit-user-drag: none; }
.fv-content > svg { width: 300px; max-width: 100%; height: auto; }
.fv-overlay { width: 100vw; height: 100vh; max-width: none; max-height: none; margin: 0; padding: 0; border: 0; background: transparent; overflow: hidden; }
.fv-overlay::backdrop { background: rgba(17, 24, 39, .55); }
.fv-full { width: 100%; height: 100%; min-width: 0; margin: 0; border: 0; border-radius: 0; background: transparent; overflow: hidden; }
.fv-full .fv-bar { position: fixed; top: 12px; right: 16px; z-index: 2; border: 0; border-radius: 10px; box-shadow: 0 2px 10px rgba(0,0,0,.25); }
:is(#fv, html) .fv-full .fv-bar .fv-btn[data-tip]::after { top: calc(100% + 8px); bottom: auto; }
.fv-full .fv-view { width: 100%; height: 100%; background: transparent; border-radius: 0; }
.fv-full .fv-content > img, .fv-full .fv-content > svg { background: #fff; box-shadow: 0 6px 30px rgba(0,0,0,.35); }
`;
// No transform transition: lesson ink reads the figure's box on every fv:change and must see the final one.
