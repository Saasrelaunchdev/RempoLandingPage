-- =====================================================================================================================
-- The Review Race: where races, follow-up emails and opt-outs are kept (review-race v1).
-- =====================================================================================================================
--
-- Run it once: Supabase > SQL Editor > New query > paste this whole file > Run. Safe to run again: it creates only
-- what is missing and never deletes a row.
--
-- Use the same Supabase project as the landing page if you can: the race then also stores each lead in the landing
-- page's own table (public.leads, through public.submit_lead() from lead-capture/leads.sql), so every lead is in one
-- place. In a project without that table the race still works; its leads are in public.race_runs only.
--
-- Access: row level security on, no policies, no grants to the public roles. Only the server reads and writes,
-- with the project's secret key (SUPABASE_SECRET_KEY in Vercel), which never reaches the page.
-- =====================================================================================================================

create table if not exists public.race_runs (
  id                   uuid primary key default gen_random_uuid(),
  token                text not null unique,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  status               text not null default 'preview',
  place_id             text,
  data_id              text,
  business             jsonb not null default '{}'::jsonb,
  search               jsonb not null default '{}'::jsonb,
  rivals               jsonb not null default '[]'::jsonb,
  preview              jsonb not null default '{}'::jsonb,
  race                 jsonb,
  picks                jsonb,
  recent               jsonb,
  analysis             jsonb,
  reviews_started_at   timestamptz,
  analysis_started_at  timestamptz,
  email                text,
  first_name           text,
  phone                text,
  consent              jsonb not null default '{}'::jsonb,
  unlocked_at          timestamptz,
  lead_id              uuid,
  ghl_contact_id       text,
  booked_at            timestamptz,
  booking              jsonb,
  ip_hash              text,
  visit                text,
  meta                 jsonb not null default '{}'::jsonb,
  cost                 jsonb not null default '{}'::jsonb,
  error                text,
  source_run           uuid
);
comment on table public.race_runs is 'review-race v1: one row per race. picks (3 reviews) are cleared after 30 days, recent (read for Claude) after a day.';
comment on column public.race_runs.recent is 'The owner''s last 30 reviews as Claude read them; cleared once the analysis is saved, and by the daily job after a day.';

create index if not exists race_runs_place_idx on public.race_runs (place_id, created_at desc);
create index if not exists race_runs_ip_idx on public.race_runs (ip_hash, created_at desc) where ip_hash is not null;
create index if not exists race_runs_created_idx on public.race_runs (created_at desc);
create index if not exists race_runs_email_idx on public.race_runs (lower(email)) where email is not null;

create table if not exists public.race_emails (
  id          uuid primary key default gen_random_uuid(),
  created_at  timestamptz not null default now(),
  race_id     uuid references public.race_runs (id) on delete cascade,
  email       text not null,
  template    text not null,
  send_at     timestamptz not null,
  sent_at     timestamptz,
  status      text not null default 'queued',
  resend_id   text,
  error       text
);
do $$ begin
  alter table public.race_emails add constraint race_emails_status_check check (status in ('queued', 'sent', 'skipped', 'failed'));
exception when duplicate_object then null; end $$;
create index if not exists race_emails_due_idx on public.race_emails (status, send_at);
create index if not exists race_emails_race_idx on public.race_emails (race_id);

create table if not exists public.race_unsubscribes (
  email       text primary key,
  created_at  timestamptz not null default now(),
  source      text
);

alter table public.race_runs enable row level security;
alter table public.race_emails enable row level security;
alter table public.race_unsubscribes enable row level security;
revoke all on table public.race_runs, public.race_emails, public.race_unsubscribes from anon, authenticated;
grant all on table public.race_runs, public.race_emails, public.race_unsubscribes to service_role;

-- Lets GET /api/race?action=health confirm this file ran in the project the server points at
create or replace function public.race_health()
returns text
language sql
stable
set search_path = ''
as $$ select 'review-race v1'::text $$;
revoke all on function public.race_health() from public;
grant execute on function public.race_health() to service_role;

-- Reading the races: Table Editor > race_runs, or
--   select created_at, first_name, email, business->>'name' as business, search->>'where' as town, status,
--          race->'you'->>'last90' as last90, race->'average'->>'last90' as rivals_last90, booked_at
--     from public.race_runs where email is not null order by created_at desc;
