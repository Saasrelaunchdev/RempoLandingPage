// Shaping saved data: defaults, the slug, and the 3D review stack, which is always built from the numbers by the same
// rule so every case study's scene reads the same way (one column before, one after, the new reviews in blue).

export function slugify(s) {
  return String(s || "").toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "")
    .replace(/&/g, " ").replace(/\b(llc|inc|ltd|co|corp)\b\.?/g, " ").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60) || "case-study";
}
export function uniqueSlug(base, taken) {
  let s = base, n = 2;
  while (taken.includes(s)) s = `${base}-${n++}`;
  return s;
}

const int = (v) => { if (v === null || v === undefined || v === "") return null; const n = Math.round(Number(v)); return Number.isFinite(n) && n >= 0 ? n : null; };

// numbers: { before, after, gained, pill, beforeCaption, afterCaption }
export function buildScene(numbers) {
  const before = int(numbers.before), after = int(numbers.after);
  let gained = int(numbers.gained);
  if (after === null) return null;
  const old = before ?? Math.max(0, after - (gained ?? 0));
  if (gained === null || old + gained > after) gained = Math.max(0, after - old);
  const later = Math.max(0, after - old - gained);
  const unit = Math.min(6, Math.max(1, Math.round((214 / Math.max(1, after)) * 10) / 10));
  const pill = numbers.pill || `+${gained}`;
  const segs = [{ n: old, k: "old" }, { n: gained, k: "new", pill }];
  if (later) segs.push({ n: later, k: "later" });
  const cols = [];
  if (before !== null) cols.push({ num: String(before), cap: numbers.beforeCaption || "Before Rempo", segs: [{ n: before, k: "old" }] });
  cols.push({ num: String(after), cap: numbers.afterCaption || "With Rempo", rq: true, segs: segs.filter((s) => s.n > 0 || s.k === "new") });
  return { unit, cols };
}

const s = (v) => (typeof v === "string" ? v.trim() : v);
export function normalizeCase(d) {
  const data = structuredClone(d || {});
  const b = (data.business ||= {});
  b.short = s(b.short) || s(b.name);
  b.nick = s(b.nick) || b.short;
  b.country = b.country || "US";
  data.card ||= {};
  data.card.title = s(data.card.title) || (data.hero && data.hero.h1);
  if (data.numbers) {
    const scene = buildScene(data.numbers);
    if (scene) data.scene = scene;
  }
  data.testimonialId = data.testimonialId || null;
  return data;
}

export function normalizeVideo(d) {
  const data = structuredClone(d || {});
  data.lang = data.lang || "en";
  data.caseStudy = data.caseStudy || null;
  return data;
}
