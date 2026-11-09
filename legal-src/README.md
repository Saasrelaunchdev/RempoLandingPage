# Rempo's legal pages

Rempo's terms, policies, and agreements, written for how Rempo actually works: a done-for-you Google review service for businesses, sold online by subscription, delivered on HighLevel, with ad landing pages that use Meta's tools. Drafted on 2026-11-08 for a founder operating from San Diego, California.

**These are drafts by an AI, not a lawyer.** They are built on current law and platform rules (sources below) and fitted to this repository's code, but have a California attorney review them before checkout goes live, and fill in the facts marked below. Nothing here is legal advice.

## The pages

Built into the repository's `legal/` folder and served at `/legal` by the master page's Vercel project. Every page has the site's look, light and dark themes, a table of contents, and print styles.

| Address | Document | For |
|---|---|---|
| `/legal` | Legal center: every document, grouped, with contacts | Everyone |
| `/legal/terms` | Terms of Service: website, free tools, and the paid services (no guaranteed results, compliance split, AI, ownership, fees and renewal, cancellation, warranties, indemnities, liability cap, arbitration in San Diego County, California law) | Everyone |
| `/legal/privacy` | Privacy Policy: CCPA notice at collection and CalOPPA policy, the 10DLC mobile-number statement, sale and sharing (Meta), rights, financial incentive notice, retention, client customers, cold outreach | Everyone |
| `/legal/cookies` | Cookie and Tracking Notice: every storage item, the pixel, the Conversions API, Clarity, how to opt out (Meta's required explanation) | Everyone |
| `/legal/privacy-choices` | Your Privacy Choices: "Do Not Sell or Share My Personal Information", a working opt-out, Global Privacy Control status | Everyone |
| `/legal/sms` | SMS and Messaging Terms: Rempo's own texts, client review-request texts, STOP and HELP, model consent wording for clients | Everyone |
| `/legal/accessibility` | Accessibility Statement | Everyone |
| `/legal/acceptable-use` | Acceptable Use and Review Integrity Policy: Google's rules, the FTC review rule, texting rules, AI rules | Clients |
| `/legal/dpa` | Data Processing Addendum, with the CCPA service provider terms | Clients |
| `/legal/baa` | HIPAA Business Associate Agreement | Healthcare clients |
| `/legal/subprocessors` | Subprocessors and service providers | Clients |
| `/legal/billing` | Billing, Renewal, and Cancellation Policy | Clients |

Short addresses redirect to them (for ad platforms, carrier vetting, and print): `/privacy`, `/privacy-policy`, `/terms`, `/terms-of-service`, `/cookies`, `/sms`, `/sms-terms`, `/do-not-sell`, `/privacy-choices`, `/accessibility`.

## Change a document

1. Edit the Markdown in `docs/` (or a fact in `settings.mjs`).
2. Build: `node legal-src/tools/build.mjs`
3. Test: `node legal-src/tests/check-legal.mjs`
4. Commit `legal-src/` and `legal/` together.

The build stops on an unknown `{{placeholder}}`, an em or en dash, or a link to a page or section that doesn't exist. Add `?view=preview` to any `/legal` page to see which facts are still missing. When a document's meaning changes, change `updated` in `settings.mjs`. When consent wording on a form changes, change `noticeVersion` in `settings.mjs`, `meta/content/site.mjs`, and the two `data.noticeVersion` lines in `index.html` (the test fails until all agree): every lead stores the version it agreed to, so the wording a person saw can always be proved from git history.

## Where each piece sits in the funnel

The research behind these placements is listed under Sources.

| Where | What is there now | Why |
|---|---|---|
| Every page's footer (master page, the four Meta pages, the legal pages) | Terms, Privacy, Cookies, SMS terms, Accessibility, Legal center, and "Do Not Sell or Share My Personal Information" | CalOPPA requires a conspicuous privacy policy link; the CCPA requires the opt-out link on every page if it applies; Meta's terms require the pixel notice to be reachable from every page that uses it |
| Right above each form's submit button (scorecard, call form, Gap Check, call step) | "By tapping [the button's own words], you agree to our Terms of Service and acknowledge our Privacy Policy..." with underlined links opening in a new tab; on the Meta page also what Meta hears and a link to opt out | CCPA notice at collection at the point of collection. Ninth Circuit sign-in wrap rulings (Berman, Godun, Chabolla) enforce terms only when the notice is conspicuous, next to the button, and names the action that signals agreement |
| Consent boxes on the forms | Unticked, one purpose each, in Rempo's name: call (required to book a call, for that number), email (scorecard and report), text (optional, with sender, purpose, "up to 3 texts", rates, STOP, HELP, "not required", and the SMS terms and privacy links beside it) | Carrier (A2P 10DLC) vetting rejects pre-ticked, bundled, or required text consent; a written agreement to be called at a given number is the TCPA's do-not-call exemption |
| A cookie notice on the Meta pages | Shown only when a pixel or Clarity id is set. Opt-in: nothing loads until Allow; Allow and Decline look the same; Global Privacy Control hides it and keeps everything off; "Cookie settings" in the footer reopens it | SB 690 (signed 2026-09-30) ended private pen-register suits, but CIPA section 631 wiretap suits over pixels and session replay continue; consent before loading is the defense. CCPA regulations require symmetric choices and treat closing a banner as no consent |
| The server (Meta Conversions API) | Sends only for qualified leads, never after Decline or with GPC, never the phone number | CCPA opt-out of sharing applies server-side too; the privacy policy's 10DLC promise that mobile numbers aren't shared for marketing |
| Prospect emails | Unsubscribe line and privacy policy link; the postal address once `site.postalAddress` is set | CAN-SPAM |
| Checkout (not built yet) | See "Before launch" below | ROSCA and California's automatic renewal law (express consent, clear terms by the button, online cancellation) |

## Before launch: what the founder does

**Must do before checkout or ads go live:**

- [ ] **Form the business entity** (an LLC or corporation) if Rempo is not one yet, and put its exact name in `settings.legalName` (for example "Rempo LLC, a California limited liability company") and in `meta/content/site.mjs` (`company`). Contracts and liability protection depend on it. If operating under the name "Rempo" without an entity, a fictitious business name statement must be filed in San Diego County. The City of San Diego also requires a business tax certificate.
- [ ] **A mailing address** for notices and email (a PO box or a commercial mail receiving agency is fine): `settings.address` and `meta/content/site.mjs` (`postalAddress`). Until it is set, commercial emails lack the address CAN-SPAM requires.
- [ ] **Create the mailboxes** the documents give out: privacy@rempo.io, support@rempo.io, legal@rempo.io (aliases forwarding to one inbox are fine). Answer privacy requests within 10 business days (receipt) and 45 days (answer).
- [ ] **Have a California attorney review** the documents, especially the arbitration clause, the liability cap, the BAA, and the TCPA analysis below.
- [ ] **Stripe checkout**, when it is built: turn on "Require customers to accept your terms of service" (Stripe Checkout `consent_collection.terms_of_service`, with `https://rempo.io/legal/terms` set in Stripe's public details), add the renewal terms as custom text right by the pay button (amount, monthly or yearly, renews until cancelled, how to cancel), turn on the customer portal for online cancellation and put its link in `settings.billingPortalUrl`, and keep Stripe's receipt emails on (they are the acknowledgment).
- [ ] **Healthcare clients:** don't onboard one until the BAA can be accepted at checkout (a separate checkbox or e-signature, kept on file) and every vendor that touches patient data has signed a BAA with Rempo: HighLevel's HIPAA plan, and NiftyImages and Zapier, or route around any that won't sign (the request image carries the patient's first name and the practice's name, which is protected health information).
- [ ] **Meta:** add `https://rempo.io/legal/privacy` as the privacy policy in Meta Business settings. When the pixel id is set, the cookie notice turns on by itself.

**Operational promises the documents make (keep them true):**

- [ ] Texts to clients' customers only between 9 a.m. and 8 p.m. in the client's time zone (set the send window in HighLevel).
- [ ] Replies to negative reviews go to the client for approval unless the client says otherwise in writing.
- [ ] One reminder after a review request, then stop; the same request to every eligible customer.
- [ ] Multi-factor authentication on every account that holds personal information (HighLevel, Supabase, Vercel, Google, Stripe, email).
- [ ] Delete old leads: leads who never became clients after 24 months. In Supabase: `delete from public.leads where created_at < now() - interval '24 months' and status in ('new', 'contacted', 'lost', 'spam');` (keep records of opt-outs).
- [ ] Clarity, if turned on: set masking to Strict or Balanced, and keep recordings at 30 days.
- [ ] Annual plans: email a renewal reminder 15 to 45 days before each renewal. Price increases: 30 days' notice.
- [ ] Keep `/legal/subprocessors` current, at least 15 days before a new provider touches client customer data.
- [ ] Choose AI providers whose business terms don't train on client data, as the Terms promise.

## For counsel

- **TCPA, who "initiates" the texts.** Rempo runs the client's review-request texts for them. The Terms make the client responsible for consent, with an uncapped indemnity, and say Rempo acts as the client's agent for sending. Whether a review request is "telemarketing" (written consent) or informational (prior express consent) is unsettled; the documents ask clients for consent that would satisfy either.
- **The FCC's revised revocation rules** take effect 2026-11-25 (FCC 26-67, 91 FR 67214). The SMS terms honor STOP and its synonyms and send one confirmation. Check whether Rempo should name an exclusive revocation method.
- **CCPA applicability.** Rempo is likely under the thresholds ($26,625,000 revenue; 100,000 consumers; half of revenue from selling or sharing). The documents comply anyway, so nothing changes if Rempo grows into it.
- **Arbitration and the liability cap** favor Rempo (the client's indemnity is uncapped, Rempo's is capped). Common for self-serve business software; worth a look.
- **California's automatic renewal law** covers consumers, not business buyers, but the billing policy follows it anyway (express consent, reminders, online cancellation, one save offer).
- **Prospect research.** Outbound uses public Google review data gathered through Clay. Check Google's terms of service on automated collection.

## Sources

Research run on 2026-11-08. Law firm and vendor summaries were used to find current status; check the primary text before relying on any one of them.

- California SB 690 (CIPA pen-register claims), signed 2026-09-30: [K&L Gates](https://www.klgates.com/thought-leadership/California-Narrows-CIPA-Litigation-SB-690-Ends-Pen-Register-and-Trap-and-Trace-Claims-10-8-2026), [Goodwin](https://www.goodwinlaw.com/en/insights/publications/2026/09/alerts-technology-cldr-california-curbs-cipa-pen-register-suits), [Procopio](https://www.procopio.com/resource/california-governor-signs-sb-690-curtailing-cipa-pen-register-litigation)
- CCPA thresholds: [CPPA, monetary thresholds](https://www.cppa.ca.gov/regulations/cpi_adjustment.html). CCPA regulations effective 2026-01-01 (opt-out status display, symmetry, banners): [Greenberg Traurig](https://www.gtlaw.com/en/insights/2025/9/revised-and-new-ccpa-regulations-set-to-take-effect-on-jan-1-2026-summary-of-near-term-action-items), [Nelson Mullins](https://www.nelsonmullins.com/insights/alerts/fcc-download/all/show-me-that-you-ve-opted-me-out-new-ccpa-rules-require-businesses-to-prove-compliance)
- TCPA revocation rules: [Crowell](https://www.crowell.com/en/insights/client-alerts/fcc-officially-adopts-amendments-to-tcpa-rules), [Consumer Financial Services Law Monitor](https://www.consumerfinancialserviceslawmonitor.com/2026/10/fcc-publishes-revised-tcpa-revocation-rules/), [Troutman Pepper Locke](https://www.troutman.com/insights/fcc-revises-tcpa-revocation-of-consent-rules-that-were-set-to-go-into-effect-in-january/)
- A2P 10DLC opt-in rules: [Twilio error 30925](https://www.twilio.com/docs/api/errors/30925), [Twilio error 30931](https://live.docs.dev.twilio.com/docs/api/errors/30931.md)
- California automatic renewal law (AB 2863): [bill text](https://leginfo.legislature.ca.gov/faces/billTextClient.xhtml?bill_id=202320240AB2863). FTC click-to-cancel vacatur and new rulemaking: [Gibson Dunn](https://www.gibsondunn.com/ftc-restarts-negative-option-rulemaking-after-eighth-circuit-vacatur-enforcement-under-rosca-continues/), [Jones Day](https://www.jonesday.com/en/insights/2026/05/ftc-revives-clicktocancel-rule-new-risks-for-subscription-businesses)
- California breach notice, 30 days (SB 446): [Data Protection Report](https://www.dataprotectionreport.com/2025/11/california-tightens-data-breach-notification-timelines-imposes-30-day-notice-requirement/)
- Meta Business Tools Terms (pixel notice and opt-out): [Meta Business Tools Terms](https://www.facebook.com/legal/businesstech)
- Clickwrap and sign-in wrap in the Ninth Circuit: [Kilpatrick Townsend summary](https://ktslaw.com/blog/classaction/2026/7/california-federal-court-rules-that-clicking), [Godun v. JustAnswer](https://www.lexplug.com/casebrief/godun_v_justanswer_llc_68b8834b024dab36b11180d0)
- HIPAA Security Rule update (still proposed as of mid-2026): [HIPAA Journal](https://www.hipaajournal.com/?p=55543)
- FTC Consumer Review Rule (16 C.F.R. Part 465) and Google's 2026 review policy changes: [Federal Register](https://www.federalregister.gov/documents/2024/08/22/2024-18519/trade-regulation-rule-on-the-use-of-consumer-reviews-and-testimonials), [Google's policy](https://support.google.com/contributionpolicy/answer/7400114)
- California AI laws (bot disclosure, AI voice, AB 489): [DLA Piper](https://www.dlapiper.com/en-gb/insights/publications/2025/10/california-ai-laws)
- Microsoft Clarity consent: [Microsoft Learn](https://learn.microsoft.com/en-us/clarity/setup-and-installation/consent-management)
- The GTM build's own compliance research: `rempogtmbuild/research/step-0c-compliance.md`, `dashboards/15-full-funnel-offer.md` (compliance table)
