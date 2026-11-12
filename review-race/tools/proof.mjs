// The test page's proof: the landing page's own case studies and video testimonials, copied from its index.html (the
// sections tools/render-landing.mjs renders there), with the landing page's styles, icons and script. So the test page
// shows exactly what the landing page shows, and nothing is written twice.
//
//   node tools/proof.mjs           copy them into public/ (run it again whenever the landing page's proof changes)
//   node tools/proof.mjs --check   only say whether public/ is up to date (npm test runs this)
//
// What it changes on the way: the case study links point to the landing page (RACE_SITE_URL, default
// https://rempo.io), where those pages live; data-proof-version is dropped, so the script doesn't ask this project
// for /api/proof (the landing page's); a <source> whose file isn't in the repository is left out.
// After the merge into the landing page none of this is needed: the landing page has the sections itself.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const LANDING = path.dirname(HERE);
const PUBLIC = path.join(HERE, "public");
const SITE = (process.env.RACE_SITE_URL || "https://rempo.io").replace(/\/+$/, "");
const check = process.argv.includes("--check");

const read = (p) => fs.readFileSync(p, "utf8");
const landing = read(path.join(LANDING, "index.html"));

function section(id) {
  const start = landing.indexOf(`<section id="${id}"`);
  if (start < 0) throw new Error(`the landing page's index.html has no section #${id}`);
  const re = /<\/?section\b/g;
  re.lastIndex = start;
  let depth = 0, m;
  while ((m = re.exec(landing))) {
    depth += m[0][1] === "/" ? -1 : 1;
    if (depth === 0) return landing.slice(start, landing.indexOf(">", m.index) + 1);
  }
  throw new Error(`section #${id} never closes`);
}

const exists = (url) => fs.existsSync(path.join(LANDING, url));
let html = [section("results"), section("testimonials")].join("\n\n")
  .replace(/ data-proof-version="[^"]*"/g, "")
  .replace(/href="\/case-studies\//g, `href="${SITE}/case-studies/`)
  .replace(/<source\b[^>]*\bsrc="(\/[^"]+)"[^>]*>\s*/g, (tag, src) => (exists(src) ? tag : ""));

// The icons the sections use, from the sprite the case study pages share
const { SPRITE } = await import(path.join(LANDING, "assets/proof-shell.mjs"));
const used = new Set(html.match(/#i-[a-z0-9-]+/g) || []);
const symbols = (SPRITE.match(/<symbol id="i-[^"]+"[\s\S]*?<\/symbol>/g) || []).filter((s) => used.has(`#${s.match(/id="([^"]+)"/)[1]}`));
const sprite = `<svg width="0" height="0" style="position:absolute" aria-hidden="true" focusable="false"><defs>\n${symbols.join("\n")}\n</defs></svg>`;

// Every file the copy needs, at the same path as on the landing page
const files = new Set(["assets/site.css", "assets/proof.css", "assets/proof.js", "assets/fonts/outfit.woff2", "assets/fonts/geist.woff2"]);
for (const m of html.matchAll(/(?:src|poster|data-avatar)="\/((?:media|assets)\/[^"]+)"/g)) files.add(m[1]);
const missing = [...files].filter((f) => !exists(`/${f}`));
if (missing.length) throw new Error(`not in the landing page's repository: ${missing.join(", ")}`);

const block = [
  "<!-- proof:start. Copied from the landing page's index.html by tools/proof.mjs. Don't edit here: run node tools/proof.mjs -->",
  sprite,
  html,
  '<script src="/assets/proof.js" defer></script>',
  "<!-- proof:end -->"
].join("\n");
const head = [
  "<!-- proof-head:start -->",
  '<link rel="stylesheet" href="/assets/site.css">',
  '<link rel="stylesheet" href="/assets/proof.css">',
  "<!-- proof-head:end -->"
].join("\n  ");

const pagePath = path.join(PUBLIC, "index.html");
const page = read(pagePath);
const swap = (s, start, end, inner) => {
  const re = new RegExp(`${start}[\\s\\S]*?${end}`);
  if (!re.test(s)) throw new Error(`public/index.html has no ${start} ... ${end} markers`);
  return s.replace(re, () => inner);
};
const next = swap(swap(page, "<!-- proof:start", "<!-- proof:end -->", block), "<!-- proof-head:start -->", "<!-- proof-head:end -->", head);

const stale = [...files].filter((f) => {
  const to = path.join(PUBLIC, f);
  return !fs.existsSync(to) || !fs.readFileSync(to).equals(fs.readFileSync(path.join(LANDING, f)));
});
if (check) {
  if (next !== page || stale.length) {
    console.error(`proof: public/ is out of date with the landing page${stale.length ? ` (${stale.join(", ")})` : ""}. Run: node tools/proof.mjs`);
    process.exit(1);
  }
  console.log("proof: up to date with the landing page");
} else {
  for (const f of stale) {
    fs.mkdirSync(path.dirname(path.join(PUBLIC, f)), { recursive: true });
    fs.copyFileSync(path.join(LANDING, f), path.join(PUBLIC, f));
  }
  if (next !== page) fs.writeFileSync(pagePath, next);
  console.log(`proof: ${(html.match(/class="cs-card/g) || []).length} case studies and ${(html.match(/data-vt\b/g) || []).length} video(s) copied; ${stale.length} file(s) updated`);
}
