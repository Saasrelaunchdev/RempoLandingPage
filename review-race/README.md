# The Review Race

A free tool for HVAC and plumbing owners: they find their business on Google Maps, and see their Google reviews next to the three shops a homeowner sees first near them. The preview is free. With a first name and an email they unlock the full race: their 90-day pace against the top three, where they stand in four areas, three fixes in plain words, and replies written for three of their reviews that have no reply. Then they can book a 15-minute call on the GoHighLevel calendar.

**This folder is a preview only.** It is its own Vercel project, separate from the landing page, and changes nothing on it. It is built to drop into the landing page later as a section with a hero CTA (see "Merging into the landing page").

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

## Deploy it as its own Vercel project

1. **Supabase.** Use the landing page's project, so race leads also land in its `leads` table. SQL Editor > New query > paste `sql/race.sql` > Run. Then Project Settings > API Keys > create a **secret key** (`sb_secret_...`). It is used by the server only.
2. **Vercel.** Add New > Project > import `Saasrelaunchdev/RempoLandingPage`. Name it (for example `rempo-review-race`), Framework Preset: Other, **Root Directory: `review-race`**. The Root Directory list shows the folders on `main`, and this folder is only on the branch for now, so it may not be listed. Then click Deploy as it is, and once the project exists, type `review-race` in Settings > Build and Deployment > Root Directory and save. That first build runs on `main` and is of no use (it fails, or it is a copy of the landing page): delete it from Deployments.
3. **Build the branch only.** Settings > Git > Ignored Build Step > Behavior: Custom, command `[ "$VERCEL_GIT_COMMIT_REF" != "claude/dreamy-cray-95z5j1" ]`. Without it, every push to `main` also starts a build of this project, which fails while the folder isn't on `main`. Either way, nothing on the landing page changes.
4. **Environment variables.** Settings > Environment Variables. Add the ones below for **Preview** (and Production, for later). The full list with comments is in `.env.example`.
5. **Build it.** Deployments > Create Deployment > branch `claude/dreamy-cray-95z5j1` (or push any commit to the branch). From then on every push to the branch builds a preview, and the branch keeps one URL between pushes. Vercel shortens long branch names, so take the URL from the deployment's Domains or from the Vercel comment on the pull request. For the `remporacetool` project it is `https://remporacetool-git-claude-dreamy-cra-4b15e3-rempo-saa-sr-elaunch.vercel.app`.

   **Redeploy only a branch build.** After you change a variable, open the latest deployment whose Source is `claude/dreamy-cray-95z5j1` (Environment: Preview) and click Redeploy, or push to the branch. Never redeploy one whose Source is `main`: until the tool is merged, those fail with "The specified Root Directory "review-race" does not exist", because the folder isn't on `main` yet.
6. **Check it.** Open `<your-url>/api/race?action=health`. `ready: true` means the required keys are set and the database answers (so `sql/race.sql` ran). Each optional part shows true or false.
7. **Try it.** Open `<your-url>/` and race your own business. Then check the GoHighLevel contact (tag `review-race`, with a note), the results email, the team alert, and book a test call.

Two things about previews: Vercel's Deployment Protection asks visitors to log in to Vercel by default, so you can test while logged in (Settings > Deployment Protection, or the deployment's Share link, for testers without a Vercel account). And **Vercel Cron runs on production deployments only**. On a preview, run the daily job by hand:

```bash
curl -H "Authorization: Bearer $CRON_SECRET" https://<your-url>/api/race-cron
```

To see the whole flow before any key is set, add `RACE_FAKE=1`. The page shows "Demo mode", uses sample businesses, and sends nothing anywhere.

### Environment variables

| Variable | Required | Where it comes from |
|---|---|---|
| `SERPAPI_API_KEY` | yes | serpapi.com > Dashboard > Your Private API Key |
| `GOOGLE_PLACES_API_KEY` | no | Suggestions as the owner types. Google Cloud > enable **Places API (New)** (billing must be on) > Credentials > Create API key, restricted to Places API (New). Without it, the owner types their business name and town and presses Find, which spends 1 SerpApi search |
| `ANTHROPIC_API_KEY` | yes | console.anthropic.com > API Keys (the landing page's /admin already uses one) |
| `SUPABASE_URL` | yes | Supabase > Project Settings > Data API > Project URL |
| `SUPABASE_SECRET_KEY` | yes | Supabase > Project Settings > API Keys > Secret keys |
| `RACE_PUBLIC_URL` | no, on a preview | The address in email links, no trailing slash. A preview uses its branch URL by itself; set this once the tool has its own domain |
| `RESEND_API_KEY` | for emails | resend.com > API Keys (the landing page's key works) |
| `RACE_EMAIL_FROM` | for emails | What owners see, on your verified Resend domain: `Rempo <reports@your-domain>` |
| `RACE_POSTAL_ADDRESS` | for emails | The postal address commercial email must carry (CAN-SPAM) |
| `LEAD_NOTIFY_FROM`, `LEAD_NOTIFY_TO` | for the team alert | Same values as on the landing page |
| `SLACK_WEBHOOK_URL` | optional | Same value as on the landing page |
| `GHL_TOKEN` | for the CRM and calendar | The landing page's variable of the same name (its checkout uses it). GoHighLevel > Settings > Private Integrations, with scopes `contacts.write`, `contacts.readonly`, `calendars.readonly`, `calendars/events.write` |
| `GHL_LOCATION_ID` | for the CRM and calendar | Settings > Business Profile > Location ID |
| `GHL_CALENDAR_ID` | for the calendar | Calendars > your 15-minute call calendar > its ID |
| `GHL_BOOKING_URL` | optional | The calendar's public booking link, shown if the in-page calendar can't load |
| `TURNSTILE_SITE_KEY`, `TURNSTILE_SECRET_KEY` | recommended | Cloudflare > Turnstile > Add widget for this project's hostname. Without them, the bot check is off |
| `CRON_SECRET` | for follow-ups | Any long random text |
| `RACE_LINK_SECRET` | recommended | Any long random text; signs the unsubscribe links |
| `RACE_REPLY_TO`, `RACE_SITE_URL`, `RACE_PRIVACY_URL`, `RACE_TERMS_URL`, `RACE_CASE_STUDY_URL`, `RACE_CLAUDE_EFFORT`, `RACE_DAILY_CAP`, `RACE_IP_DAILY`, `RACE_CACHE_DAYS`, `RACE_NURTURE`, `RACE_UPDATES`, `GHL_STOP_TAGS`, `LEAD_HASH_SALT`, `RACE_FAKE` | optional | See `.env.example` |

## How it works

- **The numbers come from code, the words from Claude.** `metrics.mjs` computes everything from SerpApi's public data: the 90-day count, how old the newest review is, how many of the last 30 got a reply, the star cushion, the 12-month pace, and the four areas (First impression, Trust, Momentum, Care, the landing page scorecard's own names). Claude is handed those numbers and the owner's last 30 reviews, and writes three fixes, three reply drafts and the themes, as JSON in a fixed schema.
- **Every line is checked.** `lint.mjs` applies Rempo's claim rules (the landing page's `copy-rules.json`): no promised reviews, rankings or results; no em dashes; every statistic sourced in its own sentence. It adds the reply rules: no offers, never asking to change a review, no links, short. A line that fails is dropped, and a rule-based line fills its place. If Claude is down, the race still shows with rule-based fixes.
- **Value before the fold.** The preview (who ranks, their stars and counts against yours) costs 2 SerpApi searches and asks for nothing. The locked cards show real counts ("We wrote replies to 3 of your reviews that have no reply yet. 22 of your last 32 reviews have no reply.") before the email is asked for.
- **Searches.** About 11 SerpApi searches per new race: 2 for the preview (without the Google key, the Find takes the place of the business lookup, plus 1 for each extra Find), then up to 3 pages of the owner's reviews and 2 per rival. A business raced in the last 7 days is shown again with no new searches. Each race update spends 1 or 2. On SerpApi's free plan (250 a month) that is about 20 new races a month.
- **Limits.** 5 races per network per day, 40 per day overall (`RACE_IP_DAILY`, `RACE_DAILY_CAP`), the Turnstile bot check, and a bot trap field. When a race can't run (quota, cap, business not found), the owner leaves an email and the team gets an alert to send the report by hand within one business day.
- **What is kept.** The race's numbers, the three reviews shown beside the drafts (cleared after 30 days), and the contact. The 30 reviews Claude reads are cleared as soon as the analysis is saved. Races nobody unlocked are deleted after 30 days.
- **GoHighLevel.** At unlock: the contact is created or updated (tag `review-race`, plus a note with the race summary and the results link). At booking: the appointment on your calendar, and the tag `race-booked`. Follow-ups stop when the contact carries any of `GHL_STOP_TAGS` (default `customer, client, race-booked, race-unsubscribed`).
- **Emails.** The results email right after unlock. Then day 2 (the replies, posted?), day 5 (what the top three do differently), day 9 (a case study, only if `RACE_CASE_STUDY_URL` is set), and race updates on day 14 and day 44 with fresh counts. Every email has a one-click unsubscribe and the postal address.

## Local work and tests

```bash
npm install
npm run dev:fake        # http://localhost:3210 with demo data, no keys
npm run dev             # with your keys in .env.local (copy .env.example)
npm test                # all checks (the page test needs Playwright with Chromium)
```

## Merging into the landing page

The tool is built so this is a copy, not a rewrite. When you decide where it goes:

1. Copy `api/race.mjs`, `api/race-cron.mjs` and `api/_lib/race/` into the landing page's `api/`. No file names collide.
2. Copy `public/race/` into the landing page (for example `race/`) and load it once: `<link rel="stylesheet" href="/race/race.css">` and `<script type="module" src="/race/race.js"></script>`.
3. Place the two mount points:
   ```html
   <!-- the hero CTA, under the hero's buttons -->
   <div data-review-race-cta data-target="#review-race" id="hero-race"></div>
   <!-- the section, where the free scorecard section sits today -->
   <section id="review-race" data-review-race></section>
   ```
4. Add the two functions and the cron from this folder's `vercel.json` to the landing page's `vercel.json`.
5. Add only the race's new environment variables to the landing page's Vercel project (the race reads the same names the landing page uses, so `SUPABASE_URL`, `SUPABASE_SECRET_KEY`, `ANTHROPIC_API_KEY`, `RESEND_API_KEY`, `LEAD_NOTIFY_*`, `SLACK_WEBHOOK_URL`, `GHL_TOKEN`, `GHL_LOCATION_ID` and `LEAD_HASH_SALT` are already there). Give the GoHighLevel token the two calendar scopes, and add the landing page's domain to the Turnstile widget. Then delete the separate Vercel project.
6. Add SerpApi, Google (Maps Platform), Anthropic and Cloudflare (Turnstile) to the subprocessors page in `legal-src/`, and rebuild the legal pages.
7. Don't copy `public/assets/`, `public/media/` or the proof part of `public/index.html`: the landing page has its own case studies and video already.
8. The landing page's own scorecard choice still applies: this tool or ScoreApp, not both (owner decision pending).

The widget is scoped to `.rr` classes and `--rr-*` variables, uses the same Outfit and Geist fonts, and announces each step as a `reviewrace` window event, so the landing page can map them to its Meta pixel later.

## Not verified against the live services yet

The tests run everything against stand-ins built from each service's documented formats. Those formats were checked against SerpApi's own repositories, GoHighLevel's official SDK (`@gohighlevel/api-client` 3.1.1), Google's Places API definitions (`@googlemaps/places` 3.1.0) and the landing page's working Claude integration. No live call to SerpApi, Google, GoHighLevel, Resend, Cloudflare or Claude was made from this build. The first real race on the preview is the live test: check `/api/race?action=health`, then the contact, the note, the booking and the emails.
