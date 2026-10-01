// "Report a problem" and "Suggest a feature": capture, dialog and send, shared by the question bank
// (public/index.html) and the lesson views (lesson-ui). The caller supplies send(path, data) so the
// account's auth headers stay in one place. Nothing here reads or sends a screenshot.
export const CATEGORIES = [['formatting', 'Formatting / display'], ['wrong_answer', 'Wrong answer or explanation'], ['typo', 'Typo'], ['other', 'Other']];
export const AREAS = [['bank', 'Question bank'], ['lessons', 'Lessons'], ['plan', 'Study plan'], ['other', 'Other']];
// The Worker refuses more than 100 000 characters; keep clear of that and say so in the data.
const MAX_HTML = 99000;
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// The question as the student sees it, as HTML. Successfully rendered KaTeX is collapsed back to its TeX (about a tenth of the
// size, and it is what a fix would have to edit); a KaTeX error node is left as rendered, since that is the bug to look at.
export function renderedHTML(element) {
  const clone = element.cloneNode(true);
  clone.querySelectorAll('.rpt-skip, .report-btn, .stage-report, .stage-flag, canvas').forEach(n => n.remove());
  for (const k of [...clone.querySelectorAll('.katex')]) {
    const tex = k.querySelector('annotation[encoding="application/x-tex"]');
    if (!tex) continue;
    const display = k.parentElement && k.parentElement.classList.contains('katex-display');
    (display ? k.parentElement : k).replaceWith(clone.ownerDocument.createTextNode(display ? `\\[${tex.textContent}\\]` : `\\(${tex.textContent}\\)`));
  }
  const html = clone.innerHTML;
  return html.length > MAX_HTML ? html.slice(0, MAX_HTML) + '<!-- truncated -->' : html;
}
// Viewport and zoom. Browsers do not expose page zoom directly; outer/inner width is the usual estimate.
export function viewportInfo(win = window) {
  const r2 = n => Math.round(n * 100) / 100;
  return { viewport: { w: win.innerWidth, h: win.innerHeight }, zoom: win.outerWidth > 0 && win.innerWidth > 0 ? r2(win.outerWidth / win.innerWidth) : null, dpr: r2(win.devicePixelRatio || 1) };
}
export function reportPayload({ questionId, seenIn, sessionId, element, category, note }) {
  return { question_id: questionId, category, note: note || '', seen_in: seenIn, ...(sessionId ? { session_id: sessionId } : {}), ...viewportInfo(), html: renderedHTML(element) };
}

const CSS = `
dialog.rpt { border: 1px solid var(--border, #e5e7eb); border-radius: 14px; padding: 0; background: var(--panel, #fff); color: var(--text, #111827); width: min(480px, 92vw); font: 14px/1.45 var(--sans, system-ui, sans-serif); box-shadow: 0 20px 50px rgba(0,0,0,.28); }
dialog.rpt::backdrop { background: rgba(17,24,39,.45); }
.rpt-body { padding: 20px 22px; display: grid; gap: 12px; }
.rpt h2 { margin: 0; font-size: 17px; }
.rpt fieldset { border: 0; margin: 0; padding: 0; display: grid; gap: 4px; }
.rpt legend { padding: 0; margin-bottom: 4px; font-weight: 600; }
.rpt label.rpt-opt { display: flex; align-items: center; gap: 8px; padding: 6px 8px; border-radius: 8px; cursor: pointer; }
.rpt label.rpt-opt:hover { background: var(--bg2, #f3f4f6); }
.rpt textarea, .rpt select { width: 100%; box-sizing: border-box; font: inherit; color: inherit; background: var(--panel, #fff); border: 1px solid var(--border2, #d1d5db); border-radius: 8px; padding: 8px 10px; }
.rpt textarea { min-height: 84px; resize: vertical; }
.rpt-row { display: flex; gap: 8px; justify-content: flex-end; }
.rpt-row button { font: inherit; font-weight: 600; padding: 8px 14px; border-radius: 8px; border: 1px solid var(--border2, #d1d5db); background: var(--panel, #fff); color: inherit; cursor: pointer; }
.rpt-row button.rpt-go { background: var(--blue, #2563eb); border-color: var(--blue, #2563eb); color: #fff; }
.rpt-row button:disabled { opacity: .5; cursor: default; }
.rpt-status { min-height: 1.2em; margin: 0; color: var(--red, #dc2626); }
.rpt-thanks { margin: 0; font-size: 15px; }
.rpt-thanks::before { content: '\\2713  '; color: var(--green, #16a34a); font-weight: 700; }
.report-btn, .stage-report { display: inline-flex; align-items: center; gap: 6px; cursor: pointer; }
`;
function shell(title, id, build) {
  if (!document.getElementById('rpt-style')) { const s = document.createElement('style'); s.id = 'rpt-style'; s.textContent = CSS; document.head.append(s); }
  document.querySelectorAll('dialog.rpt').forEach(d => d.remove());
  const dialog = document.createElement('dialog');
  dialog.className = 'rpt'; dialog.id = id; dialog.setAttribute('aria-label', title);
  dialog.innerHTML = `<div class="rpt-body"><h2>${esc(title)}</h2>${build}<p class="rpt-status" role="alert"></p></div>`;
  document.body.append(dialog);
  const close = () => { dialog.close(); dialog.remove(); };
  dialog.addEventListener('cancel', e => { e.preventDefault(); close(); });
  dialog.showModal();
  return { dialog, close, status: dialog.querySelector('.rpt-status') };
}
const REPORT_ERRORS = { 401: 'Please sign in again.', 409: 'You already have an open report on this question. Thanks, we are looking at it.', 429: 'You have reached today’s limit for reports. Try again tomorrow.' };
const SUGGEST_ERRORS = { 401: 'Please sign in again.', 429: 'You have reached today’s limit for suggestions. Try again tomorrow.' };
const FAILED = 'Could not send that. Check your connection and try again.';

// opts: { questionId, seenIn: 'bank' | 'lesson' | 'history', sessionId?, element, send }
export function openReport(opts) {
  const { dialog, close, status } = shell('Report a problem with this question', 'rpt-dialog', `
    <fieldset><legend>What is wrong?</legend>${CATEGORIES.map(([value, label]) => `<label class="rpt-opt"><input type="radio" name="rpt-category" value="${value}"> ${esc(label)}</label>`).join('')}</fieldset>
    <label for="rpt-note">Note (optional)</label><textarea id="rpt-note" maxlength="1000" placeholder="What did you see?"></textarea>
    <div class="rpt-row"><button type="button" id="rpt-cancel">Cancel</button><button type="button" class="rpt-go" id="rpt-send" disabled>Send report</button></div>`);
  const send = dialog.querySelector('#rpt-send');
  dialog.querySelectorAll('input[name=rpt-category]').forEach(r => r.addEventListener('change', () => { send.disabled = false; }));
  dialog.querySelector('#rpt-cancel').onclick = close;
  send.onclick = async () => {
    const category = dialog.querySelector('input[name=rpt-category]:checked')?.value;
    if (!category) return;
    send.disabled = true; status.textContent = '';
    // Captured now, from the card on screen: it is the state the student is reporting.
    const payload = reportPayload({ questionId: opts.questionId, seenIn: opts.seenIn, sessionId: opts.sessionId, element: opts.element, category, note: dialog.querySelector('#rpt-note').value.trim() });
    const r = await opts.send('/api/reports', payload);
    if (r.status === 200) {
      dialog.querySelector('.rpt-body').innerHTML = '<h2>Report a problem with this question</h2><p class="rpt-thanks" role="status">Thanks! We will take a look.</p><div class="rpt-row"><button type="button" class="rpt-go" id="rpt-done">Close</button></div>';
      dialog.querySelector('#rpt-done').onclick = close;
      setTimeout(() => dialog.isConnected && close(), 4000);
    } else { status.textContent = REPORT_ERRORS[r.status] || FAILED; send.disabled = false; }
  };
  return dialog;
}

// opts: { send }
export function openSuggest(opts) {
  const { dialog, close, status } = shell('Suggest a feature', 'sug-dialog', `
    <label for="sug-body">What would make this better?</label><textarea id="sug-body" maxlength="2000" placeholder="Describe your idea"></textarea>
    <label for="sug-area">Area (optional)</label><select id="sug-area"><option value="">Not sure</option>${AREAS.map(([value, label]) => `<option value="${value}">${esc(label)}</option>`).join('')}</select>
    <div class="rpt-row"><button type="button" id="sug-cancel">Cancel</button><button type="button" class="rpt-go" id="sug-send" disabled>Send suggestion</button></div>`);
  const text = dialog.querySelector('#sug-body'), send = dialog.querySelector('#sug-send');
  text.addEventListener('input', () => { send.disabled = !text.value.trim(); });
  dialog.querySelector('#sug-cancel').onclick = close;
  send.onclick = async () => {
    send.disabled = true; status.textContent = '';
    const r = await opts.send('/api/suggestions', { body: text.value.trim(), area: dialog.querySelector('#sug-area').value || null });
    if (r.status === 200) {
      dialog.querySelector('.rpt-body').innerHTML = '<h2>Suggest a feature</h2><p class="rpt-thanks" role="status">Thanks! We read every suggestion.</p><div class="rpt-row"><button type="button" class="rpt-go" id="sug-done">Close</button></div>';
      dialog.querySelector('#sug-done').onclick = close;
      setTimeout(() => dialog.isConnected && close(), 4000);
    } else { status.textContent = SUGGEST_ERRORS[r.status] || FAILED; send.disabled = false; }
  };
  text.focus();
  return dialog;
}
