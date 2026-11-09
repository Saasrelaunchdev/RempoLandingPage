#!/usr/bin/env node
/**
 * The legal pages and where the site points to them.
 *
 *   node legal-src/tests/check-legal.mjs
 *
 * Static: ../../legal/ is exactly what the sources build; every document keeps the clauses the law or a platform
 * requires (so an edit can't drop one by accident); the consent version agrees everywhere; the master page links every
 * legal page and puts the notice at collection by both forms; Vercel serves /legal, the short addresses redirect, and
 * the sources stay out of the deployment.
 * In a browser (when Playwright is installed): every legal page loads with one h1, no script errors, nothing wider
 * than a phone, and every /legal link and anchor resolves; the master page's call form shows its notice in step 2 and
 * both forms send the consent version.
 */
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { createServer } from "node:http";
import { readFileSync, existsSync, statSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";

const SRC = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const REPO = path.dirname(SRC);
let pass = 0, fail = 0;
const ok = (name, cond, info = "") => { if (cond) { pass++; console.log(`ok   ${name}`); } else { fail++; console.log(`FAIL ${name}${info ? `: ${info}` : ""}`); } };
const read = (p) => readFileSync(path.join(REPO, p), "utf8");
const S = (await import(pathToFileURL(path.join(SRC, "settings.mjs")).href)).default;
const META = (await import(pathToFileURL(path.join(REPO, "meta", "content", "site.mjs")).href)).default;

/* ---------- Fresh ---------- */
let out = "", fresh = true;
try { out = execFileSync(process.execPath, [path.join(SRC, "tools", "build.mjs"), "--check"], { encoding: "utf8", stdio: "pipe" }); } catch (e) { fresh = false; out = String(e.stdout || "") + String(e.stderr || ""); }
ok("legal/ is what the sources build", fresh, out.trim());

/* ---------- Every document keeps what the law or a platform requires ---------- */
const SLUGS = ["terms", "privacy", "cookies", "privacy-choices", "sms", "acceptable-use", "dpa", "baa", "subprocessors", "billing", "accessibility"];
const page = (slug) => { const f = path.join(REPO, "legal", slug, "index.html"); return existsSync(f) ? readFileSync(f, "utf8") : ""; };
const text = (html) => html.replace(/<style>[\s\S]*?<\/style>|<script[\s\S]*?<\/script>|<svg[\s\S]*?<\/svg>/g, " ").replace(/<[^>]+>/g, " ").replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, "&").replace(/\s+/g, " ");
for (const slug of SLUGS) {
  const html = page(slug);
  ok(`/legal/${slug}: built, with one h1 and its last-updated date`, html && (html.match(/<h1/g) || []).length === 1 && html.includes("Last updated "));
  ok(`/legal/${slug}: no placeholder left`, html && !/\{\{|\}\}/.test(html));
}
ok("/legal: the legal center lists every document", SLUGS.every((s) => page("").includes(`href="/legal/${s}"`) || read("legal/index.html").includes(`href="/legal/${s}"`)));
const MUST = {
  terms: [
    ["business use only", /for businesses and professionals, not for personal, family, or household use/],
    ["no guaranteed results", /We don't guarantee\*?\*? any number of reviews/],
    ["client's consent duty (TCPA, CAN-SPAM)", /Telephone Consumer Protection Act, the CAN-SPAM Act/],
    ["texts only in daytime hours", /between 9 a\.m\. and 8 p\.m\./],
    ["BAA before patient data", /don't send us protected health information until our Business Associate Agreement/],
    ["AI receptionist disclosure and recording consent", /told they are speaking with an automated assistant[\s\S]*consent of everyone on the call/],
    ["automatic renewal stated", /renew automatically at the end of each billing period/],
    ["cancel at any time, online or by email", /You can cancel at any time/],
    ["warranty disclaimer in capitals", /AS IS" AND "AS AVAILABLE/],
    ["limitation of liability with California's carve-out", /California Civil Code section 1668/],
    ["individual arbitration, AAA, San Diego County", /American Arbitration Association[\s\S]*seated in San Diego County, California/],
    ["no class actions", /No class or representative actions/],
    ["California law and San Diego courts", /California law governs these Terms[\s\S]*San Diego County, California, have exclusive jurisdiction/]
  ],
  privacy: [
    ["notice at collection (CCPA) and CalOPPA", /notice at collection under the California Consumer Privacy Act[\s\S]*California Online Privacy Protection Act/],
    ["categories collected, with sources", /Category Examples Where it comes from/],
    ["sold or shared, and to whom", /We don't sell personal information for money/],
    ["the 10DLC statement on mobile numbers", /do not sell, rent, or share your mobile phone number or your text messaging opt-in consent with any third party/],
    ["Global Privacy Control honored", /treat a Global Privacy Control signal from your browser as a valid opt-out/],
    ["Do Not Track response (CalOPPA)", /Do Not Track\.? Browsers' "Do Not Track" setting/],
    ["third-party tracking over time (CalOPPA)", /over time and across different websites/],
    ["the California rights", /know and access[\s\S]*delete[\s\S]*correct[\s\S]*opt out of the sale or sharing[\s\S]*not be discriminated against/],
    ["response time and verification", /respond within 45 days/],
    ["authorized agents", /authorized agent/],
    ["notice of financial incentive", /Notice of financial incentive[\s\S]*good-faith estimate of the value/],
    ["retention periods", /How long we keep information/],
    ["children", /under 16/],
    ["how changes are announced (CalOPPA)", /new "Last updated" date/]
  ],
  cookies: [
    ["the pixel only after Allow", /only after you choose "Allow,?"/],
    ["Meta's required explanation", /third parties, including Meta, may use cookies, web beacons, and other storage technologies/],
    ["how to opt out of ad targeting", /aboutads\.info\/choices[\s\S]*optout\.networkadvertising\.org/],
    ["never the phone number to Meta", /We never send your phone number/]
  ],
  "privacy-choices": [
    ["the statutory link title", /Do Not Sell or Share My Personal Information/],
    ["the GPC status message (CCPA regulations 7025)", /Opt-Out Request Honored/],
    ["an opt-out for data already held", /Do Not Sell or Share" and the email address or phone number/]
  ],
  sms: [
    ["STOP and HELP", /Reply STOP to any text to opt out\. Reply HELP for help\./],
    ["rates", /Message and data rates may apply/],
    ["frequency", /up to 3 texts per booking/],
    ["carriers not liable", /Carriers are not liable for delayed or undelivered messages/],
    ["not a condition of purchase", /never a condition of buying anything/],
    ["model consent wording for clients", /Model consent wording for your forms/]
  ],
  "acceptable-use": [
    ["no review gating", /review gating/],
    ["no incentives", /No incentives/],
    ["the FTC rule", /16 C\.F\.R\. Part 465/],
    ["Consumer Review Fairness Act and Civil Code 1670.8", /Consumer Review Fairness Act and California Civil Code section 1670\.8/]
  ],
  dpa: [
    ["service provider: no sale or sharing", /will not sell or share it/],
    ["specified business purposes", /specific business purposes/],
    ["no combining", /will not combine it with personal information/],
    ["notice within 5 business days", /no later than 5 business days/],
    ["right to stop and remediate", /stop and fix any unauthorized use/],
    ["certification", /certify that we understand/],
    ["breach notice per Civil Code 1798.82(b)", /California Civil Code section 1798\.82\(b\)/],
    ["subcontractors bound in writing", /bind each Subprocessor by written contract/]
  ],
  baa: [
    ["permitted uses (164.504(e))", /164\.504\(e\)\(4\)/],
    ["breach reports (164.410)", /164\.410/],
    ["safeguards under Subpart C", /comply with Subpart C of 45 C\.F\.R\. Part 164/],
    ["subcontractors (164.502(e)(1)(ii))", /164\.502\(e\)\(1\)\(ii\)/],
    ["access, amendment, accounting", /164\.524[\s\S]*164\.526[\s\S]*164\.528/],
    ["books and records to the Secretary", /available to the Secretary/],
    ["return or destruction", /return to Covered Entity or destroy all PHI/],
    ["termination for material breach", /violated a material term/]
  ],
  billing: [
    ["price shown before paying", /Before you pay, checkout shows the full price/],
    ["cancel online", /cancel at any time, without calling us/],
    ["one save offer, never obstruction", /We never make you talk to us, wait, or jump through extra steps to cancel/],
    ["annual renewal reminder", /between 15 and 45 days before each renewal/]
  ],
  accessibility: [["WCAG 2.2 AA", /WCAG\) 2\.2 at level AA/], ["a way to report barriers", /Tell us about any barrier/]]
};
for (const [slug, rules] of Object.entries(MUST)) {
  const t = text(page(slug));
  for (const [what, re] of rules) ok(`/legal/${slug}: ${what}`, re.test(t));
}

/* ---------- One consent version everywhere ---------- */
const master = read("index.html");
const masterVersions = [...master.matchAll(/data\.noticeVersion = "([\d-]+)"/g)].map((m) => m[1]);
ok("the consent version agrees: legal-src, the Meta page, both master forms", S.noticeVersion === META.noticeVersion && masterVersions.length === 2 && masterVersions.every((v) => v === S.noticeVersion), `${S.noticeVersion} / ${META.noticeVersion} / ${masterVersions.join(",")}`);
ok("the Meta page's legal links are the built pages", Object.values(META.legal).every((u) => existsSync(path.join(REPO, u, "index.html"))));

/* ---------- The master page ---------- */
ok("master: no {TBD} privacy placeholder left in the footer", !master.includes("{TBD · privacy notice}"));
ok("master: the footer links every public legal page", ["/legal/terms", "/legal/privacy", "/legal/cookies", "/legal/sms", "/legal/accessibility", "/legal/privacy-choices", "/legal"].every((h) => master.includes(`href="${h}"`)));
ok("master: the statutory opt-out link title in the footer", master.includes(">Do Not Sell or Share My Personal Information</a>"));
ok("master: the notice at collection names each form's button", master.includes("By tapping Get my scorecard, you agree to our") && master.includes("By tapping Book my call, you agree to our"));
ok("master: consent is given to Rempo, for this number", master.includes("Rempo may call me at this number about my request"));
ok("master: the page's settings point at the policies", master.includes('"privacyUrl":"/legal/privacy","termsUrl":"/legal/terms"'));

/* ---------- Vercel ---------- */
const vercel = JSON.parse(read("vercel.json"));
const rw = (src) => (vercel.rewrites || []).find((r) => r.source === src);
ok("vercel.json: /legal and its pages resolve to their index.html", rw("/legal") && rw("/legal").destination === "/legal/index.html" && rw("/legal/:page") && rw("/legal/:page").destination === "/legal/:page/index.html");
const rd = (src) => (vercel.redirects || []).find((r) => r.source === src);
ok("vercel.json: /privacy, /terms, /sms-terms and /do-not-sell lead to the pages", rd("/privacy").destination === "/legal/privacy" && rd("/terms").destination === "/legal/terms" && rd("/sms-terms").destination === "/legal/sms" && rd("/do-not-sell").destination === "/legal/privacy-choices");
ok("vercel.json: /legal/assets cached for a year", (vercel.headers || []).some((h) => h.source === "/legal/assets/(.*)" && JSON.stringify(h.headers).includes("immutable")));
ok(".vercelignore: the sources stay out of the deployment, the pages go in", /^legal-src\/$/m.test(read(".vercelignore")) && !/^legal\/$/m.test(read(".vercelignore")));

/* ---------- In a browser ---------- */
let playwright = null;
try { playwright = createRequire(import.meta.url)("playwright"); } catch { console.log("skip the browser checks: Playwright is not installed"); }
if (playwright) {
  const TYPES = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".svg": "image/svg+xml", ".woff2": "font/woff2", ".webp": "image/webp", ".jpg": "image/jpeg", ".png": "image/png" };
  const posts = [];
  const server = createServer(async (req, res) => {
    const url = new URL(req.url, "http://x");
    if (url.pathname === "/api/lead") {
      let b = ""; for await (const c of req) b += c;
      posts.push(JSON.parse(b || "{}"));
      res.writeHead(200, { "content-type": "application/json" }); return res.end('{"ok":true}');
    }
    let f = path.normalize(path.join(REPO, decodeURIComponent(url.pathname)));
    if (!f.startsWith(REPO) || /legal-src|\.git/.test(f)) { res.writeHead(404); return res.end(); }
    try { if (statSync(f).isDirectory()) f = path.join(f, "index.html"); } catch { res.writeHead(404); return res.end(); }
    try { const body = await readFile(f); res.writeHead(200, { "content-type": TYPES[path.extname(f)] || "application/octet-stream" }); res.end(body); } catch { res.writeHead(404); res.end(); }
  });
  await new Promise((r) => server.listen(0, r));
  const BASE = `http://localhost:${server.address().port}`;
  const browser = await playwright.chromium.launch();
  try {
    for (const [w, h, label] of [[390, 844, "phone"], [1440, 900, "pc"]]) {
      const ctx = await browser.newContext({ viewport: { width: w, height: h } });
      const pg = await ctx.newPage();
      const errors = [];
      pg.on("pageerror", (e) => errors.push(e.message));
      pg.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
      const bad = [];
      for (const slug of ["", ...SLUGS]) {
        await pg.goto(`${BASE}/legal/${slug}`, { waitUntil: "load" });
        const r = await pg.evaluate(() => ({
          h1: document.querySelectorAll("h1").length,
          wide: document.documentElement.scrollWidth > window.innerWidth + 1,
          links: [...document.querySelectorAll('a[href^="/legal"], a[href^="#"]')].map((a) => a.getAttribute("href")),
          ids: [...document.querySelectorAll("[id]")].map((e) => e.id)
        }));
        if (r.h1 !== 1) bad.push(`${slug}: ${r.h1} h1`);
        if (r.wide) bad.push(`${slug}: wider than the screen`);
        for (const href of new Set(r.links)) {
          const [p, frag] = href.startsWith("#") ? [`/legal/${slug}`.replace(/\/$/, ""), href.slice(1)] : href.split("#");
          const res = await fetch(`${BASE}${p}`);
          if (res.status !== 200) { bad.push(`${slug}: ${href} is ${res.status}`); continue; }
          if (frag && !(await res.text()).includes(`id="${frag}"`)) bad.push(`${slug}: ${href} has no such section`);
        }
      }
      ok(`${label}: every legal page has one h1, fits the screen, and every /legal link and anchor resolves`, bad.length === 0, bad.join("; "));
      ok(`${label}: no script errors on the legal pages`, errors.length === 0, errors.join(" | "));
      await ctx.close();
    }
    // The master page: the call form's notice in step 2, and both forms send the consent version
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    const pg = await ctx.newPage();
    await pg.goto(`${BASE}/`, { waitUntil: "load" });
    await pg.waitForTimeout(3300);
    await pg.locator("#s-company").scrollIntoViewIfNeeded();
    await pg.locator('#score-form input[name="trade"][value="HVAC"]').check({ force: true });
    await pg.fill("#s-company", "Maple Street Plumbing");
    await pg.fill("#s-city", "Springfield");
    await pg.fill("#s-name", "Tom");
    await pg.fill("#s-email", "tom@maplestreet.com");
    await pg.locator("#s-consent").check({ force: true });
    await pg.locator('#score-form button[type="submit"]').click();
    await pg.waitForSelector("#s-sent:not([hidden])", { timeout: 5000 });
    ok("master scorecard: the lead carries the consent version", posts.some((p) => p.form === "scorecard" && p.noticeVersion === S.noticeVersion), JSON.stringify(posts.map((p) => [p.form, p.noticeVersion])));
    await pg.locator("#form").scrollIntoViewIfNeeded();
    for (const [name, value] of [["trade", "Plumbing"], ["techs", "4 to 9"], ["locations", "1"]]) await pg.locator(`#form input[name="${name}"][value="${value}"]`).check({ force: true });
    await pg.locator("#f-next").click();
    const step2 = pg.locator('#form [data-fstep="2"]');
    ok("master call form: step 2 shows the notice above its button, with both links", (await step2.locator(".legal-note").isVisible()) && (await step2.locator('.legal-note a[href="/legal/terms"]').count()) === 1 && (await step2.locator('.legal-note a[href="/legal/privacy"]').count()) === 1);
    ok("master call form: the consent boxes start unticked", !(await pg.locator("#l-cphone").isChecked()) && !(await pg.locator("#l-cemail").isChecked()));
    await pg.fill("#l-name", "Tom");
    await pg.fill("#l-company", "Maple Street Plumbing");
    await pg.fill("#l-phone", "5125550134");
    await pg.fill("#l-city", "Springfield");
    await pg.locator("#l-cphone").check({ force: true });
    await pg.locator('#form button[type="submit"]').click();
    await pg.waitForSelector("#sent:not([hidden])", { timeout: 5000 });
    ok("master call form: the lead carries the consent version and the call consent", posts.some((p) => p.form === "book-call" && p.noticeVersion === S.noticeVersion && p.consentPhone === true));
    await ctx.close();
  } finally {
    await browser.close();
    server.close();
  }
}

console.log(`check-legal: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
