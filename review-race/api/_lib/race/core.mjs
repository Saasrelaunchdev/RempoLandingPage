// The race, step by step. Each step is safe to call twice: a step already done returns what it saved, and the two
// steps that spend money (reading reviews, asking Claude) are claimed in the database first, so a second request waits
// for the first instead of paying again.
//
//   find     the business search on SerpApi, when there is no Google Places key     (1 SerpApi search)
//   start    the business, the search, the three rivals: the free preview         (2 SerpApi searches; 1 after a find)
//   reviews  the newest reviews of all four, the numbers, the 3 reviews to answer  (about 9 SerpApi searches)
//   unlock   the lead (Supabase, GoHighLevel, the team), then Claude, then the results email and the follow-ups
//   slots / book   the GoHighLevel calendar
//   cron     the follow-up emails and race updates that are due, and housekeeping
import * as serp from "./serpapi.mjs";
import * as places from "./places.mjs";
import * as claude from "./claude.mjs";
import * as ghl from "./ghl.mjs";
import * as fakes from "./fakes.mjs";
import { sendEmail, notifyTeam } from "./emails.mjs";
import { verifyHuman } from "./turnstile.mjs";
import { buildRace, headline, pickRivals, pickReviews, recentForClaude, share, DAY } from "./metrics.mjs";
import { ruleFixes, ruleSummary, resultsEmail, nurtureEmail, teamAlert, bookedAlert } from "./copy.mjs";
import { parts } from "./env.mjs";
import { newToken, sign, verifySig, clean, EMAIL, usPhone } from "./http.mjs";
import { capiConfig, userData, capiEvent, sendCapi, FBC, FBP, EVENT_ID } from "./capi.mjs";
import { fitOf, isTrade } from "./fit.mjs";

export const fail = (status, message, code = "error", extra = {}) => Object.assign(new Error(message), { status, code, ...extra });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const iso = (t) => new Date(t).toISOString();

/* ---------- The outside services, real or fake ---------- */
export function services(c, outbox = []) {
  if (c.fake) {
    return {
      outbox,
      suggest: async (q) => fakes.suggest(q),
      find: async (q) => fakes.find(q),
      placeLookup: async (id) => fakes.placeLookup(id),
      mapSearch: async (o) => fakes.mapSearch(o),
      fetchReviews: async (ids, o) => fakes.fetchReviews(ids, o),
      analyze: async (input, race) => ({ data: fakes.analyze(input, race), model: "demo", usage: { input: 0, output: 0, cached: 0 } }),
      crm: { upsert: async () => ({ id: "fake-contact", isNew: true }), note: async () => ({}), tags: async () => ({}), contactTags: async () => [] },
      calendar: { slots: async (o) => fakes.freeSlots(o), book: async () => ({ id: "fake-appointment" }) },
      email: (m) => sendEmail(c, m, outbox),
      team: (m) => notifyTeam(c, m, outbox),
      // Demo mode never calls Meta: with META_PIXEL_ID and META_CAPI_TOKEN set (the tests), the events go to the outbox
      capi: capiConfig() ? async (events) => { outbox.push({ kind: "capi", events }); return { events_received: events.length }; } : null,
      human: async () => ({ ok: true, skipped: true })
    };
  }
  const p = parts(c);
  const need = (ok, what) => { if (!ok) throw fail(503, `${what} is not set up yet.`, "not-configured"); };
  return {
    outbox,
    suggest: async (q, s) => { need(p.places, "The business search (GOOGLE_PLACES_API_KEY)"); return places.suggest(c.placesKey, q, s); },
    find: async (q, counter) => { need(p.serpapi, "SerpApi (SERPAPI_API_KEY)"); return serp.mapSearch(c.serpapiKey, { q }, counter); },
    placeLookup: async (id, counter) => { need(p.serpapi, "SerpApi (SERPAPI_API_KEY)"); return serp.placeLookup(c.serpapiKey, id, counter); },
    mapSearch: async (o, counter) => { need(p.serpapi, "SerpApi (SERPAPI_API_KEY)"); return serp.mapSearch(c.serpapiKey, o, counter); },
    fetchReviews: async (ids, o, counter) => serp.fetchReviews(c.serpapiKey, ids, o, counter),
    analyze: async (input, race, deadline) => { need(p.claude, "Claude (ANTHROPIC_API_KEY)"); return claude.analyze({ key: c.anthropicKey, effort: c.effort, input, deadline }); },
    crm: p.crm ? {
      upsert: (o) => ghl.upsertContact(c.ghl, o),
      note: (id, body) => ghl.addNote(c.ghl, id, body),
      tags: (id, t) => ghl.addTags(c.ghl, id, t),
      contactTags: (id) => ghl.contactTags(c.ghl, id)
    } : null,
    calendar: p.calendar ? { slots: (o) => ghl.freeSlots(c.ghl, o), book: (o) => ghl.book(c.ghl, o) } : null,
    email: (m) => sendEmail(c, m, outbox),
    team: (m) => notifyTeam(c, m, outbox),
    capi: (() => { const cfg = capiConfig(); return cfg ? (events) => sendCapi(cfg, events) : null; })(),
    human: (token, ip) => verifyHuman(c, token, ip)
  };
}

/* ---------- What the host page adds to each request (window.ReviewRace.extra, read by race.js): the ad variant, the
   version of the consent wording the visitor saw, the pixel's event id, and the ad-tool ids with the visitor's choice
   about them. Every value is checked here; anything else is dropped. A page without the hook sends none of it. ---------- */
const VARIANT = /^[a-z0-9-]{1,40}$/;
const NOTICE = /^\d{4}-\d{2}-\d{2}$/;
export function hostOf(body) {
  const h = body && typeof body.host === "object" && body.host ? body.host : null;
  const t = h && typeof h.tracking === "object" && h.tracking ? h.tracking : {};
  const consent = ["granted", "denied", "unset"].includes(t.consent) ? t.consent : "unset";
  const gpc = t.gpc === true || t.gpc === "true";
  // Global Privacy Control, or a declined cookie notice: no ad ids are kept and Meta hears nothing
  const optedOut = gpc || consent === "denied";
  return {
    present: Boolean(h),
    variant: h && VARIANT.test(String(h.variant || "")) ? String(h.variant) : "",
    noticeVersion: h && NOTICE.test(String(h.noticeVersion || "")) ? String(h.noticeVersion) : "",
    eventId: h && EVENT_ID.test(String(h.eventId || "")) ? String(h.eventId) : "",
    fbc: !optedOut && FBC.test(String(t.fbc || "")) ? String(t.fbc) : "",
    fbp: !optedOut && FBP.test(String(t.fbp || "")) ? String(t.fbp) : "",
    consent, gpc, optedOut
  };
}
// The ad-tool details a lead keeps in meta, as the Gap Check's leads did: the ids, the event id and the choice
const adMeta = (x) => (x.present ? { ...(x.fbc ? { fbc: x.fbc } : {}), ...(x.fbp ? { fbp: x.fbp } : {}), ...(x.eventId ? { meta_event_id: x.eventId } : {}), ads_consent: x.consent, ...(x.gpc ? { gpc: "true" } : {}) } : {});
// Campaign tags from the page's address: utm_*, fbclid and gclid only, short strings only
export function utmOf(v) {
  const out = {};
  if (v && typeof v === "object") for (const [k, x] of Object.entries(v)) if (/^(utm_[a-z]+|fbclid|gclid)$/.test(k) && typeof x === "string") out[k] = clean(x, 200);
  return out;
}
const drop = (o) => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined && v !== null && v !== ""));

/* ---------- Meta: Lead (a full race) and Schedule (a booked call) through the Conversions API, with the event id the
   page's pixel used, so Meta counts each once. Only for a trade business (fit.mjs), never after an opt-out (Global
   Privacy Control or a declined cookie notice), and never with the phone number: the privacy policy promises the
   carriers that no phone number or text opt-in is shared. A failure is logged and never fails the race. ---------- */
async function toMeta({ svc, name, run, host, client = {}, custom = {} }) {
  if (!svc.capi || host.optedOut || !isTrade(run.business && run.business.category)) return null;
  const prefix = name === "Lead" ? "lead" : "schedule";
  const id = host.eventId && host.eventId.startsWith(`${prefix}-`) ? host.eventId : `${prefix}-${String(run.token).replace(/[^A-Za-z0-9]/g, "").slice(0, 32)}`;
  const page = run.meta && /^https?:\/\//.test(run.meta.page || "") ? run.meta.page : "";
  const city = String((run.search && run.search.where) || "").split(",")[0];
  const event = capiEvent({
    name, id, time: Math.floor(Date.now() / 1000), sourceUrl: page,
    user: userData({ email: run.email, firstName: run.first_name, city, country: "us", externalId: run.visit || undefined, ip: client.ip, ua: client.ua, fbc: host.fbc, fbp: host.fbp }),
    custom: { content_name: name === "Lead" ? "Review Race" : "Review Race call", ...custom }
  });
  try { await svc.capi([event]); return id; } catch (e) { console.error("Conversions API:", e && e.message); return null; }
}

/* ---------- Links ---------- */
// The page the race was started on, path only (never another host): /customers, /customers/recent, ... On the landing
// page the race lives at /customers, not at the site's root, so the emails must lead back to that page.
export function pagePath(run) {
  try {
    const p = new URL((run && run.meta && run.meta.page) || "").pathname.replace(/\/+$/, "");
    return /^(\/[A-Za-z0-9_-]{1,40}){1,3}$/.test(p) ? p : "";
  } catch { return ""; }
}

export function links(c, run, origin) {
  const base = c.publicUrl || origin || "";
  const e = run.email || "";
  const path = pagePath(run);
  const at = path ? `${base}${path}` : `${base}/`;
  return {
    results: `${at}?r=${encodeURIComponent(run.token)}#review-race`,
    book: `${at}?r=${encodeURIComponent(run.token)}#book`,
    unsubscribe: `${base}/api/race?action=unsubscribe&e=${encodeURIComponent(e)}&s=${sign(e.toLowerCase(), c.linkSecret)}`
  };
}

/* ---------- What the page receives ---------- */
export function view(c, run) {
  const p = parts(c);
  const out = { token: run.token, status: run.status, demo: c.fake, business: { name: run.business.name, category: run.business.category }, fit: fitOf(run.business.category), search: run.search, preview: run.preview };
  if (run.race) out.locked = { unanswered: run.race.you.unanswered, fetched: run.race.you.fetched, drafts: (run.picks || []).length, window: run.race.you.window };
  if (run.email && run.analysis) {
    out.unlocked = true;
    out.result = {
      race: run.race,
      analysis: { summary: run.analysis.summary, fixes: run.analysis.fixes, drafts: run.analysis.drafts, praise: run.analysis.praise, complaints: run.analysis.complaints, fallback: Boolean(run.analysis.fallback) },
      picks: (run.picks || []).map((x) => ({ id: x.id, rating: x.rating, author: x.author, daysAgo: x.daysAgo, text: x.text, link: x.link })),
      booked: run.booked_at ? { start: run.booking && run.booking.start } : null,
      calendar: p.calendar,
      bookingUrl: c.ghl.bookingUrl || null,
      firstName: run.first_name || ""
    };
  }
  return out;
}

const tradeFallback = (o, hint) => {
  const s = `${o.name} ${hint || ""} ${(o.types || []).join(" ")}`.toLowerCase();
  if (/plumb|drain|rooter|sewer/.test(s)) return "Plumber";
  if (/hvac|heat|air|cool|furnace|comfort/.test(s)) return "HVAC contractor";
  if (/electric/.test(s)) return "Electrician";
  if (/roof/.test(s)) return "Roofing contractor";
  return "Home services";
};

/* ---------- start ---------- */
/* ---------- find: the business search on SerpApi, when there is no Google Places key ---------- */
// One SerpApi search for what the owner typed (name and town). Each listing goes back to the page signed, so start
// can use it as it is, with no second search, and nobody can hand start a listing SerpApi didn't return.
const LISTING = "listing:";
export async function find({ c, svc, q }) {
  const results = await svc.find(q, { searches: 0 });
  return (results || []).filter((p) => p && p.placeId && p.name).slice(0, 6).map((p) => {
    const listing = Buffer.from(JSON.stringify({ ...p, position: null })).toString("base64url");
    return { id: p.placeId, main: p.name, secondary: p.address || p.category || "", listing, sig: sign(LISTING + listing, c.linkSecret) };
  });
}

function pickedListing(c, body) {
  if (!body.listing) return null;
  const listing = String(body.listing).slice(0, 12000);
  let p = null;
  if (verifySig(LISTING + listing, body.sig, c.linkSecret)) { try { p = JSON.parse(Buffer.from(listing, "base64url").toString("utf8")); } catch { p = null; } }
  if (!p || !p.name || !p.placeId) throw fail(400, "Search for your business again, then pick it from the list.", "bad-place");
  return p;
}

export async function start({ c, store, svc, body, ip, ipHash, now = Date.now(), origin }) {
  const picked = pickedListing(c, body);
  const placeId = clean(picked ? picked.placeId : body.placeId, 300);
  if (!/^[A-Za-z0-9_:-]{6,300}$/.test(placeId)) throw fail(400, "Pick your business from the list.", "bad-place");
  const main = clean(body.main, 160), secondary = clean(body.secondary, 160);
  const human = await svc.human(body.turnstile, ip);
  if (!human.ok) throw fail(403, "We couldn't confirm you're a person. Refresh the page and try again.", "bot-check");
  const day = iso(now - DAY);
  if (ipHash && (await store.countByIp(ipHash, day)) >= c.limits.perIpPerDay) throw fail(429, "That's the limit for today from this network. Try again tomorrow, or leave your email and we'll send your race.", "rate-limit", { later: true });
  const midnight = new Date(now); midnight.setUTCHours(0, 0, 0, 0);
  if ((await store.countSince(iso(midnight))) >= c.limits.perDay) throw fail(503, "The race is busy today. Leave your email and we'll send yours within one business day.", "daily-cap", { later: true });

  const host = hostOf(body);
  const base = { token: newToken(), place_id: placeId, ip_hash: ipHash, visit: clean(body.visit, 80) || null, meta: drop({ utm: utmOf(body.utm), page: clean(body.page, 300), variant: host.variant }) };

  // The same business raced in the last few days: reuse it (a copy, with its own token), no searches spent
  const cached = await store.recentReady(placeId, iso(now - c.limits.cacheDays * DAY));
  if (cached && cached.race && cached.analysis) {
    const row = await store.createRun({ ...base, status: "reviews", data_id: cached.data_id, business: cached.business, search: cached.search, rivals: cached.rivals, preview: cached.preview, race: cached.race, picks: cached.picks, analysis: cached.analysis, source_run: cached.id, cost: { serpapi: 0, cached: true } });
    return view(c, row);
  }

  const counter = { searches: 0 };
  const owner = picked || (await svc.placeLookup(placeId, counter));
  if (!owner || !owner.name) throw fail(404, "We couldn't find that business on Google Maps. Check the name, or leave your email and we'll look it up for you.", "not-found", { later: true });
  owner.category = owner.category || tradeFallback(owner, main);
  const where = places.cityFrom(secondary) || places.cityFrom(owner.address || "");
  const hasPin = typeof owner.lat === "number" && typeof owner.lng === "number";
  const query = owner.category;
  const results = await svc.mapSearch({ q: query, lat: hasPin ? owner.lat : null, lng: hasPin ? owner.lng : null, where }, counter);
  const { rivals, position } = pickRivals(results, owner, 3);
  const slim = (p) => ({ name: p.name, rating: p.rating, count: p.count, position: p.position });
  const preview = {
    owner: { ...slim(owner), position },
    rivals: rivals.map(slim),
    headline: headline(owner, rivals),
    query, where
  };
  const search = { query, where, date: new Date(now).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric", timeZone: "UTC" }), ll: hasPin ? `@${owner.lat},${owner.lng},13z` : null };
  const row = await store.createRun({ ...base, status: rivals.length ? "preview" : "no-rivals", data_id: owner.dataId, business: owner, search, rivals, preview, cost: { serpapi: counter.searches } });
  return view(c, row);
}

/* ---------- reviews ---------- */
async function waitFor(store, token, test, ms) {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    await sleep(1500);
    const r = await store.getRun(token);
    if (r && test(r)) return r;
  }
  return null;
}

export async function reviews({ c, store, svc, token, now = Date.now() }) {
  let run = await store.getRun(token);
  if (!run) throw fail(404, "This race has expired. Start a new one.", "not-found");
  if (run.race || !run.rivals || !run.rivals.length) return run;
  const claimed = await store.updateRun(token, { reviews_started_at: iso(now) }, { whenNull: ["reviews_started_at"] });
  if (!claimed) {
    const done = await waitFor(store, token, (r) => Boolean(r.race), 60000);
    if (!done) throw fail(504, "Reading the reviews is taking longer than usual. Try again in a minute.", "slow");
    return done;
  }
  const counter = { searches: 0 };
  const [mine, ...theirs] = await Promise.allSettled([
    svc.fetchReviews({ placeId: run.place_id, dataId: run.data_id }, { maxPages: 3, atLeast: 30, now }, counter),
    ...run.rivals.map((p) => svc.fetchReviews({ placeId: p.placeId, dataId: p.dataId }, { maxPages: 2, atLeast: 28, now }, counter))
  ]);
  if (mine.status === "rejected") {
    await store.updateRun(token, { reviews_started_at: null, error: String(mine.reason && mine.reason.message).slice(0, 300) });
    throw mine.reason && mine.reason.status ? mine.reason : fail(502, "We couldn't read your reviews just now. Try again in a minute.", "reviews");
  }
  const ownerReviews = mine.value;
  const rivalReviews = theirs.map((t) => (t.status === "fulfilled" ? t.value : null));
  const race = buildRace({ owner: run.business, rivals: run.rivals, ownerReviews, rivalReviews, now });
  const picks = pickReviews(ownerReviews.reviews, 3, now);
  const recent = recentForClaude(ownerReviews.reviews, now);
  run = await store.updateRun(token, { status: "reviews", race, picks, recent, cost: { ...(run.cost || {}), serpapi: ((run.cost && run.cost.serpapi) || 0) + counter.searches } });
  return run;
}

/* ---------- unlock ---------- */
function claudeInput(run) {
  const r = run.race, y = r.you, a = r.average;
  const cush = r.cushion ? (r.cushion.kind === "above" ? `${r.cushion.k} one-star reviews would take the rating under 4.5` : `${r.cushion.m} five-star reviews in a row would bring the rating to 4.5`) : "unknown";
  return {
    business: { name: run.business.name, category: run.business.category, city: run.search.where },
    search: { query: run.search.query, where: run.search.where, date: run.search.date },
    you: {
      rating: y.rating, total_reviews: y.count, profile_basics: y.basics !== null ? `${y.basics} of 5` : "unknown",
      reviews_last_90_days: y.last90 === null ? "unknown" : `${y.last90}${y.capped ? " or more" : ""}`,
      newest_review_days_ago: y.newestDays, replied: y.window ? `${y.replied} of the last ${y.window}` : "unknown",
      without_reply: y.fetched ? `${y.unanswered} of the last ${y.fetched} reviews read` : "unknown", star_cushion: cush
    },
    rivals: r.rivals.map((t) => ({ name: t.name, rating: t.rating, total_reviews: t.count, reviews_last_90_days: t.last90 === null ? "unknown" : `${t.last90}${t.capped ? " or more" : ""}`, newest_review_days_ago: t.newestDays, replied: t.window ? `${t.replied} of the last ${t.window}` : "unknown" })),
    rivals_average: { rating: a.rating, total_reviews: a.count, reviews_last_90_days: a.last90, newest_review_days_ago: a.newestDays, replied: a.replyRate !== null ? `about ${share(a.replyRate, 30)} of every 30` : "unknown", profile_basics: a.basics !== null ? `${a.basics} of 5` : "unknown" },
    standing: { momentum: r.areas.momentum, care: r.areas.care, trust: r.areas.trust, first_impression: r.areas.firstImpression },
    your_recent_reviews: run.recent || [],
    reviews_to_answer: (run.picks || []).map((p) => ({ id: p.id, stars: p.rating, firstName: p.author || null, daysAgo: p.daysAgo, text: p.text || "" }))
  };
}

async function analysis({ c, store, svc, run, deadline }) {
  if (run.analysis) return run.status === "ready" ? run : store.updateRun(run.token, { status: "ready", recent: null });
  const token = run.token;
  const claimed = await store.updateRun(token, { analysis_started_at: new Date().toISOString(), status: "analyzing" }, { whenNull: ["analysis_started_at"] });
  if (!claimed) {
    const done = await waitFor(store, token, (r) => Boolean(r.analysis), Math.max(5000, (deadline || Date.now() + 90000) - Date.now() - 3000));
    if (!done) throw fail(504, "Your race is taking longer than usual. We'll email it to you.", "slow");
    return done;
  }
  let result;
  try {
    const { data, model, usage } = await svc.analyze(claudeInput(run), run.race, deadline);
    const { analysis: a, dropped } = claude.check(data, { picks: run.picks || [], maxComplaint: (run.recent || []).length || 30 });
    const fixes = [...a.fixes];
    for (const f of ruleFixes(run.race)) { if (fixes.length >= 3) break; if (!fixes.some((x) => x.area === f.area && x.title === f.title)) fixes.push(f); }
    result = { ...a, summary: a.summary || ruleSummary(run.race), fixes: fixes.slice(0, 3), model, usage, dropped: dropped.length };
    if (dropped.length) console.warn("claude lines dropped:", JSON.stringify(dropped).slice(0, 600));
  } catch (e) {
    console.error("analysis failed, using the rule-based fixes:", e.message);
    result = { summary: ruleSummary(run.race), fixes: ruleFixes(run.race), drafts: [], praise: [], complaints: [], fallback: true, error: String(e.message).slice(0, 200) };
  }
  return store.updateRun(token, { analysis: result, status: "ready", recent: null });
}

export async function unlock({ c, store, svc, token, body, ipHash, now = Date.now(), deadline, origin, client = {} }) {
  const host = hostOf(body);
  const firstName = clean(body.firstName, 60);
  const email = clean(body.email, 254).toLowerCase();
  const phone = usPhone(body.phone);
  if (!firstName) throw fail(400, "Please enter your first name.", "first-name");
  if (!EMAIL.test(email)) throw fail(400, "Please check your email address.", "email");
  if (body.phone && !phone) throw fail(400, "Please enter a 10-digit US phone number, or leave it empty.", "phone");
  if (body.consentEmail !== true && body.consentEmail !== "true" && body.consentEmail !== "on") throw fail(400, "Please tick the box so we can email your race.", "consent");
  const consent = { consentEmail: true, consentCall: Boolean(phone && body.consentCall), consentText: Boolean(phone && body.consentText) };

  let run = await store.getRun(token);
  if (!run) throw fail(404, "This race has expired. Start a new one.", "not-found");
  const first = !run.email;
  if (first) run = await store.updateRun(token, { email, first_name: firstName, phone: phone || null, consent, unlocked_at: new Date(now).toISOString() });
  const L = links(c, run, origin);

  // The lead goes out right away (speed to lead), while the reviews and Claude finish
  const leadWork = first ? (async () => {
    const r = run.preview || {};
    const leadId = await store.submitLead({
      form: "review-race", email, name: firstName, phone: phone ? `+1${phone}` : null, company: run.business.name,
      consent, ip_hash: ipHash,
      fields: drop({ city: run.search.where, category: run.business.category, fit: fitOf(run.business.category), rating: run.business.rating, reviews: run.business.count, rivals: (r.rivals || []).map((x) => x.name).join(", "), raceToken: run.token, results: L.results,
        variant: (run.meta && run.meta.variant) || host.variant, visit: run.visit || "",
        // The consent and policy wording this lead agreed to (legal-src/settings.mjs noticeVersion, sent by the page)
        noticeVersion: host.noticeVersion }),
      meta: { ...(run.meta && run.meta.utm ? run.meta.utm : {}), page: (run.meta && run.meta.page) || "", visit: run.visit || "", ...adMeta(host) }
    }).catch((e) => { console.error("submit_lead failed:", e.message); return null; });
    await toMeta({ svc, name: "Lead", run, host, client, custom: drop({ variant: (run.meta && run.meta.variant) || host.variant }) });
    let contactId = null;
    if (svc.crm) {
      contactId = await svc.crm.upsert({ firstName, email, phone: phone ? `+1${phone}` : undefined, companyName: run.business.name, city: run.search.where, tags: ["review-race"] })
        .then((x) => x.id).catch((e) => { console.error("GoHighLevel upsert failed:", e.message); return null; });
    }
    await store.updateRun(token, { lead_id: leadId, ghl_contact_id: contactId });
    await svc.team(teamAlert({ run, links: L })).catch((e) => console.error("team alert failed:", e.message));
    return contactId;
  })() : Promise.resolve(run.ghl_contact_id);

  if (!run.race) run = await reviews({ c, store, svc, token, now });
  if (!run.race) throw fail(409, "There are no nearby businesses to compare with for this search.", "no-rivals");
  run = await analysis({ c, store, svc, run, deadline });
  const contactId = await leadWork;

  if (first) {
    const unsubscribed = await store.isUnsubscribed(email).catch(() => false);
    const mail = resultsEmail({ c, run, links: L });
    await svc.email({ to: email, ...mail, unsubscribe: L.unsubscribe, idempotencyKey: `race-results-${run.token}` })
      .catch((e) => console.error("results email failed:", e.message));
    if (c.nurture && !unsubscribed) {
      const at = (d) => new Date(now + d * DAY).toISOString();
      const rows = [
        { template: "day2", send_at: at(2) },
        { template: "day5", send_at: at(5) },
        ...(c.caseStudyUrl ? [{ template: "day9", send_at: at(9) }] : []),
        ...(c.updates ? [{ template: "update14", send_at: at(14) }, { template: "update44", send_at: at(44) }] : [])
      ].map((r) => ({ ...r, race_id: run.id, email }));
      await store.queueEmails(rows).catch((e) => console.error("queueing follow-ups failed:", e.message));
    }
    if (svc.crm && contactId) {
      const a = run.analysis || {};
      const note = [`Review Race: ${a.summary || ""}`, ...(a.fixes || []).map((f, i) => `${i + 1}. ${f.title}: ${f.why}`), `Results: ${L.results}`].join("\n");
      await svc.crm.note(contactId, note).catch((e) => console.error("GoHighLevel note failed:", e.message));
    }
  }
  return view(c, run);
}

/* ---------- later: when the race can't run (a key not set yet, the daily cap, a business Google can't find), the team
   builds the race by hand and emails it. The store may be the leads-only one (store.mjs, openLeadStore). ---------- */
export async function later({ c, store, svc, body, ipHash }) {
  const host = hostOf(body);
  const firstName = clean(body.firstName, 60);
  const email = clean(body.email, 254).toLowerCase();
  if (!firstName || !EMAIL.test(email)) throw fail(400, "Please enter your first name and a valid email.", "contact");
  if (body.consentEmail !== true && body.consentEmail !== "true" && body.consentEmail !== "on") throw fail(400, "Please tick the box so we can email your race.", "consent");
  const business = { name: clean(body.main, 160) || "their business" };
  const where = places.cityFrom(clean(body.secondary, 160));
  const code = clean(body.reason, 40);
  const REASONS = {
    "not-ready": "the race is not set up yet: a key is missing in Vercel (see /api/race?action=health)",
    "not-configured": "the race is not set up yet: a key is missing in Vercel (see /api/race?action=health)",
    "daily-cap": "the day's limit of races was reached",
    "rate-limit": "this network's daily limit was reached",
    "not-found": "Google Maps could not find the business",
    "no-rivals": "there were no nearby businesses to compare with",
    quota: "the search service's monthly quota ran out",
    serpapi: "the search service did not answer"
  };
  const reason = REASONS[code] || clean(body.reason, 120) || "the search was unavailable";
  await store.submitLead({
    form: "review-race-later", email, name: firstName, company: business.name, consent: { consentEmail: true }, ip_hash: ipHash,
    fields: drop({ city: where, reason, variant: host.variant, visit: clean(body.visit, 80), noticeVersion: host.noticeVersion }),
    meta: drop({ ...utmOf(body.utm), page: clean(body.page, 300), visit: clean(body.visit, 80), ...adMeta(host) })
  }).catch((e) => console.error("submit_lead failed:", e.message));
  if (svc.crm) await svc.crm.upsert({ firstName, email, companyName: business.name, city: where, tags: ["review-race", "review-race-later"] }).catch((e) => console.error("GoHighLevel upsert failed:", e.message));
  await svc.team(teamAlert({ run: { first_name: firstName, email, business, search: { where } }, links: {}, kind: "later", reason }));
  return { ok: true };
}

/* ---------- the calendar ---------- */
export async function slots({ c, store, svc, token, tz, now = Date.now() }) {
  const run = await store.getRun(token);
  if (!run || !run.email) throw fail(404, "Unlock your race first.", "not-found");
  if (!svc.calendar) return { days: [], bookingUrl: c.ghl.bookingUrl || null };
  const timezone = /^[A-Za-z_]+(\/[A-Za-z0-9_+-]+){0,2}$/.test(tz || "") ? tz : "America/Chicago";
  const days = (await svc.calendar.slots({ timezone, from: now, days: 8 })).slice(0, 5).map((d) => ({ date: d.date, slots: d.slots.slice(0, 12) }));
  return { days, timezone, bookingUrl: c.ghl.bookingUrl || null };
}

export async function book({ c, store, svc, token, body, origin, client = {} }) {
  const host = hostOf(body);
  let run = await store.getRun(token);
  if (!run || !run.email) throw fail(404, "Unlock your race first.", "not-found");
  if (run.booked_at) return { ok: true, start: run.booking && run.booking.start, already: true };
  if (!svc.calendar) throw fail(503, "The calendar is not set up yet.", "not-configured");
  const startTime = clean(body.start, 40);
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(startTime) || !Number.isFinite(Date.parse(startTime))) throw fail(400, "Pick a time.", "slot");
  const phone = usPhone(body.phone || run.phone);
  if (!phone) throw fail(400, "Please enter the best 10-digit number to call.", "phone");
  if (body.consentCall !== true && body.consentCall !== "true" && body.consentCall !== "on") throw fail(400, "Please tick the box so we can call you.", "consent");
  // The texts box is optional. GoHighLevel learns the answer as a tag, so its text workflow can send only to those who
  // ticked it (race-texts-ok); without the tag, no text
  const textsOk = body.consentText === true || body.consentText === "true" || body.consentText === "on";
  let contactId = run.ghl_contact_id;
  if (svc.crm) {
    contactId = await svc.crm.upsert({ firstName: run.first_name, email: run.email, phone: `+1${phone}`, companyName: run.business.name, city: run.search.where, tags: ["review-race", "race-booked", ...(textsOk ? ["race-texts-ok"] : [])] }).then((x) => x.id).catch(() => contactId);
  }
  if (!contactId) throw fail(502, "We couldn't reach the calendar. Try again in a minute.", "crm");
  const appt = await svc.calendar.book({ contactId, startTime, title: `Review Race call: ${run.business.name}` });
  run = await store.updateRun(token, { booked_at: new Date().toISOString(), booking: drop({ start: startTime, appointmentId: appt.id, phone: `+1${phone}`, consentCall: true, consentText: textsOk, noticeVersion: host.noticeVersion, ...adMeta(host) }), ghl_contact_id: contactId });
  await store.skipEmailsFor(run.id).catch(() => {});
  await toMeta({ svc, name: "Schedule", run, host, client, custom: drop({ variant: (run.meta && run.meta.variant) || host.variant }) });
  const when = new Date(startTime).toLocaleString("en-US", { weekday: "long", month: "long", day: "numeric", hour: "numeric", minute: "2-digit", timeZone: clean(body.tz, 60) || "America/Chicago", timeZoneName: "short" });
  await svc.team(bookedAlert({ run, when, phone: `+1${phone}`, links: links(c, run, origin) })).catch(() => {});
  return { ok: true, start: startTime };
}

/* ---------- the daily job ---------- */
async function raceUpdate({ svc, run }) {
  const counter = { searches: 0 };
  const lat = run.business.lat, lng = run.business.lng;
  const results = await svc.mapSearch({ q: run.search.query, lat: typeof lat === "number" ? lat : null, lng: typeof lng === "number" ? lng : null, where: run.search.where }, counter);
  const find = (p) => results.find((x) => (p.placeId && x.placeId === p.placeId) || (p.dataId && x.dataId === p.dataId));
  const rows = [];
  for (const p of [run.business, ...run.rivals]) {
    let now = find(p);
    if (!now && p === run.business) now = await svc.placeLookup(p.placeId, counter).catch(() => null);
    if (now && typeof now.count === "number") rows.push({ name: p === run.business ? `${p.name} (you)` : p.name, before: p.count || 0, after: now.count });
  }
  return { rows, searches: counter.searches };
}

export async function cron({ c, store, svc, now = Date.now() }) {
  const due = await store.dueEmails(iso(now), 40);
  const report = { due: due.length, sent: 0, skipped: 0, failed: 0 };
  for (const e of due) {
    try {
      const run = await store.getRunById(e.race_id);
      let skip = !run ? "race gone" : run.booked_at ? "booked" : (await store.isUnsubscribed(e.email)) ? "unsubscribed" : null;
      if (!skip && run.ghl_contact_id && svc.crm) {
        const tags = await svc.crm.contactTags(run.ghl_contact_id).catch(() => []);
        if (tags.some((t) => c.ghl.stopTags.includes(t))) skip = "stop tag in GoHighLevel";
      }
      if (!skip && e.template === "day9" && !c.caseStudyUrl) skip = "no case study link";
      if (!skip && e.template.startsWith("update") && !c.updates) skip = "updates off";
      if (skip) { await store.updateEmail(e.id, { status: "skipped", error: skip }); report.skipped += 1; continue; }
      let update = null;
      if (e.template.startsWith("update")) update = await raceUpdate({ svc, run });
      const L = links(c, run);
      const mail = nurtureEmail({ c, run, kind: e.template.startsWith("update") ? "update" : e.template, links: L, update });
      const sent = await svc.email({ to: e.email, ...mail, unsubscribe: L.unsubscribe, idempotencyKey: `race-${e.id}` });
      await store.updateEmail(e.id, sent.skipped ? { status: "failed", error: sent.skipped } : { status: "sent", sent_at: iso(Date.now()), resend_id: sent.id || null });
      if (sent.skipped) report.failed += 1; else report.sent += 1;
    } catch (err) {
      report.failed += 1;
      await store.updateEmail(e.id, { status: "failed", error: String(err.message).slice(0, 300) }).catch(() => {});
    }
  }
  await store.purge({ picksBefore: iso(now - 30 * DAY), recentBefore: iso(now - DAY) }).catch((e) => console.error("purge failed:", e.message));
  return report;
}
