#!/usr/bin/env node
/**
 * The Meta lead endpoint, api/lead.mjs, run for real with Supabase, Resend, Slack and Meta's Conversions API stubbed
 * (no network, no keys): the health report; a qualified Gap Check stored with the server's own score, announced, sent
 * to Meta with the browser's event id and hashed details, and emailed to the prospect; the server re-scoring answers the
 * browser lied about; unqualified answers, Global Privacy Control and a missing setup keeping Meta out; the call step and
 * its checks; the visitor's errors; the honeypot; another site posting; Supabase failing (NOT SAVED notices, Meta still
 * told); Meta failing (the lead still fine); no key, token or Meta id ever in a response or the owner's notice.
 *
 *   node tests/check-api.mjs
 */
import { Readable } from "node:stream";
import { createHash } from "node:crypto";

const mod = await import(new URL("../api/lead.mjs", import.meta.url));
const handler = mod.default;

let pass = 0, fail = 0;
const crashed = (e) => { process.stdout.write(`FAIL crashed: ${e && e.stack || e}\ncheck-api: ${pass} passed, ${fail + 1} failed\n`); process.exit(1); };
process.on("uncaughtException", crashed); process.on("unhandledRejection", crashed);
const ok = (name, cond, info = "") => { if (cond) { pass++; console.log(`ok   ${name}`); } else { fail++; console.log(`FAIL ${name}${info ? `: ${info}` : ""}`); } };
const sha = (s) => createHash("sha256").update(s).digest("hex");

let calls = [], answer = {};
globalThis.fetch = async (url, init = {}) => {
  const u = String(url);
  const svc = u.includes("/rest/v1/") ? "supabase" : u.startsWith("https://api.resend.com/") ? "resend" : u.startsWith("https://hooks.slack.com/") ? "slack" : u.startsWith("https://graph.facebook.com/") ? "meta" : "other";
  calls.push({ svc, url: u, headers: init.headers || {}, body: init.body ? JSON.parse(init.body) : null });
  const a = answer[svc] || { status: 200, body: svc === "supabase" ? (u.endsWith("lead_capture_health") ? '"lead-capture v1"' : '"1b2c3d4e-0000-4000-8000-000000000000"') : svc === "slack" ? "ok" : svc === "meta" ? '{"events_received":1}' : '{"id":"e1"}' };
  if (a.throw) throw new Error("network down");
  return new Response(a.body ?? "", { status: a.status });
};
console.error = () => {};

const ENV = {
  SUPABASE_URL: "https://abcdefghijklmnop.supabase.co", SUPABASE_ANON_KEY: "sb_publishable_test_key", LEAD_HASH_SALT: "salt-0f3a9c",
  RESEND_API_KEY: "re_test_key", LEAD_NOTIFY_FROM: "Leads <leads@example.com>", LEAD_NOTIFY_TO: "owner@gmail.com",
  SLACK_WEBHOOK_URL: "https://hooks.slack.com/services/T000/B000/SECRETPATH",
  META_PIXEL_ID: "1234567890", META_CAPI_TOKEN: "EAAtesttokenSECRET", META_TEST_EVENT_CODE: "TEST123",
  PROSPECT_EMAIL_FROM: "Ali at Rempo <ali@example.com>", PROSPECT_REPLY_TO: "ali@example.com"
};
const ALL = [...Object.keys(ENV), "META_GRAPH_VERSION", "VERCEL_ENV", "VERCEL_GIT_COMMIT_REF", "VERCEL_GIT_COMMIT_SHA"];
function setEnv(over = {}) {
  for (const k of ALL) delete process.env[k];
  Object.assign(process.env, ENV, over);
  for (const [k, v] of Object.entries(over)) if (v === undefined) delete process.env[k];
}
const SECRETS = ["sb_publishable_test_key", "re_test_key", "SECRETPATH", "salt-0f3a9c", "EAAtesttokenSECRET"];

const VISIT = "0b8c6c1e-1111-4222-8333-944455556666";
const ANSWERS = { trade: "plumbing", asks: "remember", newest: "over3", replies: "rarely", compare: "unchecked", jobs: "16to40", records: "fieldsoftware", profiles: "1" };
const REPORT = {
  form: "meta-gap-report", firstName: "Tom", email: "Tom@MapleStreet.com", company: "Maple Street Plumbing", city: "Springfield", consentEmail: true,
  ...ANSWERS, variant: "top-three", visit: VISIT, tz: "America/Chicago",
  page: "https://go.example.com/?utm_source=facebook&utm_campaign=gap", utm_source: "facebook", utm_campaign: "gap", fbclid: "IwAR0abcdefghij",
  tracking: { fbc: "fb.1.1762540000000.IwAR0abcdefghij", fbp: "fb.1.1762540000000.1234567890", leadEventId: `lead-${VISIT}`, gpc: false }
};
const weekday = (() => { const d = new Date(); do { d.setDate(d.getDate() + 1); } while (d.getDay() === 0 || d.getDay() === 6); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; })();
const CALL = {
  form: "meta-call", firstName: "Tom", email: "tom@maplestreet.com", company: "Maple Street Plumbing", city: "Springfield",
  ...ANSWERS, phone: "(512) 555-0134", consentPhone: true, consentText: false, slotDay: weekday, slotWindow: "morning",
  variant: "top-three", visit: VISIT, page: "https://go.example.com/", tracking: { scheduleEventId: `schedule-${VISIT}`, gpc: false }
};

async function call(body, { method = "POST", headers = {} } = {}) {
  calls = [];
  const h = { host: "go.example.com", origin: "https://go.example.com", "x-forwarded-for": "203.0.113.9", "user-agent": "Mozilla/5.0 (iPhone) FBAN/FBIOS", ...headers };
  for (const k of Object.keys(h)) if (h[k] === undefined) delete h[k];
  const req = { method, headers: h, body };
  const res = { statusCode: 0, headers: {}, setHeader(k, v) { this.headers[k.toLowerCase()] = v; }, end(s) { this.raw = s || ""; try { this.body = s ? JSON.parse(s) : null; } catch { this.body = s; } } };
  await handler(req, res);
  const by = (svc) => calls.filter((c) => c.svc === svc);
  return { status: res.statusCode, body: res.body, raw: res.raw, supabase: by("supabase"), resend: by("resend"), slack: by("slack"), meta: by("meta") };
}

/* ---------- Health ---------- */
setEnv();
let r = await call(undefined, { method: "GET" });
ok("health: ready, database and both notices", r.status === 200 && r.body.ready === true && r.body.database.ok && r.body.notices.email && r.body.notices.slack, r.raw);
ok("health: the Conversions API and the prospect email show as set up", r.body.meta.conversionsApi === true && r.body.meta.testMode === true && r.body.prospect.email === true);
ok("health: the pixel on the page is flagged until site.metaPixelId is set", r.body.meta.pixelOnPage === false && typeof r.body.meta.pixel_fix === "string");
ok("health: variables as true or false only, never a value", Object.values(r.body.vars).every((v) => typeof v === "boolean") && SECRETS.every((s) => !r.raw.includes(s)), r.raw);
setEnv({ META_PIXEL_ID: undefined, META_CAPI_TOKEN: undefined });
r = await call(undefined, { method: "GET" });
ok("health: says how to turn the Conversions API on", r.body.meta.conversionsApi === false && /META_PIXEL_ID/.test(r.body.meta.fix));

/* ---------- A qualified Gap Check ---------- */
setEnv();
r = await call(REPORT);
ok("report: 200 ok, and the prospect email confirmed", r.status === 200 && r.body.ok === true && r.body.confirmEmail === true, r.raw);
const p = r.supabase[0] && r.supabase[0].body && r.supabase[0].body.payload;
ok("report: stored through submit_lead as meta-gap-report", r.supabase.length === 1 && r.supabase[0].url.endsWith("/rpc/submit_lead") && p.form === "meta-gap-report");
ok("report: contact columns (email lowercased, first name, business)", p.email === "tom@maplestreet.com" && p.name === "Tom" && p.company === "Maple Street Plumbing");
ok("report: the server's own score, tier, fit, route and gaps in fields", p.fields.score === 79 && p.fields.tier === "stalled" && p.fields.fit === "qualified" && p.fields.route === "call or checkout" && p.fields.gaps.join() === "asks,newest,compare", JSON.stringify(p.fields));
ok("report: the answers, city, variant, visit and time zone kept", p.fields.trade === "plumbing" && p.fields.profiles === "1" && p.fields.city === "Springfield" && p.fields.variant === "top-three" && p.fields.visit === VISIT && p.fields.tz === "America/Chicago");
ok("report: no tracking object left in fields", !("tracking" in p.fields));
ok("report: campaign, fbclid, fbc, fbp and the event id in meta", p.meta.utm_campaign === "gap" && p.meta.fbclid === "IwAR0abcdefghij" && p.meta.fbc === REPORT.tracking.fbc && p.meta.fbp === REPORT.tracking.fbp && p.meta.meta_event_id === `lead-${VISIT}`, JSON.stringify(p.meta));
ok("report: the email consent kept", p.consent.consentEmail === true);
ok("report: the IP address never stored, only its salted hash", !JSON.stringify(p).includes("203.0.113.9") && /^[a-f0-9]{64}$/.test(p.ip_hash));
const owner = r.resend.find((c) => c.body.to && c.body.to.includes && c.body.to.includes("owner@gmail.com"));
ok("report: the owner is emailed and told in Slack", owner && /New lead for Rempo \(Meta\): Tom \(meta-gap-report\)/.test(owner.body.subject) && r.slack.length === 1);
ok("report: the owner's notice shows the score and fit", owner && /Score: 79/.test(owner.body.text) && /Fit: qualified/.test(owner.body.text), owner && owner.body.text);
ok("report: the owner's notice leaves out fbc, fbp and the event id", owner && !/fbc|fbp|meta_event_id|IwAR0abcdefghij\.|1234567890/.test(owner.body.text.replace(/fbclid=IwAR0abcdefghij/, "")), owner && owner.body.text);
ok("report: one event to the Conversions API", r.meta.length === 1 && r.meta[0].url.startsWith("https://graph.facebook.com/v25.0/1234567890/events?access_token="));
const e = r.meta[0] && r.meta[0].body.data[0];
ok("report: Lead, the browser's event id, website, the page", e && e.event_name === "Lead" && e.event_id === `lead-${VISIT}` && e.action_source === "website" && e.event_source_url === REPORT.page);
ok("report: email, first name, city, country and visit id hashed as Meta asks", e && e.user_data.em[0] === sha("tom@maplestreet.com") && e.user_data.fn[0] === sha("tom") && e.user_data.ct[0] === sha("springfield") && e.user_data.country[0] === sha("us") && e.user_data.external_id[0] === sha(VISIT));
ok("report: fbc, fbp, IP and user agent sent unhashed", e && e.user_data.fbc === REPORT.tracking.fbc && e.user_data.fbp === REPORT.tracking.fbp && e.user_data.client_ip_address === "203.0.113.9" && /FBIOS/.test(e.user_data.client_user_agent));
ok("report: no phone in a Gap Check event", e && !e.user_data.ph);
ok("report: the test event code goes along while set", r.meta[0] && r.meta[0].body.test_event_code === "TEST123");
const pros = r.resend.find((c) => c.body.to && c.body.to[0] === "tom@maplestreet.com");
ok("report: the prospect gets their score, from a person, replies to them", pros && pros.body.subject === "Your Review Engine score: 79/100" && pros.body.from === ENV.PROSPECT_EMAIL_FROM && pros.body.reply_to === "ali@example.com");
ok("report: the prospect's email lists the three gaps and the report's search", pros && /1\. Asking depends on who remembers\./.test(pros.body.text) && /plumbing in Springfield/.test(pros.body.text) && /within one business day/.test(pros.body.text), pros && pros.body.text);
ok("report: the prospect's email can be retried without sending twice", pros && /^prospect-report-/.test(pros.headers["idempotency-key"]));
ok("report: no key or token in the response or any notice", SECRETS.every((s) => !r.raw.includes(s) && !JSON.stringify(r.resend.map((c) => c.body)).includes(s) && !JSON.stringify(r.slack.map((c) => c.body)).includes(s)));

/* ---------- The server scores again: the browser cannot talk its way into Meta ---------- */
r = await call({ ...REPORT, jobs: "lt5", score: 99, fit: "qualified", tier: "steady" });
const p2 = r.supabase[0].body.payload;
ok("re-score: fewer than 5 jobs a week is under the floor, whatever the browser says", r.status === 200 && p2.fields.fit === "under-floor" && p2.fields.score === 70, JSON.stringify(p2.fields));
ok("re-score: under the floor, nothing to Meta", r.meta.length === 0);
ok("re-score: the prospect still gets their score", r.resend.some((c) => c.body.to && c.body.to[0] === "tom@maplestreet.com"));
r = await call({ ...REPORT, records: "paper" });
ok("paper: no-software, a call-only route, nothing to Meta", r.supabase[0].body.payload.fields.fit === "no-software" && r.supabase[0].body.payload.fields.route === "call (records)" && r.meta.length === 0);
r = await call({ ...REPORT, profiles: "3to9" });
ok("3 to 9 profiles: qualified for Meta, routed to a call", r.supabase[0].body.payload.fields.fit === "qualified" && r.supabase[0].body.payload.fields.route === "call (profiles)" && r.meta.length === 1);
r = await call({ ...REPORT, trade: "carpentry" });
ok("an answer that is not one of the options: 400, says which", r.status === 400 && r.body.missing.includes("trade"), r.raw);

/* ---------- Privacy and setup keep Meta out ---------- */
r = await call({ ...REPORT, tracking: { ...REPORT.tracking, gpc: true } });
ok("Global Privacy Control: stored, nothing to Meta, no fbc kept", r.status === 200 && r.meta.length === 0 && r.supabase[0].body.payload.meta.gpc === "true");
setEnv({ META_PIXEL_ID: undefined, META_CAPI_TOKEN: undefined });
r = await call(REPORT);
ok("no Conversions API set up: the lead is fine, nothing to Meta", r.status === 200 && r.body.ok && r.meta.length === 0);
setEnv({ PROSPECT_EMAIL_FROM: undefined });
r = await call(REPORT);
ok("no prospect sender set up: only the owner is emailed, confirmEmail false", r.status === 200 && r.body.confirmEmail === false && r.resend.length === 1 && r.resend[0].body.to.includes("owner@gmail.com"));
setEnv({ META_GRAPH_VERSION: "v26.0" });
r = await call(REPORT);
ok("META_GRAPH_VERSION picks the Graph API version", r.meta[0].url.includes("/v26.0/"));
setEnv({ META_TEST_EVENT_CODE: undefined });
r = await call(REPORT);
ok("without a test code, events count for real", r.meta[0] && !("test_event_code" in r.meta[0].body));

/* ---------- Ids that do not look right are dropped or remade ---------- */
setEnv();
r = await call({ ...REPORT, tracking: { fbc: "javascript:alert(1)", fbp: "nope", leadEventId: "<script>", gpc: false } });
const m3 = r.supabase[0].body.payload.meta, e3 = r.meta[0].body.data[0];
ok("bad fbc and fbp: not stored, not sent", !m3.fbc && !m3.fbp && !e3.user_data.fbc && !e3.user_data.fbp);
ok("bad event id: the server makes a stable one", /^lead-[a-f0-9]{24}$/.test(e3.event_id) && m3.meta_event_id === e3.event_id);

/* ---------- The call step ---------- */
r = await call(CALL);
const c = r.supabase[0] && r.supabase[0].body.payload;
ok("call: 200 ok, stored as meta-call", r.status === 200 && c.form === "meta-call", r.raw);
ok("call: the phone as 10 digits, the slot, the consent", c.phone === "5125550134" && c.fields.slotDay === weekday && c.fields.slotWindow === "morning" && c.consent.consentPhone === true);
const se = r.meta[0] && r.meta[0].body.data[0];
ok("call: Schedule with the browser's event id and the hashed phone (with the country code)", se && se.event_name === "Schedule" && se.event_id === `schedule-${VISIT}` && se.user_data.ph[0] === sha("15125550134"));
const pc = r.resend.find((x) => x.body.to && x.body.to[0] === "tom@maplestreet.com");
ok("call: the prospect's booking email, asking for a YES", pc && /^You're booked: \w{3}, \w{3} \d+, morning$/.test(pc.body.subject) && /reply YES to confirm/i.test(pc.body.text) && /\(512\) 555-0134/.test(pc.body.text), pc && pc.body.subject);
r = await call({ ...CALL, phone: "555-0134" });
ok("call: a short phone number is refused", r.status === 400 && /phone/.test(r.body.error));
r = await call({ ...CALL, consentPhone: false });
ok("call: no consent to call is refused", r.status === 400 && /Consent/.test(r.body.error));
const sat = (() => { const d = new Date(); while (d.getDay() !== 6) d.setDate(d.getDate() + 1); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; })();
r = await call({ ...CALL, slotDay: sat });
ok("call: a weekend day is refused", r.status === 400 && /day and a time/.test(r.body.error));
r = await call({ ...CALL, slotDay: "2031-01-06" });
ok("call: a day weeks away is refused", r.status === 400);
r = await call({ ...CALL, slotWindow: "midnight" });
ok("call: a time window that is not offered is refused", r.status === 400);
r = await call({ ...CALL, jobs: "lt5" });
ok("call: under the floor, stored and emailed, no Schedule to Meta", r.status === 200 && r.meta.length === 0);

/* ---------- The visitor's errors ---------- */
r = await call({ ...REPORT, email: "tom@" });
ok("a bad email: 400", r.status === 400 && /valid email/.test(r.body.error));
r = await call({ ...REPORT, consentEmail: false });
ok("no email consent: 400", r.status === 400 && /Consent/.test(r.body.error));
r = await call({ ...REPORT, company: "" });
ok("no business name: 400", r.status === 400 && /business name/.test(r.body.error));
r = await call({ ...REPORT, form: "book-call" });
ok("another form name: 400 (this endpoint takes only the Meta forms)", r.status === 400 && /Unknown form/.test(r.body.error));
r = await call({ ...REPORT, hp: "I am a bot" });
ok("the honeypot: answers ok, stores and sends nothing", r.status === 200 && r.supabase.length === 0 && r.resend.length === 0 && r.meta.length === 0);
r = await call(REPORT, { headers: { origin: "https://evil.example" } });
ok("another site posting: 403", r.status === 403 && r.supabase.length === 0);
r = await call(REPORT, { method: "PUT" });
ok("PUT: 405 with Allow", r.status === 405);
answer = { supabase: { status: 429, body: '{"message":"Too many submissions. Please try again later"}' } };
r = await call(REPORT);
ok("rate limited by Supabase: 429, nothing else sent", r.status === 429 && r.resend.length === 0 && r.meta.length === 0);

/* ---------- When a service fails ---------- */
answer = { supabase: { status: 500, body: '{"message":"boom"}' } };
r = await call(REPORT);
const ns = r.resend.find((x) => x.body.to && x.body.to.includes && x.body.to.includes("owner@gmail.com"));
ok("Supabase failing: the notices go, marked NOT SAVED, the visitor sees ok", r.status === 200 && r.body.stored === false && ns && /^\[NOT SAVED\]/.test(ns.body.subject));
ok("Supabase failing: Meta is still told about the qualified lead", r.meta.length === 1);
answer = { supabase: { throw: true }, resend: { status: 500, body: "x" }, slack: { status: 500, body: "x" } };
r = await call(REPORT);
ok("nothing working: 502", r.status === 502);
answer = { meta: { status: 400, body: '{"error":{"message":"Invalid parameter"}}' } };
r = await call(REPORT);
ok("Meta failing: the lead is still stored and ok", r.status === 200 && r.body.ok && r.supabase.length === 1);
answer = {};
setEnv({ SUPABASE_URL: undefined, SUPABASE_ANON_KEY: undefined, RESEND_API_KEY: undefined, SLACK_WEBHOOK_URL: undefined });
r = await call(REPORT);
ok("nothing set up at all: 503 not configured", r.status === 503 && r.body.configured === false);

console.log(`check-api: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
