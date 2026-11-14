// The page in a real browser (Chromium through Playwright), on demo data: the hero search, the free preview, the
// locked part, the unlock form, the full race, the copy buttons, the booking, and the results link. Phone (390 px)
// and desktop. Screenshots go to tests/shots/ (not committed).
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { ok, section, report } from "./harness.mjs";

process.env.RACE_FAKE = "1";
process.env.RACE_STORE = "memory";
process.env.RACE_IP_DAILY = "50"; // every race in this file comes from the same network
const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const SHOTS = path.join(ROOT, "tests/shots");
fs.mkdirSync(SHOTS, { recursive: true });

let chromium;
try { ({ chromium } = createRequire(import.meta.url)("playwright")); } catch {
  console.log("page.test: Playwright is not installed here; skipped (npm i -D playwright, then npx playwright install chromium)");
  process.exit(0);
}
const { createServer } = await import("../tools/dev.mjs");
const server = createServer();
await new Promise((r) => server.listen(0, r));
const BASE = `http://localhost:${server.address().port}`;
const browser = await chromium.launch();

async function run(name, ctxOptions) {
  const ctx = await browser.newContext({ ...ctxOptions, permissions: ["clipboard-read", "clipboard-write"] });
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
  await page.goto(`${BASE}/`);
  await section(`${name}: the hero search starts the race`, async () => {
    ok(`${name}: hero headline`, await page.getByRole("heading", { level: 1 }).isVisible());
    ok(`${name}: demo banner shown`, await page.locator(".rr-demo").isVisible());
    const input = page.locator("#hero-race-input");
    await input.click();
    await input.pressSequentially("Maple", { delay: 30 });
    await page.locator("#hero-race-list .rr-option").first().waitFor();
    ok(`${name}: suggestions listed`, (await page.locator("#hero-race-list .rr-option").count()) >= 1);
    ok(`${name}: combobox expanded`, (await input.getAttribute("aria-expanded")) === "true");
    await page.locator("#hero-race-list .rr-option").first().click();
    await page.locator(".rr-preview .rr-board-row").nth(3).waitFor({ timeout: 10000 });
    ok(`${name}: four rows on the board`, (await page.locator(".rr-board-row").count()) === 4);
    ok(`${name}: the owner row is marked`, /Maple Street Plumbing/.test(await page.locator(".rr-board-row.is-you").innerText()));
    ok(`${name}: the gap line`, /186/.test(await page.locator(".rr-preview .rr-gap").innerText()));
    await page.getByText("We wrote replies to 3").waitFor({ timeout: 10000 });
    ok(`${name}: the locked counts arrive`, /22 of your last 32 reviews have no reply/.test(await page.locator(".rr-locked").innerText()));
    if (ctxOptions.isMobile) {
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      ok(`${name}: no sideways scroll`, overflow <= 0, overflow);
    }
    await page.locator(".rr-stage").screenshot({ path: path.join(SHOTS, `${name}-1-preview.png`) });
  });
  await section(`${name}: the unlock form`, async () => {
    await page.locator(".rr-locked button[type=submit]").click();
    ok(`${name}: first name asked for`, /first name/i.test(await page.locator(".rr-locked .rr-error").innerText()));
    await page.getByLabel("First name", { exact: true }).fill("Tom");
    await page.getByLabel("Email", { exact: true }).fill("tom@example.com");
    await page.locator(".rr-locked button[type=submit]").click();
    ok(`${name}: consent asked for`, /tick the box/i.test(await page.locator(".rr-locked .rr-error").innerText()));
    await page.locator(".rr-locked input[name=consentEmail]").check();
    await page.locator(".rr-locked button[type=submit]").click();
    await page.locator(".rr-fixes li").nth(2).waitFor({ timeout: 15000 });
    ok(`${name}: three fixes`, (await page.locator(".rr-fixes li").count()) === 3);
    ok(`${name}: three drafts`, (await page.locator(".rr-draft").count()) === 3);
    ok(`${name}: four areas`, (await page.locator(".rr-area").count()) === 4);
    ok(`${name}: the race bars`, (await page.locator(".rr-bars li").count()) === 4);
    ok(`${name}: the results link is in the address`, /[?&]r=/.test(page.url()));
    ok(`${name}: a call-first note`, (await page.locator(".rr-callfirst").count()) >= 1);
    await page.locator(".rr-copy").first().click();
    const confirmed = await page.locator(".rr-copy", { hasText: "Copied" }).first().waitFor({ timeout: 3000 }).then(() => true, () => false);
    ok(`${name}: copy confirms`, confirmed);
    const copied = await page.evaluate(() => navigator.clipboard.readText().catch(() => ""));
    const firstReply = await page.locator(".rr-reply").first().innerText();
    ok(`${name}: the reply is on the clipboard`, copied.trim() === firstReply.trim(), copied.slice(0, 60));
    if (ctxOptions.isMobile) {
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      ok(`${name}: no sideways scroll on the results`, overflow <= 0, overflow);
    }
  });
  await section(`${name}: booking`, async () => {
    await page.locator(".rr-slot").nth(1).waitFor({ timeout: 10000 });
    ok(`${name}: days to pick from`, (await page.locator(".rr-day").count()) === 5);
    await page.locator(".rr-book button[type=submit]").click();
    ok(`${name}: a time asked for`, /pick a time/i.test(await page.locator(".rr-book .rr-error").innerText()));
    await page.locator(".rr-slot").nth(1).click();
    await page.getByLabel("Best number to call").fill("217-555-0142");
    await page.locator(".rr-book input[name=consentCall]").check();
    await page.locator(".rr-book button[type=submit]").click();
    await page.locator(".rr-book .rr-done").waitFor({ timeout: 10000 });
    ok(`${name}: booked`, /You're booked/.test(await page.locator(".rr-book .rr-done").innerText()));
    ok(`${name}: add to calendar`, (await page.locator(".rr-book a[download]").count()) === 1);
    await page.screenshot({ path: path.join(SHOTS, `${name}-2-results.png`), fullPage: true });
  });
  await section(`${name}: the results link`, async () => {
    await page.reload();
    await page.locator(".rr-fixes li").nth(2).waitFor({ timeout: 10000 });
    ok(`${name}: the saved race opens`, (await page.locator(".rr-draft").count()) === 3);
    ok(`${name}: the booking is remembered`, /You're booked/.test(await page.locator(".rr-book").innerText()));
  });
  await section(`${name}: the section's own search, by keyboard`, async () => {
    await page.goto(`${BASE}/`);
    const input = page.locator("#review-race-search-input");
    await input.click();
    await input.pressSequentially("Cardinal", { delay: 30 });
    await page.locator("#review-race-search-list .rr-option").first().waitFor();
    await input.press("Enter");
    await page.locator(".rr-board-row").nth(3).waitFor({ timeout: 10000 });
    ok(`${name}: keyboard pick works`, /Cardinal Heating/.test(await page.locator(".rr-board-row.is-you").innerText()));
    const unlabelled = await page.evaluate(() => [...document.querySelectorAll(".rr input:not(.rr-hp):not([type=checkbox])")].filter((i) => !i.labels || !i.labels.length).map((i) => i.id));
    ok(`${name}: every field has a label`, unlabelled.length === 0, unlabelled);
  });
  await section(`${name}: the case studies and the owner's video`, async () => {
    await page.locator("#results .cs-card").first().scrollIntoViewIfNeeded();
    ok(`${name}: two case studies`, (await page.locator("#results .cs-card").count()) === 2);
    ok(`${name}: Junkaway and Ranchero`, /Junkaway/.test(await page.locator("#results").innerText()) && /Ranchero Plumbing/.test(await page.locator("#results").innerText()));
    const hrefs = await page.locator("#results .cs-card").evaluateAll((els) => els.map((e) => e.getAttribute("href")));
    ok(`${name}: the case studies open on the landing page`, hrefs.every((h) => /^https:\/\/rempo\.io\/case-studies\/[a-z-]+\/$/.test(h)), hrefs);
    await page.locator("#testimonials").scrollIntoViewIfNeeded();
    ok(`${name}: German Aquino's video`, (await page.locator("#testimonials video").count()) >= 1 && /German Aquino/.test(await page.locator("#testimonials").innerText()));
    const poster = await page.locator("#testimonials video").first().getAttribute("poster");
    const res = await page.request.get(`${BASE}${poster}`);
    ok(`${name}: the video's picture loads`, res.ok(), poster);
    if (ctxOptions.isMobile) {
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      ok(`${name}: no sideways scroll with the proof`, overflow <= 0, overflow);
    }
  });
  await section(`${name}: the SerpApi search (no Google key): type, Find, pick`, async () => {
    process.env.RACE_SEARCH = "maps";
    try {
      await page.goto(`${BASE}/`);
      const input = page.locator("#review-race-search-input");
      await page.locator(".rr-search .rr-btn-find").waitFor();
      ok(`${name}: the Find button shows`, await page.locator(".rr-search .rr-btn-find").isVisible());
      await input.fill("Cardinal Heating Springfield");
      await page.waitForTimeout(400);
      ok(`${name}: nothing searched while typing`, (await page.locator("#review-race-search-list .rr-option").count()) === 0);
      await page.locator(".rr-search .rr-btn-find").click();
      await page.locator("#review-race-search-list .rr-option").first().waitFor();
      await page.locator("#review-race-search-list .rr-option").first().click();
      await page.locator(".rr-board-row").nth(3).waitFor({ timeout: 10000 });
      ok(`${name}: Find then pick starts the race`, /Cardinal Heating/.test(await page.locator(".rr-board-row.is-you").innerText()));
      await page.goto(`${BASE}/`);
      const hero = page.locator("#hero-race-input");
      await hero.fill("Maple Street Springfield");
      await hero.press("Enter");
      await page.locator("#hero-race-list .rr-option").first().waitFor();
      await page.locator("#hero-race-list .rr-option").first().click();
      await page.locator(".rr-board-row").nth(3).waitFor({ timeout: 10000 });
      ok(`${name}: the hero finds and starts too`, /Maple Street Plumbing/.test(await page.locator(".rr-board-row.is-you").innerText()));
      if (ctxOptions.isMobile) {
        const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
        ok(`${name}: no sideways scroll`, overflow <= 0, overflow);
      }
    } finally {
      delete process.env.RACE_SEARCH;
    }
  });
  ok(`${name}: no errors in the console`, errors.length === 0, errors);
  await ctx.close();
}

await run("phone", { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
await run("desktop", { viewport: { width: 1280, height: 900 } });
await browser.close();
server.close();
report("page.test");
