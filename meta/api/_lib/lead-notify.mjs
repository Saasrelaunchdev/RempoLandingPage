// Shared by api/lead.mjs. Installed by the landing-page-lead-capture skill.
//
// Tells the owner about a new lead the moment it arrives: an email through Resend (to Gmail, or any inbox) and a
// message in Slack through an incoming webhook (Resend sends email only; Slack gets its own webhook). Both are
// optional and independent; each is on when its variables are set in the Vercel project:
//   RESEND_API_KEY      a Resend API key with sending access (re_...)
//   LEAD_NOTIFY_FROM    the sender, on a domain verified in Resend: Leads <leads@yourdomain.com>
//   LEAD_NOTIFY_TO      who receives it, comma separated: you@gmail.com (a Slack channel's email address works too)
//   SLACK_WEBHOOK_URL   a Slack incoming webhook: https://hooks.slack.com/services/...
// A notice that fails is logged and never fails the lead: it is already stored, and the other notice still goes.
// A lead that could not be stored is sent marked NOT SAVED, with the reason and the deployment that sent it.

import { EMAIL } from "./lead-fields.mjs";

const env = (n) => (process.env[n] ? String(process.env[n]).trim() : "");

export function notifyConfig() {
  const to = env("LEAD_NOTIFY_TO").split(",").map((s) => s.trim()).filter((s) => EMAIL.test(s));
  const key = env("RESEND_API_KEY"), from = env("LEAD_NOTIFY_FROM"), slack = env("SLACK_WEBHOOK_URL");
  const slackOk = /^https:\/\/hooks\.slack\.com\/(services|workflows|triggers)\//.test(slack);
  const missingEmail = [!key && "RESEND_API_KEY", !from && "LEAD_NOTIFY_FROM", !to.length && (env("LEAD_NOTIFY_TO") ? "LEAD_NOTIFY_TO (no valid address in it)" : "LEAD_NOTIFY_TO")].filter(Boolean);
  return {
    email: missingEmail.length ? null : { key, from, to },
    slack: slackOk ? slack : null,
    missing: { email: missingEmail, slack: slackOk ? [] : [slack ? "SLACK_WEBHOOK_URL (not a hooks.slack.com address)" : "SLACK_WEBHOOK_URL"] }
  };
}

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
const oneLine = (v, max) => String(v).replace(/\s+/g, " ").trim().slice(0, max);
// "team_size" and "teamSize" read as "Team size"
const label = (k) => { const s = String(k).replace(/([a-z])([A-Z])/g, "$1 $2").replace(/[_-]+/g, " ").trim().toLowerCase(); return s.charAt(0).toUpperCase() + s.slice(1); };
const show = (v) => (typeof v === "boolean" ? (v ? "yes" : "no")
  : Array.isArray(v) ? v.join(", ")
  : v && typeof v === "object" ? Object.entries(v).map(([k, x]) => `${label(k)}: ${typeof x === "object" ? JSON.stringify(x) : show(x)}`).join("; ")
  : String(v));

export const who = (lead) => lead.name || lead.email || lead.phone || "someone";

// The lead as label/value rows, the same in the email and in Slack
export function rows(lead) {
  const m = lead.meta || {};
  const source = Object.entries(m).filter(([k]) => !/^(page|pageurl|referrer|referer)$/i.test(k)).map(([k, v]) => `${k}=${v}`).join(", ");
  const consent = Object.entries(lead.consent || {}).map(([k, v]) => `${label(k)}: ${v ? "yes" : "no"}`).join("; ");
  return [
    ["Name", lead.name],
    ["Email", lead.email],
    ["Phone", lead.phone],
    ["Company", lead.company],
    ["Form", lead.form && lead.form !== "default" ? lead.form : ""],
    ...Object.entries(lead.fields || {}).map(([k, v]) => [label(k), show(v)]),
    ["Message", lead.message],
    ["Consent", consent],
    ["Source", source],
    ["Page", m.page || m.pageUrl || m.page_url || ""],
    ["Referrer", m.referrer || m.referer || ""]
  ].filter(([, v]) => v);
}

// A NOT SAVED notice says why (from api/lead.mjs) and which deployment sent it, with the link to its health report
export function notSaved({ reason, deployment: d, healthUrl }) {
  const where = d ? [d.env, d.branch && `branch ${d.branch}`, d.commit && `commit ${d.commit}`].filter(Boolean).join(", ") : "";
  return {
    warn: `NOT SAVED in Supabase: ${reason || "the database did not answer"}. Keep this message; the lead is not in the database.`,
    where: where ? `Sent by the deployment: ${where}.${healthUrl ? ` Its settings: ${healthUrl}` : ""}` : ""
  };
}

export function subject(lead, { stored, site }) {
  return oneLine(`${stored ? "" : "[NOT SAVED] "}New lead${site ? ` for ${site}` : ""}: ${who(lead)}${lead.form && lead.form !== "default" ? ` (${lead.form})` : ""}`, 160);
}

export function emailBody(lead, opts) {
  const list = rows(lead);
  const { warn, where } = opts.stored ? { warn: "", where: "" } : notSaved(opts);
  const replyLine = lead.email ? `Reply to this email to answer ${who(lead)} directly.` : (lead.phone ? `No email given: call or text ${lead.phone}.` : "");
  const text = [warn, where, ...list.map(([k, v]) => `${k}: ${v}`), "", replyLine].filter((l, i, a) => l || (i && a[i - 1])).join("\n").trim();
  const link = (s) => html(s).replace(/https?:\/\/\S+/, (u) => `<a href="${u}">${u}</a>`);
  const page = `<!doctype html><html><body style="margin:0;padding:24px;background:#f5f6f8;font-family:Arial,Helvetica,sans-serif;color:#14213d">
<table role="presentation" width="100%" style="max-width:560px;margin:0 auto;background:#ffffff;border-radius:8px;padding:24px">
<tr><td>
<h1 style="margin:0 0 16px;font-size:20px">New lead from ${html(who(lead))}</h1>
${warn ? `<p style="margin:0 0 8px;padding:12px;background:#fff4e5;border-radius:6px;color:#8a4b00;font-weight:bold">${html(warn)}</p>` : ""}
${where ? `<p style="margin:0 0 16px;font-size:13px;color:#5c6b80">${link(where)}</p>` : ""}
<table role="presentation" width="100%" style="border-collapse:collapse;font-size:14px">
${list.map(([k, v]) => `<tr><td style="padding:8px 12px 8px 0;vertical-align:top;color:#5c6b80;white-space:nowrap">${html(k)}</td><td style="padding:8px 0;vertical-align:top;white-space:pre-wrap">${k === "Email" ? `<a href="mailto:${html(v)}">${html(v)}</a>` : html(v)}</td></tr>`).join("\n")}
</table>
${replyLine ? `<p style="margin:20px 0 0;font-size:13px;color:#5c6b80">${html(replyLine)}</p>` : ""}
</td></tr></table></body></html>`;
  return { text, html: page };
}

function sendEmail(cfg, lead, opts) {
  const { text, html: page } = emailBody(lead, opts);
  const headers = { authorization: `Bearer ${cfg.key}` };
  // The same lead is never emailed twice, even if this call is retried
  if (opts.id) headers["idempotency-key"] = `lead-${opts.id}`;
  const body = { from: cfg.from, to: cfg.to, subject: subject(lead, opts), text, html: page, tags: [{ name: "type", value: "lead" }] };
  if (lead.email && EMAIL.test(lead.email)) body.reply_to = lead.email;
  return post("https://api.resend.com/emails", { headers, body });
}

function sendSlack(url, lead, opts) {
  const list = rows(lead).map(([k, v]) => `*${mrkdwn(k)}:* ${k === "Email" ? `<mailto:${mrkdwn(v)}|${mrkdwn(v)}>` : mrkdwn(oneLine(v, 600))}`);
  const title = `${opts.stored ? ":incoming_envelope:" : ":warning: NOT SAVED in Supabase:"} New lead${opts.site ? ` for ${mrkdwn(opts.site)}` : ""} from ${mrkdwn(oneLine(who(lead), 80))}`;
  const blocks = [
    { type: "section", text: { type: "mrkdwn", text: `*${title}*` } },
    { type: "section", text: { type: "mrkdwn", text: list.join("\n").slice(0, 2900) } }
  ];
  if (!opts.stored) {
    const { warn, where } = notSaved(opts);
    blocks.push({ type: "context", elements: [{ type: "mrkdwn", text: [warn, where].filter(Boolean).map(mrkdwn).join("\n").slice(0, 2900) }] });
  }
  return post(url, { body: { text: mrkdwn(subject(lead, opts)), blocks } });
}

// Sends every configured notice at once and waits for all of them (a Vercel function may stop once it has answered).
// Returns { email, slack }: true sent, false failed, null not configured.
export async function notifyLead(lead, opts = {}) {
  const cfg = notifyConfig();
  const jobs = { email: cfg.email ? sendEmail(cfg.email, lead, opts) : null, slack: cfg.slack ? sendSlack(cfg.slack, lead, opts) : null };
  const out = {};
  await Promise.all(Object.entries(jobs).map(async ([k, job]) => {
    if (!job) { out[k] = null; return; }
    try { await job; out[k] = true; } catch (e) { out[k] = false; console.error(`lead notice by ${k} failed:`, e && e.message); }
  }));
  return out;
}
