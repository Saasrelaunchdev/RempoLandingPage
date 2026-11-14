# The Review Race

A free tool for HVAC and plumbing owners: they find their business on Google Maps, and see their Google reviews next to the three shops a homeowner sees first near them. The preview is free. With a first name and an email they unlock the full race: their 90-day pace against the top three, where they stand in four areas, three fixes in plain words, and replies written for three of their reviews that have no reply. Then they can book a 15-minute call on the GoHighLevel calendar.

**Where it runs.** Since 2026-11-14 it is the lead form of the Meta ads page, `/customers` (the owner's decision: it replaces the Gap Check there). The landing page's Vercel project runs its server at `/api/race` and its daily job at `/api/race-cron`, and `../meta/tools/build.mjs` copies its widget into `customers/`. See "On the landing page" below. This folder keeps the tool's sources, its test page and its tests.

```
business search (Google Places, or SerpApi with Find)  ->  free preview (2 SerpApi searches)  ->  locked cards with real counts  ->  first name + email
     ->  Supabase lead + GoHighLevel contact + team alert  ->  reviews read (about 9 searches)  ->  numbers in code
     ->  Claude writes 3 fixes + 3 replies (checked against the claim rules)  ->  full race + results email
     ->  pick a time (GoHighLevel calendar)  ->  follow-up emails on days 2, 5, 9, 14, 44 until they book or opt out
```

## What is where

| Path | What it is |
|---|---|
| `public/index.html` | A plain test page with both mount points: the hero CTA and the section |
| `public/assets/`, `public/media/`, and the proof part of `public/index.html` | The landing page's case studies and German Aquino's video, copied from its `index.html` by `node tools/proof.mjs` so the test page shows the same proof. Don't edit them here: rerun the script when the landing page's proof changes (`npm test` fails until you do) |
| `public/race/race.js`, `race.css`, `copy.js` | The tool itself, framework free. Every visitor-facing word is in `copy.js` |
| `api/race.mjs` | The one endpoint: config, suggestions, start, reviews, unlock, result, slots, book, later, unsubscribe, health |
| `api/race-cron.mjs` | The daily job: follow-up emails, race updates, clearing old review text |
| `api/_lib/race/` | `serpapi.mjs`, `places.mjs`, `metrics.mjs` (every number), `claude.mjs` (the words), `lint.mjs` (the claim rules), `copy.mjs` (emails and rule-based fixes), `store.mjs` (Supabase), `ghl.mjs` (GoHighLevel), `emails.mjs` (Resend, Slack), `turnstile.mjs`, `fakes.mjs` (demo data), `core.mjs` (the steps) |
| `sql/race.sql` | The three tables: `race_runs`, `race_emails`, `race_unsubscribes` |
| `tests/` | `npm test`: the numbers and the API adapters, the claim rules over every word and email, the whole flow, and the page in Chromium on a phone and a desktop |

## Set it up (in the landing page's Vercel project)

1. **Supabase.** In the landing page's project (the one `SUPABASE_URL` names): SQL Editor > New query > paste `sql/race.sql` > Run. Then Project Settings > API Keys > create a **secret key** (`sb_secret_...`), used by the server only.
2. **Vercel.** The landing page's project, Settings > Environment Variables: add the race's variables below (Production, and Preview to test on a preview link). The ones the landing page already has are read as they are. The full list with comments is in `.env.example`. A change to a variable takes effect on the next deployment of `main`: the next merge, or Redeploy on the production deployment (the one whose Source is `main`).
3. **GoHighLevel.** Give the token the two calendar scopes (below). Texts after a booking: send them only to contacts tagged `race-texts-ok` (the booking's optional texts box); without the tag, no text.
4. **Cloudflare Turnstile.** Add the landing page's domain to the widget.
5. **Check it.** Open `https://<the-site>/api/race?action=health`. `ready: true` means the required keys are set and the database answers (so `sql/race.sql` ran). Each optional part shows true or false. Until `ready`, the page still keeps every request (`byHand`) and alerts the team to send the race by hand.
6. **Try it.** Open `https://<the-site>/customers` and race your own business. Then check the GoHighLevel contact (tag `review-race`, with a note), the results email, the team alert, and book a test call.
7. **Delete the separate `remporacetool` Vercel project.** It built this folder from its old branch, which is merged; it is no longer needed.

**Vercel Cron runs on production deployments only.** To run the daily job by hand (on a preview, for example):

```bash
curl -H "Authorization: Bearer $CRON_SECRET" https://<the-site>/api/race-cron
```

To see the whole flow before any key is set, run it locally in demo mode (`npm run dev:fake` here, or `node meta/tools/dev.mjs --stub` from the repository root for the `/customers` pages). The page shows "Demo mode", uses sample businesses, and sends nothing anywhere.

### Environment variables

| Variable | Required | Where it comes from |
|---|---|---|
| `SERPAPI_API_KEY` | yes | serpapi.com > Dashboard > Your Private API Key |
| `GOOGLE_PLACES_API_KEY` | no | Suggestions as the owner types. Google Cloud > enable **Places API (New)** (billing must be on) > Credentials > Create API key, restricted to Places API (New). Without it, the owner types their business name and town and presses Find, which spends 1 SerpApi search |
| `ANTHROPIC_API_KEY` | yes | console.anthropic.com > API Keys (the landing page's /admin already uses one) |
| `SUPABASE_URL` | yes | Supabase > Project Settings > Data API > Project URL |
| `SUPABASE_SECRET_KEY` | yes | Supabase > Project Settings > API Keys > Secret keys |
| `RACE_PUBLIC_URL` | no | The address in email links, no trailing slash (the links add the page the race started on, such as `/customers/recent`). Production uses the project's production domain and a preview its branch URL by themselves; set this to override them |
| `RESEND_API_KEY` | for emails | resend.com > API Keys (the landing page's key works) |
| `RACE_EMAIL_FROM` | for emails | What owners see, on your verified Resend domain: `Rempo <reports@your-domain>` |
| `RACE_POSTAL_ADDRESS` | for emails | The postal address commercial email must carry (CAN-SPAM) |
| `LEAD_NOTIFY_FROM`, `LEAD_NOTIFY_TO` | for the team alert | Same values as on the landing page |
| `SLACK_WEBHOOK_URL` | optional | Same value as on the landing page |
| `GHL_TOKEN` | for the CRM and calendar | The landing page's variable of the same name (its checkout uses it). GoHighLevel > Settings > Private Integrations, with scopes `contacts.write`, `contacts.readonly`, `calendars.readonly`, `calendars/events.write` |
| `GHL_LOCATION_ID` | for the CRM and calendar | Settings > Business Profile > Location ID |
| `GHL_CALENDAR_ID` | for the calendar | Calendars > your 15-minute call calendar > its ID |
| `GHL_BOOKING_URL` | optional | The calendar's public booking link, shown if the in-page calendar can't load |
| `TURNSTILE_SITE_KEY`, `TURNSTILE_SECRET_KEY` | recommended | Cloudflare > Turnstile > Add widget for the landing page's hostname. Without them, the bot check is off |
| `CRON_SECRET` | for follow-ups | Any long random text |
| `RACE_LINK_SECRET` | recommended | Any long random text; signs the unsubscribe links |
| `META_PIXEL_ID`, `META_CAPI_TOKEN` | for Meta's Conversions API | The same as the Meta ads page's (`../meta/README.md`): `Lead` and `Schedule` for trade businesses, with the page's event ids |
| `RACE_REPLY_TO`, `RACE_SITE_URL`, `RACE_PRIVACY_URL`, `RACE_TERMS_URL`, `RACE_CASE_STUDY_URL`, `RACE_CLAUDE_EFFORT`, `RACE_DAILY_CAP`, `RACE_IP_DAILY`, `RACE_CACHE_DAYS`, `RACE_NURTURE`, `RACE_UPDATES`, `GHL_STOP_TAGS`, `LEAD_HASH_SALT`, `RACE_FAKE` | optional | See `.env.example` |

## How it works

- **The numbers come from code, the words from Claude.** `metrics.mjs` computes everything from SerpApi's public data: the 90-day count, how old the newest review is, how many of the last 30 got a reply, the star cushion, the 12-month pace, and the four areas (First impression, Trust, Momentum, Care, the landing page scorecard's own names). Claude is handed those numbers and the owner's last 30 reviews, and writes three fixes, three reply drafts and the themes, as JSON in a fixed schema.
- **Every line is checked.** `lint.mjs` applies Rempo's claim rules (the landing page's `copy-rules.json`): no promised reviews, rankings or results; no em dashes; every statistic sourced in its own sentence. It adds the reply rules: no offers, never asking to change a review, no links, short. A line that fails is dropped, and a rule-based line fills its place. If Claude is down, the race still shows with rule-based fixes.
- **Value before the fold.** The preview (who ranks, their stars and counts against yours) costs 2 SerpApi searches and asks for nothing. The locked cards show real counts ("We wrote replies to 3 of your reviews that have no reply yet. 22 of your last 32 reviews have no reply.") before the email is asked for.
- **Searches.** About 11 SerpApi searches per new race: 2 for the preview (without the Google key, the Find takes the place of the business lookup, plus 1 for each extra Find), then up to 3 pages of the owner's reviews and 2 per rival. A business raced in the last 7 days is shown again with no new searches. Each race update spends 1 or 2. On SerpApi's free plan (250 a month) that is about 20 new races a month.
- **Limits.** 5 races per network per day, 40 per day overall (`RACE_IP_DAILY`, `RACE_DAILY_CAP`), the Turnstile bot check, and a bot trap field. When a race can't run (quota, cap, business not found), the owner leaves an email and the team gets an alert to send the report by hand within one business day.
- **What is kept.** The race's numbers, the three reviews shown beside the drafts (cleared after 30 days), and the contact. The 30 reviews Claude reads are cleared as soon as the analysis is saved. Races nobody unlocked are deleted after 30 days.
- **GoHighLevel.** At unlock: the contact is created or updated (tag `review-race`, plus a note with the race summary and the results link). At booking: the appointment on your calendar, the tag `race-booked`, and `race-texts-ok` if the owner ticked the texts box. Follow-ups stop when the contact carries any of `GHL_STOP_TAGS` (default `customer, client, race-booked, race-unsubscribed`).
- **Emails.** The results email right after unlock. Then day 2 (the replies, posted?), day 5 (what the top three do differently), day 9 (a case study, only if `RACE_CASE_STUDY_URL` is set), and race updates on day 14 and day 44 with fresh counts. Every email has a one-click unsubscribe and the postal address.

## Local work and tests

```bash
npm install
npm run dev:fake        # http://localhost:3210 with demo data, no keys
npm run dev             # with your keys in .env.local (copy .env.example)
npm test                # all checks (the page test needs Playwright with Chromium)
```

## On the landing page

Merged on 2026-11-14. What the landing page holds:

- `../api/race.mjs` and `../api/race-cron.mjs` run `api/race.mjs` and `api/race-cron.mjs` from this folder. The root `vercel.json` has both functions (120 and 300 seconds) and the daily cron; the root `.vercelignore` leaves out this folder's test page, tests and tools.
- `../meta/tools/build.mjs` copies `public/race/` into `customers/assets/race/` and places the two mount points on each `/customers` page: the hero's search (`#hero-race`) and the race's section under it (`#review-race`). `race.css` is inlined in each page.
- The page hands the race its own fields with each request (`window.ReviewRace.extra`: the ad angle's variant, the consent wording's version, the pixel's event id, the cookie choice), and its legal links and its sentence about Meta for the notice at collection. The race turns its steps into `reviewrace` window events, which the page sends to Meta's pixel.
- `api/_lib/race/capi.mjs` sends `Lead` (a full race) and `Schedule` (a booked call) to Meta's Conversions API for trade businesses (`fit.mjs`), never after an opt-out and never with the phone number.
- Before the race's keys are set, the page takes the business name and the town by hand and `later` keeps the request in the leads table with the landing page's publishable key (`store.mjs`, `openLeadStore`).
- The legal pages (`../legal-src/`) name SerpApi, Google Maps Platform, Anthropic and Cloudflare Turnstile.

The master page's own scorecard (`../index.html#scorecard`) is unchanged; whether it uses this tool or ScoreApp is still the owner's decision. Don't copy `public/assets/`, `public/media/` or the proof part of `public/index.html` anywhere: the landing page has its own case studies and video.

## Not verified against the live services yet

The tests run everything against stand-ins built from each service's documented formats. Those formats were checked against SerpApi's own repositories, GoHighLevel's official SDK (`@gohighlevel/api-client` 3.1.1), Google's Places API definitions (`@googlemaps/places` 3.1.0) and the landing page's working Claude integration. No live call to SerpApi, Google, GoHighLevel, Resend, Cloudflare or Claude was made from this build. The first real race on the preview is the live test: check `/api/race?action=health`, then the contact, the note, the booking and the emails.
