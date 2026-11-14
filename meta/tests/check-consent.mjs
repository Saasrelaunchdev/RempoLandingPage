#!/usr/bin/env node
/**
 * The cookie notice and the consent gate, in a real browser, on a copy of the site built with a Meta pixel and a
 * Clarity id set (the real site has neither yet, so it shows no notice). The copy lives in a temporary folder:
 * meta/, api/, legal/, assets/ and media/ are copied, site.mjs gets the two ids, and the copy's own build and dev server run there.
 *
 *   node tests/check-consent.mjs
 *
 * Checks: nothing loads before a choice; both choices look the same; Decline keeps everything off and is remembered;
 * the footer's Cookie settings opens the notice again; Allow loads the pixel (PageView) and Clarity; Global Privacy
 * Control hides the notice and keeps everything off even after an earlier Allow; /legal/privacy-choices changes the
 * same choice; a review race after Decline keeps its lead with the choice and no ad ids, and nothing reaches Meta; a
 * race after Allow puts Lead in the pixel's queue with the same event id the Conversions API gets.
 */
import { spawn, execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { cpSync, mkdtempSync, readFileSync, writeFileSync, rmSync, symlinkSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import os from "node:os";

const require = createRequire(import.meta.url);
const { chromium } = require("playwright");
const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const REPO = path.dirname(ROOT);
let pass = 0, fail = 0;
const ok = (name, cond, info = "") => { if (cond) { pass++; console.log(`ok   ${name}`); } else { fail++; console.log(`FAIL ${name}${info ? `: ${info}` : ""}`); } };

/* ---------- A copy of the site with both trackers set ---------- */
const TMP = mkdtempSync(path.join(os.tmpdir(), "rempo-consent-"));
// assets/ and media/: the master page's proof, which the pages share (its renderer, styles, script and films);
// review-race/: the page's lead capture (its widget is built in, its server runs /api/race); node_modules: what it imports
for (const dir of ["meta", "api", "legal", "assets", "media", "review-race"]) cpSync(path.join(REPO, dir), path.join(TMP, dir), { recursive: true, filter: (src) => !src.includes(`${path.sep}shots`) && !src.includes("node_modules") && !src.includes(`review-race${path.sep}public${path.sep}media`) });
symlinkSync(path.join(REPO, "node_modules"), path.join(TMP, "node_modules"), "dir");
const siteFile = path.join(TMP, "meta", "content", "site.mjs");
const site = readFileSync(siteFile, "utf8").replace("metaPixelId: null", 'metaPixelId: "1234567890"').replace("clarityId: null", 'clarityId: "abcde12345"');
if (!site.includes('"1234567890"') || !site.includes('"abcde12345"')) { console.log("FAIL could not set the tracker ids in the copy"); process.exit(1); }
writeFileSync(siteFile, site);
execFileSync(process.execPath, [path.join(TMP, "meta", "tools", "build.mjs")], { stdio: "pipe" });

const PORT = 8650 + (process.pid % 140);
const BASE = `http://localhost:${PORT}`;
const server = spawn(process.execPath, [path.join(TMP, "meta", "tools", "dev.mjs"), "--stub", "--port", String(PORT)], { stdio: ["ignore", "pipe", "pipe"] });
await new Promise((resolve, reject) => {
  const t = setTimeout(() => reject(new Error("dev server did not start")), 8000);
  server.stdout.on("data", (d) => { if (String(d).includes("http://localhost")) { clearTimeout(t); resolve(); } });
  server.stderr.on("data", (d) => process.stderr.write(d));
});
const stub = async () => (await fetch(`${BASE}/__stub`)).json();
const clearStub = () => fetch(`${BASE}/__stub`, { method: "DELETE" });
// A race to the full results: Maple Street Plumbing (the demo's trade business), picked in the hero's search
async function race(page) {
  const input = page.locator("#hero-race input");
  await input.click();
  await input.fill("Maple");
  await page.waitForSelector("#hero-race-list .rr-option", { timeout: 5000 });
  await page.locator("#hero-race-list .rr-option", { hasText: "Maple Street Plumbing" }).first().click();
  await page.waitForSelector("#review-race .rr-locked input[name=firstName]", { timeout: 10000 });
  await page.fill("#review-race input[name=firstName]", "Tom");
  await page.fill("#review-race input[name=email]", "tom@maplestreet.com");
  await page.locator("#review-race .rr-locked input[name=consentEmail]").check();
  await page.locator("#review-race button", { hasText: "Show my full race" }).click();
  await page.waitForSelector("#review-race .rr-area", { timeout: 15000 });
}

const browser = await chromium.launch();
// Each context records requests to the trackers and answers them locally (nothing leaves the machine)
async function context(opts = {}) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, ...opts });
  const hits = [];
  await ctx.route(/connect\.facebook\.net|www\.clarity\.ms/, (route) => { hits.push(route.request().url()); route.fulfill({ status: 200, contentType: "text/javascript", body: "" }); });
  return { ctx, hits };
}
const GPC = () => Object.defineProperty(Navigator.prototype, "globalPrivacyControl", { get: () => true, configurable: true });
const consentOf = (page) => page.evaluate(() => { try { return JSON.parse(localStorage.getItem("rm-consent")); } catch (e) { return null; } });

try {
  /* ---------- First visit: the notice, nothing loaded; Decline; Cookie settings; Allow ---------- */
  {
    const { ctx, hits } = await context();
    const page = await ctx.newPage();
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.goto(`${BASE}/customers`, { waitUntil: "networkidle" });
    const notice = page.locator("#cookie-notice");
    ok("first visit: the cookie notice shows", await notice.isVisible());
    ok("first visit: it names both tools and links the cookie notice page", /Meta's pixel and Microsoft Clarity/.test(await notice.textContent()) && (await notice.locator('a[href="/legal/cookies"]').count()) === 1);
    ok("first visit: nothing loads before a choice (opt-in)", hits.length === 0, hits.join(", "));
    ok("first visit: no fbq or clarity on the page", await page.evaluate(() => typeof window.fbq === "undefined" && typeof window.clarity === "undefined"));
    const [d, a] = [notice.locator('[data-consent="denied"]'), notice.locator('[data-consent="granted"]')];
    const look = (l) => l.evaluate((b) => { const s = getComputedStyle(b); return [b.className, s.backgroundColor, s.color, s.fontSize, s.fontWeight, Math.round(b.getBoundingClientRect().height)].join("|"); });
    ok("both choices look the same (symmetry in choice)", (await look(d)) === (await look(a)), `${await look(d)} vs ${await look(a)}`);
    ok("the sticky bar stays out of the way while the notice shows", await page.evaluate(() => document.body.classList.contains("cookie-open")));
    await page.screenshot({ path: path.join(ROOT, "tests", "shots", "consent-01-notice.png") }).catch(() => {});
    await d.click();
    ok("Decline: the notice closes", await notice.isHidden());
    ok("Decline: still nothing loaded", hits.length === 0, hits.join(", "));
    ok("Decline: the choice is kept", (await consentOf(page)).ads === "denied");
    await page.reload({ waitUntil: "networkidle" });
    ok("Decline, then reload: no notice, nothing loaded", (await notice.isHidden()) && hits.length === 0);
    await page.locator("[data-cookie-settings]").click();
    ok("Cookie settings in the footer opens the notice again", await notice.isVisible());
    await notice.locator('[data-consent="granted"]').click();
    await page.waitForTimeout(300);
    ok("Allow: the pixel and Clarity load", hits.some((u) => u.includes("connect.facebook.net")) && hits.some((u) => u.includes("clarity.ms/tag/abcde12345")), hits.join(", "));
    ok("Allow: the pixel starts with this dataset and a PageView", await page.evaluate(() => { const q = (window.fbq && window.fbq.queue) || []; return q.some((a) => a[0] === "init" && a[1] === "1234567890") && q.some((a) => a[0] === "track" && a[1] === "PageView"); }));
    const before = hits.length;
    await page.goto(`${BASE}/customers/recent`, { waitUntil: "networkidle" });
    ok("Allow, then another page: no notice, the tools load at once", (await page.locator("#cookie-notice").isHidden()) && hits.length > before);
    ok("no script errors", errors.length === 0, errors.join(" | "));
    await ctx.close();
  }

  /* ---------- Global Privacy Control wins, even over an earlier Allow ---------- */
  {
    const { ctx, hits } = await context();
    await ctx.addInitScript(GPC);
    await ctx.addInitScript(() => localStorage.setItem("rm-consent", JSON.stringify({ v: 1, ads: "granted", at: "2026-11-01T00:00:00Z" })));
    const page = await ctx.newPage();
    await page.goto(`${BASE}/customers`, { waitUntil: "networkidle" });
    ok("Global Privacy Control: no notice", await page.locator("#cookie-notice").isHidden());
    ok("Global Privacy Control: nothing loads, despite an earlier Allow", hits.length === 0, hits.join(", "));
    await page.goto(`${BASE}/legal/privacy-choices`, { waitUntil: "networkidle" });
    ok("/legal/privacy-choices with GPC: says the opt-out is honored, Allow is off", (await page.locator("#gpc-status").isVisible()) && /Opt-Out Request Honored/.test(await page.locator("#gpc-status").textContent()) && (await page.locator('[data-choice="granted"]').isDisabled()));
    await ctx.close();
  }

  /* ---------- /legal/privacy-choices changes the same choice ---------- */
  {
    const { ctx, hits } = await context({ viewport: { width: 1280, height: 900 }, isMobile: false, hasTouch: false });
    const page = await ctx.newPage();
    await page.goto(`${BASE}/legal/privacy-choices`, { waitUntil: "networkidle" });
    await page.locator('[data-choice="granted"]').click();
    ok("/legal/privacy-choices: Allow is saved and shown", (await consentOf(page)).ads === "granted" && /Allowed/.test(await page.locator("#choice-now").textContent()) && (await page.locator('[data-choice="granted"]').getAttribute("aria-pressed")) === "true");
    await page.goto(`${BASE}/customers`, { waitUntil: "networkidle" });
    ok("then /customers: no notice, the tools load", (await page.locator("#cookie-notice").isHidden()) && hits.length > 0);
    await page.goto(`${BASE}/legal/privacy-choices`, { waitUntil: "networkidle" });
    await page.locator('[data-choice="denied"]').click();
    ok("/legal/privacy-choices: Opt out is saved and confirmed", (await consentOf(page)).ads === "denied" && /opted out/.test(await page.locator("#choice-done").textContent()));
    const n = hits.length;
    await page.goto(`${BASE}/customers`, { waitUntil: "networkidle" });
    ok("then /customers: nothing loads", hits.length === n);
    await ctx.close();
  }

  /* ---------- A race after Decline: the lead keeps the choice and no ad ids, and nothing reaches Meta ---------- */
  {
    await clearStub();
    const { ctx } = await context({ viewport: { width: 1280, height: 900 }, isMobile: false, hasTouch: false });
    const page = await ctx.newPage();
    await page.goto(`${BASE}/customers?fbclid=IwAR0consentconsent`, { waitUntil: "networkidle" });
    await page.locator('#cookie-notice [data-consent="denied"]').click();
    await race(page);
    const s = await stub();
    const stored = s.leads.find((l) => l.form === "review-race");
    ok("a race after Decline: the lead is kept with the choice and no Meta ids", stored && stored.meta.ads_consent === "denied" && !stored.meta.fbc && !stored.meta.fbp, JSON.stringify(stored && stored.meta));
    ok("a race after Decline: nothing to the Conversions API", !s.outbox.some((m) => m.kind === "capi"));
    ok("a race after Decline: nothing to the pixel", await page.evaluate(() => typeof window.fbq === "undefined"));
    ok("a race after Decline: the results email still goes", s.outbox.some((m) => m.to === "tom@maplestreet.com"));
    await ctx.close();
  }

  /* ---------- A race after Allow: Lead in the pixel's queue, with the Conversions API's event id ---------- */
  {
    await clearStub();
    const { ctx } = await context({ viewport: { width: 1280, height: 900 }, isMobile: false, hasTouch: false });
    const page = await ctx.newPage();
    await page.goto(`${BASE}/customers?fbclid=IwAR0consentconsent`, { waitUntil: "networkidle" });
    await page.locator('#cookie-notice [data-consent="granted"]').click();
    await race(page);
    const s = await stub();
    const capiLead = s.outbox.filter((m) => m.kind === "capi").map((m) => m.events[0]).find((e) => e.event_name === "Lead");
    const queued = await page.evaluate(() => ((window.fbq && window.fbq.queue) || []).filter((a) => a[0] === "track" && a[1] === "Lead").map((a) => a[3] && a[3].eventID));
    ok("a race after Allow: Lead to the pixel and to the Conversions API, one event id", capiLead && queued.length === 1 && queued[0] === capiLead.event_id, JSON.stringify({ queued, capi: capiLead && capiLead.event_id }));
    const stored = s.leads.find((l) => l.form === "review-race");
    ok("a race after Allow: the lead keeps the choice and the click id", stored && stored.meta.ads_consent === "granted" && /IwAR0consentconsent$/.test(stored.meta.fbc || ""), JSON.stringify(stored && stored.meta));
    await ctx.close();
  }
} finally {
  await browser.close();
  server.kill();
  rmSync(TMP, { recursive: true, force: true });
}
console.log(`check-consent: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
