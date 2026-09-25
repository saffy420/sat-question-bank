import { cbSort, DOM_ORDER } from './shared/stats.js';
import { previewHTML } from './shared/renderer.js';
const $ = id => document.getElementById(id);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]));
const fmt = x => x == null ? 'Unavailable' : `${x}%`;
const pct = v => v?.a ? Math.round(v.c / v.a * 100) : null;
const time = x => x == null ? 'Unavailable' : `${Math.round(x / 1000)}s`;
const date = x => x || 'Unavailable';
const body = $('body'), message = $('message');
let listPage = 1, historyPage = 1, search = '', sort = 'name', ascending = true, detail = null, tab = 'Overview', viewToken = 0;
const tabs = ['Overview', 'By skill', 'Mistakes', 'Traps', 'Pacing', 'Second-guessing', 'History', 'Lessons'];
const api = async (url, method = 'GET', data) => { const r = await fetch(url, { method, ...(data === undefined ? {} : { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) }) }); if (r.status === 401) { location.replace('/login'); throw Error('Sign in required'); } if (r.status === 403) { location.replace('/app'); throw Error('Admin access required'); } if (!r.ok) throw Error((await r.json().catch(() => ({}))).error || `Request failed (${r.status})`); return r.json(); };
const busy = text => { message.textContent = text; body.replaceChildren(); };
const fail = (e, retry = loadList) => { message.textContent = e.message + '. Try again.'; body.innerHTML = '<button id="retry">Retry</button>'; $('retry').onclick = retry; };
const mathify = root => { if (window.renderMathInElement) try { renderMathInElement(root, { delimiters: [{left:'\\(',right:'\\)',display:false},{left:'\\[',right:'\\]',display:true}], throwOnError:false }); } catch { /* malformed authored math must not blank preview */ } };
const row = (label, value, n) => `<div class="metric"><span>${esc(label)}</span><div class="bar"><i style="width:${n == null ? 0 : Math.max(0, Math.min(n, 100))}%"></i></div><strong>${esc(value)}</strong></div>`;
const spark = values => values.length ? `<svg width="100" height="26" viewBox="0 0 100 26" role="img" aria-label="Trend: ${values.map(x => x ? 'correct' : 'missed').join(', ')}"><polyline fill="none" stroke="#265fc7" stroke-width="2" points="${values.map((x,i) => `${values.length === 1 ? 50 : Math.round(i*96/(values.length-1))+2},${x ? 4 : 22}`).join(' ')}"/></svg>` : 'Unavailable';
$('collapse').onclick = () => { const side = $('side'); side.classList.toggle('collapsed'); $('collapse').setAttribute('aria-expanded', String(!side.classList.contains('collapsed'))); };
document.querySelectorAll('[data-section]').forEach(b => b.onclick = async () => {
  if (lesson && b.dataset.section !== 'Lessons') {
    try { while (revision > savedRevision) await saveLesson(); } catch(e) { message.textContent = e.message + '. Retry save before leaving.'; return; }
    clearTimeout(saveTimer); lesson = null; ++filterToken;
  }
  document.querySelectorAll('[data-section]').forEach(x => x.removeAttribute('aria-current'));
  b.setAttribute('aria-current','page'); $('title').textContent = b.dataset.section;
  if (b.dataset.section === 'Students') { detail = null; loadList(); }
   else if (b.dataset.section === 'Lessons') { showLibrary(); }
   else { ++viewToken; message.textContent = ''; body.innerHTML = `<div class="panel">${esc(b.dataset.section)} unavailable until later task.</div>`; }
});
async function loadList() {
  clearTimeout(loadList.timer);
  busy('Loading students…');
  const token = ++viewToken;
  try {
    const data = await api(`/api/admin/students?page=${listPage}&search=${encodeURIComponent(search)}&sort=${sort}&order=${ascending ? 'asc' : 'desc'}`);
    if (token !== viewToken) return;
    message.textContent = `${data.total} club member${data.total === 1 ? '' : 's'} (approved and pending)`;
    body.innerHTML = `<div class="panel"><label>Search name or email <input id="search" value="${esc(search)}" autocomplete="off"></label>
      <table><thead><tr>${[['name','Name'],['done','Questions done'],['accuracy','Overall current accuracy'],['weakest','Weakest skill'],['avgMs','Avg pace vs target'],['guessRate','Second-guess rate'],['lastActive','Last active']].map(([key,label]) => `<th><button data-sort="${key}">${label}${sort === key ? ascending ? ' ↑' : ' ↓' : ''}</button></th>`).join('')}</tr></thead>
      <tbody>${data.students.map(s => `<tr><td><button data-id="${esc(s.id)}">${esc(s.name || s.email || s.id)}</button></td><td>${s.done}</td><td>${fmt(s.accuracy)}</td><td>${esc(s.weakest || 'Unavailable')}</td><td>${s.avgMs == null ? 'Unavailable' : `${time(s.avgMs)} vs ${time(s.targetMs)}`}</td><td>${fmt(s.guessRate == null ? null : Math.round(100*s.guessRate))}</td><td>${esc(date(s.lastActive))}</td></tr>`).join('') || '<tr><td colspan="7">No students found.</td></tr>'}</tbody></table>
      <div class="frow"><button id="prev" ${data.page <= 1 ? 'disabled' : ''}>Previous</button>Page ${data.page} of ${data.pages}<button id="next" ${data.page >= data.pages ? 'disabled' : ''}>Next</button></div></div>`;
    $('search').oninput = e => { search = e.target.value; listPage = 1; clearTimeout(loadList.timer); loadList.timer = setTimeout(loadList, 400); };
    body.querySelectorAll('[data-sort]').forEach(b => b.onclick = () => { ascending = sort === b.dataset.sort ? !ascending : true; sort = b.dataset.sort; listPage = 1; loadList(); });
    body.querySelectorAll('[data-id]').forEach(b => b.onclick = () => openStudent(b.dataset.id));
    $('prev').onclick = () => { listPage--; loadList(); }; $('next').onclick = () => { listPage++; loadList(); };
  } catch(e) { if (token === viewToken) fail(e); }
}
async function openStudent(id) {
  detail = null;
  busy('Loading student…');
  const token = ++viewToken;
  try { const data = await api(`/api/admin/students/${encodeURIComponent(id)}`); if (token !== viewToken) return; detail = data; historyPage = 1; tab = 'Overview'; drawDetail(); }
  catch(e) { if (token === viewToken) fail(e, () => openStudent(id)); }
}
function drawDetail() {
  const { student, stats } = detail, t = stats.tally;
  $('title').textContent = student.name || student.email || student.id;
  message.textContent = `${student.email} · ${t.att} questions done · ${fmt(t.att ? Math.round(100*t.corr/t.att) : null)} current accuracy · Last active: ${date(stats.lastActive)}`;
  body.innerHTML = `<button id="back">← Students</button><div class="panel tabs" role="tablist" aria-label="Student details">${tabs.map(x => `<button role="tab" data-tab="${x}" aria-selected="${tab === x}">${x}</button>`).join('')}</div><div class="panel" id="tab-content" role="tabpanel"></div>`;
  $('back').onclick = () => { detail = null; $('title').textContent = 'Students'; loadList(); };
  body.querySelectorAll('[data-tab]').forEach(b => b.onclick = () => { tab = b.dataset.tab; drawDetail(); });
  if (tab !== 'History') ++viewToken;
  drawTab();
}
function drawTab() {
  const { stats, directions, mistakes } = detail, host = $('tab-content');
  if (tab === 'Overview') {
    const domains = ['Reading & Writing', 'Math'].map(sec => `<h3>${sec}</h3>` + DOM_ORDER.filter(d => sec === 'Math' ? DOM_ORDER.indexOf(d) >= 4 : DOM_ORDER.indexOf(d) < 4).map(d => row(d, `${fmt(pct(stats.tally.dom[d]))} · ${stats.tally.dom[d]?.a || 0} attempted`, pct(stats.tally.dom[d]))).join('')).join('');
    host.innerHTML = `<h2>Current accuracy by domain</h2>${domains}<h2>Historical attempt accuracy by difficulty</h2>${['Easy','Medium','Hard'].map(d => row(d, `${fmt(pct(stats.diff[d]))} · ${stats.diff[d]?.a || 0} attempts`, pct(stats.diff[d]))).join('')}<h2>Weak spots</h2>${Object.entries(stats.skills).filter(([,s]) => s.a).sort((a,b) => a[1].c/a[1].a - b[1].c/b[1].a).slice(0,5).map(([k,v]) => row(k, fmt(pct(v)), pct(v))).join('') || 'No attempts yet.'}`;
  } else if (tab === 'By skill') {
    host.innerHTML = `<h2>Skills · current accuracy; historical timed-attempt mean</h2>${cbSort(Object.keys(stats.skills)).sort((a,b) => (pct(stats.skills[a]) ?? Infinity) - (pct(stats.skills[b]) ?? Infinity)).map(k => { const v = stats.skills[k]; return row(k, `${v.a} attempted · ${fmt(pct(v))} · ${time(v.avgMs)}`, pct(v)) + `<div class="skill-trend" aria-label="${esc(k)} trend">${spark(v.trend)}</div>`; }).join('') || 'No bank skills available.'}`;
  } else if (tab === 'Mistakes') {
    host.innerHTML = `<h2>Mistakes · Red needs work, Orange corrected</h2><div class="frow"><label>Domain <select id="md-domain"><option value="">All</option>${cbSort([...new Set(mistakes.map(m => m.question.domain))]).map(x => `<option>${esc(x)}</option>`).join('')}</select></label><label>Skill <select id="md-skill"><option value="">All</option>${cbSort([...new Set(mistakes.map(m => m.question.skill))]).map(x => `<option>${esc(x)}</option>`).join('')}</select></label><label>Difficulty <select id="md-diff"><option value="">All</option>${['Easy','Medium','Hard'].map(x => `<option>${x}</option>`).join('')}</select></label></div><div id="mistakes"></div><div id="preview"></div>`;
    const filter = () => { const selected = mistakes.filter(m => (!$('md-domain').value || m.question.domain === $('md-domain').value) && (!$('md-skill').value || m.question.skill === $('md-skill').value) && (!$('md-diff').value || m.question.difficulty === $('md-diff').value)); $('mistakes').innerHTML = selected.map(m => `<p><button data-question="${esc(m.question_id)}">${esc(m.question_id)}</button> ${esc(m.marker)} · ${esc(m.question.skill)} · ${esc(m.question.difficulty)}</p>`).join('') || '<p>No mistakes for these filters.</p>'; $('mistakes').querySelectorAll('[data-question]').forEach(b => b.onclick = () => preview(mistakes.find(m => m.question_id === b.dataset.question))); };
    ['md-domain','md-skill','md-diff'].forEach(id => $(id).onchange = filter); filter();
  } else if (tab === 'Traps') {
    host.innerHTML = `<h2>Tagged distractor misses</h2><p class="muted">Counts cover tagged wrong picks only; untagged/blank attempts excluded.</p>${stats.traps.map(([tag,v]) => `<p><strong>${esc(tag)}</strong>: ${v.count} · examples: ${v.examples.map(esc).join(', ')}</p>`).join('') || '<p>Unavailable: no tagged distractor misses (official traps may be untagged).</p>'}`;
  } else if (tab === 'Pacing') {
    const p = stats.pacing, n = p.rushed+p.onPace+p.slow;
    host.innerHTML = `<h2>Timed attempts only · ${n} with time</h2>${['rushed','onPace','slow'].map(k => row(k, `${p[k]} of ${n || 0}`, n ? Math.round(p[k]/n*100) : null)).join('')}<h3>Section</h3>${Object.entries(stats.paceSection).map(([k,v]) => row(k, `${time(v.ms/v.n)} vs target ${time(v.target/v.n)} · ${v.n} timed`, null)).join('') || 'Unavailable'}<h3>Difficulty</h3>${Object.entries(stats.paceDiff).map(([k,v]) => row(k, `${time(v.ms/v.n)} vs target ${time(v.target/v.n)} · ${v.n} timed`, null)).join('') || 'Unavailable'}`;
  } else if (tab === 'Second-guessing') {
    const g = stats.guessing;
    host.innerHTML = `<h2>Answer changes (known: ${g.n})</h2><p>${g.n ? `${g.changedN} changed (${Math.round(g.changedN/g.n*100)}%); mean ${g.mean.toFixed(2)} switches per attempt` : 'Unavailable: no recorded changes.'}</p><p>Changed accuracy: ${fmt(g.changedAcc)} · kept first: ${fmt(g.steadyAcc)}</p><h3>First vs final scored selection per attempt</h3><p>Right-to-wrong: ${directions['right-to-wrong']} · Wrong-to-right: ${directions['wrong-to-right']} · Same correctness: ${directions.unchanged} · Unknown (legacy, blank or unscorable): ${directions.unknown}</p>`;
  } else if (tab === 'History') { loadHistory(); }
  else host.innerHTML = '<h2>Lessons</h2><p>Unavailable until task09. No lesson attendance records yet.</p>';
}
async function loadHistory() {
  const host = $('tab-content'); host.textContent = 'Loading attempts…';
  const token = ++viewToken;
  try { const h = await api(`/api/admin/students/${encodeURIComponent(detail.student.id)}/history?page=${historyPage}`);
    if (token !== viewToken || tab !== 'History') return;
    host.innerHTML = `<h2>Question attempt history · newest first</h2>${h.results.map(x => `<p>${esc(x.ts)} · ${esc(x.question_id)} · ${x.correct ? 'Correct' : 'Incorrect'} · picked ${esc(x.picked || 'blank')} · ${time(x.time_taken_ms)}</p>`).join('') || '<p>No attempts yet.</p>'}<div class="frow"><button id="h-prev" ${h.page <= 1 ? 'disabled' : ''}>Previous</button>Page ${h.page} of ${h.pages} (${h.total} attempts)<button id="h-next" ${h.page >= h.pages ? 'disabled' : ''}>Next</button></div>`;
    $('h-prev').onclick = () => { historyPage--; loadHistory(); }; $('h-next').onclick = () => { historyPage++; loadHistory(); };
  } catch(e) { if (token === viewToken) { host.innerHTML = `<p>${esc(e.message)}</p><button id="h-retry">Retry</button>`; $('h-retry').onclick = loadHistory; } }
}
function preview(m) {
  const q = m.question;
  const host = $('preview');
  host.innerHTML = `<div class="panel preview"><button id="close-preview">Close preview</button><h3>${esc(q.id)} · ${esc(q.section)} · ${esc(q.difficulty)}</h3>${previewHTML(q, document, m.picked)}<p>Student answer: ${esc(m.picked || 'Unavailable')} · Correct answer: ${esc(q.answer || 'Unavailable')}</p></div>`;
  $('close-preview').onclick = () => host.replaceChildren(); mathify(host); $('close-preview').focus();
}
// --- lesson builder helpers ---
const defaultTime = q => q.section === 'Math' ? 90 : 60;
const totalTime = items => items.reduce((n, x) => n + x.time_limit_sec, 0);
const formatTime = sec => `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`;
const parseTime = text => { const m = /^(\d{1,3}):([0-5]\d)$/.exec(text); if (!m) return null; const n = Number(m[1]) * 60 + Number(m[2]); return n >= 5 && n <= 10800 ? n : null; };
// Escape first; only a small markdown subset, never interpret raw HTML.
const notesHTML = text => esc(text).split(/\n\s*\n/).map(block => {
  const lines = block.split('\n');
  const inline = s => s.replace(/(`[^`\n]+`|\*\*[^*\n]+\*\*|\*[^*\n]+\*)/g, token => token.startsWith('`') ? `<code>${token.slice(1,-1)}</code>` : token.startsWith('**') ? `<strong>${token.slice(2,-2)}</strong>` : `<em>${token.slice(1,-1)}</em>`);
  return lines.every(s => /^[-*] /.test(s)) ? `<ul>${lines.map(s => `<li>${inline(s.slice(2))}</li>`).join('')}</ul>` : `<p>${lines.map(inline).join('<br>')}</p>`;
}).join('');
// --- end lesson builder helpers ---
let lesson = null, filters = { section: '', domains: [], skills: [], difficulties: [], lessonUsage: 'show-all', search: '', page: 1 }, taxonomy = {}, editor = -1, filterToken = 0, saveTimer, revision = 0, savedRevision = 0, saveChain = Promise.resolve(), questionCache = new Map();
const lessonURL = () => lesson?.id ? `/api/admin/lessons/${lesson.id}` : '/api/admin/lessons';
const payload = () => ({ title: lesson.title, mode: lesson.mode, items: lesson.items });
function changed() {
  revision++; $('save-status').textContent = 'Unsaved';
  clearTimeout(saveTimer);
  if (lesson.title.trim()) saveTimer = setTimeout(() => saveLesson().catch(() => {}), 600);
}
async function saveLesson() {
  clearTimeout(saveTimer);
  const current = lesson, version = revision, data = { ...payload(), items: lesson.items.map(x => ({ ...x })) };
  if (!data.title.trim()) { $('save-status').textContent = 'Error: title required'; throw Error('Title required'); }
  const work = saveChain.then(async () => {
    if (current !== lesson) return;
    if (version <= savedRevision && current.id) return;
    $('save-status').textContent = 'Saving';
    try {
      const saved = await api(current.id ? `/api/admin/lessons/${current.id}` : '/api/admin/lessons', current.id ? 'PUT' : 'POST', data);
      current.id = saved.id; savedRevision = version;
      $('save-status').textContent = revision === version ? 'Saved' : 'Unsaved';
      if (revision !== version) { clearTimeout(saveTimer); saveTimer = setTimeout(() => saveLesson().catch(() => {}), 600); }
      history.replaceState(null, '', `/admin/lessons/${saved.id}/edit`);
    } catch(e) { $('save-status').textContent = 'Error: ' + e.message; throw e; }
  });
  saveChain = work.catch(() => {});
  return work;
}
async function showLibrary() {
  if (lesson) { try { while (revision > savedRevision) await saveLesson(); } catch(e) { message.textContent = e.message + '. Retry save before leaving.'; return; } }
  clearTimeout(saveTimer); lesson = null; ++filterToken; history.replaceState(null, '', '/admin/lessons');
  busy('Loading lessons…'); const token = ++viewToken;
  try {
    const library = await api('/api/admin/lessons'); if (token !== viewToken) return;
    message.textContent = 'Lesson library';
    body.innerHTML = `<button id="new-lesson">New lesson</button><div class="library">${library.map(l => `<article class="panel"><h2>${esc(l.title)}</h2><p>${esc(l.mode)} · ${l.questionCount} questions · ${formatTime(l.totalSec)} · ${l.timesRun} runs · Last run ${esc(l.lastRun || 'never')}</p><div class="frow"><button data-edit="${l.id}">Edit</button><button data-start="${l.id}">Start session</button><button data-copy="${l.id}">Duplicate</button><button data-past="${l.id}">View past sessions</button></div><div id="past-${l.id}"></div></article>`).join('') || '<p>No lessons yet.</p>'}</div>`;
    $('new-lesson').onclick = () => openLesson();
    body.querySelectorAll('[data-edit]').forEach(b => b.onclick = () => openLesson(b.dataset.edit));
    body.querySelectorAll('[data-start]').forEach(b => b.onclick = () => openLesson(b.dataset.start, true));
    body.querySelectorAll('[data-copy]').forEach(b => b.onclick = async () => { try { const copy = await api(`/api/admin/lessons/${b.dataset.copy}/duplicate`, 'POST'); openLesson(copy.id); } catch(e) { message.textContent = e.message; } });
    body.querySelectorAll('[data-past]').forEach(b => b.onclick = async () => { const host = $(`past-${b.dataset.past}`); try { const sessions = await api(`/api/admin/lessons/${b.dataset.past}/sessions`); host.innerHTML = sessions.map(s => `<p>Session ${esc(s.paddedId)} · ${esc(s.status)} · ${esc(s.created_at)} · ${esc(s.join_code)} (results unavailable until later task)</p>`).join('') || '<p>No sessions yet.</p>'; } catch(e) { host.textContent = e.message; } });
  } catch(e) { if (token === viewToken) fail(e, showLibrary); }
}
async function openLesson(id, start = false) {
  busy('Loading builder…'); const token = ++viewToken;
  try {
     const opened = id ? await api(`/api/admin/lessons/${id}`) : { title: '', mode: 'instructor', items: [] };
     if (token !== viewToken) return;
     lesson = opened;
    revision = savedRevision = 0; editor = -1; taxonomy = {}; questionCache = new Map(); filters = { section: '', domains: [], skills: [], difficulties: [], lessonUsage: 'show-all', search: '', page: 1 };
    history.replaceState(null, '', id ? `/admin/lessons/${id}/edit` : '/admin/lessons/new');
    message.textContent = ''; body.innerHTML = `<button id="library-back">← Library</button><div class="builder"><section class="panel" id="filters"></section><section class="panel"><h2>Results</h2><div id="results"></div><div id="question-preview"></div></section><section class="panel"><h2>Lesson</h2><label>Title <input id="lesson-title" maxlength="200"></label><fieldset><legend>Mode</legend><label><input type="radio" name="mode" value="instructor"> Instructor</label><label><input type="radio" name="mode" value="self"> Self-paced</label></fieldset><p>Total time: <strong id="total-time"></strong></p><ol id="lesson-items"></ol><div id="item-editor"></div><div class="frow"><button id="save-lesson">Save</button><button id="save-start">Save & start session</button><button id="retry-save">Retry</button><span id="save-status" role="status">Saved</span></div><div id="join-result" role="status"></div></section></div>`;
    $('library-back').onclick = showLibrary; $('lesson-title').value = lesson.title;
    $('lesson-title').oninput = e => { lesson.title = e.target.value; changed(); };
    body.querySelector(`[name="mode"][value="${lesson.mode}"]`).checked = true;
    body.querySelectorAll('[name="mode"]').forEach(r => r.onchange = () => { lesson.mode = r.value; changed(); });
    $('save-lesson').onclick = () => saveLesson().catch(e => { message.textContent = e.message; });
    $('retry-save').onclick = $('save-lesson').onclick;
    $('save-start').onclick = async () => { try { await saveLesson(); const s = await api(`${lessonURL()}/sessions`, 'POST'); $('join-result').innerHTML = `<p>Session ${esc(s.paddedId)}</p><strong class="join-code">${esc(s.joinCode)}</strong><p>Join URL: <span>${esc(location.origin + '/app?join=' + encodeURIComponent(s.joinCode))}</span></p>`; } catch(e) { $('join-result').textContent = e.message; } };
    renderItems(); renderFilters(); await loadQuestions(); if (start) $('save-start').click();
  } catch(e) { if (token === viewToken) fail(e, () => openLesson(id, start)); }
}
function renderFilters() {
  const host = $('filters'); if (!host) return;
  const domains = cbSort(Object.keys(taxonomy));
  const skills = cbSort([...new Set((filters.domains.length ? filters.domains : domains).flatMap(d => taxonomy[d] || []))]);
  host.innerHTML = `<h2>Filters</h2><label>Section <select id="f-section"><option value="">All</option>${['Reading & Writing','Math'].map(s => `<option value="${esc(s)}" ${filters.section === s ? 'selected' : ''}>${esc(s)}</option>`).join('')}</select></label><fieldset><legend>Domain</legend>${domains.map(d => `<label><input type="checkbox" data-domain="${esc(d)}" ${filters.domains.includes(d) ? 'checked' : ''}>${esc(d)}</label>`).join('')}</fieldset><fieldset><legend>Skill</legend>${skills.map(s => `<label><input type="checkbox" data-skill="${esc(s)}" ${filters.skills.includes(s) ? 'checked' : ''}>${esc(s)}</label>`).join('')}</fieldset><fieldset><legend>Difficulty</legend>${['Easy','Medium','Hard'].map(d => `<label><input type="checkbox" data-diff="${d}" ${filters.difficulties.includes(d) ? 'checked' : ''}>${d}</label>`).join('')}</fieldset><label>Lesson questions <select id="f-usage"><option value="show-all">Show all</option><option value="hide-all" ${filters.lessonUsage === 'hide-all' ? 'selected' : ''}>Hide all lesson questions</option></select></label><label>Search ID, skill or stem <input id="f-search" value="${esc(filters.search)}" maxlength="100"></label>`;
  $('f-section').onchange = e => { filters.section = e.target.value; filters.domains = []; filters.skills = []; filters.page = 1; renderFilters(); loadQuestions(); };
  const multi = (key, selector) => host.querySelectorAll(selector).forEach(el => el.onchange = () => { filters[key] = [...host.querySelectorAll(`${selector}:checked`)].map(x => x.dataset[key === 'domains' ? 'domain' : key === 'skills' ? 'skill' : 'diff']); if (key === 'domains') { filters.skills = []; renderFilters(); } filters.page = 1; loadQuestions(); });
  multi('domains','[data-domain]'); multi('skills','[data-skill]'); multi('difficulties','[data-diff]');
  $('f-usage').onchange = e => { filters.lessonUsage = e.target.value; filters.page = 1; loadQuestions(); };
  $('f-search').oninput = e => { filters.search = e.target.value; filters.page = 1; clearTimeout(loadQuestions.timer); loadQuestions.timer = setTimeout(loadQuestions, 350); };
}
async function loadQuestions() {
  const token = ++filterToken, host = $('results'); if (!host) return;
  host.textContent = 'Loading…';
  try {
    const base = new URLSearchParams({ section: filters.section, lessonUsage: filters.lessonUsage, search: filters.search, page: String(filters.page) });
    filters.domains.forEach(d => base.append('domain', d)); filters.skills.forEach(s => base.append('skill', s)); filters.difficulties.forEach(d => base.append('difficulty', d));
    const data = await api(`/api/admin/questions?${base}`);
    if (token !== filterToken || !lesson || !host.isConnected) return;
    taxonomy = data.skillsByDomain;
    const visible = data.questions;
    visible.forEach(q => questionCache.set(q.id,q));
    renderFilters(); renderEditor();
    host.innerHTML = `<p>${data.total} results</p>${visible.map(q => `<div class="result-row"><button data-add="${esc(q.id)}" aria-label="Add ${esc(q.id)}">+</button><button data-preview="${esc(q.id)}">${esc(q.id)} · ${esc(q.skill)} · ${esc(q.difficulty)}</button> ${q.usedInLesson.map(x => `<small class="usage-badge">${esc(x)}</small>`).join('')}</div>`).join('') || '<p>No results.</p>'}<p id="add-error" role="alert"></p><button id="add-page">Add all on page</button><div class="frow"><button id="result-prev" ${data.page <= 1 ? 'disabled' : ''}>Previous</button>Page ${data.page} of ${data.pages}<button id="result-next" ${data.page >= data.pages ? 'disabled' : ''}>Next</button></div>`;
    host.querySelectorAll('[data-add]').forEach(b => b.onclick = () => addQuestion(questionCache.get(b.dataset.add)));
    host.querySelectorAll('[data-preview]').forEach(b => b.onclick = () => showQuestion(questionCache.get(b.dataset.preview), $('question-preview')));
    $('add-page').onclick = () => visible.forEach(addQuestion);
    $('result-prev').onclick = () => { filters.page--; loadQuestions(); }; $('result-next').onclick = () => { filters.page++; loadQuestions(); };
  } catch(e) { if (token === filterToken && $('results')) host.innerHTML = `<p>${esc(e.message)}</p><button id="filter-retry">Retry</button>`, $('filter-retry').onclick = loadQuestions; }
}
function addQuestion(q) {
  if (lesson.items.some(x => x.question_id === q.id)) { $('add-error').textContent = `${q.id} already in lesson`; return; }
  lesson.items.push({ question_id: q.id, time_limit_sec: defaultTime(q), notes: '' }); changed(); renderItems();
}
function showQuestion(q, host) {
  if (!q) { host.textContent = 'Question unavailable'; return; }
  host.innerHTML = `<div class="preview"><h3>${esc(q.id)}</h3>${previewHTML(q,document)}<p>Correct answer: ${esc(q.answer)}</p></div>`; mathify(host);
}
function renderItems() {
  const host = $('lesson-items'); if (!host) return;
  $('total-time').textContent = formatTime(totalTime(lesson.items));
  host.innerHTML = lesson.items.map((x,i) => `<li draggable="true" data-index="${i}"><span class="drag-handle" aria-hidden="true">≡</span> ${esc(x.question_id)} · ${formatTime(x.time_limit_sec)} <button data-up="${i}" aria-label="Move ${esc(x.question_id)} up" ${i === 0 ? 'disabled' : ''}>↑</button><button data-down="${i}" aria-label="Move ${esc(x.question_id)} down" ${i === lesson.items.length-1 ? 'disabled' : ''}>↓</button><button data-edit-item="${i}" aria-label="Edit ${esc(x.question_id)}">✎</button><button data-remove="${i}" aria-label="Remove ${esc(x.question_id)}">×</button></li>`).join('');
  const move = (a,b) => { if (a === b || b < 0 || b >= lesson.items.length) return; lesson.items.splice(b,0,...lesson.items.splice(a,1)); changed(); renderItems(); };
  host.querySelectorAll('[data-up]').forEach(b => b.onclick = () => move(+b.dataset.up,+b.dataset.up-1));
  host.querySelectorAll('[data-down]').forEach(b => b.onclick = () => move(+b.dataset.down,+b.dataset.down+1));
  host.querySelectorAll('[data-remove]').forEach(b => b.onclick = () => { lesson.items.splice(+b.dataset.remove,1); editor = -1; changed(); renderItems(); });
  host.querySelectorAll('[data-edit-item]').forEach(b => b.onclick = () => { editor = +b.dataset.editItem; renderEditor(); });
  host.querySelectorAll('li').forEach(li => { li.ondragstart = e => e.dataTransfer.setData('text/plain',li.dataset.index); li.ondragover = e => e.preventDefault(); li.ondrop = e => { e.preventDefault(); const a = Number(e.dataTransfer.getData('text/plain')); if (Number.isInteger(a) && a >= 0 && a < lesson.items.length) move(a,+li.dataset.index); }; });
  renderEditor();
}
function renderEditor() {
  const host = $('item-editor'); if (editor < 0 || editor >= lesson.items.length) { host.replaceChildren(); return; }
  const x = lesson.items[editor];
  host.innerHTML = `<div class="editor"><button id="close-editor">Close editor</button><h3>${esc(x.question_id)}</h3><p>Time limit</p><div class="frow">${[30,45,60,90,120,180].map(n => `<button data-time="${n}">${formatTime(n)}</button>`).join('')}</div><label>Custom mm:ss <input id="custom-time" value="${formatTime(x.time_limit_sec)}" inputmode="numeric"></label><p id="time-error" role="alert"></p><label>Notes (you see these during the lesson; students see them as the breakdown when reviewing afterwards).<textarea id="lesson-notes" maxlength="4000"></textarea></label><h4>Notes preview</h4><div id="notes-preview"></div><h4>Question reference</h4><div id="editor-question"></div></div>`;
  $('close-editor').onclick = () => { editor = -1; renderEditor(); };
  const setTime = n => { x.time_limit_sec = n; $('custom-time').value = formatTime(n); $('time-error').textContent = ''; changed(); renderItems(); };
  host.querySelectorAll('[data-time]').forEach(b => b.onclick = () => setTime(+b.dataset.time));
  $('custom-time').onchange = e => { const n = parseTime(e.target.value); if (n == null) { $('time-error').textContent = 'Use mm:ss (5 seconds to 180 minutes)'; return; } setTime(n); renderItems(); };
  $('lesson-notes').value = x.notes;
  const previewNotes = () => { $('notes-preview').innerHTML = notesHTML(x.notes); mathify($('notes-preview')); };
  $('lesson-notes').oninput = e => { x.notes = e.target.value; changed(); previewNotes(); };
  previewNotes(); showQuestion(questionCache.get(x.question_id), $('editor-question'));
}
const lessonRoute = location.pathname.match(/^\/admin\/lessons\/(new|\d+\/edit)$/);
if (lessonRoute) { document.querySelector('[data-section="Students"]').removeAttribute('aria-current'); document.querySelector('[data-section="Lessons"]').setAttribute('aria-current','page'); $('title').textContent = 'Lessons'; openLesson(lessonRoute[1] === 'new' ? null : lessonRoute[1].split('/')[0]); }
else if (location.pathname === '/admin/lessons') { document.querySelector('[data-section="Students"]').removeAttribute('aria-current'); document.querySelector('[data-section="Lessons"]').setAttribute('aria-current','page'); $('title').textContent = 'Lessons'; showLibrary(); }
else loadList();
