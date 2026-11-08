# Lead capture: Rempo

Every form on this site sends its leads to `/api/lead`, a Vercel Function in this repository (`api/lead.mjs`). Each lead is stored in Supabase and announced at once by email (Resend, to your inbox) and in Slack. Set up on 2026-11-06 with the landing-page-lead-capture skill.

```
visitor's form ──POST──▶ /api/lead ──▶ Supabase: public.submit_lead() ──▶ table public.leads
                              ├──▶ Resend ──▶ email to LEAD_NOTIFY_TO (Reply goes to the visitor)
                              └──▶ Slack incoming webhook ──▶ your channel
If Supabase fails, the email and Slack message still go, marked NOT SAVED, saying why and which deployment sent them.
Health report: https://<your-site>/api/lead (what this deployment sees, and what to fix)
```

## What was done (by the agent)

This repository holds the landing page as one self-contained file, `index.html`, served from the repository root with no build step. Its original source in the GTM build repository is not used here, so `index.html` is where the page is changed.

**Added by the kit** (`scripts/install.mjs`, site "Rempo", consent required):
- `api/lead.mjs` (the endpoint and health report), `api/_lib/lead-store.mjs`, `lead-fields.mjs`, `lead-notify.mjs`
- `lead-capture/leads.sql`, `lead-capture/lead-form.js` (not used: the page's own script sends the form), `lead-capture/tests/`
- `vercel.json`: `api/lead.mjs` gets 30 s. `.vercelignore`: `lead-capture/` is never served. `.gitignore`: `.env`, `.env*.local`, `.vercel`

**Three ways forward, two forms** (both posted by the page's own script to `SITE.formEndpoint`, which is `"/api/lead"`):
- **Get started** (`data-cta="buy"`: the header, the hero, after the done-for-you, comparison and starting sections, the close, the phone bar and the footer) goes to Stripe's checkout at `SITE.checkoutUrl` in `index.html`. Until that is set, it opens the call form. It carries the campaign (`utm_*`) and this visit's id as `client_reference_id`.
- **Book a 15-minute call** (`data-cta="try"`) opens `#form`, sent as the lead `book-call`. Its fields are `trade`, `techs`, `locations`, `firstName`, `company`, `phone` (required), `city`, `email` (optional), `bestTime`, `consentPhone` (required), `consentEmail`. Its bot trap is named `website`; the page drops a filled one before sending, and the endpoint stores it as an ordinary field.
- **The scorecard** (`data-cta="score"`) goes to the section `#scorecard`. Its request form `#score-form` is sent as the lead `scorecard`, with `trade`, `company`, `city`, `firstName`, `email` (required), `phone` (optional), `consentEmail` (required). Its bot trap is `hp`. Once `SITE.scorecardUrl` points at the scorecard itself, every scorecard link goes there and the request form steps aside.
- Both leads also carry `page`, any `utm_*`, `src`, `p` and `e` from the link, and `visit`: the same id Stripe receives as `client_reference_id`. That lets a purchase be matched later to the leads of the same visit.
- How they are stored: `firstName` goes to `name`, `company`, `phone` and `email` to their columns, the consent boxes to `consent`, and the page and campaign values to `meta`. Everything else goes to `fields`: trade, technicians, locations, city, best time, visit. `form` says which one it was.
- The page ignores any send in the first 3 seconds after its script starts (a bot check). It shows an error and lets the visitor send again when `/api/lead` answers with an error. Sending the call form always shows its step 2, where the thank-you and any error appear.
- The database needs nothing new for these: `public.leads` keeps each form apart by `form`. To list one kind: `select created_at, name, email, phone, company, fields from public.leads where form = 'scorecard' order by created_at desc;`

**Tests**, run from the repository root:
- `check-api.mjs`: 55 passed, 0 failed.
- `check-db.mjs`: 20 passed, 0 failed. It used a local Postgres and fetched PostgREST v12.2.12 once.
- `check-forms.mjs --wait 6000`: 13 passed, 0 failed, 0 warnings, for both forms. The default `--wait 3200` counts from before the page opens. This page is about 1 MB, so its script starts later than that and it ignored the send as a bot. `--wait 6000` gives it its full 3 seconds.
- The page's own tests (kept outside this repository, with a stand-in for `/api/lead`), each at phone and desktop width:
  - The call form: 28 passed.
  - The three ways forward: 28 passed. They cover Get started with and without a checkout link, the scorecard request (empty, sent, failed) and the scorecard address.
  - The rest of the page (theme, menu, questions, comparison): 11 passed.
  - An accessibility scan in light and dark, with both forms showing their errors: no WCAG A/AA issue.
- `check-live.mjs` was not run: it needs the deployed site with your keys set.

**Branch**: committed and pushed to `claude/dreamy-franklin-5ksbo2`. `main` has the earlier design pass (pull request #1) but not the rebuilt form or this lead capture. Merge this branch into `main`, or set Vercel's production branch to it, before the live site can capture leads.

## What you do (once, about 20 minutes)

### 1. Supabase: the database
1. [supabase.com](https://supabase.com) > **New project**. Pick the region nearest your visitors.
2. **SQL Editor** > **New query** > paste all of [`leads.sql`](leads.sql) > **Run**. Expect "Success. No rows returned". It is safe to run again. If it stops with "public.leads already exists and was not created by lead capture", that project already has a leads table: use a new project, or rename the old table as the message says.
3. **Project Settings > Data API**: copy the **Project URL**. That is `SUPABASE_URL`.
4. **Project Settings > API Keys**: copy the **publishable key** (`sb_publishable_...`; on older projects, the `anon` key). That is `SUPABASE_ANON_KEY`. Never the secret or `service_role` key: the site refuses it.

### 2. Resend: the email
1. [resend.com](https://resend.com) > **Domains** > **Add domain**: your site's domain. Add the DNS records it lists where your domain's DNS is managed (Vercel > Settings > Domains, if Vercel holds it). Wait for **Verified**.
2. **API Keys** > **Create API key**, permission **Sending access**. That is `RESEND_API_KEY`.
3. The sender, on that domain: `Rempo Leads <leads@your-domain>` is `LEAD_NOTIFY_FROM`. Your inbox is `LEAD_NOTIFY_TO`.

Until the domain is verified, Resend only sends from `onboarding@resend.dev`, and only to the address you signed up with.

### 3. Slack: the message
1. [api.slack.com/apps](https://api.slack.com/apps) > **Create New App** > **From scratch** > your workspace.
2. **Incoming Webhooks** > turn it **On** > **Add New Webhook** > choose the channel (for example `#leads`). Copy the URL: that is `SLACK_WEBHOOK_URL`.

### 4. Vercel: the keys
**Project > Settings > Environment Variables**. Add each one for **Production**, and for **Preview** too if you test on preview links (their leads go to the same table). Mark the secrets **Sensitive**.

| Name | Example value | Where it comes from | Secret |
|---|---|---|---|
| `SUPABASE_URL` | `https://abcdefghijklmnop.supabase.co` | Supabase > Project Settings > Data API | no |
| `SUPABASE_ANON_KEY` | `sb_publishable_...` | Supabase > Project Settings > API Keys: the **publishable** key | no |
| `LEAD_HASH_SALT` | any long random text | you (a password generator); optional | yes |
| `RESEND_API_KEY` | `re_...` | Resend > API Keys | yes |
| `LEAD_NOTIFY_FROM` | `Rempo Leads <leads@your-domain>` | an address on your verified Resend domain | no |
| `LEAD_NOTIFY_TO` | `you@gmail.com` | your inbox; several, comma separated | no |
| `SLACK_WEBHOOK_URL` | `https://hooks.slack.com/services/...` | Slack > your app > Incoming Webhooks | yes |

Then:
- **Settings > Environments > Production**: the production branch must be the branch that holds this work (usually `main`), and your domain must point at Production.
- **Deployments** > the latest > **Redeploy**. A deployment only sees the variables that existed when it was built.

### 5. Check it
1. Open `https://<your-site>/api/lead`. It should say `"ready": true`, with the database, the email and Slack each OK. Anything not OK comes with its fix. Check the deployment it names is the one you meant.
2. Send the form on the live site with your own email. Within seconds: a row in **Supabase > Table Editor > leads**, an email in your inbox, a message in Slack.
3. In Gmail: a filter on `from:(leads@your-domain)` > **Never send it to Spam** and **Mark it as important**.

## Checklist

### Done by the agent
- [x] Preflight: GO, after merging `origin/main` (pull request #1) into the branch. Warnings noted above: the newest work is on this branch, not `main`, and the bot trap is named `website`
- [x] Kit installed: `api/lead.mjs`, `api/_lib/`, `lead-capture/`, `vercel.json`, `.vercelignore`, `.gitignore` (`install.mjs --site "Rempo" --require-consent`)
- [x] Both forms wired: `SITE.formEndpoint` set to `/api/lead`, the leads named `book-call` and `scorecard`
- [x] check-api: 55 passed
- [x] check-db: 20 passed
- [x] check-forms: 13 passed, 0 warnings (`--wait 6000`), both forms
- [x] The page's own tests: the call form 28, the three ways forward 28, the rest of the page 11; the accessibility scan clean
- [ ] check-live: not run, it needs the deployed site with your keys set
- [x] Committed and pushed to `claude/dreamy-franklin-5ksbo2` (not yet in `main`)

### Yours
- [ ] Supabase project created and `lead-capture/leads.sql` run
- [ ] Your Stripe Payment Link set as `SITE.checkoutUrl` in `index.html` (until then, Get started opens the call form)
- [ ] `SUPABASE_URL` and the **publishable** `SUPABASE_ANON_KEY` copied
- [ ] Resend domain verified and an API key created
- [ ] Slack incoming webhook created for the channel
- [ ] The variables added in Vercel (Production, and Preview if wanted), the secrets marked Sensitive
- [ ] Production branch checked and the project redeployed
- [ ] `https://<your-site>/api/lead` says `"ready": true`
- [ ] A real test lead seen in Supabase, in your inbox and in Slack
- [x] The privacy notice says what the form collects and who processes it (Supabase stores it; Resend and Slack deliver it): `/legal/privacy`, built from `legal-src/`; both forms carry the notice at collection and send `noticeVersion`

## If something is off

| What you see | What it means | Fix |
|---|---|---|
| An email or Slack message marked **NOT SAVED** | The lead reached you but not the database. The message says why and which deployment sent it | Do what it says, redeploy, send a test lead again |
| `/api/lead`: `this deployment cannot see SUPABASE_URL...` | The variable is missing for this deployment's environment | Add it for that environment (a Preview deployment sees only Preview variables), redeploy |
| `/api/lead`: `holds a secret key` | `SUPABASE_ANON_KEY` has the secret or service_role key | Use the publishable key, redeploy |
| `/api/lead`: `HTTP 404 ... run lead-capture/leads.sql` | The SQL was not run in the project `SUPABASE_URL` points at | Run it there (check the project URL matches) |
| `/api/lead`: `HTTP 401 ... the key was refused` | The key belongs to another project, or was rotated | Copy the publishable key of this project again |
| `/api/lead`: `HTTP 5xx ... paused` | Supabase is down or the free project paused after a quiet week | Supabase > the project > Restore |
| No email, Slack fine | Resend refused: unverified domain, or the sender is not on it | Resend > Logs says why; check `LEAD_NOTIFY_FROM` is on the verified domain |
| No Slack, email fine | The webhook was removed or the URL is wrong | Create a new webhook, update `SLACK_WEBHOOK_URL`, redeploy |
| The form says it did not send | Nothing worked: no database and no notice | Open `/api/lead` on that deployment and fix what it lists |
| `/api/lead` is a 404 | The deployment does not have `api/lead.mjs` | Deploy the branch with this work; the project's root must be the folder that holds `api/` |
| 429 "Too many submissions" | The rate limit: 5 an hour per email, 20 per network | Wait an hour, or test with another email |

## Run the checks again
```sh
node lead-capture/tests/check-api.mjs     # the endpoint, everything stubbed
node lead-capture/tests/check-db.mjs      # leads.sql in a local Postgres + PostgREST (needs Postgres installed)
node lead-capture/tests/check-forms.mjs   # every form in a real browser (needs Playwright; build the site first)
node lead-capture/tests/check-live.mjs https://<your-site>   # the live deployment, after the keys are set
```

Read your leads: **Supabase > Table Editor > leads**. Set `status` (new, contacted, qualified, won, lost, spam) and `notes` there. Never edit the built page to change the form: change its sources and rebuild.

## The Meta ads site shares this table

`meta/` is Rempo's landing page for Meta ads, served by this same Vercel project at `/customers` (built into `customers/`), with its own endpoint, `/api/meta-lead` (`api/meta-lead.mjs`). It sends its leads to the same Supabase table through the same `public.submit_lead()`, with two form names: `meta-gap-report` (the Gap Check: answers, score, tier, fit) and `meta-call` (the call step: day, time window, phone). It reads this page's seven variables, plus its own optional Meta and prospect-email settings. Nothing in this guide changes. Setup and operations: [`meta/README.md`](../meta/README.md); an optional flat view of its leads: `meta/sql/meta-leads-view.sql`.

To list them: `select created_at, form, name, email, company, fields->>'score' as score, fields->>'fit' as fit from public.leads where form like 'meta-%' order by created_at desc;`
