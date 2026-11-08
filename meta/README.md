# Rempo for Meta ads

A landing page built for one visitor: an HVAC or plumbing shop owner who tapped a Facebook or Instagram ad a few seconds ago. It turns the tap into a qualified lead with a free **Gap Check** (a few taps, a score on screen, a Gap Report by email), then into a booked 15-minute call. It lives on the master page's domain at `/customers` and deploys with it: the master page's Vercel project serves the built pages from the repository's `customers/` folder and runs its form endpoint, `/api/meta-lead`. It shares the master page's look, its Supabase table, its Resend account and its Vercel settings.

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

1. Answers the Gap Check in the hero: trade, how they ask today, newest review, replies, against the top three, jobs a week, where jobs are recorded (all taps), then the business and town, then first name and email.
2. Sees their Review Engine score out of 100, its tier and their three biggest gaps (the GTM scorecard's own scoring), and that the Gap Report comes by email within one business day.
3. Last step: picks a weekday (the next five, never today) and a time window, and leaves a phone number for a 15-minute call. Or chooses "just email me the report".
4. Booked: add to calendar, what to expect, who to bring, and the video once recorded.

## Run it

```bash
node tools/build.mjs
```

```bash
node tools/dev.mjs --stub
```

The build writes `../customers/` (commit it: Vercel serves it as it is and runs no build). Then open http://localhost:8790/customers. With `--stub`, Supabase, Resend, Slack and Meta are answered locally, and every call the server makes is listed at http://localhost:8790/__stub. Without `--stub`, `/api/meta-lead` uses the variables in your shell.

```bash
node tests/run.mjs
```

Runs every check: the scoring against the GTM spec, the copy rules, the shared library, the endpoint, the build, the SQL view (needs a local Postgres, otherwise skipped), the page in a real browser and the cookie notice on a copy built with a pixel set (both need Playwright, otherwise skipped). Screenshots of the funnel go to `tests/shots/`.

## Deploy on Vercel

Nothing to set up in Vercel: the master page's project deploys these pages with every push. Merge into `main` and the production deployment serves:

- `https://<the-site>/customers` and the three angle pages, from the repository's `customers/` folder (static files, no build step).
- `https://<the-site>/api/meta-lead`, the form endpoint: the root `api/meta-lead.mjs`, which runs `meta/api/lead.mjs`.

The root `vercel.json` gives the function 30 seconds, marks the `/customers` pages noindex with the security headers, caches `/customers/assets` for a year, and redirects `/meta/*` away so the sources the function needs are never served as files. The root `.vercelignore` leaves out `meta/`'s tests, tools and sources that the function does not import.

**Environment variables:** the function reads the master page's (`SUPABASE_URL`, `SUPABASE_ANON_KEY`, `LEAD_HASH_SALT`, `RESEND_API_KEY`, `LEAD_NOTIFY_FROM`, `LEAD_NOTIFY_TO`, `SLACK_WEBHOOK_URL`), so leads land in the same table and the same inbox with nothing new to add. Add these to the same project when you want them (Production, and Preview to test on preview links):

| Name | What | Needed |
|---|---|---|
| `META_PIXEL_ID` | The Meta dataset (pixel) id, the same as `metaPixelId` in `content/site.mjs` | For the Conversions API |
| `META_CAPI_TOKEN` | Events Manager > your dataset > Settings > Conversions API > Generate access token | For the Conversions API |
| `META_TEST_EVENT_CODE` | Events Manager > Test events. Remove it once events show there | While testing |
| `META_GRAPH_VERSION` | Defaults to `v25.0` | Optional |
| `PROSPECT_EMAIL_FROM` | A person on the verified Resend domain: `Ali at Rempo <ali@your-domain>` | For the prospect's emails |
| `PROSPECT_REPLY_TO` | Where the prospect's replies go, if not the sender | Optional |

**Domain:** the pages use the master page's. Once it points at Vercel, set `url` in `content/site.mjs` to it (for example `https://rempo.io`, no path) for the canonical link and the share image, then build and commit.

**Check that Vercel has it:**

1. On GitHub, the commit (or the pull request) shows Vercel's check: "Deployment has completed". "Deployment was blocked" means Vercel refused it (see the master page's deployment settings); nothing went live.
2. In Vercel, the project > Deployments: the newest one for `main` is Ready, marked Production, with the commit you merged. Open it: under Deployment Summary, the functions list `api/meta-lead`; the Source tab shows `customers/`.
3. Open `https://<the-site>/api/meta-lead`. It should say `"ready": true`, and `deployment` names `production` and the commit you merged (the same short hash GitHub shows). Under `meta`, whether the Conversions API is on and uses the same pixel as the page.
4. Open `https://<the-site>/customers` and take the Gap Check yourself.

Supabase needs nothing new: the Meta leads go to the same `public.leads` table through the same `submit_lead()`, as the forms `meta-gap-report` and `meta-call`. For a flat view of them, run [`sql/meta-leads-view.sql`](sql/meta-leads-view.sql) once in the SQL Editor (it lives in a private schema; only the dashboard can read it).

## Meta setup

- **Pixel:** set `metaPixelId` in `content/site.mjs`, build, commit. The page then shows its cookie notice and loads the pixel only after the visitor taps Allow (`trackingConsent: "opt-in"`; never for a browser that sends Global Privacy Control, and the footer's Cookie settings reopens the notice) and fires `PageView`, `GapCheckStart`, `GapCheckStep` (with the step number, to see drop-off question by question), `GapReportRequested` and `CallRequested` (with `fit`), `Lead` and `Schedule` (qualified answers only), and `InitiateCheckout` on the checkout link.
- **Conversions API:** set `META_PIXEL_ID` and `META_CAPI_TOKEN`. The server sends `Lead` and `Schedule` for qualified answers only, with the browser's event id, so Meta counts each once; never after the visitor declined or with Global Privacy Control, and never with the phone number (the privacy policy's promise to the carriers). Test with `META_TEST_EVENT_CODE` and Events Manager's Test events tab, then remove it.
- **What "qualified" means** (the course's pixel conditioning: tell Meta only about the leads you want more of): 5 or more jobs a week, and jobs recorded in job software, another CRM, or "not sure" (the GTM's ICP floor). Everyone else still gets the score, the report and the call; Meta just does not learn from them. The rules are data in `content/survey.mjs` (`fit`).
- **Campaign:** objective Leads, conversion location Website, optimize for `Lead` at first and switch to `Schedule` once it has data. One ad set per angle or Advantage+ with all four; each ad links to its angle's page.
- **Ad URLs:** add `?utm_source=facebook&utm_medium=paid_social&utm_campaign={{campaign.name}}&utm_content={{ad.name}}`. The campaign, `fbclid` and the variant are stored with every lead.
- **Privacy:** done. The legal pages are built from `../legal-src/` and served at `/legal` (`privacyUrl` and `legal` in `content/site.mjs`). Every page's footer links them, the Gap Check and the call step carry the notice at collection, and every lead stores `noticeVersion`. Add `https://<the-site>/legal/privacy` as the privacy policy in Meta Business settings. See `../legal-src/README.md`.

## After a lead arrives

- The owner hears at once: an email and a Slack message with the answers, the score, the tier, the fit, the variant and the campaign.
- **The Gap Report:** promised within one business day. Build it from the business name, city and trade in the lead (the GTM's Gap Report template), and send it.
- **The call:** `meta-call` leads carry the day, the window and the time zone. Call in the window. The prospect's email asked them to reply YES; a reply is the best sign they will pick up.
- Mark progress in Supabase (`status`: new, contacted, qualified, won, lost, spam) or in your CRM.

## Change the words

- Page copy: `content/copy.json`. Each angle's hero: `content/variants.json`. The questions, scoring and call windows: `content/survey.mjs`. The prospect's emails: `content/emails.mjs`. Site settings and open decisions: `content/site.mjs`.
- Then `node tools/build.mjs`. The build stops on a banned claim (`rules/copy-rules.json`, the GTM's rules: no promised reviews or rankings, no price or terms until the offer is decided, no "instant" or "automatic", no named job software, no em dashes, every statistic with its source in the same sentence).
- To add an angle: one entry in `content/variants.json` (and a `scene` the build knows: `podium`, `asked`, `unanswered` or `phone`), then build.
- The pictures come from the master page (`python3 -I tools/extract-master.py` copies them again if it changes).

## Shared with the master page

`api/_lib/lead-store.mjs`, `lead-fields.mjs` and `lead-notify.mjs` are copies of the master page's (`../api/_lib/`), so both pages store and announce leads the same way. `tests/check-shared.mjs` fails if they drift; `node tools/sync-shared.mjs` copies them again.

## Before launch

| Decision | Until then | Where |
|---|---|---|
| The offer: price, setup fee, guarantee, terms | No price or terms anywhere; the FAQ says the call covers the numbers | `site.offer` |
| Checkout link | No "get started" link | `site.checkoutUrl` |
| Privacy notice | Done: `/legal/privacy` and the other legal pages (`../legal-src/`) | `site.privacyUrl`, `site.legal` |
| Company line and postal address | Footer shows Rempo; emails carry no address (CAN-SPAM needs one) | `site.company`, `site.postalAddress`, and `legalName`, `address` in `../legal-src/settings.mjs` |
| The founder's face and name | The founder section is hidden | `site.founder` |
| The video | Hidden | `site.vsl` |
| Who calls, and in which windows | Morning, midday, afternoon, in the visitor's time | `content/survey.mjs`, `booking` |
| The pixel and the Conversions API | No tracking | `site.metaPixelId`; `META_PIXEL_ID`, `META_CAPI_TOKEN` |
| Prospect emails | Off | `PROSPECT_EMAIL_FROM` |
| The domain | The master page's; no canonical until it is set | `site.url` |
