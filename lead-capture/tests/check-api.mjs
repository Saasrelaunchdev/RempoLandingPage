#!/usr/bin/env node
/**
 * The lead endpoint, ../../api/lead.mjs, run for real with Supabase, Resend and Slack stubbed (no network, no keys):
 * the health report; a lead stored and announced by both notices; each form shape (email, phone only, named fields,
 * consent boxes, a calculator's JSON); one notice failing; Supabase not connected, refusing or silent (the notices
 * carry the lead, marked NOT SAVED, with the reason and the deployment); nothing working; the visitor's errors (400,
 * 429); the honeypot; another site posting; the visitor's words escaped; no key or webhook ever in a response or notice.
 * Installed by the landing-page-lead-capture skill.
 *
 *   node lead-capture/tests/check-api.mjs
 */
import { Readable } from "node:stream";

const mod = await import(new URL("../../api/lead.mjs", import.meta.url));
const handler = mod.default, SETTINGS = mod.SETTINGS;

let pass = 0, fail = 0;
// A crash is a failure too, and says so (the handler's own logging is silenced below)
const crashed = (e) => { process.stdout.write(`FAIL crashed: ${e && e.stack || e}\ncheck-api: ${pass} passed, ${fail + 1} failed\n`); process.exit(1); };
process.on("uncaughtException", crashed); process.on("unhandledRejection", crashed);
const ok = (name, cond, info = "") => { if (cond) { pass++; console.log(`ok   ${name}`); } else { fail++; console.log(`FAIL ${name}${info ? `: ${info}` : ""}`); } };

// Stubs: every outbound call is recorded; each service answers as the case sets it
let calls = [], answer = {};
globalThis.fetch = async (url, init = {}) => {
  const u = String(url);
  const svc = u.includes("/rest/v1/") ? "supabase" : u.startsWith("https://api.resend.com/") ? "resend" : u.startsWith("https://hooks.slack.com/") ? "slack" : "other";
  calls.push({ svc, url: u, headers: init.headers || {}, body: init.body ? JSON.parse(init.body) : null });
  const a = answer[svc] || { status: 200, body: svc === "supabase" ? (u.endsWith("lead_capture_health") ? '"lead-capture v1"' : '"1b2c3d4e-0000-4000-8000-000000000000"') : svc === "slack" ? "ok" : '{"id":"e1"}' };
  if (a.throw) throw a.throw === true ? new Error("network down") : a.throw;
  return new Response(a.body ?? "", { status: a.status });
};
const quiet = console.error; console.error = () => {};   // the handler logs failures; the test checks behaviour

const ENV = {
  SUPABASE_URL: "https://abcdefghijklmnop.supabase.co",
  SUPABASE_ANON_KEY: "sb_publishable_test_key",
  LEAD_HASH_SALT: "salt-0f3a9c",
  RESEND_API_KEY: "re_test_key",
  LEAD_NOTIFY_FROM: "Leads <leads@example.com>",
  LEAD_NOTIFY_TO: "owner@gmail.com, team@example.com",
  SLACK_WEBHOOK_URL: "https://hooks.slack.com/services/T000/B000/SECRETPATH"
};
const VERCEL = ["VERCEL_ENV", "VERCEL_GIT_COMMIT_REF", "VERCEL_GIT_COMMIT_SHA"];
function setEnv(over = {}) {
  for (const k of [...Object.keys(ENV), ...VERCEL]) delete process.env[k];
  Object.assign(process.env, ENV, over);
  for (const [k, v] of Object.entries(over)) if (v === undefined) delete process.env[k];
}
const SECRETS = ["sb_publishable_test_key", "re_test_key", "SECRETPATH", "salt-0f3a9c"];

const LEAD = { form: "demo", full_name: "Ada <b>", work_email: "Ada@Example.com", company: "Ordvia", team_size: "11-50", message: "Cold email & ads", consent: true, page: "https://www.example.com/?utm_source=linkedin", utm_source: "linkedin" };

async function call(body = LEAD, { method = "POST", headers = {}, stream = false } = {}) {
  calls = [];
  const h = { host: "www.example.com", origin: "https://www.example.com", "x-forwarded-for": "203.0.113.9", ...headers };
  for (const k of Object.keys(h)) if (h[k] === undefined) delete h[k];
  const req = stream ? Object.assign(Readable.from([Buffer.from(typeof body === "string" ? body : JSON.stringify(body))]), { method, headers: h }) : { method, headers: h, body };
  const res = { statusCode: 0, headers: {}, setHeader(k, v) { this.headers[k.toLowerCase()] = v; }, end(s) { this.raw = s || ""; try { this.body = s ? JSON.parse(s) : null; } catch { this.body = s; } } };
  await handler(req, res);
  const by = (svc) => calls.filter((c) => c.svc === svc);
  return { status: res.statusCode, body: res.body, raw: res.raw, headers: res.headers, supabase: by("supabase"), resend: by("resend"), slack: by("slack"), other: by("other") };
}

/* ---------- GET /api/lead: the health report ---------- */
setEnv();
let r = await call(undefined, { method: "GET" });
ok("health: ready with the database and both notices", r.status === 200 && r.body.ready === true && r.body.database.ok === true && r.body.database.schema === "lead-capture v1" && r.body.notices.email && r.body.notices.slack, JSON.stringify(r.body));
ok("health: probes the schema through lead_capture_health()", r.supabase.length === 1 && r.supabase[0].url.endsWith("/rest/v1/rpc/lead_capture_health"));
ok("health: lists the variables as true or false, never a value", Object.values(r.body.vars).every((v) => typeof v === "boolean") && SECRETS.every((s) => !r.raw.includes(s)) && !r.raw.includes("gmail"), r.raw);
setEnv({ SUPABASE_URL: undefined, SUPABASE_ANON_KEY: undefined, VERCEL_ENV: "preview" });
r = await call(undefined, { method: "GET" });
ok("health: a Preview deployment without the variables says to tick Preview", r.body.ready === false && r.body.database.problem === "missing" && /Preview deployment/.test(r.body.database.fix) && r.body.vars.SUPABASE_URL === false, JSON.stringify(r.body.database));
setEnv({ SUPABASE_ANON_KEY: "sb_secret_do_not_use" });
r = await call(undefined, { method: "GET" });
ok("health: a secret key is refused, named, never shown", r.body.database.problem === "secret-key" && r.supabase.length === 0 && !r.raw.includes("sb_secret_do_not_use"));
setEnv(); answer = { supabase: { status: 404, body: '{"code":"PGRST202","message":"Could not find the function public.lead_capture_health"}' } };
r = await call(undefined, { method: "GET" });
ok("health: no schema says to run leads.sql", r.body.ready === false && /run lead-capture\/leads\.sql/.test(r.body.database.fix) && /lead_capture_health/.test(r.body.database.fix), r.body.database.fix);
answer = { supabase: { status: 401, body: '{"message":"Invalid API key"}' } };
r = await call(undefined, { method: "GET" });
ok("health: a wrong key says the key was refused", /key was refused/.test(r.body.database.fix), r.body.database.fix);
setEnv({ SLACK_WEBHOOK_URL: undefined, LEAD_NOTIFY_FROM: undefined }); answer = {};
r = await call(undefined, { method: "GET" });
ok("health: names each missing notice variable", r.body.notices.email === false && /LEAD_NOTIFY_FROM/.test(r.body.notices.email_fix) && r.body.notices.slack === false && /SLACK_WEBHOOK_URL/.test(r.body.notices.slack_fix) && r.body.ready === false, JSON.stringify(r.body.notices));
setEnv({ SLACK_WEBHOOK_URL: undefined });
r = await call(undefined, { method: "GET" });
ok("health: ready with the database and one notice", r.body.ready === true && r.body.notices.slack === false);

/* ---------- A good lead: stored, then both notices ---------- */
setEnv(); answer = {};
r = await call();
ok("stored and announced: 200", r.status === 200 && r.body.ok === true && r.body.stored === undefined, JSON.stringify(r.body));
const sb = r.supabase[0], payload = sb && sb.body.payload;
ok("stored through rpc/submit_lead with the publishable key in apikey only", sb && sb.url === "https://abcdefghijklmnop.supabase.co/rest/v1/rpc/submit_lead" && sb.headers.apikey === "sb_publishable_test_key" && !sb.headers.authorization);
ok("the form's fields as columns: name, email (lowercased), company, message, form", payload && payload.name === "Ada <b>" && payload.email === "ada@example.com" && payload.company === "Ordvia" && payload.message === "Cold email & ads" && payload.form === "demo", JSON.stringify(payload));
ok("other fields kept as sent, consent and campaign kept apart", payload && payload.fields.team_size === "11-50" && payload.consent.consent === true && payload.meta.utm_source === "linkedin" && payload.meta.page.startsWith("https://"), JSON.stringify(payload));
ok("the IP is never stored, only a hash", payload && /^[0-9a-f]{64}$/.test(payload.ip_hash) && !JSON.stringify(sb.body).includes("203.0.113.9"));
const mail = r.resend[0] && r.resend[0].body, mailHead = r.resend[0] && r.resend[0].headers;
ok("one email: from, to every address, reply-to the lead", mail && mail.from === ENV.LEAD_NOTIFY_FROM && mail.to.join() === "owner@gmail.com,team@example.com" && mail.reply_to === "ada@example.com", JSON.stringify(mail && [mail.from, mail.to, mail.reply_to]));
ok("the email is sent once per lead (idempotency key) with the Resend key", mailHead && mailHead["idempotency-key"] === "lead-1b2c3d4e-0000-4000-8000-000000000000" && mailHead.authorization === "Bearer re_test_key");
ok("the email subject names the site, the lead and the form", mail && mail.subject === `New lead for ${SETTINGS.site}: Ada <b> (demo)`, mail && mail.subject);
ok("the email lists every field, labelled", mail && mail.text.includes("Team size: 11-50") && mail.text.includes("Company: Ordvia") && mail.text.includes("Source: utm_source=linkedin") && mail.text.includes("Consent: Consent: yes"), mail && mail.text);
ok("the email's HTML escapes the visitor's words", mail && mail.html.includes("Ada &lt;b&gt;") && !mail.html.includes("Ada <b>") && mail.html.includes("Cold email &amp; ads"));
ok("a stored lead's email is not marked NOT SAVED", mail && !mail.subject.includes("NOT SAVED") && !mail.text.includes("NOT SAVED"));
const slack = r.slack[0] && JSON.stringify(r.slack[0].body);
ok("one Slack message, the visitor's words escaped", r.slack.length === 1 && r.slack[0].url === ENV.SLACK_WEBHOOK_URL && slack.includes("Ada &lt;b&gt;") && !slack.includes("Ada <b>") && slack.includes("Cold email &amp; ads"));
ok("nothing else is called", r.other.length === 0 && r.supabase.length === 1);

/* ---------- Each form shape ---------- */
r = await call({ firstName: "Ana", company: "Crew Co", size: "11-50", phone: "5035550123", email: "", website: "", consentPhone: true, consentEmail: false, calculator: '{"total":1200,"per":"month"}', page: "https://x.example/" });
let p = r.supabase[0] && r.supabase[0].body.payload;
ok("phone only (no email): stored, no reply-to", r.status === 200 && p.phone === "5035550123" && p.email === "" && r.resend[0] && !("reply_to" in r.resend[0].body) && /call or text 5035550123/.test(r.resend[0].body.text), JSON.stringify(p));
ok("each consent box kept, a calculator's JSON kept as an object", p && p.consent.consentPhone === true && p.consent.consentEmail === false && p.fields.calculator.total === 1200, JSON.stringify(p && p.fields));
r = await call({ firstName: "Ada", lastName: "Lovelace", Email: "ada@example.com", interests: ["pricing", "demo"], "How can we help?": "Pricing", consent: true });
p = r.supabase[0] && r.supabase[0].body.payload;
ok("first + last name joined, any casing of email, lists kept", p && p.name === "Ada Lovelace" && p.email === "ada@example.com" && p.fields.interests.join() === "pricing,demo" && p.message === "Pricing", JSON.stringify(p));
r = await call(LEAD, { stream: true });
ok("a body read from the stream (no req.body) works too", r.status === 200 && r.supabase.length === 1);

/* ---------- A notice failing never fails the lead ---------- */
answer = { resend: { status: 500, body: "boom" } };
r = await call();
ok("Resend fails: still 200, Slack still sent", r.status === 200 && r.slack.length === 1);
answer = { slack: { status: 404, body: "no_service" } };
r = await call();
ok("Slack fails: still 200, email still sent", r.status === 200 && r.resend.length === 1);

/* ---------- Not stored: the notices carry the lead, with the reason and the deployment ---------- */
setEnv({ VERCEL_ENV: "production", VERCEL_GIT_COMMIT_REF: "main", VERCEL_GIT_COMMIT_SHA: "9c4cf55abcdef" });
const notice = (x) => ({ status: x.status, body: x.body, text: x.resend[0] ? x.resend[0].body.text : "", html: x.resend[0] ? x.resend[0].body.html : "", subject: x.resend[0] ? x.resend[0].body.subject : "", slack: x.slack[0] ? JSON.stringify(x.slack[0].body) : "", idem: x.resend[0] && x.resend[0].headers["idempotency-key"] });
answer = { supabase: { status: 404, body: '{"code":"PGRST202","message":"Could not find the function public.submit_lead(payload) in the schema cache"}' } };
let n = notice(await call());
ok("no schema: 200 through the notices, marked NOT SAVED", n.status === 200 && n.body.stored === false && n.subject.startsWith("[NOT SAVED] ") && !n.idem, n.subject);
ok("no schema: the notice names HTTP 404, the SQL file and what Supabase said", n.text.includes("HTTP 404") && n.text.includes("run lead-capture/leads.sql") && n.text.includes("PGRST202: Could not find the function"), n.text.split("\n")[0]);
ok("not stored: the notice names the deployment and links its health report", n.text.includes("Sent by the deployment: production, branch main, commit 9c4cf55.") && n.html.includes('<a href="https://www.example.com/api/lead">'), n.text.split("\n")[1]);
ok("not stored: Slack says why and where", n.slack.includes("NOT SAVED") && n.slack.includes("HTTP 404") && n.slack.includes("commit 9c4cf55"));
answer = { supabase: { status: 401, body: '{"message":"Invalid API key"}' } };
n = notice(await call());
ok("wrong key: says the key was refused", n.text.includes("HTTP 401; the key was refused") && n.text.includes("Invalid API key"), n.text.split("\n")[0]);
answer = { supabase: { status: 503, body: "upstream error" } };
n = notice(await call());
ok("Supabase 5xx: says it had an error or is paused", n.text.includes("HTTP 503; Supabase had an error, or the project is paused"), n.text.split("\n")[0]);
answer = { supabase: { throw: new DOMException("This operation was aborted", "AbortError") } };
n = notice(await call());
ok("timeout: says Supabase did not answer in 8 seconds", n.text.includes("Supabase did not answer within 8 seconds"), n.text.split("\n")[0]);
answer = { supabase: { throw: Object.assign(new TypeError("fetch failed"), { cause: { code: "ENOTFOUND" } }) } };
n = notice(await call());
ok("unknown host: says to check the project URL", n.text.includes("the host in SUPABASE_URL does not exist"), n.text.split("\n")[0]);
setEnv({ SUPABASE_ANON_KEY: undefined }); answer = {};
r = await call(); n = notice(r);
ok("key not visible: no database call, names the one missing variable", r.supabase.length === 0 && n.text.includes("this deployment cannot see SUPABASE_ANON_KEY:") && !n.text.includes("SUPABASE_URL and"), n.text.split("\n")[0]);
setEnv({ SUPABASE_ANON_KEY: "sb_secret_do_not_leak" });
r = await call(); n = notice(r);
ok("secret key: never used, never shown", r.supabase.length === 0 && n.text.includes("holds a secret key") && !n.text.includes("sb_secret_do_not_leak") && !n.html.includes("sb_secret_do_not_leak") && !n.slack.includes("sb_secret_do_not_leak"));

/* ---------- Nothing works, nothing connected ---------- */
setEnv(); answer = { supabase: { status: 500 }, resend: { status: 500 }, slack: { status: 500 } };
r = await call();
ok("everything fails: 502, so the form says it did not send", r.status === 502 && r.body.ok === undefined);
setEnv({ SUPABASE_URL: undefined, SUPABASE_ANON_KEY: undefined, RESEND_API_KEY: undefined, SLACK_WEBHOOK_URL: undefined }); answer = {};
r = await call();
ok("nothing connected: 503 configured false, nothing called", r.status === 503 && r.body.configured === false && calls.length === 0);

/* ---------- What the visitor (or a bot) gets wrong ---------- */
setEnv(); answer = {};
r = await call({ ...LEAD, work_email: "nope" });
ok("an invalid email: 400, nothing called", r.status === 400 && /valid email/.test(r.body.error) && calls.length === 0);
r = await call({ full_name: "No Contact", message: "hi" });
ok("no email and no phone: 400", r.status === 400 && /email or a phone/.test(r.body.error) && calls.length === 0);
answer = { supabase: { status: 400, body: '{"message":"A valid email is required"}' } };
r = await call();
ok("Supabase 400: passed on, no notice", r.status === 400 && r.body.error === "A valid email is required" && r.resend.length === 0 && r.slack.length === 0);
answer = { supabase: { status: 429, body: '{"code":"PT429","message":"Too many submissions. Please try again later"}' } };
r = await call();
ok("Supabase 429 (the rate limit): passed on, no notice", r.status === 429 && /Too many/.test(r.body.error) && r.resend.length === 0);
answer = {};
for (const hp of ["hp", "honeypot", "_gotcha"]) {
  r = await call({ ...LEAD, [hp]: "https://spam.example" });
  ok(`honeypot ${hp}: 200, nothing stored or sent`, r.status === 200 && calls.length === 0);
}
r = await call({ ...LEAD, website: "https://ordvia.example" });
ok("a real field named website is kept, not taken for a bot", r.status === 200 && r.supabase.length === 1 && r.supabase[0].body.payload.fields.website === "https://ordvia.example", `${r.status}, ${r.supabase.length} database call(s)`);
r = await call(LEAD, { headers: { origin: "https://evil.example" } });
ok("another site posting: 403, nothing called", r.status === 403 && calls.length === 0);
r = await call(LEAD, { headers: { origin: undefined } });
ok("no Origin (a server, not a browser): checked like any other", r.status === 200 && r.supabase.length === 1);
r = await call("[1,2]", { stream: true });
ok("not an object: 400", r.status === 400 && calls.length === 0);
r = await call("x".repeat(40000), { stream: true });
ok("over 32 KB: 413", r.status === 413 && calls.length === 0);
r = await call(undefined, { method: "DELETE" });
ok("DELETE: 405 with Allow", r.status === 405 && r.headers.allow === "GET, POST");
if (SETTINGS.requireConsent) {
  r = await call({ ...LEAD, consent: false });
  ok("consent required (SETTINGS.requireConsent): 400 without a ticked box", r.status === 400 && /Consent/.test(r.body.error) && calls.length === 0);
} else {
  r = await call({ ...LEAD, consent: false });
  ok("consent not required: stored, recorded as no", r.status === 200 && r.supabase.length === 1 && r.supabase[0].body.payload.consent.consent === false);
}

/* ---------- No key, webhook, salt or recipient ever reaches the visitor ---------- */
setEnv(); answer = {};
const all = [await call(), await call(undefined, { method: "GET" }), await call({ ...LEAD, work_email: "x" })];
ok("no secret in any response", all.every((x) => SECRETS.every((s) => !x.raw.includes(s)) && !x.raw.includes("owner@gmail.com")));

console.error = quiet;
console.log(`check-api: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
