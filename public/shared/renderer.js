// Same stem/choice markup used by practice, Browse and read-only admin previews.
import { isRight } from './stats.js';
import * as Figure from './figure.js';
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]));
const H3_LABEL = /<h3>\s*(?:Passage|Prompt|Question)\s*<\/h3>/gi;
export function splitContext(html, document) {
  const d = document.createElement('div'); d.innerHTML = html;
  const ctx = document.createElement('div');
  d.querySelectorAll('.qfig, .qtable, .qimg').forEach(n => ctx.appendChild(n));
  return { context: ctx.innerHTML.trim(), body: d.innerHTML.trim() };
}
// Math: figures stay where they are authored in the question column, each in its own viewer frame;
// only tables and legacy .qimg blocks go to the context pane.
export function mathStem(html, document) {
  const d = document.createElement('div'); d.innerHTML = html;
  const ctx = document.createElement('div');
  d.querySelectorAll('.qtable, .qimg').forEach(n => ctx.appendChild(n));
  Figure.install(document);
  Figure.wrapFigures(d);
  // A figure authored after all the text (2 of the bank's 323) would sit below the question: put it above
  // the last text block instead.
  const blocks = [...d.children], trailing = [];
  for (let k = blocks.length - 1; k >= 0 && blocks[k].classList.contains('fv'); k--) trailing.unshift(blocks[k]);
  if (trailing.length && trailing.length < blocks.length) blocks[blocks.length - trailing.length - 1].before(...trailing);
  return { context: ctx.innerHTML.trim(), body: d.innerHTML.trim() };
}
export function renderStem(q) {
  return (q.stem_html || '').replace(/<blockquote[^>]*>[\s\S]*?<\/blockquote>/gi, '').replace(H3_LABEL, '');
}
// Both Browse and admin inspect the same read-only question markup.
export function previewHTML(q, document, picked) {
  const raw = q.stem_html || '';
  const at = q.section !== 'Math' ? raw.indexOf('<h3>Prompt</h3>') : -1;
  const stem = at >= 0 ? { context: renderStem({ stem_html: raw.slice(0, at) }), body: renderStem({ stem_html: raw.slice(at + 15) }) }
    : q.section === 'Math' ? mathStem(renderStem(q), document) : { context: '', body: renderStem(q) };
  return `<div class="cb" style="max-height:56vh;overflow-y:auto;">${stem.context ? `<div class="passage">${stem.context}</div>` : ''}
    ${stem.body}<div class="choices" style="margin-top:16px;">${q.choices.map(c => choiceHTML(q, c, null, true)).join('')}</div>
    ${q.spr ? picked === undefined ? `<div class="ans-line" style="margin-top:14px;">Answer: ${esc(q.answer) || '(see image)'}</div>`
      : `<div class="gridin-wrap"><label>Grid-in (SPR) <input class="gridin" type="text" disabled value="${esc(picked || '')}"></label></div>` : ''}</div>
    <div class="cb expl" style="margin-top:14px;color:var(--dim);font-size:13.5px;">${q.explanation_html || ''}</div>`;
}
export function choiceHTML(q, c, picked, staticMode, S = {}, PROG = {}) {
  const letter = c.letter || '?';
  let body = '';
  if (c.img) body = `<img src="${esc(c.img)}" alt="Choice ${esc(letter)}">`;
  else body = `<span>${(c.content || '').replace(/<p>/gi, '').replace(/<\/p>/gi, '')}</span>`;
  const checked = !staticMode && S.checked[q.id];
  let cls = 'choice';
  if (!staticMode) {
    if (picked === letter && !checked) cls += ' sel';
    if (!checked && (S.miss[q.id] || []).includes(letter)) cls += ' wrong';
    if (checked) {
      const prog = PROG[q.id];
      const wasWrong = prog && prog.marker === 'Red';
      const nowCorrect = isRight(q, letter);
      if (nowCorrect === null) cls += (picked === letter ? ' sel' : ' dim');
      else if (nowCorrect && wasWrong) cls += ' corrected';
      else if (nowCorrect) cls += ' right';
      else if (picked === letter || (S.miss[q.id] || []).includes(letter)) cls += ' wrong';
      else cls += ' dim';
    }
  }
  const ko = !staticMode && S.ko[q.id] && S.ko[q.id].includes(letter);
  if (ko) cls += ' ko';
  return `<div class="choice-row"><div class="${cls}" data-letter="${esc(letter)}">
    <span class="badge">${esc(letter)}</span>
    <span style="flex:1; min-width:0;">${body}</span>
    ${staticMode || checked || picked !== letter ? '' : `<button class="chk-btn" data-chk="${esc(letter)}">Check</button>`}
  </div>${staticMode ? '' : `<button class="ko-btn${ko ? ' on' : ''}" data-ko="${esc(letter)}" title="Eliminate choice"><s>${esc(letter)}</s></button>`}</div>`;
}
