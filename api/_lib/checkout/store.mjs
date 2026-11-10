// The purchases record in Supabase (checkout/checkout.sql): one row per Checkout Session, written only by the Stripe
// webhook, through public.record_checkout() and public.record_handoff(). It remembers whether a purchase already reached
// GoHighLevel, so a webhook Stripe sends twice hands the buyer off once, and it joins each purchase to the visit's leads.
//
// Settings, Vercel environment variables:
//   SUPABASE_URL          the same Project URL the lead forms use
//   SUPABASE_SECRET_KEY   a secret key (sb_secret_...; or the legacy service_role key). Only these server functions use it,
//                         never a page; the forms keep using the publishable key and still refuse a secret one.
import { rest, isSecretKey } from "../lead-store.mjs";

const env = (n) => (process.env[n] ? String(process.env[n]).trim() : "");
const pick = (...names) => { for (const n of names) if (env(n)) return env(n); return ""; };

export function storeConfig() {
  const url = pick("SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_URL", "VITE_SUPABASE_URL").replace(/\/+$/, "");
  const key = pick("SUPABASE_SECRET_KEY", "SUPABASE_SERVICE_ROLE_KEY");
  const problem = !url || !key ? "missing" : !/^https?:\/\/[^/\s]+$/.test(url) ? "bad-url" : !isSecretKey(key) ? "not-secret" : null;
  return { url, key, ok: !problem, problem };
}

export function storeNotConnected(cfg) {
  if (cfg.problem === "bad-url") return "SUPABASE_URL is not a project URL like https://abcdefghijklmnop.supabase.co";
  if (cfg.problem === "not-secret") return "SUPABASE_SECRET_KEY holds a publishable key; the purchases record needs the secret key (sb_secret_...)";
  const missing = [!cfg.url && "SUPABASE_URL", !cfg.key && "SUPABASE_SECRET_KEY"].filter(Boolean).join(" and ");
  return `the purchase was not recorded in Supabase: this deployment cannot see ${missing}`;
}

const said = (r) => (r.data && typeof r.data === "object" ? [r.data.code, r.data.message].filter(Boolean).join(": ") : String(r.data || "")).slice(0, 200);

// Stores or updates the session's row. -> { id, first_seen, handed_off_at, handoff_error, ghl_contact_id, email_paid_elsewhere }
export async function recordCheckout(cfg, row) {
  const r = await rest(cfg, "rpc/record_checkout", { method: "POST", body: { payload: row } });
  if (r.status !== 200) {
    const hint = r.status === 404 ? " (run checkout/checkout.sql in the project SUPABASE_URL names)" : r.status === 401 || r.status === 403 ? " (SUPABASE_SECRET_KEY was refused)" : "";
    throw new Error(`Supabase answered HTTP ${r.status}${hint}${said(r) ? `: ${said(r)}` : ""}`);
  }
  return r.data && typeof r.data === "object" ? r.data : {};
}

// Records that the session reached GoHighLevel (contactId), or why it did not (error)
export async function recordHandoff(cfg, sessionId, { contactId = null, error = null } = {}) {
  const r = await rest(cfg, "rpc/record_handoff", { method: "POST", body: { p_session_id: sessionId, p_contact_id: contactId, p_error: error } });
  if (r.status !== 200 && r.status !== 204) throw new Error(`Supabase answered HTTP ${r.status} to record_handoff${said(r) ? `: ${said(r)}` : ""}`);
}

// For /api/checkout?health=1: did checkout/checkout.sql run in this project? -> "checkout v1", or throws
export async function storeHealth(cfg) {
  const r = await rest(cfg, "rpc/checkout_health", { method: "POST", body: {}, timeoutMs: 5000 });
  if (r.status !== 200) throw new Error(`HTTP ${r.status}${r.status === 404 ? ": run checkout/checkout.sql in this project" : said(r) ? `: ${said(r)}` : ""}`);
  return r.data;
}
