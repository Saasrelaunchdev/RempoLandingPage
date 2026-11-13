// The self-serve checkout (/start, api/checkout.mjs, api/stripe-webhook.mjs), with every outside service stubbed:
// Stripe, Supabase, GoHighLevel, Resend and Slack answer from fetch stubs, so this runs anywhere with no keys.
import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { formEncode, verifySignature, buildCatalog, sessionParams, publicPlan } from "../../api/_lib/checkout/stripe.mjs";
import { routeFor, renewalText, priceSummary } from "../../assets/checkout-shared.mjs";
import { purchaseTags, e164 } from "../../api/_lib/checkout/ghl.mjs";
import checkout from "../../api/checkout.mjs";
import { POST as webhook } from "../../api/stripe-webhook.mjs";

/* ---------- Stubs ---------- */
const realFetch = globalThis.fetch;
const savedEnv = { ...process.env };
afterEach(() => {
  globalThis.fetch = realFetch;
  for (const k of Object.keys(process.env)) if (!(k in savedEnv)) delete process.env[k];
  Object.assign(process.env, savedEnv);
});

let keyCount = 0;
// A fresh test key each time, so the catalog cache (per key) never carries over between tests
const freshKey = (mode = "test") => `sk_${mode}_unit${++keyCount}`;
const WHSEC = "whsec_unit_secret";
function env(extra = {}) {
  Object.assign(process.env, {
    STRIPE_SECRET_KEY: freshKey(), STRIPE_WEBHOOK_SECRET: WHSEC,
    SUPABASE_URL: "https://proj.supabase.co", SUPABASE_ANON_KEY: "sb_publishable_unit", SUPABASE_SECRET_KEY: "sb_secret_unit",
    GHL_TOKEN: "pit-unit-token", GHL_LOCATION_ID: "loc_unit", ONBOARDING_URL: "https://link.example.com/onboarding?src=rempo",
    RESEND_API_KEY: "re_unit", LEAD_NOTIFY_FROM: "Rempo <leads@rempo.io>", LEAD_NOTIFY_TO: "team@rempo.io",
    SLACK_WEBHOOK_URL: "https://hooks.slack.com/services/T/B/x"
  }, extra);
  for (const [k, v] of Object.entries(extra)) if (v === undefined) delete process.env[k];
}

const price = (id, lookup_key, unit_amount, recurring, name = "Rempo") => ({ id, object: "price", lookup_key, unit_amount, currency: "usd",
  billing_scheme: "per_unit", type: recurring ? "recurring" : "one_time", recurring: recurring ? { interval: recurring, interval_count: 1 } : null,
  product: { id: `prod_${id}`, name, active: true } });
const PRICES = [
  price("price_dfy_m", "rempo_dfy_monthly", 29700, "month", "Done For You"),
  price("price_dfy_y", "rempo_dfy_annual", 297000, "year", "Done For You"),
  price("price_dfy_s", "rempo_dfy_setup", 49700, null, "Setup"),
  price("price_tune", "rempo_gbp_tuneup", 19700, null, "GBP Tune-Up")
];

// fetch, answered by routes: [test(url, init) -> bool, answer(url, init) -> { status, body }]. Every call is recorded.
function stub(routes) {
  const calls = [];
  globalThis.fetch = async (input, init = {}) => {
    const url = new URL(typeof input === "string" ? input : input.url);
    const call = { url, method: init.method || "GET", body: init.body, headers: init.headers || {} };
    calls.push(call);
    for (const [match, answer] of routes) {
      if (match(url, call)) {
        const out = await answer(url, call);
        const status = out.status || 200;
        // 204 and 304 carry no body
        const body = status === 204 || status === 304 || out.body === undefined ? null : typeof out.body === "string" ? out.body : JSON.stringify(out.body);
        return new Response(body, { status, headers: { "content-type": "application/json" } });
      }
    }
    return new Response(JSON.stringify({ error: `not stubbed: ${url}` }), { status: 599 });
  };
  return calls;
}
const at = (host, path) => (u, c) => u.host === host && (typeof path === "string" ? u.pathname === path : path.test(u.pathname));
const stripePrices = [at("api.stripe.com", "/v1/prices"), () => ({ body: { object: "list", data: PRICES } })];
const decode = (body) => Object.fromEntries(new URLSearchParams(body));

// The legacy (req, res) handler
function req({ method = "GET", url = "/api/checkout", headers = {}, body } = {}) {
  return { method, url, headers: { host: "rempo.io", "x-forwarded-proto": "https", ...headers }, body };
}
function res() {
  return { statusCode: 200, headers: {}, body: "", setHeader(k, v) { this.headers[k.toLowerCase()] = v; }, end(b) { this.body = b || ""; } };
}
async function call(r) { const out = res(); await checkout(r, out); return { status: out.statusCode, data: out.body ? JSON.parse(out.body) : null, headers: out.headers }; }

const BUYER = { answers: { profiles: "2", software: "yes", runs: "handle" }, billing: "monthly", firstName: "Tom", business: "Maple Street Plumbing",
  email: "Tom@MapleStreet.com", phone: "(512) 555-0134", consentEmail: true, consentPhone: false, visit: "v_abc12345", noticeVersion: "2026-11-08",
  utm: { utm_source: "facebook", utm_campaign: "gap" } };
const post = (body, headers = { origin: "https://rempo.io" }) => req({ method: "POST", headers: { "content-type": "application/json", ...headers }, body });

/* ---------- The pieces ---------- */
test("formEncode writes Stripe's bracket form and leaves out undefined", () => {
  const out = formEncode({ a: { b: [1, { c: "x y" }] }, d: undefined, e: true }).join("&");
  assert.equal(decodeURIComponent(out), "a[b][0]=1&a[b][1][c]=x y&e=true");
});

test("verifySignature accepts Stripe's signature and refuses everything else", () => {
  const raw = JSON.stringify({ id: "evt_1" });
  const t = Math.floor(Date.now() / 1000);
  const sig = (secret, ts = t, body = raw) => createHmac("sha256", secret).update(`${ts}.${body}`).digest("hex");
  assert.equal(verifySignature(raw, `t=${t},v1=${sig(WHSEC)}`, [WHSEC]).ok, true);
  assert.equal(verifySignature(Buffer.from(raw), `t=${t},v1=${"0".repeat(64)},v1=${sig(WHSEC)}`, [WHSEC]).ok, true, "any v1 may match");
  assert.equal(verifySignature(raw, `t=${t},v1=${sig("whsec_old")}`, ["whsec_new", "whsec_old"]).ok, true, "a second secret while rolling it");
  assert.equal(verifySignature(raw + " ", `t=${t},v1=${sig(WHSEC)}`, [WHSEC]).ok, false, "a changed body");
  assert.equal(verifySignature(raw, `t=${t},v1=${sig("whsec_other")}`, [WHSEC]).ok, false, "another secret");
  assert.equal(verifySignature(raw, `t=${t - 600},v1=${sig(WHSEC, t - 600)}`, [WHSEC]).ok, false, "too old");
  assert.equal(verifySignature(raw, "garbage", [WHSEC]).ok, false);
  assert.equal(verifySignature(raw, null, [WHSEC]).ok, false);
});

test("routeFor sends each buyer where the GTM's qualifier says", () => {
  const r = (profiles, software, runs, avail) => routeFor({ profiles, software, runs }, avail);
  assert.deepEqual(r("1", "yes", "handle"), { to: "plan", plan: "done-for-you" });
  assert.deepEqual(r("2", "yes", "office"), { to: "plan", plan: "engine-software" });
  assert.deepEqual(r("1", "yes", "not-sure"), { to: "plan", plan: "jumpstart" });
  assert.deepEqual(r("1", "no", "handle"), { to: "plan", plan: "jumpstart" });
  assert.deepEqual(r("3+", "yes", "handle"), { to: "call", why: "profiles" });
  assert.deepEqual(r("1", "not-sure", "handle"), { to: "call", why: "software-check" });
  assert.deepEqual(r("1", "yes", "handle", () => false), { to: "call", why: "plan-not-offered" });
  assert.deepEqual(r("1", "", "handle"), { to: "incomplete" });
});

test("the renewal terms state the price, the term, the setup fee and how to cancel", () => {
  const plan = { mode: "subscription", currency: "usd", monthly: { amount: 29700 }, annual: { amount: 297000 }, setup: { amount: 49700 } };
  const monthly = renewalText(plan, "monthly", 2);
  assert.match(monthly, /Renews every month at \$297 per Google profile, \$594 for 2 profiles, until you cancel\./);
  assert.match(monthly, /The \$497 setup fee is charged once, today\./);
  assert.match(monthly, /Cancel any time online or by email/);
  const annual = renewalText(plan, "annual", 1);
  assert.match(annual, /Renews every year at \$2,970 until you cancel\./);
  assert.doesNotMatch(annual, /setup fee/, "annual waives the setup fee");
  assert.deepEqual(priceSummary(plan, "monthly", 2), { today: 109100, renews: 59400, per: "month", recurring: 29700, setup: 49700, profiles: 2 });
  assert.match(renewalText({ mode: "payment", currency: "usd", once: { amount: 19700 } }, "once", 1), /One payment of \$197\. Nothing renews\./);
  assert.match(renewalText(plan, "monthly", 1, { guarantee: "First requests within 7 days, or your setup fee back." }), /setup fee back\.$/);
  assert.ok(renewalText(plan, "monthly", 1, { guarantee: "x".repeat(2000) }).length <= 1200, "Stripe's 1,200-character limit");
});

test("the catalog offers a plan only when its prices are in Stripe, and flags wrong ones", () => {
  const byKey = Object.fromEntries(PRICES.map((p) => [p.lookup_key, p]));
  const c = buildCatalog(byKey);
  assert.deepEqual(Object.keys(c.plans), ["done-for-you"]);
  assert.equal(c.plans["done-for-you"].bump.amount, 19700);
  assert.equal(c.found.rempo_engine_monthly, false);
  const wrong = buildCatalog({ ...byKey, rempo_dfy_annual: price("price_bad", "rempo_dfy_annual", 297000, "month") });
  assert.ok(wrong.problems.some((p) => /rempo_dfy_annual: should be a yearly recurring price/.test(p)), wrong.problems.join("; "));
  assert.equal(wrong.plans["done-for-you"].annual, undefined, "a wrong price is not used");
});

test("the Checkout Session: profiles as quantity, setup only on monthly, the add-on optional, the terms required", () => {
  const plan = buildCatalog(Object.fromEntries(PRICES.map((p) => [p.lookup_key, p]))).plans["done-for-you"];
  const buyer = { ...BUYER, email: "tom@maplestreet.com" };
  const p = sessionParams({ plan, billing: "monthly", profiles: 2, buyer, visit: "v_abc12345", leadId: "lead-1", origin: "https://rempo.io", now: 1_700_000_000_000 });
  assert.deepEqual(p.line_items, [{ price: "price_dfy_m", quantity: 2 }, { price: "price_dfy_s", quantity: 1 }]);
  assert.deepEqual(p.optional_items, [{ price: "price_tune", quantity: 1 }]);
  assert.equal(p.mode, "subscription");
  assert.equal(p.success_url, "https://rempo.io/start/welcome?session_id={CHECKOUT_SESSION_ID}");
  assert.equal(p.consent_collection.terms_of_service, "required");
  assert.equal(p.expires_at, 1_700_000_000 + 3600);
  assert.equal(p.after_expiration.recovery.enabled, true);
  assert.equal(p.client_reference_id, "v_abc12345");
  assert.equal(p.metadata.source, "rempo.io/start");
  assert.equal(p.metadata.profiles, "2");
  assert.equal(p.metadata.consent_email, "true");
  assert.equal(p.metadata.utm_campaign, "gap");
  assert.deepEqual(p.subscription_data.metadata, p.metadata);
  for (const v of Object.values(p.metadata)) assert.ok(typeof v === "string" && v.length <= 500);
  assert.match(p.custom_text.submit.message, /until you cancel/);
  const annual = sessionParams({ plan, billing: "annual", profiles: 1, buyer, origin: "https://rempo.io" });
  assert.deepEqual(annual.line_items, [{ price: "price_dfy_y", quantity: 1 }], "no setup fee on annual");
  const once = sessionParams({ plan: { id: "jumpstart", mode: "payment", currency: "usd", once: { id: "price_js", amount: 19700 } }, billing: "once", profiles: 2, buyer, origin: "https://rempo.io" });
  assert.deepEqual(once.line_items, [{ price: "price_js", quantity: 1 }]);
  assert.equal(once.customer_creation, "always");
  assert.equal(once.subscription_data, undefined);
  assert.equal(p.automatic_tax, undefined, "no sales tax unless the business turns it on");
  const taxed = sessionParams({ plan, billing: "monthly", profiles: 1, buyer, origin: "https://rempo.io", tax: true });
  assert.deepEqual(taxed.automatic_tax, { enabled: true });
  assert.equal(taxed.billing_address_collection, "required");
});

test("each plan has its line and what it includes, and the catalog passes them to the page", () => {
  const plan = buildCatalog(Object.fromEntries(PRICES.map((p) => [p.lookup_key, p]))).plans["done-for-you"];
  assert.ok(plan.blurb.length > 20);
  assert.ok(plan.includes.length >= 3);
  assert.deepEqual(publicPlan(plan).includes, plan.includes);
});

test("GoHighLevel gets the paid tag first, then the plan, and US phones as +1", () => {
  const cfg = { paidTag: "rempo-paid" };
  assert.deepEqual(purchaseTags(cfg, { plan: "done-for-you", billing: "monthly", profiles: 2, bump: true, consentEmail: true, consentPhone: false, livemode: true }),
    ["rempo-paid", "rempo-plan-done-for-you", "rempo-billing-monthly", "rempo-profiles-2", "rempo-addon-bought", "rempo-email-ok"]);
  assert.ok(purchaseTags(cfg, { plan: "jumpstart", billing: "once", livemode: false }).includes("rempo-test-mode"), "a test purchase is marked");
  assert.equal(e164("(512) 555-0134"), "+15125550134");
  assert.equal(e164("1 512 555 0134"), "+15125550134");
});

/* ---------- /api/checkout ---------- */
test("GET /api/checkout: closed with no key, the plans with a test key (amounts, never Stripe ids)", async () => {
  env({ STRIPE_SECRET_KEY: undefined });
  let r = await call(req());
  assert.equal(r.data.open, false);
  assert.equal(r.data.reason, "not-configured");
  env();
  stub([stripePrices]);
  r = await call(req());
  assert.equal(r.data.open, true);
  assert.equal(r.data.plans["done-for-you"].monthly.amount, 29700);
  assert.doesNotMatch(JSON.stringify(r.data), /price_/);
});

test("a live key keeps checkout closed until CHECKOUT_OPEN=true", async () => {
  env({ STRIPE_SECRET_KEY: freshKey("live") });
  const calls = stub([stripePrices, [at("api.stripe.com", "/v1/checkout/sessions"), () => ({ body: { id: "cs_live_x1", url: "https://checkout.stripe.com/c/pay/cs_live_x1" } })]]);
  let r = await call(post(BUYER));
  assert.equal(r.status, 503);
  assert.equal(r.data.route, "call");
  assert.equal(calls.length, 0, "nothing is opened");
  assert.equal((await call(req())).data.reason, "closed");
  process.env.CHECKOUT_OPEN = "true";
  r = await call(post(BUYER));
  assert.equal(r.status, 200);
  assert.equal(r.data.url, "https://checkout.stripe.com/c/pay/cs_live_x1");
});

test("POST /api/checkout stores the lead and opens the session the answers point to", async () => {
  env();
  const calls = stub([stripePrices,
    [at("proj.supabase.co", "/rest/v1/rpc/submit_lead"), () => ({ body: "00000000-0000-4000-8000-000000000001" })],
    [at("api.stripe.com", "/v1/checkout/sessions"), () => ({ body: { id: "cs_test_x1", url: "https://checkout.stripe.com/c/pay/cs_test_x1" } })]]);
  const r = await call(post(BUYER));
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.equal(r.data.url, "https://checkout.stripe.com/c/pay/cs_test_x1");
  assert.equal(r.data.plan, "done-for-you");
  const lead = JSON.parse(calls.find((c) => c.url.pathname === "/rest/v1/rpc/submit_lead").body).payload;
  assert.equal(lead.form, "checkout-start");
  assert.equal(lead.email, "tom@maplestreet.com");
  assert.equal(lead.company, "Maple Street Plumbing");
  assert.equal(lead.consent.consentEmail, true);
  assert.equal(lead.fields.visit, "v_abc12345");
  assert.equal(lead.meta.utm_campaign, "gap");
  const s = decode(calls.find((c) => c.url.pathname === "/v1/checkout/sessions").body);
  assert.equal(s["line_items[0][price]"], "price_dfy_m");
  assert.equal(s["line_items[0][quantity]"], "2");
  assert.equal(s["line_items[1][price]"], "price_dfy_s");
  assert.equal(s["optional_items[0][price]"], "price_tune");
  assert.equal(s["metadata[lead_id]"], "00000000-0000-4000-8000-000000000001");
  assert.equal(s["metadata[source]"], "rempo.io/start");
  assert.equal(s.customer_email, "tom@maplestreet.com");
  assert.equal(s.success_url, "https://rempo.io/start/welcome?session_id={CHECKOUT_SESSION_ID}");
});

test("a database problem never stops a sale", async () => {
  env();
  stub([stripePrices, [at("proj.supabase.co", /rpc/), () => ({ status: 500, body: { message: "down" } })],
    [at("api.stripe.com", "/v1/checkout/sessions"), () => ({ body: { id: "cs_test_x2", url: "https://checkout.stripe.com/c/pay/cs_test_x2" } })]]);
  const r = await call(post(BUYER));
  assert.equal(r.status, 200);
});

test("POST /api/checkout refuses what it should", async () => {
  env();
  stub([stripePrices]);
  let r = await call(post({ ...BUYER, answers: { profiles: "3+", software: "yes", runs: "handle" } }));
  assert.equal(r.status, 409);
  assert.equal(r.data.route, "call");
  r = await call(post({ ...BUYER, email: "not-an-email", phone: "123" }));
  assert.equal(r.status, 400);
  assert.ok(r.data.fields.email && r.data.fields.phone);
  r = await call(post(BUYER, { origin: "https://evil.example" }));
  assert.equal(r.status, 403);
  r = await call(post({ ...BUYER, website: "http://spam.example" }));
  assert.deepEqual(r.data, { ok: true }, "a bot gets a success and no session");
  r = await call(post({ ...BUYER, answers: { profiles: "1", software: "yes", runs: "office" } }));
  assert.equal(r.status, 409, "Engine software has no prices in Stripe, so its buyers go to the call");
});

const SESSION = (over = {}) => ({ id: "cs_test_a1PaidSession0001", object: "checkout.session", livemode: false, status: "complete", payment_status: "paid", mode: "subscription",
  customer: "cus_1", subscription: "sub_1", amount_total: 128800, currency: "usd", customer_details: { email: "tom@maplestreet.com", name: "Tom Maple" },
  consent: { terms_of_service: "accepted" }, client_reference_id: "v_abc12345",
  metadata: { source: "rempo.io/start", plan: "done-for-you", billing: "monthly", profiles: "2", first_name: "Tom", business: "Maple Street Plumbing",
    phone: "5125550134", runs: "handle", software: "yes", consent_email: "true", consent_phone: "false", notice_version: "2026-11-08", utm_source: "facebook" },
  line_items: { data: [{ price: { lookup_key: "rempo_dfy_monthly" } }, { price: { lookup_key: "rempo_dfy_setup" } }, { price: { lookup_key: "rempo_gbp_tuneup" } }] },
  ...over });

test("GET /api/checkout?session_id: the thank-you page gets the onboarding link, filled in", async () => {
  env();
  stub([[at("api.stripe.com", "/v1/checkout/sessions/cs_test_a1PaidSession0001"), () => ({ body: SESSION() })]]);
  const r = await call(req({ url: "/api/checkout?session_id=cs_test_a1PaidSession0001" }));
  assert.equal(r.data.paid, true);
  assert.equal(r.data.firstName, "Tom");
  assert.equal(r.data.plan, "Done For You");
  const u = new URL(r.data.onboardingUrl);
  assert.equal(u.origin + u.pathname, "https://link.example.com/onboarding");
  assert.equal(u.searchParams.get("src"), "rempo", "the founder's own parameters are kept");
  assert.equal(u.searchParams.get("first_name"), "Tom");
  assert.equal(u.searchParams.get("email"), "tom@maplestreet.com");
  assert.equal(u.searchParams.get("phone"), "+15125550134");
  assert.equal(u.searchParams.get("company_name"), "Maple Street Plumbing");
  assert.equal(r.headers["cache-control"], "no-store");
  stub([[at("api.stripe.com", /\/v1\/checkout\/sessions\//), () => ({ body: SESSION({ metadata: { source: "someone-else" } }) })]]);
  assert.equal((await call(req({ url: "/api/checkout?session_id=cs_test_a1PaidSession0001" }))).status, 404, "only this site's sessions");
  assert.equal((await call(req({ url: "/api/checkout?session_id=../../x" }))).status, 400);
});

test("GET /api/checkout?health=1 reports names and true or false, never a value", async () => {
  env({ STRIPE_SECRET_KEY: "sk_test_health_SECRETVALUE" });
  stub([stripePrices, [at("proj.supabase.co", "/rest/v1/rpc/checkout_health"), () => ({ body: "checkout v1" })],
    [at("services.leadconnectorhq.com", "/contacts/"), () => ({ body: { contacts: [] } })]]);
  const r = await call(req({ url: "/api/checkout?health=1" }));
  assert.equal(r.data.ready, true, JSON.stringify(r.data));
  assert.equal(r.data.open, true);
  assert.deepEqual(r.data.stripe.plansOnSale, ["done-for-you"]);
  const text = JSON.stringify(r.data);
  for (const secret of ["SECRETVALUE", "pit-unit-token", "sb_secret_unit", WHSEC, "re_unit", "hooks.slack.com/services"]) assert.ok(!text.includes(secret), `the report shows ${secret}`);
});

/* ---------- /api/stripe-webhook ---------- */
function signedRequest(event, secret = WHSEC) {
  const raw = JSON.stringify(event);
  const t = Math.floor(Date.now() / 1000);
  const sig = createHmac("sha256", secret).update(`${t}.${raw}`).digest("hex");
  return new Request("https://rempo.io/api/stripe-webhook", { method: "POST", headers: { "stripe-signature": `t=${t},v1=${sig}`, "content-type": "application/json" }, body: raw });
}
const completed = (over) => ({ id: "evt_1", type: "checkout.session.completed", livemode: false, data: { object: SESSION(over) } });
function services({ prior = { first_seen: true, handed_off_at: null, handoff_error: null }, ghlFails = false } = {}) {
  return stub([
    [at("api.stripe.com", /\/v1\/checkout\/sessions\//), () => ({ body: SESSION() })],
    [at("proj.supabase.co", "/rest/v1/rpc/record_checkout"), () => ({ body: prior })],
    [at("proj.supabase.co", "/rest/v1/rpc/record_handoff"), () => ({ status: 204 })],
    [at("services.leadconnectorhq.com", "/contacts/upsert"), () => (ghlFails ? { status: 503, body: { message: "unavailable" } } : { body: { new: true, contact: { id: "c_1", tags: [] } } })],
    [at("services.leadconnectorhq.com", /^\/contacts\/c_1\/(tags|notes)$/), () => ({ body: {} })],
    [at("api.resend.com", "/emails"), () => ({ body: { id: "em_1" } })],
    [at("hooks.slack.com", /.*/), () => ({ body: "ok" })]
  ]);
}

test("the webhook refuses an unsigned or wrongly signed event, and waits while it has no secret", async () => {
  env();
  const calls = services();
  assert.equal((await webhook(signedRequest(completed(), "whsec_wrong"))).status, 400);
  const bare = new Request("https://rempo.io/api/stripe-webhook", { method: "POST", body: "{}" });
  assert.equal((await webhook(bare)).status, 400);
  env({ STRIPE_WEBHOOK_SECRET: undefined });
  assert.equal((await webhook(signedRequest(completed()))).status, 503, "refused, so Stripe sends it again once the secret is set");
  assert.equal(calls.length, 0);
});

test("a paid checkout is recorded, handed to GoHighLevel with its tags and note, and announced", async () => {
  env();
  const calls = services();
  const r = await webhook(signedRequest(completed()));
  assert.equal(r.status, 200);
  assert.equal((await r.json()).handedOff, true);
  const upsert = JSON.parse(calls.find((c) => c.url.pathname === "/contacts/upsert").body);
  assert.deepEqual({ ...upsert, source: undefined }, { locationId: "loc_unit", firstName: "Tom", email: "tom@maplestreet.com", phone: "+15125550134", companyName: "Maple Street Plumbing", source: undefined });
  const tags = calls.find((c) => c.url.pathname === "/contacts/c_1/tags" && c.method === "POST");
  assert.equal(JSON.parse(tags.body).tags[0], "rempo-paid");
  assert.ok(calls.some((c) => c.url.pathname === "/contacts/c_1/tags" && c.method === "DELETE"), "the abandoned tag is taken off");
  const note = JSON.parse(calls.find((c) => c.url.pathname === "/contacts/c_1/notes").body).body;
  assert.match(note, /Done For You, monthly, 2 Google profiles/);
  assert.match(note, /\$1,288/);
  const handoff = JSON.parse(calls.find((c) => c.url.pathname === "/rest/v1/rpc/record_handoff").body);
  assert.deepEqual(handoff, { p_session_id: "cs_test_a1PaidSession0001", p_contact_id: "c_1", p_error: null });
  const email = calls.find((c) => c.url.host === "api.resend.com");
  assert.match(JSON.parse(email.body).subject, /^\[TEST\] New purchase for Rempo: Maple Street Plumbing/);
  assert.equal(email.headers["idempotency-key"], "purchase-cs_test_a1PaidSession0001-ok");
  assert.ok(calls.some((c) => c.url.host === "hooks.slack.com"));
  assert.ok(calls.find((c) => c.url.host === "api.stripe.com").url.search.includes("expand"), "the session is read fresh, with its line items");
});

test("the same paid event twice reaches GoHighLevel once", async () => {
  env();
  const calls = services({ prior: { first_seen: false, handed_off_at: "2026-11-10T10:00:00Z", handoff_error: null } });
  const r = await webhook(signedRequest(completed()));
  assert.equal(r.status, 200);
  assert.equal((await r.json()).duplicate, true);
  assert.ok(!calls.some((c) => c.url.host === "services.leadconnectorhq.com"));
  assert.ok(!calls.some((c) => c.url.host === "api.resend.com"));
});

test("GoHighLevel down: the webhook fails so Stripe retries, and the team hears once", async () => {
  env();
  let calls = services({ ghlFails: true });
  let r = await webhook(signedRequest(completed()));
  assert.equal(r.status, 500);
  const handoff = JSON.parse(calls.find((c) => c.url.pathname === "/rest/v1/rpc/record_handoff").body);
  assert.match(handoff.p_error, /HTTP 503/);
  const email = calls.find((c) => c.url.host === "api.resend.com");
  assert.match(JSON.parse(email.body).subject, /^\[NOT IN GOHIGHLEVEL YET\]/);
  // Stripe's retry, still failing: no second alert
  calls = services({ ghlFails: true, prior: { first_seen: false, handed_off_at: null, handoff_error: "GoHighLevel contact upsert answered HTTP 503" } });
  r = await webhook(signedRequest(completed()));
  assert.equal(r.status, 500);
  assert.ok(!calls.some((c) => c.url.host === "api.resend.com"));
  // GoHighLevel not connected at all: the same, with the reason
  env({ GHL_TOKEN: undefined });
  calls = services();
  r = await webhook(signedRequest(completed()));
  assert.equal(r.status, 500);
  assert.match(JSON.parse(calls.find((c) => c.url.host === "api.resend.com").body).text, /GHL_TOKEN/);
});

test("only this site's checkouts count; a live event on a test key is refused", async () => {
  env();
  const calls = services();
  let r = await webhook(signedRequest(completed({ metadata: { plan: "x" } })));
  assert.equal(r.status, 200);
  assert.match((await r.json()).ignored, /not a checkout from rempo\.io\/start/);
  r = await webhook(signedRequest({ id: "evt_2", type: "invoice.paid", livemode: false, data: { object: { object: "invoice" } } }));
  assert.equal(r.status, 200);
  r = await webhook(signedRequest({ ...completed(), livemode: true }));
  assert.equal(r.status, 500);
  assert.equal(calls.length, 0);
});

test("an abandoned checkout is followed up only with consent, with Stripe's recovery link", async () => {
  env();
  const expired = (consent) => ({ id: "evt_3", type: "checkout.session.expired", livemode: false, data: { object: SESSION({ id: "cs_test_b2ExpiredSession01", status: "expired",
    payment_status: "unpaid", customer_details: null, customer_email: "tom@maplestreet.com", after_expiration: { recovery: { url: "https://buy.stripe.com/r/live_abc" } },
    metadata: { ...SESSION().metadata, consent_email: String(consent) } }) } });
  let calls = services();
  let r = await webhook(signedRequest(expired(true)));
  assert.equal(r.status, 200);
  assert.equal((await r.json()).followUp, true);
  assert.deepEqual(JSON.parse(calls.find((c) => c.url.pathname === "/contacts/c_1/tags").body).tags, ["rempo-checkout-abandoned"]);
  assert.match(JSON.parse(calls.find((c) => c.url.pathname === "/contacts/c_1/notes").body).body, /https:\/\/buy\.stripe\.com\/r\/live_abc/);
  calls = services();
  r = await webhook(signedRequest(expired(false)));
  assert.equal((await r.json()).followUp, false);
  assert.ok(!calls.some((c) => c.url.host === "services.leadconnectorhq.com"), "no consent, no follow-up");
  calls = services({ prior: { first_seen: true, handed_off_at: null, email_paid_elsewhere: true } });
  r = await webhook(signedRequest(expired(true)));
  assert.equal((await r.json()).why, "paid in another checkout");
  assert.ok(!calls.some((c) => c.url.host === "services.leadconnectorhq.com"));
});
