'use strict';

// ---------- config ----------
const MOOD_NAMES = { 1: 'ˊᴖˋ', 2: '.‸.', 3: '¬_¬', 4: '◝_◜', 5: 'ˆᗜˆ' };
const ICON = {
  photo: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4.5 8.5h3l1.4-2h6.2l1.4 2h3.5v10h-15.5z"/><circle cx="12" cy="13" r="3"/></svg>',
  trash: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 8h14"/><path d="M9 8V5.5h6V8"/><path d="M7.5 8l.8 11h7.4l.8-11"/></svg>',
};
// Edit these freely: they show up in each entry's "Template…" dropdown.
const TEMPLATES = {
  'Day recap': '<h3>Highlights</h3><ul><li><br></li></ul><h3>What was hard</h3><ul><li><br></li></ul><h3>Tomorrow</h3><ul><li><br></li></ul>',
  'Gratitude': '<h3>Grateful for</h3><ol><li><br></li><li><br></li><li><br></li></ol>',
  'Check-in': '<p><b>Energy:</b> /10</p><p><b>Sleep:</b> h</p><p><b>On my mind:</b></p><p><br></p>',
};
const AUTOSAVE_MS = 600;

// ---------- utils ----------
const $ = (s, el = document) => el.querySelector(s);
const pad = n => String(n).padStart(2, '0');
const iso = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const todayStr = () => iso(new Date());
const parseISO = s => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
const addDays = (s, n) => { const d = parseISO(s); d.setDate(d.getDate() + n); return iso(d); };
const daysBetween = (a, b) => Math.round((parseISO(b) - parseISO(a)) / 86400000);
const longDate = s => parseISO(s).toLocaleDateString('en-AU', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
const shortDate = s => parseISO(s).toLocaleDateString('en-AU', { day: 'numeric', month: 'short' });
const timeOf = ts => ts ? new Date(ts).toLocaleTimeString('en-AU', { hour: 'numeric', minute: '2-digit' }) : 'New entry';
const textOf = html => { const t = document.createElement('textarea'); t.innerHTML = html.replace(/<[^>]+>/g, ' '); return t.value; };
const words = html => (textOf(html).trim().match(/\S+/g) || []).length;
const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const escRe = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

function relDay(s) {
  const n = daysBetween(s, todayStr());
  if (n === 0) return 'Today';
  if (n === 1) return 'Yesterday';
  return `${n} days ago`;
}

async function api(url, opts = {}) {
  const headers = opts.body && !(opts.body instanceof FormData) ? { 'Content-Type': 'application/json' } : {};
  const r = await fetch(url, { headers, ...opts });
  if (r.status === 401) { location.href = '/lock'; throw new Error('locked'); }
  if (!r.ok) {
    let msg = r.statusText;
    try { msg = (await r.json()).error || msg; } catch (_) {}
    throw new Error(msg);
  }
  return r.json();
}

// ---------- rich-text toolbar ----------
let savedRange = null, activeEditor = null;
const STATE_CMDS = ['bold', 'italic', 'underline', 'strikeThrough', 'insertUnorderedList',
  'insertOrderedList', 'justifyLeft', 'justifyCenter', 'justifyRight'];

const TOOLBAR_HTML = `
  <div class="toolbar" id="toolbar">
    <select data-cmd="formatBlock" title="Style">
      <option value="P">Normal</option><option value="H2">Heading 1</option>
      <option value="H3">Heading 2</option><option value="H4">Heading 3</option>
      <option value="BLOCKQUOTE">Quote</option>
    </select>
    <select data-cmd="fontName" data-reset title="Font">
      <option value="">Font</option><option value="Georgia">Serif</option>
      <option value="Segoe UI">Sans</option><option value="Consolas">Mono</option>
      <option value="Segoe Print">Handwriting</option>
    </select>
    <select data-cmd="fontSize" data-reset title="Size">
      <option value="">Size</option><option value="2">Small</option><option value="3">Normal</option>
      <option value="5">Large</option><option value="6">Huge</option>
    </select>
    <span class="tb-sep"></span>
    <button type="button" class="tb-btn" data-cmd="bold" title="Bold (Ctrl+B)"><b>B</b></button>
    <button type="button" class="tb-btn" data-cmd="italic" title="Italic (Ctrl+I)"><i>I</i></button>
    <button type="button" class="tb-btn" data-cmd="underline" title="Underline (Ctrl+U)"><u>U</u></button>
    <button type="button" class="tb-btn" data-cmd="strikeThrough" title="Strikethrough"><s>S</s></button>
    <label class="tb-btn" title="Text colour"><b>A</b><input type="color" data-cmd="foreColor" value="#b42362"></label>
    <label class="tb-btn" title="Highlight"><span class="tb-hl">A</span><input type="color" data-cmd="hiliteColor" value="#ffe08a"></label>
    <span class="tb-sep"></span>
    <button type="button" class="tb-btn" data-cmd="insertUnorderedList" title="Bullets">•≡</button>
    <button type="button" class="tb-btn" data-cmd="insertOrderedList" title="Numbering">1.≡</button>
    <button type="button" class="tb-btn" data-cmd="justifyLeft" title="Align left">⇤</button>
    <button type="button" class="tb-btn" data-cmd="justifyCenter" title="Centre">↔</button>
    <button type="button" class="tb-btn" data-cmd="justifyRight" title="Align right">⇥</button>
    <button type="button" class="tb-btn" data-cmd="removeFormat" title="Clear formatting">⌫</button>
    <select id="zoom" class="zoom" title="Zoom">
      ${[75, 90, 100, 110, 125, 150, 175, 200].map(z => `<option value="${z}">${z}%</option>`).join('')}
    </select>
  </div>`;

function caretToEnd(el) {
  const r = document.createRange();
  r.selectNodeContents(el); r.collapse(false);
  const s = getSelection(); s.removeAllRanges(); s.addRange(r);
}

document.addEventListener('selectionchange', () => {
  const sel = getSelection();
  if (!sel.rangeCount) return;
  const n = sel.anchorNode;
  const ed = n && (n.nodeType === 1 ? n : n.parentElement)?.closest('.editor');
  if (ed) { activeEditor = ed; updateToolbarState(); }
});
// Remember the cursor at the moment an editor loses focus (e.g. to a toolbar dropdown).
document.addEventListener('focusout', ev => {
  if (!ev.target.classList?.contains('editor')) return;
  const sel = getSelection();
  if (sel.rangeCount) savedRange = sel.getRangeAt(0).cloneRange();
});

function cmd(name, value = null) {
  if (!activeEditor || !document.contains(activeEditor)) {
    activeEditor = $('#entries .editor');
    if (!activeEditor) return;
    activeEditor.focus(); caretToEnd(activeEditor);
  } else if (document.activeElement !== activeEditor) {
    activeEditor.focus();
    if (savedRange) { const s = getSelection(); s.removeAllRanges(); s.addRange(savedRange); }
  }
  document.execCommand(name, false, value);
  updateToolbarState();
}

function updateToolbarState() {
  const tb = $('#toolbar');
  if (!tb) return;
  tb.querySelectorAll('button[data-cmd]').forEach(b => {
    if (STATE_CMDS.includes(b.dataset.cmd)) b.classList.toggle('on', document.queryCommandState(b.dataset.cmd));
  });
  const block = (document.queryCommandValue('formatBlock') || 'p').toUpperCase();
  const sel = $('select[data-cmd=formatBlock]', tb);
  sel.value = [...sel.options].some(o => o.value === block) ? block : 'P';
}

function wireToolbar() {
  const tb = $('#toolbar');
  tb.querySelectorAll('button').forEach(b => {
    b.addEventListener('mousedown', ev => ev.preventDefault()); // keep the text selection
    b.addEventListener('click', () => cmd(b.dataset.cmd));
  });
  tb.querySelectorAll('select[data-cmd]').forEach(s => s.addEventListener('change', () => {
    const v = s.value;
    if (s.hasAttribute('data-reset')) s.value = '';
    if (v) cmd(s.dataset.cmd, s.dataset.cmd === 'formatBlock' ? `<${v}>` : v);
  }));
  tb.querySelectorAll('input[type=color]').forEach(i => i.addEventListener('change', () => cmd(i.dataset.cmd, i.value)));
  const z = $('#zoom', tb);
  z.value = String(getZoom());
  z.addEventListener('change', () => setZoom(+z.value));
}

function getZoom() { try { return +localStorage.getItem('zoom') || 100; } catch (_) { return 100; } }
function setZoom(z) {
  document.documentElement.style.setProperty('--zoom', z / 100);
  try { localStorage.setItem('zoom', z); } catch (_) {}
}

// ---------- state ----------
const state = { date: todayStr(), entries: [], mood: null, view: 'day', calMonth: todayStr().slice(0, 7) };
const newDraft = () => ({ id: null, date: state.date, content: '', created_at: null, photos: [] });

// ---------- saving ----------
let statusTimer;
function setStatus(msg, isError = false) {
  const el = $('#status');
  if (!el) return;
  el.textContent = msg;
  el.classList.toggle('error', isError);
  el.classList.add('show');
  clearTimeout(statusTimer);
  if (msg === 'Tucked away') statusTimer = setTimeout(() => el.classList.remove('show'), 1500);
}

function schedule(e) {
  clearTimeout(e.timer);
  e.timer = setTimeout(() => save(e), AUTOSAVE_MS);
}

function save(e) {
  clearTimeout(e.timer); e.timer = null;
  e.chain = (e.chain || Promise.resolve()).then(async () => {
    if (!e.dirty || e.deleted) return;
    e.dirty = false;
    setStatus('Saving…');
    try {
      if (e.id == null) {
        const r = await api(`/api/day/${e.date}/entries`, { method: 'POST', body: JSON.stringify({ content: e.content }) });
        e.id = r.id; e.created_at = r.created_at;
        if (e.el) $('.time', e.el).textContent = timeOf(e.created_at);
      } else {
        await api(`/api/entries/${e.id}`, { method: 'PUT', body: JSON.stringify({ content: e.content }) });
      }
      setStatus('Tucked away');
      refreshSidebarSoon();
    } catch (err) {
      if (err.message === 'locked') return;
      e.dirty = true;
      setStatus("Couldn't save. Trying again…", true);
      e.timer = setTimeout(() => save(e), 3000);
    }
  });
  return e.chain;
}

function flushAll() {
  return Promise.all(state.entries.map(e => (e.dirty ? save(e) : e.chain || Promise.resolve())));
}

async function ensureId(e) {
  if (e.id == null) { e.dirty = true; await save(e); }
  return e.id;
}

window.addEventListener('beforeunload', () => {
  for (const e of state.entries) {
    if (!e.dirty || e.deleted) continue;
    const blob = new Blob([JSON.stringify({ content: e.content })], { type: 'text/plain' });
    navigator.sendBeacon(e.id == null ? `/api/day/${e.date}/entries` : `/api/entries/${e.id}`, blob);
  }
});
document.addEventListener('visibilitychange', () => { if (document.hidden) flushAll(); });

// ---------- day view ----------
async function loadDay(d) {
  await flushAll();
  const data = await api(`/api/day/${d}`);
  state.view = 'day';
  state.date = d;
  state.calMonth = d.slice(0, 7);
  state.mood = data.mood;
  state.entries = data.entries.map(e => ({ ...e }));
  if (!state.entries.length) state.entries.push(newDraft());
  const s = $('#search'); if (s.value) s.value = '';
  renderDay(data.on_this_day);
  renderCalendar();
}

function renderDay(otd) {
  const isToday = state.date >= todayStr();
  $('#main').innerHTML = `
    <header class="day-head">
      <button type="button" class="icon-btn" id="prevDay" title="Previous day">‹</button>
      <div class="day-title">
        <span class="eyebrow">${relDay(state.date)}</span>
        <h1>${longDate(state.date)}</h1>
        <span class="status" id="status" aria-live="polite"></span>
      </div>
      <button type="button" class="icon-btn" id="nextDay" title="Next day" ${isToday ? 'disabled' : ''}>›</button>
    </header>
    <section class="mood-row">
      <span class="label">rating for the day</span>
      <div class="moods">
        ${[1, 2, 3, 4, 5].map(n => `<button type="button" class="mood m${n} ${state.mood === n ? 'on' : ''}" data-mood="${n}" aria-pressed="${state.mood === n}"><i></i><span>${MOOD_NAMES[n]}</span></button>`).join('')}
      </div>
    </section>
    ${TOOLBAR_HTML}
    <section id="entries" class="entries"></section>
    <div class="day-foot">
      <button type="button" class="btn primary" id="addEntry">Add another entry</button>
      <span class="muted" id="dayWords"></span>
    </div>
    ${otd.length ? `
      <section class="otd">
        <h2>On this day</h2>
        ${otd.map(o => `
          <button type="button" class="otd-item" data-date="${o.date}">
            <span class="otd-label">${o.label}${o.mood ? ' · ' + MOOD_NAMES[o.mood] : ''}</span>
            <span class="otd-date">${longDate(o.date)}</span>
            <p>${esc(o.snippet)}</p>
          </button>`).join('')}
      </section>` : ''}`;

  $('#prevDay').onclick = () => loadDay(addDays(state.date, -1));
  $('#nextDay').onclick = () => loadDay(addDays(state.date, 1));
  $('#addEntry').onclick = addEntry;
  document.querySelectorAll('.mood').forEach(b => b.onclick = () => setMood(+b.dataset.mood));
  wireToolbar();
  renderEntries();
  markNav();
}

async function setMood(n) {
  const val = state.mood === n ? null : n;
  state.mood = val;
  document.querySelectorAll('.mood').forEach(b => {
    const on = +b.dataset.mood === val;
    b.classList.toggle('on', on);
    b.setAttribute('aria-pressed', String(on));
  });
  await api(`/api/day/${state.date}/mood`, { method: 'PUT', body: JSON.stringify({ mood: val }) });
  refreshSidebarSoon();
}

function renderEntries() {
  const box = $('#entries');
  box.innerHTML = '';
  state.entries.forEach(e => box.appendChild(entryEl(e)));
  updateDayWords();
}

function addEntry() {
  const last = state.entries[state.entries.length - 1];
  if (last && !last.content && !last.photos.length) { $('.editor', last.el).focus(); return; }
  const e = newDraft();
  state.entries.push(e);
  $('#entries').appendChild(entryEl(e));
  $('.editor', e.el).focus();
}

function updateDayWords() {
  const n = state.entries.reduce((a, e) => a + words(e.content), 0);
  const el = $('#dayWords');
  if (el) el.textContent = n ? `${plural(n, 'word')} ${state.date === todayStr() ? 'today' : 'this day'}` : '';
}

function entryEl(e) {
  const el = document.createElement('article');
  el.className = 'entry';
  el.innerHTML = `
    <div class="entry-head">
      <span class="time">${timeOf(e.created_at)}</span>
      <span class="wc"></span>
      <div class="entry-tools">
        <select class="tpl" title="Insert a prompt">
          <option value="">A prompt…</option>
          ${Object.keys(TEMPLATES).map(k => `<option>${esc(k)}</option>`).join('')}
        </select>
        <label class="icon-btn small" title="Add a photo" aria-label="Add a photo">${ICON.photo}<input type="file" accept="image/png,image/jpeg,image/gif,image/webp" multiple hidden></label>
        <button type="button" class="icon-btn small del" title="Delete entry" aria-label="Delete entry">${ICON.trash}</button>
      </div>
    </div>
    <div class="editor" contenteditable="true" spellcheck="true" data-placeholder="How did today treat you?"></div>
    <div class="photos"></div>`;
  e.el = el;
  const ed = $('.editor', el), wc = $('.wc', el);
  ed.innerHTML = e.content;

  const sync = () => {
    const blank = !ed.innerText.trim();
    e.content = blank ? '' : ed.innerHTML;
    ed.classList.toggle('empty', blank && !ed.querySelector('li, h2, h3, h4, blockquote'));
    const n = words(e.content);
    wc.textContent = n ? plural(n, 'word') : '';
  };
  sync();

  ed.addEventListener('input', () => { sync(); e.dirty = true; updateDayWords(); schedule(e); });
  ed.addEventListener('blur', () => { if (e.dirty) save(e); });
  ed.addEventListener('paste', ev => {
    ev.preventDefault();
    document.execCommand('insertText', false, ev.clipboardData.getData('text/plain'));
  });

  const sel = $('.tpl', el);
  sel.addEventListener('change', () => {
    const t = TEMPLATES[sel.value];
    sel.value = '';
    if (!t) return;
    ed.focus(); caretToEnd(ed);
    document.execCommand('insertHTML', false, t);
    sync(); e.dirty = true; updateDayWords(); schedule(e);
  });

  const file = $('input[type=file]', el);
  file.addEventListener('change', async () => {
    const files = [...file.files];
    file.value = '';
    if (!files.length) return;
    try {
      await ensureId(e);
      const fd = new FormData();
      files.forEach(f => fd.append('photo', f));
      setStatus('Adding your photo…');
      const r = await api(`/api/entries/${e.id}/photos`, { method: 'POST', body: fd });
      e.photos.push(...r.photos);
      renderPhotos(e);
      setStatus('Tucked away');
      refreshSidebarSoon();
    } catch (err) { if (err.message !== 'locked') setStatus(err.message, true); }
  });

  $('.del', el).addEventListener('click', async () => {
    if ((e.content.trim() || e.photos.length) && !confirm('Delete this entry?')) return;
    clearTimeout(e.timer);
    e.dirty = false;
    await (e.chain || Promise.resolve());
    e.deleted = true;
    if (e.id != null) await api(`/api/entries/${e.id}`, { method: 'DELETE' });
    state.entries = state.entries.filter(x => x !== e);
    if (!state.entries.length) state.entries.push(newDraft());
    renderEntries();
    refreshSidebarSoon();
  });

  renderPhotos(e);
  return el;
}

function renderPhotos(e) {
  const box = $('.photos', e.el);
  box.innerHTML = e.photos.map(p => `
    <div class="thumb" data-id="${p.id}">
      <img src="${p.url}" loading="lazy" alt="">
      <button type="button" class="x" title="Remove photo" aria-label="Remove photo">×</button>
    </div>`).join('');
  box.querySelectorAll('.thumb').forEach(t => {
    const id = +t.dataset.id;
    $('img', t).onclick = () => openLightbox($('img', t).src);
    $('.x', t).onclick = async () => {
      if (!confirm('Remove this photo?')) return;
      await api(`/api/photos/${id}`, { method: 'DELETE' });
      e.photos = e.photos.filter(p => p.id !== id);
      renderPhotos(e);
    };
  });
}

function openLightbox(src) {
  const lb = $('#lightbox');
  $('img', lb).src = src;
  lb.hidden = false;
}

// ---------- calendar & streak ----------
async function renderCalendar() {
  const ym = state.calMonth;
  const [y, m] = ym.split('-').map(Number);
  let data = { days: {} };
  try { data = await api(`/api/calendar/${ym}`); } catch (_) { return; }
  if (ym !== state.calMonth) return; // user flipped months while loading
  const today = todayStr();
  const first = (new Date(y, m - 1, 1).getDay() + 6) % 7; // Monday first
  const n = new Date(y, m, 0).getDate();
  const monthName = new Date(y, m - 1, 1).toLocaleDateString('en-AU', { month: 'long', year: 'numeric' });
  let cells = '<span></span>'.repeat(first);
  for (let d = 1; d <= n; d++) {
    const ds = `${ym}-${pad(d)}`, info = data.days[ds] || {};
    const cls = ['cal-day'];
    if (info.words) cls.push('written');
    if (info.mood) cls.push('m' + info.mood);
    if (ds === today) cls.push('today');
    if (ds === state.date && state.view === 'day') cls.push('selected');
    const tip = [info.words ? plural(info.words, 'word') : '', info.mood ? MOOD_NAMES[info.mood] : ''].filter(Boolean).join(' · ');
    cells += `<button class="${cls.join(' ')}" data-date="${ds}" ${ds > today ? 'disabled' : ''} title="${tip}">${d}</button>`;
  }
  $('#calendar').innerHTML = `
    <div class="cal-head">
      <button type="button" class="icon-btn small" data-nav="-1" title="Previous month">‹</button>
      <span>${monthName}</span>
      <button type="button" class="icon-btn small" data-nav="1" title="Next month" ${ym >= today.slice(0, 7) ? 'disabled' : ''}>›</button>
    </div>
    <div class="cal-grid">${['M', 'T', 'W', 'T', 'F', 'S', 'S'].map(x => `<span class="dow">${x}</span>`).join('')}${cells}</div>
    <p class="legend" aria-hidden="true"><i class="m1"></i><i class="m2"></i><i class="m3"></i><i class="m4"></i><i class="m5"></i><span>mood swing?</span></p>`;
}

function shiftMonth(n) {
  const [y, m] = state.calMonth.split('-').map(Number);
  const d = new Date(y, m - 1 + n, 1);
  state.calMonth = `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;
  renderCalendar();
}

async function refreshStats() {
  const s = await api('/api/stats');
  $('#streakNum').textContent = s.current_streak;
  $('#streakLabel').textContent = s.current_streak === 1 ? 'day in a row' : 'days in a row';
  $('#streakHint').textContent = !s.written_today && s.current_streak
    ? 'gurt: yo'
    : s.current_streak === 0 ? "Oh you're back... What's up" : '';
  $('#streak').classList.toggle('cold', s.current_streak === 0);
  return s;
}

let sidebarTimer;
function refreshSidebarSoon() {
  clearTimeout(sidebarTimer);
  sidebarTimer = setTimeout(() => { renderCalendar(); refreshStats().catch(() => {}); }, 1200);
}

// ---------- search ----------
let searchTimer, searchSeq = 0;
async function showSearch(q) {
  const seq = ++searchSeq;
  await flushAll();
  const { results } = await api(`/api/search?q=${encodeURIComponent(q)}`);
  if (seq !== searchSeq) return;
  state.view = 'search';
  const re = new RegExp(escRe(esc(q)), 'gi');
  const mention = results.length === 1 ? '1 page mentions it' : `${results.length} pages mention it`;
  $('#main').innerHTML = `
    <header class="page-head">
      <span class="eyebrow">${esc(q)}</span>
      <h1>${results.length ? 'Look what turned up' : 'Nothing under that'}</h1>
      <p class="page-note">${results.length ? mention : 'Not in any page. Try a different word.'}</p>
    </header>
    <div class="results">
      ${results.map(r => `
        <button type="button" class="result" data-date="${r.date}">
          <span class="result-date">${longDate(r.date)} · ${timeOf(r.created_at)}</span>
          <p>${esc(r.snippet).replace(re, m => `<mark>${m}</mark>`)}</p>
        </button>`).join('')}
    </div>`;
  renderCalendar();
  markNav();
}

// ---------- stats view ----------
const CARD_TONE = ['pink', 'blue', 'lilac'];
const card = (i, value, label) => `<div class="stat-card ${CARD_TONE[i % 3]}"><b>${value}</b><span>${label}</span></div>`;

function moodChart(moods, today) {
  if (!moods.length) return '<p class="empty-note">Pick a mood on a few days and I\'ll sketch the line in.</p>';
  const W = 720, H = 240, L = 64, R = 16, T = 18, B = 32, DAYS = 90;
  const start = addDays(today, -(DAYS - 1));
  const x = ds => L + (daysBetween(start, ds) / (DAYS - 1)) * (W - L - R);
  const y = v => T + ((5 - v) / 4) * (H - T - B);
  let svg = `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="Mood over the last 90 days">`;
  for (let v = 1; v <= 5; v++) {
    svg += `<line class="grid" x1="${L}" x2="${W - R}" y1="${y(v)}" y2="${y(v)}"/>`;
    svg += `<text class="ylab" x="${L - 10}" y="${y(v) + 4}" text-anchor="end">${MOOD_NAMES[v]}</text>`;
  }
  [start, addDays(start, 45), today].forEach((d, i) => {
    svg += `<text class="xlab" x="${x(d)}" y="${H - 8}" text-anchor="${['start', 'middle', 'end'][i]}">${shortDate(d)}</text>`;
  });
  const pts = moods.map(m => `${x(m.date).toFixed(1)},${y(m.mood).toFixed(1)}`).join(' ');
  if (moods.length > 1) svg += `<polyline class="line" points="${pts}"/>`;
  moods.forEach(m => {
    svg += `<circle class="dot m${m.mood}" cx="${x(m.date)}" cy="${y(m.mood)}" r="5"><title>${longDate(m.date)}: ${MOOD_NAMES[m.mood]}</title></circle>`;
  });
  return svg + '</svg>';
}

function moodBars(counts) {
  const max = Math.max(1, ...Object.values(counts));
  return '<div class="bars">' + [5, 4, 3, 2, 1].map(v => `
    <div class="bar-row">
      <span class="bar-label"><i class="m${v}"></i>${MOOD_NAMES[v]}</span>
      <div class="bar-track"><div class="bar m${v}" style="width:${(counts[v] / max) * 100}%"></div></div>
      <span class="bar-count">${counts[v]}</span>
    </div>`).join('') + '</div>';
}

async function showStats() {
  await flushAll();
  const s = await refreshStats();
  state.view = 'stats';
  $('#main').innerHTML = `
    <header class="page-head">
      <span class="eyebrow">how you've been showing up</span>
      <h1>The tally</h1>
    </header>
    <div class="cards">
      ${card(0, s.current_streak, 'current streak')}
      ${card(1, s.longest_streak, 'longest streak')}
      ${card(2, s.days_written, 'days written')}
      ${card(3, s.entries, 'entries')}
      ${card(4, s.words.toLocaleString(), 'words')}
      ${card(5, s.avg_words, 'words a day')}
    </div>
    <section class="panel"><h2>Last 90 days</h2>${moodChart(s.moods, s.today)}</section>
    <section class="panel"><h2>All-time moods</h2>${moodBars(s.mood_counts)}</section>`;
  renderCalendar();
  markNav();
}

// ---------- theme & lock ----------
function toggleTheme() {
  const root = document.documentElement;
  const next = root.dataset.theme === 'dark' ? 'light' : 'dark';
  root.dataset.theme = next;
  delete root.dataset.themeAuto;
  try { localStorage.setItem('theme', next); } catch (_) {}
}

function markNav() {
  const todayBtn = $('#btnToday');
  const statsBtn = $('#btnStats');
  const search = $('#search');
  if (todayBtn) todayBtn.classList.toggle('on', state.view === 'day' && state.date === todayStr());
  if (statsBtn) statsBtn.classList.toggle('on', state.view === 'stats');
  if (search) search.classList.toggle('hot', state.view === 'search');
}

async function lockNow() {
  await flushAll();
  await fetch('/api/lock', { method: 'POST' });
  location.href = '/lock';
}

// ---------- init ----------
function init() {
  document.execCommand('styleWithCSS', false, false);
  document.execCommand('defaultParagraphSeparator', false, 'p');
  setZoom(getZoom());
  $('#calendar').addEventListener('click', ev => {
    const nav = ev.target.closest('[data-nav]');
    if (nav) return shiftMonth(+nav.dataset.nav);
    const day = ev.target.closest('.cal-day');
    if (day && !day.disabled) loadDay(day.dataset.date);
  });
  $('#main').addEventListener('click', ev => {
    const b = ev.target.closest('.result, .otd-item');
    if (b) loadDay(b.dataset.date);
  });
  $('#search').addEventListener('input', ev => {
    clearTimeout(searchTimer);
    const q = ev.target.value.trim();
    searchTimer = setTimeout(() => {
      if (q.length >= 2) showSearch(q);
      else if (state.view === 'search') { searchSeq++; loadDay(state.date); }
    }, 250);
  });
  $('#search').addEventListener('keydown', ev => {
    if (ev.key === 'Escape') { ev.target.value = ''; searchSeq++; if (state.view === 'search') loadDay(state.date); }
  });
  $('#btnToday').onclick = () => loadDay(todayStr());
  $('#btnStats').onclick = showStats;
  $('#btnExport').onclick = async () => { await flushAll(); location.href = '/api/export'; };
  $('#btnTheme').onclick = toggleTheme;
  $('#btnLock').onclick = lockNow;
  $('#lightbox').onclick = () => { $('#lightbox').hidden = true; };
  document.addEventListener('keydown', ev => { if (ev.key === 'Escape') $('#lightbox').hidden = true; });

  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', e => {
    if (!document.documentElement.dataset.themeAuto) return;
    document.documentElement.dataset.theme = e.matches ? 'dark' : 'light';
  });

  loadDay(todayStr());
  refreshStats().catch(() => {});
}

init();
