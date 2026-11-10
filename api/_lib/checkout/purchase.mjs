// A Stripe Checkout Session as the webhook uses it: one flat purchase (the buyer, the plan, the money, the consents, where
// they came from), and the row public.record_checkout() stores.
import { PLANS } from "./config.mjs";

const idOf = (v) => (typeof v === "string" ? v : v && typeof v === "object" && v.id ? String(v.id) : null);
const UTM = ["utm_source", "utm_medium", "utm_campaign", "utm_content", "utm_term", "fbclid", "gclid"];

export function purchaseFrom(s) {
  const m = s.metadata || {};
  const cd = s.customer_details || {};
  const items = (s.line_items && s.line_items.data) || [];
  const bumps = new Set(Object.values(PLANS).map((p) => p.bump).filter(Boolean));
  const plan = PLANS[m.plan];
  return {
    sessionId: s.id,
    livemode: Boolean(s.livemode),
    mode: s.mode || null,
    status: s.status || null,
    paymentStatus: s.payment_status || null,
    paid: s.status === "complete" && (s.payment_status === "paid" || s.payment_status === "no_payment_required"),
    customerId: idOf(s.customer),
    subscriptionId: idOf(s.subscription),
    paymentIntentId: idOf(s.payment_intent),
    email: String(cd.email || s.customer_email || "").trim().toLowerCase(),
    name: cd.name || "",
    firstName: m.first_name || "",
    business: m.business || "",
    phone: m.phone || cd.phone || "",
    plan: m.plan || "",
    planLabel: plan ? plan.label : m.plan || "Rempo",
    billing: m.billing || "",
    profiles: Math.max(1, Number(m.profiles) || 1),
    bump: items.some((li) => li.price && bumps.has(li.price.lookup_key)),
    amountTotal: Number.isFinite(s.amount_total) ? s.amount_total : null,
    currency: s.currency || "usd",
    termsAccepted: Boolean(s.consent && s.consent.terms_of_service === "accepted"),
    consentEmail: m.consent_email === "true",
    consentPhone: m.consent_phone === "true",
    noticeVersion: m.notice_version || "",
    visit: s.client_reference_id || m.visit || "",
    leadId: m.lead_id || "",
    answers: { runs: m.runs || "", software: m.software || "" },
    utm: Object.fromEntries(UTM.filter((k) => m[k]).map((k) => [k, m[k]])),
    recoveryUrl: (s.after_expiration && s.after_expiration.recovery && s.after_expiration.recovery.url) || ""
  };
}

// The row for public.record_checkout(): paid is true once the money is in; expired once Stripe gave up on the session
export function rowFrom(p) {
  return {
    stripe_session_id: p.sessionId, livemode: p.livemode, status: p.status, payment_status: p.paymentStatus, mode: p.mode,
    stripe_customer_id: p.customerId, stripe_subscription_id: p.subscriptionId, stripe_payment_intent_id: p.paymentIntentId,
    email: p.email || null, name: p.firstName || p.name || null, phone: p.phone || null, business: p.business || null,
    plan: p.plan || null, billing: p.billing || null, profiles: p.profiles, bump: p.bump, amount_total: p.amountTotal, currency: p.currency,
    terms_accepted: p.termsAccepted, consent: { email: p.consentEmail, texts: p.consentPhone, notice_version: p.noticeVersion || null },
    visit: p.visit || null, lead_id: p.leadId || null, recovery_url: p.recoveryUrl || null,
    metadata: { answers: p.answers, utm: p.utm }, paid: p.paid, expired: p.status === "expired"
  };
}
