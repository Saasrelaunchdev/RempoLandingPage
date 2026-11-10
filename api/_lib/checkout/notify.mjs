// Tells the team about a purchase, the same two ways leads are announced (api/_lib/lead-notify.mjs): an email through
// Resend and a Slack message, with the same variables (RESEND_API_KEY, LEAD_NOTIFY_FROM, LEAD_NOTIFY_TO,
// SLACK_WEBHOOK_URL). A purchase that has not reached GoHighLevel yet is marked NOT IN GOHIGHLEVEL YET, with the reason;
// Stripe keeps sending the webhook, and the next try that works sends the all-clear. Never emails the buyer.
import { notifyConfig } from "../lead-notify.mjs";
import { formatMoney } from "../../../assets/checkout-shared.mjs";

async function post(url, { headers, body, timeoutMs = 6000 }) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const r = await fetch(url, { method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body), signal: ctrl.signal });
    const t = await r.text();
    if (!r.ok) throw new Error(`HTTP ${r.status}: ${t.slice(0, 300)}`);
    return t;
  } finally {
    clearTimeout(timer);
  }
}

const html = (v) => String(v).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const mrkdwn = (v) => String(v).replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[c]);

export function purchaseRows(p, { handedOff, error, storeProblem }) {
  const stripeLink = p.customerId ? `https://dashboard.stripe.com/${p.livemode ? "" : "test/"}customers/${p.customerId}` : "";
  return [
    ["Business", p.business],
    ["Name", p.firstName || p.name],
    ["Email", p.email],
    ["Phone", p.phone],
    ["Plan", [p.planLabel, p.billing !== "once" && p.billing, p.billing !== "once" && `${p.profiles} Google profile${p.profiles > 1 ? "s" : ""}`].filter(Boolean).join(", ")],
    ["Paid today", Number.isFinite(p.amountTotal) ? `${formatMoney(p.amountTotal, p.currency)}${p.bump ? ", with the add-on" : ""}` : ""],
    ["GoHighLevel", handedOff ? "handed off: the contact is tagged, the onboarding workflow starts" : `NOT YET: ${error || "unknown"}. Stripe retries by itself`],
    ["Supabase", storeProblem ? `NOT SAVED: ${storeProblem}` : "saved"],
    ["Stripe", stripeLink],
    ["Mode", p.livemode ? "live" : "TEST (no real money)"]
  ].filter(([, v]) => v);
}

export async function notifyPurchase(p, opts) {
  const cfg = notifyConfig();
  const rows = purchaseRows(p, opts);
  const flag = opts.handedOff ? "" : "[NOT IN GOHIGHLEVEL YET] ";
  const subject = `${flag}${p.livemode ? "" : "[TEST] "}New purchase for Rempo: ${p.business || p.email || "a buyer"} (${p.planLabel})`.slice(0, 160);
  const jobs = {};
  if (cfg.email) {
    const text = rows.map(([k, v]) => `${k}: ${v}`).join("\n");
    const page = `<!doctype html><html><body style="margin:0;padding:24px;background:#f5f6f8;font-family:Arial,Helvetica,sans-serif;color:#14213d">
<table role="presentation" width="100%" style="max-width:560px;margin:0 auto;background:#ffffff;border-radius:8px;padding:24px"><tr><td>
<h1 style="margin:0 0 16px;font-size:20px">${html(subject)}</h1>
<table role="presentation" width="100%" style="border-collapse:collapse;font-size:14px">
${rows.map(([k, v]) => `<tr><td style="padding:8px 12px 8px 0;vertical-align:top;color:#5c6b80;white-space:nowrap">${html(k)}</td><td style="padding:8px 0;vertical-align:top">${/^https?:\/\//.test(v) ? `<a href="${html(v)}">${html(v)}</a>` : html(v)}</td></tr>`).join("\n")}
</table></td></tr></table></body></html>`;
    // One email per session and outcome, even when Stripe sends the webhook again (Resend keeps the key for 24 hours)
    const headers = { authorization: `Bearer ${cfg.email.key}`, "idempotency-key": `purchase-${p.sessionId}-${opts.handedOff ? "ok" : "pending"}` };
    jobs.email = post("https://api.resend.com/emails", { headers, body: { from: cfg.email.from, to: cfg.email.to, subject, text, html: page,
      ...(p.email ? { reply_to: p.email } : {}), tags: [{ name: "type", value: "purchase" }] } });
  }
  if (cfg.slack) {
    const title = `${opts.handedOff ? ":tada:" : ":warning:"} ${mrkdwn(subject)}`;
    jobs.slack = post(cfg.slack, { body: { text: title, blocks: [
      { type: "section", text: { type: "mrkdwn", text: `*${title}*` } },
      { type: "section", text: { type: "mrkdwn", text: rows.map(([k, v]) => `*${mrkdwn(k)}:* ${mrkdwn(v)}`).join("\n").slice(0, 2900) } }
    ] } });
  }
  const out = { email: null, slack: null };
  await Promise.all(Object.entries(jobs).map(async ([k, job]) => {
    try { await job; out[k] = true; } catch (e) { out[k] = false; console.error(`purchase notice by ${k} failed:`, e && e.message); }
  }));
  return out;
}
