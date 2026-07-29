// ===== Pursuit Wizard =====
const SUPABASE_URL = 'https://oenapblefpxhjrqqcbme.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_X89W8WryekjguGHTXZZN3Q_Itq9bUO3';
const sb = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

const STAGES = [
  { key: 'looking_for_dm', label: '🔎 Looking for DM', color: 'var(--stage-looking)' },
  { key: 'found_dm', label: '🎯 Found DM', color: 'var(--stage-found)' },
  { key: 'talked_to_dm', label: '🗣️ Talked to DM', color: 'var(--stage-talked)' },
  { key: 'appointment_set', label: '📅 Appointment Set', color: 'var(--stage-appt)' },
  { key: 'pitched', label: '🎤 Pitched', color: 'var(--stage-pitched)' },
  { key: 'negotiating', label: '🤝 Negotiating', color: 'var(--stage-negotiating)' },
  { key: 'closed_won', label: '🏆 Closed Won', color: 'var(--stage-closed)' },
  { key: 'on_ice', label: '❄️ On Ice', color: 'var(--stage-ice)' },
  { key: 'moving_on', label: '🚫 Moving On', color: 'var(--stage-gone)' },
];
const stageInfo = k => STAGES.find(s => s.key === k) || STAGES[0];
const TP_TYPES = [
  { key: 'dial', icon: '📞', label: 'Dial' },
  { key: 'email', icon: '✉️', label: 'Email' },
  { key: 'text', icon: '💬', label: 'Text' },
  { key: 'voicemail', icon: '🎙️', label: 'Voicemail' },
];

let state = { accounts: [], stats: {}, reminders: [], appointments: [], market: [], voice: [], profile: null, calMonth: null, session: null };

const $ = id => document.getElementById(id);
const esc = s => (s ?? '').toString().replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmtDT = d => new Date(d).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
const fmtT = d => new Date(d).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
const daysAgo = d => Math.max(0, Math.floor((Date.now() - new Date(d)) / 86400000));
const toast = msg => { const t = $('toast'); t.textContent = msg; t.classList.remove('hidden'); clearTimeout(t._h); t._h = setTimeout(() => t.classList.add('hidden'), 2600); };

// ===== AUTH =====
async function init() {
  const { data: { session } } = await sb.auth.getSession();
  state.session = session;
  if (session) { $('login-screen').classList.add('hidden'); $('app').classList.remove('hidden'); await loadAll(); }
  else { $('login-screen').classList.remove('hidden'); $('app').classList.add('hidden'); }
}
$('login-btn').onclick = async () => {
  const { error } = await sb.auth.signInWithPassword({ email: $('login-email').value.trim(), password: $('login-password').value });
  if (error) { $('login-error').textContent = error.message; $('login-error').classList.remove('hidden'); return; }
  init();
};
$('login-password').addEventListener('keydown', e => { if (e.key === 'Enter') $('login-btn').click(); });
$('logout-btn').onclick = async () => { await sb.auth.signOut(); location.reload(); };

// ===== NAV =====
document.querySelectorAll('.nav-btn[data-tab]').forEach(b => b.onclick = () => {
  document.querySelectorAll('.nav-btn[data-tab]').forEach(x => x.classList.toggle('active', x === b));
  document.querySelectorAll('.tab').forEach(t => t.classList.toggle('active', t.id === 'tab-' + b.dataset.tab));
});

// ===== DATA =====
async function loadAll() {
  const [acc, stats, rem, appt, mkt, voice, prof] = await Promise.all([
    sb.from('accounts').select('*').order('stage_changed_at', { ascending: false }),
    sb.from('account_touchpoint_stats').select('*'),
    sb.from('reminders').select('*').eq('done', false).order('due_at'),
    sb.from('appointments').select('*').order('starts_at'),
    sb.from('market_data').select('id,name,market,uploaded_at,content').order('uploaded_at', { ascending: false }),
    sb.from('voice_samples').select('*').order('created_at'),
    sb.from('voice_profile').select('*').maybeSingle(),
  ]);
  state.accounts = acc.data || [];
  state.stats = Object.fromEntries((stats.data || []).map(s => [s.account_id, s]));
  state.reminders = rem.data || [];
  state.appointments = appt.data || [];
  state.market = mkt.data || [];
  state.voice = voice.data || [];
  state.profile = prof.data;
  if (!state.calMonth) { const n = new Date(); state.calMonth = [n.getFullYear(), n.getMonth()]; }
  renderAll();
}
function renderAll() { renderDashboard(); renderBoard(); renderCalendar(); renderMarket(); renderAIStudio(); }

const accName = id => state.accounts.find(a => a.id === id)?.name || '';
function sfPill(a, small) {
  if (!a.sf_url) return `<span class="card-name-txt">${esc(a.name)}</span>`;
  return `<a class="sf-pill" href="${esc(a.sf_url)}" target="_blank" rel="noopener" onclick="event.stopPropagation()">${esc(a.name)} ↗</a>`;
}

// ===== DASHBOARD =====
function renderDashboard() {
  const h = new Date().getHours();
  $('greeting').textContent = (h < 12 ? '🌅 Morning' : h < 17 ? '☀️ Afternoon' : '🌙 Evening') + ', Mark — let’s hunt.';

  // reminders
  const now = new Date();
  $('dash-reminders').innerHTML = state.reminders.length ? state.reminders.map(r => {
    const overdue = new Date(r.due_at) < now;
    return `<div class="row ${overdue ? 'overdue' : ''}">
      <button class="check-btn" onclick="completeReminder('${r.id}')" title="Done">✓</button>
      <div class="row-main">${esc(r.title)}${r.account_id ? `<div class="row-sub">${esc(accName(r.account_id))}</div>` : ''}</div>
      <span class="row-time">${overdue ? '⚠️ ' : ''}${fmtDT(r.due_at)}</span>
    </div>`;
  }).join('') : '<div class="empty">Nothing pending. Set one so future-you stays sharp.</div>';

  // appointments (today + next 7 days)
  const week = state.appointments.filter(a => { const d = new Date(a.starts_at); return d >= new Date(now.toDateString()) && d < new Date(Date.now() + 7 * 86400000); });
  $('dash-appts').innerHTML = week.length ? week.map(a => `
    <div class="row">
      <span>${a.kind === 'in_market' ? '🚗' : a.kind === 'call' ? '📞' : '📌'}</span>
      <div class="row-main">${esc(a.title)}${a.account_id ? `<div class="row-sub">${esc(accName(a.account_id))}</div>` : ''}</div>
      <span class="row-time">${fmtDT(a.starts_at)}</span>
    </div>`).join('') : '<div class="empty">No appointments this week — go set some.</div>';

  // needs attention: active accounts, no touch in 4+ days (or never), sorted stalest first
  const active = state.accounts.filter(a => !['closed_won', 'moving_on', 'on_ice'].includes(a.stage));
  const attention = active.map(a => {
    const st = state.stats[a.id] || {};
    const last = st.last_touch_at || a.created_at;
    return { a, st, days: daysAgo(last) };
  }).filter(x => x.days >= 4).sort((x, y) => y.days - x.days).slice(0, 8);
  $('dash-attention').innerHTML = attention.length ? attention.map(({ a, st, days }) => `
    <div class="row" style="cursor:pointer" onclick="openDrawer('${a.id}')">
      <span>${stageInfo(a.stage).label.split(' ')[0]}</span>
      <div class="row-main">${esc(a.name)}<div class="row-sub">${stageInfo(a.stage).label.slice(2).trim()} · ${st.total_touchpoints || 0} touchpoints</div></div>
      <span class="row-time" style="color:var(--amber)">${days}d quiet</span>
    </div>`).join('') : '<div class="empty">Everything’s been touched recently. You’re on it. 🔥</div>';

  // stats
  const totalTp = Object.values(state.stats).reduce((s, x) => s + (+x.total_touchpoints || 0), 0);
  const wk = state.accounts.filter(a => a.stage === 'closed_won').length;
  const tiles = [
    [active.length, 'Active pursuits'],
    [totalTp, 'Total touchpoints'],
    [wk, 'Closed won'],
    [state.accounts.filter(a => a.stage === 'on_ice').length, 'On ice'],
    [active.length ? Math.round(totalTp / Math.max(state.accounts.length, 1)) : 0, 'Avg touches/acct'],
  ];
  $('dash-stats').innerHTML = tiles.map(([n, l]) => `<div class="stat-tile"><div class="num">${n}</div><div class="lbl">${l}</div></div>`).join('');
}

async function completeReminder(id) {
  await sb.from('reminders').update({ done: true }).eq('id', id);
  toast('✅ Reminder done');
  await loadAll();
}

$('test-digest-btn').onclick = async () => {
  const btn = $('test-digest-btn'); btn.disabled = true; btn.textContent = '📧 Sending…';
  try {
    const { data: { session } } = await sb.auth.getSession();
    const r = await fetch('/api/cron-digest?force=1', { headers: { Authorization: 'Bearer ' + session.access_token } });
    const out = await r.json();
    if (out.sent) toast('📧 Sent — check your inbox');
    else if (out.reason === 'RESEND_API_KEY not set') toast('⚠️ Add RESEND_API_KEY in Vercel first');
    else if (out.reason) toast('Nothing to report right now');
    else toast('⚠️ ' + JSON.stringify(out.error || out).slice(0, 60));
  } catch (e) { toast('⚠️ ' + e.message); }
  btn.disabled = false; btn.textContent = '📧 Email me this';
};

// ===== BRIEFING =====
$('briefing-btn').onclick = async () => {
  const btn = $('briefing-btn'); btn.disabled = true; btn.textContent = '🔮 Thinking…';
  try {
    const out = await callAI('briefing', {});
    $('briefing-box').textContent = out;
    $('briefing-box').classList.remove('hidden');
  } catch (e) { toast('⚠️ ' + e.message); }
  btn.disabled = false; btn.textContent = '✨ Morning Briefing';
};

// ===== PIPELINE BOARD =====
function renderBoard() {
  const q = ($('pipeline-search').value || '').toLowerCase();
  $('board').innerHTML = STAGES.map(s => {
    const accs = state.accounts.filter(a => a.stage === s.key && (!q || a.name.toLowerCase().includes(q) || (a.dm_name || '').toLowerCase().includes(q)));
    return `<div class="col" data-glow style="--glow-c:${s.color}">
      <div class="col-head"><span style="color:${s.color}">${s.label}</span><span class="count">${accs.length}</span></div>
      ${accs.map(a => cardHTML(a, s)).join('')}
    </div>`;
  }).join('');
}
$('pipeline-search').addEventListener('input', renderBoard);

function cardHTML(a, s) {
  const st = state.stats[a.id] || {};
  const last = st.last_touch_at || a.created_at;
  const d = daysAgo(last);
  return `<div class="card" style="--stage-c:${s.color}" onclick="openDrawer('${a.id}')">
    <div class="days-chip ${d >= 4 ? 'stale' : ''}">${d}d</div>
    <div class="card-name">${sfPill(a)}</div>
    <div class="card-sub">${a.dm_name ? '👤 ' + esc(a.dm_name) : 'No DM yet'}${a.city ? ' · ' + esc(a.city) : ''}</div>
    <div class="tp-badges">
      <span class="tp-badge total">Σ ${st.total_touchpoints || 0}</span>
      <span class="tp-badge">📞${st.dials || 0}</span>
      <span class="tp-badge">✉️${st.emails || 0}</span>
      <span class="tp-badge">💬${st.texts || 0}</span>
      <span class="tp-badge">🎙️${st.voicemails || 0}</span>
    </div>
    <div class="card-quick">
      ${TP_TYPES.map(t => `<button class="quick-btn" title="Log ${t.label}" onclick="event.stopPropagation();quickLog('${a.id}','${t.key}')">${t.icon}</button>`).join('')}
    </div>
  </div>`;
}

async function quickLog(accountId, type) {
  await sb.from('touchpoints').insert({ account_id: accountId, type });
  toast(`${TP_TYPES.find(t => t.key === type).icon} ${TP_TYPES.find(t => t.key === type).label} logged`);
  await loadAll();
  if (currentDrawerId === accountId) openDrawer(accountId);
}

// ===== DRAWER =====
let currentDrawerId = null;
async function openDrawer(id) {
  currentDrawerId = id;
  const a = state.accounts.find(x => x.id === id);
  if (!a) return;
  const st = state.stats[id] || {};
  $('drawer-overlay').classList.remove('hidden');

  const [tps, hist, notes] = await Promise.all([
    sb.from('touchpoints').select('*').eq('account_id', id).order('occurred_at', { ascending: false }).limit(50),
    sb.from('stage_history').select('*').eq('account_id', id).order('changed_at', { ascending: false }).limit(30),
    sb.from('stage_notes').select('*').eq('account_id', id).order('created_at', { ascending: false }),
  ]);

  const timeline = [
    ...(tps.data || []).map(t => ({ at: t.occurred_at, c: 'var(--cyan)', txt: `${TP_TYPES.find(x => x.key === t.type)?.icon} ${TP_TYPES.find(x => x.key === t.type)?.label}`, note: t.note })),
    ...(hist.data || []).map(h => ({ at: h.changed_at, c: stageInfo(h.to_stage).color, txt: `→ ${stageInfo(h.to_stage).label}`, note: h.note })),
  ].sort((x, y) => new Date(y.at) - new Date(x.at)).slice(0, 40);

  $('drawer-content').innerHTML = `
    <h2>${sfPill(a)} </h2>
    <div class="card-sub">${a.dm_name ? '👤 ' + esc(a.dm_name) : 'No DM identified yet'}${a.city ? ' · 📍 ' + esc(a.city) : ''} · added ${daysAgo(a.created_at)}d ago</div>

    <div class="drawer-section">
      <h4>Stage</h4>
      <div class="stage-pill-row">
        ${STAGES.map(s => `<button class="stage-pill ${a.stage === s.key ? 'current' : ''}" style="--sp-c:${s.color}" onclick="setStage('${id}','${s.key}')">${s.label}</button>`).join('')}
      </div>
    </div>

    <div class="drawer-section">
      <h4>Log a touchpoint — Σ ${st.total_touchpoints || 0} so far</h4>
      <div class="tp-log-row">
        ${TP_TYPES.map(t => `<button class="tp-log-btn" onclick="quickLog('${id}','${t.key}')"><span>${t.icon}</span>${t.label} · ${st[t.key + 's'] || 0}</button>`).join('')}
      </div>
      <div style="display:flex;gap:8px;margin-top:10px">
        <input id="tp-note-input" class="input" placeholder="Optional note with next touchpoint… (e.g. 'GK said call back Tues')">
      </div>
    </div>

    <div class="drawer-section">
      <h4>Notes on this stage (${stageInfo(a.stage).label.slice(2).trim()})</h4>
      <div style="display:flex;gap:8px;margin-bottom:10px">
        <input id="stage-note-input" class="input" placeholder="Add a note…">
        <button class="btn btn-primary" onclick="addStageNote('${id}','${a.stage}')">Add</button>
      </div>
      ${(notes.data || []).map(n => `<div class="row"><div class="row-main">${esc(n.body)}<div class="row-sub">${stageInfo(n.stage).label} · ${fmtDT(n.created_at)}</div></div></div>`).join('') || '<div class="empty">No notes yet.</div>'}
    </div>

    <div class="drawer-section">
      <h4>Quick actions</h4>
      <div style="display:flex;gap:8px;flex-wrap:wrap">
        <button class="btn btn-ghost" onclick="openReminderModal('${id}')">⏰ Remind me</button>
        <button class="btn btn-ghost" onclick="openApptModal('${id}')">📅 Book appointment</button>
        <button class="btn btn-ai" onclick="genForAccount('${id}')">✨ Draft email</button>
        <button class="btn btn-ghost" onclick="openAccountModal('${id}')">✏️ Edit</button>
        <button class="btn btn-danger" onclick="deleteAccount('${id}')">🗑️ Delete</button>
      </div>
    </div>

    <div class="drawer-section">
      <h4>Timeline</h4>
      <div class="timeline">
        ${timeline.map(t => `<div class="tl-item" style="--tl-c:${t.c}"><div>${t.txt}</div>${t.note ? `<div class="tl-note">${esc(t.note)}</div>` : ''}<div class="tl-time">${fmtDT(t.at)}</div></div>`).join('') || '<div class="empty">No activity yet — make the first move. 📞</div>'}
      </div>
    </div>`;

  // note-aware touchpoint logging: patch quickLog note pickup
  const noteInput = $('tp-note-input');
  document.querySelectorAll('.tp-log-btn').forEach((b, i) => {
    b.onclick = async () => {
      const note = noteInput.value.trim() || null;
      await sb.from('touchpoints').insert({ account_id: id, type: TP_TYPES[i].key, note });
      toast(`${TP_TYPES[i].icon} ${TP_TYPES[i].label} logged`);
      await loadAll(); openDrawer(id);
    };
  });
}
function closeDrawer(e) { $('drawer-overlay').classList.add('hidden'); currentDrawerId = null; }

async function setStage(id, stage) {
  await sb.from('accounts').update({ stage }).eq('id', id);
  toast(`Moved to ${stageInfo(stage).label}`);
  await loadAll(); openDrawer(id);
}
async function addStageNote(id, stage) {
  const v = $('stage-note-input').value.trim(); if (!v) return;
  await sb.from('stage_notes').insert({ account_id: id, stage, body: v });
  await loadAll(); openDrawer(id);
}
async function deleteAccount(id) {
  if (!confirm('Delete this account and all its history?')) return;
  await sb.from('accounts').delete().eq('id', id);
  closeDrawer(); toast('Account deleted'); await loadAll();
}

// ===== MODALS =====
function showModal(html) { $('modal-content').innerHTML = html; $('modal-overlay').classList.remove('hidden'); }
function closeModal() { $('modal-overlay').classList.add('hidden'); }

function openAccountModal(id) {
  const a = id ? state.accounts.find(x => x.id === id) : null;
  showModal(`
    <h3>${a ? '✏️ Edit Account' : '🆕 New Pursuit'}</h3>
    <div class="field"><label>Business name</label><input id="m-name" class="input" value="${esc(a?.name || '')}" placeholder="Tony's Pizza"></div>
    <div class="field"><label>Salesforce link (paste it — name becomes the clickable pill)</label><input id="m-sf" class="input" value="${esc(a?.sf_url || '')}" placeholder="https://uber.lightning.force.com/…"></div>
    <div class="field"><label>Decision maker</label><input id="m-dm" class="input" value="${esc(a?.dm_name || '')}" placeholder="Who signs?"></div>
    <div class="field"><label>City</label><input id="m-city" class="input" value="${esc(a?.city || '')}" placeholder="Columbus, OH"></div>
    <div class="modal-actions">
      <button class="btn btn-ghost" onclick="closeModal()">Cancel</button>
      <button class="btn btn-primary btn-glow" onclick="saveAccount('${id || ''}')">${a ? 'Save' : 'Start the pursuit 🔥'}</button>
    </div>`);
}
async function saveAccount(id) {
  const row = { name: $('m-name').value.trim(), sf_url: $('m-sf').value.trim() || null, dm_name: $('m-dm').value.trim() || null, city: $('m-city').value.trim() || null };
  if (!row.name) return toast('Name it first');
  if (id) await sb.from('accounts').update(row).eq('id', id);
  else await sb.from('accounts').insert(row);
  closeModal(); toast(id ? 'Saved' : '🔥 New pursuit started'); await loadAll();
  if (id && currentDrawerId === id) openDrawer(id);
}

function openReminderModal(accountId) {
  const opts = state.accounts.filter(a => !['closed_won', 'moving_on'].includes(a.stage)).map(a => `<option value="${a.id}" ${a.id === accountId ? 'selected' : ''}>${esc(a.name)}</option>`).join('');
  const dt = new Date(Date.now() + 3600000); dt.setMinutes(0);
  showModal(`
    <h3>⏰ New Reminder</h3>
    <div class="field"><label>What</label><input id="m-rtitle" class="input" placeholder="Call Tony back about the demo"></div>
    <div class="field"><label>When</label><input id="m-rdue" class="input" type="datetime-local" value="${new Date(dt.getTime() - dt.getTimezoneOffset() * 60000).toISOString().slice(0, 16)}"></div>
    <div class="field"><label>Account (optional)</label><select id="m-racct" class="input"><option value="">— none —</option>${opts}</select></div>
    <div class="modal-actions">
      <button class="btn btn-ghost" onclick="closeModal()">Cancel</button>
      <button class="btn btn-primary btn-glow" onclick="saveReminder()">Set it</button>
    </div>`);
}
async function saveReminder() {
  const title = $('m-rtitle').value.trim(); if (!title) return toast('Give it a title');
  await sb.from('reminders').insert({ title, due_at: new Date($('m-rdue').value).toISOString(), account_id: $('m-racct').value || null });
  closeModal(); toast('⏰ Reminder set'); await loadAll();
}

function openApptModal(accountId, dateStr) {
  const opts = state.accounts.map(a => `<option value="${a.id}" ${a.id === accountId ? 'selected' : ''}>${esc(a.name)}</option>`).join('');
  const base = dateStr ? new Date(dateStr + 'T10:00') : new Date(Date.now() + 86400000);
  showModal(`
    <h3>📅 New Appointment</h3>
    <div class="field"><label>Title</label><input id="m-atitle" class="input" placeholder="Pitch meeting with Tony"></div>
    <div class="field"><label>Type</label><select id="m-akind" class="input">
      <option value="call">📞 Call</option><option value="in_market">🚗 In-market meeting</option><option value="other">📌 Other</option></select></div>
    <div class="field"><label>Starts</label><input id="m-astart" class="input" type="datetime-local" value="${new Date(base.getTime() - base.getTimezoneOffset() * 60000).toISOString().slice(0, 16)}"></div>
    <div class="field"><label>Location (optional)</label><input id="m-aloc" class="input" placeholder="Their restaurant / Zoom / phone"></div>
    <div class="field"><label>Account (optional)</label><select id="m-aacct" class="input"><option value="">— none —</option>${opts}</select></div>
    <div class="modal-actions">
      <button class="btn btn-ghost" onclick="closeModal()">Cancel</button>
      <button class="btn btn-primary btn-glow" onclick="saveAppt()">Book it</button>
    </div>`);
}
async function saveAppt() {
  const title = $('m-atitle').value.trim(); if (!title) return toast('Give it a title');
  await sb.from('appointments').insert({ title, kind: $('m-akind').value, starts_at: new Date($('m-astart').value).toISOString(), location: $('m-aloc').value.trim() || null, account_id: $('m-aacct').value || null });
  closeModal(); toast('📅 Booked'); await loadAll();
}

// ===== CALENDAR =====
$('cal-prev').onclick = () => { shiftMonth(-1); };
$('cal-next').onclick = () => { shiftMonth(1); };
function shiftMonth(d) {
  let [y, m] = state.calMonth; m += d;
  if (m < 0) { m = 11; y--; } if (m > 11) { m = 0; y++; }
  state.calMonth = [y, m]; renderCalendar();
}
function renderCalendar() {
  const [y, m] = state.calMonth;
  $('cal-title').textContent = new Date(y, m).toLocaleString([], { month: 'long', year: 'numeric' });
  const first = new Date(y, m, 1);
  const startDow = first.getDay();
  const cells = [];
  const dows = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map(d => `<div class="cal-dow">${d}</div>`).join('');
  const todayStr = new Date().toDateString();
  for (let i = 0; i < 42; i++) {
    const d = new Date(y, m, 1 - startDow + i);
    const ds = d.toDateString();
    const iso = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    const appts = state.appointments.filter(a => new Date(a.starts_at).toDateString() === ds);
    const rems = state.reminders.filter(r => new Date(r.due_at).toDateString() === ds);
    cells.push(`<div class="cal-cell ${d.getMonth() !== m ? 'other-month' : ''} ${ds === todayStr ? 'today' : ''}" onclick="dayClick('${iso}')">
      <div class="d">${d.getDate()}</div>
      ${appts.slice(0, 3).map(a => `<div class="cal-evt ${a.kind}">${fmtT(a.starts_at)} ${esc(a.title)}</div>`).join('')}
      ${rems.slice(0, 2).map(r => `<div class="cal-evt rem">⏰ ${esc(r.title)}</div>`).join('')}
      ${appts.length + rems.length > 5 ? `<div class="cal-evt other">+${appts.length + rems.length - 5} more</div>` : ''}
    </div>`);
  }
  $('calendar').innerHTML = dows + cells.join('');
}
function dayClick(iso) {
  const d = new Date(iso + 'T00:00');
  const ds = d.toDateString();
  const appts = state.appointments.filter(a => new Date(a.starts_at).toDateString() === ds);
  const rems = state.reminders.filter(r => new Date(r.due_at).toDateString() === ds);
  const el = $('cal-day-detail');
  el.classList.remove('hidden');
  el.innerHTML = `<h3>${d.toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric' })}</h3>
    ${appts.map(a => `<div class="row"><span>${a.kind === 'in_market' ? '🚗' : '📞'}</span><div class="row-main">${esc(a.title)}${a.location ? `<div class="row-sub">📍 ${esc(a.location)}</div>` : ''}${a.account_id ? `<div class="row-sub">${esc(accName(a.account_id))}</div>` : ''}</div><span class="row-time">${fmtT(a.starts_at)}</span><button class="btn btn-danger" style="padding:4px 10px" onclick="delAppt('${a.id}','${iso}')">✕</button></div>`).join('')}
    ${rems.map(r => `<div class="row"><span>⏰</span><div class="row-main">${esc(r.title)}</div><span class="row-time">${fmtT(r.due_at)}</span></div>`).join('')}
    ${!appts.length && !rems.length ? '<div class="empty">Nothing this day.</div>' : ''}
    <button class="btn btn-primary btn-glow" style="margin-top:10px" onclick="openApptModal(null,'${iso}')">+ Add appointment</button>`;
}
async function delAppt(id, iso) {
  await sb.from('appointments').delete().eq('id', id);
  toast('Appointment removed'); await loadAll(); dayClick(iso);
}

// ===== MARKET DATA =====
function renderMarket() {
  $('market-list').innerHTML = state.market.length ? state.market.map(m => `
    <div class="panel glow-hover market-card">
      <h3>📊 ${esc(m.name)}</h3>
      <div class="market-meta">${m.market ? esc(m.market) + ' · ' : ''}${fmtDT(m.uploaded_at)} · ${(m.content.length / 1024).toFixed(1)}kb</div>
      <pre>${esc(m.content.slice(0, 400))}</pre>
      <button class="btn btn-danger" style="margin-top:10px" onclick="delMarket('${m.id}')">🗑️ Remove</button>
    </div>`).join('') : '<div class="empty">No market data yet. Add the spreadsheets Uber sends you and Claude will weaponize them in your emails.</div>';
}
function openMarketModal() {
  showModal(`
    <h3>📊 Add Market Data</h3>
    <div class="field"><label>Name</label><input id="m-mkname" class="input" placeholder="Q3 Columbus Restaurant Report"></div>
    <div class="field"><label>Market</label><input id="m-mkmarket" class="input" placeholder="Columbus, OH"></div>
    <div class="field"><label>Upload CSV / text file</label><input id="m-mkfile" class="input" type="file" accept=".csv,.txt,.tsv"></div>
    <div class="field"><label>…or paste it</label><textarea id="m-mkpaste" class="input" rows="6" placeholder="Paste spreadsheet cells or any market intel here"></textarea></div>
    <div class="modal-actions">
      <button class="btn btn-ghost" onclick="closeModal()">Cancel</button>
      <button class="btn btn-primary btn-glow" onclick="saveMarket()">Add it</button>
    </div>`);
}
async function saveMarket() {
  const name = $('m-mkname').value.trim(); if (!name) return toast('Name it first');
  let content = $('m-mkpaste').value.trim();
  const f = $('m-mkfile').files[0];
  if (f) content = await f.text();
  if (!content) return toast('Upload or paste some data');
  await sb.from('market_data').insert({ name, market: $('m-mkmarket').value.trim() || null, content: content.slice(0, 100000) });
  closeModal(); toast('📊 Market data added'); await loadAll();
}
async function delMarket(id) {
  await sb.from('market_data').delete().eq('id', id);
  toast('Removed'); await loadAll();
}

// ===== AI STUDIO =====
function renderAIStudio() {
  $('voice-samples').innerHTML = state.voice.length ? state.voice.map(v => `
    <div class="row voice-sample-row">
      <div class="row-main">${esc(v.label || 'Sample')}<div class="row-sub">${esc(v.body.slice(0, 80))}…</div></div>
      <button class="btn btn-danger" style="padding:4px 10px" onclick="delVoice('${v.id}')">✕</button>
    </div>`).join('') : '<div class="empty">No samples yet — paste a few real emails you’ve sent.</div>';
  $('voice-status').textContent = state.profile?.style_notes ? '🧠 Voice trained ' + fmtDT(state.profile.updated_at) : '';

  const activeAccs = state.accounts.filter(a => !['closed_won', 'moving_on'].includes(a.stage));
  $('gen-account').innerHTML = '<option value="">Pick an account…</option>' + activeAccs.map(a => `<option value="${a.id}">${esc(a.name)}</option>`).join('');
  $('gen-market').innerHTML = '<option value="">No market data</option>' + state.market.map(m => `<option value="${m.id}">${esc(m.name)}</option>`).join('');
}
function openVoiceModal() {
  showModal(`
    <h3>🎙️ Add Email Sample</h3>
    <div class="field"><label>Label (optional)</label><input id="m-vlabel" class="input" placeholder="Follow-up that got a reply"></div>
    <div class="field"><label>The email you actually sent</label><textarea id="m-vbody" class="input" rows="10" placeholder="Paste the whole email…"></textarea></div>
    <div class="modal-actions">
      <button class="btn btn-ghost" onclick="closeModal()">Cancel</button>
      <button class="btn btn-primary btn-glow" onclick="saveVoice()">Add sample</button>
    </div>`);
}
async function saveVoice() {
  const body = $('m-vbody').value.trim(); if (!body) return toast('Paste the email');
  await sb.from('voice_samples').insert({ label: $('m-vlabel').value.trim() || null, body });
  closeModal(); toast('🎙️ Sample added'); await loadAll();
}
async function delVoice(id) { await sb.from('voice_samples').delete().eq('id', id); await loadAll(); }

$('train-btn').onclick = async () => {
  if (!state.voice.length) return toast('Add at least one email sample first');
  const btn = $('train-btn'); btn.disabled = true; btn.textContent = '🧠 Learning your voice…';
  try {
    const notes = await callAI('distill_voice', { samples: state.voice.map(v => v.body) });
    await sb.from('voice_profile').upsert({ id: 1, style_notes: notes, updated_at: new Date().toISOString() });
    toast('🧠 Voice trained'); await loadAll();
  } catch (e) { toast('⚠️ ' + e.message); }
  btn.disabled = false; btn.textContent = '🧠 Train my voice';
};

$('gen-goal').onchange = () => $('gen-custom').classList.toggle('hidden', $('gen-goal').value !== 'custom');

function genForAccount(id) {
  document.querySelector('.nav-btn[data-tab="ai"]').click();
  closeDrawer();
  $('gen-account').value = id;
}

$('gen-btn').onclick = async () => {
  const accId = $('gen-account').value;
  if (!accId) return toast('Pick an account');
  const a = state.accounts.find(x => x.id === accId);
  const st = state.stats[accId] || {};
  const mkt = state.market.find(m => m.id === $('gen-market').value);
  const btn = $('gen-btn'); btn.disabled = true; btn.textContent = '🔮 Writing…';
  try {
    const email = await callAI('generate_email', {
      account: { name: a.name, dm_name: a.dm_name, city: a.city, stage: a.stage, touchpoints: st, notes: a.notes },
      goal: $('gen-goal').value,
      custom: $('gen-custom').value.trim(),
      market_data: mkt ? { name: mkt.name, content: mkt.content.slice(0, 30000) } : null,
      style_notes: state.profile?.style_notes || null,
      samples: state.profile?.style_notes ? [] : state.voice.slice(0, 3).map(v => v.body),
    });
    $('gen-output').value = email;
    $('gen-output-wrap').classList.remove('hidden');
  } catch (e) { toast('⚠️ ' + e.message); }
  btn.disabled = false; btn.textContent = '✨ Generate Email';
};
$('copy-email-btn').onclick = () => { navigator.clipboard.writeText($('gen-output').value); toast('📋 Copied'); };
$('log-email-btn').onclick = async () => {
  navigator.clipboard.writeText($('gen-output').value);
  const accId = $('gen-account').value;
  if (accId) { await sb.from('touchpoints').insert({ account_id: accId, type: 'email', note: 'AI-drafted email' }); toast('📋 Copied + ✉️ logged'); await loadAll(); }
};

// ===== AI CALL =====
async function callAI(mode, payload) {
  const { data: { session } } = await sb.auth.getSession();
  const res = await fetch('/api/ai', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + session.access_token },
    body: JSON.stringify({ mode, ...payload, _context: mode === 'briefing' ? briefingContext() : undefined }),
  });
  if (!res.ok) { const e = await res.json().catch(() => ({})); throw new Error(e.error || 'AI call failed (' + res.status + ')'); }
  return (await res.json()).text;
}
function briefingContext() {
  const now = new Date();
  const active = state.accounts.filter(a => !['closed_won', 'moving_on'].includes(a.stage));
  return {
    today: now.toDateString(),
    reminders: state.reminders.map(r => ({ title: r.title, due: r.due_at, account: accName(r.account_id), overdue: new Date(r.due_at) < now })),
    appointments: state.appointments.filter(a => new Date(a.starts_at) >= new Date(now.toDateString()) && new Date(a.starts_at) < new Date(Date.now() + 3 * 86400000)).map(a => ({ title: a.title, at: a.starts_at, kind: a.kind, account: accName(a.account_id) })),
    accounts: active.map(a => {
      const st = state.stats[a.id] || {};
      return { name: a.name, stage: a.stage, dm: a.dm_name, touchpoints: st.total_touchpoints || 0, days_quiet: daysAgo(st.last_touch_at || a.created_at), ice_until: a.ice_until };
    }),
  };
}

init();
