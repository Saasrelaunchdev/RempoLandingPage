// The prospect's own emails, through the same Resend account as the owner's notices: right after the Gap Check (the
// score, the three biggest gaps, what happens next) and right after booking (the slot, "reply YES to confirm").
// The course's show-rate levers: a written yes, and everything they want to know before the call, as a benefit to them.
// Only when these are set in Vercel:
//   PROSPECT_EMAIL_FROM   the sender, a person on the verified Resend domain: Ali at Rempo <ali@rempo.io>
//   PROSPECT_REPLY_TO     optional: where replies go, if not the sender
// RESEND_API_KEY is the one the owner's notices use. A failure is logged and never fails the lead.
import { fill } from "../../lib/gapcheck.mjs";
import { EMAIL } from "./lead-fields.mjs";

const env = (n) => (process.env[n] ? String(process.env[n]).trim() : "");

export function prospectConfig() {
  const key = env("RESEND_API_KEY"), from = env("PROSPECT_EMAIL_FROM"), replyTo = env("PROSPECT_REPLY_TO");
  if (!key || !from) return null;
  return { key, from, replyTo: EMAIL.test(replyTo) ? replyTo : "" };
}

const html = (v) => String(v).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

/** Builds { subject, text, html } from a template ({ subject, lines }) and its values. {gaps} becomes a list. */
export function compose(tpl, vars, { signoff, footer, gaps = [] }) {
  const v = { ...vars, signoff };
  const subject = fill(tpl.subject, v).replace(/\s+/g, " ").trim().slice(0, 160);
  const textLines = [], htmlParts = [];
  for (const line of tpl.lines) {
    if (line === "{gaps}") {
      gaps.forEach((g, i) => textLines.push(`${i + 1}. ${g.title} ${g.line}`));
      if (gaps.length) htmlParts.push(`<ol style="margin:0 0 16px;padding-left:22px">${gaps.map((g) => `<li style="margin:0 0 8px"><b>${html(g.title)}</b> ${html(g.line)}</li>`).join("")}</ol>`);
      continue;
    }
    const t = fill(line, v);
    textLines.push(t);
    htmlParts.push(`<p style="margin:0 0 16px">${html(t)}</p>`);
  }
  const foot = footer.filter(Boolean);
  const text = [...textLines, "", ...foot].join("\n\n").replace(/\n{3,}/g, "\n\n").trim();
  const page = `<!doctype html><html><body style="margin:0;padding:24px;background:#ffffff;font-family:Arial,Helvetica,sans-serif;font-size:16px;line-height:1.5;color:#0A1A33">
<div style="max-width:560px;margin:0 auto">${htmlParts.join("\n")}
${foot.length ? `<p style="margin:28px 0 0;padding-top:14px;border-top:1px solid #EAEFF6;font-size:13px;color:#4D535C">${foot.map(html).join("<br>")}</p>` : ""}
</div></body></html>`;
  return { subject, text, html: page };
}

/** Sends one email to the prospect; resolves on success, throws otherwise. The idempotency key stops a retry sending twice. */
export async function sendProspect(cfg, to, msg, idempotencyKey, { timeoutMs = 6000 } = {}) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const headers = { "content-type": "application/json", authorization: `Bearer ${cfg.key}` };
    if (idempotencyKey) headers["idempotency-key"] = idempotencyKey;
    const body = { from: cfg.from, to: [to], subject: msg.subject, text: msg.text, html: msg.html, tags: [{ name: "type", value: "prospect" }] };
    if (cfg.replyTo) body.reply_to = cfg.replyTo;
    const r = await fetch("https://api.resend.com/emails", { method: "POST", headers, body: JSON.stringify(body), signal: ctrl.signal });
    if (!r.ok) throw new Error(`Resend HTTP ${r.status}: ${(await r.text()).slice(0, 300)}`);
    return true;
  } finally {
    clearTimeout(timer);
  }
}
