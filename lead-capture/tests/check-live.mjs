#!/usr/bin/env node
/**
 * The live site, once its keys are set: reads https://<site>/api/lead (the health report) and says, part by part,
 * what works and what to fix. Run it against the exact deployment you are checking: Production and each Preview see
 * their own variables. Installed by the landing-page-lead-capture skill.
 *
 *   node lead-capture/tests/check-live.mjs https://www.example.com
 *   node lead-capture/tests/check-live.mjs https://www.example.com --send you@example.com
 *
 * --send sends one real test lead (a real row, a real email, a real Slack message), so only when the owner wants it.
 * No network from here? Open https://<site>/api/lead in a browser: it is the same report.
 */
import { execFileSync } from "node:child_process";

const site = (process.argv[2] || "").replace(/\/+$/, "");
if (!/^https?:\/\//.test(site)) { console.log("usage: node lead-capture/tests/check-live.mjs https://your-site [--send you@example.com]"); process.exit(2); }
const sendTo = process.argv.includes("--send") ? process.argv[process.argv.indexOf("--send") + 1] : null;

// Node's fetch, or curl when Node cannot reach the network directly (a proxy it does not read)
async function http(method, url, body) {
  const headers = { accept: "application/json", ...(body ? { "content-type": "application/json", origin: new URL(url).origin } : {}) };
  try {
    const r = await fetch(url, { method, headers, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(20000) });
    return { status: r.status, text: await r.text() };
  } catch (e) {
    try {
      const args = ["-sS", "-m", "20", "-X", method, "-w", "\n%{http_code}", ...Object.entries(headers).flatMap(([k, v]) => ["-H", `${k}: ${v}`]), ...(body ? ["--data", JSON.stringify(body)] : []), url];
      const out = execFileSync("curl", args, { encoding: "utf8" });
      const i = out.lastIndexOf("\n");
      return { status: +out.slice(i + 1), text: out.slice(0, i) };
    } catch (e2) { return { status: 0, text: String((e2 && e2.message) || e.message) }; }
  }
}

const yes = (b) => (b ? "OK  " : "FIX ");
const h = await http("GET", `${site}/api/lead`);
if (h.status !== 200) {
  console.log(`FIX  ${site}/api/lead answered ${h.status || "nothing"}${h.status === 404 ? ": this deployment has no api/lead.mjs (is the latest commit deployed? is the project's root the folder with api/?)" : ""}`);
  if (!h.status) console.log(`     This machine could not reach the site (${h.text.slice(0, 120)}). Open ${site}/api/lead in a browser instead.`);
  process.exit(1);
}
let r;
try { r = JSON.parse(h.text); } catch { console.log(`FIX  ${site}/api/lead did not answer JSON: ${h.text.slice(0, 160)}`); process.exit(1); }
const d = r.deployment || {};
console.log(`     Deployment: ${d.env}${d.branch ? `, branch ${d.branch}` : ""}${d.commit ? `, commit ${d.commit}` : ""}`);
console.log(`${yes(r.database && r.database.ok)} Database${r.database && r.database.ok ? `: ${r.database.schema}` : `: ${r.database && r.database.fix}`}`);
console.log(`${yes(r.notices && r.notices.email)} Email notice (Resend)${r.notices && !r.notices.email ? `: ${r.notices.email_fix}` : ""}`);
console.log(`${yes(r.notices && r.notices.slack)} Slack notice${r.notices && !r.notices.slack ? `: ${r.notices.slack_fix}` : ""}`);
const missing = Object.entries(r.vars || {}).filter(([, v]) => !v).map(([k]) => k);
if (missing.length) console.log(`     Not set on this deployment: ${missing.join(", ")}${missing.includes("LEAD_HASH_SALT") && missing.length === 1 ? " (optional)" : ""}`);
console.log(r.ready ? "READY: leads are stored and announced." : "NOT READY: fix the lines marked FIX, redeploy, and run this again.");

if (sendTo) {
  const s = await http("POST", `${site}/api/lead`, { form: "live-check", name: "Live check", email: sendTo, message: "Sent by lead-capture/tests/check-live.mjs to test the setup. Safe to delete.", consent: true, page: `${site}/` });
  let b = {}; try { b = JSON.parse(s.text); } catch { /* shown below */ }
  if (s.status === 200 && b.stored !== false) console.log(`OK   Test lead sent: look for it in Supabase (Table Editor > leads), in your inbox and in Slack.`);
  else if (s.status === 200) console.log("FIX  Test lead reached the notices but was NOT SAVED: the email says why.");
  else console.log(`FIX  Test lead answered ${s.status}: ${s.text.slice(0, 200)}`);
}
process.exit(r.ready ? 0 : 1);
