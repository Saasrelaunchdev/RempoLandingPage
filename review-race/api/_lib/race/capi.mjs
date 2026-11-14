// Meta Conversions API: the server sends Lead (a full race) and Schedule (a booked call) for owners of a trade business
// (fit.mjs), with the same event id the page's pixel used, so Meta counts each once and keeps what the browser lost
// (blocked pixels, iOS). Moved here from the Meta ads page's old Gap Check endpoint when the Review Race replaced it on
// /customers (2026-11-14). Only when these are set in Vercel:
//   META_PIXEL_ID         the dataset (pixel) id, the same as site.metaPixelId in meta/content/site.mjs
//   META_CAPI_TOKEN       an access token from Events Manager > the dataset > Settings > Conversions API
//   META_TEST_EVENT_CODE  optional: sends to Events Manager's Test events tab instead of counting (remove after testing)
//   META_GRAPH_VERSION    optional: the Graph API version, "v25.0" by default (released February 2026)
//
// Customer details are normalized and hashed with SHA-256 as Meta asks; fbc, fbp, the IP address and the user agent
// are sent as they are, as Meta requires. A failure is logged and never fails the lead.
import { createHash } from "node:crypto";

const env = (n) => (process.env[n] ? String(process.env[n]).trim() : "");

export function capiConfig() {
  const pixelId = env("META_PIXEL_ID").replace(/\D/g, "");
  const token = env("META_CAPI_TOKEN");
  const version = /^v\d+\.\d+$/.test(env("META_GRAPH_VERSION")) ? env("META_GRAPH_VERSION") : "v25.0";
  const testCode = env("META_TEST_EVENT_CODE");
  return pixelId && token ? { pixelId, token, version, testCode } : null;
}

const sha = (v) => createHash("sha256").update(v, "utf8").digest("hex");

// Meta's normalization before hashing: email trimmed and lowercased; phone digits with the country code; names and
// city lowercased, letters only; country the two-letter code, lowercased; external id as is
const NORM = {
  em: (v) => String(v || "").trim().toLowerCase(),
  ph: (v) => { const d = String(v || "").replace(/\D/g, ""); return d.length === 10 ? `1${d}` : d.length === 11 && d[0] === "1" ? d : ""; },
  fn: (v) => String(v || "").trim().toLowerCase().normalize("NFKC").replace(/[^\p{L}]/gu, ""),
  ct: (v) => String(v || "").trim().toLowerCase().replace(/[^a-z]/g, ""),
  country: (v) => (/^[a-z]{2}$/i.test(String(v || "").trim()) ? String(v).trim().toLowerCase() : ""),
  external_id: (v) => String(v || "").trim()
};

export const FBC = /^fb\.\d\.\d{10,13}\.[A-Za-z0-9_-]{8,500}$/;
export const FBP = /^fb\.\d\.\d{10,13}\.\d{5,25}$/;
export const EVENT_ID = /^(lead|schedule)-[A-Za-z0-9-]{6,64}$/;

/** user_data for one event: hashed customer details, then the browser's identifiers unhashed. */
export function userData({ email, phone, firstName, city, country = "us", externalId, ip, ua, fbc, fbp }) {
  const u = {};
  const add = (k, v) => { const n = NORM[k](v); if (n) u[k] = [sha(n)]; };
  add("em", email);
  add("ph", phone);
  add("fn", firstName);
  add("ct", city);
  add("country", country);
  add("external_id", externalId);
  if (ip) u.client_ip_address = String(ip).slice(0, 64);
  if (ua) u.client_user_agent = String(ua).slice(0, 512);
  if (fbc && FBC.test(fbc)) u.fbc = fbc;
  if (fbp && FBP.test(fbp)) u.fbp = fbp;
  return u;
}

/** One server event. */
export function capiEvent({ name, id, time, sourceUrl, user, custom }) {
  const e = { event_name: name, event_time: time, event_id: id, action_source: "website", user_data: user };
  if (sourceUrl) e.event_source_url = sourceUrl;
  if (custom) e.custom_data = custom;
  return e;
}

/** Sends events; resolves to Meta's answer, throws on an HTTP error or the timeout (never with the token in it). */
export async function sendCapi(cfg, events, { timeoutMs = 5000 } = {}) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  const body = { data: events };
  if (cfg.testCode) body.test_event_code = cfg.testCode;
  try {
    const r = await fetch(`https://graph.facebook.com/${cfg.version}/${cfg.pixelId}/events?access_token=${encodeURIComponent(cfg.token)}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
      signal: ctrl.signal
    });
    const text = await r.text();
    if (!r.ok) throw new Error(`Conversions API HTTP ${r.status}: ${text.slice(0, 300).split(cfg.token).join("[token]")}`);
    try { return JSON.parse(text); } catch { return { raw: text.slice(0, 200) }; }
  } finally {
    clearTimeout(timer);
  }
}
