// /api/checkout: the self-serve checkout on /start (setup and placeholders: checkout/README.md).
//
//   GET                     the plans on sale and their prices, read from Stripe by lookup key: what /start shows.
//                           A plan whose prices are not in Stripe is not on sale; its buyers are sent to the call.
//   GET ?session_id=cs_...  what the thank-you page (/start/welcome) shows: whether the payment went through, the buyer's
//                           first name and email, and the founder's onboarding link with their details filled in
//   GET ?health=1           what this deployment sees and what to fix: names and true or false, never a value
//   POST                    the buyer's answers and details from /start: stored as the lead "checkout-start" (best
//                           effort), then a Stripe Checkout Session is opened. Answers { url } for the browser to go to.
//
// Closed until it is opened: with a live Stripe key, no session is opened until CHECKOUT_OPEN=true. A test key always
// works, so the whole path can be tried with Stripe's test cards before launch.
import { createHash } from "node:crypto";
import { send, readJson, supabaseConfig, rest, deployment, notConnected } from "./_lib/lead-store.mjs";
import { normalize, EMAIL, HONEYPOT } from "./_lib/lead-fields.mjs";
import { notifyConfig } from "./_lib/lead-notify.mjs";
import { PLANS, SETTINGS, SOURCE, checkoutOpenFlag } from "./_lib/checkout/config.mjs";
import { stripeConfig, stripe, stripeError, loadCatalog, publicPlan, sessionParams } from "./_lib/checkout/stripe.mjs";
import { ghlConfig, ghlPing, ghlNotConnected, e164 } from "./_lib/checkout/ghl.mjs";
import { storeConfig, storeHealth, storeNotConnected } from "./_lib/checkout/store.mjs";
import { routeFor } from "../assets/checkout-shared.mjs";

const env = (n) => (process.env[n] ? String(process.env[n]).trim() : "");
const VARS = ["STRIPE_SECRET_KEY", "STRIPE_WEBHOOK_SECRET", "CHECKOUT_OPEN", "SUPABASE_URL", "SUPABASE_ANON_KEY", "SUPABASE_SECRET_KEY",
  "GHL_TOKEN", "GHL_LOCATION_ID", "GHL_CUSTOM_FIELDS", "ONBOARDING_URL", "RESEND_API_KEY", "LEAD_NOTIFY_FROM", "LEAD_NOTIFY_TO", "SLACK_WEBHOOK_URL"];
const UTM = ["utm_source", "utm_medium", "utm_campaign", "utm_content", "utm_term", "fbclid", "gclid"];
const COULD_NOT_START = "Checkout could not open. Please try again in a minute, or book a 15-minute call.";
const CATALOG_CACHE = "public, max-age=0, s-maxage=60, stale-while-revalidate=300";

const host = (req) => String(req.headers["x-forwarded-host"] || req.headers.host || "").split(",")[0].trim();
function originOf(req) {
  const h = host(req);
  const proto = String(req.headers["x-forwarded-proto"] || "").split(",")[0].trim() || (/^(localhost|127\.0\.0\.1)(:\d+)?$/.test(h) ? "http" : "https");
  return `${proto}://${h}`;
}
// Only the site's own pages may post here (a browser always sends Origin with a POST)
function sameOrigin(req) {
  const origin = req.headers.origin;
  if (!origin || !host(req)) return true;
  try { return new URL(origin).host === host(req); } catch { return false; }
}
const isOpen = (cfg) => cfg.ok && (cfg.mode === "test" || checkoutOpenFlag());

export default async function handler(req, res) {
  if (req.method === "GET" || req.method === "HEAD") {
    const q = new URL(req.url || "/", "http://local").searchParams;
    if (q.has("health")) return health(req, res);
    if (q.get("session_id")) return summary(res, q.get("session_id"));
    return catalog(res);
  }
  if (req.method === "POST") return create(req, res);
  res.setHeader("allow", "GET, POST");
  return send(res, 405, { error: "method not allowed" });
}

/* ---------- GET: the plans on sale ---------- */
function shownSettings() {
  return { maxProfiles: SETTINGS.maxProfiles, guarantee: SETTINGS.guarantee, setupPerProfile: SETTINGS.setupPerProfile,
    setupWaivedOnAnnual: SETTINGS.setupWaivedOnAnnual, supportEmail: SETTINGS.supportEmail };
}
async function catalog(res) {
  const cfg = stripeConfig();
  const base = { open: false, mode: cfg.mode, settings: shownSettings(), plans: {} };
  if (!cfg.ok) return send(res, 200, { ...base, reason: "not-configured" }, CATALOG_CACHE);
  if (!isOpen(cfg)) return send(res, 200, { ...base, reason: "closed" }, CATALOG_CACHE);
  try {
    const c = await loadCatalog(cfg);
    const plans = Object.fromEntries(Object.entries(c.plans).map(([id, p]) => [id, publicPlan(p)]));
    return send(res, 200, { ...base, open: Object.keys(plans).length > 0, plans, reason: Object.keys(plans).length ? null : "no-prices" }, CATALOG_CACHE);
  } catch (e) {
    console.error("checkout catalog failed:", e && e.message);
    return send(res, 200, { ...base, reason: "unavailable" });
  }
}

/* ---------- GET ?session_id=: the thank-you page ---------- */
function onboardingLink(details) {
  const base = env("ONBOARDING_URL");
  if (!/^https:\/\/[^\s]+$/i.test(base)) return null;
  try {
    const u = new URL(base);
    for (const [param, key] of Object.entries(SETTINGS.onboardingPrefill)) {
      const v = details[key];
      if (v && !u.searchParams.has(param)) u.searchParams.set(param, v);
    }
    return u.toString();
  } catch {
    return null;
  }
}
async function summary(res, sessionId) {
  if (!/^cs_(test|live)_[A-Za-z0-9]{10,200}$/.test(sessionId)) return send(res, 400, { error: "invalid session" });
  const cfg = stripeConfig();
  if (!cfg.ok) return send(res, 503, { error: "not configured", support: SETTINGS.supportEmail });
  let r;
  try { r = await stripe(cfg, "GET", `/v1/checkout/sessions/${encodeURIComponent(sessionId)}`); } catch (e) {
    console.error("checkout summary: Stripe did not answer:", e && e.message);
    return send(res, 502, { error: "unavailable", support: SETTINGS.supportEmail });
  }
  if (r.status === 404) return send(res, 404, { error: "not found", support: SETTINGS.supportEmail });
  if (r.status !== 200 || !r.data) {
    console.error("checkout summary failed:", r.status, stripeError(r));
    return send(res, 502, { error: "unavailable", support: SETTINGS.supportEmail });
  }
  const s = r.data, m = s.metadata || {};
  if (m.source !== SOURCE) return send(res, 404, { error: "not found", support: SETTINGS.supportEmail });
  const paid = s.status === "complete" && (s.payment_status === "paid" || s.payment_status === "no_payment_required");
  const email = String((s.customer_details && s.customer_details.email) || s.customer_email || "");
  const plan = PLANS[m.plan];
  return send(res, 200, {
    paid,
    processing: s.status === "complete" && !paid,
    expired: s.status === "expired",
    firstName: m.first_name || "",
    business: m.business || "",
    email,
    plan: plan ? plan.label : "",
    test: !s.livemode,
    onboardingUrl: paid ? onboardingLink({ firstName: m.first_name, email, phone: e164(m.phone), business: m.business }) : null,
    support: SETTINGS.supportEmail
  });
}

/* ---------- POST: open a Checkout Session ---------- */
const str = (v, max) => (typeof v === "string" ? v.trim().slice(0, max) : typeof v === "number" ? String(v) : "");
const ticked = (v) => v === true || (typeof v === "string" && /^(on|true|yes|1)$/i.test(v.trim()));

// The form's fields, checked. -> { input } or { errors: { field: message } }
export function readInput(body) {
  const a = body.answers && typeof body.answers === "object" ? body.answers : {};
  const answers = { profiles: str(a.profiles, 4), software: str(a.software, 10), runs: str(a.runs, 10) };
  const errors = {};
  if (routeFor(answers).to === "incomplete") errors.answers = "Please answer the three questions.";
  const firstName = str(body.firstName, 100), business = str(body.business, 200), email = str(body.email, 254).toLowerCase(), phone = str(body.phone, 40);
  const digits = phone.replace(/\D/g, "");
  if (!firstName) errors.firstName = "Please enter your first name.";
  if (!business) errors.business = "Please enter your business name.";
  if (!EMAIL.test(email)) errors.email = "Please enter a valid email.";
  if (!(digits.length === 10 || (digits.length === 11 && digits[0] === "1"))) errors.phone = "Please enter a 10-digit phone number.";
  if (Object.keys(errors).length) return { errors };
  const utmIn = body.utm && typeof body.utm === "object" ? body.utm : {};
  const utm = {};
  for (const k of UTM) { const v = str(utmIn[k] ?? body[k], 200); if (v) utm[k] = v; }
  return { input: {
    answers, billing: body.billing === "annual" ? "annual" : "monthly", firstName, business, email, phone,
    consentEmail: ticked(body.consentEmail), consentPhone: ticked(body.consentPhone),
    visit: /^[A-Za-z0-9_-]{6,64}$/.test(str(body.visit, 64)) ? str(body.visit, 64) : "",
    noticeVersion: str(body.noticeVersion, 40), page: str(body.page, 300), utm
  } };
}

// The checkout-start lead, stored the way /api/lead stores every form (public.submit_lead), so an abandoned checkout is
// a lead too. Best effort: a database problem never stops a sale. -> the lead's id, or ""
async function storeLead(req, input, plan, billing) {
  const cfg = supabaseConfig();
  if (!cfg.ok) { console.error(`checkout-start lead not stored: ${notConnected(cfg)}`); return ""; }
  const lead = normalize({ form: "checkout-start", firstName: input.firstName, company: input.business, email: input.email, phone: input.phone,
    consentEmail: input.consentEmail, consentPhone: input.consentPhone, plan, billing, profiles: input.answers.profiles,
    runsIt: input.answers.runs, software: input.answers.software, visit: input.visit, noticeVersion: input.noticeVersion,
    page: input.page, ...input.utm });
  const ip = String(req.headers["x-forwarded-for"] || req.headers["x-real-ip"] || "").split(",")[0].trim();
  const salt = process.env.LEAD_HASH_SALT || cfg.url || "lead-capture";
  const payload = { ...lead, ip_hash: ip ? createHash("sha256").update(`${salt}|${ip}`).digest("hex") : null };
  try {
    const r = await rest(cfg, "rpc/submit_lead", { method: "POST", body: { payload }, timeoutMs: 4000 });
    if (r.status === 200 && typeof r.data === "string") return r.data;
    console.error("checkout-start lead not stored:", r.status, typeof r.data === "object" ? JSON.stringify(r.data).slice(0, 200) : r.data);
  } catch (e) {
    console.error("checkout-start lead not stored:", e && e.message);
  }
  return "";
}

async function create(req, res) {
  if (!sameOrigin(req)) return send(res, 403, { error: "forbidden" });
  let body;
  try { body = await readJson(req); } catch (e) { return send(res, e.status || 400, { error: "invalid request" }); }
  if (!body || typeof body !== "object" || Array.isArray(body)) return send(res, 400, { error: "invalid request" });
  // A bot filled the field people never see: answer like a success, open nothing
  if ([...HONEYPOT, "website"].some((k) => typeof body[k] === "string" && body[k].trim())) return send(res, 200, { ok: true });

  const read = readInput(body);
  if (read.errors) return send(res, 400, { error: "Please check the form.", fields: read.errors });
  const input = read.input;

  const cfg = stripeConfig();
  if (!isOpen(cfg)) return send(res, 503, { error: "Online checkout isn't open yet. Please book a 15-minute call.", route: "call" });

  let catalogOut;
  try { catalogOut = await loadCatalog(cfg); } catch (e) {
    console.error("checkout: the prices could not be read:", e && e.message);
    return send(res, 502, { error: COULD_NOT_START, route: "call" });
  }
  // The server decides the plan from the answers, the same way the page does
  const route = routeFor(input.answers, (id) => Boolean(catalogOut.plans[id]));
  if (route.to !== "plan") return send(res, 409, { error: "Let's talk it through first: book a 15-minute call.", route: "call", why: route.why });
  const plan = catalogOut.plans[route.plan];
  const billing = plan.mode === "payment" ? "once" : input.billing === "annual" && plan.annual ? "annual" : plan.monthly ? "monthly" : "annual";

  const leadId = await storeLead(req, input, route.plan, billing);
  const params = sessionParams({ plan, billing, profiles: Number(input.answers.profiles), buyer: input, visit: input.visit, leadId, origin: originOf(req) });
  let r;
  try { r = await stripe(cfg, "POST", "/v1/checkout/sessions", params); } catch (e) {
    console.error("checkout session: Stripe did not answer:", e && e.message);
    return send(res, 502, { error: COULD_NOT_START, route: "call" });
  }
  if (r.status !== 200 || !r.data || !r.data.url) {
    console.error("checkout session failed:", r.status, stripeError(r));
    return send(res, 502, { error: COULD_NOT_START, route: "call" });
  }
  return send(res, 200, { ok: true, url: r.data.url, plan: route.plan, billing });
}

/* ---------- GET ?health=1: what works and what to fix. Names and true or false only, never a value ---------- */
async function health(req, res) {
  const cfg = stripeConfig(), ghl = ghlConfig(), store = storeConfig(), leads = supabaseConfig(), n = notifyConfig();
  const vars = Object.fromEntries(VARS.map((k) => [k, Boolean(env(k))]));

  const stripeOut = { ok: cfg.ok, mode: cfg.mode, webhookSecret: cfg.webhookSecrets.length > 0 };
  if (!cfg.ok) stripeOut.fix = cfg.problem === "bad-key" ? "STRIPE_SECRET_KEY must start with sk_test_, sk_live_, rk_test_ or rk_live_" : "Set STRIPE_SECRET_KEY in Vercel, then redeploy";
  else {
    try {
      const c = await loadCatalog(cfg, { fresh: true });
      stripeOut.plansOnSale = Object.keys(c.plans);
      stripeOut.prices = c.found;
      if (c.problems.length) stripeOut.problems = c.problems;
      if (!stripeOut.plansOnSale.length) stripeOut.fix = "No plan is on sale: create the prices with the lookup keys in checkout/README.md";
    } catch (e) {
      stripeOut.ok = false;
      stripeOut.fix = `Stripe refused the key or did not answer (${String(e && e.message).slice(0, 160)})`;
    }
  }
  if (!stripeOut.webhookSecret) stripeOut.webhookFix = "Set STRIPE_WEBHOOK_SECRET (whsec_...) from the webhook endpoint for https://<the-site>/api/stripe-webhook";
  const open = isOpen(cfg) && Boolean(stripeOut.plansOnSale && stripeOut.plansOnSale.length);
  if (cfg.mode === "live" && !checkoutOpenFlag()) stripeOut.closed = "Live key set: checkout stays closed until CHECKOUT_OPEN=true";

  const purchases = { ok: false };
  if (!store.ok) purchases.fix = storeNotConnected(store);
  else {
    try { purchases.schema = await storeHealth(store); purchases.ok = purchases.schema === "checkout v1"; } catch (e) { purchases.fix = `Supabase: ${String(e && e.message).slice(0, 160)}`; }
  }

  const gohighlevel = { ok: false, paidTag: ghl.paidTag, abandonedTag: ghl.abandonedTag, customFields: Object.keys(ghl.fields) };
  if (ghl.fieldsProblem) gohighlevel.fieldsFix = ghl.fieldsProblem;
  if (!ghl.ok) gohighlevel.fix = ghlNotConnected(ghl);
  else {
    try {
      const status = await ghlPing(ghl);
      gohighlevel.ok = status === 200;
      if (!gohighlevel.ok) gohighlevel.fix = `GoHighLevel answered HTTP ${status}${status === 401 || status === 403 ? ": the token was refused, or lacks contacts access, or GHL_LOCATION_ID is another sub-account" : ""}`;
    } catch (e) { gohighlevel.fix = `GoHighLevel did not answer (${String(e && e.message).slice(0, 120)})`; }
  }

  const url = env("ONBOARDING_URL");
  const onboarding = { ok: /^https:\/\/[^\s]+$/i.test(url), ...(url ? {} : { fix: "Set ONBOARDING_URL to the founder's GoHighLevel onboarding link (https://...)" }) };
  if (url && !onboarding.ok) onboarding.fix = "ONBOARDING_URL must be a full https:// address";

  const notices = { email: Boolean(n.email), slack: Boolean(n.slack) };
  const leadsOut = { ok: leads.ok, ...(leads.ok ? {} : { fix: notConnected(leads) }) };
  const placeholders = [SETTINGS.guarantee ? null : "guarantee: no guarantee line yet (api/_lib/checkout/config.mjs)"].filter(Boolean);
  const ready = Boolean(stripeOut.ok && stripeOut.webhookSecret && stripeOut.plansOnSale && stripeOut.plansOnSale.length && purchases.ok && gohighlevel.ok && onboarding.ok);
  send(res, 200, { ready, open, stripe: stripeOut, purchases, gohighlevel, onboarding, leads: leadsOut, notices, placeholders, deployment: deployment(), vars });
}
