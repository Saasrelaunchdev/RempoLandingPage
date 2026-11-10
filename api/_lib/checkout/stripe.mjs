// Stripe for the checkout: its REST API with fetch (no SDK, so the project's dependencies stay as they are, like the
// site's other services), the webhook signature check, the catalog read by lookup key, and the Checkout Session the
// buyer pays in. Shared by api/checkout.mjs and api/stripe-webhook.mjs.
//
// Settings, Vercel environment variables:
//   STRIPE_SECRET_KEY      sk_test_... while testing, sk_live_... in production (a restricted rk_ key works too)
//   STRIPE_WEBHOOK_SECRET  whsec_..., the signing secret of the webhook endpoint (two, comma separated, while rolling it)
//   STRIPE_API_VERSION     optional: pins the API version of every call; without it, the account's default is used
import { createHmac, timingSafeEqual } from "node:crypto";
import { PLANS, SETTINGS, SOURCE, lookupKeys } from "./config.mjs";
import { renewalText } from "../../../assets/checkout-shared.mjs";

const env = (n) => (process.env[n] ? String(process.env[n]).trim() : "");
const API = "https://api.stripe.com";

export function stripeConfig() {
  const key = env("STRIPE_SECRET_KEY");
  const mode = /^(sk|rk)_live_/.test(key) ? "live" : /^(sk|rk)_test_/.test(key) ? "test" : null;
  const problem = !key ? "missing" : !mode ? "bad-key" : null;
  const webhookSecrets = env("STRIPE_WEBHOOK_SECRET").split(",").map((s) => s.trim()).filter((s) => /^whsec_/.test(s));
  return { key, mode, ok: !problem, problem, version: env("STRIPE_API_VERSION"), webhookSecrets };
}

// { a: { b: [1, { c: 2 }] } } -> a[b][0]=1&a[b][1][c]=2, the way Stripe reads form bodies and query strings.
// undefined and null are left out.
export function formEncode(value, prefix = "", out = []) {
  if (value === undefined || value === null) return out;
  if (Array.isArray(value)) value.forEach((v, i) => formEncode(v, `${prefix}[${i}]`, out));
  else if (typeof value === "object") for (const [k, v] of Object.entries(value)) formEncode(v, prefix ? `${prefix}[${k}]` : k, out);
  else out.push(`${encodeURIComponent(prefix)}=${encodeURIComponent(String(value))}`);
  return out;
}

// One call to Stripe: { status, data }. Never throws on an HTTP error; a network failure or the timeout throws.
export async function stripe(cfg, method, path, params, { timeoutMs = 10000, idempotencyKey } = {}) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  const qs = params ? formEncode(params).join("&") : "";
  const headers = { authorization: `Bearer ${cfg.key}`, accept: "application/json" };
  if (cfg.version) headers["stripe-version"] = cfg.version;
  if (method !== "GET") headers["content-type"] = "application/x-www-form-urlencoded";
  if (idempotencyKey) headers["idempotency-key"] = idempotencyKey;
  try {
    const r = await fetch(`${API}${path}${method === "GET" && qs ? `?${qs}` : ""}`, {
      method, headers, body: method === "GET" ? undefined : qs, signal: ctrl.signal
    });
    const text = await r.text();
    let data = null;
    try { data = text ? JSON.parse(text) : null; } catch { data = text; }
    return { status: r.status, data };
  } finally {
    clearTimeout(timer);
  }
}

// Stripe's own words for a failed call, without the key
export const stripeError = (r) => {
  const e = r && r.data && typeof r.data === "object" && r.data.error;
  return e ? [e.type, e.code, e.message].filter(Boolean).join(": ").slice(0, 300) : `HTTP ${r && r.status}`;
};

/* ---------- Webhook signatures. Stripe-Signature: t=1700000000,v1=<hex>[,v1=<hex>]: an HMAC-SHA256, keyed with the
   endpoint's whsec_ secret, of "<t>.<the raw body>". Five minutes of clock difference allowed. ---------- */
export function verifySignature(raw, header, secrets, { toleranceSec = 300, now = Date.now() } = {}) {
  if (!header) return { ok: false, reason: "no Stripe-Signature header" };
  const parts = String(header).split(",").map((p) => { const i = p.indexOf("="); return [p.slice(0, i).trim(), p.slice(i + 1).trim()]; });
  const t = Number((parts.find(([k]) => k === "t") || [])[1]);
  const sigs = parts.filter(([k, v]) => k === "v1" && /^[0-9a-f]{64}$/i.test(v)).map(([, v]) => Buffer.from(v, "hex"));
  if (!Number.isFinite(t) || !sigs.length) return { ok: false, reason: "malformed Stripe-Signature header" };
  if (Math.abs(now / 1000 - t) > toleranceSec) return { ok: false, reason: "the signature's time is more than 5 minutes off" };
  const body = Buffer.isBuffer(raw) ? raw : Buffer.from(String(raw), "utf8");
  for (const secret of secrets || []) {
    const expected = createHmac("sha256", secret).update(`${t}.`, "utf8").update(body).digest();
    if (sigs.some((s) => s.length === expected.length && timingSafeEqual(s, expected))) return { ok: true, timestamp: t };
  }
  return { ok: false, reason: "no signature matches the secret" };
}

/* ---------- The catalog: every plan's prices, read from Stripe by lookup key ---------- */
const KIND = {
  monthly: (p) => p.type === "recurring" && p.recurring && p.recurring.interval === "month" && (p.recurring.interval_count || 1) === 1,
  annual: (p) => p.type === "recurring" && p.recurring && p.recurring.interval === "year" && (p.recurring.interval_count || 1) === 1,
  setup: (p) => p.type === "one_time",
  once: (p) => p.type === "one_time",
  bump: (p) => p.type === "one_time"
};
const WANT = { monthly: "a monthly recurring price", annual: "a yearly recurring price", setup: "a one-time price", once: "a one-time price", bump: "a one-time price" };

const priceOf = (p) => ({ id: p.id, lookupKey: p.lookup_key, amount: p.unit_amount, currency: p.currency,
  name: (p.product && typeof p.product === "object" && p.product.name) || "" });

// Stripe's prices (by lookup key) -> { plans: { id: plan }, problems: [text], found: { lookupKey: true|false } }.
// A plan is offered when its main price is there and right: monthly or annual for a subscription, once for a payment.
export function buildCatalog(byKey) {
  const plans = {}, problems = [], found = {};
  for (const key of lookupKeys()) found[key] = Boolean(byKey[key]);
  for (const [id, def] of Object.entries(PLANS)) {
    const plan = { id, label: def.label, blurb: def.blurb, mode: def.mode, currency: null };
    const slots = { ...def.prices, ...(def.bump ? { bump: def.bump } : {}) };
    for (const [slot, key] of Object.entries(slots)) {
      const p = byKey[key];
      if (!p) continue;
      if (!KIND[slot](p)) { problems.push(`${key}: should be ${WANT[slot]}`); continue; }
      if (!Number.isInteger(p.unit_amount) || p.billing_scheme === "tiered") { problems.push(`${key}: needs a fixed amount per unit`); continue; }
      if (plan.currency && p.currency !== plan.currency) { problems.push(`${key}: its currency differs from the plan's other prices`); continue; }
      plan.currency = p.currency;
      plan[slot] = priceOf(p);
    }
    const offered = def.mode === "payment" ? Boolean(plan.once) : Boolean(plan.monthly || plan.annual);
    if (offered) plans[id] = plan;
  }
  return { plans, problems, found };
}

let cache = { at: 0, key: "", value: null };
export async function loadCatalog(cfg, { fresh = false } = {}) {
  if (!fresh && cache.value && cache.key === cfg.key && Date.now() - cache.at < 60_000) return cache.value;
  const keys = lookupKeys(), byKey = {};
  // Stripe filters at most 10 lookup keys per call
  for (let i = 0; i < keys.length; i += 10) {
    const r = await stripe(cfg, "GET", "/v1/prices", { lookup_keys: keys.slice(i, i + 10), active: "true", limit: 100, expand: ["data.product"] });
    if (r.status !== 200) throw Object.assign(new Error(`Stripe answered HTTP ${r.status} for the prices: ${stripeError(r)}`), { status: r.status });
    for (const p of (r.data && r.data.data) || []) if (p.lookup_key && (!p.product || p.product.active !== false)) byKey[p.lookup_key] = p;
  }
  const value = buildCatalog(byKey);
  cache = { at: Date.now(), key: cfg.key, value };
  return value;
}

// What /start may show: amounts and names, no Stripe ids
export function publicPlan(plan) {
  const out = { id: plan.id, label: plan.label, blurb: plan.blurb, mode: plan.mode, currency: plan.currency };
  for (const slot of ["monthly", "annual", "setup", "once", "bump"]) {
    if (plan[slot]) out[slot] = { amount: plan[slot].amount, name: plan[slot].name };
  }
  return out;
}

/* ---------- The Checkout Session: the plan, the setup fee unless annual, the optional add-on, the renewal terms by the
   button, the Terms of Service box, a one-hour life with a recovery link, and the buyer's answers as metadata ---------- */
const META_KEYS = ["first_name", "business", "phone", "runs", "software", "visit", "lead_id", "consent_email", "consent_phone", "notice_version", "page",
  "utm_source", "utm_medium", "utm_campaign", "utm_content", "utm_term", "fbclid", "gclid"];

export function sessionParams({ plan, billing, profiles, buyer, visit, leadId, origin, now = Date.now(), settings = SETTINGS }) {
  const n = plan.mode === "payment" ? 1 : Math.max(1, Math.min(settings.maxProfiles, Number(profiles) || 1));
  const items = [];
  if (plan.mode === "payment") {
    items.push({ price: plan.once.id, quantity: 1 });
  } else {
    const rec = billing === "annual" ? plan.annual : plan.monthly;
    items.push({ price: rec.id, quantity: n });
    if (plan.setup && !(billing === "annual" && settings.setupWaivedOnAnnual)) items.push({ price: plan.setup.id, quantity: settings.setupPerProfile ? n : 1 });
  }
  const raw = {
    source: SOURCE, plan: plan.id, billing: plan.mode === "payment" ? "once" : billing, profiles: String(n),
    first_name: buyer.firstName, business: buyer.business, phone: buyer.phone, runs: buyer.answers && buyer.answers.runs,
    software: buyer.answers && buyer.answers.software, visit, lead_id: leadId, consent_email: String(Boolean(buyer.consentEmail)),
    consent_phone: String(Boolean(buyer.consentPhone)), notice_version: buyer.noticeVersion, page: buyer.page, ...(buyer.utm || {})
  };
  // Stripe metadata: string values of at most 500 characters; empty ones left out
  const metadata = {};
  for (const k of ["source", "plan", "billing", "profiles", ...META_KEYS]) {
    const v = raw[k];
    if (v !== undefined && v !== null && String(v).trim() !== "") metadata[k] = String(v).trim().slice(0, 500);
  }
  const params = {
    mode: plan.mode,
    line_items: items,
    optional_items: plan.bump ? [{ price: plan.bump.id, quantity: settings.bumpPerProfile ? n : 1 }] : undefined,
    customer_email: buyer.email,
    client_reference_id: visit || undefined,
    success_url: `${origin}/start/welcome?session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${origin}/start?canceled=1`,
    // Needs the Terms of Service address in Stripe: Settings > Business > Public details (checkout/README.md)
    consent_collection: { terms_of_service: "required" },
    custom_text: { submit: { message: renewalText(plan, billing, n, settings) } },
    expires_at: Math.floor(now / 1000) + Math.max(30, settings.sessionMinutes) * 60,
    after_expiration: { recovery: { enabled: true } },
    allow_promotion_codes: settings.allowPromotionCodes ? true : undefined,
    metadata
  };
  if (plan.mode === "subscription") params.subscription_data = { metadata };
  else { params.payment_intent_data = { metadata }; params.customer_creation = "always"; }
  return params;
}
