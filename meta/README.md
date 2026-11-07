# Rempo for Meta ads

A landing page built for one visitor: an HVAC or plumbing shop owner who tapped a Facebook or Instagram ad a few seconds ago. It turns the tap into a qualified lead with a free **Gap Check** (a few taps, a score on screen, a Gap Report by email), then into a booked 15-minute call. It is a separate site from the master page at the root of this repository, deployed as its own Vercel project, and it shares the master page's look, its Supabase table and its Resend account.

Why it is built this way, section by section, with the methodology and GTM source for each decision: [PLAN.md](PLAN.md).

## The pages

One page per ad angle, so every ad lands on a page that says what the ad said (Meta also reads the page to decide who sees the ad). Only the hero changes; the rest is shared, so a test compares one thing.

| URL | Use it with an ad that says | Headline |
|---|---|---|
| `/` | "How do your Google reviews compare with the three shops above you?" | Your work is better. Do your reviews show it? |
| `/recent` | "When did your shop get its last Google review?" | How fresh are your Google reviews? |
| `/replies` | "How many of your Google reviews have no reply?" | How many of your reviews have no reply? |
| `/request` | "Here's what your customer sees after every job." | Here's what your customer sees after every job. |

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

Then open http://localhost:8790. With `--stub`, Supabase, Resend, Slack and Meta are answered locally, and every call the server makes is listed at http://localhost:8790/__stub. Without `--stub`, `/api/lead` uses the variables in your shell.

```bash
node tests/run.mjs
```

Runs every check: the scoring against the GTM spec, the copy rules, the shared library, the endpoint, the build, the SQL view (needs a local Postgres, otherwise skipped) and the page in a real browser (needs Playwright, otherwise skipped). Screenshots of the funnel go to `tests/shots/`.

## Deploy on Vercel

1. **Add New > Project**, import this repository again (the master page stays its own project).
2. **Root Directory:** `meta`. Framework preset: Other. Build and output come from `meta/vercel.json` (`node tools/build.mjs` into `public`). Leave "Include files outside the root directory" as it is: the site needs nothing outside `meta/`.
3. **Environment variables** (Production, and Preview if you test on preview links). The first seven are the master page's, with the same values, so leads land in the same table and the same inbox:

| Name | What | Needed |
|---|---|---|
| `SUPABASE_URL` | The Supabase project URL (the master page's) | Yes |
| `SUPABASE_ANON_KEY` | The publishable key (never the secret key; it is refused) | Yes |
| `LEAD_HASH_SALT` | Any long random text, the same as the master page's | Optional |
| `RESEND_API_KEY` | The Resend key with sending access | Yes |
| `LEAD_NOTIFY_FROM` | `Rempo Leads <leads@your-domain>` | Yes |
| `LEAD_NOTIFY_TO` | Your inbox, comma separated | Yes |
| `SLACK_WEBHOOK_URL` | The Slack incoming webhook | Optional |
| `META_PIXEL_ID` | The Meta dataset (pixel) id, the same as `metaPixelId` in `content/site.mjs` | For the Conversions API |
| `META_CAPI_TOKEN` | Events Manager > your dataset > Settings > Conversions API > Generate access token | For the Conversions API |
| `META_TEST_EVENT_CODE` | Events Manager > Test events. Remove it once events show there | While testing |
| `META_GRAPH_VERSION` | Defaults to `v25.0` | Optional |
| `PROSPECT_EMAIL_FROM` | A person on the verified Resend domain: `Ali at Rempo <ali@your-domain>` | For the prospect's emails |
| `PROSPECT_REPLY_TO` | Where the prospect's replies go, if not the sender | Optional |

4. **Domain:** give it its own, for example `go.rempo.io`, then set `url` in `content/site.mjs` to it.
5. **Check:** open `https://<this-site>/api/lead`. It should say `"ready": true`, and under `meta` whether the Conversions API is on and uses the same pixel as the page. Then take the Gap Check yourself.

Supabase needs nothing new: the Meta leads go to the same `public.leads` table through the same `submit_lead()`, as the forms `meta-gap-report` and `meta-call`. For a flat view of them, run [`sql/meta-leads-view.sql`](sql/meta-leads-view.sql) once in the SQL Editor (it lives in a private schema; only the dashboard can read it).

The repository root's `.vercelignore` keeps `meta/` out of the master page's deployment; `meta/.vercelignore` is this project's own and takes precedence for it, per Vercel's documentation. If the first Meta deployment ever shows no files, remove `meta/` from the root `.vercelignore` and redeploy.

## Meta setup

- **Pixel:** set `metaPixelId` in `content/site.mjs`, build, commit. The page then loads the pixel (never for a browser that sends Global Privacy Control) and fires `PageView`, `GapCheckStart`, `GapCheckStep` (with the step number, to see drop-off question by question), `GapReportRequested` and `CallRequested` (with `fit`), `Lead` and `Schedule` (qualified answers only), and `InitiateCheckout` on the checkout link.
- **Conversions API:** set `META_PIXEL_ID` and `META_CAPI_TOKEN`. The server sends `Lead` and `Schedule` for qualified answers only, with the browser's event id, so Meta counts each once. Test with `META_TEST_EVENT_CODE` and Events Manager's Test events tab, then remove it.
- **What "qualified" means** (the course's pixel conditioning: tell Meta only about the leads you want more of): 5 or more jobs a week, and jobs recorded in job software, another CRM, or "not sure" (the GTM's ICP floor). Everyone else still gets the score, the report and the call; Meta just does not learn from them. The rules are data in `content/survey.mjs` (`fit`).
- **Campaign:** objective Leads, conversion location Website, optimize for `Lead` at first and switch to `Schedule` once it has data. One ad set per angle or Advantage+ with all four; each ad links to its angle's page.
- **Ad URLs:** add `?utm_source=facebook&utm_medium=paid_social&utm_campaign={{campaign.name}}&utm_content={{ad.name}}`. The campaign, `fbclid` and the variant are stored with every lead.
- **Privacy:** set `privacyUrl` before ads run. Meta's terms ask that a site using the pixel says so.

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

`api/_lib/lead-store.mjs`, `lead-fields.mjs` and `lead-notify.mjs` are copies of the master page's (`../api/_lib/`), so both sites store and announce leads the same way while deploying on their own. `tests/check-shared.mjs` fails if they drift; `node tools/sync-shared.mjs` copies them again.

## Before launch

| Decision | Until then | Where |
|---|---|---|
| The offer: price, setup fee, guarantee, terms | No price or terms anywhere; the FAQ says the call covers the numbers | `site.offer` |
| Checkout link | No "get started" link | `site.checkoutUrl` |
| Privacy notice | `{TBD}` in preview | `site.privacyUrl` |
| Company line and postal address | Footer shows Rempo; emails carry no address | `site.company`, `site.postalAddress` |
| The founder's face and name | The founder section is hidden | `site.founder` |
| The video | Hidden | `site.vsl` |
| Who calls, and in which windows | Morning, midday, afternoon, in the visitor's time | `content/survey.mjs`, `booking` |
| The pixel and the Conversions API | No tracking | `site.metaPixelId`; `META_PIXEL_ID`, `META_CAPI_TOKEN` |
| Prospect emails | Off | `PROSPECT_EMAIL_FROM` |
| The domain | Relative links, no canonical | `site.url` |
