// /api/lead: where every form on this site sends its leads. Installed by the landing-page-lead-capture skill.
//
//   POST  a lead (any form's fields, as JSON): stored in Supabase through public.submit_lead(), which validates and
//         rate-limits (lead-capture/leads.sql), then announced by email (Resend) and in Slack. If Supabase is not
//         connected or fails, the notices still go, marked NOT SAVED with the reason, so a lead is never lost while
//         either notice works. Only when nothing works does the visitor see that it did not send.
//   GET   a health report: which settings this deployment sees (true or false, never a value), whether the database
//         answers with this kit's schema, and what to fix. Open https://<your-site>/api/lead after every change.
//
// Settings are Vercel environment variables (Project > Settings > Environment Variables), never in the page:
//   SUPABASE_URL, SUPABASE_ANON_KEY (the publishable key; a secret key is refused), LEAD_HASH_SALT (optional),
//   RESEND_API_KEY, LEAD_NOTIFY_FROM, LEAD_NOTIFY_TO, SLACK_WEBHOOK_URL.
// The visitor's IP address is never stored: only a salted one-way hash of it, used for the rate limit.
import { createHash } from "node:crypto";
import { supabaseConfig, rest, notConnected, refused, unreachable, deployment, send, readJson } from "./_lib/lead-store.mjs";
import { normalize, HONEYPOT, EMAIL, phoneDigits } from "./_lib/lead-fields.mjs";
import { notifyConfig, notifyLead } from "./_lib/lead-notify.mjs";

export const SETTINGS = {
  site: "Rempo",       // names the site in the notices
  requireConsent: true    // true: refuse a lead with no consent box ticked (when every form on the site has one)
};

const VARS = ["SUPABASE_URL", "SUPABASE_ANON_KEY", "LEAD_HASH_SALT", "RESEND_API_KEY", "LEAD_NOTIFY_FROM", "LEAD_NOTIFY_TO", "SLACK_WEBHOOK_URL"];
const host = (req) => String(req.headers["x-forwarded-host"] || req.headers.host || "").split(",")[0].trim();

export default async function handler(req, res) {
  if (req.method === "GET" || req.method === "HEAD") return health(req, res);
  if (req.method !== "POST") {
    res.setHeader("allow", "GET, POST");
    return send(res, 405, { error: "method not allowed" });
  }
  // Only the site's own pages may post here (a browser always sends Origin with a POST)
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

  const lead = normalize(body);
  if (lead.email && !EMAIL.test(lead.email)) return send(res, 400, { error: "A valid email is required" });
  if (!lead.email && phoneDigits(lead.phone) < 7) return send(res, 400, { error: "An email or a phone number is required" });
  if (SETTINGS.requireConsent && !Object.values(lead.consent).some(Boolean)) return send(res, 400, { error: "Consent is required" });

  const cfg = supabaseConfig();
  const notices = notifyConfig();
  if (!cfg.ok && !notices.email && !notices.slack) return send(res, 503, { error: "not configured", configured: false, problem: cfg.problem });

  const ip = String(req.headers["x-forwarded-for"] || req.headers["x-real-ip"] || "").split(",")[0].trim();
  const salt = process.env.LEAD_HASH_SALT || cfg.url || "lead-capture";
  const payload = { ...lead, ip_hash: ip ? createHash("sha256").update(`${salt}|${ip}`).digest("hex") : null };
  const healthUrl = host(req) ? `https://${host(req)}/api/lead` : "";

  let reason;
  if (cfg.ok) {
    try {
      const r = await rest(cfg, "rpc/submit_lead", { method: "POST", body: { payload } });
      if (r.status === 200) {
        await notifyLead(lead, { stored: true, id: typeof r.data === "string" ? r.data : "", site: SETTINGS.site });
        return send(res, 200, { ok: true });
      }
      const message = r.data && typeof r.data === "object" && r.data.message;
      if (r.status === 400) return send(res, 400, { error: message || "invalid lead" });
      if (r.status === 429) return send(res, 429, { error: message || "too many submissions" });
      console.error("submit_lead failed", r.status, typeof r.data === "string" ? r.data.slice(0, 300) : r.data);
      reason = refused(r.status, r.data);
    } catch (e) {
      console.error("submit_lead error", e && e.message);
      reason = unreachable(e);
    }
  } else {
    console.error(`Supabase is not connected (${cfg.problem}): the lead is sent by the notices only`);
    reason = notConnected(cfg);
  }
  // Not stored: the notices carry it alone, with the reason. It counts as received if at least one of them went out.
  const sent = await notifyLead(lead, { stored: false, reason, deployment: deployment(), healthUrl, site: SETTINGS.site });
  if (sent.email || sent.slack) return send(res, 200, { ok: true, stored: false });
  return send(res, 502, { error: "could not store the lead" });
}

// GET /api/lead: what this deployment sees and whether each part works. Names and true or false only, never a value.
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
  const notices = {
    email: Boolean(n.email), slack: Boolean(n.slack),
    ...(n.email ? {} : { email_fix: `Set ${n.missing.email.join(", ")} in Vercel, then redeploy.` }),
    ...(n.slack ? {} : { slack_fix: `Set ${n.missing.slack.join(", ")} in Vercel, then redeploy.` })
  };
  // Ready: leads are stored and at least one notice goes out. Each part says whether it works and, if not, its fix.
  send(res, 200, { ready: Boolean(database.ok && (n.email || n.slack)), database, notices, deployment: dep, vars });
}
