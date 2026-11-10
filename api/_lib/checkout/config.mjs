// The checkout's plans and settings (/start, api/checkout.mjs, api/stripe-webhook.mjs). Setup and placeholders:
// checkout/README.md.
//
// No price is written here. Each plan names the Stripe lookup keys of its prices; the checkout reads those prices from
// Stripe, shows them on /start and charges them. A plan whose main price is not in Stripe is not offered (its buyers are
// sent to the call). So the offer is set in Stripe, and a price change needs no code.
//
// Lines marked TBD are placeholders the owner replaces (checkout/README.md, "Placeholders").

// Stamped on every Checkout Session this site opens (metadata.source). The webhook ignores sessions without it, so other
// Stripe sales on the same account (a Payment Link, an invoice) never reach GoHighLevel as a Rempo purchase.
export const SOURCE = "rempo.io/start";

export const PLANS = {
  "done-for-you": {
    label: "Done For You",
    // TBD (copy): the line under the plan name, from the marketing session. For now, the landing page's own words.
    blurb: "Our team sets it up and runs it. You approve your messages, then we run it.",
    mode: "subscription",
    prices: { monthly: "rempo_dfy_monthly", annual: "rempo_dfy_annual", setup: "rempo_dfy_setup" },
    bump: "rempo_gbp_tuneup"        // offered inside Stripe's checkout as an optional item (the GBP Tune-Up)
  },
  "engine-software": {
    label: "Engine software",
    blurb: "Your office runs it. Our team does the setup.",   // TBD (copy)
    mode: "subscription",
    prices: { monthly: "rempo_engine_monthly", annual: "rempo_engine_annual", setup: "rempo_engine_setup" },
    bump: null
  },
  jumpstart: {
    label: "7-Day Google Profile Jumpstart",
    blurb: "One payment, no monthly plan. Our team works on your Google profile for 7 days.",   // TBD (copy)
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
  setupPerProfile: false,           // TBD (decision): the setup fee once per order (false) or once per Google profile (true)
  bumpPerProfile: false,            // TBD (decision): the tune-up once per order (false) or once per Google profile (true)
  setupWaivedOnAnnual: true,        // GTM: annual plans waive the setup fee
  allowPromotionCodes: false,       // true shows Stripe's promotion code field (for a founding-price code, say)
  // TBD (copy and decision): the guarantee, one sentence, shown above the pay button and inside Stripe's checkout.
  // Until the owner and counsel settle its terms, no guarantee is shown anywhere.
  guarantee: null,
  supportEmail: "support@rempo.io", // the same mailbox as legal-src/settings.mjs (emails.support)
  // The buyer's details added to the onboarding link on the thank-you page, so the founder's GoHighLevel form opens
  // filled in: query parameter -> detail. TBD: confirm the founder's form takes these names.
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
