// SerpApi: the public Google Maps data behind the race. Three calls, all on https://serpapi.com/search.json:
//   engine=google_maps, place_id=...                       the owner's own listing (category, rating, count, map pin)
//   engine=google_maps, type=search, q=..., ll=@lat,lng,13z the list a homeowner sees for that category near them
//   engine=google_maps_reviews, place_id=..., sort_by=newestFirst   the newest reviews, owner replies included
// Parameter names and the JSON shapes follow SerpApi's documentation (serpapi/mcp-server engines and the
// google-maps-scraper / google-maps-reviews-scraper READMEs). Each call is one search on the plan, except a repeat of
// the same call within an hour, which SerpApi serves from its cache for free.
import { fetchJson } from "./http.mjs";

const BASE = "https://serpapi.com/search.json";
const NO_RESULTS = /hasn't returned any results|no results/i;

async function serp(key, params, counter) {
  // hl on both engines; gl (the country) is a google_maps parameter only, so it is not sent to the reviews engine
  const qs = new URLSearchParams({ ...params, api_key: key, hl: "en", ...(params.engine === "google_maps" ? { gl: "us" } : {}) });
  const r = await fetchJson(`${BASE}?${qs}`, { timeoutMs: 45000 });
  if (counter) counter.searches += 1;
  const err = r.data && typeof r.data === "object" && r.data.error;
  if (err && NO_RESULTS.test(err)) return { empty: true };
  if (!r.ok || err) {
    const quota = /run out of searches|plan|limit/i.test(String(err || "")) || r.status === 429;
    throw Object.assign(new Error(`SerpApi: ${err || `HTTP ${r.status}`}`), { status: quota ? 503 : 502, code: quota ? "quota" : "serpapi" });
  }
  return r.data || {};
}

const num = (v) => { const n = Number(v); return Number.isFinite(n) ? n : null; };

// One listing, from local_results or place_results, in the race's own words
export function normalizePlace(x) {
  if (!x || typeof x !== "object") return null;
  const type = Array.isArray(x.type) ? x.type[0] : x.type;
  const types = Array.isArray(x.types) ? x.types : Array.isArray(x.type) ? x.type : [];
  const gps = x.gps_coordinates || {};
  const description = typeof x.description === "string" ? x.description : x.description && (x.description.snippet || x.description.text);
  return {
    name: String(x.title || "").trim(),
    placeId: x.place_id || null,
    dataId: x.data_id || null,
    rating: num(x.rating),
    count: num(x.reviews) ?? 0,
    category: type || types[0] || null,
    address: x.address || null,
    lat: num(gps.latitude),
    lng: num(gps.longitude),
    phone: x.phone || null,
    website: x.website || null,
    position: num(x.position),
    // The five profile basics a homeowner can see at a glance
    basics: {
      hours: Boolean(x.operating_hours || x.hours || x.open_state),
      website: Boolean(x.website),
      phone: Boolean(x.phone),
      description: Boolean(description),
      photos: Boolean(x.thumbnail || x.photos_link || (Array.isArray(x.images) && x.images.length) || x.photos_count)
    }
  };
}

export async function placeLookup(key, placeId, counter) {
  const data = await serp(key, { engine: "google_maps", place_id: placeId }, counter);
  if (data.empty) return null;
  return normalizePlace(data.place_results || (Array.isArray(data.local_results) ? data.local_results[0] : null));
}

// The first 20 listings for a search: near the business's own map pin when it has one, by town name when it doesn't
export async function mapSearch(key, { q, lat, lng, where }, counter) {
  const params = { engine: "google_maps", type: "search", q };
  if (lat !== null && lat !== undefined && lng !== null && lng !== undefined) params.ll = `@${lat},${lng},13z`;
  else if (where) params.q = `${q} near ${where}`;
  const data = await serp(key, params, counter);
  if (data.empty) return [];
  if (Array.isArray(data.local_results)) return data.local_results.map(normalizePlace).filter((p) => p && p.name);
  if (data.place_results) return [normalizePlace({ ...data.place_results, position: 1 })];
  return [];
}

const firstName = (name) => {
  const n = String(name || "").trim().split(/\s+/)[0] || "";
  return /^[A-Za-z][A-Za-z'.-]{0,30}$/.test(n) ? n.replace(/\.$/, "") : "";
};

export function normalizeReview(r) {
  if (!r || typeof r !== "object") return null;
  const text = (r.extracted_snippet && (r.extracted_snippet.original || r.extracted_snippet.translated)) || r.snippet || "";
  const resp = r.response || null;
  const replied = Boolean(resp && (resp.snippet || resp.iso_date || resp.date || (resp.extracted_snippet && resp.extracted_snippet.original)));
  return {
    id: String(r.review_id || r.link || `${r.iso_date || r.date}-${(r.user && r.user.name) || ""}`).slice(0, 300),
    rating: num(r.rating),
    iso: r.iso_date || null,
    date: r.date || null,
    text: String(text).trim(),
    replied,
    author: firstName(r.user && r.user.name),
    link: r.link || null
  };
}

// Newest first, page by page: 8 on the first page (SerpApi's fixed first page), then 20 a page. Stops once the
// reviews reach back past `days` and at least `atLeast` are in hand, or after `maxPages`.
export async function fetchReviews(key, { placeId, dataId }, { maxPages = 3, days = 90, atLeast = 30, now = Date.now() } = {}, counter) {
  const id = dataId ? { data_id: dataId } : { place_id: placeId };
  const out = [];
  let token = null, pages = 0, more = false, info = null;
  const cutoff = now - days * 86400000;
  do {
    const params = { engine: "google_maps_reviews", ...id, sort_by: "newestFirst", ...(token ? { next_page_token: token, num: 20 } : {}) };
    const data = await serp(key, params, counter);
    pages += 1;
    if (data.empty) break;
    if (!info && data.place_info) info = { rating: num(data.place_info.rating), count: num(data.place_info.reviews), name: data.place_info.title || null };
    for (const r of data.reviews || []) { const n = normalizeReview(r); if (n) out.push(n); }
    token = (data.serpapi_pagination && data.serpapi_pagination.next_page_token) || (data.pagination && data.pagination.next_page_token) || null;
    more = Boolean(token);
    const oldest = out.length ? Date.parse(out[out.length - 1].iso || "") : NaN;
    if (out.length >= atLeast && Number.isFinite(oldest) && oldest < cutoff) break;
  } while (token && pages < maxPages);
  return { reviews: out, pages, more, info };
}
