// The numbers and the outside-service adapters: every figure the race shows, and the exact requests sent to SerpApi,
// Google Places and GoHighLevel (fetch is replaced, so nothing leaves the machine).
import { ok, section, report, withFetch } from "./harness.mjs";
import * as M from "../api/_lib/race/metrics.mjs";
import * as serp from "../api/_lib/race/serpapi.mjs";
import * as places from "../api/_lib/race/places.mjs";
import * as ghl from "../api/_lib/race/ghl.mjs";
import { check } from "../api/_lib/race/claude.mjs";

const NOW = Date.parse("2026-11-10T12:00:00Z");
const D = M.DAY;
const rv = (daysAgo, extra = {}) => ({ id: `r${daysAgo}`, rating: 5, iso: new Date(NOW - daysAgo * D).toISOString(), text: "Great service, fixed it fast.", replied: false, author: "Dana", ...extra });

await section("star cushion", () => {
  const a = M.cushion(4.9, 22);
  ok("4.9 on 22: 3 one-star reviews", a.kind === "above" && a.k === 3, a);
  const b = M.cushion(4.3, 87);
  ok("4.3 on 87: 24 five-star reviews", b.kind === "below" && b.m === 24, b);
  const c = M.cushion(4.6, 87);
  ok("4.6 on 87: 4 one-star reviews", c.k === 4, c);
  ok("4.6 on 87 is the smallest k", (4.6 * 87 + 3) / 90 >= 4.45 && (4.6 * 87 + 4) / 91 < 4.45);
  ok("4.5 on 10: 1", M.cushion(4.5, 10).k === 1);
  ok("no rating: null", M.cushion(null, 10) === null && M.cushion(4.5, 0) === null);
});

await section("dates and summaries", () => {
  ok("2 weeks ago", M.relativeTime("2 weeks ago", NOW) === NOW - 14 * D);
  ok("a year ago", M.relativeTime("a year ago", NOW) === NOW - 365 * D);
  ok("Edited 3 months ago", M.relativeTime("Edited 3 months ago", NOW) === NOW - 90 * D);
  ok("no date", M.relativeTime("yesterday-ish", NOW) === null);
  const s = M.summarize([rv(1, { replied: true }), rv(10), rv(50, { replied: true }), rv(100), rv(200)], { now: NOW, more: true });
  ok("last 90 days counts 3", s.last90 === 3, s);
  ok("newest is 1 day old", s.newestDays === 1);
  ok("replied 2 of 5", s.replied === 2 && s.window === 5);
  ok("reaches back past 90 days: not capped", s.capped === false);
  ok("unanswered 3", s.unanswered === 3);
  const capped = M.summarize([rv(1), rv(5), rv(9)], { now: NOW, more: true });
  ok("all inside 90 days with more pages: capped", capped.capped === true && capped.last90 === 3);
  const rel = M.summarize([{ ...rv(0), iso: null, date: "3 weeks ago" }], { now: NOW });
  ok("relative date fallback", rel.newestDays === 21, rel);
  const thirty = M.summarize(Array.from({ length: 40 }, (_, i) => rv(i, { replied: i % 2 === 0 })), { now: NOW });
  ok("reply window is the last 30", thirty.window === 30 && thirty.replied === 15);
});

await section("rivals and picks", () => {
  const owner = { name: "Maple Street Plumbing", placeId: "own", dataId: "0x1", address: "1 Main St" };
  const results = [
    { name: "A", placeId: "a", count: 10, rating: 4.8, position: 1 },
    { name: "Maple Street Plumbing", placeId: "own", count: 87, rating: 4.6, position: 2 },
    { name: "No reviews yet", placeId: "z", count: 0, rating: null, position: 3 },
    { name: "B", placeId: "b", count: 5, rating: 4.1, position: 4 },
    { name: "C", placeId: "c", count: 9, rating: 5, position: 5 },
    { name: "D", placeId: "d", count: 9, rating: 5, position: 6 }
  ];
  const r = M.pickRivals(results, owner, 3);
  ok("owner found at #2", r.position === 2, r.position);
  ok("rivals skip the owner and empty listings", r.rivals.map((x) => x.name).join(",") === "A,B,C", r.rivals.map((x) => x.name));
  ok("owner missing: null position", M.pickRivals(results.filter((x) => x.placeId !== "own"), owner).position === null);
  const picks = M.pickReviews([rv(2), rv(5, { replied: true }), rv(9), rv(12), rv(40, { rating: 2, text: "Nobody called back about the leak." }), rv(60)], 3, NOW);
  ok("three picks", picks.length === 3);
  ok("the hard review is always picked", picks.some((p) => p.rating === 2));
  ok("replied reviews are never picked", !picks.some((p) => p.id === "r5"));
  ok("days ago is set", picks.every((p) => typeof p.daysAgo === "number"));
  const textless = M.pickReviews([rv(1, { text: "" }), rv(3, { text: "" })], 3, NOW);
  ok("reviews without text are used when there is nothing else", textless.length === 2);
});

await section("compare and the race", () => {
  ok("ahead", M.compare(12, 10) === "ahead");
  ok("level", M.compare(10.5, 10) === "level");
  ok("behind", M.compare(5, 10) === "behind");
  ok("absolute rating gap", M.compare(4.6, 4.8, { absolute: 0.1 }) === "behind" && M.compare(4.8, 4.75, { absolute: 0.1 }) === "level");
  ok("lower is better for days", M.compare(30, 3, { lowerBetter: true, minGap: 7 }) === "behind");
  ok("unknown", M.compare(null, 3) === "unknown");
  const owner = { name: "Me", rating: 4.6, count: 87, basics: { hours: true, website: true, phone: true, description: false, photos: true } };
  const rivals = [{ name: "A", rating: 4.8, count: 200 }, { name: "B", rating: 4.8, count: 180 }];
  const race = M.buildRace({ owner, rivals, ownerReviews: { reviews: [rv(5), rv(100)], more: false }, rivalReviews: [{ reviews: Array.from({ length: 20 }, (_, i) => rv(i * 4, { replied: true })), more: false }, null], now: NOW });
  ok("owner basics 4 of 5", race.you.basics === 4);
  ok("a rival with no reviews read is left out of the average", race.average.last90 === race.rivals[0].last90, race.average);
  ok("momentum behind", race.areas.momentum === "behind");
  ok("pace over 12 months", race.you.pace12 === Math.round((1 * 365) / 90));
  ok("headline behind", M.headline(owner, rivals).kind === "behind" && M.headline(owner, rivals).avg === 190);
});

await section("SerpApi requests and shapes", async () => {
  const place = serp.normalizePlace({ title: "Maple", place_id: "ChIJx", data_id: "0x1:0x2", rating: 4.6, reviews: 87, type: ["Plumber"], gps_coordinates: { latitude: 39.7, longitude: -89.6 }, operating_hours: { monday: "8-5" }, phone: "(217) 555-0142", thumbnail: "x" });
  ok("place_results type is an array", place.category === "Plumber");
  ok("basics read", place.basics.hours && place.basics.phone && place.basics.photos && !place.basics.website && !place.basics.description);
  const local = serp.normalizePlace({ title: "B", type: "HVAC contractor", types: ["HVAC contractor", "Plumber"], reviews: 12, rating: 4.9, position: 2 });
  ok("local_results type is a string", local.category === "HVAC contractor" && local.position === 2);
  const review = serp.normalizeReview({ review_id: "abc", rating: 3, iso_date: "2026-10-01T00:00:00Z", snippet: "translated", extracted_snippet: { original: "Original words" }, user: { name: "Dana Rodriguez" }, response: { snippet: "Thanks Dana" } });
  ok("review text is the original", review.text === "Original words");
  ok("owner reply detected", review.replied === true);
  ok("first name only", review.author === "Dana");
  ok("no reply", serp.normalizeReview({ review_id: "x", rating: 5, iso_date: "2026-10-01T00:00:00Z" }).replied === false);

  await withFetch((url) => {
    const u = new URL(url);
    if (u.searchParams.get("engine") === "google_maps" && u.searchParams.get("place_id")) return { body: { place_results: { title: "Maple", place_id: "ChIJx", data_id: "0x1:0x2", rating: 4.6, reviews: 87, type: ["Plumber"], gps_coordinates: { latitude: 39.78, longitude: -89.65 } } } };
    if (u.searchParams.get("type") === "search") return { body: { local_results: [{ position: 1, title: "A", place_id: "a", rating: 4.9, reviews: 200 }] } };
    return { body: {} };
  }, async (calls) => {
    const counter = { searches: 0 };
    const p = await serp.placeLookup("KEY", "ChIJx", counter);
    ok("place lookup", p.name === "Maple" && p.lat === 39.78);
    const l = await serp.mapSearch("KEY", { q: "Plumber", lat: 39.78, lng: -89.65, where: "Springfield, IL" }, counter);
    ok("map search results", l.length === 1 && l[0].name === "A");
    const u1 = new URL(calls[0].url), u2 = new URL(calls[1].url);
    ok("place lookup params", u1.pathname === "/search.json" && u1.searchParams.get("place_id") === "ChIJx" && u1.searchParams.get("api_key") === "KEY" && u1.searchParams.get("hl") === "en" && u1.searchParams.get("gl") === "us");
    ok("map search uses ll", u2.searchParams.get("ll") === "@39.78,-89.65,13z" && u2.searchParams.get("q") === "Plumber");
    await serp.mapSearch("KEY", { q: "Plumber", lat: null, lng: null, where: "Springfield, IL" }, counter);
    ok("no map pin: the town goes in the query", new URL(calls[2].url).searchParams.get("q") === "Plumber near Springfield, IL" && !new URL(calls[2].url).searchParams.get("ll"));
    ok("searches counted", counter.searches === 3);
  });

  await withFetch((url) => {
    const u = new URL(url);
    const tok = u.searchParams.get("next_page_token");
    const page = (from, n, next) => ({ body: { reviews: Array.from({ length: n }, (_, i) => ({ review_id: `p${from + i}`, rating: 5, iso_date: new Date(NOW - (from + i) * 4 * D).toISOString(), snippet: "Good" })), ...(next ? { serpapi_pagination: { next_page_token: next } } : {}) } });
    if (!tok) return page(0, 8, "t2");
    if (tok === "t2") return page(8, 20, "t3");
    return page(28, 20, "t4");
  }, async (calls) => {
    const out = await serp.fetchReviews("KEY", { placeId: "ChIJx" }, { maxPages: 3, atLeast: 30, now: NOW });
    const first = new URL(calls[0].url), second = new URL(calls[1].url);
    ok("newest first, by place_id", first.searchParams.get("sort_by") === "newestFirst" && first.searchParams.get("place_id") === "ChIJx");
    ok("no num on the first page", !first.searchParams.get("num"));
    ok("hl only on the reviews engine (gl is a maps parameter)", first.searchParams.get("hl") === "en" && !first.searchParams.get("gl"));
    ok("num=20 with the token after", second.searchParams.get("num") === "20" && second.searchParams.get("next_page_token") === "t2");
    ok("stops once past 90 days with 30 in hand", calls.length === 3 && out.reviews.length === 48, { calls: calls.length, n: out.reviews.length });
  });

  await withFetch(() => ({ status: 200, body: { error: "Your account has run out of searches." } }), async () => {
    let err = null;
    try { await serp.placeLookup("KEY", "x"); } catch (e) { err = e; }
    ok("quota error is a 503 with code quota", err && err.status === 503 && err.code === "quota", err && err.message);
  });
  await withFetch(() => ({ status: 200, body: { error: "Google hasn't returned any results for this query." } }), async () => {
    ok("no results is empty, not an error", (await serp.mapSearch("KEY", { q: "x" })).length === 0);
  });
});

await section("Google Places autocomplete", async () => {
  await withFetch(() => ({ body: { suggestions: [{ placePrediction: { placeId: "ChIJ1", text: { text: "Maple Street Plumbing, Springfield, IL" }, structuredFormat: { mainText: { text: "Maple Street Plumbing" }, secondaryText: { text: "Springfield, IL, USA" } }, types: ["plumber"] } }, { queryPrediction: { text: { text: "plumbers" } } }] } }), async (calls) => {
    const s = await places.suggest("GKEY", "maple", "sess-12345678");
    const body = JSON.parse(calls[0].init.body);
    ok("POST to places:autocomplete", calls[0].url === "https://places.googleapis.com/v1/places:autocomplete" && calls[0].init.method === "POST");
    ok("key in X-Goog-Api-Key", calls[0].init.headers["X-Goog-Api-Key"] === "GKEY");
    ok("service-area businesses included, US only", body.includePureServiceAreaBusinesses === true && body.includedRegionCodes[0] === "us" && body.sessionToken === "sess-12345678");
    ok("query predictions dropped", s.length === 1 && s[0].main === "Maple Street Plumbing" && s[0].secondary === "Springfield, IL, USA");
  });
  ok("city from secondary", places.cityFrom("Springfield, IL, USA") === "Springfield, IL");
  ok("city from an address", places.cityFrom("1200 S 6th St, Springfield, IL 62703, USA") === "Springfield, IL");
});

await section("GoHighLevel requests", async () => {
  const g = { token: "pit-xyz", locationId: "loc1", calendarId: "cal1", version: "2021-07-28", calendarVersion: "2021-04-15" };
  await withFetch((url) => {
    if (url.includes("/contacts/upsert")) return { body: { new: true, contact: { id: "c1" } } };
    if (url.includes("/free-slots")) return { body: { "2026-11-11": { slots: ["2026-11-11T09:00:00-06:00", "2026-11-11T09:30:00-06:00"] }, "2026-11-12": { slots: [] }, traceId: "t" } };
    if (url.includes("/appointments")) return { body: { id: "appt1" } };
    return { body: {} };
  }, async (calls) => {
    const c = await ghl.upsertContact(g, { firstName: "Tom", email: "tom@example.com", tags: ["review-race"] });
    ok("upsert returns the contact id", c.id === "c1" && c.isNew === true);
    const h0 = calls[0].init.headers;
    ok("upsert headers", h0.authorization === "Bearer pit-xyz" && h0.version === "2021-07-28");
    ok("upsert body", JSON.parse(calls[0].init.body).locationId === "loc1" && JSON.parse(calls[0].init.body).source === "Review Race");
    const days = await ghl.freeSlots(g, { timezone: "America/Chicago", from: NOW });
    ok("free slots parsed, empty days dropped", days.length === 1 && days[0].slots.length === 2);
    const u = new URL(calls[1].url);
    ok("free slots query", u.pathname === "/calendars/cal1/free-slots" && u.searchParams.get("timezone") === "America/Chicago" && Number(u.searchParams.get("startDate")) > NOW - D);
    ok("calendar version header", calls[1].init.headers.version === "2021-04-15");
    const b = await ghl.book(g, { contactId: "c1", startTime: "2026-11-11T09:00:00-06:00", title: "Call" });
    const body = JSON.parse(calls[2].init.body);
    ok("appointment booked", b.id === "appt1" && body.calendarId === "cal1" && body.contactId === "c1" && body.appointmentStatus === "confirmed");
  });
});

await section("what Claude writes is checked", () => {
  const picks = [{ id: "a" }, { id: "b" }];
  const { analysis, dropped } = check({
    summary: "You had 4 Google reviews in the last 90 days, against 19 for the top three.",
    fixes: [
      { area: "Momentum", title: "Ask every customer after every job", why: "You had 4 reviews in 90 days; they averaged 19.", firstStep: "Send your link after each job." },
      { area: "Care", title: "Get more reviews fast", why: "You replied to 10 of 30.", firstStep: "Reply this week." },
      { area: "Trust", title: "Build depth", why: "No number here.", firstStep: "Ask." },
      { area: "Other", title: "x", why: "1", firstStep: "y" }
    ],
    drafts: [
      { reviewId: "a", reply: "Thanks, Dana. Glad the heater is back on, and we're here whenever you need us.", callFirst: false },
      { reviewId: "b", reply: "Sorry about that. We'll give you a refund if you remove your review.", callFirst: true },
      { reviewId: "zzz", reply: "Thanks.", callFirst: false }
    ],
    praise: ["Fast same-day repairs"],
    complaints: [{ theme: "Late arrivals", count: 2 }, { theme: "Once", count: 1 }]
  }, { picks });
  ok("a promise in a fix is dropped", !analysis.fixes.some((f) => /more reviews/i.test(f.title)));
  ok("a fix without a number is dropped", !analysis.fixes.some((f) => f.title === "Build depth"));
  ok("an unknown area is dropped", analysis.fixes.length === 1);
  ok("a draft offering a refund is dropped", analysis.drafts.length === 1 && analysis.drafts[0].reviewId === "a");
  ok("complaints need at least two reviews", analysis.complaints.length === 1);
  ok("drops are reported", dropped.length >= 4);
});

report("metrics.test");
