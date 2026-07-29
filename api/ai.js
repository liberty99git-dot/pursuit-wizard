const SUPABASE_URL = process.env.SUPABASE_URL;
const ANON_KEY = process.env.SUPABASE_ANON_KEY;

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  const jwt = (req.headers.authorization || '').replace('Bearer ', '');
  if (!jwt) return res.status(401).json({ error: 'Not logged in' });
  const authCheck = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
    headers: { apikey: ANON_KEY, Authorization: `Bearer ${jwt}` },
  });
  if (!authCheck.ok) return res.status(401).json({ error: 'Invalid session' });

  const { mode } = req.body || {};
  let system, user, maxTokens = 1200;

  if (mode === 'distill_voice') {
    system = 'You analyze sales emails and produce a tight style guide capturing the writer\'s voice: tone, sentence length, greeting/sign-off habits, formality, humor, structure, CTA style. Output only the style guide, under 300 words.';
    user = 'Here are real emails I sent to restaurant owners as an Uber Eats sales rep. Distill my voice:\n\n' +
      (req.body.samples || []).map((s, i) => `--- EMAIL ${i + 1} ---\n${s}`).join('\n\n');
  } else if (mode === 'generate_email') {
    const { account, goal, custom, market_data, style_notes, samples } = req.body;
    const goals = {
      intro: 'a cold intro email — first ever touch, get their attention fast',
      followup: 'a follow-up email keeping the conversation warm',
      post_voicemail: 'a short email right after leaving them a voicemail',
      appt_confirm: 'a brief email confirming our upcoming appointment',
      reengage: 'a re-engagement email to thaw a prospect who went quiet',
      data_pitch: 'a data-driven pitch email built around the market numbers provided',
      custom: custom || 'a sales email',
    };
    system = `You write sales emails for Mark, an Uber Eats Account Executive pursuing Midwest restaurants. Write EXACTLY in his voice. Rules: subject line first ("Subject: ..."), then the email body. Keep it tight — restaurant owners are busy. Never sound like AI. No placeholder brackets unless truly unknown. Output only the email.`;
    user = `Write ${goals[goal] || goals.custom} to this restaurant:\n` +
      `Business: ${account?.name}\nDecision maker: ${account?.dm_name || 'unknown'}\nCity: ${account?.city || 'unknown'}\nPipeline stage: ${account?.stage}\nTouchpoints so far: ${JSON.stringify(account?.touchpoints || {})}\n` +
      (custom && goal === 'custom' ? `\nMy direction: ${custom}\n` : '') +
      (style_notes ? `\nMY VOICE (follow this exactly):\n${style_notes}\n` : '') +
      ((samples || []).length ? `\nEXAMPLES OF MY REAL EMAILS:\n${samples.map((s, i) => `--- ${i + 1} ---\n${s}`).join('\n')}\n` : '') +
      (market_data ? `\nMARKET DATA ("${market_data.name}") — pull specific relevant numbers, keep them accurate:\n${market_data.content}\n` : '');
  } else if (mode === 'briefing') {
    const ctx = req.body._context || {};
    system = `You are Mark's pipeline wingman. He's an Uber Eats AE pursuing Midwest restaurants. Give him a punchy morning briefing: 1) anything overdue or due today, 2) today's appointments, 3) the 3-5 accounts that most need a touchpoint and what kind (dial/email/text/voicemail) and why, 4) one motivating closer line. Be specific, use account names, keep it under 250 words. Plain text with emoji section markers, no markdown headers.`;
    user = `Today: ${ctx.today}\n\nReminders: ${JSON.stringify(ctx.reminders)}\n\nAppointments next 3 days: ${JSON.stringify(ctx.appointments)}\n\nPipeline: ${JSON.stringify(ctx.accounts)}`;
    maxTokens = 800;
  } else {
    return res.status(400).json({ error: 'Unknown mode' });
  }

  const r = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': process.env.ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model: 'claude-sonnet-5',
      max_tokens: maxTokens,
      system,
      messages: [{ role: 'user', content: user }],
    }),
  });
  if (!r.ok) {
    const err = await r.text();
    return res.status(502).json({ error: 'Claude error: ' + err.slice(0, 200) });
  }
  const data = await r.json();
  return res.status(200).json({ text: data.content.map(c => c.text || '').join('') });
}
