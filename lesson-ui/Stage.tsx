import { useLayoutEffect, useRef } from 'react';
import * as Renderer from '/shared/renderer.js';
import * as Ink from '/shared/annotations.js';
import type { Mark, Laser, Question } from './types';

export const LOGICAL_WIDTH = 1240;
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
  laser?: Laser | null;
  mathify: (element: HTMLElement) => void;
  onSelect?: (answer: string) => void;
  onReady?: (card: HTMLDivElement) => void;
  onPrivate?: (mark: Mark) => void;
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
    (Ink.overlay as (card: HTMLElement, marks: Mark[], laser: Laser | null) => void)(card.current, p.marks || [], p.laser || null);
  };
  useLayoutEffect(() => {
    const el = card.current!, wrapper = host.current!;
    const q = props.question;
    const at = q.section !== 'Math' ? q.stem_html.indexOf('<h3>Prompt</h3>') : -1;
    const split = at >= 0
      ? { context: Renderer.renderStem({ stem_html: q.stem_html.slice(0, at) }), body: Renderer.renderStem({ stem_html: q.stem_html.slice(at + 15) }) }
      : Renderer.splitContext(Renderer.renderStem(q), document);
    const math = q.section === 'Math';
    const single = math || !split.context;
    el.className = `lesson-stage ${math ? 'stage-math' : ''} ${single ? 'stage-single' : 'stage-reading'}`;
    el.innerHTML = `${!single ? `<div class="stage-passage"><div class="passage">${split.context}</div></div>` : ''}<div class="stage-question"><div class="stage-strip"><span>${props.number}</span>${props.onStrike && !q.spr ? `<button type="button" class="stage-strike-toggle" aria-pressed="false" title="Cross out answer choices" aria-label="Cross out answer choices"><s>ABC</s></button>` : ''}</div>${single && split.context ? `<div class="passage">${split.context}</div>` : ''}<div class="lesson-stem">${split.body}</div>${q.spr ? '<div class="gridin-wrap"><label for="lesson-grid">Grid-in</label><input class="gridin" id="lesson-grid" type="text" inputmode="decimal" maxlength="32" autocomplete="off"><button id="lesson-pick" type="button">Select</button><p class="spr-preview">Answer preview: <output id="lesson-preview"></output></p></div>' : `<div class="choices">${q.choices.map(c => { const letter = escapeHTML(c.letter); return `<div class="stage-choice" data-choice="${letter}"><button type="button" data-lesson-choice="${letter}" aria-pressed="false">${Renderer.choiceHTML(q, c, null, true)}</button>${props.onStrike ? `<button type="button" class="stage-strike" data-strike="${letter}" aria-pressed="false" aria-label="Cross out choice ${letter}"><span class="stage-strike-letter">${letter}</span><span class="stage-strike-undo">Undo</span></button>` : ''}</div>`; }).join('')}</div>`}</div>`;
    ready.current = false;
    let alive = true;
    const resize = () => {
      const scale = Math.min(1, wrapper.clientWidth / LOGICAL_WIDTH);
      el.style.transform = `scale(${scale})`;
      wrapper.style.height = `${el.offsetHeight * scale}px`;
      paint();
    };
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
    const pointerup = () => {
      if (!latest.current.onPrivate) return;
      const anchor = Ink.anchor(el, window.getSelection());
      if (!anchor) return;
      latest.current.onPrivate({ type: 'highlight', id: crypto.randomUUID(), ...anchor, color: '#75dbaa' });
      window.getSelection()?.removeAllRanges();
    };
    el.addEventListener('click', click); el.addEventListener('input', input); el.addEventListener('pointerup', pointerup);
    resize();
    return () => { alive = false; ready.current = false; observer.disconnect(); el.removeEventListener('click', click); el.removeEventListener('input', input); el.removeEventListener('pointerup', pointerup); };
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
  useLayoutEffect(paint, [props.marks, props.privateMarks, props.laser]);
  return <div className="stage-host" ref={host}><div id={props.id || 'lesson-card'} ref={card} /></div>;
}

export function followStage(card: HTMLElement, mark: Mark) {
  if (mark.type !== 'stroke') { Ink.follow(card, mark); return; }
  const y = mark.points?.at(-1)?.[1];
  const scroller = card.closest('#lesson-live');
  if (y == null || !scroller) return;
  const rect = card.getBoundingClientRect();
  const view = scroller.getBoundingClientRect();
  const top = rect.top + y * rect.height;
  if (top < view.top + 100 || top > view.bottom - 80) scroller.scrollBy({ top: top - view.top - view.height / 2 });
}
