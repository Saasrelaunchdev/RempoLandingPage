// End to end, in Chromium, against the local server with fake AI (no keys, no network): sign in to /admin, add a case
// study from pasted text and a video testimonial, and see both on the landing page and on the new case study's page.
//   npm run test:e2e        (needs Playwright with Chromium: npx playwright install chromium)
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

process.env.PROOF_STORE_DIR = mkdtempSync(join(tmpdir(), "proof-e2e-"));
process.env.PROOF_FAKE_AI = "1";
process.env.PROOF_FAKE_DELAY_MS = "100";
process.env.ADMIN_PASSWORD = "e2e-admin-password";
const { start } = await import("../dev-server.mjs");
const { chromium } = createRequire(import.meta.url)("playwright");
const VIDEO = fileURLToPath(new URL("../../media/testimonials/german-aquino.mp4", import.meta.url));

let server, browser, base;
before(async () => {
  server = await start(0);
  base = `http://localhost:${server.address().port}`;
  browser = await chromium.launch();
});
after(async () => { await browser?.close(); server?.close(); });

const STORY = `Bayside Roofing located in Pacifica, California

Bayside Roofing went from 12 to 40 Google reviews in three months with Rempo.

The crew asked customers for reviews, but few followed through. Rempo sent each customer a review request after the job and a reminder to anyone who had not left one. In three months, Bayside Roofing received 28 new Google reviews.`;

async function signIn(page) {
  await page.goto(`${base}/admin`);
  await page.fill("input[name=password]", process.env.ADMIN_PASSWORD);
  await page.click("#login-form button");
  await page.waitForSelector("#app:not([hidden]) .adm-row");
}
const jobDone = (page) => page.waitForFunction(() => {
  const p = document.querySelector(".adm-job .adm-job-head .adm-pill");
  return p && !/is-working/.test(p.className) && !/Uploading/.test(p.textContent);
}, null, { timeout: 120000 });

test("the landing page starts with the seed: two case studies and one video", async () => {
  const page = await browser.newPage();
  await page.goto(base + "/");
  assert.equal(await page.locator("#results .cs-card").count(), 2);
  assert.equal(await page.locator("#testimonials [data-vt]").count(), 1);
  assert.match(await page.getAttribute("#results", "data-proof-version"), /^[0-9a-f]{12}$/);
  await page.close();
});

test("a pasted case study is written, checked, published and shown on the landing page", async () => {
  const page = await browser.newPage();
  await signIn(page);
  await page.click("#paste-box summary");
  await page.fill("#paste", STORY);
  await page.click("#paste-go");
  await jobDone(page);
  assert.match(await page.textContent(".adm-job .adm-job-head .adm-pill"), /1 published/);
  assert.equal(await page.locator(".adm-row", { hasText: "From 12 to 40 Google reviews" }).count(), 1);

  const home = await browser.newPage();
  await home.goto(base + "/");
  await home.waitForFunction(() => document.querySelectorAll("#results .cs-card").length === 3, null, { timeout: 15000 });
  const card = home.locator("#results .cs-card", { hasText: "Bayside Roofing" });
  assert.equal(await card.count(), 1);
  await home.waitForSelector("#results .cs-card >> nth=2 >> .s3d .s3d-cam", { state: "attached" });   // its 3D stack was built
  assert.match(await home.textContent("#results .sec-head .lead"), /^Three home-service businesses/);

  const href = await card.getAttribute("href");
  const cs = await browser.newPage();
  const res = await cs.goto(base + href);
  assert.equal(res.status(), 200);
  assert.match(await cs.textContent("h1"), /From 12 to 40 Google reviews in three months\./);
  assert.match(await cs.textContent("body"), /Every business is different, and Rempo never promises a number of reviews\./);
  await Promise.all([page.close(), home.close(), cs.close()]);
});

test("a dropped video gets captions, a cover and a face, and goes on the landing page", async () => {
  const page = await browser.newPage();
  await signIn(page);
  // the seed already has this person's video; take it down so the new one can publish by itself
  page.on("dialog", (d) => d.accept());
  await page.click(".adm-tabs [data-kind=video]");
  await page.locator(".adm-row", { hasText: "German Aquino" }).locator("[data-delete]").click();
  await page.waitForFunction(() => document.querySelectorAll("#list .adm-row").length === 0);

  await page.setInputFiles("#file", VIDEO);
  await jobDone(page);
  assert.match(await page.textContent(".adm-job .adm-job-head .adm-pill"), /Published/);
  for (const step of ["Reading the video", "Looking at the video", "Transcribing what was said", "Making the web version", "Checking names and picking the quote", "Saving the video"]) {
    assert.equal(await page.locator(".adm-job .adm-steps li.is-done", { hasText: step }).count(), 1, step);
  }

  const home = await browser.newPage();
  await home.goto(base + "/");
  await home.waitForFunction(() => { const s = document.querySelector("#testimonials [data-vt] source"); return s && s.getAttribute("src").startsWith("/__store/"); }, null, { timeout: 15000 });
  const vtt = await home.locator("#testimonials [data-vt] track").getAttribute("src");
  const captions = await (await home.request.get(base + vtt)).text();
  assert.match(captions, /^WEBVTT/);
  assert.match(captions, /German Aquino/);   // the misheard name, fixed
  await Promise.all([page.close(), home.close()]);
});
