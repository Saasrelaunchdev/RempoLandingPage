-- =====================================================================================================================
-- Checkout: the purchases made on rempo.io/start (checkout v1). See checkout/README.md.
-- =====================================================================================================================
--
-- Run it once, in the same Supabase project as the leads (lead-capture/leads.sql): Supabase dashboard > SQL Editor >
-- New query > paste this whole file > Run. It is safe to run again: it creates only what is missing, replaces its
-- functions, and never deletes a row.
--
-- What it creates
--   public.purchases              One row per Stripe Checkout Session opened on /start: paid or expired, the buyer, the
--                                 plan, the money, the consents, the visit it came from, and whether (and when) the buyer
--                                 reached GoHighLevel. Written only by the Stripe webhook (api/stripe-webhook.mjs).
--   public.record_checkout(jsonb) Stores or updates a session's row; tells the webhook whether the buyer was already
--                                 handed to GoHighLevel, so a webhook Stripe sends twice is handed off once.
--   public.record_handoff(...)    Records the handoff to GoHighLevel, or why it failed.
--   public.checkout_health()      Lets GET /api/checkout?health=1 confirm this file ran in the project.
--
-- Who can use them: only the secret key (the service_role), which only the server functions hold. The website's
-- publishable key (anon) can neither read the table nor call the functions.
--
-- Read your purchases: Table Editor > purchases, or the queries at the end of this file.
-- =====================================================================================================================

do $$
declare
  marker text;
begin
  if to_regclass('public.purchases') is null then return; end if;
  marker := obj_description('public.purchases'::regclass, 'pg_class');
  if marker is null or marker not like 'checkout%' then
    raise exception 'public.purchases already exists and was not created by checkout/checkout.sql. Rename it first (alter table public.purchases rename to purchases_before_checkout;), then run this file again.';
  end if;
end $$;

create table if not exists public.purchases (
  id                        uuid primary key default gen_random_uuid(),
  created_at                timestamptz not null default now(),
  updated_at                timestamptz not null default now(),
  stripe_session_id         text not null unique,
  livemode                  boolean not null default false,
  status                    text,
  payment_status            text,
  mode                      text,
  stripe_customer_id        text,
  stripe_subscription_id    text,
  stripe_payment_intent_id  text,
  email                     text,
  name                      text,
  phone                     text,
  business                  text,
  plan                      text,
  billing                   text,
  profiles                  integer,
  bump                      boolean not null default false,
  amount_total              bigint,
  currency                  text,
  terms_accepted            boolean,
  consent                   jsonb not null default '{}'::jsonb,
  visit                     text,
  lead_id                   uuid,
  recovery_url              text,
  metadata                  jsonb not null default '{}'::jsonb,
  paid_at                   timestamptz,
  expired_at                timestamptz,
  ghl_contact_id            text,
  handed_off_at             timestamptz,
  handoff_error             text,
  handoff_attempts          integer not null default 0
);

-- The mark this file checks for on every later run
comment on table public.purchases is 'checkout v1: one row per Stripe Checkout Session opened on /start, written only by the Stripe webhook through public.record_checkout().';

create index if not exists purchases_created_at_idx on public.purchases (created_at desc);
create index if not exists purchases_email_idx on public.purchases (lower(email), created_at desc);
create index if not exists purchases_visit_idx on public.purchases (visit) where visit is not null;

-- Nobody outside reads or writes it: row level security on, no policies, nothing granted to the public roles
alter table public.purchases enable row level security;
revoke all on table public.purchases from anon, authenticated;
grant all on table public.purchases to service_role;

create or replace function public.record_checkout(payload jsonb)
returns jsonb
language plpgsql
volatile
set search_path = ''
as $$
declare
  v_session text := nullif(btrim(coalesce(payload ->> 'stripe_session_id', '')), '');
  v_prev    public.purchases;
  v_row     public.purchases;
  v_paid    boolean := coalesce(payload ->> 'paid', '') = 'true';
  v_expired boolean := coalesce(payload ->> 'expired', '') = 'true';
  v_lead    uuid := case when coalesce(payload ->> 'lead_id', '') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
                         then (payload ->> 'lead_id')::uuid end;
  v_elsewhere boolean;
begin
  if jsonb_typeof(payload) is distinct from 'object' or v_session is null then
    raise exception 'record_checkout needs a JSON object with stripe_session_id' using errcode = '22023';
  end if;
  select * into v_prev from public.purchases p where p.stripe_session_id = v_session;

  insert into public.purchases as p (
    stripe_session_id, livemode, status, payment_status, mode, stripe_customer_id, stripe_subscription_id,
    stripe_payment_intent_id, email, name, phone, business, plan, billing, profiles, bump, amount_total, currency,
    terms_accepted, consent, visit, lead_id, recovery_url, metadata, paid_at, expired_at)
  values (
    v_session,
    coalesce((payload ->> 'livemode')::boolean, false),
    left(payload ->> 'status', 40),
    left(payload ->> 'payment_status', 40),
    left(payload ->> 'mode', 20),
    left(payload ->> 'stripe_customer_id', 100),
    left(payload ->> 'stripe_subscription_id', 100),
    left(payload ->> 'stripe_payment_intent_id', 100),
    nullif(lower(left(btrim(coalesce(payload ->> 'email', '')), 254)), ''),
    left(payload ->> 'name', 200),
    left(payload ->> 'phone', 40),
    left(payload ->> 'business', 200),
    left(payload ->> 'plan', 60),
    left(payload ->> 'billing', 20),
    case when coalesce(payload ->> 'profiles', '') ~ '^[0-9]{1,3}$' then (payload ->> 'profiles')::integer end,
    coalesce((payload ->> 'bump')::boolean, false),
    case when coalesce(payload ->> 'amount_total', '') ~ '^[0-9]{1,15}$' then (payload ->> 'amount_total')::bigint end,
    left(payload ->> 'currency', 10),
    (payload ->> 'terms_accepted')::boolean,
    case when jsonb_typeof(payload -> 'consent') = 'object' then payload -> 'consent' else '{}'::jsonb end,
    left(payload ->> 'visit', 64),
    v_lead,
    left(payload ->> 'recovery_url', 1000),
    case when jsonb_typeof(payload -> 'metadata') = 'object' then payload -> 'metadata' else '{}'::jsonb end,
    case when v_paid then now() end,
    case when v_expired then now() end)
  on conflict (stripe_session_id) do update set
    updated_at               = now(),
    livemode                 = excluded.livemode,
    status                   = coalesce(excluded.status, p.status),
    payment_status           = coalesce(excluded.payment_status, p.payment_status),
    mode                     = coalesce(excluded.mode, p.mode),
    stripe_customer_id       = coalesce(excluded.stripe_customer_id, p.stripe_customer_id),
    stripe_subscription_id   = coalesce(excluded.stripe_subscription_id, p.stripe_subscription_id),
    stripe_payment_intent_id = coalesce(excluded.stripe_payment_intent_id, p.stripe_payment_intent_id),
    email                    = coalesce(excluded.email, p.email),
    name                     = coalesce(excluded.name, p.name),
    phone                    = coalesce(excluded.phone, p.phone),
    business                 = coalesce(excluded.business, p.business),
    plan                     = coalesce(excluded.plan, p.plan),
    billing                  = coalesce(excluded.billing, p.billing),
    profiles                 = coalesce(excluded.profiles, p.profiles),
    bump                     = excluded.bump or p.bump,
    amount_total             = coalesce(excluded.amount_total, p.amount_total),
    currency                 = coalesce(excluded.currency, p.currency),
    terms_accepted           = coalesce(excluded.terms_accepted, p.terms_accepted),
    consent                  = p.consent || excluded.consent,
    visit                    = coalesce(excluded.visit, p.visit),
    lead_id                  = coalesce(excluded.lead_id, p.lead_id),
    recovery_url             = coalesce(excluded.recovery_url, p.recovery_url),
    metadata                 = p.metadata || excluded.metadata,
    paid_at                  = coalesce(p.paid_at, excluded.paid_at),
    expired_at               = coalesce(p.expired_at, excluded.expired_at)
  returning * into v_row;

  -- For an abandoned checkout: has this email paid in another checkout in the last 30 days?
  select exists (
    select 1 from public.purchases q
     where v_row.email is not null and lower(q.email) = v_row.email and q.paid_at is not null
       and q.stripe_session_id <> v_session and q.created_at > now() - interval '30 days'
  ) into v_elsewhere;

  return jsonb_build_object(
    'id', v_row.id,
    'first_seen', v_prev.id is null,
    'handed_off_at', v_row.handed_off_at,
    'handoff_error', v_row.handoff_error,
    'ghl_contact_id', v_row.ghl_contact_id,
    'email_paid_elsewhere', v_elsewhere);
end;
$$;

comment on function public.record_checkout(jsonb) is 'checkout v1: stores or updates one Checkout Session from the Stripe webhook.';

create or replace function public.record_handoff(p_session_id text, p_contact_id text default null, p_error text default null)
returns void
language sql
volatile
set search_path = ''
as $$
  update public.purchases
     set updated_at       = now(),
         handoff_attempts = handoff_attempts + 1,
         ghl_contact_id   = coalesce(nullif(p_contact_id, ''), ghl_contact_id),
         handed_off_at    = case when p_error is null and nullif(p_contact_id, '') is not null then coalesce(handed_off_at, now()) else handed_off_at end,
         handoff_error    = case when p_error is null then null else left(p_error, 1000) end
   where stripe_session_id = p_session_id;
$$;

comment on function public.record_handoff(text, text, text) is 'checkout v1: records that a Checkout Session reached GoHighLevel, or why it did not.';

create or replace function public.checkout_health()
returns text
language sql
stable
set search_path = ''
as $$ select 'checkout v1'::text $$;

-- Only the server's secret key (service_role) may call them; Supabase grants new functions to the public roles by default
revoke all on function public.record_checkout(jsonb) from public, anon, authenticated;
revoke all on function public.record_handoff(text, text, text) from public, anon, authenticated;
revoke all on function public.checkout_health() from public, anon, authenticated;
grant execute on function public.record_checkout(jsonb) to service_role;
grant execute on function public.record_handoff(text, text, text) to service_role;
grant execute on function public.checkout_health() to service_role;

-- The REST API sees the new functions at once
notify pgrst, 'reload schema';

-- Handy queries (run them in the SQL Editor; they are not part of the setup):
--   Paid, newest first:
--     select paid_at, business, email, plan, billing, profiles, amount_total / 100.0 as paid, handed_off_at, handoff_error
--       from public.purchases where paid_at is not null order by paid_at desc;
--   Paid but not in GoHighLevel yet (Stripe is retrying; the reason is in handoff_error):
--     select paid_at, business, email, handoff_attempts, handoff_error from public.purchases
--      where paid_at is not null and handed_off_at is null;
--   Each purchase with the leads of the same visit (where the buyer came from):
--     select p.paid_at, p.business, p.plan, l.form, l.created_at, l.meta
--       from public.purchases p join public.leads l on l.fields ->> 'visit' = p.visit
--      where p.paid_at is not null order by p.paid_at desc, l.created_at;
