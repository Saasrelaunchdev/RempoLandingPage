// Sending: Resend for every email (the owner's results, the follow-ups, the alert to the team) and a Slack incoming
// webhook for the team's channel. Same services and variable names as the landing page (RESEND_API_KEY,
// LEAD_NOTIFY_FROM, LEAD_NOTIFY_TO, SLACK_WEBHOOK_URL), plus RACE_EMAIL_FROM for what owners receive.
// A send that fails is logged and reported; it never fails the race itself.
import { fetchJson } from "./http.mjs";

export async function sendEmail(c, { to, subject, html, text, unsubscribe, idempotencyKey, from, replyTo, tags = [] }, outbox) {
  if (c.fake) { outbox && outbox.push({ to, subject, text, unsubscribe }); return { id: `fake-${Date.now()}`, fake: true }; }
  if (!c.resendKey || !(from || c.emailFrom)) return { skipped: "Resend is not set up" };
  const headers = { authorization: `Bearer ${c.resendKey}` };
  if (idempotencyKey) headers["Idempotency-Key"] = idempotencyKey.slice(0, 256);
  const body = {
    from: from || c.emailFrom,
    to: Array.isArray(to) ? to : [to],
    subject,
    html,
    text,
    ...(replyTo || c.replyTo ? { reply_to: replyTo || c.replyTo } : {}),
    ...(unsubscribe ? { headers: { "List-Unsubscribe": `<${unsubscribe}>`, "List-Unsubscribe-Post": "List-Unsubscribe=One-Click" } } : {}),
    ...(tags.length ? { tags } : {})
  };
  const r = await fetchJson("https://api.resend.com/emails", { method: "POST", headers, body, timeoutMs: 10000 });
  if (!r.ok) {
    const m = r.data && typeof r.data === "object" ? r.data.message || r.data.name : String(r.data || "");
    throw Object.assign(new Error(`Resend answered HTTP ${r.status}${m ? `: ${m}` : ""}`), { code: "resend" });
  }
  return { id: r.data && r.data.id };
}

export async function notifyTeam(c, { subject, text }, outbox) {
  const sent = { email: false, slack: false };
  if (c.fake) { outbox && outbox.push({ to: "team", subject, text }); return { email: true, slack: true }; }
  const jobs = [];
  if (c.resendKey && c.notifyFrom && c.notifyTo.length) {
    jobs.push(sendEmail(c, { to: c.notifyTo, subject, text, html: `<pre style="font:14px/1.5 Arial,sans-serif;white-space:pre-wrap">${text.replace(/[&<>]/g, (x) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[x])}</pre>`, from: c.notifyFrom })
      .then(() => { sent.email = true; }).catch((e) => console.error("team email failed:", e.message)));
  }
  if (/^https:\/\/hooks\.slack\.com\//.test(c.slackWebhook)) {
    jobs.push(fetchJson(c.slackWebhook, { method: "POST", body: { text: `*${subject}*\n${text}` }, timeoutMs: 6000 })
      .then((r) => { if (r.ok) sent.slack = true; else console.error("slack failed:", r.status); }).catch((e) => console.error("slack failed:", e.message)));
  }
  await Promise.all(jobs);
  return sent;
}
