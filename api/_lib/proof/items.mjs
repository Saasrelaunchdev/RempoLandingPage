// The content's items: adding or changing one (its checks decide whether it may publish), linking a case study to its
// owner's video, and how the admin lists them. Used by api/admin.mjs (edits) and the upload pipelines (new items).
import { randomUUID } from "node:crypto";
import { checkCase, checkVideo, textsOf } from "./checks.mjs";
import { normalizeCase, normalizeVideo, slugify, uniqueSlug } from "./model.mjs";
import { StoreError } from "./store.mjs";

export const now = () => new Date().toISOString();

export const summary = (i) => ({
  id: i.id, kind: i.kind, status: i.status, sort: i.sort, createdAt: i.createdAt, updatedAt: i.updatedAt, publishedAt: i.publishedAt || null,
  title: i.kind === "case" ? i.data.hero && i.data.hero.h1 : i.data.name,
  subtitle: i.kind === "case" ? [i.data.business && i.data.business.short, i.data.business && i.data.business.city].filter(Boolean).join(" · ") : i.data.role,
  thumb: i.kind === "case" ? (i.data.gbp && i.data.gbp.photo) || "" : i.data.poster || "",
  url: i.kind === "case" ? `/case-studies/${i.data.slug}/` : "/#testimonials",
  checks: i.checks || { ok: true, issues: [] }, data: i.data, seed: Boolean(i.source && i.source.seed),
  notes: (i.source && i.source.notes) || [], model: (i.source && i.source.model) || null,
  numbersFromPictures: (i.source && i.source.pictureNumbers) || []
});

// "Junkaway & Movers LLC" and "junkaway and movers" are the same business
export const businessKey = (s) => String(s || "").toLowerCase().replace(/&/g, " and ").replace(/\b(llc|inc|ltd|co|corp|company|the)\b\.?/g, " ").replace(/[^a-z0-9]+/g, " ").trim();
export const sameBusiness = (a, b) => {
  const x = businessKey(a), y = businessKey(b);
  return Boolean(x && y) && (x === y || (x.length > 5 && y.includes(x)) || (y.length > 5 && x.includes(y)));
};

export function runChecks(content, item) {
  const src = item.source || {};
  if (item.kind === "case") {
    const slugs = content.items.filter((i) => i.kind === "case" && i.id !== item.id).map((i) => i.data.slug);
    const res = checkCase(item.data, { sourceText: src.text || "", sourceNumbers: src.numbers || [], existingSlugs: slugs, unverified: Boolean(src.unverified) });
    const twin = content.items.find((i) => i.kind === "case" && i.id !== item.id && sameBusiness(i.data.business && i.data.business.name, item.data.business && item.data.business.name));
    if (twin && src.ingested) res.issues.push({ level: "warn", code: "twin", field: "business.name", message: `There is already a case study for ${twin.data.business.short || twin.data.business.name} (/case-studies/${twin.data.slug}/).` });
    return res;
  }
  const linked = item.data.caseStudy ? content.items.find((i) => i.kind === "case" && i.data.slug === item.data.caseStudy) : null;
  const known = [item.data.transcript, src.hintsText, linked ? textsOf(linked.data).map((t) => t.text).join("\n") : ""].filter(Boolean).join("\n");
  const res = checkVideo(item.data, { transcript: item.data.transcript, sourceText: src.ingested ? known : "" });
  const twin = item.data.name && content.items.find((i) => i.kind === "video" && i.id !== item.id && String(i.data.name).toLowerCase() === String(item.data.name).toLowerCase());
  if (twin && src.ingested) res.issues.push({ level: "warn", code: "twin", field: "name", message: `There is already a video from ${twin.data.name}.` });
  return res;
}

// Add an item or change one. body: { id?, kind: "case"|"video", data, publish: true|false|"auto", force?, source? }
// publish "auto" follows the auto-publish setting; nothing publishes with failing checks unless forced.
export function upsertItem(content, body) {
  const kind = body.kind === "video" ? "video" : "case";
  if (!body.data || typeof body.data !== "object") throw new StoreError("data is required", 400, "invalid");
  let item = body.id ? content.items.find((i) => i.id === body.id) : null;
  if (body.id && !item) throw new StoreError("That item no longer exists.", 404, "not-found");
  const data = kind === "case" ? normalizeCase(body.data) : normalizeVideo(body.data);
  if (kind === "case") {
    const taken = content.items.filter((i) => i.kind === "case" && i !== item).map((i) => i.data.slug);
    if (!data.slug) data.slug = uniqueSlug(slugify(data.business && (data.business.short || data.business.name)), taken);
  } else if (!data.id) {
    const taken = content.items.filter((i) => i.kind === "video" && i !== item).map((i) => i.data.id);
    data.id = uniqueSlug(slugify(data.name || "video"), taken);
  }
  if (!item) {
    const sorts = content.items.filter((i) => i.kind === kind).map((i) => i.sort || 0);
    item = { id: `${kind === "case" ? "cs" : "vt"}-${randomUUID().slice(0, 8)}`, kind, status: "draft", sort: (sorts.length ? Math.max(...sorts) : 0) + 10, createdAt: now(), source: {} };
    content.items.push(item);
  }
  if (body.source && typeof body.source === "object") item.source = { ...(item.source || {}), ...body.source, seed: false };
  item.data = data;
  item.checks = runChecks(content, item);
  item.updatedAt = now();
  const auto = (content.settings || {}).autoPublish !== false;
  // a second case study for the same business, or a second video from the same person, waits for the admin
  const blockedByWarn = body.publish === "auto" && item.checks.issues.some((i) => i.code === "twin");
  const wantPublish = body.publish === true || (body.publish === "auto" && auto && !blockedByWarn);
  if (wantPublish && (item.checks.ok || body.force === true)) { item.status = "published"; item.publishedAt = now(); }
  else if (body.publish === false) item.status = "draft";
  // a published item edited into a failing state goes back to draft rather than showing broken copy
  if (item.status === "published" && !item.checks.ok && body.force !== true) item.status = "draft";
  return item;
}

// A case study and its owner's video point at each other, unless either already points somewhere else
export function linkPair(content, caseItem, videoItem) {
  if (!caseItem || !videoItem) return false;
  let changed = false;
  if (!caseItem.data.testimonialId) { caseItem.data.testimonialId = videoItem.data.id; changed = true; }
  if (!videoItem.data.caseStudy) { videoItem.data.caseStudy = caseItem.data.slug; changed = true; }
  if (changed) { caseItem.checks = runChecks(content, caseItem); videoItem.checks = runChecks(content, videoItem); }
  return changed;
}

// What Claude is told is already on the site
export function knownOf(content) {
  return {
    cases: content.items.filter((i) => i.kind === "case").map((i) => ({ slug: i.data.slug, name: i.data.business.name, city: i.data.business.city, owner: i.data.business.owner || "" })),
    videos: content.items.filter((i) => i.kind === "video").map((i) => ({ id: i.data.id, name: i.data.name, role: i.data.role, business: i.data.business || "" }))
  };
}
