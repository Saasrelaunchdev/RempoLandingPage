#!/usr/bin/env node
/**
 * The built pages: ../customers/ is exactly what the sources build (node tools/build.mjs --check); one page per variant,
 * each with its own headline, the Review Race mounted in its hero and below it, and the script; every link stays under
 * site.path, except links to the legal pages (../legal/, built from ../legal-src/), which must exist; every asset exists
 * and carries a version, the race's widget too; the race gets this site's legal links and its sentence about Meta;
 * {TBD} only inside preview-only notes; no em dashes; the noindex; no pixel, cookie notice or canonical until they are
 * set, and no tracker in the page's head ever (they wait for consent); the weight stays small; and the master page's
 * Vercel project serves it all (root vercel.json, .vercelignore, api/race.mjs and api/race-cron.mjs).
 *   node tests/check-build.mjs
 */
import { execFileSync } from "node:child_process";
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";
import zlib from "node:zlib";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const REPO = path.join(ROOT, "..");
let pass = 0, fail = 0;
const ok = (name, cond, info = "") => { if (cond) { pass++; console.log(`ok   ${name}`); } else { fail++; console.log(`FAIL ${name}${info ? `: ${info}` : ""}`); } };

let fresh = true, out = "";
try { out = execFileSync(process.execPath, [path.join(ROOT, "tools", "build.mjs"), "--check"], { encoding: "utf8", stdio: "pipe" }); } catch (e) { fresh = false; out = String(e.stdout || "") + String(e.stderr || ""); }
const { variants } = JSON.parse(readFileSync(path.join(ROOT, "content", "variants.json"), "utf8"));
const COPY = JSON.parse(readFileSync(path.join(ROOT, "content", "copy.json"), "utf8"));
const SITE = (await import(pathToFileURL(path.join(ROOT, "content", "site.mjs")).href)).default;
const BASE = SITE.path, OUT = path.join(REPO, BASE.slice(1));
const API = (SITE.race && SITE.race.api) || "/api/race";
ok(`${BASE.slice(1)}/ is what the sources build`, fresh, out.trim());
const unescape = (s) => s.replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">");
const html1 = (s) => s.replace(/'/g, "&#39;");
for (const v of variants) {
  const file = path.join(OUT, v.slug ? path.join(v.slug, "index.html") : "index.html");
  const label = v.slug ? `${BASE}/${v.slug}` : BASE;
  if (!existsSync(file)) { ok(`${label}: built`, false); continue; }
  const html = readFileSync(file, "utf8");
  const h1 = (html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/) || [])[1] || "";
  ok(`${label}: its own headline`, unescape(h1) === v.h1, h1);
  ok(`${label}: marked with its variant`, html.includes(`data-variant="${v.id}"`));
  const data = JSON.parse((html.match(/<script type="application\/json" id="rm-data">([\s\S]*?)<\/script>/) || [])[1] || "{}");
  ok(`${label}: the variant in the page data`, data.variant === v.id && !("survey" in data));
  ok(`${label}: no secret or server-only setting in the page data`, !/PROSPECT|CAPI|TOKEN|SUPABASE|RESEND|SERPAPI|ANTHROPIC/i.test(JSON.stringify(data)));
  ok(`${label}: the race's search in the hero card, starting the race in its section`, new RegExp(`<div id="hero-race" data-review-race-cta data-target="#review-race" data-api="${API}"></div>`).test(html) && html.includes('<div class="hero-card" id="race-home">'));
  ok(`${label}: the race itself, on ${API}`, html.includes(`<div id="review-race" data-review-race data-api="${API}"></div>`) && data.site.race && data.site.race.api === API);
  ok(`${label}: no Gap Check left`, !/gap-check|gc-step|gc-form|Gap Report|Gap Check/i.test(html));
  ok(`${label}: the PC hero line and the phone one, each marked for its screen`, html.includes(`<p class="lead m-hide">${html1(v.lead)}</p>`) && (!v.leadShort || html.includes(`<p class="lead m-only">${html1(v.leadShort)}</p>`)));
  ok(`${label}: the race's words in the HTML (Meta's crawler reads the page)`, [COPY.race.frame, COPY.points.h2, COPY.points.points[0].title].every((t) => html.includes(html1(t))));
  ok(`${label}: what the race shows, then the race, then the leaks, the service and the proof`, html.indexOf('id="points"') < html.indexOf('id="review-race"') && html.indexOf('id="review-race"') < html.indexOf('id="leaks"') && html.indexOf('id="service"') < html.indexOf('id="results"') && html.indexOf('id="testimonials"') < html.indexOf('id="honest"'));
  const links = [...html.matchAll(/(?:src|href|srcset)="([^"]+)"/g), ...html.matchAll(/url\(([^)]+)\)/g)].flatMap((m) => m[1].split(",").map((x) => x.trim().split(" ")[0]));
  // The master page's proof is shared with it on the one site: its styles and script, its media, its case study pages
  const SHARED = /^\/(assets\/proof\.(css|js)\?v=[a-f0-9]{10}|media\/[a-z0-9/._-]+|case-studies\/[a-z0-9-]+\/)$/;
  const outside = links.filter((u) => u.startsWith("/") && u !== BASE && !u.startsWith(`${BASE}/`) && !/^\/legal(\/|$)/.test(u) && !SHARED.test(u));
  ok(`${label}: every link on this site stays under ${BASE}, /legal or the shared proof`, outside.length === 0, outside.join(", "));
  const shared = links.filter((u) => SHARED.test(u) && !u.startsWith("/case-studies/"));
  const noFile = shared.filter((u) => !existsSync(path.join(REPO, u.split("?")[0])));
  ok(`${label}: every shared proof file is in the repository (${shared.length})`, shared.length >= 5 && noFile.length === 0, noFile.join(", "));
  const cards = [...html.matchAll(/<a class="cs-card" href="\/case-studies\/([a-z0-9-]+)\/"/g)].map((m) => m[1]);
  ok(`${label}: the real case studies, linked to their pages (${cards.join(", ")})`, cards.includes("junkaway-movers") && cards.includes("ranchero-plumbing"));
  ok(`${label}: German Aquino's video testimonial`, /<section id="testimonials"/.test(html) && html.includes("/media/testimonials/german-aquino.mp4") && html.includes("German Aquino"));
  ok(`${label}: the page's script, then the race's widget as a module, then the proof script`, /<script src="\/customers\/assets\/app\.js\?v=[a-f0-9]{10}" defer><\/script>\n<script type="module" src="\/customers\/assets\/race\/race\.js\?v=[a-f0-9]{10}"><\/script>\n<script src="\/assets\/proof\.js\?v=[a-f0-9]{10}" defer><\/script>/.test(html));
  const style = (html.match(/<style>([\s\S]*?)<\/style>/) || [])[1] || "";
  ok(`${label}: the race's styles inline, without a font file of its own`, style.includes(".rr-wrap") && style.includes(".rr-cta-row") && !/url\("?fonts\//.test(style));
  const legal = [...new Set(links.filter((u) => /^\/legal(\/|$)/.test(u)).map((u) => u.split("#")[0]))];
  const noPage = legal.filter((u) => !existsSync(path.join(REPO, u, "index.html")));
  ok(`${label}: every /legal link is a built legal page (${legal.length})`, legal.length >= 7 && noPage.length === 0, noPage.join(", "));
  const L = SITE.legal || {};
  ok(`${label}: the footer links every legal page`, ["terms", "privacy", "cookies", "sms", "choices", "accessibility", "hub"].every((k) => L[k] && html.includes(`href="${L[k]}"`)));
  ok(`${label}: the race's notices get this site's Terms, Privacy Policy, SMS terms and privacy choices, and the sentence about Meta`,
    data.site.legal && ["terms", "privacy", "sms", "choices"].every((k) => data.site.legal[k] === L[k] && existsSync(path.join(REPO, L[k], "index.html"))) && data.ui.legal && /we also tell Meta/.test(data.ui.legal.noticeMeta));
  const assets = links.filter((u) => u.startsWith(`${BASE}/assets/`));
  const missing = assets.filter((u) => !existsSync(path.join(OUT, u.split("?")[0].slice(BASE.length))));
  ok(`${label}: every ${BASE}/assets/ link exists (${assets.length})`, assets.length > 0 && missing.length === 0, missing.join(", "));
  ok(`${label}: every asset carries a version`, assets.every((u) => /\?v=[a-f0-9]{10}$/.test(u)));
  const stripped = html.replace(/<span class="tbd" data-tbd>[^<]*<\/span>/g, "").replace(/<section[^>]*data-tbd[\s\S]*?<\/section>/g, "").replace(/<div class="preview-bar" data-tbd[\s\S]*?<\/div>/g, "");
  ok(`${label}: {TBD} only in preview-only notes`, !stripped.includes("{TBD"));
  ok(`${label}: no caption notes under the pictures`, !/class="proof-chip|Illustration · |demo data/.test(html));
  ok(`${label}: no em or en dashes`, !/[–—]/.test(html.replace(/<style>[\s\S]*?<\/style>/, "")));
  ok(`${label}: noindex`, html.includes('<meta name="robots" content="noindex, nofollow">'));
  const head = (html.match(/<head>([\s\S]*?)<\/head>/) || [])[1] || "";
  ok(`${label}: no tracker in the page's head (they load only with consent)`, !/connect\.facebook\.net|clarity\.ms|facebook\.com\/tr/.test(head));
  ok(`${label}: no pixel until site.metaPixelId is set`, SITE.metaPixelId ? data.site.tracking.pixel === String(SITE.metaPixelId).replace(/\D/g, "") : data.site.tracking && data.site.tracking.pixel === null);
  ok(`${label}: a cookie notice only when a tracker is set`, (SITE.metaPixelId || SITE.clarityId) ? html.includes('id="cookie-notice"') : !html.includes('id="cookie-notice"') && !html.includes("data-cookie-settings"));
  ok(`${label}: the consent version in the page data`, data.site.noticeVersion === SITE.noticeVersion && /^\d{4}-\d{2}-\d{2}$/.test(SITE.noticeVersion));
  ok(`${label}: no canonical until site.url is set`, SITE.url ? html.includes('rel="canonical"') : !html.includes('rel="canonical"'));
  const gz = zlib.gzipSync(html).length;
  ok(`${label}: the page is light (${(gz / 1024).toFixed(1)} KB gzipped, budget 40)`, gz < 40 * 1024);
}
const js = readFileSync(path.join(OUT, "assets", "app.js"), "utf8");
ok(`the page's script is light (${(zlib.gzipSync(js).length / 1024).toFixed(1)} KB gzipped, budget 15)`, zlib.gzipSync(js).length < 15 * 1024);
ok("the page's script hands the race this page's fields, and posts nothing itself", js.includes("window.ReviewRace = {") && js.includes("noticeVersion") && !/fetch\(/.test(js));
const race = readFileSync(path.join(OUT, "assets", "race", "race.js"), "utf8");
const raceCopy = readFileSync(path.join(OUT, "assets", "race", "copy.js"), "utf8");
const SRC = path.join(REPO, "review-race", "public", "race");
ok("the race's widget is the race's own, its words imported with a version", /import COPY from "\.\/copy\.js\?v=[a-f0-9]{10}";/.test(race) && race.replace(/import COPY from "\.\/copy\.js\?v=[a-f0-9]{10}";/, 'import COPY from "./copy.js";') === readFileSync(path.join(SRC, "race.js"), "utf8") && raceCopy === readFileSync(path.join(SRC, "copy.js"), "utf8"));
const gzr = zlib.gzipSync(race).length + zlib.gzipSync(raceCopy).length;
ok(`the race's widget is light (${(gzr / 1024).toFixed(1)} KB gzipped, budget 25)`, gzr < 25 * 1024);

/* ---------- The master page's Vercel project serves all of it ---------- */
const vercel = JSON.parse(readFileSync(path.join(REPO, "vercel.json"), "utf8"));
const fn = `api${API.replace(/^\/api/, "")}.mjs`;   // "/api/race" -> "api/race.mjs"
ok(`${fn} runs the Review Race's handler`, existsSync(path.join(REPO, fn)) && /from "\.\.\/review-race\/api\/race\.mjs"/.test(readFileSync(path.join(REPO, fn), "utf8")));
ok("api/race-cron.mjs runs the race's daily job", existsSync(path.join(REPO, "api", "race-cron.mjs")) && /from "\.\.\/review-race\/api\/race-cron\.mjs"/.test(readFileSync(path.join(REPO, "api", "race-cron.mjs"), "utf8")));
ok(`vercel.json: ${fn} gets 120 s (the full race reads reviews and writes with Claude)`, vercel.functions && vercel.functions[fn] && vercel.functions[fn].maxDuration === 120);
ok("vercel.json: the daily job runs once a day", vercel.functions && vercel.functions["api/race-cron.mjs"] && (vercel.crons || []).some((c) => c.path === "/api/race-cron" && /^\d+ \d+ \* \* \*$/.test(c.schedule)));
ok("vercel.json: the Gap Check's function is gone", !(vercel.functions && vercel.functions["api/meta-lead.mjs"]) && !existsSync(path.join(REPO, "api", "meta-lead.mjs")));
ok("vercel.json: the master page's own function is untouched", vercel.functions && vercel.functions["api/lead.mjs"] && vercel.functions["api/lead.mjs"].maxDuration === 30);
ok(`vercel.json: ${BASE} and its pages resolve to their index.html`, (vercel.rewrites || []).some((x) => x.source === BASE && x.destination === `${BASE}/index.html`) && (vercel.rewrites || []).some((x) => x.source === `${BASE}/:page` && x.destination === `${BASE}/:page/index.html`));
ok(`vercel.json: ${BASE} pages carry noindex and the security headers`, (vercel.headers || []).some((h) => h.source === `${BASE}(/.*)?` && h.headers.some((x) => x.key === "X-Robots-Tag" && /noindex/.test(x.value))));
ok(`vercel.json: ${BASE}/assets are cached for a year`, (vercel.headers || []).some((h) => h.source === `${BASE}/assets/(.*)` && h.headers.some((x) => /immutable/.test(x.value))));
ok("vercel.json: meta/ sources are never served as files", (vercel.redirects || []).some((x) => x.source === "/meta/:path*"));
const ignore = readFileSync(path.join(REPO, ".vercelignore"), "utf8").split("\n").map((l) => l.trim()).filter((l) => l && !l.startsWith("#"));
ok(`.vercelignore keeps ${BASE.slice(1)}/ and the race's server code (review-race/api), and leaves meta/ out`,
  !ignore.some((l) => [`${BASE.slice(1)}/`, `/${BASE.slice(1)}/`, BASE.slice(1), "review-race/", "/review-race/", "review-race/api/", "/review-race/api/"].includes(l)) && ignore.includes("/meta/"));
ok(".vercelignore leaves out the race's test page, tests and tools", ["/review-race/public/", "/review-race/tests/", "/review-race/tools/"].every((l) => ignore.includes(l)));
ok("no separate Vercel project config is left in meta/", !existsSync(path.join(ROOT, "vercel.json")) && !existsSync(path.join(ROOT, ".vercelignore")));
console.log(`check-build: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
