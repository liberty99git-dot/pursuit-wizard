// ===== Pursuit Wizard =====
const SUPABASE_URL = 'https://oenapblefpxhjrqqcbme.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_X89W8WryekjguGHTXZZN3Q_Itq9bUO3';
const sb = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// `short` is what fits a 9-across column header; `label` is the full name.
// `park: true` marks the two states an account can drop into from anywhere.
const STAGES = [
  { key: 'looking_for_dm', label: 'Looking for DM', short: 'Looking for DM', icon: 'search', color: 'var(--stage-looking)' },
  { key: 'found_dm', label: 'Found DM', short: 'Found DM', icon: 'user-check', color: 'var(--stage-found)' },
  { key: 'talked_to_dm', label: 'Talked to DM', short: 'Talked to DM', icon: 'message-circle', color: 'var(--stage-talked)' },
  { key: 'appointment_set', label: 'Appointment Set', short: 'Appt Set', icon: 'calendar-check', color: 'var(--stage-appt)' },
  { key: 'pitched', label: 'Pitched', short: 'Pitched', icon: 'mic', color: 'var(--stage-pitched)' },
  { key: 'negotiating', label: 'Negotiating', short: 'Negotiating', icon: 'exchange', color: 'var(--stage-negotiating)' },
  { key: 'closed_won', label: 'Closed Won', short: 'Closed Won', icon: 'trophy', color: 'var(--stage-closed)' },
  { key: 'on_ice', label: 'On Ice', short: 'On Ice', icon: 'snowflake', color: 'var(--stage-ice)', park: true },
  { key: 'moving_on', label: 'Moving On', short: 'Moving On', icon: 'circle-x', color: 'var(--stage-gone)', park: true },
];
const stageInfo = k => STAGES.find(s => s.key === k) || STAGES[0];
const TP_TYPES = [
  { key: 'dial', icon: 'phone', label: 'Dial' },
  { key: 'email', icon: 'mail', label: 'Email' },
  { key: 'text', icon: 'message-square', label: 'Text' },
  { key: 'voicemail', icon: 'voicemail', label: 'Voicemail' },
];
const ico = (name, cls = 'ico') => `<svg class="${cls}"><use href="#i-${name}"/></svg>`;

let state = { accounts: [], stats: {}, reminders: [], appointments: [], market: [], voice: [], profile: null, calMonth: null, session: null };

const $ = id => document.getElementById(id);
const esc = s => (s ?? '').toString().replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// ---- Timezone. Mark is Central; most of his book (Cincinnati / N. Kentucky) is Eastern.
// Any time tied to an account renders in BOTH zones so a meeting is never off by an hour.
const MY_TZ = 'America/Chicago';
const ZONES = [
  { tz: 'America/New_York', abbr: 'ET', label: 'Eastern — Cincinnati, N. Kentucky' },
  { tz: 'America/Chicago', abbr: 'CT', label: 'Central — my time' },
  { tz: 'America/Denver', abbr: 'MT', label: 'Mountain' },
  { tz: 'America/Los_Angeles', abbr: 'PT', label: 'Pacific' },
];
const abbrOf = tz => (ZONES.find(z => z.tz === tz) || ZONES[1]).abbr;

const fmtDT = d => new Date(d).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZone: MY_TZ });
const fmtT = d => new Date(d).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', timeZone: MY_TZ });
const fmtTz = (d, tz) => new Date(d).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', timeZone: tz });
const ymdTz = (d, tz) => new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(d));

// "10:00 AM CT · 11:00 AM ET" — collapses to one zone when they match.
function dualT(d, theirTz) {
  const mine = `${fmtT(d)} ${abbrOf(MY_TZ)}`;
  if (!theirTz || theirTz === MY_TZ) return mine;
  return `${mine} · ${fmtTz(d, theirTz)} ${abbrOf(theirTz)}`;
}

// Offset of a zone at a given instant, so a typed wall-clock time can be
// anchored to the right zone instead of silently meaning Mark's.
function tzOffsetMs(tz, date) {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', {
    timeZone: tz, hour12: false, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  }).formatToParts(date).map(x => [x.type, x.value]));
  return Date.UTC(p.year, p.month - 1, p.day, p.hour % 24, p.minute, p.second) - date.getTime();
}
// "2026-07-30T14:00" typed as ET -> correct UTC instant. Second pass settles DST edges.
function wallToISO(localStr, tz) {
  if (!localStr) return null;
  const naive = new Date(localStr + ':00Z');
  let inst = new Date(naive.getTime() - tzOffsetMs(tz, naive));
  inst = new Date(naive.getTime() - tzOffsetMs(tz, inst));
  return inst.toISOString();
}
// Inverse: UTC instant -> the datetime-local string showing that wall time in tz.
function isoToWall(iso, tz) {
  const d = new Date(iso);
  return new Date(d.getTime() + tzOffsetMs(tz, d)).toISOString().slice(0, 16);
}
const daysAgo = d => Math.max(0, Math.floor((Date.now() - new Date(d)) / 86400000));
const fmtD = d => new Date(d).toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric', timeZone: MY_TZ });
const CLOSEOUT_STEPS = [
  ['agreement_sent_at', 'file', 'Agreement Sent'],
  ['agreement_signed_at', 'check', 'Agreement Signed'],
  ['banking_received_at', 'trophy', 'Banking Received — CW1'],
];
const PROMO_LABEL = { none: 'No promo', bogo: 'BOGO', spend_get_off: 'Spend X, Get $ Off', spend_get_free: 'Spend X, Get Free Item', other: 'Other' };

// Tier drives comp — T1 is worth 7x a T5. Points are a generated column in
// Postgres (accounts.tier_points); this mirror keeps the UI from round-tripping.
const TIER_POINTS = { 1: 7, 2: 4, 3: 3, 4: 2, 5: 1 };
const TIERS = [1, 2, 3, 4, 5];
const ptsOf = a => TIER_POINTS[a.tier] ?? 3;
const sumPts = list => list.reduce((n, a) => n + ptsOf(a), 0);
// How long it's sat in its current stage — the "am I stalling on this?" number.
const daysInStage = a => daysAgo(a.stage_changed_at || a.created_at);
const daysQuiet = a => daysAgo((state.stats[a.id] || {}).last_touch_at || a.created_at);
const tpTotal = a => (state.stats[a.id] || {}).total_touchpoints || 0;
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
    sb.from('reminders').select('*').order('due_at'),
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
function renderAll() { renderDashboard(); renderBoard(); renderReminders(); renderCalendar(); renderMarket(); renderAIStudio(); renderReports(); }

// ===== REMINDERS =====
// Completed ones stay listed so a mis-click is recoverable — nothing is deleted
// on completion, only stamped with done_at.
function renderReminders() {
  const now = new Date(), today = ymdTz(now, MY_TZ);
  const open = state.reminders.filter(r => !r.done);
  const buckets = [
    ['Overdue', open.filter(r => new Date(r.due_at) < now && ymdTz(r.due_at, MY_TZ) !== today), 'overdue'],
    ['Today', open.filter(r => ymdTz(r.due_at, MY_TZ) === today), 'today'],
    ['Upcoming', open.filter(r => ymdTz(r.due_at, MY_TZ) > today), 'upcoming'],
    ['Completed', state.reminders.filter(r => r.done).sort((a, b) => new Date(b.done_at || 0) - new Date(a.done_at || 0)), 'done'],
  ];
  $('reminders-body').innerHTML = buckets.map(([title, list, cls]) => `
    <div class="panel glow-hover rem-group ${cls}" style="margin-bottom:14px">
      <h3>${esc(title)} <span class="count">${list.length}</span></h3>
      ${list.length ? list.map(r => reminderRow(r, cls)).join('') : '<div class="empty">Nothing here.</div>'}
    </div>`).join('');
}
function reminderRow(r, cls) {
  const overdue = !r.done && new Date(r.due_at) < new Date();
  return `<div class="row ${r.done ? 'row-done' : ''}">
    ${r.done
      ? `<button class="check-btn checked" onclick="uncompleteReminder('${r.id}')" title="Undo — put it back">${ico('check', 'ico-xs')}</button>`
      : `<button class="check-btn" onclick="completeReminder('${r.id}')" title="Mark done">${ico('check', 'ico-xs')}</button>`}
    <div class="row-main">${esc(r.title)}
      <div class="row-sub">${r.account_id ? esc(accName(r.account_id)) + ' · ' : ''}${fmtDT(r.due_at)}${r.done && r.done_at ? ' · done ' + fmtDT(r.done_at) : ''}</div>
    </div>
    <span class="row-time ${overdue ? 'stale' : ''}">${overdue ? 'overdue' : ''}</span>
    <button class="btn btn-danger btn-icon" title="Delete" onclick="deleteReminder('${r.id}')">${ico('trash', 'ico-xs')}</button>
  </div>`;
}
async function uncompleteReminder(id) {
  await sb.from('reminders').update({ done: false, done_at: null }).eq('id', id);
  toast('Restored'); await loadAll();
}
async function deleteReminder(id) {
  if (!confirm('Delete this reminder for good?')) return;
  await sb.from('reminders').delete().eq('id', id);
  toast('Deleted'); await loadAll();
}

// ===== REPORTS =====
// Buckets are computed on the account's timezone-local calendar day, then
// walked as plain UTC-midnight dates — good enough for week/month rollups,
// not meant to be to-the-minute precise.
function periodBounds(range) {
  const today = new Date(ymdTz(new Date(), MY_TZ) + 'T00:00:00Z');
  if (range === 'month') {
    const y = today.getUTCFullYear(), m = today.getUTCMonth();
    return { start: new Date(Date.UTC(y, m, 1)), end: new Date(Date.UTC(y, m + 1, 1)), prevStart: new Date(Date.UTC(y, m - 1, 1)), prevEnd: new Date(Date.UTC(y, m, 1)) };
  }
  const dow = today.getUTCDay(), toMon = dow === 0 ? 6 : dow - 1;
  const start = new Date(today); start.setUTCDate(start.getUTCDate() - toMon);
  const end = new Date(start); end.setUTCDate(end.getUTCDate() + 7);
  const prevStart = new Date(start); prevStart.setUTCDate(prevStart.getUTCDate() - 7);
  return { start, end, prevStart, prevEnd: start };
}
const inRange = (d, start, end) => { if (!d) return false; const t = new Date(ymdTz(d, MY_TZ) + 'T00:00:00Z'); return t >= start && t < end; };

function renderReports() {
  const range = state.reportRange || 'week';
  $('rep-week-btn')?.classList.toggle('active', range === 'week');
  $('rep-month-btn')?.classList.toggle('active', range === 'month');
  const { start, end, prevStart, prevEnd } = periodBounds(range);
  const cw1s = state.accounts.filter(a => inRange(a.banking_received_at, start, end));
  const cw1sPrev = state.accounts.filter(a => inRange(a.banking_received_at, prevStart, prevEnd));
  const trips = state.accounts.filter(a => inRange(a.first_trip_at, start, end));
  const tripsPrev = state.accounts.filter(a => inRange(a.first_trip_at, prevStart, prevEnd));
  const spend = cw1s.reduce((s, a) => s + (+a.placement_ad_spend || 0), 0);
  const delta = (n, p) => n === p ? '±0' : (n > p ? '+' : '') + (n - p);
  const tile = (n, l, d) => `<div class="stat-tile"><div class="num">${n}</div><div class="lbl">${l}</div>${d !== undefined ? `<div class="stat-delta">${d} vs last ${range}</div>` : ''}</div>`;
  $('rep-stats').innerHTML = [
    tile(cw1s.length, 'CW1s', delta(cw1s.length, cw1sPrev.length)),
    tile(trips.length, 'First Trips', delta(trips.length, tripsPrev.length)),
    tile('$' + spend.toFixed(0), 'Placement Ad Spend'),
    tile(cw1s.filter(a => a.promo_type && a.promo_type !== 'none').length, 'CW1s With Promo'),
  ].join('');
  $('rep-table').innerHTML = cw1s.length ? `<div class="rep-table-wrap"><table class="rep-table"><thead><tr>
      <th>Account</th><th>CW1 Date</th><th>First Trip</th><th>Onboarding</th><th>Ad Spend</th><th>Promo</th>
    </tr></thead><tbody>
    ${cw1s.map(a => `<tr>
      <td>${esc(a.name)}</td>
      <td>${fmtD(a.banking_received_at)}</td>
      <td>${a.first_trip_at ? fmtD(a.first_trip_at) : '<span class="text-faint">pending</span>'}</td>
      <td>${esc(a.onboarding_specialist || '—')}</td>
      <td>$${(+a.placement_ad_spend || 0).toFixed(0)}</td>
      <td>${PROMO_LABEL[a.promo_type] || '—'}${a.promo_note ? ` <span class="text-faint">(${esc(a.promo_note)})</span>` : ''}</td>
    </tr>`).join('')}
    </tbody></table></div>` : `<div class="empty">No CW1s this ${range} yet.</div>`;
}
$('rep-week-btn')?.addEventListener('click', () => { state.reportRange = 'week'; renderReports(); });
$('rep-month-btn')?.addEventListener('click', () => { state.reportRange = 'month'; renderReports(); });

const accName = id => state.accounts.find(a => a.id === id)?.name || '';
const acctTz = id => state.accounts.find(a => a.id === id)?.timezone || null;
function sfPill(a, small) {
  if (!a.sf_url) return `<span class="card-name-txt">${esc(a.name)}</span>`;
  return `<a class="sf-pill" href="${esc(a.sf_url)}" target="_blank" rel="noopener" onclick="event.stopPropagation()">${esc(a.name)}${ico('external', 'ico-xs')}</a>`;
}

// ===== DASHBOARD =====
function renderDashboard() {
  const h = new Date().getHours();
  $('greeting').textContent = (h < 12 ? 'Morning' : h < 17 ? 'Afternoon' : 'Evening') + ', Mark — let’s hunt.';

  // reminders
  const now = new Date();
  const openRems = state.reminders.filter(r => !r.done);
  $('dash-reminders').innerHTML = openRems.length ? openRems.map(r => {
    const overdue = new Date(r.due_at) < now;
    return `<div class="row ${overdue ? 'overdue' : ''}">
      <button class="check-btn" onclick="completeReminder('${r.id}')" title="Mark done">${ico('check', 'ico-xs')}</button>
      <div class="row-main">${esc(r.title)}${r.account_id ? `<div class="row-sub">${esc(accName(r.account_id))}</div>` : ''}</div>
      <span class="row-time">${fmtDT(r.due_at)}</span>
    </div>`;
  }).join('') : '<div class="empty">Nothing pending. Set one so future-you stays sharp.</div>';

  // appointments (today + next 7 days)
  const week = state.appointments.filter(a => { const d = new Date(a.starts_at); return d >= new Date(now.toDateString()) && d < new Date(Date.now() + 7 * 86400000); });
  $('dash-appts').innerHTML = week.length ? week.map(a => {
    const tz = acctTz(a.account_id);
    return `<div class="row">
      <span class="row-ico">${ico(a.kind === 'in_market' ? 'car' : a.kind === 'call' ? 'phone' : 'pin')}</span>
      <div class="row-main">${esc(a.title)}${a.account_id ? `<div class="row-sub">${esc(accName(a.account_id))}</div>` : ''}
        <div class="row-sub">${dualT(a.starts_at, tz)}</div></div>
      <span class="row-time">${new Date(a.starts_at).toLocaleDateString([], { month: 'short', day: 'numeric', timeZone: MY_TZ })}</span>
    </div>`;
  }).join('') : '<div class="empty">No appointments this week — go set some.</div>';

  // needs attention: active accounts, no touch in 4+ days (or never), sorted stalest first
  const active = state.accounts.filter(a => !['closed_won', 'moving_on', 'on_ice'].includes(a.stage));
  const attention = active.map(a => {
    const st = state.stats[a.id] || {};
    const last = st.last_touch_at || a.created_at;
    return { a, st, days: daysAgo(last) };
  }).filter(x => x.days >= 4).sort((x, y) => y.days - x.days).slice(0, 8);
  $('dash-attention').innerHTML = attention.length ? attention.map(({ a, st, days }) => `
    <div class="row" style="cursor:pointer" onclick="openDrawer('${a.id}')">
      <span class="row-ico" style="color:${stageInfo(a.stage).color}">${ico(stageInfo(a.stage).icon)}</span>
      <div class="row-main">${esc(a.name)}<div class="row-sub">${stageInfo(a.stage).label} · ${st.total_touchpoints || 0} touchpoints</div></div>
      <span class="row-time" style="color:var(--amber)">${days}d quiet</span>
    </div>`).join('') : '<div class="empty">Everything’s been touched recently. You’re on it.</div>';

  // stats
  const totalTp = Object.values(state.stats).reduce((s, x) => s + (+x.total_touchpoints || 0), 0);
  const wk = state.accounts.filter(a => a.stage === 'closed_won').length;
  const tiles = [
    [active.length, 'Active pursuits'],
    [sumPts(active), 'Points in play'],
    [totalTp, 'Total touchpoints'],
    [wk, 'Closed won'],
    [state.accounts.filter(a => a.stage === 'on_ice').length, 'On ice'],
    [active.length ? Math.round(totalTp / Math.max(state.accounts.length, 1)) : 0, 'Avg touches/acct'],
  ];
  $('dash-stats').innerHTML = tiles.map(([n, l]) => `<div class="stat-tile"><div class="num">${n}</div><div class="lbl">${l}</div></div>`).join('');
}

async function completeReminder(id) {
  await sb.from('reminders').update({ done: true, done_at: new Date().toISOString() }).eq('id', id);
  toast('Reminder done — find it under Reminders › Completed');
  await loadAll();
}

$('test-digest-btn').onclick = async () => {
  const btn = $('test-digest-btn'); btn.disabled = true; btn.textContent = 'Sending…';
  try {
    const { data: { session } } = await sb.auth.getSession();
    const r = await fetch('/api/cron-digest?force=1', { headers: { Authorization: 'Bearer ' + session.access_token } });
    const out = await r.json();
    if (out.sent) toast('Sent — check your inbox');
    else if (out.reason === 'RESEND_API_KEY not set') toast('Add RESEND_API_KEY in Vercel first');
    else if (out.reason) toast('Nothing to report right now');
    else toast(JSON.stringify(out.error || out).slice(0, 60));
  } catch (e) { toast(e.message); }
  btn.disabled = false; btn.innerHTML = ico('inbox') + ' Email me this';
};

// ===== BRIEFING =====
$('briefing-btn').onclick = async () => {
  const btn = $('briefing-btn'); btn.disabled = true; btn.textContent = 'Thinking…';
  try {
    const out = await callAI('briefing', {});
    $('briefing-box').textContent = out;
    $('briefing-box').classList.remove('hidden');
  } catch (e) { toast(e.message); }
  btn.disabled = false; btn.innerHTML = ico('sparkles') + ' Morning Briefing';
};

// ===== PIPELINE BOARD =====
// One column definition drives both the clickable table header and the sort
// dropdown, so the two can never disagree. `defDir` is the direction a column
// takes on first click — most-touched, longest-quiet, biggest-tier first.
const LIST_COLS = [
  { key: 'tier', label: 'Tier', get: a => ptsOf(a), defDir: 'desc' },
  { key: 'name', label: 'Account', get: a => a.name.toLowerCase(), defDir: 'asc' },
  { key: 'stage', label: 'Stage', get: a => STAGES.findIndex(s => s.key === a.stage), defDir: 'asc' },
  { key: 'in_stage', label: 'In stage', get: a => daysInStage(a), defDir: 'desc' },
  { key: 'quiet', label: 'Quiet', get: a => daysQuiet(a), defDir: 'desc' },
  { key: 'touches', label: 'Touches', get: a => tpTotal(a), defDir: 'desc' },
  { key: 'dm', label: 'DM', get: a => (a.dm_name || '').toLowerCase(), defDir: 'asc' },
];
// Composite default that isn't a single column: heaviest tier first, and within
// a tier whatever's been ignored longest.
const priorityCmp = (a, b) => ptsOf(b) - ptsOf(a) || daysQuiet(b) - daysQuiet(a);

function comparator() {
  const key = state.sortKey || 'priority';
  if (key === 'priority') return priorityCmp;
  const col = LIST_COLS.find(c => c.key === key);
  if (!col) return priorityCmp;
  const m = (state.sortDir || col.defDir) === 'asc' ? 1 : -1;
  return (a, b) => {
    const x = col.get(a), y = col.get(b);
    return (x < y ? -1 : x > y ? 1 : 0) * m || a.name.localeCompare(b.name);
  };
}
function setSort(key) {
  const col = LIST_COLS.find(c => c.key === key);
  // Same column again flips direction; a new column starts at its natural one.
  state.sortDir = state.sortKey === key
    ? (state.sortDir === 'asc' ? 'desc' : 'asc')
    : (col ? col.defDir : 'desc');
  state.sortKey = key;
  const dd = $('pipe-sort');
  if (dd) dd.value = [...dd.options].some(o => o.value === key) ? key : 'custom';
  renderBoard();
}
function visibleAccounts() {
  const q = ($('pipeline-search').value || '').toLowerCase();
  return state.accounts
    .filter(a => !q || a.name.toLowerCase().includes(q) || (a.dm_name || '').toLowerCase().includes(q) || (a.city || '').toLowerCase().includes(q))
    .sort(comparator());
}

function renderBoard() {
  const view = state.pipeView || 'board';
  $('board').classList.toggle('hidden', view !== 'board');
  $('pipe-list').classList.toggle('hidden', view !== 'list');
  $('pipe-board-btn')?.classList.toggle('active', view === 'board');
  $('pipe-list-btn')?.classList.toggle('active', view === 'list');
  const accounts = visibleAccounts();

  $('board').innerHTML = STAGES.map(s => {
    const accs = accounts.filter(a => a.stage === s.key);
    const pts = sumPts(accs);
    return `<div class="col ${s.park ? 'col-park' : ''}" style="--stage-c:${s.color}">
      <div class="col-head" title="${esc(s.label)} — ${accs.length} accounts, ${pts} points">
        <div class="col-head-top">
          <span class="col-icon">${ico(s.icon)}</span>
          <span class="count">${accs.length}</span>
        </div>
        <span class="col-label">${esc(s.short)}</span>
        <span class="col-pts">${pts} pts</span>
      </div>
      <div class="col-body">${accs.map(a => cardHTML(a, s)).join('') || '<div class="col-empty"></div>'}</div>
    </div>`;
  }).join('');

  renderPipeList(accounts);
}

// The morning call-list. Same data as the board, laid out for working top-down.
function renderPipeList(accounts) {
  const rows = accounts.filter(a => !['closed_won', 'moving_on'].includes(a.stage));
  $('pipe-list').innerHTML = !rows.length ? '<div class="empty">Nothing matches.</div>' : `
    <div class="list-summary">${rows.length} open · <b>${sumPts(rows)} points</b> in play</div>
    <div class="rep-table-wrap"><table class="rep-table list-table"><thead><tr>
      ${LIST_COLS.map(c => {
        const on = state.sortKey === c.key;
        const dir = on ? (state.sortDir || c.defDir) : null;
        return `<th class="th-sort ${on ? 'active' : ''}" onclick="setSort('${c.key}')" title="Sort by ${esc(c.label)}">
          <span class="th-inner">${esc(c.label)}<span class="th-arrow">${on ? (dir === 'asc' ? '↑' : '↓') : ''}</span></span>
        </th>`;
      }).join('')}
      <th>Log</th>
    </tr></thead><tbody>
    ${rows.map(a => {
      const s = stageInfo(a.stage), q = daysQuiet(a);
      return `<tr onclick="openDrawer('${a.id}')">
        <td><span class="tier-badge t${a.tier}">T${a.tier}</span></td>
        <td class="cell-name">${esc(a.name)}${a.city ? `<span class="cell-sub">${esc(a.city)}</span>` : ''}</td>
        <td><span class="stage-tag" style="--sp-c:${s.color}">${ico(s.icon, 'ico-xs')}${esc(s.short)}</span></td>
        <td class="mono">${daysInStage(a)}d</td>
        <td class="mono ${q >= 4 ? 'stale' : ''}">${q}d</td>
        <td class="mono">${tpTotal(a)}</td>
        <td class="cell-sub-only">${esc(a.dm_name || '—')}</td>
        <td onclick="event.stopPropagation()"><div class="row-quick">${TP_TYPES.map(t => `<button class="quick-btn" title="Log ${t.label}" onclick="quickLog('${a.id}','${t.key}')">${ico(t.icon, 'ico-xs')}</button>`).join('')}</div></td>
      </tr>`;
    }).join('')}
    </tbody></table></div>`;
}
$('pipeline-search').addEventListener('input', renderBoard);
$('pipe-board-btn')?.addEventListener('click', () => { state.pipeView = 'board'; renderBoard(); });
$('pipe-list-btn')?.addEventListener('click', () => { state.pipeView = 'list'; renderBoard(); });
$('pipe-sort')?.addEventListener('change', e => {
  const key = e.target.value;
  const col = LIST_COLS.find(c => c.key === key);
  state.sortKey = key;
  state.sortDir = col ? col.defDir : 'desc';
  renderBoard();
});

function cardHTML(a, s) {
  const st = state.stats[a.id] || {};
  const d = daysAgo(st.last_touch_at || a.created_at);
  const counts = [st.dials, st.emails, st.texts, st.voicemails];
  return `<div class="card" style="--stage-c:${s.color}" onclick="openDrawer('${a.id}')" title="${esc(a.name)}${a.dm_name ? ' · ' + esc(a.dm_name) : ''}">
    <div class="card-top">
      <span class="tier-badge t${a.tier}" title="Tier ${a.tier} — ${ptsOf(a)} pts">T${a.tier}</span>
      <span class="card-name">${esc(a.name)}</span>
      ${a.sf_url ? `<a class="card-sf" href="${esc(a.sf_url)}" target="_blank" rel="noopener" title="Open in Salesforce" onclick="event.stopPropagation()">${ico('external', 'ico-xs')}</a>` : ''}
    </div>
    ${a.dm_name ? `<div class="card-sub">${esc(a.dm_name)}</div>` : ''}
    <div class="card-meta">
      <span class="tp-total">${st.total_touchpoints || 0}</span>
      <span class="days-chip ${d >= 4 ? 'stale' : ''}">${d}d</span>
    </div>
    <div class="tp-strip">
      ${TP_TYPES.map((t, i) => `<span class="tp-cell ${counts[i] ? '' : 'zero'}" title="${counts[i] || 0} ${t.label}">${ico(t.icon, 'ico-xs')}${counts[i] || 0}</span>`).join('')}
    </div>
    ${s.key === 'closed_won' ? closeoutMini(a) : ''}
    <div class="card-quick">
      ${TP_TYPES.map(t => `<button class="quick-btn" title="Log ${t.label}" onclick="event.stopPropagation();quickLog('${a.id}','${t.key}')">${ico(t.icon, 'ico-xs')}</button>`).join('')}
    </div>
  </div>`;
}
function closeoutMini(a) {
  const steps = [...CLOSEOUT_STEPS, ['first_trip_at', 'car', 'First Trip']];
  return `<div class="co-mini">${steps.map(([f, ic, label]) => `<span class="co-dot ${a[f] ? 'done' : ''}" title="${label}${a[f] ? ' — ' + fmtD(a[f]) : ''}">${ico(ic, 'ico-xs')}</span>`).join('')}</div>`;
}

// Logs immediately (a calling session shouldn't wait on a dialog), then offers
// an inline disposition box. Ignore it and it fades; type and it attaches the
// note to the touchpoint just written.
async function quickLog(accountId, type) {
  const t = TP_TYPES.find(x => x.key === type);
  const { data, error } = await sb.from('touchpoints').insert({ account_id: accountId, type }).select('id').single();
  if (error) return toast('Could not log — ' + error.message);
  await loadAll();
  if (currentDrawerId === accountId) openDrawer(accountId);
  dispositionPrompt(data.id, `${t.label} logged`);
}
function dispositionPrompt(touchpointId, label) {
  const t = $('toast');
  clearTimeout(t._h);
  t.classList.remove('hidden');
  t.innerHTML = `<div class="toast-disp">
      <span class="toast-msg">${esc(label)}</span>
      <input id="disp-input" class="toast-input" placeholder="What happened? (optional)" autocomplete="off">
      <button class="btn btn-ghost btn-icon" id="disp-close" title="Dismiss">${ico('x', 'ico-xs')}</button>
    </div>`;
  const input = $('disp-input');
  const close = () => { t.classList.add('hidden'); t.textContent = ''; };
  // Longer fuse than a normal toast so there's time to type; cancel it on focus.
  t._h = setTimeout(close, 9000);
  input.onfocus = () => clearTimeout(t._h);
  input.onblur = () => { if (!input.value.trim()) t._h = setTimeout(close, 3500); };
  $('disp-close').onclick = close;
  input.onkeydown = async e => {
    if (e.key === 'Escape') return close();
    if (e.key !== 'Enter') return;
    const note = input.value.trim();
    close();
    if (!note) return;
    await sb.from('touchpoints').update({ note }).eq('id', touchpointId);
    toast('Note saved');
    await loadAll();
    if (currentDrawerId) openDrawer(currentDrawerId);
  };
  input.focus();
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
    ...(tps.data || []).map(t => ({ at: t.occurred_at, c: 'var(--cyan)', txt: `${ico(TP_TYPES.find(x => x.key === t.type)?.icon || 'phone', 'ico-xs')} ${TP_TYPES.find(x => x.key === t.type)?.label}`, note: t.note })),
    ...(hist.data || []).map(h => ({ at: h.changed_at, c: stageInfo(h.to_stage).color, txt: `${ico(stageInfo(h.to_stage).icon, 'ico-xs')} Moved to ${esc(stageInfo(h.to_stage).label)}`, note: h.note })),
  ].sort((x, y) => new Date(y.at) - new Date(x.at)).slice(0, 40);

  $('drawer-content').innerHTML = `
    <h2>${sfPill(a)} </h2>
    <div class="card-sub">${a.dm_name ? esc(a.dm_name) : 'No DM identified yet'}${a.dm_email ? ' · ' + esc(a.dm_email) : ''}${a.city ? ' · ' + esc(a.city) : ''} · added ${daysAgo(a.created_at)}d ago</div>
    ${a.timezone && a.timezone !== MY_TZ ? `<div class="tz-banner">${ico('clock', 'ico-xs')} It's <b>${fmtTz(new Date(), a.timezone)} ${abbrOf(a.timezone)}</b> for them right now — ${fmtT(new Date())} ${abbrOf(MY_TZ)} for you</div>` : ''}

    <div class="drawer-section">
      <h4>Stage</h4>
      <div class="stage-pill-row">
        ${STAGES.map(s => `<button class="stage-pill ${a.stage === s.key ? 'current' : ''}" style="--sp-c:${s.color}" onclick="setStage('${id}','${s.key}')">${ico(s.icon, 'ico-xs')}${esc(s.label)}</button>`).join('')}
      </div>
    </div>

    ${contactBlockHTML(a)}
    ${summaryBlockHTML(a)}

    ${a.stage === 'closed_won' ? closeoutSectionHTML(a) : ''}

    <div class="drawer-section">
      <h4>Log a touchpoint — Σ ${st.total_touchpoints || 0} so far</h4>
      <div class="tp-log-row">
        ${TP_TYPES.map(t => `<button class="tp-log-btn" onclick="quickLog('${id}','${t.key}')">${ico(t.icon)}<span class="tp-log-label">${t.label}</span><span class="tp-log-n">${st[t.key + 's'] || 0}</span></button>`).join('')}
      </div>
      <div style="display:flex;gap:8px;margin-top:10px">
        <input id="tp-note-input" class="input" placeholder="Optional note with next touchpoint… (e.g. 'GK said call back Tues')">
      </div>
    </div>

    <div class="drawer-section">
      <h4>Notes on this stage — ${esc(stageInfo(a.stage).label)}</h4>
      <div style="display:flex;gap:8px;margin-bottom:10px">
        <input id="stage-note-input" class="input" placeholder="Add a note…">
        <button class="btn btn-primary" onclick="addStageNote('${id}','${a.stage}')">Add</button>
      </div>
      ${(notes.data || []).map(n => `<div class="row"><div class="row-main">${esc(n.body)}<div class="row-sub">${esc(stageInfo(n.stage).label)} · ${fmtDT(n.created_at)}</div></div></div>`).join('') || '<div class="empty">No notes yet.</div>'}
    </div>

    <div class="drawer-section">
      <h4>Quick actions</h4>
      <div style="display:flex;gap:8px;flex-wrap:wrap">
        <button class="btn btn-ghost" onclick="openReminderModal('${id}')">${ico('clock', 'ico-xs')} Remind me</button>
        <button class="btn btn-ghost" onclick="openApptModal('${id}')">${ico('calendar', 'ico-xs')} Book appointment</button>
        <button class="btn btn-ai" onclick="genForAccount('${id}')">${ico('sparkles', 'ico-xs')} Draft email</button>
        <button class="btn btn-ghost" onclick="openAccountModal('${id}')">${ico('pencil', 'ico-xs')} Edit</button>
        <button class="btn btn-danger" onclick="deleteAccount('${id}')">${ico('trash', 'ico-xs')} Delete</button>
      </div>
    </div>

    <div class="drawer-section">
      <h4>Timeline</h4>
      <div class="timeline">
        ${timeline.map(t => `<div class="tl-item" style="--tl-c:${t.c}"><div>${t.txt}</div>${t.note ? `<div class="tl-note">${esc(t.note)}</div>` : ''}<div class="tl-time">${fmtDT(t.at)}</div></div>`).join('') || '<div class="empty">No activity yet — make the first move.</div>'}
      </div>
    </div>`;

  // note-aware touchpoint logging: patch quickLog note pickup
  const noteInput = $('tp-note-input');
  document.querySelectorAll('.tp-log-btn').forEach((b, i) => {
    b.onclick = async () => {
      const note = noteInput.value.trim() || null;
      await sb.from('touchpoints').insert({ account_id: id, type: TP_TYPES[i].key, note });
      toast(`${TP_TYPES[i].label} logged`);
      await loadAll(); openDrawer(id);
    };
  });
}
function closeDrawer(e) { $('drawer-overlay').classList.add('hidden'); currentDrawerId = null; }

// Everything you'd reach for mid-call: numbers you can tap to dial, the site,
// and the DM's email — no scrolling, no opening the edit modal.
function contactBlockHTML(a) {
  const phones = Array.isArray(a.phones) ? a.phones : [];
  if (!phones.length && !a.website && !a.dm_email) return '';
  const tel = n => 'tel:' + n.replace(/[^\d+]/g, '');
  const site = a.website ? (/^https?:\/\//i.test(a.website) ? a.website : 'https://' + a.website) : null;
  return `<div class="drawer-section contact-block">
    <h4>Contact</h4>
    <div class="contact-grid">
      ${phones.map(p => `<a class="contact-chip" href="${esc(tel(p.number))}" title="Call ${esc(p.number)}">
          ${ico('phone', 'ico-xs')}<span class="cc-label">${esc(p.label)}</span><span class="cc-val">${esc(p.number)}</span>
        </a>`).join('')}
      ${a.dm_email ? `<a class="contact-chip" href="mailto:${esc(a.dm_email)}">${ico('mail', 'ico-xs')}<span class="cc-label">Email</span><span class="cc-val">${esc(a.dm_email)}</span></a>` : ''}
      ${site ? `<a class="contact-chip" href="${esc(site)}" target="_blank" rel="noopener">${ico('external', 'ico-xs')}<span class="cc-label">Website</span><span class="cc-val">${esc(a.website)}</span></a>` : ''}
    </div>
  </div>`;
}

function summaryBlockHTML(a) {
  const stale = a.summary_at && daysAgo(a.summary_at) >= 7;
  return `<div class="drawer-section summary-block">
    <h4>Account Summary
      <button class="btn btn-ai btn-sm" onclick="generateSummary('${a.id}')" id="sum-btn">
        ${ico('sparkles', 'ico-xs')} ${a.summary ? 'Refresh' : 'Build summary'}
      </button>
    </h4>
    ${a.summary
      ? `<div class="summary-body">${esc(a.summary).replace(/\n/g, '<br>')}</div>
         <div class="summary-meta ${stale ? 'stale' : ''}">Generated ${fmtDT(a.summary_at)}${stale ? ' · getting stale' : ''}</div>`
      : `<div class="empty">No summary yet. Build one to pull together their website, market data for ${esc(a.city || 'their area')}, and every call note into one story.</div>`}
  </div>`;
}

async function generateSummary(id) {
  const a = state.accounts.find(x => x.id === id);
  const btn = $('sum-btn');
  if (btn) { btn.disabled = true; btn.textContent = 'Reading…'; }
  try {
    // Notes are the spine of the story — pull them with their type and date.
    const [{ data: tps }, { data: hist }] = await Promise.all([
      sb.from('touchpoints').select('type,note,occurred_at').eq('account_id', id).order('occurred_at', { ascending: false }).limit(60),
      sb.from('stage_history').select('to_stage,note,changed_at').eq('account_id', id).order('changed_at', { ascending: false }).limit(20),
    ]);
    const st = state.stats[id] || {};
    const r = await fetch('/api/ai', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + state.session.access_token },
      body: JSON.stringify({
        mode: 'account_summary',
        account: {
          name: a.name, dm: a.dm_name, city: a.city, tier: a.tier, points: ptsOf(a),
          stage: stageInfo(a.stage).label, days_in_stage: daysInStage(a), days_quiet: daysQuiet(a),
          website: a.website, phones: a.phones,
          touchpoints: { total: st.total_touchpoints || 0, dials: st.dials || 0, emails: st.emails || 0, texts: st.texts || 0, voicemails: st.voicemails || 0 },
        },
        notes: (tps || []).filter(t => t.note).map(t => ({ type: t.type, when: fmtD(t.occurred_at), note: t.note })),
        stage_notes: (hist || []).filter(h => h.note).map(h => ({ stage: stageInfo(h.to_stage).label, when: fmtD(h.changed_at), note: h.note })),
        market: relevantMarket(a),
      }),
    });
    const out = await r.json();
    if (!r.ok || out.error) throw new Error(out.error || 'Failed');
    await sb.from('accounts').update({ summary: out.text, summary_at: new Date().toISOString() }).eq('id', id);
    toast('Summary ready');
    await loadAll(); openDrawer(id);
  } catch (e) {
    toast(e.message);
    if (btn) { btn.disabled = false; btn.textContent = 'Build summary'; }
  }
}

// Market sheets are big; send only what plausibly covers this account's area,
// and cap it so one huge upload can't blow the context budget.
function relevantMarket(a) {
  const city = (a.city || '').split(',')[0].trim().toLowerCase();
  const hit = state.market.filter(m =>
    city && ((m.market || '').toLowerCase().includes(city) || (m.content || '').toLowerCase().includes(city)));
  const use = (hit.length ? hit : state.market).slice(0, 3);
  return use.map(m => ({ name: m.name, market: m.market, content: (m.content || '').slice(0, 4000) }));
}

function milestoneStep(id, field, value, icon, label) {
  const done = !!value;
  return `<div class="ms-step ${done ? 'done' : ''}">
    <button class="ms-btn" onclick="stampMilestone('${id}','${field}',${done})" title="${done ? 'Click to clear' : 'Mark done now'}">${ico(done ? 'check' : icon, 'ico-xs')}</button>
    <div class="ms-label">${esc(label)}</div>
    <div class="ms-date">${done ? fmtD(value) : '—'}</div>
  </div>`;
}
function closeoutSectionHTML(a) {
  return `<div class="drawer-section closeout-section">
    <h4>Close-Out & Onboarding</h4>
    <div class="milestone-row">${CLOSEOUT_STEPS.map(([f, ic, label]) => milestoneStep(a.id, f, a[f], ic, label)).join('')}</div>
    <div class="field-row">
      <label>Onboarding specialist</label>
      <input id="cw-onboarding" class="input" value="${esc(a.onboarding_specialist || '')}" placeholder="Who's onboarding them?">
    </div>
    <div class="milestone-row">${milestoneStep(a.id, 'first_trip_at', a.first_trip_at, 'car', 'First Trip')}</div>
    <div class="field-row two-col">
      <div><label>Placement ad spend</label><input id="cw-adspend" type="number" min="0" max="500" step="1" class="input" value="${a.placement_ad_spend ?? 0}"></div>
      <div><label>Promo type</label><select id="cw-promo" class="input">${Object.entries(PROMO_LABEL).map(([v, l]) => `<option value="${v}" ${a.promo_type === v ? 'selected' : ''}>${l}</option>`).join('')}</select></div>
    </div>
    <div class="field-row"><label>Promo note</label><input id="cw-promonote" class="input" value="${esc(a.promo_note || '')}" placeholder="Optional — define the terms"></div>
    <button class="btn btn-primary" onclick="saveCloseout('${a.id}')">Save close-out info</button>
  </div>`;
}
async function stampMilestone(id, field, isDone) {
  if (isDone && !confirm('Clear this milestone?')) return;
  await sb.from('accounts').update({ [field]: isDone ? null : new Date().toISOString() }).eq('id', id);
  toast(isDone ? 'Cleared' : 'Marked done');
  await loadAll(); openDrawer(id);
}
async function saveCloseout(id) {
  const row = {
    onboarding_specialist: $('cw-onboarding').value.trim() || null,
    placement_ad_spend: Math.max(0, Math.min(500, +$('cw-adspend').value || 0)),
    promo_type: $('cw-promo').value,
    promo_note: $('cw-promonote').value.trim() || null,
  };
  await sb.from('accounts').update(row).eq('id', id);
  toast('Saved'); await loadAll(); openDrawer(id);
}

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
    <h3>${a ? 'Edit Account' : 'New Pursuit'}</h3>
    <div class="field"><label>Business name</label><input id="m-name" class="input" value="${esc(a?.name || '')}" placeholder="Tony's Pizza"></div>
    <div class="field"><label>Salesforce link (paste it — name becomes the clickable pill)</label><input id="m-sf" class="input" value="${esc(a?.sf_url || '')}" placeholder="https://uber.lightning.force.com/…"></div>
    <div class="field"><label>Decision maker</label><input id="m-dm" class="input" value="${esc(a?.dm_name || '')}" placeholder="Who signs?"></div>
    <div class="field"><label>Their email</label><input id="m-dmemail" class="input" type="email" value="${esc(a?.dm_email || '')}" placeholder="tony@tonyspizza.com"></div>
    <div class="field"><label>Website</label><input id="m-website" class="input" value="${esc(a?.website || '')}" placeholder="tonyspizza.com"></div>
    <div class="field">
      <label>Phone numbers <span class="tz-tag">label each so you know whose is whose</span></label>
      <div id="phone-rows"></div>
      <button type="button" class="btn btn-ghost btn-sm" onclick="addPhoneRow()">${ico('plus', 'ico-xs')} Add number</button>
      <datalist id="phone-labels">
        ${['Cell', 'Corporate', 'Location', 'Main', 'Kitchen', 'Manager', 'Owner', 'Other'].map(l => `<option value="${l}">`).join('')}
      </datalist>
    </div>
    <div class="field"><label>City</label><input id="m-city" class="input" value="${esc(a?.city || '')}" placeholder="Cincinnati, OH"></div>
    <div class="field"><label>Tier <span class="tz-tag">drives points</span></label><select id="m-tier" class="input">
      ${TIERS.map(t => `<option value="${t}" ${(a?.tier ?? 3) === t ? 'selected' : ''}>Tier ${t} — ${TIER_POINTS[t]} ${TIER_POINTS[t] === 1 ? 'point' : 'points'}</option>`).join('')}
    </select></div>
    <div class="field"><label>Their timezone</label><select id="m-tz" class="input">
      ${ZONES.map(z => `<option value="${z.tz}" ${(a?.timezone || 'America/New_York') === z.tz ? 'selected' : ''}>${z.label}</option>`).join('')}
    </select></div>
    <div class="modal-actions">
      <button class="btn btn-ghost" onclick="closeModal()">Cancel</button>
      <button class="btn btn-primary btn-glow" onclick="saveAccount('${id || ''}')">${a ? 'Save' : 'Start the pursuit'}</button>
    </div>`);
  const existing = Array.isArray(a?.phones) ? a.phones : [];
  (existing.length ? existing : [{ label: '', number: '' }]).forEach(p => addPhoneRow(p.label, p.number));
}
function addPhoneRow(label = '', number = '') {
  const wrap = $('phone-rows');
  if (!wrap) return;
  const row = document.createElement('div');
  row.className = 'phone-row';
  row.innerHTML = `
    <input class="input phone-label" list="phone-labels" placeholder="Label" value="${esc(label)}">
    <input class="input phone-number" placeholder="(513) 555-0123" value="${esc(number)}">
    <button type="button" class="btn btn-danger btn-icon" title="Remove">${ico('trash', 'ico-xs')}</button>`;
  row.querySelector('button').onclick = () => row.remove();
  wrap.appendChild(row);
}
function collectPhones() {
  return [...document.querySelectorAll('.phone-row')]
    .map(r => ({ label: r.querySelector('.phone-label').value.trim() || 'Main', number: r.querySelector('.phone-number').value.trim() }))
    .filter(p => p.number);
}
async function saveAccount(id) {
  const row = { name: $('m-name').value.trim(), sf_url: $('m-sf').value.trim() || null, dm_name: $('m-dm').value.trim() || null, dm_email: $('m-dmemail').value.trim() || null, city: $('m-city').value.trim() || null, timezone: $('m-tz').value, tier: +$('m-tier').value, website: $('m-website').value.trim() || null, phones: collectPhones() };
  if (!row.name) return toast('Name it first');
  if (id) await sb.from('accounts').update(row).eq('id', id);
  else await sb.from('accounts').insert(row);
  closeModal(); toast(id ? 'Saved' : 'New pursuit started'); await loadAll();
  if (id && currentDrawerId === id) openDrawer(id);
}

function openReminderModal(accountId) {
  const opts = state.accounts.filter(a => !['closed_won', 'moving_on'].includes(a.stage)).map(a => `<option value="${a.id}" ${a.id === accountId ? 'selected' : ''}>${esc(a.name)}</option>`).join('');
  const dt = new Date(Date.now() + 3600000); dt.setMinutes(0);
  showModal(`
    <h3>New Reminder</h3>
    <div class="field"><label>What</label><input id="m-rtitle" class="input" placeholder="Call Tony back about the demo"></div>
    <div class="field"><label>When <span class="tz-tag">your time (${abbrOf(MY_TZ)})</span></label><input id="m-rdue" class="input" type="datetime-local" value="${isoToWall(dt.toISOString(), MY_TZ)}"></div>
    <div class="field"><label>Account (optional)</label><select id="m-racct" class="input"><option value="">— none —</option>${opts}</select></div>
    <div class="modal-actions">
      <button class="btn btn-ghost" onclick="closeModal()">Cancel</button>
      <button class="btn btn-primary btn-glow" onclick="saveReminder()">Set it</button>
    </div>`);
}
async function saveReminder() {
  const title = $('m-rtitle').value.trim(); if (!title) return toast('Give it a title');
  await sb.from('reminders').insert({ title, due_at: wallToISO($('m-rdue').value, MY_TZ), account_id: $('m-racct').value || null });
  closeModal(); toast('Reminder set'); await loadAll();
}

function openApptModal(accountId, dateStr) {
  const opts = state.accounts.map(a => `<option value="${a.id}" ${a.id === accountId ? 'selected' : ''}>${esc(a.name)}</option>`).join('');
  const base = dateStr ? `${dateStr}T10:00` : isoToWall(new Date(Date.now() + 86400000).toISOString(), MY_TZ).slice(0, 11) + '10:00';
  showModal(`
    <h3>New Appointment</h3>
    <div class="field"><label>Title</label><input id="m-atitle" class="input" placeholder="Pitch meeting with Tony"></div>
    <div class="field"><label>Type</label><select id="m-akind" class="input">
      <option value="call">Call</option><option value="in_market">In-market meeting</option><option value="other">Other</option></select></div>
    <div class="field"><label>Account (optional)</label><select id="m-aacct" class="input"><option value="">— none —</option>${opts}</select></div>
    <div class="field"><label>Starts</label>
      <div class="tz-entry">
        <input id="m-astart" class="input" type="datetime-local" value="${base}">
        <select id="m-atz" class="input tz-select">${ZONES.map(z => `<option value="${z.tz}">${z.abbr}</option>`).join('')}</select>
      </div>
      <div id="tz-echo" class="tz-echo"></div>
    </div>
    <div class="field"><label>Location (optional)</label><input id="m-aloc" class="input" placeholder="Their restaurant / Zoom / phone"></div>
    <div class="modal-actions">
      <button class="btn btn-ghost" onclick="closeModal()">Cancel</button>
      <button class="btn btn-primary btn-glow" onclick="saveAppt()">Book it</button>
    </div>`);

  // Default the entry zone to the account's, since a meeting time is usually quoted in their clock.
  const syncZone = () => {
    const a = state.accounts.find(x => x.id === $('m-aacct').value);
    $('m-atz').value = a?.timezone || MY_TZ;
    echo();
  };
  const echo = () => {
    const iso = wallToISO($('m-astart').value, $('m-atz').value);
    if (!iso) return $('tz-echo').textContent = '';
    const a = state.accounts.find(x => x.id === $('m-aacct').value);
    const theirTz = a?.timezone;
    const mine = `${fmtT(iso)} ${abbrOf(MY_TZ)} for you`;
    $('tz-echo').innerHTML = (theirTz && theirTz !== MY_TZ)
      ? `${ico('clock', 'ico-xs')} ${mine} · ${fmtTz(iso, theirTz)} ${abbrOf(theirTz)} for them`
      : `${ico('clock', 'ico-xs')} ${mine}`;
  };
  $('m-aacct').onchange = syncZone;
  $('m-astart').oninput = echo;
  $('m-atz').onchange = echo;
  syncZone();
}
async function saveAppt() {
  const title = $('m-atitle').value.trim(); if (!title) return toast('Give it a title');
  await sb.from('appointments').insert({
    title, kind: $('m-akind').value,
    starts_at: wallToISO($('m-astart').value, $('m-atz').value),
    location: $('m-aloc').value.trim() || null, account_id: $('m-aacct').value || null,
  });
  closeModal(); toast('Booked'); await loadAll();
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
    const appts = state.appointments.filter(a => ymdTz(a.starts_at, MY_TZ) === iso);
    const rems = state.reminders.filter(r => !r.done && ymdTz(r.due_at, MY_TZ) === iso);
    cells.push(`<div class="cal-cell ${d.getMonth() !== m ? 'other-month' : ''} ${ds === todayStr ? 'today' : ''}" onclick="dayClick('${iso}')">
      <div class="d">${d.getDate()}</div>
      ${appts.slice(0, 3).map(a => `<div class="cal-evt ${a.kind}" title="${esc(a.title)} — ${esc(dualT(a.starts_at, acctTz(a.account_id)))}"><b>${fmtT(a.starts_at)}</b> ${esc(a.title)}</div>`).join('')}
      ${rems.slice(0, 2).map(r => `<div class="cal-evt rem" title="${esc(r.title)}">${esc(r.title)}</div>`).join('')}
      ${appts.length + rems.length > 5 ? `<div class="cal-evt other">+${appts.length + rems.length - 5} more</div>` : ''}
    </div>`);
  }
  $('calendar').innerHTML = dows + cells.join('');
}
function dayClick(iso) {
  const d = new Date(iso + 'T00:00');
  const appts = state.appointments.filter(a => ymdTz(a.starts_at, MY_TZ) === iso);
  const rems = state.reminders.filter(r => !r.done && ymdTz(r.due_at, MY_TZ) === iso);
  const el = $('cal-day-detail');
  el.classList.remove('hidden');
  el.innerHTML = `<h3>${d.toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric' })}</h3>
    ${appts.map(a => `<div class="row"><span class="row-ico">${ico(a.kind === 'in_market' ? 'car' : 'phone')}</span><div class="row-main">${esc(a.title)}${a.location ? `<div class="row-sub">${esc(a.location)}</div>` : ''}${a.account_id ? `<div class="row-sub">${esc(accName(a.account_id))}</div>` : ''}<div class="row-sub">${dualT(a.starts_at, acctTz(a.account_id))}</div></div><button class="btn btn-danger" style="padding:4px 10px" onclick="delAppt('${a.id}','${iso}')">${ico('x', 'ico-xs')}</button></div>`).join('')}
    ${rems.map(r => `<div class="row"><span class="row-ico">${ico('clock')}</span><div class="row-main">${esc(r.title)}</div><span class="row-time">${fmtT(r.due_at)}</span></div>`).join('')}
    ${!appts.length && !rems.length ? '<div class="empty">Nothing this day.</div>' : ''}
    <button class="btn btn-primary btn-glow" style="margin-top:10px" onclick="openApptModal(null,'${iso}')">${ico('plus', 'ico-xs')} Add appointment</button>`;
}
async function delAppt(id, iso) {
  await sb.from('appointments').delete().eq('id', id);
  toast('Appointment removed'); await loadAll(); dayClick(iso);
}

// ===== MARKET DATA =====
function renderMarket() {
  $('market-list').innerHTML = state.market.length ? state.market.map(m => `
    <div class="panel glow-hover market-card">
      <h3>${ico('file')} ${esc(m.name)}</h3>
      <div class="market-meta">${m.market ? esc(m.market) + ' · ' : ''}${fmtDT(m.uploaded_at)} · ${(m.content.length / 1024).toFixed(1)}kb</div>
      <pre>${esc(m.content.slice(0, 400))}</pre>
      <button class="btn btn-danger" style="margin-top:10px" onclick="delMarket('${m.id}')">${ico('trash', 'ico-xs')} Remove</button>
    </div>`).join('') : '<div class="empty">No market data yet. Add the spreadsheets Uber sends you and Claude will weaponize them in your emails.</div>';
}
function openMarketModal() {
  showModal(`
    <h3>Add Market Data</h3>
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
  closeModal(); toast('Market data added'); await loadAll();
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
      <button class="btn btn-danger" style="padding:4px 10px" onclick="delVoice('${v.id}')">${ico('x', 'ico-xs')}</button>
    </div>`).join('') : '<div class="empty">No samples yet — paste a few real emails you’ve sent.</div>';
  $('voice-status').textContent = state.profile?.style_notes ? 'Voice trained ' + fmtDT(state.profile.updated_at) : '';

  const activeAccs = state.accounts.filter(a => !['closed_won', 'moving_on'].includes(a.stage));
  $('gen-account').innerHTML = '<option value="">Pick an account…</option>' + activeAccs.map(a => `<option value="${a.id}">${esc(a.name)}</option>`).join('');
  $('gen-market').innerHTML = '<option value="">No market data</option>' + state.market.map(m => `<option value="${m.id}">${esc(m.name)}</option>`).join('');
}
function openVoiceModal() {
  showModal(`
    <h3>Add Email Sample</h3>
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
  closeModal(); toast('Sample added'); await loadAll();
}
async function delVoice(id) { await sb.from('voice_samples').delete().eq('id', id); await loadAll(); }

$('train-btn').onclick = async () => {
  if (!state.voice.length) return toast('Add at least one email sample first');
  const btn = $('train-btn'); btn.disabled = true; btn.textContent = 'Learning your voice…';
  try {
    const notes = await callAI('distill_voice', { samples: state.voice.map(v => v.body) });
    await sb.from('voice_profile').upsert({ id: 1, style_notes: notes, updated_at: new Date().toISOString() });
    toast('Voice trained'); await loadAll();
  } catch (e) { toast(e.message); }
  btn.disabled = false; btn.innerHTML = ico('cpu') + ' Train my voice';
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
  const btn = $('gen-btn'); btn.disabled = true; btn.textContent = 'Writing…';
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
  } catch (e) { toast(e.message); }
  btn.disabled = false; btn.innerHTML = ico('sparkles') + ' Generate Email';
};
// Claude puts "Subject: ..." on line 1; split it off so the mail client gets a real subject.
function splitDraft(raw) {
  const m = raw.match(/^\s*subject:\s*(.+?)\r?\n([\s\S]*)$/i);
  return m ? { subject: m[1].trim(), body: m[2].replace(/^\s+/, '') } : { subject: '', body: raw };
}

$('open-mail-btn').onclick = async () => {
  const accId = $('gen-account').value;
  const a = state.accounts.find(x => x.id === accId);
  const { subject, body } = splitDraft($('gen-output').value);
  const to = a?.dm_email || '';
  if (!to) toast('No email saved for this account — add one and it’ll prefill');

  const href = `mailto:${encodeURIComponent(to)}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
  // Some mail clients silently truncate very long mailto URLs — copy as a safety net.
  if (href.length > 1800) {
    await navigator.clipboard.writeText($('gen-output').value);
    toast('Draft copied too — it’s long, paste if the body looks cut off');
  }
  window.location.href = href;

  if (accId) {
    await sb.from('touchpoints').insert({ account_id: accId, type: 'email', note: subject || 'AI-drafted email' });
    await loadAll();
  }
};

$('copy-email-btn').onclick = () => { navigator.clipboard.writeText($('gen-output').value); toast('Copied'); };
$('log-email-btn').onclick = async () => {
  navigator.clipboard.writeText($('gen-output').value);
  const accId = $('gen-account').value;
  if (accId) { await sb.from('touchpoints').insert({ account_id: accId, type: 'email', note: 'AI-drafted email' }); toast('Copied + logged'); await loadAll(); }
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
  const todayIso = ymdTz(now, MY_TZ);
  return {
    today: now.toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric', timeZone: MY_TZ }),
    now_local: `${fmtT(now)} ${abbrOf(MY_TZ)}`,
    reminders: state.reminders.filter(r => !r.done).map(r => ({ title: r.title, due: `${fmtDT(r.due_at)} ${abbrOf(MY_TZ)}`, account: accName(r.account_id), overdue: new Date(r.due_at) < now })),
    appointments: state.appointments
      .filter(a => ymdTz(a.starts_at, MY_TZ) >= todayIso && new Date(a.starts_at) < new Date(Date.now() + 3 * 86400000))
      .map(a => ({ title: a.title, at: dualT(a.starts_at, acctTz(a.account_id)), kind: a.kind, account: accName(a.account_id) })),
    accounts: active.map(a => {
      const st = state.stats[a.id] || {};
      return {
        name: a.name, stage: a.stage, dm: a.dm_name, city: a.city,
        their_timezone: abbrOf(a.timezone), local_time_there_now: fmtTz(now, a.timezone || MY_TZ),
        touchpoints: st.total_touchpoints || 0, days_quiet: daysAgo(st.last_touch_at || a.created_at), ice_until: a.ice_until,
      };
    }),
  };
}

init();
