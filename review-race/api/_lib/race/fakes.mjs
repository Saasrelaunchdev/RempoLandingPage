// Fixed sample data for RACE_FAKE=1: a fictional plumbing shop in Springfield, IL, three fictional rivals, their
// reviews, a calendar with open times, and a stand-in for Claude. Nothing here calls an outside service. Used by local
// work, the tests, and a first look at a deployment before any key is set (the page says it is demo data).
import { DAY } from "./metrics.mjs";
import { ruleFixes, ruleSummary } from "./copy.mjs";

const PLACES = {
  "fake-maple": { name: "Maple Street Plumbing", placeId: "fake-maple", dataId: "0xfake:0x1", rating: 4.6, count: 87, category: "Plumber", address: "1200 S 6th St, Springfield, IL 62703", lat: 39.786, lng: -89.65, phone: "(217) 555-0142", website: "https://example.com", basics: { hours: true, website: true, phone: true, description: false, photos: true } },
  "fake-cardinal": { name: "Cardinal Heating & Air", placeId: "fake-cardinal", dataId: "0xfake:0x2", rating: 4.4, count: 61, category: "HVAC contractor", address: "Springfield, IL", lat: 39.8, lng: -89.64, phone: "(217) 555-0188", website: null, basics: { hours: true, website: false, phone: true, description: false, photos: true } },
  "fake-prairie": { name: "Prairie Drain Pros", placeId: "fake-prairie", dataId: "0xfake:0x3", rating: 4.9, count: 23, category: "Plumber", address: null, lat: null, lng: null, phone: "(217) 555-0101", website: null, basics: { hours: true, website: false, phone: true, description: true, photos: false } }
};
const RIVALS = {
  Plumber: [
    { name: "Lincoln Land Plumbing", placeId: "fake-r1", dataId: "0xfake:0x11", rating: 4.8, count: 214, category: "Plumber", basics: { hours: true, website: true, phone: true, description: true, photos: true } },
    { name: "Capitol City Plumbing & Drain", placeId: "fake-r2", dataId: "0xfake:0x12", rating: 4.7, count: 188, category: "Plumber", basics: { hours: true, website: true, phone: true, description: true, photos: true } },
    { name: "Sangamon Rooter", placeId: "fake-r3", dataId: "0xfake:0x13", rating: 4.9, count: 156, category: "Plumber", basics: { hours: true, website: true, phone: true, description: false, photos: true } }
  ],
  "HVAC contractor": [
    { name: "Capital Comfort Heating & Cooling", placeId: "fake-r4", dataId: "0xfake:0x14", rating: 4.9, count: 402, category: "HVAC contractor", basics: { hours: true, website: true, phone: true, description: true, photos: true } },
    { name: "Midstate Air Pros", placeId: "fake-r5", dataId: "0xfake:0x15", rating: 4.8, count: 133, category: "HVAC contractor", basics: { hours: true, website: true, phone: true, description: true, photos: true } },
    { name: "Prairie Furnace Co.", placeId: "fake-r6", dataId: "0xfake:0x16", rating: 4.6, count: 97, category: "HVAC contractor", basics: { hours: true, website: true, phone: true, description: false, photos: true } }
  ]
};

export function suggest(input) {
  const all = Object.values(PLACES).map((p) => ({ id: p.placeId, main: p.name, secondary: "Springfield, IL, USA", types: [] }));
  const q = String(input || "").toLowerCase();
  const hit = all.filter((s) => s.main.toLowerCase().includes(q));
  return hit.length ? hit : all;
}

// The SerpApi business search (no Google key): the sample businesses whose name shares a word with the search
export function find(q) {
  const words = String(q || "").toLowerCase().split(/\s+/).filter((w) => w.length > 2);
  const all = Object.values(PLACES).map((p, i) => ({ ...structuredClone(p), position: i + 1 }));
  const hit = all.filter((p) => words.some((w) => p.name.toLowerCase().includes(w)));
  return hit.length ? hit : all;
}

export const placeLookup =(placeId) => (PLACES[placeId] ? structuredClone(PLACES[placeId]) : null);

export function mapSearch({ q }) {
  const category = /hvac|heat|air/i.test(q) ? "HVAC contractor" : "Plumber";
  const rivals = RIVALS[category].map((r, i) => ({ ...structuredClone(r), position: i + 1, address: "Springfield, IL", lat: null, lng: null, phone: null, website: null }));
  const owner = Object.values(PLACES).find((p) => p.category === category && p.placeId !== "fake-prairie") || PLACES["fake-maple"];
  return [...rivals, { ...structuredClone(owner), position: 4 }, { ...structuredClone(PLACES["fake-prairie"]), position: 5 }];
}

const OWNER_TEXTS = [
  [5, "Fixed our water heater the same afternoon. Clear about the price before starting, and cleaned up after."],
  [3, "Showed up two hours late and did not call ahead. The repair itself was fine once he got here."],
  [5, "Great job on the kitchen drain. Polite and fast."],
  [5, "They found the leak behind the wall without tearing up half the house. Very happy."],
  [4, "Good work on the sump pump, a little pricey but worth it."],
  [5, "Second time we've used them. Same great service."],
  [5, ""],
  [5, "Honest advice: told us we didn't need a new unit yet."],
  [2, "Had to call three times to get someone out for the follow-up visit."],
  [5, "Quick, tidy, and explained everything."]
];
const RIVAL_TEXTS = ["Fast and friendly.", "Fixed it right the first time.", "Great communication from start to finish.", "Would hire again.", "On time and fair."];

// A fixed history: days ago for each review, newest first
function history(placeId, now) {
  if (placeId === "fake-maple" || placeId === "fake-cardinal") {
    const days = [18, 26, 41, 63, 95, 104, 120, 133, 151, 170, 184, 199, 214, 230, 251, 262, 280, 301, 322, 340, 355, 371, 390, 402, 420, 433, 451, 470, 488, 503, 520, 547];
    return days.map((d, i) => {
      const [rating, text] = OWNER_TEXTS[i % OWNER_TEXTS.length];
      const replied = i % 3 === 2; // a third of them answered
      return { id: `${placeId}-rv${i}`, rating, iso: new Date(now - d * DAY).toISOString(), date: null, text, replied, author: ["Dana", "Mike", "Priya", "Luis", "Karen", "Tom", "Ann", "Jamal", "Rosa", "Ben"][i % 10], link: `https://maps.google.com/?review=${placeId}-${i}` };
    });
  }
  if (placeId === "fake-prairie") {
    return [9, 40, 80, 130, 200, 260, 300, 380].map((d, i) => ({ id: `${placeId}-rv${i}`, rating: 5, iso: new Date(now - d * DAY).toISOString(), date: null, text: i % 2 ? "" : "Cleared our main line fast.", replied: true, author: "Sam", link: null }));
  }
  const step = { "fake-r1": 4, "fake-r2": 5, "fake-r3": 6, "fake-r4": 2, "fake-r5": 5, "fake-r6": 8 }[placeId] || 6;
  return Array.from({ length: 48 }, (_, i) => ({ id: `${placeId}-rv${i}`, rating: i % 9 === 4 ? 4 : 5, iso: new Date(now - (2 + i * step) * DAY).toISOString(), date: null, text: RIVAL_TEXTS[i % RIVAL_TEXTS.length], replied: i % 10 < 7, author: "Chris", link: null }));
}

export function fetchReviews({ placeId }, { now = Date.now() } = {}) {
  const all = history(placeId, now);
  const out = all.slice(0, 48);
  return { reviews: out, pages: 3, more: all.length > out.length || placeId.startsWith("fake-r"), info: null };
}

// Stands in for Claude: the rule-based fixes, and plain drafts that pass the same checks
export function analyze(input, race) {
  const drafts = (input.reviews_to_answer || []).map((r) => {
    const name = r.firstName ? `, ${r.firstName}` : "";
    if (r.stars !== null && r.stars <= 3) return { reviewId: r.id, callFirst: true, reply: `Thank you for telling us${name}. You're right that a late arrival without a call is not how a visit should go. Please call our office so we can make it right.` };
    if (!r.text) return { reviewId: r.id, callFirst: false, reply: `Thank you for the five stars${name}. We're glad we could help, and we're here whenever you need us.` };
    return { reviewId: r.id, callFirst: false, reply: `Thanks so much${name}. It means a lot that the visit went smoothly, and we'll pass your words on to the team.` };
  });
  return { summary: ruleSummary(race), fixes: ruleFixes(race), drafts, praise: ["Fast same-day repairs", "Clear pricing up front", "Tidy, polite crews"], complaints: [{ theme: "Late arrivals without a call", count: 2 }] };
}

export function freeSlots({ from = Date.now() } = {}) {
  const out = [];
  const d = new Date(from);
  d.setUTCHours(0, 0, 0, 0);
  while (out.length < 5) {
    d.setUTCDate(d.getUTCDate() + 1);
    const w = d.getUTCDay();
    if (w === 0 || w === 6) continue;
    const date = d.toISOString().slice(0, 10);
    out.push({ date, slots: [15, 16.5, 19, 21.5].map((h) => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), Math.floor(h), (h % 1) * 60)).toISOString()) });
  }
  return out;
}
