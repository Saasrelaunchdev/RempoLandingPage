// /api/race: the Review Race's one endpoint. The page calls it step by step (README.md, "How it works"):
//   GET  ?action=config                 what the page needs to know (bot check site key, calendar on or off, links)
//   GET  ?action=suggest&q=..&s=..      business suggestions while the owner types (Google Places Autocomplete)
//   POST {action:"start", placeId,..}   the free preview: the business, the search, the three rivals
//   POST {action:"reviews", token}      reads the reviews and computes the race (the locked cards' counts)
//   POST {action:"unlock", token, ..}   the lead, then the full race: numbers, three fixes, three reply drafts
//   GET  ?action=result&t=..            a saved race, for the results link in the email
//   GET  ?action=slots&t=..&tz=..       open times on the GoHighLevel calendar
//   POST {action:"book", token, ..}     books the 15-minute call
//   POST {action:"later", ..}           when the race can't run: the team sends the report by hand
//   GET/POST ?action=unsubscribe&e=..&s=..   stops the follow-up emails
//   GET  ?action=health                 which parts are set up (true or false, never a value)
import { config as getConfig, parts } from "./_lib/race/env.mjs";
import { send, sendHtml, readBody, sameOrigin, clientIp, ipHash, host, verifySig, clean, EMAIL } from "./_lib/race/http.mjs";
import { openStore, openLeadStore } from "./_lib/race/store.mjs";
import * as core from "./_lib/race/core.mjs";
import { unsubscribePage } from "./_lib/race/copy.mjs";

// Light limits on the search box, per server instance: 90 suggestions per network per 10 minutes (Google Places),
// 15 Finds per network per hour (SerpApi, where each Find is one search)
function limiter(max, ms) {
  const seen = new Map();
  return (key) => {
    const now = Date.now();
    const t = seen.get(key);
    if (!t || t.reset < now) { seen.set(key, { n: 1, reset: now + ms }); return true; }
    t.n += 1;
    if (seen.size > 5000) seen.clear();
    return t.n <= max;
  };
}
const typingAllowed = limiter(90, 600000);
const findAllowed = limiter(15, 3600000);

function publicConfig(c) {
  const p = parts(c);
  return {
    demo: c.fake,
    ready: p.serpapi && (c.searchMode === "maps" || p.places) && p.claude && p.database,
    search: c.searchMode,
    turnstileSiteKey: c.fake ? null : c.turnstile.siteKey || null,
    calendar: p.calendar,
    bookingUrl: c.ghl.bookingUrl || null,
    privacyUrl: c.privacyUrl,
    termsUrl: c.termsUrl,
    smsUrl: c.smsUrl,
    siteUrl: c.siteUrl
  };
}

async function health(c, res) {
  const p = parts(c);
  let database = { ok: false };
  try {
    const store = openStore(c);
    const v = await store.health();
    database = { ok: true, schema: v };
  } catch (e) {
    database = { ok: false, fix: e.supabaseStatus === 404 ? "Run sql/race.sql in the Supabase project SUPABASE_URL names." : e.message };
  }
  const required = { serpapi: p.serpapi, ...(c.searchMode === "places" ? { places: p.places } : {}), claude: p.claude, database: database.ok };
  send(res, 200, {
    ready: Object.values(required).every(Boolean),
    required,
    search: c.searchMode === "places" ? "Google Places, as the owner types" : "SerpApi, when the owner presses Find (no Google key)",
    optional: { resultsEmail: p.resultsEmail, teamEmail: p.teamEmail, slack: p.slack, crm: p.crm, calendar: p.calendar, botCheck: p.botCheck, cron: p.cron, links: p.links, postalAddress: p.postalAddress, conversionsApi: p.conversionsApi },
    // Until the race is ready, the page takes the business name and town by hand and this path keeps the request
    byHand: { leadsTable: p.database || p.leadsFallback, teamEmail: p.teamEmail, slack: p.slack },
    database,
    demo: c.fake,
    deployment: c.deployment
  });
}

const yes = (v) => v === true || v === "true" || v === "on" || v === "1";

// Demo mode only (RACE_FAKE=1): what the race would have sent (emails, the team's alerts, Meta's events) goes to one
// list for the whole process, so a local server and its tests can read it (meta/tools/dev.mjs --stub shows it at
// /__stub). With real services nothing is kept: each request gets its own empty list.
function demoOutbox(c) {
  if (!c.fake) return [];
  const box = globalThis.__reviewRaceOutbox || (globalThis.__reviewRaceOutbox = []);
  if (box.length > 500) box.splice(0, box.length - 500);
  return box;
}

export default async function handler(req, res) {
  const c = getConfig();
  const url = new URL(req.url || "/", `https://${host(req) || "localhost"}`);
  const origin = host(req) ? `https://${host(req)}` : "";
  const ip = clientIp(req);
  const ipH = ipHash(ip, c.hashSalt);
  let action = url.searchParams.get("action") || "";
  try {
    if (req.method === "GET" || req.method === "HEAD") {
      if (action === "config") return send(res, 200, publicConfig(c));
      if (action === "health" || !action) return health(c, res);
      const store = openStore(c);
      const svc = core.services(c);
      if (action === "suggest") {
        const q = clean(url.searchParams.get("q"), 120);
        const s = clean(url.searchParams.get("s"), 64);
        if (q.length < 2) return send(res, 200, { suggestions: [] });
        if (!typingAllowed(ipH || "anon")) return send(res, 429, { error: "Slow down a little, then try again.", code: "rate-limit" });
        const suggestions = await svc.suggest(q, /^[A-Za-z0-9_-]{8,64}$/.test(s) ? s : undefined);
        return send(res, 200, { suggestions });
      }
      if (action === "find") {
        const q = clean(url.searchParams.get("q"), 120);
        if (q.length < 3) return send(res, 200, { suggestions: [] });
        if (!findAllowed(ipH || "anon")) return send(res, 429, { error: "That's a lot of searches. Wait a few minutes, then try again.", code: "rate-limit" });
        return send(res, 200, { suggestions: await core.find({ c, svc, q }) });
      }
      if (action === "result") {
        const t = clean(url.searchParams.get("t"), 64);
        const run = t ? await store.getRun(t) : null;
        if (!run) return send(res, 404, { error: "This race has expired. Start a new one.", code: "not-found" });
        return send(res, 200, core.view(c, run));
      }
      if (action === "slots") {
        const out = await core.slots({ c, store, svc, token: clean(url.searchParams.get("t"), 64), tz: clean(url.searchParams.get("tz"), 60) });
        return send(res, 200, out);
      }
      if (action === "unsubscribe") {
        const e = clean(url.searchParams.get("e"), 254).toLowerCase();
        const ok = EMAIL.test(e) && verifySig(e, url.searchParams.get("s"), c.linkSecret);
        return sendHtml(res, ok ? 200 : 400, unsubscribePage({ state: ok ? "ask" : "bad", action: `${url.pathname}${url.search}`, email: e }));
      }
      return send(res, 404, { error: "unknown action" });
    }

    if (req.method !== "POST") { res.setHeader("allow", "GET, POST"); return send(res, 405, { error: "method not allowed" }); }
    if (!sameOrigin(req)) return send(res, 403, { error: "forbidden" });
    const body = await readBody(req);
    action = action || clean(body.action, 20);
    // A bot filled the field people never see: answer like a success, do nothing. The field has a name no browser
    // autofills (it was "website" at first, and autofill filled it in for real people, who then got no race).
    if (typeof body.trap === "string" && body.trap.trim()) return send(res, 200, { ok: true });
    // The by-hand path must work before the race's own database key is set: it falls back to the leads table alone
    const store = action === "later" ? openLeadStore(c) : openStore(c);
    const svc = core.services(c, demoOutbox(c));
    const token = clean(body.token, 64);
    const client = { ip, ua: clean(req.headers["user-agent"], 512) };

    if (action === "start") return send(res, 200, await core.start({ c, store, svc, body, ip, ipHash: ipH, origin }));
    if (action === "reviews") {
      const run = await core.reviews({ c, store, svc, token });
      return send(res, 200, core.view(c, run));
    }
    if (action === "unlock") return send(res, 200, await core.unlock({ c, store, svc, token, body, ipHash: ipH, deadline: Date.now() + 110000, origin, client }));
    if (action === "later") return send(res, 200, await core.later({ c, store, svc, body, ipHash: ipH }));
    if (action === "book") return send(res, 200, await core.book({ c, store, svc, token, body: { ...body, consentCall: yes(body.consentCall), consentText: yes(body.consentText) }, origin, client }));
    if (action === "unsubscribe") {
      const e = clean(url.searchParams.get("e") || body.e, 254).toLowerCase();
      const ok = EMAIL.test(e) && verifySig(e, url.searchParams.get("s") || body.s, c.linkSecret);
      if (ok) {
        await store.unsubscribe(e, "link");
        if (svc.crm) await svc.crm.upsert({ email: e, tags: ["race-unsubscribed"] }).catch((err) => console.error("GoHighLevel tag failed:", err.message));
      }
      return sendHtml(res, ok ? 200 : 400, unsubscribePage({ state: ok ? "done" : "bad", email: e }));
    }
    return send(res, 404, { error: "unknown action" });
  } catch (e) {
    const status = e.status && e.status >= 400 && e.status < 600 ? e.status : 500;
    if (status >= 500) console.error(`race ${action} failed:`, e.message);
    return send(res, status, { error: e.status ? e.message : "Something went wrong. Please try again in a minute.", code: e.code || "error", ...(e.later ? { later: true } : {}) });
  }
}
