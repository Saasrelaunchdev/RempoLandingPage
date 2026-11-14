# Rempo for Meta ads

A landing page built for one visitor: an HVAC or plumbing shop owner who tapped a Facebook or Instagram ad a few seconds ago. It turns the tap into a qualified lead with a free **review race** (their Google reviews next to the three shops a homeowner sees first near them), then into a booked 15-minute call. It lives on the master page's domain at `/customers` and deploys with it: the master page's Vercel project serves the built pages from the repository's `customers/` folder and runs the race's endpoint, `/api/race`. It shares the master page's look, its Supabase table, its Resend account and its Vercel settings.

The race is the Review Race in `../review-race/` (its widget, its server, its emails); the build copies its widget into the pages. Since 2026-11-14 it replaces the Gap Check and its Gap Report, which are retired (the owner's decision; see `../CLAUDE.md`).

Why it is built this way, section by section, with the methodology and GTM source for each decision: [PLAN.md](PLAN.md).

## The pages

One page per ad angle, so every ad lands on a page that says what the ad said (Meta also reads the page to decide who sees the ad). Only the hero changes; the rest is shared, so a test compares one thing.

| URL | Use it with an ad that says | Headline |
|---|---|---|
| `/customers` | "How do your Google reviews compare with the three shops above you?" | Your work is better. Do your reviews show it? |
| `/customers/recent` | "When did your shop get its last Google review?" | How fresh are your Google reviews? |
| `/customers/replies` | "How many of your Google reviews have no reply?" | How many of your reviews have no reply? |
| `/customers/request` | "Here's what your customer sees after every job." | Here's what your customer sees after every job. |

The path is `path` in `content/site.mjs`. To move the pages, change it, update the `/customers` entries in the root `vercel.json`, build, delete the old folder and commit (`tests/check-build.mjs` fails if the two disagree).

Add `?view=preview` to any page to see the open decisions marked `{TBD}` (visitors never see them).

## What a visitor does

1. Types their business name into the search in the hero (Google suggests matches as they type) and picks it.
2. The race runs in its section under the hero: a free preview at once (who ranks, their stars and review counts against yours), then the full race for a first name and an email: who is adding reviews now and who answers them, three fixes in plain words, and replies drafted for their own reviews. It is emailed to them too, with a link back to the page they started on.
3. Books a 15-minute call from the race: a time from the founder's GoHighLevel calendar, a phone number, and the call consent (texts are optional).
4. Booked: the video once recorded (`site.vsl`) and, once checkout is live, a link to it (`site.checkoutUrl`), under the confirmation.

When the race can't run (its keys are not set in Vercel yet, the day's limit is reached, the search quota ran out), the search becomes a plain "Your business name" box, and the visitor leaves the business, the town, a first name and an email. The lead is kept as `review-race-later` and the team is alerted to build the race by hand and email it within one business day. This works before any race key is set: it needs only the master page's `SUPABASE_URL` and `SUPABASE_ANON_KEY`.

## Run it

```bash
node tools/build.mjs
```

```bash
node tools/dev.mjs --stub
```

The build writes `../customers/` (commit it: Vercel serves it as it is and runs no build), with the race's widget from `../review-race/public/race/` in `customers/assets/race/`. Then open http://localhost:8790/customers. With `--stub`, the race runs in its demo mode: sample businesses, reviews and calendar, an in-memory store, and Meta's Conversions API answered locally. What it kept and would have sent (leads, races, emails, Meta events) is listed at http://localhost:8790/__stub. Without `--stub`, `/api/race` uses the variables in your shell.

```bash
node tests/run.mjs
```

Runs every check: the copy rules, the build, the SQL view (needs a local Postgres, otherwise skipped), the page in a real browser (a race on a phone from the search to the booking, the "not set up yet" path, the PC page) and the cookie notice on a copy built with a pixel set (both need Playwright, otherwise skipped). Screenshots of the funnel go to `tests/shots/`. The race's own checks (its numbers, its claim rules, its API, its widget) are `node ../review-race/tests/run.mjs`.

## Deploy on Vercel

Nothing to set up in Vercel: the master page's project deploys these pages with every push. Merge into `main` and the production deployment serves:

- `https://<the-site>/customers` and the three angle pages, from the repository's `customers/` folder (static files, no build step).
- `https://<the-site>/api/race`, the race's endpoint: the root `api/race.mjs`, which runs `review-race/api/race.mjs`.
- `https://<the-site>/api/race-cron`, run once a day by Vercel Cron: the race's follow-up emails and updates, and clearing old review text.

The root `vercel.json` gives the race 120 seconds and its daily job 300, schedules the job, marks the `/customers` pages and `/api/race` noindex with the security headers, caches `/customers/assets` for a year, and redirects `/meta/*` away. The root `.vercelignore` leaves out `meta/` (nothing deployed imports it) and the race's test page, tests and tools.

**Environment variables:** the race reads the master page's where they exist (`SUPABASE_URL`, `SUPABASE_ANON_KEY`, `ANTHROPIC_API_KEY`, `RESEND_API_KEY`, `LEAD_NOTIFY_FROM`, `LEAD_NOTIFY_TO`, `SLACK_WEBHOOK_URL`, `GHL_TOKEN`, `GHL_LOCATION_ID`, `LEAD_HASH_SALT`). Its own are listed in `../review-race/README.md` ("Environment variables"); the ones it can't run without are `SERPAPI_API_KEY` and `SUPABASE_SECRET_KEY` (after running `../review-race/sql/race.sql`). For Meta's Conversions API, add these to the same project (Production, and Preview to test on preview links):

| Name | What | Needed |
|---|---|---|
| `META_PIXEL_ID` | The Meta dataset (pixel) id, the same as `metaPixelId` in `content/site.mjs` | For the Conversions API |
| `META_CAPI_TOKEN` | Events Manager > your dataset > Settings > Conversions API > Generate access token | For the Conversions API |
| `META_TEST_EVENT_CODE` | Events Manager > Test events. Remove it once events show there | While testing |
| `META_GRAPH_VERSION` | Defaults to `v25.0` | Optional |

**Domain:** the pages use the master page's. Once it points at Vercel, set `url` in `content/site.mjs` to it (for example `https://rempo.io`, no path) for the canonical link and the share image, then build and commit.

**Check that Vercel has it:**

1. On GitHub, the commit (or the pull request) shows Vercel's check: "Deployment has completed". "Deployment was blocked" means Vercel refused it (see the master page's deployment settings); nothing went live.
2. In Vercel, the project > Deployments: the newest one for `main` is Ready, marked Production, with the commit you merged. Open it: under Deployment Summary, the functions list `api/race` and `api/race-cron`; the Source tab shows `customers/`.
3. Open `https://<the-site>/api/race?action=health`. `deployment` names `production` and the commit you merged (the same short hash GitHub shows). `"ready": true` once the race's keys are set and `race.sql` ran; until then `byHand` shows that the page still keeps every request (`leadsTable`) and alerts the team. Under `optional`, which parts are on, `conversionsApi` among them.
4. Open `https://<the-site>/customers` and race your own business.

Supabase: run `../review-race/sql/race.sql` once (the race's own tables: races, follow-up emails, opt-outs). The leads go to the same `public.leads` table through the same `submit_lead()`, as the forms `review-race` (a full race) and `review-race-later` (asked for by email). For a flat view of them, run [`sql/meta-leads-view.sql`](sql/meta-leads-view.sql) once in the SQL Editor (it lives in a private schema; only the dashboard can read it). It still lists the Gap Check's leads from before 2026-11-14 (`meta-gap-report`, `meta-call`).

## Meta setup

- **Pixel:** set `metaPixelId` in `content/site.mjs`, build, commit. The page then shows its cookie notice and loads the pixel only after the visitor taps Allow (`trackingConsent: "opt-in"`; never for a browser that sends Global Privacy Control, and the footer's Cookie settings reopens the notice) and fires `PageView`, the race's steps (`RaceSearchFocus`, `RaceStart`, `RacePreview` with the number of rivals and `fit`, `RaceUnlock`, `RaceResults`, `RaceLaterRequested` with the reason, `RaceBooked`, and `RaceOpened` for a button that leads to the search), `Lead` (a full race) and `Schedule` (a booked call) for trade businesses only, `FaqOpened`, and `InitiateCheckout` on the checkout link.
- **Conversions API:** set `META_PIXEL_ID` and `META_CAPI_TOKEN`. The race's server sends `Lead` and `Schedule` for trade businesses only, with the browser's event id, so Meta counts each once; never after the visitor declined or with Global Privacy Control, and never with the phone number (the privacy policy's promise to the carriers). Test with `META_TEST_EVENT_CODE` and Events Manager's Test events tab, then remove it.
- **What "qualified" means** (the course's pixel conditioning: tell Meta only about the leads you want more of): the business's Google category is a home-service trade Rempo serves (plumbing, HVAC, electrical, roofing and the like: `../review-race/api/_lib/race/fit.mjs`). Everyone else still gets the race and the call; Meta just does not learn from them.
- **Campaign:** objective Leads, conversion location Website, optimize for `Lead` at first and switch to `Schedule` once it has data. One ad set per angle or Advantage+ with all four; each ad links to its angle's page.
- **Ad URLs:** add `?utm_source=facebook&utm_medium=paid_social&utm_campaign={{campaign.name}}&utm_content={{ad.name}}`. The campaign, `fbclid` and the variant are stored with every lead.
- **Privacy:** done. The legal pages are built from `../legal-src/` and served at `/legal` (`privacyUrl` and `legal` in `content/site.mjs`). Every page's footer links them, the race's email step and its booking carry the notice at collection, and every lead and booking stores `noticeVersion`. Add `https://<the-site>/legal/privacy` as the privacy policy in Meta Business settings. See `../legal-src/README.md`.

## After a lead arrives

- The owner hears at once: an email and a Slack message with the business, the race's summary and its link. The contact is in GoHighLevel too (tag `review-race`, with a note).
- **The visitor's emails** (the race's): their race right away, then follow-ups on days 2, 5 and 9 (a case study, once `RACE_CASE_STUDY_URL` is set) and race updates on days 14 and 44, until they book or unsubscribe.
- **The call:** booked on the founder's GoHighLevel calendar (tag `race-booked`), with a team alert. GoHighLevel sends the confirmations.
- **`review-race-later`:** build the race by hand (their Google reviews next to the three shops a homeowner sees first near them) and email it within one business day.
- Mark progress in Supabase (`status`: new, contacted, qualified, won, lost, spam) or in your CRM.

## Change the words

- Page copy: `content/copy.json`. Each angle's hero: `content/variants.json`. Site settings and open decisions: `content/site.mjs`. The race's own words (the search, the race, its forms) are in `../review-race/public/race/copy.js`, and its emails in `../review-race/api/_lib/race/copy.mjs`.
- Phones (under 600 px) get their own shorter words: `leadShort` for each angle in `content/variants.json` and `race.frameShort` in `content/copy.json`, so the hero's search fits the first screen. The phone layout rules sit at the end of `src/styles/page.css`, all under `max-width:599px`; the PC page does not change. `tests/check-page.mjs` checks both.
- Then `node tools/build.mjs`. The build stops on a banned claim (`rules/copy-rules.json`, the GTM's rules: no promised reviews or rankings, no price or terms until the offer is decided, no "instant" or "automatic", no named job software, no em dashes, every statistic with its source in the same sentence).
- To add an angle: one entry in `content/variants.json` (and a `scene` the build knows: `podium`, `asked`, `unanswered` or `phone`), then build.
- The pictures come from the master page (`python3 -I tools/extract-master.py` copies them again if it changes).

## Before launch

| Decision | Until then | Where |
|---|---|---|
| The offer: price, setup fee, guarantee, terms | No price or terms anywhere; the FAQ says the call covers the numbers | `site.offer` |
| Checkout link | No "get started" link | `site.checkoutUrl` |
| Privacy notice | Done: `/legal/privacy` and the other legal pages (`../legal-src/`) | `site.privacyUrl`, `site.legal` |
| Company line and postal address | Footer shows Rempo; emails carry no address (CAN-SPAM needs one) | `site.company`, `site.postalAddress`, and `legalName`, `address` in `../legal-src/settings.mjs` |
| The founder's face and name | The founder section is hidden | `site.founder` |
| The video | Hidden | `site.vsl` |
| The call calendar | The race shows no times; the booking link if set | `GHL_CALENDAR_ID`, `GHL_BOOKING_URL` (`../review-race/README.md`) |
| The pixel and the Conversions API | No tracking | `site.metaPixelId`; `META_PIXEL_ID`, `META_CAPI_TOKEN` |
| The race's keys | The "Your business name" box; the team builds each race by hand | `SERPAPI_API_KEY`, `SUPABASE_SECRET_KEY` and the rest in `../review-race/README.md` |
| The race's emails | Off | `RACE_EMAIL_FROM`, `RACE_POSTAL_ADDRESS` |
| The domain | The master page's; no canonical until it is set | `site.url` |
