#!/usr/bin/env node
/**
 * Every form in a real browser. Serves the built site the way Vercel does, with ../../api/lead.mjs answering /api/lead
 * (in front of a stand-in for Supabase; Resend and Slack stubbed). On each page it fills every form like a visitor and
 * sends it, then checks: the lead reached /api/lead as JSON with what was typed; it was stored; both notices went out;
 * the page told the visitor something. A form whose email is optional and that asks for a phone is also sent with the
 * email left empty (pages from the gtm-landing-page generator), and must be stored by its phone. Then once more with everything failing (a 502): the page must say so and let
 * the visitor send again. Installed by the landing-page-lead-capture skill.
 *
 *   node lead-capture/tests/check-forms.mjs [--root public] [--pages /,/contact] [--skip "#search"] [--wait 3200]
 *
 *   --root    the folder Vercel serves (default: vercel.json's outputDirectory, else the project root, else public/)
 *   --pages   the pages to test (default: every .html page at the top of the root)
 *   --skip    a CSS selector for forms that are not lead forms (also skipped: data-lead-skip, role=search, login forms)
 *   --wait    ms after the page opens before sending (default 3200: pages often ignore a form sent in its first 3 s)
 * Needs Playwright: the project's own, or PLAYWRIGHT_MODULE=/path/to/node_modules/playwright. Chromium comes from
 * Playwright, or CHROMIUM_PATH.
 */
import { createServer } from "node:http";
import { createRequire } from "node:module";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join, extname, normalize, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const PROJECT = fileURLToPath(new URL("../..", import.meta.url));
const arg = (name, dflt) => { const i = process.argv.indexOf(`--${name}`); return i > -1 ? process.argv[i + 1] : dflt; };
const WAIT = +arg("wait", 3200);
const SKIP = arg("skip", "");

let pass = 0, fail = 0, warn = 0;
const ok = (name, cond, info = "") => { if (cond) { pass++; console.log(`ok   ${name}`); } else { fail++; console.log(`FAIL ${name}${info ? `: ${info}` : ""}`); } };
const note = (name, info) => { warn++; console.log(`WARN ${name}${info ? `: ${info}` : ""}`); };

/* ---------- The folder Vercel serves, and its pages ---------- */
function staticRoot() {
  if (arg("root")) return join(PROJECT, arg("root"));
  try { const v = JSON.parse(readFileSync(join(PROJECT, "vercel.json"), "utf8")); if (v.outputDirectory) return join(PROJECT, v.outputDirectory); } catch { /* none */ }
  if (existsSync(join(PROJECT, "index.html"))) return PROJECT;
  if (existsSync(join(PROJECT, "public", "index.html"))) return join(PROJECT, "public");
  return PROJECT;
}
const ROOT = staticRoot();
if (!existsSync(join(ROOT, "index.html"))) { console.log(`FAIL no index.html in ${ROOT}: build the site first, or pass --root`); process.exit(1); }
const PAGES = arg("pages") ? arg("pages").split(",").map((s) => s.trim()) : ["/", ...readdirSync(ROOT).filter((f) => f.endsWith(".html") && f !== "index.html" && f !== "404.html").slice(0, 10).map((f) => "/" + f.replace(/\.html$/, ""))];

/* ---------- Stand-ins: Supabase (its REST API), Resend and Slack ---------- */
const stored = [], notices = [];
let failing = false;
const supabase = createServer(async (req, res) => {
  let body = ""; for await (const c of req) body += c;
  if (req.url.endsWith("/rpc/lead_capture_health")) { res.writeHead(200, { "content-type": "application/json" }); return res.end('"lead-capture v1"'); }
  if (req.url.endsWith("/rpc/submit_lead")) {
    if (failing) { res.writeHead(500, { "content-type": "application/json" }); return res.end('{"message":"stand-in failure"}'); }
    stored.push(JSON.parse(body).payload);
    res.writeHead(200, { "content-type": "application/json" }); return res.end(JSON.stringify(`00000000-0000-4000-8000-${String(stored.length).padStart(12, "0")}`));
  }
  res.writeHead(404); res.end();
});
await new Promise((r) => supabase.listen(0, "127.0.0.1", r));
Object.assign(process.env, {
  SUPABASE_URL: `http://127.0.0.1:${supabase.address().port}`, SUPABASE_ANON_KEY: "sb_publishable_smoke",
  RESEND_API_KEY: "re_smoke", LEAD_NOTIFY_FROM: "Smoke <smoke@example.com>", LEAD_NOTIFY_TO: "owner@example.com",
  SLACK_WEBHOOK_URL: "https://hooks.slack.com/services/T0/B0/SMOKE"
});
const realFetch = globalThis.fetch;
globalThis.fetch = async (url, init) => {
  const u = String(url);
  if (u.startsWith("https://api.resend.com/") || u.startsWith("https://hooks.slack.com/")) {
    if (failing) return new Response("stand-in failure", { status: 500 });
    notices.push({ to: u.includes("resend") ? "email" : "slack", body: JSON.parse(init.body) });
    return new Response(u.includes("resend") ? '{"id":"e1"}' : "ok", { status: 200 });
  }
  return realFetch(url, init);
};
const quiet = console.error; console.error = () => {};   // the endpoint logs the failures this test causes on purpose

/* ---------- The site, served the way Vercel serves it ---------- */
const { default: lead } = await import(pathToFileURL(join(PROJECT, "api", "lead.mjs")).href);
const TYPES = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".mjs": "text/javascript", ".css": "text/css", ".json": "application/json", ".svg": "image/svg+xml", ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp", ".avif": "image/avif", ".gif": "image/gif", ".ico": "image/x-icon", ".woff2": "font/woff2", ".woff": "font/woff", ".mp4": "video/mp4", ".webm": "video/webm", ".txt": "text/plain", ".xml": "application/xml" };
const site = createServer(async (req, res) => {
  const path = decodeURIComponent(new URL(req.url, "http://x").pathname);
  if (path === "/api/lead") return lead(req, res);
  const rel = normalize(path).replace(/^([/\\])+/, "");
  if (rel.split(sep).includes("..")) { res.writeHead(400); return res.end(); }
  for (const f of [join(ROOT, rel), join(ROOT, rel + ".html"), join(ROOT, rel, "index.html")]) {
    if (existsSync(f) && statSync(f).isFile()) {
      res.writeHead(200, { "content-type": TYPES[extname(f).toLowerCase()] || "application/octet-stream", "cache-control": "no-store" });
      return res.end(await readFile(f));
    }
  }
  res.writeHead(404, { "content-type": "text/plain" }); res.end("Not found");
});
await new Promise((r) => site.listen(0, "127.0.0.1", r));
const BASE = `http://127.0.0.1:${site.address().port}`;

/* ---------- Playwright: the project's own, or the one named ---------- */
async function playwright() {
  const tries = [process.env.PLAYWRIGHT_MODULE];
  for (const dir of [PROJECT, join(PROJECT, "source"), process.cwd()]) { try { tries.push(createRequire(join(dir, "noop.js")).resolve("playwright")); } catch { /* not here */ } }
  for (const t of tries.filter(Boolean)) { try { const m = await import(pathToFileURL(t).href); const pw = m.chromium ? m : m.default; if (pw && pw.chromium) return pw; } catch { /* next */ } }
  return null;
}
const pw = await playwright();
if (!pw) { console.log("FAIL Playwright not found. In the project: npm i --no-save playwright. Or install it anywhere (npm i --prefix /tmp/pw playwright) and run with PLAYWRIGHT_MODULE=/tmp/pw/node_modules/playwright/index.js"); process.exit(1); }
async function launch() {
  try { return await pw.chromium.launch(); } catch (e) {
    const paths = [process.env.CHROMIUM_PATH];
    try { for (const d of readdirSync("/opt/pw-browsers")) paths.push(join("/opt/pw-browsers", d, "chrome-linux", "chrome")); } catch { /* none */ }
    for (const p of paths.filter((x) => x && existsSync(x))) { try { return await pw.chromium.launch({ executablePath: p }); } catch { /* next */ } }
    throw e;
  }
}
const browser = await launch();

// Fills form number i like a visitor; returns what it typed. Skips hidden fields and the bot trap.
function fill({ i, n, noEmail }) {
  const f = document.querySelectorAll("form")[i];
  const trap = (el) => el.type === "hidden" || el.tabIndex === -1 || el.closest("[aria-hidden=true]") || /^(hp|_hp|honeypot|_gotcha|bot_?field)$/i.test(el.name || "");
  const set = (el, v) => {
    const d = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el), "value");
    d && d.set ? d.set.call(el, v) : (el.value = v);
    el.dispatchEvent(new Event("input", { bubbles: true })); el.dispatchEvent(new Event("change", { bubbles: true }));
  };
  const typed = {};
  for (const el of f.querySelectorAll("input, select, textarea")) {
    const key = (el.name || el.id || "").toLowerCase(), t = (el.type || "").toLowerCase();
    if (!key || el.disabled || trap(el) || ["submit", "button", "reset", "image", "file"].includes(t)) continue;
    if (el.tagName === "SELECT") { const o = [...el.options].find((x) => x.value && !x.disabled); if (o) { el.value = o.value; el.dispatchEvent(new Event("change", { bubbles: true })); typed[key] = o.value; } continue; }
    if (t === "checkbox") { if (!el.checked) el.click(); typed[key] = true; continue; }
    if (t === "radio") { const g = f.querySelectorAll(`input[type=radio][name="${CSS.escape(el.name)}"]`); if (![...g].some((r) => r.checked)) g[0].click(); continue; }
    let v;
    if (t === "email" || /e-?mail/.test(key)) { if (noEmail) continue; v = `smoke+${n}@example.com`; }
    else if (t === "tel" || /phone|mobile|tel/.test(key)) v = "5035550123";
    else if (t === "url" || /website|url|site/.test(key)) v = "https://example.com";
    else if (t === "number" || t === "range") v = el.min || "1";
    else if (t === "date") v = "2026-01-15";
    else if (el.tagName === "TEXTAREA" || /message|comment|note|detail|question/.test(key)) v = "Smoke test, please ignore.";
    else if (/company|organi[sz]ation|business/.test(key)) v = "Smoke Test Co";
    else if (/name/.test(key)) v = "Smoke Test";
    else v = "Smoke test";
    set(el, v); typed[key] = v;
  }
  return typed;
}
const visibleText = () => document.body.innerText.split("\n").map((s) => s.trim()).filter(Boolean);

async function send(page, i, n, opened, noEmail = false) {
  const typed = await page.evaluate(fill, { i, n, noEmail });
  const left = WAIT - (Date.now() - opened);
  if (left > 0) await page.waitForTimeout(left);
  const before = new Set(await page.evaluate(visibleText));
  const reqP = page.waitForRequest((r) => new URL(r.url()).pathname === "/api/lead" && r.method() === "POST", { timeout: 8000 }).catch(() => null);
  await page.evaluate((k) => {
    const f = document.querySelectorAll("form")[k];
    const b = f.querySelector('[type=submit], button:not([type])');
    if (f.requestSubmit) f.requestSubmit(b || undefined); else f.submit();
  }, i);
  const req = await reqP;
  const resp = req ? await req.response().catch(() => null) : null;
  await page.waitForTimeout(900);
  const after = await page.evaluate(visibleText).catch(() => []);
  const said = after.filter((l) => !before.has(l)).join(" | ").slice(0, 160);
  const button = await page.evaluate((k) => { const b = document.querySelectorAll("form")[k]?.querySelector('[type=submit], button:not([type])'); return b ? !b.disabled : null; }, i).catch(() => null);
  let body = null; try { body = req ? JSON.parse(req.postData() || "null") : null; } catch { body = null; }
  return { typed, req, status: resp ? resp.status() : 0, body, said, button };
}

/* ---------- Each page, each form ---------- */
{
  const r = await realFetch(`${BASE}/api/lead`);
  const h = await r.json();
  ok("GET /api/lead answers on the local server: ready", r.status === 200 && h.ready === true, JSON.stringify(h.database));
}
let n = 0;
for (const path of PAGES) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  // The clock starts once the page has loaded: a form ignores a send within its first seconds (a bot check, timed from
  // when its script ran), so a clock started before a slow load would send too early and see no request
  let opened = 0, fresh = true;
  const r = await page.goto(BASE + path, { waitUntil: "load" });
  opened = Date.now();
  if (!r || r.status() !== 200) { ok(`${path} opens`, false, String(r && r.status())); await ctx.close(); continue; }
  const forms = await page.$$eval("form", (fs, skip) => fs.map((f, i) => {
    const email = [...f.querySelectorAll("input")].find((el) => el.type === "email" || /e-?mail/i.test(el.name || ""));
    const phone = [...f.querySelectorAll("input")].find((el) => el.type === "tel" || /phone|mobile|tel/i.test(el.name || ""));
    return { i, name: f.getAttribute("data-lead-form") || f.id || `form ${i + 1}`, phoneOnly: Boolean(email && !email.required && phone),
      skip: f.hasAttribute("data-lead-skip") || f.getAttribute("role") === "search" || !!f.querySelector("input[type=password]") || (skip && f.matches(skip)) };
  }), SKIP);
  if (!forms.length) { console.log(`--   ${path}: no forms`); await ctx.close(); continue; }
  for (const form of forms) {
    const tag = `${path} ${form.name}`;
    if (form.skip) { console.log(`--   ${tag}: skipped (not a lead form)`); continue; }
    n++;
    if (!fresh) { await page.goto(BASE + path, { waitUntil: "load" }); opened = Date.now(); }
    fresh = false;
    const s0 = stored.length, n0 = notices.length;
    const got = await send(page, form.i, n, opened);
    if (!got.req) { ok(`${tag}: posts to /api/lead`, false, "no request to /api/lead: this form is not wired"); continue; }
    ok(`${tag}: posts JSON to /api/lead and gets 200`, got.status === 200 && got.body && typeof got.body === "object", `${got.status} ${String(got.req.postData()).slice(0, 120)}`);
    const contact = Object.entries(got.typed).find(([k]) => /e-?mail/.test(k)) || Object.entries(got.typed).find(([k]) => /phone|tel|mobile/.test(k));
    ok(`${tag}: sends what the visitor typed`, contact && JSON.stringify(got.body || {}).includes(contact[1]), `typed ${JSON.stringify(got.typed)}, sent ${String(got.req.postData()).slice(0, 200)}`);
    const saved = stored.slice(s0);
    ok(`${tag}: the lead is stored with its contact details`, saved.length === 1 && (saved[0].email || saved[0].phone), JSON.stringify(saved[0] || null));
    const sent = notices.slice(n0);
    ok(`${tag}: email and Slack notices go out`, sent.some((x) => x.to === "email") && sent.some((x) => x.to === "slack"), sent.map((x) => x.to).join(", ") || "none");
    if (got.said) console.log(`     page said: "${got.said}"`); else note(`${tag}: the page showed nothing new after sending`, "check its thank-you message");

    // Email optional, phone asked: a visitor who leaves the email empty must still become a lead, reachable by phone
    if (form.phoneOnly) {
      await page.goto(BASE + path, { waitUntil: "load" });
      opened = Date.now();
      const s1 = stored.length;
      const po = await send(page, form.i, n, opened, true);
      const lead = stored[s1];
      ok(`${tag}: a phone-only lead (email left empty) is stored by its phone`, po.status === 200 && lead && lead.phone && !lead.email, `${po.status} ${JSON.stringify(lead || null)}`);
    }

    // Everything failing: the page says so, and the visitor can send again
    failing = true;
    await page.goto(BASE + path, { waitUntil: "load" });
    opened = Date.now();
    const bad = await send(page, form.i, n, opened);
    failing = false;
    if (!bad.req) { note(`${tag}: no second request in the failure run`, ""); continue; }
    ok(`${tag}: a failure reaches the page as an error (502)`, bad.status === 502, String(bad.status));
    if (bad.said) console.log(`     page said on failure: "${bad.said}"`); else note(`${tag}: the page showed nothing when sending failed`, "the visitor would think it worked");
    if (bad.button === false) note(`${tag}: the send button stays disabled after a failure`, "the visitor cannot try again");
  }
  ok(`${path}: no script errors`, errors.length === 0, errors.join(" | "));
  await ctx.close();
}
if (!n) ok("at least one lead form was tested", false, `no lead forms on ${PAGES.join(", ")}`);

await browser.close();
site.close(); supabase.close();
console.error = quiet;
console.log(`check-forms: ${pass} passed, ${fail} failed, ${warn} warning(s)`);
process.exit(fail ? 1 : 0);
