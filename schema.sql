-- Pursuit Wizard schema
create type pipeline_stage as enum (
  'looking_for_dm', 'found_dm', 'talked_to_dm', 'appointment_set',
  'pitched', 'negotiating', 'closed_won', 'on_ice', 'moving_on'
);

create type touchpoint_type as enum ('dial', 'email', 'text', 'voicemail');

create table accounts (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  sf_url text,
  stage pipeline_stage not null default 'looking_for_dm',
  prev_stage pipeline_stage, -- stage before going on_ice/moving_on
  stage_changed_at timestamptz not null default now(),
  dm_name text,
  dm_email text,
  city text,
  -- Mark works Central; most of his book (Cincinnati / N. Kentucky) is Eastern.
  timezone text not null default 'America/New_York',
  notes text,
  ice_until date,
  created_at timestamptz not null default now(),
  closed_at timestamptz
);

create table touchpoints (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references accounts(id) on delete cascade,
  type touchpoint_type not null,
  note text,
  occurred_at timestamptz not null default now()
);

create table stage_history (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references accounts(id) on delete cascade,
  from_stage pipeline_stage,
  to_stage pipeline_stage not null,
  note text,
  changed_at timestamptz not null default now()
);

create table stage_notes (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references accounts(id) on delete cascade,
  stage pipeline_stage not null,
  body text not null,
  created_at timestamptz not null default now()
);

create table reminders (
  id uuid primary key default gen_random_uuid(),
  account_id uuid references accounts(id) on delete cascade,
  title text not null,
  due_at timestamptz not null,
  done boolean not null default false,
  created_at timestamptz not null default now()
);

create table appointments (
  id uuid primary key default gen_random_uuid(),
  account_id uuid references accounts(id) on delete set null,
  title text not null,
  kind text not null default 'call' check (kind in ('call', 'in_market', 'other')),
  starts_at timestamptz not null,
  ends_at timestamptz,
  location text,
  notes text,
  created_at timestamptz not null default now()
);

create table market_data (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  market text,
  content text not null, -- extracted text/CSV content Claude reads
  uploaded_at timestamptz not null default now()
);

create table voice_samples (
  id uuid primary key default gen_random_uuid(),
  label text,
  body text not null, -- a real email the user sent
  created_at timestamptz not null default now()
);

create table voice_profile (
  id int primary key default 1 check (id = 1),
  style_notes text, -- distilled tone/style guide
  updated_at timestamptz not null default now()
);

-- RLS: everything locked to authenticated users only (single-user app)
alter table accounts enable row level security;
alter table touchpoints enable row level security;
alter table stage_history enable row level security;
alter table stage_notes enable row level security;
alter table reminders enable row level security;
alter table appointments enable row level security;
alter table market_data enable row level security;
alter table voice_samples enable row level security;
alter table voice_profile enable row level security;

create policy auth_all on accounts for all to authenticated using (true) with check (true);
create policy auth_all on touchpoints for all to authenticated using (true) with check (true);
create policy auth_all on stage_history for all to authenticated using (true) with check (true);
create policy auth_all on stage_notes for all to authenticated using (true) with check (true);
create policy auth_all on reminders for all to authenticated using (true) with check (true);
create policy auth_all on appointments for all to authenticated using (true) with check (true);
create policy auth_all on market_data for all to authenticated using (true) with check (true);
create policy auth_all on voice_samples for all to authenticated using (true) with check (true);
create policy auth_all on voice_profile for all to authenticated using (true) with check (true);

-- auto stage history on stage change
create or replace function log_stage_change() returns trigger
language plpgsql security definer as $$
begin
  if TG_OP = 'UPDATE' and NEW.stage is distinct from OLD.stage then
    insert into stage_history (account_id, from_stage, to_stage)
    values (NEW.id, OLD.stage, NEW.stage);
    NEW.stage_changed_at := now();
    if NEW.stage in ('on_ice', 'moving_on') and OLD.stage not in ('on_ice', 'moving_on') then
      NEW.prev_stage := OLD.stage;
    end if;
    if NEW.stage = 'closed_won' then
      NEW.closed_at := now();
    end if;
  elsif TG_OP = 'INSERT' then
    insert into stage_history (account_id, from_stage, to_stage)
    values (NEW.id, null, NEW.stage);
  end if;
  return coalesce(NEW, OLD);
end;
$$;

create trigger trg_stage_history_ins after insert on accounts
  for each row execute function log_stage_change();
create trigger trg_stage_history_upd before update on accounts
  for each row execute function log_stage_change();

-- touchpoint rollup view
create view account_touchpoint_stats as
select
  a.id as account_id,
  count(t.id) as total_touchpoints,
  count(t.id) filter (where t.type = 'dial') as dials,
  count(t.id) filter (where t.type = 'email') as emails,
  count(t.id) filter (where t.type = 'text') as texts,
  count(t.id) filter (where t.type = 'voicemail') as voicemails,
  max(t.occurred_at) as last_touch_at
from accounts a
left join touchpoints t on t.account_id = a.id
group by a.id;
