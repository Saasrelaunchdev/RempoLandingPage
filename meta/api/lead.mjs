// The Meta ads page's lead endpoint, served at /api/meta-lead by the root api/meta-lead.mjs (it runs this file): where
// the Gap Check and the call step on /customers send their leads.
//
//   POST  a lead, as JSON: the Gap Check ("meta-gap-report") or the call step ("meta-call"). The answers are scored
//         again here (lib/gapcheck.mjs), so nothing stored or sent to Meta trusts the browser. Stored in the same
//         Supabase table as the master page, through public.submit_lead() (../lead-capture/leads.sql); announced to
//         the owner by email (Resend) and in Slack exactly as the master page does (api/_lib, copied from ../api/_lib).
//         Then, for qualified answers only, Lead or Schedule to Meta's Conversions API with the browser's event id;
//         and, when set up, the prospect's own email. If Supabase fails, the notices still go, marked NOT SAVED.
//   GET   a health report: which settings this deployment sees (true or false, never a value), whether the database
//         answers with the lead-capture schema, and what to fix. Open https://<the-site>/api/meta-lead after every change.
//
// Settings are the master page's Vercel environment variables: its seven (SUPABASE_URL, SUPABASE_ANON_KEY, LEAD_HASH_SALT,
// RESEND_API_KEY, LEAD_NOTIFY_FROM, LEAD_NOTIFY_TO, SLACK_WEBHOOK_URL), plus META_PIXEL_ID, META_CAPI_TOKEN,
// META_TEST_EVENT_CODE, META_GRAPH_VERSION, PROSPECT_EMAIL_FROM, PROSPECT_REPLY_TO. See README.md.
import { createHash } from "node:crypto";
import { supabaseConfig, rest, notConnected, refused, unreachable, deployment, send, readJson } from "./_lib/lead-store.mjs";
import { normalize, HONEYPOT, EMAIL } from "./_lib/lead-fields.mjs";
import { notifyConfig, notifyLead } from "./_lib/lead-notify.mjs";
import { capiConfig, userData, capiEvent, sendCapi, FBC, FBP, EVENT_ID } from "./_lib/capi.mjs";
import { prospectConfig, compose, sendProspect } from "./_lib/prospect-email.mjs";
import { evaluate, usPhone, dayAllowed, dayLabel, windowOf } from "../lib/gapcheck.mjs";
import SURVEY from "../content/survey.mjs";
import SITE from "../content/site.mjs";
import EMAILS from "../content/emails.mjs";

export const SETTINGS = { site: "Rempo (Meta)" };

const FORMS = new Set([SURVEY.form, SURVEY.callForm]);
const VARS = ["SUPABASE_URL", "SUPABASE_ANON_KEY", "LEAD_HASH_SALT", "RESEND_API_KEY", "LEAD_NOTIFY_FROM", "LEAD_NOTIFY_TO", "SLACK_WEBHOOK_URL",
  "META_PIXEL_ID", "META_CAPI_TOKEN", "META_TEST_EVENT_CODE", "META_GRAPH_VERSION", "PROSPECT_EMAIL_FROM", "PROSPECT_REPLY_TO"];
const host = (req) => String(req.headers["x-forwarded-host"] || req.headers.host || "").split(",")[0].trim();
const header = (req, n) => String(req.headers[n] || "").split(",")[0].trim();
const str = (v, max) => (typeof v === "string" ? v.trim().slice(0, max) : "");
const bad = (res, error, extra) => send(res, 400, { error, ...extra });

export default async function handler(req, res) {
  if (req.method === "GET" || req.method === "HEAD") return health(req, res);
  if (req.method !== "POST") {
    res.setHeader("allow", "GET, POST");
    return send(res, 405, { error: "method not allowed" });
  }
  // Only this site's own pages may post here (a browser always sends Origin with a POST)
  const origin = req.headers.origin;
  if (origin && host(req)) {
    let ok = false;
    try { ok = new URL(origin).host === host(req); } catch { ok = false; }
    if (!ok) return send(res, 403, { error: "forbidden" });
  }
  let body;
  try { body = await readJson(req); } catch (e) { return send(res, e.status || 400, { error: "invalid request" }); }
  if (!body || typeof body !== "object" || Array.isArray(body)) return send(res, 400, { error: "invalid request" });
  // A bot filled a field people never see: answer like a success, store and send nothing
  if (HONEYPOT.some((k) => typeof body[k] === "string" && body[k].trim())) return send(res, 200, { ok: true });
  if (!FORMS.has(body.form)) return bad(res, "Unknown form");
  const isCall = body.form === SURVEY.callForm;

  const lead = normalize(body);
  const raw = lead.fields;
  const t = raw.tracking && typeof raw.tracking === "object" && !Array.isArray(raw.tracking) ? raw.tracking : {};

  /* ---------- Check: every answer, the contact details, the consent ---------- */
  const ev = evaluate(SURVEY, raw);
  if (!ev.ok) return bad(res, "Please answer every question", { missing: ev.missing });
  if (!lead.email || !EMAIL.test(lead.email)) return bad(res, "A valid email is required");
  if (!lead.name) return bad(res, "Your first name is required");
  const city = str(raw.city, 80);
  if (!lead.company || !city) return bad(res, "Your business name and city are required");
  let slot = null;
  if (isCall) {
    const phone = usPhone(lead.phone);
    if (!phone) return bad(res, "A 10-digit phone number is required");
    if (lead.consent.consentPhone !== true) return bad(res, "Consent to call is required");
    const win = windowOf(SURVEY, raw.slotWindow);
    if (!win || !dayAllowed(raw.slotDay, new Date(), 14)) return bad(res, "Please pick a day and a time");
    lead.phone = phone;
    slot = { day: raw.slotDay, window: win };
  } else if (lead.consent.consentEmail !== true) {
    return bad(res, "Consent is required");
  }

  /* ---------- What is kept: the scored answers and the result in fields; campaign and Meta ids in meta ---------- */
  lead.fields = {
    ...ev.answers,
    city,
    score: ev.score,
    tier: ev.tier,
    fit: ev.fit,
    route: ev.callOnly ? `call (${ev.why})` : "call or checkout",
    gaps: ev.gaps.map((g) => g.key),
    variant: str(raw.variant, 40),
    visit: str(raw.visit, 64),
    // The consent and policy wording this lead agreed to (site.noticeVersion, legal-src/settings.mjs)
    noticeVersion: /^\d{4}-\d{2}-\d{2}$/.test(str(raw.noticeVersion, 10)) ? str(raw.noticeVersion, 10) : "",
    tz: /^[A-Za-z_]+(\/[A-Za-z0-9_+-]+){0,2}$/.test(str(raw.tz, 64)) ? str(raw.tz, 64) : "",
    ...(slot ? { slotDay: slot.day, slotWindow: slot.window.v } : {})
  };
  for (const k of Object.keys(lead.fields)) if (lead.fields[k] === "") delete lead.fields[k];
  const eventKey = isCall ? "scheduleEventId" : "leadEventId";
  const eventId = EVENT_ID.test(str(t[eventKey], 80)) ? str(t[eventKey], 80) : `${isCall ? "schedule" : "lead"}-${createHash("sha256").update(`${lead.fields.visit || lead.email}|${body.form}`).digest("hex").slice(0, 24)}`;
  const gpc = t.gpc === true;
  // The visitor's choice about advertising tools (the cookie notice or /legal/privacy-choices): "denied", like Global
  // Privacy Control, is an opt-out of sharing, so nothing about this lead goes to Meta
  const adsConsent = ["granted", "denied", "unset"].includes(t.consent) ? t.consent : "unset";
  const optedOut = gpc || adsConsent === "denied";
  const fbc = !optedOut && FBC.test(str(t.fbc, 600)) ? str(t.fbc, 600) : "";
  const fbp = !optedOut && FBP.test(str(t.fbp, 60)) ? str(t.fbp, 60) : "";
  lead.meta = { ...lead.meta, ...(fbc ? { fbc } : {}), ...(fbp ? { fbp } : {}), meta_event_id: eventId, ads_consent: adsConsent, ...(gpc ? { gpc: "true" } : {}) };

  /* ---------- Store ---------- */
  const cfg = supabaseConfig();
  const notices = notifyConfig();
  const ip = String(req.headers["x-forwarded-for"] || req.headers["x-real-ip"] || "").split(",")[0].trim();
  const salt = process.env.LEAD_HASH_SALT || cfg.url || "lead-capture";
  const payload = { ...lead, ip_hash: ip ? createHash("sha256").update(`${salt}|${ip}`).digest("hex") : null };
  const healthUrl = host(req) ? `https://${host(req)}${SITE.endpoint}` : "";
  // The owner's notice shows the campaign, not the Meta ids
  const forNotice = { ...lead, meta: Object.fromEntries(Object.entries(lead.meta).filter(([k]) => !["fbc", "fbp", "meta_event_id", "gpc", "ads_consent"].includes(k))) };

  let stored = false, id = "", reason;
  if (cfg.ok) {
    try {
      const r = await rest(cfg, "rpc/submit_lead", { method: "POST", body: { payload } });
      if (r.status === 200) { stored = true; id = typeof r.data === "string" ? r.data : ""; }
      else {
        const message = r.data && typeof r.data === "object" && r.data.message;
        if (r.status === 400) return bad(res, message || "invalid lead");
        if (r.status === 429) return send(res, 429, { error: message || "too many submissions" });
        console.error("submit_lead failed", r.status, typeof r.data === "string" ? r.data.slice(0, 300) : r.data);
        reason = refused(r.status, r.data);
      }
    } catch (e) {
      console.error("submit_lead error", e && e.message);
      reason = unreachable(e);
    }
  } else {
    console.error(`Supabase is not connected (${cfg.problem}): the lead is sent by the notices only`);
    reason = notConnected(cfg);
  }
  if (!stored && !cfg.ok && !notices.email && !notices.slack) return send(res, 503, { error: "not configured", configured: false, problem: cfg.problem });

  /* ---------- Then, together: the owner's notices, Meta (qualified only), the prospect's email ---------- */
  const jobs = {
    notify: notifyLead(forNotice, stored ? { stored: true, id, site: SETTINGS.site } : { stored: false, reason, deployment: deployment(), healthUrl, site: SETTINGS.site }),
    capi: toMeta({ req, lead, ev, isCall, eventId, fbc, fbp, optedOut }),
    prospect: toProspect({ lead, ev, slot, isCall, id })
  };
  const [n, , p] = await Promise.all([jobs.notify, jobs.capi, jobs.prospect]);
  if (!stored && !(n.email || n.slack)) return send(res, 502, { error: "could not store the lead" });
  return send(res, 200, { ok: true, ...(stored ? {} : { stored: false }), confirmEmail: p === true });
}

/* ---------- Meta: Lead or Schedule, for qualified answers only (pixel conditioning), never after an opt-out (Global
   Privacy Control or a declined cookie notice), and never with the phone number: the privacy policy promises that
   mobile numbers and texting consent are not shared for marketing (carrier rules for A2P 10DLC) ---------- */
async function toMeta({ req, lead, ev, isCall, eventId, fbc, fbp, optedOut }) {
  const cfg = capiConfig();
  if (!cfg || !ev.qualified || optedOut) return null;
  const page = lead.meta.page || lead.meta.pageUrl || "";
  const user = userData({
    email: lead.email, firstName: lead.name, city: lead.fields.city, country: "us",
    externalId: lead.fields.visit, ip: header(req, "x-forwarded-for") || header(req, "x-real-ip"), ua: header(req, "user-agent"), fbc, fbp
  });
  const event = capiEvent({
    name: isCall ? "Schedule" : "Lead",
    id: eventId,
    time: Math.floor(Date.now() / 1000),
    sourceUrl: /^https?:\/\//.test(page) ? page.slice(0, 1000) : "",
    user,
    custom: { content_name: isCall ? "Gap Report call" : "Gap Report", content_category: ev.tier, variant: lead.fields.variant || "" }
  });
  try { await sendCapi(cfg, [event]); return true; } catch (e) { console.error("Conversions API:", e && e.message); return false; }
}

/* ---------- The prospect's email: the score now, or the call's details ---------- */
async function toProspect({ lead, ev, slot, isCall, id }) {
  const cfg = prospectConfig();
  if (!cfg) return null;
  // CAN-SPAM: who sends, the postal address (once site.postalAddress is set), how to opt out; then the privacy policy
  const home = SITE.url || SITE.masterUrl;
  const privacy = home && SITE.privacyUrl ? `${EMAILS.privacy} ${new URL(SITE.privacyUrl, home).href}` : "";
  const footer = [SITE.company, SITE.postalAddress, EMAILS.unsubscribe, privacy];
  const base = { firstName: lead.name, business: lead.company, service: ev.service, city: lead.fields.city, turnaround: SITE.reportTurnaround };
  let msg;
  if (isCall) {
    const p = lead.phone;
    msg = compose(EMAILS.call, { ...base, day: dayLabel(slot.day), window: slot.window.label.toLowerCase(), hours: slot.window.hint, phone: `(${p.slice(0, 3)}) ${p.slice(3, 6)}-${p.slice(6)}` }, { signoff: EMAILS.signoff, footer });
  } else {
    msg = compose(EMAILS.report, { ...base, score: ev.score, tier: ev.tierName }, { signoff: EMAILS.signoff, footer, gaps: ev.gaps });
  }
  try {
    await sendProspect(cfg, lead.email, msg, `prospect-${isCall ? "call" : "report"}-${id || lead.fields.visit || lead.email}`);
    return true;
  } catch (e) {
    console.error("prospect email:", e && e.message);
    return false;
  }
}

// GET /api/meta-lead: what this deployment sees and whether each part works. Names and true or false only, never a value.
async function health(req, res) {
  const cfg = supabaseConfig();
  const n = notifyConfig();
  const dep = deployment();
  const vars = Object.fromEntries(VARS.map((k) => [k, Boolean(process.env[k] && String(process.env[k]).trim())]));
  let database;
  if (!cfg.ok) {
    const preview = cfg.problem === "missing" && dep.env === "preview"
      ? " This is a Preview deployment: it sees only the variables ticked for Preview. Tick Preview on each variable, or test on the Production deployment." : "";
    database = { ok: false, problem: cfg.problem, fix: notConnected(cfg) + "." + preview };
  } else {
    try {
      const r = await rest(cfg, "rpc/lead_capture_health", { method: "POST", body: {}, timeoutMs: 5000 });
      database = r.status === 200 ? { ok: true, schema: r.data } : { ok: false, status: r.status, fix: refused(r.status, r.data, "public.lead_capture_health()") };
    } catch (e) {
      database = { ok: false, fix: unreachable(e) };
    }
  }
  const capi = capiConfig();
  const notices = {
    email: Boolean(n.email), slack: Boolean(n.slack),
    ...(n.email ? {} : { email_fix: `Set ${n.missing.email.join(", ")} in Vercel, then redeploy.` }),
    ...(n.slack ? {} : { slack_fix: `Set ${n.missing.slack.join(", ")} in Vercel, then redeploy.` })
  };
  const meta = {
    conversionsApi: Boolean(capi),
    testMode: Boolean(capi && capi.testCode),
    pixelOnPage: Boolean(SITE.metaPixelId),
    samePixel: Boolean(capi && SITE.metaPixelId && String(SITE.metaPixelId).replace(/\D/g, "") === capi.pixelId),
    ...(capi ? {} : { fix: "Set META_PIXEL_ID and META_CAPI_TOKEN in Vercel, then redeploy." }),
    ...(SITE.metaPixelId ? {} : { pixel_fix: "Set metaPixelId in content/site.mjs, then build and deploy." })
  };
  const prospect = { email: Boolean(prospectConfig()), ...(prospectConfig() ? {} : { fix: "Optional: set PROSPECT_EMAIL_FROM (and RESEND_API_KEY) in Vercel, then redeploy." }) };
  send(res, 200, { ready: Boolean(database.ok && (n.email || n.slack)), database, notices, meta, prospect, deployment: dep, vars });
}
