// Every number in the race is computed here, in plain code, from SerpApi's public data: never by the model. Pure
// functions with no imports, so the tests can pin each one, and the same rules apply on screen, in the email and in
// what Claude is told.

export const DAY = 86400000;
const finite = (v) => typeof v === "number" && Number.isFinite(v);
const round1 = (v) => (finite(v) ? Math.round(v * 10) / 10 : null);
const roundInt = (v) => (finite(v) ? Math.round(v) : null);
export function avg(values) {
  const v = values.filter(finite);
  return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null;
}
const norm = (s) => String(s || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

// "a week ago", "2 months ago", "Edited 3 weeks ago": the date Google shows when an exact one is missing
export function relativeTime(s, now = Date.now()) {
  const m = String(s || "").toLowerCase().replace(/^edited\s+/, "").match(/\b(a|an|\d+)\s+(minute|hour|day|week|month|year)s?\s+ago\b/);
  if (!m) return null;
  const n = m[1] === "a" || m[1] === "an" ? 1 : Number(m[1]);
  const unit = { minute: 60000, hour: 3600000, day: DAY, week: 7 * DAY, month: 30 * DAY, year: 365 * DAY }[m[2]];
  return now - n * unit;
}

export function reviewTime(r, now = Date.now()) {
  const t = Date.parse(r && r.iso ? r.iso : "");
  if (Number.isFinite(t)) return t;
  return relativeTime(r && r.date, now);
}

// One business's reviews, newest first: what the last 90 days hold, how fresh the newest is, how many of the last 30
// got a reply. `more` says SerpApi had further pages: when every review read is inside the 90 days and more exist,
// the 90-day count is a floor ("at least"), flagged as capped.
export function summarize(reviews, { now = Date.now(), more = false } = {}) {
  const items = (reviews || []).map((r) => ({ ...r, t: reviewTime(r, now) })).filter((r) => r.t !== null).sort((a, b) => b.t - a.t);
  const cutoff = now - 90 * DAY;
  const last90 = items.filter((r) => r.t >= cutoff).length;
  const reachesBack = items.length > 0 && items[items.length - 1].t < cutoff;
  const window = items.slice(0, 30);
  const replied = window.filter((r) => r.replied).length;
  return {
    fetched: items.length,
    last90,
    capped: !reachesBack && Boolean(more),
    newestDays: items.length ? Math.max(0, Math.floor((now - items[0].t) / DAY)) : null,
    replied,
    window: window.length,
    replyRate: window.length ? replied / window.length : null,
    unanswered: items.filter((r) => !r.replied).length
  };
}

const basicsCount = (b) => (b ? ["hours", "website", "phone", "description", "photos"].filter((k) => b[k]).length : null);

export function metricsFor(place, rev, now = Date.now()) {
  const s = rev && Array.isArray(rev.reviews) ? summarize(rev.reviews, { now, more: rev.more }) : null;
  const info = (rev && rev.info) || {};
  return {
    name: place.name,
    rating: finite(place.rating) ? place.rating : finite(info.rating) ? info.rating : null,
    count: finite(place.count) && place.count > 0 ? place.count : finite(info.count) ? info.count : place.count || 0,
    basics: basicsCount(place.basics),
    fetched: s ? s.fetched : null,
    last90: s ? s.last90 : null,
    capped: s ? s.capped : false,
    newestDays: s ? s.newestDays : null,
    replied: s ? s.replied : null,
    window: s ? s.window : null,
    replyRate: s ? s.replyRate : null,
    unanswered: s ? s.unanswered : null,
    pace12: s ? Math.round((s.last90 * 365) / 90) : null
  };
}

// The listing in the search that is the owner's own business, and the first `n` others: the shops a homeowner sees
// first. Listings with no rating and no reviews are skipped, since there is nothing to compare.
export function pickRivals(results, owner, n = 3) {
  const same = (p) => (owner.placeId && p.placeId === owner.placeId) || (owner.dataId && p.dataId === owner.dataId)
    || (norm(p.name) === norm(owner.name) && (!p.address || !owner.address || norm(p.address) === norm(owner.address)));
  const at = results.findIndex(same);
  const rivals = results.filter((p) => !same(p)).filter((p) => p.count > 0 || finite(p.rating)).slice(0, n);
  return { rivals, position: at >= 0 ? at + 1 : null };
}

// How many one-star reviews would bring the shown rating below 4.5 (Google shows one decimal, so below 4.45), or how
// many five-star reviews in a row would bring it up to 4.5.
export function cushion(rating, count) {
  if (!finite(rating) || !finite(count) || count <= 0) return null;
  const eps = 1e-9;
  if (rating >= 4.45 - eps) return { kind: "above", k: Math.max(1, Math.floor(((rating - 4.45) * count) / 3.45 + eps) + 1) };
  return { kind: "below", m: Math.max(1, Math.ceil(((4.45 - rating) * count) / 0.55 - eps)) };
}

// ahead / level / behind / unknown, for one measure
export function compare(you, them, { lowerBetter = false, absolute = null, tolerance = 0.1, minGap = 0 } = {}) {
  if (!finite(you) || !finite(them)) return "unknown";
  let d = lowerBetter ? them - you : you - them;
  if (absolute !== null) return d >= absolute ? "ahead" : d <= -absolute ? "behind" : "level";
  if (Math.abs(you - them) <= minGap) return "level";
  if (them === 0) return you > 0 ? (lowerBetter ? "behind" : "ahead") : "level";
  const ratio = lowerBetter ? them / Math.max(you, 1e-9) : you / them;
  return ratio >= 1 + tolerance ? "ahead" : ratio <= 1 - tolerance ? "behind" : "level";
}

// The race: the owner, the three rivals, their average, and the four areas the landing page's scorecard names
export function buildRace({ owner, rivals, ownerReviews, rivalReviews = [], now = Date.now() }) {
  const you = metricsFor(owner, ownerReviews, now);
  const them = rivals.map((p, i) => metricsFor(p, rivalReviews[i], now));
  const average = {
    rating: round1(avg(them.map((t) => t.rating))),
    count: roundInt(avg(them.map((t) => t.count))),
    basics: round1(avg(them.map((t) => t.basics))),
    last90: roundInt(avg(them.map((t) => t.last90))),
    newestDays: roundInt(avg(them.map((t) => t.newestDays))),
    replyRate: avg(them.map((t) => t.replyRate)),
    pace12: roundInt(avg(them.map((t) => t.pace12)))
  };
  const areas = {
    firstImpression: compare(you.rating, average.rating, { absolute: 0.1 }),
    trust: compare(you.count, average.count, { tolerance: 0.1, minGap: 3 }),
    momentum: compare(you.last90, average.last90, { tolerance: 0.15, minGap: 1 }),
    care: compare(you.replyRate, average.replyRate, { absolute: 0.1 })
  };
  return { you, rivals: them, average, areas, cushion: cushion(you.rating, you.count) };
}

// The preview line, from the search alone (before any review is read)
export function headline(owner, rivals) {
  const a = roundInt(avg(rivals.map((r) => r.count)));
  if (a === null) return { kind: "unknown", avg: null, n: owner.count };
  const kind = compare(owner.count, a, { tolerance: 0.1, minGap: 3 });
  return { kind: kind === "unknown" ? "level" : kind, avg: a, n: owner.count };
}

// The reviews Claude writes replies for: the newest ones with no reply, with text to answer, and always the newest
// unanswered 1 to 3 star review when there is one, since that is the one the next homeowner reads closest.
export function pickReviews(reviews, n = 3, now = Date.now()) {
  const items = (reviews || []).map((r) => ({ ...r, t: reviewTime(r, now) })).filter((r) => r.t !== null && !r.replied).sort((a, b) => b.t - a.t);
  const withText = items.filter((r) => r.text && r.text.length >= 15);
  const pool = withText.length >= n ? withText : [...withText, ...items.filter((r) => !withText.includes(r))];
  let picks = pool.slice(0, n);
  const hard = items.find((r) => finite(r.rating) && r.rating <= 3);
  if (hard && !picks.includes(hard)) picks = [hard, ...picks].slice(0, n);
  return picks.map(({ t, ...r }) => ({ ...r, daysAgo: Math.max(0, Math.floor((now - t) / DAY)) }));
}

// The owner's recent reviews as Claude reads them: no surname, no links, the text trimmed
export function recentForClaude(reviews, now = Date.now(), max = 30) {
  return (reviews || []).map((r) => ({ ...r, t: reviewTime(r, now) })).filter((r) => r.t !== null).sort((a, b) => b.t - a.t).slice(0, max)
    .map((r) => ({ id: r.id, stars: r.rating, daysAgo: Math.max(0, Math.floor((now - r.t) / DAY)), replied: r.replied, text: String(r.text || "").slice(0, 500) }));
}

export const share = (rate, of = 30) => (finite(rate) ? Math.round(rate * of) : null);
