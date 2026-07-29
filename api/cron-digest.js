// Weekday morning digest — emailed to Mark before he starts dialing.
const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;
const RESEND_KEY = process.env.RESEND_API_KEY;
const TO = process.env.DIGEST_TO || 'mark@cmnty.co';
const FROM = process.env.DIGEST_FROM || 'Pursuit Wizard <onboarding@resend.dev>';
const APP_URL = 'https://pursuit-wizard.vercel.app';

const STAGE_LABEL = {
  looking_for_dm: '🔎 Looking for DM', found_dm: '🎯 Found DM', talked_to_dm: '🗣️ Talked to DM',
  appointment_set: '📅 Appointment Set', pitched: '🎤 Pitched', negotiating: '🤝 Negotiating',
  closed_won: '🏆 Closed Won', on_ice: '❄️ On Ice', moving_on: '🚫 Moving On',
};

const sbGet = async (path) => {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` },
  });
  if (!r.ok) throw new Error(`Supabase ${path}: ${r.status}`);
  return r.json();
};

const esc = s => (s ?? '').toString().replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const days = d => Math.max(0, Math.floor((Date.now() - new Date(d)) / 86400000));

// Mark's local timezone — all "today" logic and every time shown (to him AND to Claude)
// resolves here, so the email and the coaching never disagree about what time it is.
const TZ = process.env.DIGEST_TZ || 'America/New_York';
const ymd = d => new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(d));
const localTime = d => new Date(d).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: TZ });
const localDateTime = d => new Date(d).toLocaleString('en-US', { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZone: TZ });
const localDay = d => new Date(d).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', timeZone: TZ });

export default async function handler(req, res) {
  // Three ways in: Vercel cron's bearer header, a ?key= for manual testing, or a
  // logged-in session (powers the "email me this now" button in the app).
  const secret = process.env.CRON_SECRET;
  if (secret) {
    const auth = req.headers.authorization || '';
    let authed = auth === `Bearer ${secret}` || req.query.key === secret;
    if (!authed && auth.startsWith('Bearer ')) {
      const u = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
        headers: { apikey: process.env.SUPABASE_ANON_KEY, Authorization: auth },
      });
      authed = u.ok;
    }
    if (!authed) return res.status(401).json({ error: 'Unauthorized' });
  }

  const dry = req.query.dry === '1';
  const now = new Date();
  const today = ymd(now);
  // Skip weekends — judged in Mark's timezone, not UTC
  const dow = new Date(now.toLocaleString('en-US', { timeZone: TZ })).getDay();
  if (!req.query.force && (dow === 0 || dow === 6)) {
    return res.status(200).json({ skipped: 'weekend' });
  }

  try {
    const [accounts, stats, reminders, appts] = await Promise.all([
      sbGet('accounts?select=*'),
      sbGet('account_touchpoint_stats?select=*'),
      sbGet('reminders?select=*&done=eq.false&order=due_at'),
      sbGet('appointments?select=*&order=starts_at'),
    ]);
    const statMap = Object.fromEntries(stats.map(s => [s.account_id, s]));
    const nameOf = id => accounts.find(a => a.id === id)?.name || '';

    const dueReminders = reminders.filter(r => ymd(r.due_at) <= today);
    const todayAppts = appts.filter(a => ymd(a.starts_at) === today);
    const upcomingAppts = appts.filter(a => {
      const d = new Date(a.starts_at);
      return d > now && d < new Date(Date.now() + 3 * 86400000) && ymd(a.starts_at) !== today;
    });

    const active = accounts.filter(a => !['closed_won', 'moving_on', 'on_ice'].includes(a.stage));
    const stale = active
      .map(a => ({ a, st: statMap[a.id] || {}, quiet: days((statMap[a.id] || {}).last_touch_at || a.created_at) }))
      .filter(x => x.quiet >= 4)
      .sort((x, y) => y.quiet - x.quiet)
      .slice(0, 6);

    const thaw = accounts.filter(a => a.stage === 'on_ice' && a.ice_until && a.ice_until <= today);

    if (!dueReminders.length && !todayAppts.length && !stale.length && !thaw.length) {
      return res.status(200).json({ sent: false, reason: 'nothing to report' });
    }

    // Claude writes the actual coaching section
    let coaching = '';
    try {
      const r = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: { 'x-api-key': process.env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
        body: JSON.stringify({
          model: 'claude-sonnet-5',
          max_tokens: 600,
          system: `You are Mark's pipeline wingman. He's an Uber Eats AE pursuing Midwest restaurants via Salesforce + Dialpad. Write the coaching section of his morning email. Be specific and name accounts. For each account that needs attention, say which touchpoint type to use (dial / email / text / voicemail) and why. Close with one short motivating line. Under 200 words. Plain prose, short paragraphs, no markdown, no headers, no bullet characters. All times given to you are already in Mark's local timezone — quote them exactly as written and never convert them.`,
          messages: [{
            role: 'user', content:
              `Today is ${localDay(now)}. Current local time: ${localTime(now)}.\n` +
              `Due/overdue reminders: ${JSON.stringify(dueReminders.map(r => ({ title: r.title, account: nameOf(r.account_id), due: localDateTime(r.due_at), overdue: new Date(r.due_at) < now })))}\n` +
              `Today's appointments: ${JSON.stringify(todayAppts.map(a => ({ title: a.title, kind: a.kind, at: localTime(a.starts_at), location: a.location, account: nameOf(a.account_id) })))}\n` +
              `Gone quiet: ${JSON.stringify(stale.map(x => ({ name: x.a.name, stage: STAGE_LABEL[x.a.stage] || x.a.stage, dm: x.a.dm_name, touchpoints: x.st.total_touchpoints || 0, days_quiet: x.quiet })))}\n` +
              `Ice expiring today: ${JSON.stringify(thaw.map(a => a.name))}`,
          }],
        }),
      });
      if (r.ok) coaching = (await r.json()).content.map(c => c.text || '').join('');
    } catch { /* email still goes out without coaching */ }

    const fmtT = localTime;
    const section = (title, rows) => rows.length ? `
      <tr><td style="padding:20px 26px 6px;font:700 12px/1 Inter,Arial,sans-serif;letter-spacing:1px;text-transform:uppercase;color:#80848e">${title}</td></tr>
      ${rows.map(html => `<tr><td style="padding:5px 26px">${html}</td></tr>`).join('')}` : '';

    const pill = (txt, color) => `<span style="display:inline-block;background:${color}22;border:1px solid ${color}66;color:${color};border-radius:99px;padding:2px 9px;font:600 11px Inter,Arial,sans-serif">${esc(txt)}</span>`;
    const card = (inner, accent) => `<div style="background:#2b2d31;border:1px solid #3f4147;border-left:3px solid ${accent};border-radius:10px;padding:11px 14px;font:400 14px/1.5 Inter,Arial,sans-serif;color:#f2f3f5">${inner}</div>`;

    const remRows = dueReminders.map(r => {
      const od = new Date(r.due_at) < now;
      return card(`<b>${esc(r.title)}</b>${r.account_id ? ` <span style="color:#b5bac1">· ${esc(nameOf(r.account_id))}</span>` : ''}<br>
        <span style="color:${od ? '#f23f43' : '#80848e'};font-size:12px">${od ? '⚠️ OVERDUE — ' : ''}due ${fmtT(r.due_at)}</span>`, od ? '#f23f43' : '#00e5ff');
    });
    const apptRows = [...todayAppts, ...upcomingAppts].map(a => {
      const isToday = ymd(a.starts_at) === today;
      return card(`<b>${a.kind === 'in_market' ? '🚗' : a.kind === 'call' ? '📞' : '📌'} ${esc(a.title)}</b>${a.account_id ? ` <span style="color:#b5bac1">· ${esc(nameOf(a.account_id))}</span>` : ''}<br>
        <span style="color:#80848e;font-size:12px">${isToday ? 'TODAY' : new Date(a.starts_at).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: TZ })} at ${fmtT(a.starts_at)}${a.location ? ' · 📍 ' + esc(a.location) : ''}</span>`,
        a.kind === 'in_market' ? '#ff4dd8' : '#5865f2');
    });
    const staleRows = stale.map(({ a, st, quiet }) => card(
      `<b>${esc(a.name)}</b>${a.dm_name ? ` <span style="color:#b5bac1">· 👤 ${esc(a.dm_name)}</span>` : ''}<br>
       <span style="font-size:12px;color:#80848e">${pill(STAGE_LABEL[a.stage] || a.stage, '#5865f2')}
       &nbsp;Σ ${st.total_touchpoints || 0} touchpoints &nbsp;·&nbsp; <span style="color:#ffb84d">${quiet} days quiet</span></span>`, '#ffb84d'));
    const thawRows = thaw.map(a => card(`<b>${esc(a.name)}</b> — ice expires today, time to re-engage.`, '#9bb0c9'));

    const html = `<!doctype html><html><body style="margin:0;background:#111214;padding:22px 0">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center">
<table role="presentation" width="620" cellpadding="0" cellspacing="0" style="max-width:620px;width:100%;background:#1e1f22;border:1px solid #3f4147;border-radius:18px;overflow:hidden">
  <tr><td style="padding:26px 26px 4px;font:800 22px Inter,Arial,sans-serif;color:#f2f3f5">🧙 Pursuit Wizard</td></tr>
  <tr><td style="padding:0 26px 4px;font:600 14px Inter,Arial,sans-serif;color:#00e5ff">${localDay(now)}</td></tr>
  <tr><td style="padding:2px 26px 0;font:400 13px Inter,Arial,sans-serif;color:#80848e">${dueReminders.length} due · ${todayAppts.length} appointment${todayAppts.length === 1 ? '' : 's'} today · ${stale.length} gone quiet</td></tr>
  ${section('⏰ Due today', remRows)}
  ${section('📅 On the calendar', apptRows)}
  ${section('🚨 Gone quiet', staleRows)}
  ${section('❄️ Off ice today', thawRows)}
  ${coaching ? `<tr><td style="padding:22px 26px 6px;font:700 12px/1 Inter,Arial,sans-serif;letter-spacing:1px;text-transform:uppercase;color:#80848e">✨ Your wingman says</td></tr>
  <tr><td style="padding:0 26px"><div style="background:linear-gradient(135deg,#7b2ff722,#00c8ff18);border:1px solid #7b2ff755;border-radius:12px;padding:16px 18px;font:400 14px/1.65 Inter,Arial,sans-serif;color:#f2f3f5;white-space:pre-wrap">${esc(coaching)}</div></td></tr>` : ''}
  <tr><td align="center" style="padding:26px">
    <a href="${APP_URL}" style="display:inline-block;background:#5865f2;color:#fff;text-decoration:none;border-radius:10px;padding:13px 30px;font:700 15px Inter,Arial,sans-serif">Open Pursuit Wizard →</a></td></tr>
  <tr><td align="center" style="padding:0 26px 24px;font:400 11px Inter,Arial,sans-serif;color:#4e5058">Go get 'em. 🔥</td></tr>
</table></td></tr></table></body></html>`;

    const subject = dueReminders.some(r => new Date(r.due_at) < now)
      ? `⚠️ ${dueReminders.length} overdue · ${todayAppts.length} appt${todayAppts.length === 1 ? '' : 's'} today`
      : `🧙 ${now.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })} — ${dueReminders.length} due, ${stale.length} gone quiet`;

    if (dry) {
      if (req.query.html === '1') { res.setHeader('Content-Type', 'text/html'); return res.status(200).send(html); }
      return res.status(200).json({ dry: true, subject, coaching, counts: { dueReminders: dueReminders.length, todayAppts: todayAppts.length, stale: stale.length, thaw: thaw.length } });
    }
    if (!RESEND_KEY) return res.status(200).json({ sent: false, reason: 'RESEND_API_KEY not set', subject, preview: coaching });

    const send = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${RESEND_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: FROM, to: [TO], subject, html }),
    });
    const out = await send.json();
    if (!send.ok) return res.status(502).json({ sent: false, error: out });
    return res.status(200).json({ sent: true, id: out.id, subject });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}
