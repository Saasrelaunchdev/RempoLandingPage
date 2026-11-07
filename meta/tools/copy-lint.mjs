#!/usr/bin/env node
// The claim rules, applied to every word the visitor can read: content/copy.json, content/variants.json and the
// survey's words in content/survey.mjs. The build runs it and stops on an error; run it alone with
//   node tools/copy-lint.mjs            (errors and warnings)
//
// Errors: a banned claim (rules/copy-rules.json, from the GTM), an em or en dash, a statistic without its source in
// the same sentence. Warnings: a sentence or a headline over its word budget.
import { readFileSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const read = (p) => JSON.parse(readFileSync(path.join(ROOT, p), "utf8"));

const NEGATION = /\b(no|not|never|don't|doesn't|won't|isn't|aren't|can't|cannot|without|nor|none)\b|n't\b/i;
const SOURCED = /\((BrightLocal|ACHR News|Census|IBISWorld|Roofing Contractor)[^)]*\d{4}\)/;

/** Every visitor-facing string, with a key path. Notes (keys starting with _) and machine values are skipped. */
export function collect(copy, variants, survey, emails) {
  const out = [];
  const SKIP = new Set(["img", "allow", "id", "slug", "scene", "v", "name", "type", "autocomplete", "inputmode", "prefix", "key", "kind", "form", "callForm", "layout", "qualifiedFit"]);
  // allow (on an FAQ item) waives the claim rules for its question only; _demo marks labelled demo data, where the
  // statistic-source check does not apply
  const walk = (v, key, allow, demo) => {
    if (typeof v === "string") { out.push({ key, text: v, allow, demo }); return; }
    if (Array.isArray(v)) { v.forEach((x, i) => walk(x, `${key}.${i}`, allow, demo)); return; }
    if (v && typeof v === "object") {
      const a = typeof v.allow === "string" ? v.allow : allow;
      const d = demo || typeof v._demo === "string";
      for (const [k, x] of Object.entries(v)) {
        if (k.startsWith("_") || SKIP.has(k)) continue;
        walk(x, key ? `${key}.${k}` : k, k === "q" ? a : allow, d);
      }
    }
  };
  walk(copy, "copy", null);
  for (const v of variants.variants) {
    walk({ hook: v.hook, h1: v.h1, lead: v.lead, leadShort: v.leadShort }, `variants.${v.id}`, null);
  }
  const s = { steps: survey.steps, tiers: survey.tiers, ruleLine: survey.ruleLine, gaps: survey.gaps, callOnlyWhy: survey.callOnlyWhy, booking: survey.booking };
  walk(s, "survey", null);
  if (emails) walk(emails, "emails", null);
  return out;
}

const sentences = (t) => t.split(/(?<=[.!?])\s+/).filter(Boolean);
const words = (t) => t.replace(/\{[^}]+\}/g, "x").split(/\s+/).filter(Boolean).length;

/** Lints the strings: { errors: [...], warnings: [...] } as "key: message: text". */
export function lint(strings, rules) {
  const errors = [], warnings = [];
  const B = rules.budgets || {};
  const allowKeys = new Map((rules.allow || []).map((a) => [a.key, a]));
  for (const { key, text, allow, demo } of strings) {
    if (/[\u2013\u2014]/.test(text)) errors.push(`${key}: no em or en dashes: ${text}`);
    if (/\{TBD/.test(text)) continue;   // preview-only notes
    for (const r of rules.rules) {
      const re = new RegExp(r.re, "i");
      for (const s of sentences(text)) {
        if (!re.test(s)) continue;
        if (allow || allowKeys.has(key)) continue;
        if (r.refusalOk && NEGATION.test(s)) continue;
        errors.push(`${key}: ${r.msg} (${r.id}): ${s}`);
      }
    }
    for (const s of sentences(text)) {
      if (!demo && /\d+%/.test(s) && !SOURCED.test(s)) errors.push(`${key}: a statistic needs its source in the same sentence: ${s}`);
      if (B.sentenceWords && words(s) > B.sentenceWords) warnings.push(`${key}: ${words(s)} words in one sentence (budget ${B.sentenceWords}): ${s}`);
    }
    if (/\.h1$/.test(key) && B.h1Words && words(text) > B.h1Words) errors.push(`${key}: headline over ${B.h1Words} words: ${text}`);
    if (/^variants\.[^.]+\.lead(Short)?$/.test(key) && B.heroLeadWords && words(text) > B.heroLeadWords) errors.push(`${key}: hero line over ${B.heroLeadWords} words: ${text}`);
    if (/\.h2$/.test(key) && B.h2Words && words(text) > B.h2Words) warnings.push(`${key}: section headline over ${B.h2Words} words: ${text}`);
    if (/^copy\.faq\..*\.a$/.test(key) && B.faqAnswerWords && words(text) > B.faqAnswerWords) warnings.push(`${key}: FAQ answer over ${B.faqAnswerWords} words: ${text}`);
  }
  return { errors, warnings };
}

/** Loads the content and lints it. */
export async function lintAll() {
  const copy = read("content/copy.json");
  const variants = read("content/variants.json");
  const rules = read("rules/copy-rules.json");
  const survey = (await import(pathToFileURL(path.join(ROOT, "content/survey.mjs")).href)).default;
  const emails = (await import(pathToFileURL(path.join(ROOT, "content/emails.mjs")).href)).default;
  return lint(collect(copy, variants, survey, emails), rules);
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const { errors, warnings } = await lintAll();
  warnings.forEach((w) => console.log(`warn  ${w}`));
  errors.forEach((e) => console.log(`ERROR ${e}`));
  console.log(`copy-lint: ${errors.length} errors, ${warnings.length} warnings`);
  process.exit(errors.length ? 1 : 0);
}
