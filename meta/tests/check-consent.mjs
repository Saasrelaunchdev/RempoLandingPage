#!/usr/bin/env node
/**
 * The cookie notice and the consent gate, in a real browser, on a copy of the site built with a Meta pixel and a
 * Clarity id set (the real site has neither yet, so it shows no notice). The copy lives in a temporary folder:
 * meta/, api/ and legal/ are copied, site.mjs gets the two ids, and the copy's own build and dev server run there.
 *
 *   node tests/check-consent.mjs
 *
 * Checks: nothing loads before a choice; both choices look the same; Decline keeps everything off and is remembered;
 * the footer's Cookie settings opens the notice again; Allow loads the pixel (PageView) and Clarity; Global Privacy
 * Control hides the notice and keeps everything off even after an earlier Allow; /legal/privacy-choices changes the
 * same choice; a lead sent after Decline reaches the database with the choice and nothing reaches Meta.
 */
import { spawn, execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { cpSync, mkdtempSync, readFileSync, writeFileSync, rmSync } from "node:fs";
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
for (const dir of ["meta", "api", "legal"]) cpSync(path.join(REPO, dir), path.join(TMP, dir), { recursive: true, filter: (src) => !src.includes(`${path.sep}shots`) && !src.includes("node_modules") });
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
const stubCalls = async () => (await fetch(`${BASE}/__stub`)).json();
const clearStub = () => fetch(`${BASE}/__stub`, { method: "DELETE" });

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

  /* ---------- A lead after Decline: stored with the choice, nothing to Meta ---------- */
  {
    await clearStub();
    const { ctx } = await context({ viewport: { width: 1280, height: 900 }, isMobile: false, hasTouch: false });
    const page = await ctx.newPage();
    const t0 = Date.now();
    await page.goto(`${BASE}/customers?fbclid=IwAR0consentconsent`, { waitUntil: "networkidle" });
    await page.locator('#cookie-notice [data-consent="denied"]').click();
    const tap = async (label, key) => { await page.locator(".gc-step:not([hidden]) .gc-opt", { hasText: label }).first().click(); await page.waitForSelector(`.gc-step[data-key="${key}"]:not([hidden])`); };
    for (const [label, key] of [["HVAC and plumbing", "asks"], ["When someone remembers", "newest"], ["More than 3 months ago", "replies"], ["Rarely", "compare"], ["Haven't checked", "jobs"], ["16 to 40", "records"], ["Job software built for the trades", "business"]]) await tap(label, key);
    await page.fill("#gc-company", "Maple Street Plumbing");
    await page.fill("#gc-city", "Springfield");
    await page.locator('.gc-step:not([hidden]) .chip-opt:has(input[value="1"])').click();
    await page.locator(".gc-step:not([hidden]) .gc-next").click();
    await page.waitForSelector('.gc-step[data-key="contact"]:not([hidden])');
    await page.fill("#gc-firstName", "Tom");
    await page.fill("#gc-email", "tom@maplestreet.com");
    await page.locator('.gc-step:not([hidden]) .consent input').check();
    const wait = 3600 - (Date.now() - t0);
    if (wait > 0) await page.waitForTimeout(wait);
    await page.locator(".gc-step:not([hidden]) button[type=submit]").click();
    await page.waitForSelector(".gc-result:not([hidden]) .score-n", { timeout: 6000 });
    const calls = await stubCalls();
    const stored = calls.find((c) => c.svc === "supabase" && c.body && c.body.payload && c.body.payload.form === "meta-gap-report");
    ok("a qualified lead after Decline: stored with the choice and no Meta ids", stored && stored.body.payload.meta.ads_consent === "denied" && !stored.body.payload.meta.fbc && !stored.body.payload.meta.fbp, JSON.stringify(stored && stored.body.payload.meta));
    ok("a qualified lead after Decline: nothing to the Conversions API", !calls.some((c) => c.svc === "meta"));
    ok("a qualified lead after Decline: the report email still goes", calls.some((c) => c.svc === "resend" && c.body.to && c.body.to[0] === "tom@maplestreet.com"));
    await ctx.close();
  }
} finally {
  await browser.close();
  server.kill();
  rmSync(TMP, { recursive: true, force: true });
}
console.log(`check-consent: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
