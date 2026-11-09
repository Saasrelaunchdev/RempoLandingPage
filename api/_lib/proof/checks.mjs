// The checks every case study and video must pass before it can publish by itself: the brand's writing rules
// (GTM-BRIEF.md section 5 in the go-to-market repo) and the facts rule, every number on the page must come from what
// was uploaded. Errors keep an item a draft; warnings are shown in the admin and do not block.
import { INDUSTRY_ICONS } from "../../../assets/proof-shell.mjs";

export const BANNED = [
  "leverage", "unlock", "seamless", "robust", "streamline", "cutting-edge", "cutting edge", "empower", "24/7", "instant",
  "automatic", "autopilot", "ai employee", "hyperpersonal", "geotag", "guarantee", "rank higher", "skyrocket", "game-changer",
  "game changer", "revolutioniz", "best-in-class", "world-class", "state-of-the-art", "supercharge", "effortless"
];
const NUM_WORDS = { zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19, twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90, hundred: 100 };

// Every number a text states, in digits: "32", "five-star" -> 5, "10 to 12" -> 10 and 12, "5.0" -> 5.0. "One" on its
// own is left out: it is far more often a pronoun ("left one", "no one") than a figure.
export function numbersIn(text) {
  const out = new Set();
  const t = String(text || "").toLowerCase().replace(/,(?=\d{3}\b)/g, "");
  for (const m of t.matchAll(/\d+(?:\.\d+)?/g)) out.add(String(Number(m[0])));
  for (const m of t.matchAll(/\b([a-z]+)(?:-([a-z]+))?\b/g)) {
    const a = NUM_WORDS[m[1]], b = m[2] !== undefined ? NUM_WORDS[m[2]] : undefined;
    if (a !== undefined && b !== undefined && a >= 20 && b < 10) out.add(String(a + b));   // "twenty-five"
    else { if (a !== undefined && m[1] !== "one") out.add(String(a)); if (b !== undefined && m[2] !== "one") out.add(String(b)); }
  }
  return out;
}

// The words on the page: every string in the data except links, file paths, icons and other plumbing
const SKIP = new Set(["src", "srcWebm", "vtt", "srt", "poster", "avatar", "photo", "icon", "slug", "id", "testimonialId", "caseStudy", "ar", "x", "y", "w", "h", "k", "lang", "uploadDate", "schemaType", "regionCode", "country", "transcript"]);
export function textsOf(data, path = "", out = []) {
  if (typeof data === "string") { out.push({ path, text: data }); return out; }
  if (Array.isArray(data)) { data.forEach((v, i) => textsOf(v, `${path}[${i}]`, out)); return out; }
  if (data && typeof data === "object") for (const [k, v] of Object.entries(data)) if (!SKIP.has(k) && k !== "scene") textsOf(v, path ? `${path}.${k}` : k, out);
  return out;
}

const PRONOUN = /\b(he|she|him|his|her|hers|himself|herself)\b/i;
function voice(texts, issues) {
  for (const { path, text } of texts) {
    if (/[–—]/.test(text) || /\s-\s/.test(text)) issues.push({ level: "error", field: path, message: "Uses a dash as punctuation. Use a comma, a period or “to”." });
    const low = text.toLowerCase();
    const hit = BANNED.find((w) => low.includes(w));
    if (hit) issues.push({ level: "error", field: path, message: `Uses “${hit}”, which the brand rules ban.` });
    if (text.includes("!")) issues.push({ level: "warn", field: path, message: "Has an exclamation mark. The voice is calm." });
    // outside a quotation, people are named rather than called he or she (a name doesn't tell anyone's pronouns)
    const said = text.replace(/\u201C[^\u201C\u201D]*\u201D/g, "");
    const p = PRONOUN.exec(said);
    if (p) issues.push({ level: "warn", field: path, message: `Says “${p[1]}”. Use the person's name, “they”, or the business.` });
  }
}

// Facts: a number that is in none of the sources is invented until someone checks it
function facts(texts, known, issues, where) {
  const seen = new Map();
  for (const { path, text } of texts) for (const n of numbersIn(text)) if (!known.has(n) && !seen.has(n)) seen.set(n, path);
  for (const [n, path] of seen) issues.push({ level: "error", field: path, message: `States ${n}, which is not in ${where}.` });
}

const req = (cond, field, message, issues) => { if (!cond) issues.push({ level: "error", field, message }); };
const str = (v) => typeof v === "string" && v.trim().length > 0;

// A case study: complete, in the brand's voice, and every number traceable to the upload
export function checkCase(data, { sourceText = "", sourceNumbers = [], existingSlugs = [], unverified = false } = {}) {
  const issues = [];
  const d = data || {};
  const b = d.business || {}, h = d.hero || {}, c = d.card || {}, ch = d.chapters || {};
  req(/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(d.slug || ""), "slug", "Needs a slug made of lowercase letters, digits and hyphens.", issues);
  if (existingSlugs.includes(d.slug)) issues.push({ level: "error", field: "slug", message: `Another case study already uses /case-studies/${d.slug}/.` });
  for (const f of ["name", "short", "industry", "city", "region", "regionCode"]) req(str(b[f]), `business.${f}`, `Needs the business's ${f}.`, issues);
  if (b.icon && !INDUSTRY_ICONS.includes(b.icon)) issues.push({ level: "error", field: "business.icon", message: `Icon must be one of ${INDUSTRY_ICONS.join(", ")}.` });
  req(str(h.h1) && str(h.lead), "hero", "Needs a headline and a lead.", issues);
  req(Array.isArray(h.facts) && h.facts.length === 3 && h.facts.every((f) => str(f.big) && str(f.label)), "hero.facts", "Needs three numbers, each with a label.", issues);
  req(str(c.tag) && str(c.line) && Array.isArray(c.stats) && c.stats.length === 2, "card", "The card needs a tag, a line and two numbers.", issues);
  req(d.gbp && str(d.gbp.count), "gbp.count", "Needs the review count shown on the Google profile.", issues);
  req(d.scene && Array.isArray(d.scene.cols) && d.scene.cols.length >= 1, "scene", "Needs the review stack (scene).", issues);
  req(Array.isArray(d.glance) && d.glance.length === 4, "glance", "Needs four facts at a glance.", issues);
  for (const k of ["before", "did", "result"]) req(ch[k] && str(ch[k].h2) && str(ch[k].lead) && str(ch[k].label), `chapters.${k}`, "Each chapter needs a label, a heading and a lead.", issues);
  req(ch.before && ch.before.miss && Array.isArray(ch.before.miss.items) && ch.before.miss.items.length === 3, "chapters.before.miss", "The before chapter needs three lines (the last one is what was missing).", issues);
  req(ch.did && Array.isArray(ch.did.steps) && ch.did.steps.length === 3, "chapters.did.steps", "What Rempo did needs three steps.", issues);
  req(d.payoff && str(d.payoff.lead) && str(d.payoff.accent), "payoff", "Needs the closing line, in two parts.", issues);
  req(str(d.note) && /review/i.test(d.note), "note", "Needs the note on where the numbers come from.", issues);
  req(d.seo && str(d.seo.title) && str(d.seo.description), "seo", "Needs a page title and a description.", issues);
  const p = ch.result && ch.result.proof;
  if (p) req(Array.isArray(p.imgs) && p.imgs.length === 2 && p.imgs.every((i) => str(i.src) && str(i.alt)), "chapters.result.proof", "The before and after needs two screenshots, each described.", issues);

  const texts = textsOf(d);
  voice(texts, issues);
  // Facts: a number on the page that is nowhere in what was uploaded is invented until someone checks it
  if (unverified) issues.push({ level: "error", field: "note", message: "Part of the upload was a scan with no text of its own, so the numbers could not be checked against it. Check each one, then publish." });
  if (sourceText || sourceNumbers.length) {
    const known = new Set([...numbersIn(sourceText), ...sourceNumbers.flatMap((n) => [...numbersIn(String(n))])]);
    facts(texts, known, issues, "the uploaded document or screenshots");
    const nameWords = String(b.short || b.name || "").toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length > 2 && !["llc", "inc", "the", "and", "co"].includes(w));
    if (nameWords.length && !nameWords.some((w) => sourceText.toLowerCase().includes(w))) issues.push({ level: "error", field: "business.name", message: "The business name is not in the uploaded document." });
  }
  return { ok: !issues.some((i) => i.level === "error"), issues };
}

// A video testimonial: captions, a name, quotes taken word for word from what was said
export function checkVideo(data, { transcript, sourceText = "" } = {}) {
  const issues = [];
  const d = data || {};
  for (const f of ["name", "role", "src", "poster", "avatar", "intro", "quote"]) req(str(d[f]), f, `Needs ${f}.`, issues);
  if (!str(d.vtt)) issues.push({ level: "warn", field: "vtt", message: "Has no captions: it will play without words on screen." });
  const said = String(transcript || d.transcript || "").replace(/\s+/g, " ").toLowerCase();
  const clean = (q) => String(q || "").replace(/[“”"]/g, "").replace(/\s+/g, " ").replace(/[.,]+$/, "").toLowerCase();
  if (said) for (const f of ["quote", "quoteLong"]) if (str(d[f]) && !said.includes(clean(d[f]))) issues.push({ level: "error", field: f, message: "Is not word for word what was said in the video." });
  const copy = textsOf({ intro: d.intro, role: d.role, title: d.title, summary: d.summary });
  voice(copy, issues);
  if (sourceText) facts(copy, numbersIn(sourceText), issues, "what was said or the case study");
  return { ok: !issues.some((i) => i.level === "error"), issues };
}
