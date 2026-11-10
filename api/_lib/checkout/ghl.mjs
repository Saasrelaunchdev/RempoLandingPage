// The handoff to the founder's GoHighLevel: when a buyer pays, the Stripe webhook creates or updates them as a contact in
// the founder's sub-account and adds the tag the founder's onboarding workflow starts on. What happens after that tag
// (the welcome, the onboarding form, the call) is built in GoHighLevel by the founder, not here.
//
// Settings, Vercel environment variables:
//   GHL_TOKEN          a Private Integration Token of the founder's sub-account (pit-...), with contacts write access
//   GHL_LOCATION_ID    that sub-account's id (Settings > Business Profile, or the address bar: /location/<id>/)
//   GHL_PAID_TAG       optional, default "rempo-paid": the tag added when someone pays. The founder's workflow starts on it
//   GHL_ABANDONED_TAG  optional, default "rempo-checkout-abandoned": added when a checkout expires unpaid, only for people
//                      who agreed to email
//   GHL_CUSTOM_FIELDS  optional, JSON: which contact custom fields to fill, detail -> field id, for example
//                      {"plan":"aBc123","recovery_url":"dEf456"}. Details: plan, billing, profiles, business, amount_paid,
//                      stripe_customer_id, checkout_id, recovery_url
import { formatMoney } from "../../../assets/checkout-shared.mjs";

const env = (n) => (process.env[n] ? String(process.env[n]).trim() : "");
const API = "https://services.leadconnectorhq.com";
const VERSION = "2021-07-28";
export const FIELD_NAMES = ["plan", "billing", "profiles", "business", "amount_paid", "stripe_customer_id", "checkout_id", "recovery_url"];

export function ghlConfig() {
  const token = env("GHL_TOKEN"), locationId = env("GHL_LOCATION_ID");
  let fields = {}, fieldsProblem = null;
  if (env("GHL_CUSTOM_FIELDS")) {
    try {
      const f = JSON.parse(env("GHL_CUSTOM_FIELDS"));
      if (!f || typeof f !== "object" || Array.isArray(f)) throw new Error("not an object");
      fields = Object.fromEntries(Object.entries(f).filter(([k, v]) => FIELD_NAMES.includes(k) && typeof v === "string" && v.trim()).map(([k, v]) => [k, v.trim()]));
    } catch { fieldsProblem = "GHL_CUSTOM_FIELDS is not valid JSON like {\"plan\":\"<field id>\"}"; }
  }
  const problem = !token || !locationId ? "missing" : null;
  return { ok: !problem, problem, token, locationId, fields, fieldsProblem,
    paidTag: env("GHL_PAID_TAG") || "rempo-paid", abandonedTag: env("GHL_ABANDONED_TAG") || "rempo-checkout-abandoned" };
}

// Why the handoff cannot run, in words the owner can act on (the alerts and /api/checkout?health=1)
export function ghlNotConnected(cfg) {
  const missing = [!cfg.token && "GHL_TOKEN", !cfg.locationId && "GHL_LOCATION_ID"].filter(Boolean).join(" and ");
  return `GoHighLevel is not connected: this deployment cannot see ${missing}. Set ${missing.includes(" and ") ? "them" : "it"} in Vercel, then redeploy`;
}

async function call(cfg, method, path, body, timeoutMs = 8000) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const r = await fetch(`${API}${path}`, {
      method,
      headers: { authorization: `Bearer ${cfg.token}`, version: VERSION, accept: "application/json", ...(body ? { "content-type": "application/json" } : {}) },
      body: body ? JSON.stringify(body) : undefined,
      signal: ctrl.signal
    });
    const text = await r.text();
    let data = null;
    try { data = text ? JSON.parse(text) : null; } catch { data = text; }
    return { status: r.status, data };
  } finally {
    clearTimeout(timer);
  }
}
const ok2 = (r) => r.status >= 200 && r.status < 300;
function failed(what, r) {
  const said = r.data && typeof r.data === "object" ? r.data.message || r.data.error : typeof r.data === "string" ? r.data : "";
  const hint = r.status === 401 || r.status === 403 ? " (the token was refused: check GHL_TOKEN, its access to contacts, and GHL_LOCATION_ID)" : r.status === 429 ? " (rate limited)" : "";
  return new Error(`GoHighLevel ${what} answered HTTP ${r.status}${hint}${said ? `: ${String(Array.isArray(said) ? said.join(", ") : said).slice(0, 200)}` : ""}`);
}

// US numbers as +1XXXXXXXXXX, the form GoHighLevel matches and texts; anything else as typed
export function e164(phone) {
  const d = String(phone || "").replace(/\D/g, "");
  if (d.length === 10) return `+1${d}`;
  if (d.length === 11 && d[0] === "1") return `+${d}`;
  return phone ? String(phone).trim() : "";
}

function customFields(cfg, values) {
  return Object.entries(cfg.fields).filter(([k]) => values[k] !== undefined && values[k] !== null && String(values[k]) !== "")
    .map(([k, id]) => ({ id, field_value: String(values[k]) }));
}

// Creates the contact, or updates the one GoHighLevel matches by email or phone. -> { id, tags }
export async function upsertContact(cfg, c) {
  const body = { locationId: cfg.locationId, source: "rempo.io checkout" };
  if (c.firstName) body.firstName = c.firstName;
  if (c.email) body.email = c.email;
  if (c.phone) body.phone = e164(c.phone);
  if (c.business) body.companyName = c.business;
  const fields = customFields(cfg, c.fields || {});
  if (fields.length) body.customFields = fields;
  const r = await call(cfg, "POST", "/contacts/upsert", body);
  if (!ok2(r)) throw failed("contact upsert", r);
  const contact = r.data && typeof r.data === "object" ? r.data.contact || r.data : null;
  const id = contact && (contact.id || contact._id);
  if (!id) throw new Error("GoHighLevel's contact upsert answered without a contact id");
  return { id: String(id), tags: Array.isArray(contact.tags) ? contact.tags.map(String) : [] };
}

export async function addTags(cfg, id, tags) {
  const r = await call(cfg, "POST", `/contacts/${encodeURIComponent(id)}/tags`, { tags });
  if (!ok2(r)) throw failed("add tags", r);
}
export async function removeTags(cfg, id, tags) {
  const r = await call(cfg, "DELETE", `/contacts/${encodeURIComponent(id)}/tags`, { tags });
  if (!ok2(r)) throw failed("remove tags", r);
}
export async function addNote(cfg, id, body) {
  const r = await call(cfg, "POST", `/contacts/${encodeURIComponent(id)}/notes`, { body: String(body).slice(0, 5000) });
  if (!ok2(r)) throw failed("add note", r);
}

// For /api/checkout?health=1: does the token reach the sub-account's contacts? -> HTTP status
export async function ghlPing(cfg) {
  const r = await call(cfg, "GET", `/contacts/?locationId=${encodeURIComponent(cfg.locationId)}&limit=1`, undefined, 5000);
  return r.status;
}

const yes = (b) => (b ? "yes" : "no");
const money = (p) => (Number.isFinite(p.amountTotal) ? formatMoney(p.amountTotal, p.currency) : "");

// The tags of a purchase: the paid tag the founder's workflow starts on, then the plan, billing, profiles and consents.
// A purchase made with Stripe's test keys also gets rempo-test-mode, so test buyers are easy to filter out.
export function purchaseTags(cfg, p) {
  return [cfg.paidTag, p.plan && `rempo-plan-${p.plan}`, p.billing && `rempo-billing-${p.billing}`, `rempo-profiles-${p.profiles || 1}`,
    p.bump && "rempo-addon-bought", p.consentEmail && "rempo-email-ok", p.consentPhone && "rempo-texts-ok", !p.livemode && "rempo-test-mode"].filter(Boolean);
}

export function purchaseNote(p) {
  const utm = Object.entries(p.utm || {}).map(([k, v]) => `${k}=${v}`).join(", ");
  return [
    `Paid on rempo.io: ${p.planLabel}${p.billing && p.billing !== "once" ? `, ${p.billing}` : ""}${p.billing !== "once" ? `, ${p.profiles} Google profile${p.profiles > 1 ? "s" : ""}` : ""}`,
    `Business: ${p.business || "(not given)"}`,
    `Paid today: ${money(p) || "(see Stripe)"}${p.bump ? ", with the add-on" : ""}`,
    `Answers: who runs it = ${p.answers.runs || "?"}; software records every job = ${p.answers.software || "?"}`,
    `Consent: email ${yes(p.consentEmail)}, texts ${yes(p.consentPhone)}${p.noticeVersion ? ` (notice ${p.noticeVersion})` : ""}; Terms accepted at checkout: ${yes(p.termsAccepted)}`,
    `Stripe: customer ${p.customerId || "?"}${p.subscriptionId ? `, subscription ${p.subscriptionId}` : ""}, checkout ${p.sessionId}${p.livemode ? "" : " (TEST MODE)"}`,
    utm ? `Came from: ${utm}` : ""
  ].filter(Boolean).join("\n");
}

function fieldValues(p) {
  return { plan: p.planLabel, billing: p.billing, profiles: p.profiles, business: p.business, amount_paid: money(p), stripe_customer_id: p.customerId,
    checkout_id: p.sessionId, recovery_url: p.recoveryUrl };
}

// A paid checkout -> the contact, its tags (the abandoned tag taken off), and a note with the whole order. -> { contactId }
export async function handOffPurchase(cfg, p) {
  const c = await upsertContact(cfg, { firstName: p.firstName, email: p.email, phone: p.phone, business: p.business, fields: fieldValues(p) });
  await addTags(cfg, c.id, purchaseTags(cfg, p));
  // Bought after all: out of the abandoned-checkout follow-up (best effort; a missing tag is not an error)
  try { await removeTags(cfg, c.id, [cfg.abandonedTag]); } catch { /* nothing to remove */ }
  await addNote(cfg, c.id, purchaseNote(p));
  return { contactId: c.id };
}

// An expired, unpaid checkout of someone who agreed to email -> the contact with the abandoned tag and the recovery link,
// unless they already paid. -> { contactId, skipped? }
export async function handOffAbandoned(cfg, p) {
  const c = await upsertContact(cfg, { firstName: p.firstName, email: p.email, phone: p.phone, business: p.business,
    fields: { recovery_url: p.recoveryUrl, plan: p.planLabel, business: p.business } });
  if (c.tags.includes(cfg.paidTag)) return { contactId: c.id, skipped: "already paid" };
  await addTags(cfg, c.id, [cfg.abandonedTag]);
  await addNote(cfg, c.id, [
    `Started a checkout on rempo.io and did not finish it: ${p.planLabel}${p.billing && p.billing !== "once" ? `, ${p.billing}` : ""}`,
    p.recoveryUrl ? `Their checkout, ready to finish (valid 30 days): ${p.recoveryUrl}` : "",
    `Business: ${p.business || "(not given)"}. Agreed to email: yes${p.livemode ? "" : ". TEST MODE"}`
  ].filter(Boolean).join("\n"));
  return { contactId: c.id };
}
