# Checkout: Rempo's self-serve purchase

A buyer answers three questions on `/start`, sees their plan and its price, pays in Stripe's checkout, lands on
`/start/welcome` with the founder's onboarding link right there, and within seconds is a tagged contact in the founder's
GoHighLevel, which starts the founder's onboarding workflow. What happens in GoHighLevel after that tag is the founder's.

```
/start ──POST──▶ /api/checkout ──▶ Supabase: the lead "checkout-start" (best effort)
                       └──▶ Stripe: a Checkout Session (prices read from Stripe by lookup key) ──▶ the buyer pays
Stripe ──redirect──▶ /start/welcome ──▶ /api/checkout?session_id=... ──▶ "You're in" + the onboarding link, filled in
Stripe ──webhook──▶ /api/stripe-webhook ──▶ Supabase: public.purchases (once per session)
                       ├──▶ GoHighLevel: contact upserted, tag rempo-paid (+ plan tags), a note with the order
                       └──▶ the team: email (Resend) and Slack
An unpaid checkout expires after an hour: if the buyer agreed to email, GoHighLevel gets the contact with the tag
rempo-checkout-abandoned and Stripe's recovery link, for the founder's follow-up.
Health report: https://<the-site>/api/checkout?health=1
```

**Closed until it is opened.** With a live Stripe key, no checkout opens until `CHECKOUT_OPEN=true`. With a test key it
always works, so the whole path can be tried with Stripe's test cards. The landing page's "Get started" buttons keep
opening the call form until they are switched to `/start` (see "Go live").

## Placeholders (TBD): what to give, and where it goes

| # | Placeholder | Where it lives | Until it is set | What to give |
|---|---|---|---|---|
| 1 | The plans and their prices | Stripe, by lookup key (table below) | No plan on sale: `/start` says online checkout opens soon | Create the prices in Stripe (or give a test key and I create the test ones) |
| 2 | The onboarding link | `ONBOARDING_URL` in Vercel | The thank-you page says the team will email the link | The founder's GoHighLevel onboarding form, survey or calendar link |
| 3 | Which details fill the onboarding link | `SETTINGS.onboardingPrefill` in `api/_lib/checkout/config.mjs` | `first_name`, `email`, `phone`, `company_name` are added to the link | Confirm the founder's form reads these names, or tell me its names |
| 4 | The guarantee line | `SETTINGS.guarantee` in `api/_lib/checkout/config.mjs` | No guarantee is shown anywhere | The exact sentence, once settled with counsel |
| 5 | Setup fee and add-on per order or per Google profile | `SETTINGS.setupPerProfile`, `SETTINGS.bumpPerProfile` | Once per order | Your decision |
| 6 | The line under each plan's name | `PLANS[...].blurb` in `api/_lib/checkout/config.mjs` | The landing page's own words (Done For You); short neutral lines (the others) | Final lines from the marketing session |
| 7 | Page words: headline, questions, thank-you text | `start/index.html`, `start/welcome/index.html` | Plain working copy | Final copy from the marketing session |
| 8 | GoHighLevel tag names | `GHL_PAID_TAG`, `GHL_ABANDONED_TAG` in Vercel | `rempo-paid`, `rempo-checkout-abandoned` | Only if the founder wants other names |
| 9 | GoHighLevel custom fields | `GHL_CUSTOM_FIELDS` in Vercel (JSON) | Details go in a note on the contact; no field is filled | The ids of the fields to fill, for example the recovery link for the abandoned email |
| 10 | The billing portal link | `billingPortalUrl` in `legal-src/settings.mjs` | The billing policy says to cancel by email | Stripe's customer portal link, once it is turned on |
| 11 | Legal facts | `legal-src/settings.mjs`, see `legal-src/README.md` "Before launch" | The legal pages name "Rempo" and no address | The legal entity name, the mailing address, the attorney review |
| 12 | Go live | `CHECKOUT_OPEN` in Vercel, and the "Get started" switch | Closed with a live key; "Get started" opens the call form | Say "open checkout" once the health report says ready |

## Stripe

**1. The prices, with these lookup keys.** Create each product and price in Stripe (test mode first, then the same in live
mode), and give each price its lookup key (in the price's details). A plan whose main price is missing is simply not on
sale, and its buyers go to the call. To change a price later, create the new price and move the lookup key to it: no
code changes.

| Plan (the answers that lead to it) | Price | Type | Lookup key |
|---|---|---|---|
| Done For You ("Handle it for me") | per Google profile, monthly | recurring, every month | `rempo_dfy_monthly` |
| | per Google profile, yearly (shown only if it exists) | recurring, every year | `rempo_dfy_annual` |
| | setup fee (charged with monthly, waived on yearly) | one-time | `rempo_dfy_setup` |
| | GBP Tune-Up, offered as an optional add-on at checkout | one-time | `rempo_gbp_tuneup` |
| Engine software ("Someone in my office") | monthly / yearly / setup | as above | `rempo_engine_monthly`, `rempo_engine_annual`, `rempo_engine_setup` |
| 7-Day Jumpstart (no software, or "Not sure yet") | one payment | one-time | `rempo_jumpstart` |
| | Reply Catch-Up, optional add-on | one-time | `rempo_reply_catchup` |

3 or more Google profiles, or "not sure" about the software, always go to the 15-minute call.

**2. Settings** (Stripe Dashboard):
- **Public details:** Terms of service URL `https://rempo.io/legal/terms`. Required: checkout asks buyers to accept the
  terms, and Stripe refuses to open a checkout without this address.
- **Customer emails:** receipts for successful payments on (they are the order acknowledgment); failed payment emails on.
- **Revenue recovery:** Smart Retries on. For yearly plans, upcoming renewal emails 30 days before (the billing policy
  promises 15 to 45 days).
- **Customer portal:** on, with cancel at the end of the period, update payment method, invoice history. Send me its link
  (placeholder 10).

**3. The webhook.** Developers > Webhooks > Add endpoint: `https://rempo.io/api/stripe-webhook`, events
`checkout.session.completed`, `checkout.session.async_payment_succeeded`, `checkout.session.expired`. Its signing
secret (`whsec_...`) is `STRIPE_WEBHOOK_SECRET`. Make one endpoint in test mode and one in live mode: each has its own
secret.

## GoHighLevel (the founder's side)

1. **The sub-account that receives buyers** (Rempo's own). Its id is `GHL_LOCATION_ID`.
2. **A Private Integration** in that sub-account (Settings > Private Integrations), with access to view and edit
   contacts. Its token (`pit-...`) is `GHL_TOKEN`.
3. **The workflow:** trigger "Contact Tag added: `rempo-paid`", and the first step sends the onboarding email or text
   with no wait before it. Every purchase also gets `rempo-plan-<plan>`, `rempo-billing-<monthly|annual|once>`,
   `rempo-profiles-<n>`, and `rempo-email-ok` / `rempo-texts-ok` when the buyer ticked those boxes. Test-mode
   purchases also get `rempo-test-mode`. A note on the contact holds the whole order.
4. **Abandoned checkouts** (optional): a workflow on `rempo-checkout-abandoned` that emails the recovery link. For the
   email to include the link, create a contact custom field for it and set `GHL_CUSTOM_FIELDS` to
   `{"recovery_url":"<its field id>"}`. End that workflow when `rempo-paid` is added.

## Supabase

Run `checkout/checkout.sql` once in the same project as the leads (SQL Editor > New query > paste > Run; safe to run
again). Copy a **secret** key (Project Settings > API Keys > Secret keys, `sb_secret_...`): that is `SUPABASE_SECRET_KEY`.
Only the two checkout functions use it; the lead forms keep the publishable key.

## Vercel: the environment variables

Project > Settings > Environment Variables. Use **test** keys for **Preview** and **live** keys for **Production**, never a
live key on Preview. Mark the secrets **Sensitive**, then redeploy.

| Name | Example | Production | Preview | Secret |
|---|---|---|---|---|
| `STRIPE_SECRET_KEY` | `sk_live_...` / `sk_test_...` (a restricted `rk_` key works) | live | test | yes |
| `STRIPE_WEBHOOK_SECRET` | `whsec_...` of the endpoint in the same mode | live endpoint's | test endpoint's | yes |
| `CHECKOUT_OPEN` | `true` | at launch | not needed | no |
| `SUPABASE_SECRET_KEY` | `sb_secret_...` | yes | yes (or a separate test project) | yes |
| `GHL_TOKEN` | `pit-...` | yes | yes | yes |
| `GHL_LOCATION_ID` | the sub-account id | yes | yes | no |
| `ONBOARDING_URL` | `https://...` the founder's onboarding link | yes | yes | no |
| `GHL_CUSTOM_FIELDS` | `{"recovery_url":"<field id>"}` | optional | optional | no |
| `GHL_PAID_TAG`, `GHL_ABANDONED_TAG` | other tag names | optional | optional | no |
| `STRIPE_API_VERSION` | pins Stripe's API version | optional | optional | no |

Already set for the lead forms and reused here: `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `RESEND_API_KEY`,
`LEAD_NOTIFY_FROM`, `LEAD_NOTIFY_TO`, `SLACK_WEBHOOK_URL`.

## Try it (test mode)

1. Set the test variables for Preview (or Production while closed), redeploy, open `/api/checkout?health=1`: fix what it lists until `"ready": true`.
2. Open `/start`, answer, pay with card `4242 4242 4242 4242`, any future date, any CVC.
3. Expect: the thank-you page with the onboarding link; a contact in GoHighLevel tagged `rempo-paid` and `rempo-test-mode`
   with the order in a note; a `[TEST]` email and Slack message; a row in Supabase > `purchases`.
4. Abandoned: open a checkout with the email box ticked and close it. About an hour later the contact gets
   `rempo-checkout-abandoned` and the recovery link.

## Go live

1. The same prices in live mode, with the same lookup keys; the live webhook endpoint and its secret in Production.
2. Production gets the live `STRIPE_SECRET_KEY`; the health report says `"ready": true`.
3. The legal items (placeholders 10 and 11).
4. `CHECKOUT_OPEN=true` in Production, redeploy.
5. Tell me "open checkout": I point "Get started" at `/start` on the landing page (`SITE.checkoutUrl` in `index.html`)
   and the Meta page (`checkoutUrl` in `meta/content/site.mjs`, then its build), and merge it.

## If something is off

| What you see | What it means | Fix |
|---|---|---|
| `/start` says online checkout opens soon | No key, a live key without `CHECKOUT_OPEN`, or no price with the lookup keys | Open `/api/checkout?health=1` and do what it lists |
| "Checkout could not open" | Stripe refused the session; the function log says why | Most often: the Terms of service URL is not set in Stripe's public details |
| Slack and email say NOT IN GOHIGHLEVEL YET | Paid, but GoHighLevel refused or was not reachable; Stripe retries for up to 3 days | Do what the message says (token, location id); the next retry hands the buyer off and sends the all-clear |
| Supabase NOT SAVED in the purchase email | `SUPABASE_SECRET_KEY` missing, or `checkout.sql` not run | Set the key or run the SQL; the buyer still reached GoHighLevel |
| The webhook shows 400 in Stripe | The signing secret does not match the endpoint (test and live have different secrets) | Copy the right `whsec_` into `STRIPE_WEBHOOK_SECRET`, redeploy |
| The webhook shows 503 in Stripe | `STRIPE_WEBHOOK_SECRET` is not set | Set it, redeploy; Stripe sends the waiting events again |

## Checks

`npm test` runs `tests/unit/checkout.test.mjs` (every service stubbed) and the owner decision for the checkout.
`node checkout/tests/check-sql.mjs` runs `checkout.sql` in a local Postgres.

## On purpose, not built here

- The onboarding itself: the founder's GoHighLevel workflow, forms and calls.
- Stripe's embedded checkout on rempo.io: version 1 uses Stripe's own checkout page, the simplest and best tested path.
  Embedding it is a later, small change.
- A Meta Purchase event: it needs the tracking-consent decision for the landing page first.
