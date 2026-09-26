import { useLayoutEffect, useRef } from 'react';
import * as Renderer from '/shared/renderer.js';
import * as Ink from '/shared/annotations.js';
import type { Mark, Question } from './types';

import { escapeHTML } from './escape';
export { escapeHTML } from './escape';

// Two-pane split as a fraction of the stage, remembered for the session so the next question opens
// where the student left the divider. Each pane keeps at least 25% and 300px.
let splitAt = 0.5;
const PANE_MIN = 300;
const bounds = (width: number) => { const min = Math.min(0.5, Math.max(0.25, PANE_MIN / width)); return [min, 1 - min]; };
const GRIP = '<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="m9 7-5 5 5 5M15 7l5 5-5 5"/></svg>';
const EXPAND = (d: string) => `<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="${d}"/></svg>`;
export type StageProps = {
  question: Question;
  number: number;
  id?: string;
  picked?: string;
  active?: boolean;
  revealed?: boolean;
  marks?: Mark[];
  privateMarks?: Mark[];
  mathify: (element: HTMLElement) => void;
  onSelect?: (answer: string) => void;
  onReady?: (card: HTMLDivElement) => void;
  onPrivate?: (mark: Mark) => void;
  // Highlighter tool active: cursor styling only.
  annotating?: boolean;
  // Private process-of-elimination state; the Stage only renders it.
  strikeMode?: boolean;
  struck?: string[];
  onStrikeMode?: () => void;
  onStrike?: (letter: string) => void;
};

export function Stage(props: StageProps) {
  const host = useRef<HTMLDivElement>(null);
  const card = useRef<HTMLDivElement>(null);
  const latest = useRef(props);
  const ready = useRef(false);
  latest.current = props;
  const paint = () => {
    if (!card.current || !ready.current) return;
    const p = latest.current;
    Ink.blocks(card.current);
    Ink.paint(card.current, [...(p.marks || []), ...(p.privateMarks || [])]);
    Ink.overlay(card.current, p.marks || []);
    Ink.refreshLaser(card.current);
  };
  useLayoutEffect(() => {
    const el = card.current!, wrapper = host.current!;
    const q = props.question;
    const at = q.section !== 'Math' ? q.stem_html.indexOf('<h3>Prompt</h3>') : -1;
    const split = at >= 0
      ? { context: Renderer.renderStem({ stem_html: q.stem_html.slice(0, at) }), body: Renderer.renderStem({ stem_html: q.stem_html.slice(at + 15) }) }
      : Renderer.splitContext(Renderer.renderStem(q), document);
    const math = q.section === 'Math';
    // Passage, or a figure/table split out of the stem (math included), goes in a resizable left pane.
    const single = !split.context;
    el.className = `lesson-stage ${math ? 'stage-math' : ''} ${single ? 'stage-single' : `stage-split ${math ? 'stage-figure' : 'stage-reading'}`}`;
    el.innerHTML = `${!single ? `<div class="stage-passage"><div class="passage">${split.context}</div></div><div class="stage-divider" role="separator" tabindex="0" aria-orientation="vertical" aria-label="Resize panes" aria-valuemin="25" aria-valuemax="75" aria-valuenow="50"><div class="stage-divider-controls"><button type="button" class="stage-expand" data-expand="left" aria-label="Expand left pane" title="Expand left pane">${EXPAND('M4 4v16M20 12H9m4-4-4 4 4 4')}</button><span class="stage-grip">${GRIP}</span><button type="button" class="stage-expand" data-expand="right" aria-label="Expand right pane" title="Expand right pane">${EXPAND('M20 4v16M4 12h11m-4-4 4 4-4 4')}</button></div></div>` : ''}<div class="stage-question"><div class="stage-strip"><span>${props.number}</span>${props.onStrike && !q.spr ? `<button type="button" class="stage-strike-toggle" aria-pressed="false" title="Cross out answer choices" aria-label="Cross out answer choices"><s>ABC</s></button>` : ''}</div>${single && split.context ? `<div class="passage">${split.context}</div>` : ''}<div class="lesson-stem">${split.body}</div>${q.spr ? '<div class="gridin-wrap"><label for="lesson-grid">Grid-in</label><input class="gridin" id="lesson-grid" type="text" inputmode="decimal" maxlength="32" autocomplete="off"><button id="lesson-pick" type="button">Select</button><p class="spr-preview">Answer preview: <output id="lesson-preview"></output></p></div>' : `<div class="choices">${q.choices.map(c => { const letter = escapeHTML(c.letter); return `<div class="stage-choice" data-choice="${letter}"><button type="button" data-lesson-choice="${letter}" aria-pressed="false">${Renderer.choiceHTML(q, c, null, true)}</button>${props.onStrike ? `<button type="button" class="stage-strike" data-strike="${letter}" aria-pressed="false" aria-label="Cross out choice ${letter}"><span class="stage-strike-letter">${letter}</span><span class="stage-strike-undo">Undo</span></button>` : ''}</div>`; }).join('')}</div>`}</div>`;
    ready.current = false;
    let alive = true, highlighted = false;
    // The stage reflows with its container; ink and laser are content-anchored, so just repaint
    // (after re-clamping the split to the new width).
    const resize = () => { if (divider) setSplit(splitAt); paint(); };
    const divider = el.querySelector<HTMLElement>('.stage-divider');
    const setSplit = (at: number) => {
      const [lo, hi] = bounds(el.clientWidth || 1);
      splitAt = Math.min(hi, Math.max(lo, at));
      el.style.setProperty('--split', `${(splitAt * 100).toFixed(2)}%`);
      divider?.setAttribute('aria-valuenow', String(Math.round(splitAt * 100)));
      divider?.querySelectorAll<HTMLElement>('[data-expand]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.expand === 'left' ? splitAt >= hi : splitAt <= lo)));
    };
    if (divider) setSplit(splitAt);
    // The divider owns its pointer gestures so the presenter's pen/highlight handlers on the card never see them.
    const drag = (event: PointerEvent) => {
      if ((event.target as Element).closest('.stage-expand')) { event.stopPropagation(); return; }
      event.preventDefault(); event.stopPropagation();
      divider!.setPointerCapture(event.pointerId);
      el.classList.add('stage-resizing');
    };
    const dragMove = (event: PointerEvent) => {
      if (!divider!.hasPointerCapture(event.pointerId)) return;
      event.stopPropagation();
      const r = el.getBoundingClientRect();
      setSplit((event.clientX - r.left) / r.width);
    };
    const dragEnd = (event: PointerEvent) => { event.stopPropagation(); el.classList.remove('stage-resizing'); };
    const divClick = (event: MouseEvent) => {
      const expand = (event.target as Element).closest<HTMLElement>('[data-expand]');
      if (!expand) return;
      const [lo, hi] = bounds(el.clientWidth || 1), left = expand.dataset.expand === 'left';
      setSplit(left ? (splitAt >= hi ? 0.5 : hi) : (splitAt <= lo ? 0.5 : lo));
    };
    const divKey = (event: KeyboardEvent) => {
      const [lo, hi] = bounds(el.clientWidth || 1);
      const next = { ArrowLeft: splitAt - 0.05, ArrowRight: splitAt + 0.05, Home: lo, End: hi }[event.key];
      if (next === undefined || (event.target as Element).closest('.stage-expand')) return;
      event.preventDefault(); setSplit(next);
    };
    if (divider) {
      divider.addEventListener('pointerdown', drag); divider.addEventListener('pointermove', dragMove);
      divider.addEventListener('pointerup', dragEnd); divider.addEventListener('pointercancel', dragEnd);
      divider.addEventListener('click', divClick); divider.addEventListener('keydown', divKey);
    }
    const observer = new ResizeObserver(resize);
    observer.observe(wrapper); observer.observe(el);
    props.mathify(el);
    const images = [...el.querySelectorAll('img')].map(image => image.decode().catch(() => undefined));
    Promise.all([document.fonts.ready, ...images]).then(() => {
      if (!alive) return;
      ready.current = true;
      el.dataset.ready = 'true';
      resize();
      latest.current.onReady?.(el);
    });
    const click = (event: MouseEvent) => {
      const target = event.target as Element;
      if (target.closest('.stage-strike-toggle')) { latest.current.onStrikeMode?.(); return; }
      const strike = target.closest<HTMLElement>('[data-strike]');
      if (strike) { latest.current.onStrike?.(strike.dataset.strike!); return; }
      // The click that ends a highlight drag inside a choice must not select that choice.
      if (highlighted) { highlighted = false; return; }
      if (!latest.current.active || !window.getSelection()?.isCollapsed) return;
      const button = target.closest<HTMLButtonElement>('[data-lesson-choice]');
      if (button) latest.current.onSelect?.(button.dataset.lessonChoice!);
      if ((event.target as Element).closest('#lesson-pick')) latest.current.onSelect?.(el.querySelector<HTMLInputElement>('#lesson-grid')!.value.trim());
    };
    const input = () => {
      const value = el.querySelector<HTMLInputElement>('#lesson-grid')?.value.trim() || '';
      const preview = el.querySelector<HTMLOutputElement>('#lesson-preview');
      if (preview) preview.value = value;
      if (latest.current.active && /^[-\d./]{1,32}$/.test(value)) latest.current.onSelect?.(value);
    };
    const pointerup = (event: PointerEvent) => {
      if (!latest.current.onPrivate || (event.target as Element).closest('.badge')) return;
      const anchor = Ink.anchor(el, window.getSelection());
      if (!anchor) return;
      latest.current.onPrivate({ type: 'highlight', id: crypto.randomUUID(), ...anchor, color: '#75dbaa' });
      window.getSelection()?.removeAllRanges();
      highlighted = true;
    };
    const pointerdown = () => { highlighted = false; };
    el.addEventListener('click', click); el.addEventListener('input', input); el.addEventListener('pointerup', pointerup); el.addEventListener('pointerdown', pointerdown);
    resize();
    return () => { alive = false; ready.current = false; observer.disconnect(); el.removeEventListener('click', click); el.removeEventListener('input', input); el.removeEventListener('pointerup', pointerup); el.removeEventListener('pointerdown', pointerdown); };
  }, [props.question.id]);
  useLayoutEffect(() => {
    const el = card.current!;
    el.querySelectorAll<HTMLButtonElement>('[data-lesson-choice]').forEach(button => {
      const letter = button.dataset.lessonChoice;
      const choice = button.querySelector<HTMLElement>('.choice')!;
      button.disabled = !props.active;
      button.setAttribute('aria-pressed', String(letter === props.picked));
      choice.classList.toggle('sel', !props.revealed && letter === props.picked);
      choice.classList.toggle('right', !!props.revealed && letter === props.question.answer);
      choice.classList.toggle('wrong', !!props.revealed && letter === props.picked && letter !== props.question.answer);
      choice.querySelector('.stage-verdict')?.remove();
      if (props.revealed && (letter === props.question.answer || letter === props.picked)) {
        const icon = document.createElement('span'); icon.className = 'stage-verdict';
        const source = document.getElementById(letter === props.question.answer ? 'lesson-check-icon' : 'lesson-x-icon');
        if (source?.firstElementChild) icon.append(source.firstElementChild.cloneNode(true));
        choice.querySelector('.badge')!.before(icon);
      }
    });
    const grid = el.querySelector<HTMLInputElement>('#lesson-grid');
    if (grid) {
      grid.disabled = !props.active;
      if (document.activeElement !== grid) grid.value = props.picked || '';
      el.querySelector<HTMLOutputElement>('#lesson-preview')!.value = grid.value;
      el.querySelector<HTMLButtonElement>('#lesson-pick')!.disabled = !props.active;
    }
  }, [props.active, props.picked, props.revealed, props.question.answer]);
  useLayoutEffect(() => {
    const el = card.current!;
    el.classList.toggle('strike-on', !!props.strikeMode);
    el.querySelector('.stage-strike-toggle')?.setAttribute('aria-pressed', String(!!props.strikeMode));
    el.querySelectorAll<HTMLElement>('.stage-choice').forEach(row => {
      const letter = row.dataset.choice!, struck = !!props.struck?.includes(letter);
      row.classList.toggle('struck', struck);
      const button = row.querySelector<HTMLButtonElement>('[data-strike]');
      if (!button) return;
      button.setAttribute('aria-pressed', String(struck));
      button.setAttribute('aria-label', struck ? `Undo cross out of choice ${letter}` : `Cross out choice ${letter}`);
    });
  }, [props.strikeMode, props.struck]);
  useLayoutEffect(() => { card.current!.classList.toggle('tool-highlight', !!props.annotating); }, [props.annotating]);
  useLayoutEffect(paint, [props.marks, props.privateMarks]);
  return <div className="stage-host" ref={host}><div id={props.id || 'lesson-card'} ref={card} /></div>;
}

export function followStage(card: HTMLElement, mark: Mark) {
  if (mark.type !== 'stroke') { Ink.follow(card, mark); return; }
  const y = Ink.strokePoints(card, mark).at(-1)?.[1];
  const scroller = card.closest('#lesson-live');
  if (y == null || !scroller) return;
  const rect = card.getBoundingClientRect();
  const view = scroller.getBoundingClientRect();
  const top = rect.top + y * (rect.height / card.offsetHeight || 1);
  if (top < view.top + 100 || top > view.bottom - 80) scroller.scrollBy({ top: top - view.top - view.height / 2 });
}
