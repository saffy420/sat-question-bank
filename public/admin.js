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
const api = async url => { const r = await fetch(url); if (r.status === 401) { location.replace('/login'); throw Error('Sign in required'); } if (r.status === 403) { location.replace('/app'); throw Error('Admin access required'); } if (!r.ok) throw Error(`Could not load data (${r.status})`); return r.json(); };
const busy = text => { message.textContent = text; body.replaceChildren(); };
const fail = (e, retry = loadList) => { message.textContent = e.message + '. Try again.'; body.innerHTML = '<button id="retry">Retry</button>'; $('retry').onclick = retry; };
const mathify = root => { if (window.renderMathInElement) try { renderMathInElement(root, { delimiters: [{left:'\\(',right:'\\)',display:false},{left:'\\[',right:'\\]',display:true}], throwOnError:false }); } catch { /* malformed authored math must not blank preview */ } };
const row = (label, value, n) => `<div class="metric"><span>${esc(label)}</span><div class="bar"><i style="width:${n == null ? 0 : Math.max(0, Math.min(n, 100))}%"></i></div><strong>${esc(value)}</strong></div>`;
const spark = values => values.length ? `<svg width="100" height="26" viewBox="0 0 100 26" role="img" aria-label="Trend: ${values.map(x => x ? 'correct' : 'missed').join(', ')}"><polyline fill="none" stroke="#265fc7" stroke-width="2" points="${values.map((x,i) => `${values.length === 1 ? 50 : Math.round(i*96/(values.length-1))+2},${x ? 4 : 22}`).join(' ')}"/></svg>` : 'Unavailable';
$('collapse').onclick = () => { const side = $('side'); side.classList.toggle('collapsed'); $('collapse').setAttribute('aria-expanded', String(!side.classList.contains('collapsed'))); };
document.querySelectorAll('[data-section]').forEach(b => b.onclick = () => {
  document.querySelectorAll('[data-section]').forEach(x => x.removeAttribute('aria-current'));
  b.setAttribute('aria-current','page'); $('title').textContent = b.dataset.section;
  if (b.dataset.section === 'Students') { detail = null; loadList(); }
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
loadList();
