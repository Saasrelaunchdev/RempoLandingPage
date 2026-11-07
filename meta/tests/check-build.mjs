#!/usr/bin/env node
/**
 * The built site: public/ is exactly what the sources build (node tools/build.mjs --check); one page per variant, each
 * with its own headline, the survey data and the script; every /assets/ link exists; {TBD} only inside preview-only
 * notes; no em dashes; the noindex; no pixel or canonical until they are set; and the weight stays small.
 *   node tests/check-build.mjs
 */
import { execFileSync } from "node:child_process";
import { readFileSync, existsSync, statSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";
import zlib from "node:zlib";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
let pass = 0, fail = 0;
const ok = (name, cond, info = "") => { if (cond) { pass++; console.log(`ok   ${name}`); } else { fail++; console.log(`FAIL ${name}${info ? `: ${info}` : ""}`); } };

let fresh = true, out = "";
try { out = execFileSync(process.execPath, [path.join(ROOT, "tools", "build.mjs"), "--check"], { encoding: "utf8", stdio: "pipe" }); } catch (e) { fresh = false; out = String(e.stdout || "") + String(e.stderr || ""); }
ok("public/ is what the sources build", fresh, out.trim());

const { variants } = JSON.parse(readFileSync(path.join(ROOT, "content", "variants.json"), "utf8"));
const SITE = (await import(pathToFileURL(path.join(ROOT, "content", "site.mjs")).href)).default;
const SURVEY = (await import(pathToFileURL(path.join(ROOT, "content", "survey.mjs")).href)).default;
const unescape = (s) => s.replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">");
for (const v of variants) {
  const file = path.join(ROOT, "public", v.slug ? path.join(v.slug, "index.html") : "index.html");
  const label = `/${v.slug}`;
  if (!existsSync(file)) { ok(`${label}: built`, false); continue; }
  const html = readFileSync(file, "utf8");
  const h1 = (html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/) || [])[1] || "";
  ok(`${label}: its own headline`, unescape(h1) === v.h1, h1);
  ok(`${label}: marked with its variant`, html.includes(`data-variant="${v.id}"`));
  const data = JSON.parse((html.match(/<script type="application\/json" id="rm-data">([\s\S]*?)<\/script>/) || [])[1] || "{}");
  ok(`${label}: the survey and the variant in the page data`, data.variant === v.id && data.survey && data.survey.steps.length === SURVEY.steps.length);
  ok(`${label}: no secret or server-only setting in the page data`, !/PROSPECT|CAPI|TOKEN|SUPABASE|RESEND/i.test(JSON.stringify(data)));
  ok(`${label}: every question in the HTML (Meta's crawler reads the page)`, SURVEY.steps.every((s) => html.includes(s.q.replace(/'/g, "&#39;"))));
  const assets = [...html.matchAll(/(?:src|href|srcset)="([^"]+)"/g)].flatMap((m) => m[1].split(",").map((x) => x.trim().split(" ")[0])).filter((u) => u.startsWith("/assets/"));
  const missing = assets.filter((u) => !existsSync(path.join(ROOT, "public", u.split("?")[0])));
  ok(`${label}: every /assets/ link exists (${assets.length})`, missing.length === 0, missing.join(", "));
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
const js = readFileSync(path.join(ROOT, "public", "assets", "app.js"));
ok(`the script is light (${(zlib.gzipSync(js).length / 1024).toFixed(1)} KB gzipped, budget 15)`, zlib.gzipSync(js).length < 15 * 1024);
ok("the script carries the shared scoring", /function evaluate\(survey, raw\)/.test(String(js)) && !/^export /m.test(String(js)));
ok("robots.txt lets crawlers read the noindex", readFileSync(path.join(ROOT, "public", "robots.txt"), "utf8").includes("Allow: /"));
ok("a 404 page", existsSync(path.join(ROOT, "public", "404.html")));
const vercel = JSON.parse(readFileSync(path.join(ROOT, "vercel.json"), "utf8"));
ok("vercel.json: builds with node tools/build.mjs into public", vercel.buildCommand === "node tools/build.mjs" && vercel.outputDirectory === "public");
ok("the master page's deployment leaves meta/ out", readFileSync(path.join(ROOT, "..", ".vercelignore"), "utf8").split("\n").includes("meta/"));
console.log(`check-build: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
