# 🧙 Pursuit Wizard

Personal pipeline tool for pursuing Midwest restaurants as an Uber Eats AE.
Companion to Salesforce + Dialpad — it does not replace them. It tracks
**touchpoints**, stage, notes, reminders, appointments, and generates emails
in your own voice via Claude.

## Stack
- Static frontend (`index.html` / `styles.css` / `app.js`) — no build step
- Supabase (Postgres + auth) — project `oenapblefpxhjrqqcbme`
- Vercel serverless (`api/ai.js`) — Claude wire-in
- Claude Sonnet 5 for briefings, voice training, email generation

## Pipeline stages
`Looking for DM → Found DM → Talked to DM → Appointment Set → Pitched →
Negotiating → Closed Won`, plus `On Ice` and `Moving On` as parking states.

## Touchpoints
Every dial, email, text, and voicemail is logged per account and rolled up in
the `account_touchpoint_stats` view — total and per-type, plus days since last
touch. That's the number that was invisible before.

## Local dev
```bash
python -m http.server 4173
```
The `/api/ai` route only runs on Vercel — AI features need a deployed
(or `vercel dev`) environment.

## Env vars (Vercel)
`SUPABASE_URL`, `SUPABASE_ANON_KEY`, `ANTHROPIC_API_KEY`

## Schema
`schema.sql` is the source of truth. Applied via the Supabase Management API.
