-- =====================================================================================================================
-- Optional: one flat row per Meta lead, for reading in Supabase. Run it after ../lead-capture/leads.sql (the shared
-- table), in the same project: SQL Editor > New query > paste this file > Run. Safe to run again, and over the Gap
-- Check's version of this view (new columns go at the end, as Postgres requires for a view that already exists).
--
-- Since 2026-11-14 the page's lead form is the Review Race: a full race is the lead review-race, and a race asked for by
-- email (the search could not run) is review-race-later. The Gap Check's leads (meta-gap-report, meta-call) stay
-- listed. A race's booked call is kept with the race itself (race_runs.booked_at, ../review-race/sql/race.sql).
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
  l.form,                                              -- review-race, review-race-later; until 2026-11-14 meta-gap-report, meta-call
  l.status,
  l.name                              as first_name,
  l.email,
  l.phone,
  l.company                           as business,
  l.fields ->> 'city'                 as city,
  l.fields ->> 'trade'                as trade,
  (l.fields ->> 'score')::int         as score,          -- the Gap Check: higher means a bigger gap
  l.fields ->> 'tier'                 as tier,           -- steady, leaky, stalled
  l.fields ->> 'fit'                  as fit,            -- a race: trade or other; the Gap Check: qualified, under-floor, no-software
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
  l.fields ->> 'visit'                as visit,          -- links a visit's steps (and a Gap Check to its call)
  l.notes,
  l.fields ->> 'category'             as google_category,  -- a race: the business's category on Google (fit comes from it)
  l.fields ->> 'rating'               as google_rating,
  l.fields ->> 'reviews'              as google_reviews,
  l.fields ->> 'rivals'               as rivals,           -- the three shops the race compared it with
  l.fields ->> 'reason'               as later_reason      -- review-race-later: why the race could not run at once
from public.leads l
where l.form in ('review-race', 'review-race-later', 'meta-gap-report', 'meta-call');

revoke all on rempo_reports.meta_leads from public, anon, authenticated;
grant usage on schema rempo_reports to service_role;
grant select on rempo_reports.meta_leads to service_role;

comment on view rempo_reports.meta_leads is 'Rempo for Meta: one flat row per Meta lead (review races; earlier, Gap Checks and calls). Read-only, dashboard only.';

-- Handy queries (run them in the SQL Editor; they are not part of the setup):
--   Races to build by hand and email (within one business day):
--     select created_at, first_name, email, business, city, later_reason from rempo_reports.meta_leads
--      where form = 'review-race-later' and status = 'new' order by created_at;
--   The angle test: races per page variant, and the share that are trade businesses (Lead and Schedule go to Meta
--   only for those):
--     select variant, count(*) as races,
--            round(100.0 * count(*) filter (where fit = 'trade') / nullif(count(*), 0)) as trade_pct
--       from rempo_reports.meta_leads where form = 'review-race' group by variant order by races desc;
