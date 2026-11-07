#!/usr/bin/env node
/**
 * The built pages: ../customers/ is exactly what the sources build (node tools/build.mjs --check); one page per variant,
 * each with its own headline, the survey data and the script; every link stays under site.path and every asset exists;
 * {TBD} only inside preview-only notes; no em dashes; the noindex; no pixel or canonical until they are set; the weight
 * stays small; and the master page's Vercel project serves it all (root vercel.json, .vercelignore, api/meta-lead.mjs).
 *   node tests/check-build.mjs
 */
import { execFileSync } from "node:child_process";
import { readFileSync, existsSync, statSync } from "node:fs";
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
const SITE = (await import(pathToFileURL(path.join(ROOT, "content", "site.mjs")).href)).default;
const BASE = SITE.path, OUT = path.join(REPO, BASE.slice(1));
ok(`${BASE.slice(1)}/ is what the sources build`, fresh, out.trim());
const SURVEY = (await import(pathToFileURL(path.join(ROOT, "content", "survey.mjs")).href)).default;
const unescape = (s) => s.replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">");
for (const v of variants) {
  const file = path.join(OUT, v.slug ? path.join(v.slug, "index.html") : "index.html");
  const label = v.slug ? `${BASE}/${v.slug}` : BASE;
  if (!existsSync(file)) { ok(`${label}: built`, false); continue; }
  const html = readFileSync(file, "utf8");
  const h1 = (html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/) || [])[1] || "";
  ok(`${label}: its own headline`, unescape(h1) === v.h1, h1);
  ok(`${label}: marked with its variant`, html.includes(`data-variant="${v.id}"`));
  const data = JSON.parse((html.match(/<script type="application\/json" id="rm-data">([\s\S]*?)<\/script>/) || [])[1] || "{}");
  ok(`${label}: the survey and the variant in the page data`, data.variant === v.id && data.survey && data.survey.steps.length === SURVEY.steps.length);
  ok(`${label}: no secret or server-only setting in the page data`, !/PROSPECT|CAPI|TOKEN|SUPABASE|RESEND/i.test(JSON.stringify(data)));
  ok(`${label}: sends its leads to ${SITE.endpoint}`, data.site && data.site.endpoint === SITE.endpoint);
  ok(`${label}: the PC hero line and the phone one, each marked for its screen`, html.includes(`<p class="lead m-hide">${v.lead.replace(/'/g, "&#39;")}</p>`) && (!v.leadShort || html.includes(`<p class="lead m-only">${v.leadShort.replace(/'/g, "&#39;")}</p>`)));
  ok(`${label}: every question in the HTML (Meta's crawler reads the page)`, SURVEY.steps.every((s) => html.includes(s.q.replace(/'/g, "&#39;"))));
  const links = [...html.matchAll(/(?:src|href|srcset)="([^"]+)"/g), ...html.matchAll(/url\(([^)]+)\)/g)].flatMap((m) => m[1].split(",").map((x) => x.trim().split(" ")[0]));
  const outside = links.filter((u) => u.startsWith("/") && u !== BASE && !u.startsWith(`${BASE}/`));
  ok(`${label}: every link on this site stays under ${BASE}`, outside.length === 0, outside.join(", "));
  const assets = links.filter((u) => u.startsWith(`${BASE}/assets/`));
  const missing = assets.filter((u) => !existsSync(path.join(OUT, u.split("?")[0].slice(BASE.length))));
  ok(`${label}: every ${BASE}/assets/ link exists (${assets.length})`, assets.length > 0 && missing.length === 0, missing.join(", "));
  ok(`${label}: every asset carries a version`, assets.every((u) => /\?v=[a-f0-9]{10}$/.test(u)));
  const stripped = html.replace(/<span class="tbd" data-tbd>[^<]*<\/span>/g, "").replace(/<section[^>]*data-tbd[\s\S]*?<\/section>/g, "").replace(/<div class="preview-bar" data-tbd[\s\S]*?<\/div>/g, "");
  ok(`${label}: {TBD} only in preview-only notes`, !stripped.includes("{TBD"));
  ok(`${label}: no em or en dashes`, !/[\u2013\u2014]/.test(html.replace(/<style>[\s\S]*?<\/style>/, "")));
  ok(`${label}: noindex`, html.includes('<meta name="robots" content="noindex, nofollow">'));
  ok(`${label}: no pixel until site.metaPixelId is set`, SITE.metaPixelId ? html.includes("connect.facebook.net") : !html.includes("connect.facebook.net"));
  ok(`${label}: no canonical until site.url is set`, SITE.url ? html.includes('rel="canonical"') : !html.includes('rel="canonical"'));
  const gz = zlib.gzipSync(html).length;
  ok(`${label}: the page is light (${(gz / 1024).toFixed(1)} KB gzipped, budget 40)`, gz < 40 * 1024);
}
const js = readFileSync(path.join(OUT, "assets", "app.js"));
ok(`the script is light (${(zlib.gzipSync(js).length / 1024).toFixed(1)} KB gzipped, budget 15)`, zlib.gzipSync(js).length < 15 * 1024);
ok("the script carries the shared scoring", /function evaluate\(survey, raw\)/.test(String(js)) && !/^export /m.test(String(js)));
ok("the script posts to the endpoint in the page data, not a fixed address", String(js).includes("fetch(SITE.endpoint") && !String(js).includes('"/api/lead"'));

/* ---------- The master page's Vercel project serves all of it ---------- */
const vercel = JSON.parse(readFileSync(path.join(REPO, "vercel.json"), "utf8"));
const fn = `api${SITE.endpoint.replace(/^\/api/, "")}.mjs`;   // "/api/meta-lead" -> "api/meta-lead.mjs"
ok(`${fn} runs this site's handler`, existsSync(path.join(REPO, fn)) && /from "\.\.\/meta\/api\/lead\.mjs"/.test(readFileSync(path.join(REPO, fn), "utf8")));
ok(`vercel.json: ${fn} gets 30 s, like the master page's function`, vercel.functions && vercel.functions[fn] && vercel.functions[fn].maxDuration === 30);
ok("vercel.json: the master page's own function is untouched", vercel.functions && vercel.functions["api/lead.mjs"] && vercel.functions["api/lead.mjs"].maxDuration === 30);
ok(`vercel.json: ${BASE} and its pages resolve to their index.html`, (vercel.rewrites || []).some((x) => x.source === BASE && x.destination === `${BASE}/index.html`) && (vercel.rewrites || []).some((x) => x.source === `${BASE}/:page` && x.destination === `${BASE}/:page/index.html`));
ok(`vercel.json: ${BASE} pages carry noindex and the security headers`, (vercel.headers || []).some((h) => h.source === `${BASE}(/.*)?` && h.headers.some((x) => x.key === "X-Robots-Tag" && /noindex/.test(x.value))));
ok(`vercel.json: ${BASE}/assets are cached for a year`, (vercel.headers || []).some((h) => h.source === `${BASE}/assets/(.*)` && h.headers.some((x) => /immutable/.test(x.value))));
ok("vercel.json: meta/ sources are never served as files", (vercel.redirects || []).some((x) => x.source === "/meta/:path*"));
const ignore = readFileSync(path.join(REPO, ".vercelignore"), "utf8").split("\n").map((l) => l.trim()).filter((l) => l && !l.startsWith("#"));
ok(`.vercelignore keeps ${BASE.slice(1)}/ and what ${fn} imports (meta/api, meta/content, meta/lib)`,
  !ignore.some((l) => [`${BASE.slice(1)}/`, BASE.slice(1), "meta/", "meta", "meta/*", "meta/api/", "meta/content/", "meta/lib/"].includes(l)));
ok(".vercelignore leaves out the tests and tools", ["meta/tests/", "meta/tools/", "meta/src/"].every((l) => ignore.includes(l)));
ok("no separate Vercel project config is left in meta/", !existsSync(path.join(ROOT, "vercel.json")) && !existsSync(path.join(ROOT, ".vercelignore")));
console.log(`check-build: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
