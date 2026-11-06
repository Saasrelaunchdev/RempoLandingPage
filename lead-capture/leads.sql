-- =====================================================================================================================
-- Lead capture: where this site's forms are stored. Installed by the landing-page-lead-capture skill (lead-capture v1).
-- =====================================================================================================================
--
-- Run it once: Supabase dashboard > SQL Editor > New query > paste this whole file > Run.
-- It is safe to run again (after an update too): it creates only what is missing, replaces its functions, and never
-- deletes a row. If a table named public.leads already exists and was not made by this file, it stops with a message
-- and changes nothing: rename that table or use another Supabase project.
--
-- What it creates
--   public.leads                   One row per form submission: the contact fields, every other field as it was sent
--                                  (fields), the consent boxes (consent), where the visitor came from (meta), and your
--                                  own status and notes. Nobody outside can read it; you read it in the Table Editor.
--   public.submit_lead(jsonb)      The only way in from the website: checks the lead, rate-limits it, stores it. The
--                                  site's /api/lead calls it with the publishable key (the anon role).
--   public.lead_capture_health()   Lets GET /api/lead confirm this file ran in the project the site points at.
--
-- Read your leads: Table Editor > leads, or the queries at the end of this file.
-- =====================================================================================================================

-- A table of the same name made by something else would fail every insert later, or lose its own access rules
-- below: stop here instead, with the reason.
do $$
declare
  marker text;
  required text;
begin
  if to_regclass('public.leads') is null then return; end if;
  marker := obj_description('public.leads'::regclass, 'pg_class');
  if marker is null or marker not like 'lead-capture%' then
    raise exception 'public.leads already exists and was not created by lead capture. Rename it first (alter table public.leads rename to leads_before_lead_capture;), then run this file again.';
  end if;
  select string_agg(column_name, ', ') into required
    from information_schema.columns
   where table_schema = 'public' and table_name = 'leads' and is_nullable = 'NO' and column_default is null;
  if required is not null then
    raise exception 'public.leads has required columns this file does not fill: %. Give them a default or drop them, then run this file again.', required;
  end if;
end $$;

create table if not exists public.leads (
  id          uuid primary key default gen_random_uuid(),
  created_at  timestamptz not null default now(),
  form        text not null default 'default',
  email       text,
  name        text,
  phone       text,
  company     text,
  message     text,
  consent     jsonb not null default '{}'::jsonb,
  fields      jsonb not null default '{}'::jsonb,
  meta        jsonb not null default '{}'::jsonb,
  ip_hash     text,
  status      text not null default 'new',
  notes       text
);

-- The mark this file checks for on every later run
comment on table public.leads is 'lead-capture v1: one row per form submission, written only through public.submit_lead(). Status and notes are yours to edit.';

-- An older version of this table gains what it lacks
alter table public.leads add column if not exists form    text not null default 'default';
alter table public.leads add column if not exists email   text;
alter table public.leads add column if not exists name    text;
alter table public.leads add column if not exists phone   text;
alter table public.leads add column if not exists company text;
alter table public.leads add column if not exists message text;
alter table public.leads add column if not exists consent jsonb not null default '{}'::jsonb;
alter table public.leads add column if not exists fields  jsonb not null default '{}'::jsonb;
alter table public.leads add column if not exists meta    jsonb not null default '{}'::jsonb;
alter table public.leads add column if not exists ip_hash text;
alter table public.leads add column if not exists status  text not null default 'new';
alter table public.leads add column if not exists notes   text;

do $$ begin
  alter table public.leads add constraint leads_status_check check (status in ('new', 'contacted', 'qualified', 'won', 'lost', 'spam'));
exception when duplicate_object then null; end $$;
do $$ begin
  alter table public.leads add constraint leads_contact_check check (email is not null or phone is not null);
exception when duplicate_object then null; end $$;

create index if not exists leads_created_at_idx on public.leads (created_at desc);
create index if not exists leads_email_idx on public.leads (lower(email), created_at desc);
create index if not exists leads_ip_hash_idx on public.leads (ip_hash, created_at desc) where ip_hash is not null;

-- Nobody outside reads or writes the table directly: row level security on, no policies, no grants to the public
-- roles. The website writes only through submit_lead() below; you read it in the dashboard.
alter table public.leads enable row level security;
revoke all on table public.leads from anon, authenticated;
grant all on table public.leads to service_role;

-- The one way in. Runs as the table's owner (security definer) so the public role needs no grant on the table.
create or replace function public.submit_lead(payload jsonb)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_form    text  := left(coalesce(nullif(btrim(payload ->> 'form'), ''), 'default'), 80);
  v_email   text  := nullif(lower(left(btrim(coalesce(payload ->> 'email', '')), 254)), '');
  v_name    text  := nullif(left(btrim(coalesce(payload ->> 'name', '')), 200), '');
  v_phone   text  := nullif(left(btrim(coalesce(payload ->> 'phone', '')), 40), '');
  v_company text  := nullif(left(btrim(coalesce(payload ->> 'company', '')), 200), '');
  v_message text  := nullif(left(btrim(coalesce(payload ->> 'message', '')), 5000), '');
  v_ip      text  := nullif(left(btrim(coalesce(payload ->> 'ip_hash', '')), 128), '');
  v_consent jsonb := case when jsonb_typeof(payload -> 'consent') = 'object' then payload -> 'consent' else '{}'::jsonb end;
  v_fields  jsonb := case when jsonb_typeof(payload -> 'fields') = 'object' then payload -> 'fields' else '{}'::jsonb end;
  v_meta    jsonb := case when jsonb_typeof(payload -> 'meta') = 'object' then payload -> 'meta' else '{}'::jsonb end;
  v_id      uuid;
begin
  if jsonb_typeof(payload) is distinct from 'object' then
    raise exception 'The lead must be a JSON object' using errcode = '22023';
  end if;
  if v_email is not null and v_email !~ '^[^[:space:]@<>,]+@[^[:space:]@<>,]+\.[^[:space:]@<>,]+$' then
    raise exception 'A valid email is required' using errcode = '22023';
  end if;
  if v_email is null and length(regexp_replace(coalesce(v_phone, ''), '[^0-9]', '', 'g')) < 7 then
    raise exception 'An email or a phone number is required' using errcode = '22023';
  end if;
  if length(v_fields::text) > 16000 then v_fields := jsonb_build_object('_note', 'The fields were over 16000 characters and were not kept'); end if;
  if length(v_meta::text) > 4000 then v_meta := '{}'::jsonb; end if;
  if length(v_consent::text) > 2000 then v_consent := '{}'::jsonb; end if;

  -- Rate limits, an hour at a time: 5 per email, 20 per network (the hashed IP), 500 for the whole site
  if (v_email is not null and (select count(*) from public.leads l where lower(l.email) = v_email and l.created_at > now() - interval '1 hour') >= 5)
     or (v_ip is not null and (select count(*) from public.leads l where l.ip_hash = v_ip and l.created_at > now() - interval '1 hour') >= 20)
     or (select count(*) from public.leads l where l.created_at > now() - interval '1 hour') >= 500 then
    raise exception 'Too many submissions. Please try again later' using errcode = 'PT429';
  end if;

  insert into public.leads (form, email, name, phone, company, message, consent, fields, meta, ip_hash)
  values (v_form, v_email, v_name, v_phone, v_company, v_message, v_consent, v_fields, v_meta, v_ip)
  returning id into v_id;
  return v_id;
end;
$$;

comment on function public.submit_lead(jsonb) is 'lead-capture v1: stores one lead from the website, checked and rate-limited.';
revoke all on function public.submit_lead(jsonb) from public;
grant execute on function public.submit_lead(jsonb) to anon, authenticated, service_role;

create or replace function public.lead_capture_health()
returns text
language sql
stable
set search_path = ''
as $$ select 'lead-capture v1'::text $$;

revoke all on function public.lead_capture_health() from public;
grant execute on function public.lead_capture_health() to anon, authenticated, service_role;

-- The REST API sees the new functions at once
notify pgrst, 'reload schema';

-- Handy queries (run them in the SQL Editor; they are not part of the setup):
--   select created_at, form, name, email, phone, company, status from public.leads order by created_at desc;
--   select created_at, name, email, fields, meta from public.leads where created_at > now() - interval '7 days';
--   update public.leads set status = 'contacted' where email = 'someone@example.com';
