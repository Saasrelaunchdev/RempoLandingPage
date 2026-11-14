#!/usr/bin/env node
/**
 * The page in a real browser (Playwright's Chromium), against the dev server in stub mode (tools/dev.mjs --stub): the
 * real /api/race function (the Review Race) at the real /customers paths, in its demo mode (sample businesses, an
 * in-memory store; what it keeps and sends is read at /__stub).
 *
 *   node tests/check-page.mjs            (build first: node tools/build.mjs)
 *
 * Phone (390 x 844, touch): the hero's race search shows in the first screen; a pick there runs the race below it; the
 * notice at collection names its button and carries the page's links and its sentence about Meta; the full race comes
 * back; the lead keeps the ad variant, the consent wording's version, the campaign and the ad choice; Lead goes to the
 * pixel and to the Conversions API with one event id (a trade business), and Schedule the same once a call is booked,
 * never with the phone number; the booking form's own notice and text consent.
 * Not set up yet (the race's config says ready: false): the business is typed in, the by-hand form takes the town and
 * the contact, and the request is kept with the variant and the consent version.
 * PC (1440 x 900): the race card in the first screen. Keyboard: the search works without a mouse. Every page: no
 * script errors, labelled fields, unique ids, alt text on every picture, nothing wider than the screen. The mobile
 * pass: on a phone the race search in the first screen, the phone lines, 56 px buttons, 32 px checkboxes, no phone
 * inside the phone, no scroll reveals, the sticky bar stepping aside; on a PC the full words. Screenshots go to
 * tests/shots/.
 */
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { mkdirSync, readFileSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";

const require = createRequire(import.meta.url);
const { chromium } = require("playwright");
const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const SHOTS = path.join(ROOT, "tests", "shots");
mkdirSync(SHOTS, { recursive: true });
const PORT = 8800 + (process.pid % 150);
const BASE = `http://localhost:${PORT}`;
const SITE = (await import(pathToFileURL(path.join(ROOT, "content", "site.mjs")).href)).default;
const COPY = JSON.parse(readFileSync(path.join(ROOT, "content", "copy.json"), "utf8"));
const { variants } = JSON.parse(readFileSync(path.join(ROOT, "content", "variants.json"), "utf8"));
const PAGES = `${BASE}${SITE.path}`;   // http://localhost:PORT/customers
const API = (SITE.race && SITE.race.api) || "/api/race";

let pass = 0, fail = 0;
const ok = (name, cond, info = "") => { if (cond) { pass++; console.log(`ok   ${name}`); } else { fail++; console.log(`FAIL ${name}${info ? `: ${typeof info === "string" ? info : JSON.stringify(info)}` : ""}`); } };

const server = spawn(process.execPath, [path.join(ROOT, "tools", "dev.mjs"), "--stub", "--port", String(PORT)], { stdio: ["ignore", "pipe", "pipe"] });
await new Promise((resolve, reject) => {
  const t = setTimeout(() => reject(new Error("dev server did not start")), 10000);
  server.stdout.on("data", (d) => { if (String(d).includes("http://localhost")) { clearTimeout(t); resolve(); } });
  server.stderr.on("data", (d) => process.stderr.write(d));
});
const stub = async () => (await fetch(`${BASE}/__stub`)).json();
const clearStub = () => fetch(`${BASE}/__stub`, { method: "DELETE" });

const browser = await chromium.launch();
// A stand-in for the Meta pixel: records every fbq call (the real one is not loaded without site.metaPixelId)
const FBQ = () => { window.__fbq = []; window.fbq = (...a) => window.__fbq.push(a); };
// The visitor allowed advertising tools (in the cookie notice or on /legal/privacy-choices): the pixel may hear events
const ALLOW = () => { try { localStorage.setItem("rm-consent", JSON.stringify({ v: 1, ads: "granted", at: new Date().toISOString(), src: "test" })); } catch (e) { /* none */ } };
// Every request the page makes to the race, with its body
function raceRequests(page) {
  const list = [];
  page.on("request", (r) => {
    if (!r.url().includes(API)) return;
    let body = null;
    try { body = r.postData() ? JSON.parse(r.postData()) : null; } catch { body = null; }
    list.push({ method: r.method(), url: r.url(), body });
  });
  return list;
}
const posted = (list, action) => list.filter((x) => x.method === "POST" && x.body && x.body.action === action).pop();

async function audit(page, label) {
  const r = await page.evaluate(() => {
    const ids = [...document.querySelectorAll("[id]")].map((e) => e.id);
    const dupes = ids.filter((id, i) => ids.indexOf(id) !== i);
    const unlabeled = [...document.querySelectorAll("input:not([type=hidden]):not(.rr-hp)")].filter((i) => {
      if (i.closest("label")) return false;
      return !(i.id && document.querySelector(`label[for="${i.id}"]`));
    }).map((i) => i.name);
    const noAlt = [...document.querySelectorAll("img")].filter((i) => !i.hasAttribute("alt")).map((i) => i.src);
    const wide = document.documentElement.scrollWidth > window.innerWidth + 1;
    const buttons = [...document.querySelectorAll("button,a.btn")].filter((b) => !(b.textContent.trim() || b.getAttribute("aria-label"))).length;
    const notes = [...document.querySelectorAll("body *:not(script):not(style)")].filter((e) => e.checkVisibility() && [...e.childNodes].some((c) => c.nodeType === 3 && /Illustration ·|sample (review|report|thank-you)|demo data/i.test(c.textContent))).map((e) => e.textContent.trim().slice(0, 60));
    return { dupes, unlabeled, noAlt, wide, buttons, notes, h1: document.querySelectorAll("h1").length };
  });
  ok(`${label}: unique ids`, r.dupes.length === 0, r.dupes.join(","));
  ok(`${label}: every field has a label`, r.unlabeled.length === 0, r.unlabeled.join(","));
  ok(`${label}: every picture has alt text`, r.noAlt.length === 0, r.noAlt.join(","));
  ok(`${label}: nothing wider than the screen`, !r.wide);
  ok(`${label}: every button has a name`, r.buttons === 0);
  ok(`${label}: one h1`, r.h1 === 1);
  ok(`${label}: no caption notes under the pictures`, r.notes.length === 0, r.notes.join(" | "));
}

// Picks a business in the hero's search: the race runs in its section below
async function pickInHero(page, typed, name) {
  const input = page.locator("#hero-race input");
  await input.click();
  await input.fill(typed);
  await page.waitForSelector("#hero-race-list .rr-option", { timeout: 5000 });
  await page.locator("#hero-race-list .rr-option", { hasText: name }).first().click();
  await page.waitForSelector("#review-race .rr-preview", { timeout: 10000 });
}

/* ============ Phone: an owner of a trade business, end to end ============ */
let savedToken = "";
{
  await clearStub();
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
  await page.addInitScript(FBQ);
  await page.addInitScript(ALLOW);
  const reqs = raceRequests(page);
  await page.goto(`${PAGES}?utm_source=facebook&utm_campaign=race-test&fbclid=IwAR0testtesttesttest`, { waitUntil: "networkidle" });
  await audit(page, "phone");
  const btn = await page.locator("#hero-race button[type=submit]").boundingBox();
  ok("phone: the race search and its button show in the first screen", btn && btn.y + btn.height <= 844, JSON.stringify(btn));
  ok("phone: the search is labelled and the button names what it does", (await page.locator("#hero-race label").textContent()).includes("Find your business on Google") && (await page.locator("#hero-race button[type=submit]").textContent()).includes("See where you stand"));
  await page.screenshot({ path: path.join(SHOTS, "phone-01-hero.png") });

  await pickInHero(page, "Maple", "Maple Street Plumbing");
  ok("phone: a pick in the hero runs the race below it: the three shops and the owner", (await page.locator("#review-race .rr-board-row").count()) === 4 && /Maple Street Plumbing/.test(await page.locator("#review-race .rr-board-row.is-you").innerText()));
  ok("phone: the gap line", /186/.test(await page.locator("#review-race .rr-preview .rr-gap").innerText()));
  await page.waitForFunction(() => /22 of your last 32/.test((document.querySelector("#review-race .rr-locked") || {}).innerText || ""), null, { timeout: 8000 });
  ok("phone: the locked counts arrive", true);
  const note = page.locator("#review-race .rr-locked .rr-notice");
  const noteText = (await note.textContent()).replace(/\s+/g, " ");
  ok("phone: the notice at collection names the button that agrees", noteText.startsWith("By tapping Show my full race, you agree to our Terms of Service and acknowledge our Privacy Policy"), noteText);
  ok("phone: it says what Meta hears and links the privacy choices", noteText.includes("Unless you opt out, we also tell Meta when a form like this is sent, to measure our ads.") && (await note.locator('a[href="/legal/privacy-choices"]').count()) === 1, noteText);
  ok("phone: the Terms and the Privacy Policy are this site's, each in a new tab", (await note.locator('a[href="/legal/terms"][target="_blank"]').count()) === 1 && (await note.locator('a[href="/legal/privacy"][target="_blank"]').count()) === 1);
  ok("phone: the email box starts unticked", !(await page.locator("#review-race .rr-locked input[name=consentEmail]").isChecked()));
  const box = await page.evaluate(() => getComputedStyle(document.querySelector("#review-race .rr-locked input[name=consentEmail]")).width);
  ok("phone: the race's checkboxes are 32 px", box === "32px", box);
  await page.screenshot({ path: path.join(SHOTS, "phone-02-preview.png") });
  await page.locator("#review-race button", { hasText: "Show my full race" }).click();
  ok("phone: a missing first name is caught", /first name/i.test(await page.locator("#review-race .rr-locked .rr-error").innerText()));
  await page.fill("#review-race input[name=firstName]", "Tom");
  await page.fill("#review-race input[name=email]", "tom@maplestreet.com");
  await page.locator("#review-race .rr-locked input[name=consentEmail]").check();
  await page.locator("#review-race button", { hasText: "Show my full race" }).click();
  await page.waitForSelector("#review-race .rr-area", { timeout: 15000 });
  ok("phone: the full race: four areas, three fixes, three reply drafts", (await page.locator("#review-race .rr-area").count()) === 4 && (await page.locator("#review-race .rr-fixes li").count()) === 3 && (await page.locator("#review-race .rr-draft").count()) === 3);
  const unlock = posted(reqs, "unlock");
  const host = unlock && unlock.body.host;
  ok("phone: the unlock carries the variant, the consent wording's version and a Lead event id", host && host.variant === "top-three" && host.noticeVersion === SITE.noticeVersion && /^lead-[A-Za-z0-9-]{6,}$/.test(host.eventId), host);
  ok("phone: and the ad choice with the click id from the ad", host && host.tracking.consent === "granted" && /^fb\.1\.\d+\.IwAR0testtesttesttest$/.test(host.tracking.fbc) && host.tracking.gpc === false, host && host.tracking);
  const events = await page.evaluate(() => window.__rmEvents);
  const lead = events.find((e) => e.name === "Lead");
  ok("phone: RaceStart, RacePreview, RaceResults on the page", ["RaceStart", "RacePreview", "RaceResults"].every((n) => events.some((e) => e.name === n)), events.map((e) => e.name).join(","));
  ok("phone: Lead to the pixel with the unlock's event id (a trade business)", lead && host && lead.eventID === host.eventId && (await page.evaluate((id) => window.__fbq.some((a) => a[0] === "track" && a[1] === "Lead" && a[3] && a[3].eventID === id), host.eventId)));
  let s = await stub();
  const stored = s.leads.find((l) => l.form === "review-race");
  ok("phone: stored as review-race with the variant, the fit and the consent wording's version", stored && stored.fields.variant === "top-three" && stored.fields.fit === "trade" && stored.fields.noticeVersion === SITE.noticeVersion, stored && stored.fields);
  ok("phone: the campaign, the click id, the event id and the ad choice are stored", stored && stored.meta.utm_campaign === "race-test" && stored.meta.fbclid === "IwAR0testtesttesttest" && stored.meta.meta_event_id === host.eventId && stored.meta.ads_consent === "granted" && /^fb\.1\./.test(stored.meta.fbc || ""), stored && stored.meta);
  ok("phone: the emails link back to this page", stored && new RegExp(`${SITE.path}\\?r=`).test(stored.fields.results), stored && stored.fields.results);
  const capiLead = s.outbox.filter((m) => m.kind === "capi").map((m) => m.events[0]).find((e) => e.event_name === "Lead");
  ok("phone: the same Lead to the Conversions API, same event id", capiLead && capiLead.event_id === host.eventId, capiLead && capiLead.event_id);
  ok("phone: the server event carries the hashed email and the click id", capiLead && /^[a-f0-9]{64}$/.test(capiLead.user_data.em[0]) && /IwAR0testtesttesttest$/.test(capiLead.user_data.fbc || ""));
  ok("phone: the address keeps the race, for a reload", /[?&]r=/.test(page.url()));
  savedToken = new URL(page.url()).searchParams.get("r") || "";
  await page.screenshot({ path: path.join(SHOTS, "phone-03-results.png") });

  // The call: the last step
  const book = page.locator("#review-race .rr-book");
  await book.scrollIntoViewIfNeeded();
  await page.waitForSelector("#review-race .rr-day", { timeout: 8000 });
  const bnote = (await book.locator(".rr-notice").textContent()).replace(/\s+/g, " ");
  ok("phone: the booking form's notice names its button and links the SMS terms", bnote.startsWith("By tapping Book my call, you agree to our Terms of Service") && (await book.locator('.rr-notice a[href="/legal/sms"]').count()) === 1, bnote);
  const textLabel = await book.locator("input[name=consentText]").locator("xpath=..").innerText();
  ok("phone: the text box says who, why, how many, rates, STOP and HELP, and that it isn't required", /Rempo may text this number.*up to 3 texts.*Msg & data rates may apply.*STOP.*HELP.*Not required to book/.test(textLabel), textLabel);
  ok("phone: the text box starts unticked and the call box asks in Rempo's name", !(await book.locator("input[name=consentText]").isChecked()) && /Rempo may call me at this number/.test(await book.locator("input[name=consentCall]").locator("xpath=..").innerText()));
  await book.locator(".rr-slot").first().click();
  await book.locator("input[name=phone]").fill("5125550134");
  await book.locator("input[name=consentCall]").check();
  await book.locator("button[type=submit]").click();
  await page.waitForSelector("#review-race .rr-book .rr-done", { timeout: 8000 });
  ok("phone: booked", /You're booked/.test(await book.locator(".rr-done").innerText()));
  const bookReq = posted(reqs, "book");
  const sched = (await page.evaluate(() => window.__rmEvents)).find((e) => e.name === "Schedule");
  ok("phone: Schedule to the pixel with the booking's event id", bookReq && sched && /^schedule-/.test(bookReq.body.host.eventId) && sched.eventID === bookReq.body.host.eventId);
  s = await stub();
  const capiSched = s.outbox.filter((m) => m.kind === "capi").map((m) => m.events[0]).find((e) => e.event_name === "Schedule");
  ok("phone: the same Schedule to the Conversions API, never with the phone number", capiSched && bookReq && capiSched.event_id === bookReq.body.host.eventId && !capiSched.user_data.ph);
  const run = s.runs.find((r) => r.booking);
  ok("phone: the booking keeps the consent wording's version", run && run.booking.noticeVersion === SITE.noticeVersion, run && run.booking);
  ok("phone: the sticky bar stays away once a call is booked", !(await page.locator(".sticky-bar.show").count()));
  await page.screenshot({ path: path.join(SHOTS, "phone-04-booked.png") });

  // The results link from the email: the race comes back, and Meta isn't told twice
  const before = (await page.evaluate(() => window.__rmEvents)).filter((e) => e.name === "Lead").length;
  await page.goto(`${PAGES}?r=${encodeURIComponent(savedToken)}#review-race`, { waitUntil: "networkidle" });
  await page.waitForSelector("#review-race .rr-area", { timeout: 10000 });
  ok("phone: the results link opens the saved race, booking remembered", (await page.locator("#review-race .rr-draft").count()) === 3 && /You're booked/.test(await page.locator("#review-race .rr-book").innerText()));
  ok("phone: no second Lead on the reload", (await page.evaluate(() => window.__rmEvents)).filter((e) => e.name === "Lead").length === 0 && before === 1);
  ok("phone: no script errors", errors.length === 0, errors.join(" | "));
  await ctx.close();
}

/* ============ Not set up yet: the race's config says ready: false (a key missing in Vercel) ============ */
{
  await clearStub();
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.route(`**${API}?action=config*`, (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ demo: false, ready: false, search: "places", turnstileSiteKey: null, calendar: false, bookingUrl: null }) }));
  const reqs = raceRequests(page);
  await page.goto(`${PAGES}/replies`, { waitUntil: "networkidle" });
  ok("/replies: its own headline", (await page.locator("h1").textContent()).includes("no reply"));
  ok("not ready: the search asks for the business name, with no Google search under it", (await page.locator("#hero-race input").getAttribute("placeholder")) === "Your business name" && !(await page.locator("#hero-race .rr-attrib").isVisible()));
  await page.locator("#hero-race input").fill("Maple Street Plumbing");
  await page.locator("#hero-race button[type=submit]").click();
  await page.waitForSelector("#review-race .rr-later", { timeout: 6000 });
  const later = page.locator("#review-race .rr-later");
  ok("not ready: the by-hand form, with the business already filled in", (await later.locator("input[name=business]").inputValue()) === "Maple Street Plumbing");
  ok("not ready: it says the team builds the race and emails it", /email it within one business day/.test(await later.innerText()));
  ok("not ready: its notice carries the page's links and the sentence about Meta", (await later.locator('.rr-notice a[href="/legal/privacy"]').count()) === 1 && (await later.locator(".rr-notice").textContent()).includes("we also tell Meta"));
  await later.locator("input[name=firstName]").fill("Tom");
  await later.locator("input[name=email]").fill("tom@maplestreet.com");
  await later.locator("input[name=consentEmail]").check();
  await later.locator("button[type=submit]").click();
  ok("not ready: a missing town is caught", /city or town/i.test(await later.locator(".rr-error").last().innerText()));
  await later.locator("input[name=town]").fill("Springfield");
  await later.locator("button[type=submit]").click();
  await page.waitForSelector("#review-race .rr-later .rr-done", { timeout: 6000 });
  ok("not ready: done, in the owner's name", /Thanks, Tom/.test(await page.locator("#review-race .rr-later .rr-done").innerText()));
  const req = posted(reqs, "later");
  ok("not ready: the request carries the business, the town, the variant and the consent version", req && req.body.main === "Maple Street Plumbing" && req.body.secondary === "Springfield" && req.body.host.variant === "replies" && req.body.host.noticeVersion === SITE.noticeVersion, req && req.body);
  const s = await stub();
  const kept = s.leads.find((l) => l.form === "review-race-later");
  ok("not ready: kept as review-race-later with the town and the variant", kept && kept.company === "Maple Street Plumbing" && kept.fields.city === "Springfield" && kept.fields.variant === "replies", kept);
  const events = (await page.evaluate(() => window.__rmEvents)).map((e) => e.name);
  ok("not ready: RaceStart and RaceLaterRequested on the page, and no Lead (no trade known)", events.includes("RaceStart") && events.includes("RaceLaterRequested") && !events.includes("Lead"), events.join(","));
  ok("not ready: no script errors", errors.length === 0, errors.join(" | "));
  await ctx.close();
}

/* ============ PC: the race card in the first screen ============ */
{
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(`${PAGES}/recent`, { waitUntil: "networkidle" });
  ok("/recent: its own headline", (await page.locator("h1").textContent()).includes("fresh"));
  const card = await page.locator("#race-home").boundingBox();
  ok("pc: the race card sits in the first screen, beside the headline", card && card.y < 300 && card.x > 600, JSON.stringify(card));
  await audit(page, "pc");
  await page.screenshot({ path: path.join(SHOTS, "pc-01-hero.png") });
  ok("pc: no script errors", errors.length === 0, errors.join(" | "));
  await ctx.close();
}

/* ============ Keyboard, the footer, the preview view ============ */
{
  await clearStub();
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await ctx.newPage();
  await page.goto(`${PAGES}/request`, { waitUntil: "networkidle" });
  ok("/request: its own headline", (await page.locator("h1").textContent()).includes("what your customer sees"));
  await page.keyboard.press("Tab");
  ok("keyboard: the skip link comes first and leads to the race search", (await page.evaluate(() => document.activeElement.getAttribute("href"))) === "#hero-race");
  await page.locator("#hero-race input").focus();
  await page.keyboard.type("Cardinal");
  await page.waitForSelector("#hero-race-list .rr-option", { timeout: 5000 });
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("Enter");
  await page.waitForSelector("#review-race .rr-preview", { timeout: 10000 });
  ok("keyboard: arrows and Enter pick a business and run the race", /Cardinal Heating/.test(await page.locator("#review-race .rr-board-row.is-you").innerText()));
  const footLinks = await page.locator(".foot a[href^='/legal']").evaluateAll((as) => as.map((a) => a.getAttribute("href")));
  const statuses = await Promise.all(footLinks.map((h) => fetch(`${BASE}${h}`).then((r) => r.status)));
  ok(`footer: ${footLinks.length} legal links, each opens a page`, footLinks.length >= 7 && statuses.every((st) => st === 200), footLinks.map((h, i) => `${h} ${statuses[i]}`).join(", "));
  ok("footer: no cookie settings link while no tracker is set", (await page.locator("[data-cookie-settings]").count()) === (SITE.metaPixelId || SITE.clarityId ? 1 : 0));
  await page.goto(`${PAGES}/request?view=preview`, { waitUntil: "networkidle" });
  ok("preview view: the {TBD} notes show", (await page.locator(".tbd:visible").count()) > 0);
  await page.goto(`${PAGES}/request`, { waitUntil: "networkidle" });
  ok("production view: no {TBD} note shows", (await page.locator(".tbd:visible").count()) === 0);
  await ctx.close();
}

/* ============ The mobile pass: what changes on a phone (under 600 px), and the PC page as it was ============ */
{
  const urlOf = (v) => `${PAGES}${v.slug ? `/${v.slug}` : ""}`;
  const shown = (sel) => [...document.querySelectorAll(sel)].filter((e) => getComputedStyle(e).display !== "none").map((e) => e.textContent.trim());

  // Phone: an iPhone 13's visible area (390 x 664 once the browser's bars are counted)
  const phone = await browser.newContext({ viewport: { width: 390, height: 664 }, isMobile: true, hasTouch: true });
  const pp = await phone.newPage();
  for (const v of variants) {
    const label = v.slug ? `/${v.slug}` : "/";
    await pp.goto(urlOf(v), { waitUntil: "networkidle" });
    const r = await pp.evaluate((shownSrc) => {
      const shown = new Function(`return ${shownSrc}`)();
      const b = document.querySelector("#hero-race button[type=submit]");
      return { bottom: b ? Math.round(b.getBoundingClientRect().bottom) : 9999, vh: innerHeight, lead: shown(".hero .lead"), frame: shown(".rc-frame > span") };
    }, shown.toString());
    ok(`phone ${label}: the race search and its button show in the first screen`, r.bottom <= r.vh, `${r.bottom} > ${r.vh}`);
    ok(`phone ${label}: the hero line written for phones`, r.lead.length === 1 && r.lead[0] === v.leadShort, JSON.stringify(r.lead));
    ok(`phone ${label}: the race card's short opening line`, r.frame.length === 1 && r.frame[0] === COPY.race.frameShort, JSON.stringify(r.frame));
  }
  await pp.goto(PAGES, { waitUntil: "networkidle" });
  const m = await pp.evaluate(() => {
    const cta = document.querySelector("#points .sec-cta .btn").getBoundingClientRect();
    return {
      raceBtn: Math.round(document.querySelector("#hero-race button[type=submit]").getBoundingClientRect().height),
      ctaH: Math.round(cta.height), ctaW: Math.round(cta.width), wrapW: Math.round(document.querySelector("#points .wrap").clientWidth - 40),
      phoneBar: getComputedStyle(document.querySelector(".svc-grid .phone-bar")).display,
      reveal: getComputedStyle(document.querySelector("#faq .reveal")).opacity,
      ptImg: Math.round(document.querySelector(".pt-img").getBoundingClientRect().height)
    };
  });
  ok("phone: the race's search button is 56 px tall", m.raceBtn >= 56, String(m.raceBtn));
  ok("phone: a section's button is 56 px tall and full width", m.ctaH >= 56 && m.ctaW >= m.wrapW, `${m.ctaH} x ${m.ctaW}`);
  ok("phone: no phone inside the phone (the request is a card)", m.phoneBar === "none");
  ok("phone: nothing waits on a scroll animation", m.reveal === "1", m.reveal);
  ok("phone: micro visuals beside the headings", m.ptImg <= 64, String(m.ptImg));
  ok("phone: the sticky bar hides while the race search is on screen", !(await pp.locator(".sticky-bar.show").count()));
  await pp.evaluate(() => document.querySelector("#faq").scrollIntoView({ block: "start" }));
  await pp.waitForTimeout(400);
  ok("phone: the sticky bar shows between the page's own buttons", await pp.evaluate(() => document.querySelector(".sticky-bar").classList.contains("show")));
  await pp.locator(".sticky-bar .btn").click();
  await pp.waitForTimeout(700);
  ok("phone: the sticky bar takes the owner to the race search, ready to type", await pp.evaluate(() => document.activeElement && document.activeElement.closest("#hero-race") !== null && document.activeElement.tagName === "INPUT"));
  await pp.evaluate(() => document.querySelector("#points .sec-cta").scrollIntoView({ block: "center" }));
  await pp.waitForTimeout(400);
  ok("phone: the sticky bar steps aside while a section's own button is on screen", await pp.evaluate(() => !document.querySelector(".sticky-bar").classList.contains("show")));
  await audit(pp, "phone mobile pass");
  await phone.close();

  // PC: the full words
  const pc = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const cp = await pc.newPage();
  for (const v of variants) {
    const label = v.slug ? `/${v.slug}` : "/";
    await cp.goto(urlOf(v), { waitUntil: "networkidle" });
    const r = await cp.evaluate((shownSrc) => {
      const shown = new Function(`return ${shownSrc}`)();
      return { lead: shown(".hero .lead"), frame: shown(".rc-frame > span"), mOnly: shown(".m-only").length };
    }, shown.toString());
    ok(`pc ${label}: the full hero line`, r.lead.length === 1 && r.lead[0] === v.lead, JSON.stringify(r.lead));
    ok(`pc ${label}: the race card's full opening line`, r.frame.length === 1 && r.frame[0] === COPY.race.frame, JSON.stringify(r.frame));
    ok(`pc ${label}: no phone-only words show`, r.mOnly === 0);
  }
  ok("pc: the request is still shown on a phone", await cp.evaluate(() => getComputedStyle(document.querySelector(".svc-grid .phone-bar")).display !== "none"));
  await pc.close();
}

await browser.close();
server.kill();
console.log(`check-page: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
