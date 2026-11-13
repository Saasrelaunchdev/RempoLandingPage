// The checkout's plans and settings (/start, api/checkout.mjs, api/stripe-webhook.mjs). Setup and placeholders:
// checkout/README.md.
//
// No price is written here. Each plan names the Stripe lookup keys of its prices; the checkout reads those prices from
// Stripe, shows them on /start and charges them. A plan whose main price is not in Stripe is not offered (its buyers are
// sent to the call). So the offer is set in Stripe, and a price change needs no code.
//
// The words and defaults here are settled on our side, from the landing page and the go-to-market build. What only the
// business can give (prices, the guarantee, its legal facts, its GoHighLevel pieces) is listed in checkout/README.md,
// "Needed from the business"; the one setting of that kind in this file is SETTINGS.guarantee.

// Stamped on every Checkout Session this site opens (metadata.source). The webhook ignores sessions without it, so other
// Stripe sales on the same account (a Payment Link, an invoice) never reach GoHighLevel as a Rempo purchase.
export const SOURCE = "rempo.io/start";

export const PLANS = {
  // label: the plan's name; blurb: one line under it; includes: what the plan does, shown as a short list. Process only,
  // never a result (no review counts, ratings or rankings), in the landing page's words.
  "done-for-you": {
    label: "Done For You",
    blurb: "Our team runs your Google reviews for you. You give us access once, then we run it.",
    includes: ["Every completed job asked, with your team's photo", "One reminder, then we stop", "A reply written for each review",
      "A monthly report, sent to you", "Setup done by our team"],
    mode: "subscription",
    prices: { monthly: "rempo_dfy_monthly", annual: "rempo_dfy_annual", setup: "rempo_dfy_setup" },
    bump: "rempo_gbp_tuneup"        // offered inside Stripe's checkout as an optional item (the GBP Tune-Up)
  },
  "engine-software": {
    label: "Engine software",
    blurb: "The same review requests, run by your office. Our team sets it up and connects it.",
    includes: ["A request after every completed job, with your team's photo", "One reminder, then it stops", "Reply drafts for your office to post",
      "Setup done by our team"],
    mode: "subscription",
    prices: { monthly: "rempo_engine_monthly", annual: "rempo_engine_annual", setup: "rempo_engine_setup" },
    bump: null
  },
  jumpstart: {
    label: "7-Day Google Profile Jumpstart",
    blurb: "One payment, no monthly plan. Our team works on your Google profile for 7 days.",
    includes: ["Your Google profile checked and tuned", "Replies written for recent reviews that have none", "A walkthrough call on day 7"],
    mode: "payment",
    prices: { once: "rempo_jumpstart" },
    bump: "rempo_reply_catchup"     // the Reply Catch-Up, optional at checkout
  }
};

export const SETTINGS = {
  // How long a checkout stays open before Stripe reports it abandoned (checkout.session.expired). Stripe's minimum is 30.
  // 60 matches the GTM's first follow-up, one hour after an abandoned checkout.
  sessionMinutes: 60,
  maxProfiles: 2,                   // 3 or more Google profiles are quoted on a call (Local Authority)
  setupPerProfile: false,           // GTM: the setup fee once per order ("$497 setup"), not per Google profile
  bumpPerProfile: false,            // GTM: the tune-up once per order ("$197 once")
  setupWaivedOnAnnual: true,        // GTM: annual plans waive the setup fee
  allowPromotionCodes: false,       // true shows Stripe's promotion code field (for a founding-price code, say)
  // Needed from the business: the guarantee, one sentence, shown above the pay button and inside Stripe's checkout.
  // Until the business and its attorney settle the terms, no guarantee is shown anywhere.
  guarantee: null,
  supportEmail: "support@rempo.io", // the same mailbox as legal-src/settings.mjs (emails.support)
  // The buyer's details added to the onboarding link on the thank-you page, so the GoHighLevel form opens filled in:
  // query parameter -> detail. GoHighLevel's standard contact fields; checked against the form once its link is in.
  onboardingPrefill: { first_name: "firstName", email: "email", phone: "phone", company_name: "business" }
};

// Every lookup key the catalog reads from Stripe
export function lookupKeys() {
  const keys = [];
  for (const plan of Object.values(PLANS)) {
    keys.push(...Object.values(plan.prices));
    if (plan.bump) keys.push(plan.bump);
  }
  return [...new Set(keys)];
}

// Checkout with a live key stays closed until CHECKOUT_OPEN=true is set in Vercel. With a test key it always works.
export const checkoutOpenFlag = () => /^(1|true|yes|on)$/i.test(String(process.env.CHECKOUT_OPEN || "").trim());
