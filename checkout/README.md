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

## What is settled, and what the business gives

### Settled on our side

| What | Where | Now |
|---|---|---|
| The line under each plan's name, and what each plan includes | `PLANS` in `api/_lib/checkout/config.mjs` | Written, in the landing page's words, within the claim rules |
| The page words: headline, questions, hints, plan screen, call messages, thank-you page | `start/index.html`, `start/welcome/index.html`, `start/start.mjs` | Written |
| The renewal terms by the pay button and in Stripe's checkout | `assets/checkout-shared.mjs` | Built from the prices in Stripe |
| Setup fee and tune-up: once per order, setup waived on yearly plans | `SETTINGS` in `api/_lib/checkout/config.mjs` | As in the go-to-market offer |
| The details that fill the onboarding link | `SETTINGS.onboardingPrefill` | GoHighLevel's standard fields; checked against the form once its link is in |
| GoHighLevel tag names | `GHL_PAID_TAG`, `GHL_ABANDONED_TAG` (optional) | `rempo-paid`, `rempo-checkout-abandoned` |
| Stripe lookup keys | `PLANS[...].prices` | Fixed (table under "Stripe") |
| Stripe settings, the webhook, the Supabase SQL, the Vercel variables | The sections below | Done by whoever holds the access, once the answers are in |

### Needed from the business

These are the items in the spreadsheet shared with the business. Each answer goes here:

| Item | Where the answer goes |
|---|---|
| Plans to sell online | Stripe: prices are created only for those plans (a plan with no prices is not on sale) |
| Done For You: monthly, yearly and setup prices; the tune-up add-on | Stripe prices with the lookup keys `rempo_dfy_monthly`, `rempo_dfy_annual`, `rempo_dfy_setup`, `rempo_gbp_tuneup` |
| Engine software and 7-Day Jumpstart prices (only if sold online) | Stripe prices: `rempo_engine_*`, `rempo_jumpstart`, `rempo_reply_catchup` |
| Guarantee | `SETTINGS.guarantee` in `api/_lib/checkout/config.mjs` (none is shown until it is set) |
| Sales tax | If yes: Stripe Tax set up in Stripe, then `STRIPE_AUTOMATIC_TAX=true` in Vercel |
| Legal business name, mailing address | `legal-src/settings.mjs` (`legalName`, `address`) and `meta/content/site.mjs` (`company`, `postalAddress`), then both builds |
| Support email addresses | `legal-src/settings.mjs` (`emails`) and `SETTINGS.supportEmail` |
| Attorney review, Stripe account ready | Go-live gates: checkout opens only after both |
| Onboarding link | `ONBOARDING_URL` in Vercel |
| Sub-account ID | `GHL_LOCATION_ID` in Vercel |
| Private integration token | `GHL_TOKEN` in Vercel (Sensitive). Never in the spreadsheet or the repository |
| Onboarding automation on `rempo-paid` | Go-live gate: a test purchase must start it |
| Unfinished checkout reminder (optional) | `GHL_CUSTOM_FIELDS` in Vercel: `{"recovery_url":"<field id>"}` |

The billing portal link (`billingPortalUrl` in `legal-src/settings.mjs`) comes from Stripe once the customer portal is on.
Opening checkout: `CHECKOUT_OPEN=true` in Vercel, then "Get started" is pointed at `/start` (see "Go live").

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
| `STRIPE_AUTOMATIC_TAX` | `true` adds sales tax at checkout (Stripe Tax set up first) | if the business charges tax | same as Production | no |

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
