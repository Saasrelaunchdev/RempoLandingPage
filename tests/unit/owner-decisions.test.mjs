// The owner's decisions, pinned. Each test is one change the owner asked for and approved (see "Owner decisions" in
// CLAUDE.md). A later update must not undo any of them unless the owner explicitly asks to undo that one; in that case,
// change or remove its test in the same commit and say so in the commit message.
//
// Why this file exists: on Nov 7-8, 2026 three sessions worked on three branches started from an out-of-date main, and
// each one's preview was promoted to production on its own. The caption notes came back on the live site, and /admin
// and the case studies disappeared from it. These tests fail if a merge or an edit does that again.
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));
const read = (p) => readFileSync(ROOT + p, "utf8");
// Plain messages: on failure, say what broke without printing the whole page.
const has = (src, re, msg) => assert.ok(re.test(src), msg);
const hasNot = (src, re, msg) => assert.ok(!re.test(src), msg);

const LANDING = ["index.html", "customers/index.html", "customers/recent/index.html", "customers/replies/index.html", "customers/request/index.html"];
const CASE_STUDY_TEMPLATE = "assets/proof-render.mjs";

test("2026-11-07: no caption notes under the pictures (no \"Illustration · ...\", no \"sample ... demo data\" chips)", () => {
  for (const p of LANDING) {
    const html = read(p);
    hasNot(html, /class="proof-chip/, `${p}: a caption chip is back`);
    hasNot(html, /Illustration · /, `${p}: an "Illustration · ..." caption is back`);
    hasNot(html, /demo data/, `${p}: a "demo data" caption is back`);
  }
});

test("2026-11-07: the phone pass is in place on both landing pages (phone-only and PC-only words)", () => {
  for (const p of LANDING) {
    const html = read(p);
    has(html, /max-width:\s*599px/, `${p}: the phone layout rules are gone`);
    has(html, /class="[^"]*\bm-(only|hide)\b/, `${p}: the phone-only / PC-only words are gone`);
  }
});

test("2026-11-08: the legal pages exist and every footer links them", () => {
  for (const p of ["legal/index.html", "legal/terms/index.html", "legal/privacy/index.html", "legal/privacy-choices/index.html", "legal/sms/index.html"]) {
    assert.ok(existsSync(ROOT + p), `${p} is missing`);
  }
  for (const p of [...LANDING, CASE_STUDY_TEMPLATE]) {
    const src = read(p);
    has(src, /href="\/legal\/terms"/, `${p}: the footer lost its Terms link`);
    has(src, /href="\/legal\/privacy"/, `${p}: the footer lost its Privacy Policy link`);
    has(src, /href="\/legal\/privacy-choices"/, `${p}: the footer lost "Do Not Sell or Share My Personal Information"`);
  }
});

test("2026-11-08: the call form carries the notice at collection", () => {
  has(read("index.html"), /class="legal-note"/, "index.html: the notice above the form's button is gone");
});

test("2026-11-07/08: case studies, the video testimonial and /admin are on the landing page and deployed", () => {
  const html = read("index.html");
  has(html, /<section id="results"/, "index.html: the case studies section is gone");
  for (const p of ["admin/index.html", "api/admin.mjs", "api/admin-ingest.mjs", "api/proof.mjs", "api/case-study.mjs", "media/testimonials/german-aquino.mp4"]) {
    assert.ok(existsSync(ROOT + p), `${p} is missing`);
  }
});

test("every page area keeps its route and function in vercel.json (merging must keep both sides)", () => {
  const v = JSON.parse(read("vercel.json"));
  const fns = Object.keys(v.functions || {});
  for (const f of ["api/lead.mjs", "api/meta-lead.mjs", "api/admin.mjs", "api/admin-ingest.mjs", "api/proof.mjs", "api/case-study.mjs"]) {
    assert.ok(fns.includes(f), `vercel.json: the function ${f} is gone`);
  }
  const rewrites = (v.rewrites || []).map((r) => r.source);
  for (const s of ["/customers", "/customers/:page", "/legal", "/legal/:page", "/case-studies/:slug", "/admin"]) {
    assert.ok(rewrites.includes(s), `vercel.json: the rewrite for ${s} is gone`);
  }
  assert.ok(existsSync(ROOT + "customers/index.html"), "customers/ (the Meta ads page) is missing");
});

test("2026-11-10: the self-serve checkout at /start hands every buyer to GoHighLevel, with the onboarding link at once", () => {
  for (const p of ["start/index.html", "start/welcome/index.html", "start/start.css", "start/start.mjs", "start/welcome.mjs", "api/checkout.mjs",
    "api/stripe-webhook.mjs", "checkout/checkout.sql", "checkout/README.md"]) {
    assert.ok(existsSync(ROOT + p), `${p} is missing`);
  }
  for (const p of ["start/index.html", "start/welcome/index.html"]) {
    const src = read(p);
    has(src, /href="\/legal\/terms"/, `${p}: the footer lost its Terms link`);
    has(src, /href="\/legal\/privacy"/, `${p}: the footer lost its Privacy Policy link`);
    has(src, /href="\/legal\/privacy-choices"/, `${p}: the footer lost "Do Not Sell or Share My Personal Information"`);
  }
  const page = read("start/index.html");
  has(page, /class="legal-note"/, "start/index.html: the notice at collection above the pay button is gone");
  has(page, /name="consentEmail"/, "start/index.html: the email consent box is gone");
  has(page, /name="consentPhone"/, "start/index.html: the text consent box is gone");
  has(read("start/start.css"), /max-width:\s*599px/, "start/start.css: the phone layout rules are gone");
  has(read("start/welcome/index.html"), /data-onboarding/, "the thank-you page no longer shows the onboarding link");
  const hook = read("api/stripe-webhook.mjs");
  has(hook, /verifySignature\(/, "api/stripe-webhook.mjs no longer checks Stripe's signature");
  has(hook, /handOffPurchase\(/, "api/stripe-webhook.mjs no longer hands the buyer to GoHighLevel");
  const v = JSON.parse(read("vercel.json"));
  for (const f of ["api/checkout.mjs", "api/stripe-webhook.mjs"]) assert.ok(Object.keys(v.functions || {}).includes(f), `vercel.json: the function ${f} is gone`);
  const rewrites = (v.rewrites || []).map((r) => r.source);
  for (const s of ["/start", "/start/welcome"]) assert.ok(rewrites.includes(s), `vercel.json: the rewrite for ${s} is gone`);
});

test("2026-11-12: the Meta ads page (/customers) shows the real case studies and German Aquino's video testimonial", () => {
  for (const p of LANDING.filter((x) => x.startsWith("customers/"))) {
    const html = read(p);
    has(html, /<section id="results"/, `${p}: the case studies section is gone`);
    has(html, /href="\/case-studies\/junkaway-movers\/"/, `${p}: the Junkaway & Movers case study is gone`);
    has(html, /href="\/case-studies\/ranchero-plumbing\/"/, `${p}: the Ranchero Plumbing case study is gone`);
    has(html, /<section id="testimonials"[\s\S]*german-aquino\.mp4/, `${p}: German Aquino's video testimonial is gone`);
  }
});
