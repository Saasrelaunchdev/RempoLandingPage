#!/usr/bin/env node
/**
 * The page in a real browser (Playwright's Chromium), against the dev server in stub mode (tools/dev.mjs --stub): the
 * real /api/meta-lead function at the real /customers paths, with Supabase, Resend, Slack and Meta answered locally
 * and recorded.
 *
 *   node tests/check-page.mjs            (build first: node tools/build.mjs)
 *
 * Phone (390 x 844, touch): the first question shows without scrolling; nine taps and two short forms reach the score;
 * the score matches the server's; Lead goes to the pixel and to the Conversions API with one event id; the call step
 * books; Schedule does the same; the sticky bar opens the Gap Check as a sheet and gives the card back on close.
 * PC (1440 x 900): an owner on paper gets the call-only route and Meta hears nothing (pixel conditioning).
 * Keyboard: the whole check works without a mouse. Every page: no script errors, labelled fields, unique ids,
 * alt text on every picture, nothing wider than the screen. The mobile pass: on a phone every answer to the first
 * question shows in the first screen, the phone lines, 56 px buttons, 32 px checkboxes, no phone inside the phone, no
 * scroll reveals, the sticky bar stepping aside; on a PC the original words and phone. Screenshots go to tests/shots/.
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
const PAGES = `${BASE}${SITE.path}`;   // http://localhost:PORT/customers

let pass = 0, fail = 0;
const ok = (name, cond, info = "") => { if (cond) { pass++; console.log(`ok   ${name}`); } else { fail++; console.log(`FAIL ${name}${info ? `: ${info}` : ""}`); } };

const server = spawn(process.execPath, [path.join(ROOT, "tools", "dev.mjs"), "--stub", "--port", String(PORT)], { stdio: ["ignore", "pipe", "pipe"] });
await new Promise((resolve, reject) => {
  const t = setTimeout(() => reject(new Error("dev server did not start")), 8000);
  server.stdout.on("data", (d) => { if (String(d).includes("http://localhost")) { clearTimeout(t); resolve(); } });
  server.stderr.on("data", (d) => process.stderr.write(d));
});
const stubCalls = async () => (await fetch(`${BASE}/__stub`)).json();
const clearStub = () => fetch(`${BASE}/__stub`, { method: "DELETE" });

const browser = await chromium.launch();
// A stand-in for the Meta pixel: records every fbq call (the real one is not loaded without site.metaPixelId)
const FBQ = () => { window.__fbq = []; window.fbq = (...a) => window.__fbq.push(a); };

async function audit(page, label) {
  const r = await page.evaluate(() => {
    const ids = [...document.querySelectorAll("[id]")].map((e) => e.id);
    const dupes = ids.filter((id, i) => ids.indexOf(id) !== i);
    const unlabeled = [...document.querySelectorAll("input:not([type=hidden]):not([name=hp])")].filter((i) => {
      if (i.closest(".gc-opt,.chip-opt,.consent")) return !i.closest("label");
      return !(i.id && document.querySelector(`label[for="${i.id}"]`));
    }).map((i) => i.name);
    const noAlt = [...document.querySelectorAll("img")].filter((i) => !i.hasAttribute("alt")).map((i) => i.src);
    const wide = document.documentElement.scrollWidth > window.innerWidth + 1;
    const buttons = [...document.querySelectorAll("button,a.btn")].filter((b) => !(b.textContent.trim() || b.getAttribute("aria-label"))).length;
    const notes = [...document.querySelectorAll("body *:not(script):not(style)")].filter((e) => e.checkVisibility() && [...e.childNodes].some((c) => c.nodeType === 3 && /Illustration ·|sample (review|report|thank-you)|demo data/i.test(c.textContent))).map((e) => e.textContent.trim());
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

const tapOption = async (page, label) => {
  const step = page.locator(".gc-step:not([hidden])");
  await step.locator(".gc-opt", { hasText: label }).first().click();
};
const currentKey = (page) => page.locator(".gc-step:not([hidden])").getAttribute("data-key");
const waitStep = (page, key) => page.waitForSelector(`.gc-step[data-key="${key}"]:not([hidden])`, { timeout: 4000 });

/* ============ Phone: the qualified owner, end to end ============ */
{
  await clearStub();
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
  await page.addInitScript(FBQ);
  const t0 = Date.now();
  await page.goto(`${PAGES}?utm_source=facebook&utm_campaign=gap-test&fbclid=IwAR0testtesttesttest`, { waitUntil: "networkidle" });
  await page.screenshot({ path: path.join(SHOTS, "phone-01-first-screen.png") });

  const q1 = await page.locator(".gc-step[data-key=trade] .gc-q").boundingBox();
  const lastOpt = await page.locator(".gc-step[data-key=trade] .gc-opt").last().boundingBox();
  ok("phone: the first question and its answers show without scrolling", q1 && lastOpt && lastOpt.y + lastOpt.height <= 844, JSON.stringify(lastOpt));

  await tapOption(page, "HVAC and plumbing");
  await waitStep(page, "asks");
  ok("phone: a tap answers and moves on", (await currentKey(page)) === "asks");
  await page.screenshot({ path: path.join(SHOTS, "phone-02-question-2.png") });
  await tapOption(page, "When someone remembers"); await waitStep(page, "newest");
  await tapOption(page, "More than 3 months ago"); await waitStep(page, "replies");
  // Back works, and the answer stays chosen
  await page.locator(".gc-step:not([hidden]) .gc-back").click();
  await waitStep(page, "newest");
  ok("phone: back keeps the answer", await page.locator('.gc-step[data-key=newest] input[value="over3"]').isChecked());
  await page.locator(".gc-step:not([hidden]) .gc-next").click(); await waitStep(page, "replies");
  await tapOption(page, "Rarely"); await waitStep(page, "compare");
  await tapOption(page, "Haven't checked"); await waitStep(page, "jobs");
  await tapOption(page, "16 to 40"); await waitStep(page, "records");
  await tapOption(page, "Job software built for the trades"); await waitStep(page, "business");
  // The business step: nothing filled, then filled
  await page.locator(".gc-step:not([hidden]) .gc-next").click();
  ok("phone: an empty business step says what is missing", (await page.locator(".gc-step:not([hidden]) .err").textContent()).includes("business name"));
  await page.fill("#gc-company", "Maple Street Plumbing");
  await page.fill("#gc-city", "Springfield");
  await page.locator('.gc-step:not([hidden]) .chip-opt:has(input[value="1"])').click();
  await page.locator(".gc-step:not([hidden]) .gc-next").click();
  await waitStep(page, "contact");
  await page.fill("#gc-firstName", "Tom");
  await page.fill("#gc-email", "tom@maplestreet");
  await page.locator(".gc-step:not([hidden]) button[type=submit]").click();
  ok("phone: a bad email is caught before sending", (await page.locator(".gc-step:not([hidden]) .err").textContent()).includes("valid email"));
  await page.fill("#gc-email", "Tom@MapleStreet.com");
  await page.locator('.gc-step:not([hidden]) .consent').click();
  await page.screenshot({ path: path.join(SHOTS, "phone-03-contact.png") });
  const wait = 3600 - (Date.now() - t0);
  if (wait > 0) await page.waitForTimeout(wait);   // the page ignores a send in its first 3 seconds (a bot check)
  await page.locator(".gc-step:not([hidden]) button[type=submit]").click();
  await page.waitForSelector(".gc-result:not([hidden]) .score-n", { timeout: 6000 });
  await page.waitForTimeout(1200);
  const shown = (await page.locator(".score-n [data-count]").textContent()).trim();
  const tier = (await page.locator(".gc-result .tier").textContent()).trim();
  ok("phone: the score shows (79, Stalled engine)", shown === "79" && tier === "Stalled engine", `${shown} ${tier}`);
  ok("phone: three gaps listed", (await page.locator(".gaps li").count()) === 3);
  ok("phone: the report line names the business and city", (await page.locator(".next-box").textContent()).includes("Maple Street Plumbing") && (await page.locator(".next-box").textContent()).includes("Springfield"));
  await page.screenshot({ path: path.join(SHOTS, "phone-04-score.png") });

  let calls = await stubCalls();
  const stored = calls.find((c) => c.svc === "supabase" && c.body && c.body.payload && c.body.payload.form === "meta-gap-report");
  ok("phone: stored as meta-gap-report with the server's score and fit", stored && stored.body.payload.fields.score === 79 && stored.body.payload.fields.fit === "qualified", JSON.stringify(stored && stored.body.payload.fields));
  ok("phone: the campaign and fbclid are stored", stored && stored.body.payload.meta.utm_campaign === "gap-test" && stored.body.payload.meta.fbclid === "IwAR0testtesttesttest" && /^fb\.1\.\d+\.IwAR0testtesttesttest$/.test(stored.body.payload.meta.fbc || ""), JSON.stringify(stored && stored.body.payload.meta));
  const events = await page.evaluate(() => window.__rmEvents);
  const fbq = await page.evaluate(() => window.__fbq);
  const lead = events.find((e) => e.name === "Lead");
  const capiLead = calls.find((c) => c.svc === "meta" && c.body.data[0].event_name === "Lead");
  ok("phone: GapCheckStart, a GapCheckStep per question, GapReportRequested", events.some((e) => e.name === "GapCheckStart") && events.filter((e) => e.name === "GapCheckStep").length === 9 && events.some((e) => e.name === "GapReportRequested"), events.map((e) => e.name).join(","));
  ok("phone: Lead to the pixel with an event id", lead && /^lead-/.test(lead.eventID) && fbq.some((a) => a[0] === "track" && a[1] === "Lead" && a[3] && a[3].eventID === lead.eventID));
  ok("phone: the same Lead to the Conversions API, same event id", capiLead && lead && capiLead.body.data[0].event_id === lead.eventID, capiLead && capiLead.body.data[0].event_id);
  ok("phone: the server event carries hashed email and fbc", capiLead && /^[a-f0-9]{64}$/.test(capiLead.body.data[0].user_data.em[0]) && capiLead.body.data[0].user_data.fbc);
  ok("phone: the prospect's score email went out", calls.some((c) => c.svc === "resend" && c.body.to && c.body.to[0] === "tom@maplestreet.com" && /79\/100/.test(c.body.subject)));
  ok("phone: the owner was told", calls.some((c) => c.svc === "resend" && /New lead/.test(c.body.subject)) && calls.some((c) => c.svc === "slack"));

  // The last step: the call
  ok("phone: the call step says it is the last step", (await page.locator(".book-t").textContent()).startsWith("Last step"));
  const days = await page.locator("input[name=slotDay]").evaluateAll((els) => els.map((e) => e.value));
  const todayIso = await page.evaluate(() => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; });
  const weekend = await page.locator("input[name=slotDay]").evaluateAll((els) => els.some((e) => { const [y, m, d] = e.value.split("-").map(Number); const w = new Date(y, m - 1, d).getDay(); return w === 0 || w === 6; }));
  ok("phone: five weekdays from tomorrow, never today", days.length === 5 && !days.includes(todayIso) && !weekend, days.join(","));
  await page.locator(".book button[type=submit]").click();
  ok("phone: the call step asks for a day and a time first", (await page.locator(".book .err").textContent()).includes("day and a time"));
  await page.locator(".book .chip-opt").first().click();
  await page.locator('.book .chip-opt:has(input[value="morning"])').click();
  await page.fill("#bk-phone", "(512) 555-0134");
  await page.locator(".book .consent").first().click();
  await page.screenshot({ path: path.join(SHOTS, "phone-05-call-step.png") });
  await clearStub();
  await page.locator(".book button[type=submit]").click();
  await page.waitForSelector(".done-t", { timeout: 6000 });
  ok("phone: booked, with the day and the window", /You're booked: \w{3}, \w{3} \d+, morning/.test(await page.locator(".done-t").textContent()), await page.locator(".done-t").textContent());
  ok("phone: add-to-calendar is offered", (await page.locator('a[download="rempo-call.ics"]').count()) === 1);
  await page.screenshot({ path: path.join(SHOTS, "phone-06-booked.png"), fullPage: false });
  calls = await stubCalls();
  const ev2 = await page.evaluate(() => window.__rmEvents);
  const sched = ev2.find((e) => e.name === "Schedule");
  const capiSched = calls.find((c) => c.svc === "meta" && c.body.data[0].event_name === "Schedule");
  const call = calls.find((c) => c.svc === "supabase" && c.body.payload && c.body.payload.form === "meta-call");
  ok("phone: the call stored as meta-call with the slot and phone", call && call.body.payload.phone === "5125550134" && call.body.payload.fields.slotWindow === "morning" && call.body.payload.consent.consentPhone === true);
  ok("phone: Schedule to the pixel and the Conversions API, same event id", sched && capiSched && capiSched.body.data[0].event_id === sched.eventID && /^schedule-/.test(sched.eventID));
  ok("phone: the server Schedule carries the hashed phone", capiSched && /^[a-f0-9]{64}$/.test(capiSched.body.data[0].user_data.ph[0]));
  ok("phone: the prospect's booking email went out", calls.some((c) => c.svc === "resend" && c.body.to && /You're booked/.test(c.body.subject)));
  // A reload keeps the visit's place
  await page.reload({ waitUntil: "networkidle" });
  ok("phone: a reload keeps the booked state", (await page.locator(".done-t").count()) === 1);
  await audit(page, "phone /");
  ok("phone: no script errors", errors.length === 0, errors.join(" | "));
  await ctx.close();
}

/* ============ Phone: the sticky bar opens the Gap Check as a sheet, and gives the card back ============ */
{
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const page = await ctx.newPage();
  await page.goto(`${PAGES}/replies`, { waitUntil: "networkidle" });
  ok("/replies: its own headline", (await page.locator("h1").textContent()).includes("no reply"));
  ok("phone: the sticky bar hides while the card is on screen", !(await page.locator(".sticky-bar.show").count()));
  // past the card, at a section with no button of its own (the bar steps aside while one is on screen)
  await page.evaluate(() => document.querySelector("#leaks").scrollIntoView({ block: "start" }));
  await page.waitForTimeout(700);
  ok("phone: the sticky bar shows once the card is off screen", (await page.locator(".sticky-bar.show").count()) === 1);
  await page.locator(".sticky-bar .btn").click();
  await page.waitForTimeout(500);
  ok("phone: the sheet opens with the Gap Check inside", await page.evaluate(() => document.getElementById("gc-sheet").open && !!document.querySelector("#gc-sheet #gap-check")));
  await page.screenshot({ path: path.join(SHOTS, "phone-07-sheet.png") });
  await tapOption(page, "Plumbing");
  await waitStep(page, "asks");
  await page.locator(".dlg-x").click();
  await page.waitForTimeout(400);
  ok("phone: closing gives the card back to the hero, the answer kept", await page.evaluate(() => !!document.querySelector("#gc-home #gap-check") && document.querySelector('.gc-step[data-key=trade] input[value="plumbing"]').checked));
  await audit(page, "phone /replies");
  await ctx.close();
}

/* ============ PC: an owner on paper. The call-only route, and Meta hears nothing ============ */
{
  await clearStub();
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.addInitScript(FBQ);
  const t0 = Date.now();
  await page.goto(`${PAGES}/recent`, { waitUntil: "networkidle" });
  await page.screenshot({ path: path.join(SHOTS, "pc-01-recent.png") });
  ok("/recent: its own headline", (await page.locator("h1").textContent()).includes("fresh"));
  const box = await page.locator("#gap-check").boundingBox();
  ok("pc: the Gap Check sits in the first screen", box && box.y < 300);
  for (const [label, next] of [["HVAC", "asks"], ["We don't really ask", "newest"], ["This month", "replies"], ["Most of them", "compare"], ["Behind", "jobs"], ["5 to 15", "records"], ["Paper or spreadsheets", "business"]]) {
    await tapOption(page, label); await waitStep(page, next);
  }
  await page.fill("#gc-company", "Paper Trail HVAC");
  await page.fill("#gc-city", "Dayton");
  await page.locator('.gc-step:not([hidden]) .chip-opt:has(input[value="2"])').click();
  await page.locator(".gc-step:not([hidden]) .gc-next").click();
  await waitStep(page, "contact");
  await page.fill("#gc-firstName", "Ann");
  await page.fill("#gc-email", "ann@papertrail.com");
  await page.locator('.gc-step:not([hidden]) .consent input').check();
  const wait = 3600 - (Date.now() - t0);
  if (wait > 0) await page.waitForTimeout(wait);
  await page.keyboard.press("Enter");
  await page.waitForSelector(".gc-result:not([hidden]) .book-t", { timeout: 6000 });
  await page.waitForTimeout(1000);
  await page.screenshot({ path: path.join(SHOTS, "pc-02-paper-result.png") });
  const events = await page.evaluate(() => window.__rmEvents.map((e) => e.name));
  const calls = await stubCalls();
  ok("pc paper: GapReportRequested, but no Lead to the pixel", events.includes("GapReportRequested") && !events.includes("Lead"), events.join(","));
  ok("pc paper: no Conversions API call", !calls.some((c) => c.svc === "meta"));
  ok("pc paper: stored as no-software, call-only route", calls.some((c) => c.svc === "supabase" && c.body.payload && c.body.payload.fields.fit === "no-software" && /^call \(records\)/.test(c.body.payload.fields.route)));
  ok("pc paper: the call step explains why a call comes first", (await page.locator(".book-lead").textContent()).includes("paper or in spreadsheets"));
  await page.locator(".book .skip").click();
  ok("pc paper: 'just email me' ends calmly", (await page.locator(".done-t").textContent()).includes("all set"));
  await audit(page, "pc /recent");
  ok("pc: no script errors", errors.length === 0, errors.join(" | "));
  await ctx.close();
}

/* ============ Keyboard only ============ */
{
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await ctx.newPage();
  await page.goto(`${PAGES}/request`, { waitUntil: "networkidle" });
  ok("/request: its own headline", (await page.locator("h1").textContent()).includes("what your customer sees"));
  await page.locator('.gc-step[data-key=trade] input[value="hvac"]').focus();
  await page.keyboard.press("Space");
  await page.keyboard.press("Enter");
  await waitStep(page, "asks");
  ok("keyboard: Space chooses, Enter moves on", (await currentKey(page)) === "asks");
  ok("keyboard: focus moves to the new question", await page.evaluate(() => document.activeElement && document.activeElement.classList.contains("gc-q")));
  await page.keyboard.press("Tab");
  await page.keyboard.press("ArrowDown");
  ok("keyboard: arrow keys move the choice without leaving the question", (await currentKey(page)) === "asks");
  await page.keyboard.press("Enter");
  await waitStep(page, "newest");
  ok("keyboard: Enter after an arrow choice moves on", (await currentKey(page)) === "newest");
  await audit(page, "pc /request");
  await page.goto(`${PAGES}/request?view=preview`, { waitUntil: "networkidle" });
  ok("preview view: the {TBD} notes show", (await page.locator(".tbd:visible").count()) > 0);
  await page.goto(`${PAGES}/request`, { waitUntil: "networkidle" });
  ok("production view: no {TBD} note shows", (await page.locator(".tbd:visible").count()) === 0);
  await ctx.close();
}

/* ============ The mobile pass: what changes on a phone (under 600 px), and the PC page exactly as it was ============ */
{
  const { variants } = JSON.parse(readFileSync(path.join(ROOT, "content", "variants.json"), "utf8"));
  const COPY = JSON.parse(readFileSync(path.join(ROOT, "content", "copy.json"), "utf8"));
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
      const opts = [...document.querySelectorAll(".gc-step:not([hidden]) .gc-opt")];
      return { bottom: Math.round(Math.max(...opts.map((o) => o.getBoundingClientRect().bottom))), vh: innerHeight, lead: shown(".hero .lead"), frame: shown(".gc-frame > span") };
    }, shown.toString());
    ok(`phone ${label}: every answer to the first question shows in the first screen`, r.bottom <= r.vh, `${r.bottom} > ${r.vh}`);
    ok(`phone ${label}: the hero line written for phones`, r.lead.length === 1 && r.lead[0] === v.leadShort, JSON.stringify(r.lead));
    ok(`phone ${label}: the Gap Check's short opening line`, r.frame.length === 1 && r.frame[0] === COPY.check.frameShort, JSON.stringify(r.frame));
  }
  await pp.goto(PAGES, { waitUntil: "networkidle" });
  const m = await pp.evaluate(() => {
    const cta = document.querySelector("#report .sec-cta .btn").getBoundingClientRect();
    return {
      consent: getComputedStyle(document.querySelector(".consent input")).width,
      ctaH: Math.round(cta.height), ctaW: Math.round(cta.width), wrapW: Math.round(document.querySelector("#report .wrap").clientWidth - 40),
      phoneBar: getComputedStyle(document.querySelector(".svc-grid .phone-bar")).display,
      reveal: getComputedStyle(document.querySelector("#faq .reveal")).opacity,
      ptImg: Math.round(document.querySelector(".pt-img").getBoundingClientRect().height)
    };
  });
  ok("phone: checkboxes are 32 px", m.consent === "32px", m.consent);
  ok("phone: a section's button is 56 px tall and full width", m.ctaH >= 56 && m.ctaW >= m.wrapW, `${m.ctaH} x ${m.ctaW}`);
  ok("phone: no phone inside the phone (the request is a card)", m.phoneBar === "none");
  ok("phone: nothing waits on a scroll animation", m.reveal === "1", m.reveal);
  ok("phone: micro visuals beside the headings", m.ptImg <= 64, String(m.ptImg));
  await pp.evaluate(() => document.querySelector("#faq").scrollIntoView({ block: "start" }));
  await pp.waitForTimeout(400);
  ok("phone: the sticky bar shows between the page's own buttons", await pp.evaluate(() => document.querySelector(".sticky-bar").classList.contains("show")));
  await pp.evaluate(() => document.querySelector("#report .sec-cta").scrollIntoView({ block: "center" }));
  await pp.waitForTimeout(400);
  ok("phone: the sticky bar steps aside while a section's own button is on screen", await pp.evaluate(() => !document.querySelector(".sticky-bar").classList.contains("show")));
  await audit(pp, "phone mobile pass");
  await phone.close();

  // PC: the words, the phone and the motion as they were
  const pc = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const cp = await pc.newPage();
  for (const v of variants) {
    const label = v.slug ? `/${v.slug}` : "/";
    await cp.goto(urlOf(v), { waitUntil: "networkidle" });
    const r = await cp.evaluate((shownSrc) => {
      const shown = new Function(`return ${shownSrc}`)();
      return { lead: shown(".hero .lead"), frame: shown(".gc-frame > span"), mOnly: shown(".m-only").length };
    }, shown.toString());
    ok(`pc ${label}: the full hero line, as before`, r.lead.length === 1 && r.lead[0] === v.lead, JSON.stringify(r.lead));
    ok(`pc ${label}: the full opening line, as before`, r.frame.length === 1 && r.frame[0] === COPY.check.frame, JSON.stringify(r.frame));
    ok(`pc ${label}: no phone-only words show`, r.mOnly === 0);
  }
  ok("pc: the request is still shown on a phone", await cp.evaluate(() => getComputedStyle(document.querySelector(".svc-grid .phone-bar")).display !== "none"));
  await pc.close();
}

await browser.close();
server.kill();
console.log(`check-page: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
