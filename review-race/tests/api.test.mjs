// The whole race through its own code, with the demo services (RACE_FAKE) and the in-memory store: every step, the
// emails it sends and queues, the CRM and calendar calls, the limits, the cache, the daily job, and the endpoint's
// guards. No network.
import { Readable } from "node:stream";
import { ok, section, report } from "./harness.mjs";

process.env.RACE_FAKE = "1";
process.env.RACE_STORE = "memory";
process.env.CRON_SECRET = "cron-secret";
process.env.RACE_PUBLIC_URL = "https://race.example.com";
process.env.RACE_LINK_SECRET = "link-secret";

const { config } = await import("../api/_lib/race/env.mjs");
const core = await import("../api/_lib/race/core.mjs");
const { openStore, resetMemory } = await import("../api/_lib/race/store.mjs");
const { verifySig } = await import("../api/_lib/race/http.mjs");
const handler = (await import("../api/race.mjs")).default;
const cronHandler = (await import("../api/race-cron.mjs")).default;

const DAY = 86400000;
const c = config();
const store = openStore(c);
const mem = store._state;
const outbox = [];
const svc = core.services(c, outbox);
const START = { placeId: "fake-maple", main: "Maple Street Plumbing", secondary: "Springfield, IL, USA" };
const WHO = { firstName: "Tom", email: "tom@example.com", consentEmail: true };
const err = async (p) => { try { await p; return null; } catch (e) { return e; } };

resetMemory();

let t1;
await section("start: the free preview", async () => {
  const v = await core.start({ c, store, svc, body: START, ipHash: "ip-a" });
  t1 = v.token;
  ok("a token", typeof v.token === "string" && v.token.length >= 24);
  ok("status preview", v.status === "preview", v.status);
  ok("the owner at #4", v.preview.owner.position === 4 && v.preview.owner.name === "Maple Street Plumbing");
  ok("three rivals, in order", v.preview.rivals.map((r) => r.position).join() === "1,2,3");
  ok("headline: behind on count", v.preview.headline.kind === "behind" && v.preview.headline.avg === 186);
  ok("the search is printed", v.search.query === "Plumber" && v.search.where === "Springfield, IL" && /2026|20\d\d/.test(v.search.date));
  ok("nothing past the fold yet", !v.result && !v.unlocked);
  ok("bad place id refused", (await err(core.start({ c, store, svc, body: { ...START, placeId: "x y" } }))).status === 400);
  const nf = await err(core.start({ c, store, svc, body: { ...START, placeId: "fake-unknown" }, ipHash: "ip-z" }));
  ok("unknown business: 404 with the by-hand path", nf && nf.status === 404 && nf.later === true);
});

await section("reviews: the locked part's counts", async () => {
  const run = await core.reviews({ c, store, svc, token: t1 });
  const v = core.view(c, run);
  ok("counts", v.locked.drafts === 3 && v.locked.unanswered === 22 && v.locked.fetched === 32, v.locked);
  const before = (await store.getRun(t1)).reviews_started_at;
  await core.reviews({ c, store, svc, token: t1 });
  ok("a second call reads nothing again", (await store.getRun(t1)).reviews_started_at === before);
  ok("the recent reviews are held for Claude only", Array.isArray(run.recent) && run.recent.length === 30 && !("t" in run.recent[0]));
});

await section("unlock: checks", async () => {
  ok("first name needed", (await err(core.unlock({ c, store, svc, token: t1, body: { ...WHO, firstName: "" } }))).code === "first-name");
  ok("email checked", (await err(core.unlock({ c, store, svc, token: t1, body: { ...WHO, email: "tom@" } }))).code === "email");
  ok("consent needed", (await err(core.unlock({ c, store, svc, token: t1, body: { ...WHO, consentEmail: false } }))).code === "consent");
  ok("a bad phone refused", (await err(core.unlock({ c, store, svc, token: t1, body: { ...WHO, phone: "123" } }))).code === "phone");
  ok("unknown token", (await err(core.unlock({ c, store, svc, token: "nope-nope-nope-nope", body: WHO }))).status === 404);
});

await section("unlock: the full race, the lead, the emails", async () => {
  outbox.length = 0;
  const v = await core.unlock({ c, store, svc, token: t1, body: WHO, ipHash: "ip-a" });
  ok("ready", v.status === "ready" && v.unlocked === true);
  ok("three fixes", v.result.analysis.fixes.length === 3);
  ok("three drafts", v.result.analysis.drafts.length === 3);
  ok("each draft has its review", v.result.analysis.drafts.every((d) => v.result.picks.some((p) => p.id === d.reviewId)));
  ok("the hard review is flagged call first", v.result.analysis.drafts.some((d) => d.callFirst));
  ok("the lead is in the leads table", mem.leads.some((l) => l.form === "review-race" && l.email === "tom@example.com" && l.company === "Maple Street Plumbing"));
  ok("the team is told", outbox.some((m) => m.to === "team" && /New Review Race lead/.test(m.subject)));
  const results = outbox.find((m) => m.to === "tom@example.com");
  ok("the results email went out", results && /Your review race: Maple Street Plumbing/.test(results.subject));
  ok("it carries the unsubscribe link", results && results.unsubscribe.startsWith("https://race.example.com/api/race?action=unsubscribe&e=tom%40example.com&s="));
  const queued = mem.emails.filter((e) => e.email === "tom@example.com").map((e) => e.template).sort().join();
  ok("follow-ups queued (no day 9 without a case study link)", queued === "day2,day5,update14,update44", queued);
  const run = await store.getRun(t1);
  ok("the reviews read for Claude are cleared", run.recent === null);
  ok("the CRM contact is saved", run.ghl_contact_id === "fake-contact");
  const n = outbox.length, q = mem.emails.length;
  await core.unlock({ c, store, svc, token: t1, body: WHO, ipHash: "ip-a" });
  ok("a second unlock sends nothing again", outbox.length === n && mem.emails.length === q);
  const sig = new URL(core.links(c, run).unsubscribe).searchParams.get("s");
  ok("the unsubscribe link is signed", verifySig("tom@example.com", sig, c.linkSecret) && !verifySig("other@example.com", sig, c.linkSecret));
});

await section("the cache: the same business again spends nothing", async () => {
  let calls = 0;
  const spy = { ...svc, placeLookup: async (...a) => { calls += 1; return svc.placeLookup(...a); }, analyze: async (...a) => { calls += 1; return svc.analyze(...a); } };
  const v = await core.start({ c, store, svc: spy, body: START, ipHash: "ip-b" });
  ok("served from the cache", v.status === "reviews" && calls === 0);
  const run = await store.getRun(v.token);
  ok("marked as a copy", Boolean(run.source_run) && run.cost.cached === true);
  const u = await core.unlock({ c, store, svc: spy, token: v.token, body: { ...WHO, email: "ann@example.com" }, ipHash: "ip-b" });
  ok("unlocked without asking Claude again", u.status === "ready" && u.unlocked === true);
  ok("still no outside calls", calls === 0);
  const midnight = new Date(); midnight.setUTCHours(0, 0, 0, 0);
  ok("copies don't count toward the daily cap", (await store.countSince(midnight.toISOString())) === 1);
});

await section("limits", async () => {
  const lc = { ...c, limits: { ...c.limits, perIpPerDay: 2 } };
  await core.start({ c: lc, store, svc, body: { ...START, placeId: "fake-cardinal" }, ipHash: "ip-c" });
  await core.start({ c: lc, store, svc, body: { ...START, placeId: "fake-prairie" }, ipHash: "ip-c" });
  const e = await err(core.start({ c: lc, store, svc, body: { ...START, placeId: "fake-cardinal" }, ipHash: "ip-c" }));
  ok("per network per day", e && e.status === 429 && e.later === true);
  const dc = { ...c, limits: { ...c.limits, perDay: 1 } };
  const d = await err(core.start({ c: dc, store, svc, body: START, ipHash: "ip-d" }));
  ok("per day for everyone", d && d.code === "daily-cap");
  const bot = await err(core.start({ c, store, svc: { ...svc, human: async () => ({ ok: false }) }, body: START, ipHash: "ip-e" }));
  ok("the bot check can refuse", bot && bot.code === "bot-check");
});

await section("Claude: failures and bad lines", async () => {
  resetMemory();
  const a = await core.start({ c, store, svc, body: START, ipHash: "ip-f" });
  const broken = { ...svc, analyze: async () => { throw new Error("overloaded"); } };
  const v = await core.unlock({ c, store, svc: broken, token: a.token, body: WHO, ipHash: "ip-f" });
  ok("falls back to the rule-based fixes", v.result.analysis.fallback === true && v.result.analysis.fixes.length === 3 && v.result.analysis.drafts.length === 0);
  const b = await core.start({ c, store, svc, body: { ...START, placeId: "fake-cardinal" }, ipHash: "ip-g" });
  const sloppy = { ...svc, analyze: async () => ({ data: { summary: "You will get more reviews.", fixes: [{ area: "Care", title: "Answer every review", why: "You replied to 10 of 30.", firstStep: "Reply this week." }], drafts: [], praise: [], complaints: [] }, model: "x", usage: {} }) };
  const w = await core.unlock({ c, store, svc: sloppy, token: b.token, body: { ...WHO, email: "kim@example.com" }, ipHash: "ip-g" });
  ok("a promise in the summary is replaced", !/more reviews/.test(w.result.analysis.summary) && /\d/.test(w.result.analysis.summary));
  ok("fixes filled up to three", w.result.analysis.fixes.length === 3 && w.result.analysis.fixes[0].title === "Answer every review");
});

let t2;
await section("the calendar", async () => {
  resetMemory();
  const a = await core.start({ c, store, svc, body: START, ipHash: "ip-h" });
  t2 = a.token;
  ok("slots need an unlocked race", (await err(core.slots({ c, store, svc, token: t2, tz: "America/Chicago" }))).status === 404);
  await core.unlock({ c, store, svc, token: t2, body: WHO, ipHash: "ip-h" });
  const s = await core.slots({ c, store, svc, token: t2, tz: "America/Chicago" });
  ok("five days of slots", s.days.length === 5 && s.days[0].slots.length === 4);
  ok("a phone is needed", (await err(core.book({ c, store, svc, token: t2, body: { start: s.days[0].slots[0], consentCall: true } }))).code === "phone");
  ok("consent to call is needed", (await err(core.book({ c, store, svc, token: t2, body: { start: s.days[0].slots[0], phone: "2175550142", consentCall: false } }))).code === "consent");
  outbox.length = 0;
  const b = await core.book({ c, store, svc, token: t2, body: { start: s.days[0].slots[0], phone: "(217) 555-0142", consentCall: true, tz: "America/Chicago" } });
  ok("booked", b.ok && b.start === s.days[0].slots[0]);
  ok("the team is told", outbox.some((m) => /call booked/.test(m.subject)));
  ok("the follow-ups stop", mem.emails.filter((e) => e.status === "queued").length === 0);
  ok("booking twice is harmless", (await core.book({ c, store, svc, token: t2, body: {} })).already === true);
  ok("the result shows the booking", core.view(c, await store.getRun(t2)).result.booked.start === s.days[0].slots[0]);
});

await section("the daily job", async () => {
  resetMemory();
  const a = await core.start({ c, store, svc, body: START, ipHash: "ip-i" });
  await core.unlock({ c, store, svc, token: a.token, body: WHO, ipHash: "ip-i" });
  outbox.length = 0;
  let rep = await core.cron({ c, store, svc, now: Date.now() + 3 * DAY });
  ok("day 2 sent on day 3", rep.sent === 1 && outbox.some((m) => /Did your replies go up/.test(m.subject)), rep);
  await store.unsubscribe("tom@example.com", "test");
  rep = await core.cron({ c, store, svc, now: Date.now() + 6 * DAY });
  ok("after an unsubscribe nothing is sent", rep.sent === 0 && mem.emails.find((e) => e.template === "day5").status === "skipped");
  resetMemory();
  const b = await core.start({ c, store, svc, body: START, ipHash: "ip-j" });
  await core.unlock({ c, store, svc, token: b.token, body: { ...WHO, email: "lee@example.com" }, ipHash: "ip-j" });
  outbox.length = 0;
  rep = await core.cron({ c, store, svc, now: Date.now() + 15 * DAY });
  const update = outbox.find((m) => /Race update/.test(m.subject));
  ok("the race update reads fresh counts", update && /Google reviews \(\+?-?\d+\)/.test(update.text), update && update.text.slice(0, 300));
  ok("all due mail handled", rep.sent === 3 && rep.failed === 0, rep);
  const crmStop = { ...svc, crm: { ...svc.crm, contactTags: async () => ["customer"] } };
  resetMemory();
  const d = await core.start({ c, store, svc, body: START, ipHash: "ip-k" });
  await core.unlock({ c, store, svc, token: d.token, body: { ...WHO, email: "max@example.com" }, ipHash: "ip-k" });
  rep = await core.cron({ c, store, svc: crmStop, now: Date.now() + 3 * DAY });
  ok("a customer tag in GoHighLevel stops the follow-ups", rep.skipped === 1 && rep.sent === 0, rep);
});

await section("later: the by-hand path", async () => {
  resetMemory();
  outbox.length = 0;
  ok("contact checked", (await err(core.later({ c, store, svc, body: { firstName: "", email: "x" } }))).status === 400);
  const r = await core.later({ c, store, svc, body: { firstName: "Ana", email: "ana@example.com", consentEmail: true, main: "Ana's Plumbing", secondary: "Peoria, IL, USA", reason: "quota" } });
  ok("accepted", r.ok);
  ok("stored as review-race-later", mem.leads.some((l) => l.form === "review-race-later" && l.fields.city === "Peoria, IL"));
  ok("the team is asked to send it by hand", outbox.some((m) => /could not run/.test(m.subject) && /by hand/.test(m.text)));
});

// ----- the endpoint itself -----
function call(fn, { method = "GET", url = "/api/race", headers = {}, body } = {}) {
  const raw = body === undefined ? "" : typeof body === "string" ? body : JSON.stringify(body);
  const req = Readable.from(raw ? [raw] : []);
  Object.assign(req, { method, url, headers: { host: "race.example.com", ...(raw && typeof body !== "string" ? { "content-type": "application/json" } : {}), ...headers }, socket: { remoteAddress: "10.0.0.1" } });
  return new Promise((resolve) => {
    const res = { statusCode: 200, headers: {}, setHeader(k, v) { this.headers[k.toLowerCase()] = v; }, end(data) { resolve({ status: this.statusCode, headers: this.headers, text: String(data || ""), json: (() => { try { return JSON.parse(data); } catch { return null; } })() }); } };
    fn(req, res);
  });
}

await section("the endpoint's guards", async () => {
  resetMemory();
  const cfg = await call(handler, { url: "/api/race?action=config" });
  ok("config", cfg.status === 200 && cfg.json.demo === true && cfg.json.calendar === true);
  const health = await call(handler, { url: "/api/race?action=health" });
  ok("health: names only", health.json.ready === true && !JSON.stringify(health.json).includes("secret"));
  ok("another site can't post", (await call(handler, { method: "POST", headers: { origin: "https://evil.example" }, body: { action: "start", ...START } })).status === 403);
  const hp = await call(handler, { method: "POST", body: { action: "start", ...START, trap: "spam" } });
  ok("the bot trap answers like a success and does nothing", hp.status === 200 && mem.runs.length === 0);
  const auto = await call(handler, { method: "POST", headers: { origin: "https://race.example.com" }, body: { action: "start", ...START, website: "https://owner-site.example" } });
  ok("an autofilled website field is not taken for a bot", auto.status === 200 && auto.json.preview && mem.runs.length === 1, auto.json);
  resetMemory();
  ok("unknown action", (await call(handler, { method: "POST", body: { action: "dance" } })).status === 404);
  const sug = await call(handler, { url: "/api/race?action=suggest&q=ma&s=abcdefgh123" });
  ok("suggest", sug.json.suggestions.length >= 1);
  const st = await call(handler, { method: "POST", headers: { origin: "https://race.example.com" }, body: { action: "start", ...START } });
  ok("start through the endpoint", st.status === 200 && st.json.preview.rivals.length === 3);
  const res = await call(handler, { url: `/api/race?action=result&t=${st.json.token}` });
  ok("result by token, still locked", res.status === 200 && !res.json.result);
  ok("an expired token is a 404", (await call(handler, { url: "/api/race?action=result&t=nopenopenopenopenope" })).status === 404);
  const sig = new URL(core.links(c, { token: "x", email: "zed@example.com" }).unsubscribe).searchParams.get("s");
  const page = await call(handler, { url: `/api/race?action=unsubscribe&e=zed%40example.com&s=${sig}` });
  ok("unsubscribe asks first", page.status === 200 && page.text.includes("Unsubscribe?") && !mem.unsubscribes.has("zed@example.com"));
  const done = await call(handler, { method: "POST", url: `/api/race?action=unsubscribe&e=zed%40example.com&s=${sig}`, body: "List-Unsubscribe=One-Click", headers: { "content-type": "application/x-www-form-urlencoded" } });
  ok("one-click unsubscribe works", done.status === 200 && mem.unsubscribes.has("zed@example.com"));
  ok("a bad signature is refused", (await call(handler, { url: "/api/race?action=unsubscribe&e=zed%40example.com&s=forged" })).status === 400);
  ok("the daily job needs its secret", (await call(cronHandler, { url: "/api/race-cron" })).status === 401);
  ok("the daily job runs with it", (await call(cronHandler, { url: "/api/race-cron", headers: { authorization: "Bearer cron-secret" } })).status === 200);
});

await section("find: the business search on SerpApi (no Google key)", async () => {
  process.env.RACE_SEARCH = "maps";
  try {
    const cm = config();
    ok("SerpApi search mode", cm.searchMode === "maps");
    const conf = (await call(handler, { url: "/api/race?action=config" })).json;
    ok("the page is told to use Find", conf.search === "maps" && conf.ready === true, conf);
    const health = (await call(handler, { url: "/api/race?action=health" })).json;
    ok("health needs no Google key", !("places" in health.required) && health.ready === true, health.required);
    const list = await core.find({ c: cm, svc, q: "Cardinal Heating Springfield" });
    ok("find lists the business", list.length >= 1 && list[0].main === "Cardinal Heating & Air", list.map((l) => l.main));
    ok("each listing is signed", list.every((l) => l.listing && l.sig && l.id));
    const short = (await call(handler, { url: "/api/race?action=find&q=ab" })).json;
    ok("too short: nothing searched", Array.isArray(short.suggestions) && short.suggestions.length === 0);
    const viaApi = (await call(handler, { url: "/api/race?action=find&q=Prairie%20Drain" })).json;
    ok("the endpoint finds too", viaApi.suggestions[0] && viaApi.suggestions[0].main === "Prairie Drain Pros");
    const v = await core.start({ c: cm, store, svc, body: { listing: list[0].listing, sig: list[0].sig, main: list[0].main, secondary: list[0].secondary }, ipHash: "ip-find" });
    ok("start uses the picked listing", v.preview.owner.name === "Cardinal Heating & Air" && v.preview.rivals.length === 3, v.preview.owner);
    const row = await store.getRun(v.token);
    ok("no second lookup", !row.cost || row.cost.cached || row.cost.serpapi <= 1, row.cost);
    const forged = Buffer.from(JSON.stringify({ name: "Not Theirs", placeId: "fake-maple" })).toString("base64url");
    const e1 = await err(core.start({ c: cm, store, svc, body: { listing: forged, sig: list[0].sig }, ipHash: "ip-find" }));
    ok("a listing SerpApi didn't return is refused", e1 && e1.code === "bad-place", e1 && e1.code);
    const e2 = await err(core.start({ c: cm, store, svc, body: { listing: list[0].listing, sig: "x".repeat(32) }, ipHash: "ip-find" }));
    ok("a wrong signature is refused", e2 && e2.code === "bad-place");
  } finally {
    delete process.env.RACE_SEARCH;
  }
});

await section("config: the address in email links", async () => {
  const names = ["RACE_PUBLIC_URL", "VERCEL_ENV", "VERCEL_BRANCH_URL", "VERCEL_PROJECT_PRODUCTION_URL"];
  const kept = Object.fromEntries(names.map((n) => [n, process.env[n]]));
  try {
    delete process.env.RACE_PUBLIC_URL;
    Object.assign(process.env, { VERCEL_ENV: "preview", VERCEL_BRANCH_URL: "race-git-claude-x-team.vercel.app", VERCEL_PROJECT_PRODUCTION_URL: "race.vercel.app" });
    ok("a preview links to its branch URL", config().publicUrl === "https://race-git-claude-x-team.vercel.app", config().publicUrl);
    process.env.VERCEL_ENV = "production";
    ok("production links to its production domain", config().publicUrl === "https://race.vercel.app", config().publicUrl);
    process.env.RACE_PUBLIC_URL = "https://rempo.io/";
    ok("RACE_PUBLIC_URL comes first, with no trailing slash", config().publicUrl === "https://rempo.io", config().publicUrl);
  } finally {
    for (const n of names) { if (kept[n] === undefined) delete process.env[n]; else process.env[n] = kept[n]; }
  }
});

report("api.test");
