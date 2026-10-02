import { useLayoutEffect, useRef } from 'react';
import * as Renderer from '/shared/renderer.js';
import * as Ink from '/shared/annotations.js';
import * as Figure from '/shared/figure.js';
import type { Mark, Question } from './types';

import { escapeHTML } from './escape';
export { escapeHTML } from './escape';

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
  // Student views only: shows Report in the question bar and hands the card on screen to the caller.
  onReport?: (card: HTMLDivElement) => void;
  onPrivate?: (mark: Mark) => void;
  // Highlighter tool active: cursor styling only.
  annotating?: boolean;
  // Private process-of-elimination state; the Stage only renders it.
  strikeMode?: boolean;
  struck?: string[];
  // Choices the instructor crossed out for the whole class, drawn apart from the student's own.
  eliminated?: string[];
  onStrikeMode?: () => void;
  onStrike?: (letter: string) => void;
  // Practice bank only. Choices (or grid-in values) answered wrong and not yet solved: red and disabled, the right one is
  // never revealed from here.
  missed?: string[];
  // "Mark for Review" in the question bar.
  flagged?: boolean;
  onFlag?: () => void;
  // Grid-in: every edit of the field (the bank enables Check from it), Enter in the field, and no separate Select button.
  onDraft?: (value: string) => void;
  // The browser's `change` of the field (blur or Enter with a new value): a committed grid value, not every keystroke.
  onCommit?: (value: string) => void;
  onEnter?: () => void;
  noPick?: boolean;
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
    Ink.textBoxes(card.current, p.marks || []);
    Ink.refreshLaser(card.current);
  };
  useLayoutEffect(() => {
    const el = card.current!, wrapper = host.current!;
    const q = props.question;
    const at = q.section !== 'Math' ? q.stem_html.indexOf('<h3>Prompt</h3>') : -1;
    const math = q.section === 'Math';
    const split = at >= 0
      ? { context: Renderer.renderStem({ stem_html: q.stem_html.slice(0, at) }), body: Renderer.renderStem({ stem_html: q.stem_html.slice(at + 15) }) }
      : math ? Renderer.mathStem(Renderer.renderStem(q), document) : Renderer.splitContext(Renderer.renderStem(q), document);
    // Passage, or a table (math) / figure (reading) split out of the stem, goes in the left pane of a fixed
    // 50/50 split (Bluebook's default). A math figure stays in the question column in its viewer frame.
    const single = !split.context;
    el.className = `lesson-stage ${math ? 'stage-math' : ''} ${single ? 'stage-single' : `stage-split ${math ? 'stage-figure' : 'stage-reading'}`}`;
    el.innerHTML = `${!single ? `<div class="stage-passage"><div class="passage">${split.context}</div></div>` : ''}<div class="stage-question"><div class="stage-strip"><span>${props.number}</span>${props.onFlag ? `<button type="button" class="stage-flag" id="stage-flag" aria-pressed="false"><svg viewBox="0 0 24 24" width="1em" height="1em" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round" aria-hidden="true"><path d="m19 21-7-4-7 4V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v16z"/></svg> <span>Mark for Review</span></button>` : ''}${props.onReport ? '<button type="button" class="stage-report" id="stage-report"><span aria-hidden="true">&#9872;</span> Report</button>' : ''}${props.onStrike && !q.spr ? `<button type="button" class="stage-strike-toggle" aria-pressed="false" title="Cross out answer choices" aria-label="Cross out answer choices"><s>ABC</s></button>` : ''}</div>${single && split.context ? `<div class="passage">${split.context}</div>` : ''}<div class="lesson-stem">${split.body}</div>${q.spr ? '<div class="gridin-wrap"><label for="lesson-grid">Grid-in</label><input class="gridin" id="lesson-grid" type="text" inputmode="decimal" maxlength="32" autocomplete="off">' + (props.noPick ? '' : '<button id="lesson-pick" type="button">Select</button>') + '<p class="spr-preview">Answer preview: <output id="lesson-preview"></output></p></div>' : `<div class="choices">${q.choices.map(c => { const letter = escapeHTML(c.letter); return `<div class="stage-choice" data-choice="${letter}"><button type="button" data-lesson-choice="${letter}" aria-pressed="false">${Renderer.choiceHTML(q, c, null, true)}</button>${props.onStrike ? `<button type="button" class="stage-strike" data-strike="${letter}" aria-pressed="false" aria-label="Cross out choice ${letter}"><span class="stage-strike-letter">${letter}</span><span class="stage-strike-undo">Undo</span></button>` : ''}</div>`; }).join('')}</div>`}</div>`;
    ready.current = false;
    let alive = true, highlighted = false;
    // The stage reflows with its container; ink and laser are content-anchored, so just repaint.
    const observer = new ResizeObserver(paint);
    observer.observe(wrapper); observer.observe(el);
    // Browser zoom changes the CSS size (ResizeObserver) and always the pixel ratio; a ratio change with an
    // unchanged box (or a stale canvas after a reflow that landed between observations) still needs a repaint.
    let ratio: MediaQueryList | null = null;
    const onRatio = () => { paint(); watchRatio(); };
    const watchRatio = () => { ratio?.removeEventListener('change', onRatio); ratio = matchMedia(`(resolution: ${window.devicePixelRatio}dppx)`); ratio.addEventListener('change', onRatio); };
    watchRatio();
    window.addEventListener('resize', paint);
    // A figure zoom/pan moves figure-anchored ink with it: redraw the canvas and laser only, once a frame.
    let figureFrame = 0;
    const onFigure = () => {
      if (figureFrame) return;
      figureFrame = requestAnimationFrame(() => {
        figureFrame = 0;
        if (!ready.current) return;
        Ink.overlay(el, latest.current.marks || []);
        Ink.textBoxes(el, latest.current.marks || []);
        Ink.refreshLaser(el);
      });
    };
    el.addEventListener('fv:change', onFigure);
    // A new scale from an ancestor transform (presenter fit) keeps the layout: only the canvas store and laser follow.
    el.addEventListener('stage:scale', onFigure);
    props.mathify(el);
    const images = [...el.querySelectorAll('img')].map(image => image.decode().catch(() => undefined));
    Promise.all([document.fonts.ready, ...images]).then(() => {
      if (!alive) return;
      // Student screens (a lesson footer below): the figure must not push the first choice under it.
      const stem = el.querySelector<HTMLElement>('.lesson-stem'), footer = el.closest('#lesson-live, #bank-live')?.querySelector('.lesson-footer');
      if (stem && footer && stem.querySelector('.fv'))
        Figure.fitFigures(stem, () => el.querySelector('[data-lesson-choice], #lesson-grid'), () => footer.getBoundingClientRect().top);
      ready.current = true;
      el.dataset.ready = 'true';
      paint();
      latest.current.onReady?.(el);
    });
    const click = (event: MouseEvent) => {
      const target = event.target as Element;
      if (target.closest('.stage-report')) { latest.current.onReport?.(el); return; }
      if (target.closest('.stage-flag')) { latest.current.onFlag?.(); return; }
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
      latest.current.onDraft?.(value);
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
    const keydown = (event: KeyboardEvent) => { if (event.key === 'Enter' && (event.target as Element).id === 'lesson-grid') latest.current.onEnter?.(); };
    const change = (event: Event) => { const t = event.target as HTMLInputElement; if (t.id === 'lesson-grid') latest.current.onCommit?.(t.value.trim()); };
    el.addEventListener('keydown', keydown); el.addEventListener('change', change);
    el.addEventListener('click', click); el.addEventListener('input', input); el.addEventListener('pointerup', pointerup); el.addEventListener('pointerdown', pointerdown);
    paint();
    return () => { alive = false; ready.current = false; cancelAnimationFrame(figureFrame); el.removeEventListener('fv:change', onFigure); el.removeEventListener('stage:scale', onFigure); observer.disconnect(); ratio?.removeEventListener('change', onRatio); window.removeEventListener('resize', paint); el.removeEventListener('keydown', keydown); el.removeEventListener('change', change); el.removeEventListener('click', click); el.removeEventListener('input', input); el.removeEventListener('pointerup', pointerup); el.removeEventListener('pointerdown', pointerdown); };
  }, [props.question.id]);
  useLayoutEffect(() => {
    const el = card.current!;
    el.querySelectorAll<HTMLButtonElement>('[data-lesson-choice]').forEach(button => {
      const letter = button.dataset.lessonChoice;
      const choice = button.querySelector<HTMLElement>('.choice')!;
      const missed = !!letter && !!props.missed?.includes(letter);
      button.disabled = !props.active || missed;
      button.setAttribute('aria-pressed', String(letter === props.picked));
      choice.classList.toggle('sel', !props.revealed && !missed && letter === props.picked);
      choice.classList.toggle('right', !!props.revealed && letter === props.question.answer);
      choice.classList.toggle('wrong', missed || (!!props.revealed && letter === props.picked && letter !== props.question.answer));
      choice.querySelector('.stage-verdict')?.remove();
      if (missed || (props.revealed && (letter === props.question.answer || letter === props.picked))) {
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
      const pickButton = el.querySelector<HTMLButtonElement>('#lesson-pick');
      if (pickButton) pickButton.disabled = !props.active;
    }
  }, [props.active, props.picked, props.revealed, props.question.answer, props.missed]);
  useLayoutEffect(() => {
    const el = card.current!;
    el.classList.toggle('strike-on', !!props.strikeMode);
    el.querySelector('.stage-strike-toggle')?.setAttribute('aria-pressed', String(!!props.strikeMode));
    el.querySelectorAll<HTMLElement>('.stage-choice').forEach(row => {
      const letter = row.dataset.choice!, struck = !!props.struck?.includes(letter), eliminated = !!props.eliminated?.includes(letter);
      row.classList.toggle('struck', struck);
      row.classList.toggle('eliminated', eliminated);
      if (eliminated) row.title = 'Crossed out by your instructor'; else row.removeAttribute('title');
      const button = row.querySelector<HTMLButtonElement>('[data-strike]');
      if (!button) return;
      button.setAttribute('aria-pressed', String(struck));
      button.setAttribute('aria-label', struck ? `Undo cross out of choice ${letter}` : `Cross out choice ${letter}`);
    });
  }, [props.strikeMode, props.struck, props.eliminated]);
  useLayoutEffect(() => { card.current!.classList.toggle('tool-highlight', !!props.annotating); }, [props.annotating]);
  useLayoutEffect(() => { card.current!.querySelector('.stage-flag')?.setAttribute('aria-pressed', String(!!props.flagged)); }, [props.flagged]);
  useLayoutEffect(paint, [props.marks, props.privateMarks]);
  return <div className="stage-host" ref={host}><div id={props.id || 'lesson-card'} ref={card} /></div>;
}

export function followStage(card: HTMLElement, mark: Mark) {
  if (mark.type !== 'stroke') { Ink.follow(card, mark); return; }
  const y = Ink.strokePoints(card, mark).at(-1)?.[1];
  const scroller = card.closest('#lesson-live, #bank-live');
  if (y == null || !scroller) return;
  const rect = card.getBoundingClientRect();
  const view = scroller.getBoundingClientRect();
  const top = rect.top + y * (rect.height / card.offsetHeight || 1);
  if (top < view.top + 100 || top > view.bottom - 80) scroller.scrollBy({ top: top - view.top - view.height / 2 });
}
