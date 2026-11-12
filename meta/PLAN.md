# Rempo for Meta ads: the plan

The landing page at the root of this repository is Rempo's master page: the full story for an HVAC or plumbing owner who wants to read everything. This folder is a second page, built for one kind of visitor: an owner who tapped a Facebook or Instagram ad a few seconds ago. It has one job: turn that tap into a qualified lead, then into a booked 15-minute call.

It shares the master page's look (the same tokens, fonts, illustrations and components), its lead storage (the same Supabase table, through the same `submit_lead()`), and its email (the same Resend account). It lives on the master page's domain at `/customers` and deploys with the master page's Vercel project.

Sources: the three methodologies the founder supplied (summarized in section 1), the go-to-market build repo (`rempogtmbuild`: GTM brief, dashboards 03, 04, 06, 07, 08, 10, 12 to 15, the lead magnet spec, the landing page's copy rules), and the master page in this repository.

---

## 1. What the methodologies say, and what each changes here

**M1. "The best landing page structure for Meta ads."** Order matters as much as content: a crystal-clear headline that names the audience and the desire, the action right under it, a video that puts a face to the brand, then three leading value points (what makes you different), then supporting points (full transparency, the numbers), then closing points (proof, risk reversal, extras). A landing page is the quality play; an instant form is the quantity play. Mobile first (90% of the traffic). Plain full sentences that cannot be misunderstood; no witty fragments. Put the price on the ad or the page as a filter.

**M2. "How to test landing pages with Facebook ads."** Send the ad to a page that sells before the product page. Meta reads the landing page as well as the ad to decide who to show the ad to, so the page's words are part of the targeting. Every page must match its ad's desire, awareness, sophistication and avatar; if it does not, it needs its own ads. Keep tests simple enough to run every week: same ads, new URL.

**M3. The 12-hour Facebook ads course.** You only ever sell the next step. The visitor arrives with 1.8 seconds of attention, reads the headline, skips the video, sees the form ("that's what they want me to do") and then scrolls fast to talk themselves into or out of it. So: put the form in the first screen, lower physical resistance (taps over typing, no extra page, the form embedded), lower psychological resistance (images over text, FAQs high, honesty about the negatives, real faces), start the survey where the visitor is (multiple choice about them), ask for contact details last, use process language on the button, never close the loop before the last step, and tell Meta about a lead only when the answers qualify ("pixel conditioning"). After the form: a booking step that says "last step", a thank-you page that sets expectations, and a nurture that sells showing up.

| Principle | Where it shows on this page | Source |
|---|---|---|
| One page, one action, no menu | No navigation. Every button opens the same Gap Check | M3 (landing page = one book, not the library) |
| Headline = result + feeling, never "the thing" | "Your work is better. Do your reviews show it?" | M1, M3 |
| The action right under the headline | The Gap Check sits in the hero, its first question visible on a phone without scrolling | M1, M3 (physical resistance: scrolls, clicks) |
| Ad and page say the same thing | Four variant pages, one per ad angle, each with its own static URL and hero | M2 (congruence), M3 (set expectations) |
| Sell the next step only | The page sells a free Gap Check. The result sells the 15-minute call. The call sells the service | M3 |
| Micro-commitments, contact last | Seven taps, one business step, then first name and email | M3 (curious to committed) |
| Process language on the button | "Answer a few quick questions. Your score shows right after; your report comes by email" | M3 (the line above the form is the frame for completing it) |
| Never close the loop early | After the score: "Last step: pick a time"; no "thank you" until the call is booked | M3 |
| Images over text | Every value point is led by an illustration from the master page | M3 (thought) |
| Lean into the negatives | "What we won't do", and "a review tool costs less, and we'll tell you so" | M3 (construct the argument; talk about the worst) |
| No fake proof | Real proof only: the master page's case studies and German Aquino's video testimonial (added 2026-11-12, at the owner's request, once they were on file), placed with the closing points. Never an invented testimonial, count or logo. The sample report stays plainly the product's own example | GTM claim rules, M1 |
| Quality over quantity | Qualifying questions from the GTM's own floor; Meta is told only about qualified leads | M1, M3 (pixel conditioning) |
| Transparency | What's in the report, who checks it, when it arrives, what starting takes | M1 (supporting value points) |
| Show-up rate | Booking window of 5 business days, never same day or weekends; an add-to-calendar; an expectations note | M3 (booking page, thank-you page) |

## 2. The Meta visitor, and what the page must do for them

- **Who:** the owner of an HVAC or plumbing shop, 1 to 2 locations, US, who logs jobs in job software (GTM ICP 1, 1a). On a phone, inside the Facebook or Instagram app, between jobs or in the evening.
- **State of mind:** not looking for review help (that is why Meta is the channel, dashboard 08). Curious, not committed: about a 3 out of 10 on buying readiness. Skeptical of marketing companies ("I've paid for marketing before and got nothing", dashboard 12, objection 1). Proud of the work.
- **Internal monologue, in their words** (GTM journey and master page): "The company down the road has newer reviews than we do." "We ask when someone remembers." "That 3-star review sat there for weeks." "I don't have time to run another tool."
- **What they will do on the page:** read the headline, glance at the picture, see the first question, and either tap it or scroll.
- **What they will give:** taps freely; a business name and town for something about their own shop; an email for a result they want; a phone number only when they choose a call.
- **So the page:** asks about them first, gives them something specific to their own shop (a score now, a report tomorrow), asks for the phone number only at the call step, and never pretends to be bigger or more proven than it is.

## 3. The funnel

```
Meta ad (one of four angles)
  └─▶ variant page, same promise as the ad
        └─▶ Gap Check in the hero: 7 taps + business + first name and email
              ├─ browser: GapCheckStart, GapCheckStep (each step)
              └─▶ POST /api/lead  form "meta-gap-report"
                    ├─ Supabase public.leads (shared), the owner notified (Resend, Slack)
                    ├─ Meta: Lead, browser and Conversions API with one event id, ONLY if qualified
                    └─ the prospect: their score by email, and the report within one business day
              └─▶ result on screen: score /100, tier, the three biggest gaps, "your Gap Report is next"
                    └─▶ LAST STEP: pick a day and a time window for a 15-minute call, best phone
                          └─▶ POST /api/lead  form "meta-call"
                                ├─ Meta: Schedule, browser and server, ONLY if qualified
                                └─ the prospect: "you're booked, reply YES to confirm"
                          └─▶ booked: add to calendar, the video (when recorded), the expectations note,
                                "rather skip the call?" checkout (once the offer is decided)
```

Why a free Gap Check and not "Buy" or "Book a call" as the first action: Meta traffic is curious, not committed (M3). A direct call ask or a checkout sits at the committed end of the spectrum and would be judged against a stranger's first impression. The Gap Check is the GTM's own middle-of-funnel asset (the Review Engine Scorecard plus the Gap Report, dashboard 08 and the lead magnet spec), it is about the visitor's own shop, and it qualifies them while they answer. The call comes next, as the last step, because the score gives a reason for it ("walk through your report").

## 4. The page, section by section

Mobile is the design target (390 px). On a PC the hero becomes two columns: the copy and the picture on the left, the Gap Check on the right.

| # | Section | What it does for the visitor | Content |
|---|---|---|---|
| 0 | Header | Says whose page this is. No menu, no exits | The Rempo logo |
| 1 | Hero | Continues the ad's thought and starts the action | Eyebrow "For HVAC and plumbing shop owners"; the variant's headline and line; the Gap Check card; three trust lines (free, no call needed; built from your public Google profile; emailed within one business day); the variant's illustration |
| 2 | Your free Gap Report (leading value points) | Makes the report concrete and worth a minute | The top three near you; five measures in plain words; checked by a person. A sample report (demo data), shown as the product's own example, beside the podium illustration. Button |
| 3 | Where reviews leak (the problem) | Names what they already suspect, so they recognise themselves | Three typical cases from the master page (customers never asked; the 3-star review nobody answered; the newest review is months old), each with what Rempo does |
| 4 | If you hand it over (supporting value points) | Transparency on the service behind the report | What your customer sees (a sample thank-you with the team photo); every job asked, one reminder; every review answered; monthly report; same-day alert. Starting is four things, once. Button |
| 5 | What we won't do (closing: honesty) | Removes the "what's the catch" | No removing reviews, no screening out unhappy customers, no promised counts or rankings, no rewards or suggested words; "a review tool costs less, and we'll tell you so" |
| 6 | Straight answers (FAQ) | Answers the questions they would leave to ask | 14 questions in four groups: the report, getting started, results and expectations, objections |
| 7 | Who reads your report (founder) | A real face, once the founder supplies one | Hidden until `site.founder` is filled (shown as {TBD} in the preview view) |
| 8 | Final call | Back to emotion before the ask, then the action | A short problem stack, the button, the trust line |
| 9 | Footer | Who runs this, privacy | Logo, company line, the legal pages (`/legal`: Terms, Privacy, Cookies, SMS terms, Accessibility, Do Not Sell or Share), Cookie settings when a tracker is set |
| - | Sticky bar (phones) | The action is one tap from anywhere | "Get my free Gap Report", shown once the hero card is off screen, hidden at the final call and once the check is done |

Every button opens the same Gap Check: on a phone it rises as a bottom sheet (the master page's pattern: one form, moved into the sheet and back), on a PC the page glides to the hero card.

## 5. The Gap Check

Built on the GTM's Review Engine Scorecard (lead magnet spec): the same scored questions, points, tiers and routing, so Meta results compare with the other funnels. Two changes for Meta: the trade comes first (an easy "that's me" tap that also sets the words for later questions), and the scorecard's "search your service and your town" instruction is rephrased so nobody leaves the page mid-survey.

| Step | Question | Options (points) | Use |
|---|---|---|---|
| 1 | What's your trade? | HVAC / Plumbing / HVAC and plumbing / Another home service | Wording, the report's search |
| 2 | How do you ask customers for Google reviews today? | We don't really ask (25) / When someone remembers (20) / Our technicians ask in person (15) / Our job software sends a request (8) / A review tool sends requests and follow-ups (3) | Score |
| 3 | When did your most recent Google review come in? | This week (0) / This month (6) / 1 to 3 months ago (14) / More than 3 months ago (20) / Not sure (12) | Score |
| 4 | How often do you reply to your Google reviews? | Every review, within two days (0) / Most of them (4) / Some of them (8) / Rarely (12) / Never (15) | Score |
| 5 | Next to the top three companies near you on Google, your reviews look... | Ahead (0) / About even (8) / Behind (18) / Far behind (25) / Haven't checked (15) | Score |
| 6 | About how many jobs do you finish in a typical week? | Fewer than 5 (3) / 5 to 15 (8) / 16 to 40 (12) / More than 40 (15) / Not sure (8) | Score, floor |
| 7 | Where are your finished jobs recorded? | Job software built for the trades / Another CRM or booking system with customer phone or email / Paper or spreadsheets / Not sure | Fit, routing |
| 8 | Which business should we look up? | Business name as it shows on Google; city or town; Google profiles: 1 / 2 / 3 to 9 / 10 or more | The report; routing |
| 9 | Where should we send your Gap Report? | First name; email; consent | Contact, last |

**Score and tier** (GTM): steps 2 to 6 total 100; a higher score means a bigger gap. 0 to 39 Steady engine, 40 to 69 Leaky engine, 70 to 100 Stalled engine, each with the GTM's own message and the home-services rule line.

**The three biggest gaps:** the three scored answers with the most points, each explained in one plain line (with BrightLocal 2026 where a statistic is used).

**Fit, which decides what Meta hears** (pixel conditioning, from the GTM ICP floor in dashboard 04):

| Fit | Rule | Meta `Lead` / `Schedule` |
|---|---|---|
| `qualified` | 5 or more jobs a week (or not sure), and jobs recorded in job software, another CRM, or not sure | Sent, browser and server, one event id |
| `under-floor` | Fewer than 5 jobs a week | Not sent |
| `no-software` | Paper or spreadsheets | Not sent |

Everyone still gets the score, the report and the call. Only Meta's learning is filtered, so the algorithm looks for more owners like the qualified ones. The rules are data in `content/survey.mjs`, to tighten after a quarter of data (M3: start wide).

**Routing** (GTM overrides): paper or spreadsheets, or 3 or more Google profiles, go to the call with no checkout link. Everyone else gets the call as the last step, and the checkout link once the offer is decided.

## 6. Message match: one page per ad angle

From the GTM's Meta creative test (dashboard 08: concept A, the request picture; concept B, the problem signal) and its strongest home-services signals (dashboard 04). Each variant is its own static page, so Meta's crawler reads the variant's own words.

| Ad hook | URL | Headline | Picture |
|---|---|---|---|
| "How do your Google reviews compare with the three shops above you?" | `/` | Your work is better. Do your reviews show it? | Three local companies on a podium, your van on the street |
| "When did your shop get its last Google review?" | `/recent` | How fresh are your Google reviews? | A street of homes, some asked, some not |
| "How many of your Google reviews have no reply?" | `/replies` | How many of your reviews have no reply? | A review card with the reply written |
| "Here's what your customer sees after every job." | `/request` | Here's what your customer sees after every job. | A phone receiving the thank-you with the crew photo |

Everything below the hero is shared, so a test compares one variable: the angle (M2, M3: one big variable per test). Adding a variant is one entry in `content/variants.json`.

## 7. Tracking

- **Meta pixel** (only when `site.metaPixelId` is set, only after the visitor taps Allow in the cookie notice (`site.trackingConsent`), and never for a visitor whose browser sends Global Privacy Control): `PageView`; custom `GapCheckStart`, `GapCheckStep` (step number and name, to see the drop-off slide by slide, M3), `GapReportRequested` and `CallRequested` (with `fit`, for everyone); standard `Lead` and `Schedule` for qualified visitors only; `InitiateCheckout` on the checkout link.
- **Conversions API** (only when `META_PIXEL_ID` and `META_CAPI_TOKEN` are set): the server sends `Lead` and `Schedule` for qualified visitors with the same event id as the browser, so Meta counts each once. Email, phone, first name, city, country and the visit id are hashed with SHA-256; `fbc`, `fbp`, IP and user agent are sent as Meta requires, unhashed. `META_TEST_EVENT_CODE` routes events to Events Manager's test tab.
- **Attribution:** `utm_*`, `fbclid` and the variant are kept for the visit and stored with each lead, with `fbc` and `fbp`.
- **Microsoft Clarity** (optional, `site.clarityId`): session recordings to see how visitors scroll and where they stop (M3).
- **Optimize the campaign for `Schedule`** once there are enough of them; start on `Lead` (M3: B2B buyers have scheduling data, but a new pixel has none).

## 8. Data and email

- **Storage:** the shared `public.leads` table through `public.submit_lead()`. Two forms: `meta-gap-report` and `meta-call`, linked by the visit id and the email. No schema change. The answers, score, tier, fit, gaps, variant and call slot go to `fields`; campaign, page, `fbc`, `fbp` and event ids to `meta`. `sql/meta-leads-view.sql` adds an optional flat view in a private schema for reading Meta leads.
- **The owner:** the same Resend and Slack notices as the master page, so a Meta lead is announced the second it arrives (speed to lead).
- **The prospect** (optional, `PROSPECT_EMAIL_FROM`): right after the Gap Check, their score and what happens next; right after booking, the slot, "reply YES to confirm", and who to bring (M3: replies and written yeses raise show rates; position everything as a benefit to them).
- **The shared server code** (`api/_lib/lead-store.mjs`, `lead-fields.mjs`, `lead-notify.mjs`) is copied from the master page and a test fails if the copies drift. `node tools/sync-shared.mjs` copies them again.

## 9. Project and deploy

```
meta/
  PLAN.md, README.md           this plan; setup, deploy, operations
  content/                     every word, the survey and the scoring, the variants, the site settings
  src/                         template, styles, browser script
  lib/gapcheck.mjs             scoring, tiers, gaps, fit and routing: one file for the browser and the server
  api/lead.mjs                 the Meta lead endpoint (store, notify, Conversions API, prospect email)
  api/_lib/                    shared copies from ../api/_lib, plus capi.mjs and prospect-email.mjs
  tools/                       build, dev server, image processing, copy lint, sync
  tests/                       scoring, endpoint, copy rules, build, the page in a real browser
../customers/                  the built pages, served at /customers (committed)
../api/meta-lead.mjs           the function Vercel runs at /api/meta-lead (runs api/lead.mjs)
```

Vercel: the master page's project, with nothing to set up. `node tools/build.mjs` writes the pages to the repository's `customers/` folder (committed; Vercel runs no build and serves it at `/customers`), and the root `api/meta-lead.mjs` runs `api/lead.mjs` at `/api/meta-lead`, with the master page's environment variables. The root `vercel.json` adds the function's time limit, the `/customers` headers and a redirect that keeps `meta/` from being served; the root `.vercelignore` leaves out what the function does not import.

## 10. Quality bar

- The first question is visible without scrolling on a 390 x 844 phone.
- Every claim passes the GTM's copy rules (`content` is linted on every build): no promised reviews or rankings, no price or terms until the offer is decided, no "instant" or "automatic", no named job software, no em dashes.
- No caption under the illustrations (removed at the owner's request, 2026-11-07): they read as internal notes. So no sample may pass for real proof: a sample review stays inside its illustration, never alone as a testimonial, and the sample report is shown as the product's example. No invented testimonial, count or logo.
- Keyboard and screen reader work through the whole Gap Check; contrast from the master page's tokens; reduced motion respected.
- A light page: no framework, one small script, fonts and pictures cached, below-the-fold pictures lazy.

## 11. Decisions the founder makes before launch

| Decision | Until then | Where |
|---|---|---|
| The offer (price, setup fee, guarantee, terms) | Hidden; the FAQ says the call covers the numbers | `content/site.mjs` `offer` |
| Checkout link | No checkout link anywhere | `site.checkoutUrl` |
| Privacy notice | Done: `/legal/privacy` and the other legal pages, built from `../legal-src/` | `site.privacyUrl`, `site.legal` |
| Company line (legal name, city) | Footer shows "Rempo · rempo.io" | `site.company` |
| Meta pixel and Conversions API | No tracking | `site.metaPixelId`; Vercel `META_PIXEL_ID`, `META_CAPI_TOKEN` |
| The founder's face and name | Founder section hidden | `site.founder` |
| The video | Hidden | `site.vsl` |
| Who calls, and when (call windows, time zone) | Morning, midday, afternoon in the visitor's time | `content/survey.mjs` `booking` |
| Prospect emails | Off | Vercel `PROSPECT_EMAIL_FROM` |

## 12. What to test first

In line with the GTM's 90-day plan (dashboard 10: Meta from week 5; stop Meta in an ICP if, after 1,000 Meta page visits, Meta-first visitors act at under half the rate of outbound-first visitors):

1. **Angle** (the four variants), same creative per angle. Read: Gap Checks started and finished per 100 visits, qualified share, calls booked.
2. **Headline** inside the winning angle (M3: the first thing to test, because it frames the whole page).
3. **The line above the first question** (M3: the frame for starting).
4. **Steps 4 and 6** if `GapCheckStep` shows a drop at either (M3: measure slide by slide; remove a question that costs more than it tells).

Judge after at least a week or about $1,000 of spend per arm (M3).

## 13. The first video (recommended, not built)

The course's cheapest proven video fits Rempo exactly: the founder on Loom, scrolling through a real Gap Report for a sample shop and saying what each line means and what Rempo would run first. Two to three minutes, captions burned in. First 30 seconds: the owner's situation in their words ("You do good work. Your newest review is from spring."), what the report shows, and a sample on screen. Then what Rempo runs (two pillars: we ask every customer; we answer every review), what the owner does once, and the call. Set `site.vsl` and it appears after booking (and in the hero, if `placement` is `hero`).
