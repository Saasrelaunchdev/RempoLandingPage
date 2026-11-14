-- =====================================================================================================================
-- Optional: one flat row per Meta lead, for reading in Supabase. Run it after ../lead-capture/leads.sql (the shared
-- table), in the same project: SQL Editor > New query > paste this file > Run. Safe to run again.
--
-- It changes nothing in public.leads and adds no way in from the website. The view lives in its own schema,
-- rempo_reports, which the Data API does not serve, and it runs with the reader's rights (security_invoker), so only
-- you, in the dashboard, can read it: the website's public key can no more read leads through it than through the
-- table itself. Read it in Table Editor (schema rempo_reports) or with the queries at the end.
-- =====================================================================================================================

create schema if not exists rempo_reports;
revoke all on schema rempo_reports from public, anon, authenticated;

create or replace view rempo_reports.meta_leads with (security_invoker = true) as
select
  l.id,
  l.created_at,
  l.form,                                              -- meta-gap-report (the Gap Check) or meta-call (the call step)
  l.status,
  l.name                              as first_name,
  l.email,
  l.phone,
  l.company                           as business,
  l.fields ->> 'city'                 as city,
  l.fields ->> 'trade'                as trade,
  (l.fields ->> 'score')::int         as score,          -- higher means a bigger gap
  l.fields ->> 'tier'                 as tier,           -- steady, leaky, stalled
  l.fields ->> 'fit'                  as fit,            -- qualified, under-floor, no-software (what Meta was told)
  l.fields ->> 'route'                as route,
  l.fields ->> 'profiles'             as google_profiles,
  l.fields ->> 'jobs'                 as jobs_a_week,
  l.fields ->> 'records'              as jobs_recorded_in,
  l.fields ->> 'asks'                 as asks_today,
  l.fields ->> 'newest'               as newest_review,
  l.fields ->> 'replies'              as replies,
  l.fields ->> 'compare'              as against_top_three,
  l.fields ->> 'slotDay'              as call_day,
  l.fields ->> 'slotWindow'           as call_window,
  l.fields ->> 'tz'                   as time_zone,
  l.fields ->> 'variant'              as variant,        -- the ad angle's page
  l.meta ->> 'utm_source'             as utm_source,
  l.meta ->> 'utm_campaign'           as utm_campaign,
  l.meta ->> 'utm_content'            as utm_content,
  (l.meta ? 'fbclid')                 as from_meta_click,
  l.fields ->> 'visit'                as visit,          -- links a visit's Gap Check and its call
  l.notes
from public.leads l
where l.form in ('meta-gap-report', 'meta-call');

revoke all on rempo_reports.meta_leads from public, anon, authenticated;
grant usage on schema rempo_reports to service_role;
grant select on rempo_reports.meta_leads to service_role;

comment on view rempo_reports.meta_leads is 'Rempo for Meta: one flat row per Meta lead (Gap Checks and calls). Read-only, dashboard only.';

-- Handy queries (run them in the SQL Editor; they are not part of the setup):
--   Today's calls to make:
--     select call_day, call_window, time_zone, first_name, business, phone, score, tier from rempo_reports.meta_leads
--      where form = 'meta-call' and call_day::date >= current_date order by call_day, call_window;
--   Gap Reports to send (within one business day):
--     select created_at, first_name, email, business, city, trade, score from rempo_reports.meta_leads
--      where form = 'meta-gap-report' and status = 'new' order by created_at;
--   The angle test: checks finished, qualified share and calls per variant:
--     select variant, count(*) filter (where form = 'meta-gap-report') as checks,
--            round(100.0 * count(*) filter (where form = 'meta-gap-report' and fit = 'qualified')
--                  / nullif(count(*) filter (where form = 'meta-gap-report'), 0)) as qualified_pct,
--            count(*) filter (where form = 'meta-call') as calls
--       from rempo_reports.meta_leads group by variant order by checks desc;
