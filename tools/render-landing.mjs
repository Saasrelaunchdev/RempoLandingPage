// Renders the landing page's case study cards and video testimonials (in index.html) from the seed, with the renderer
// the site uses everywhere, and stamps both sections with the seed's version. The page then shows these at once, and
// assets/proof.js swaps in the published set when the admin has published something newer.
//   npm run render-landing            (--check: only say whether index.html is up to date)
import { readFileSync, writeFileSync } from "node:fs";
import { buildPublished } from "../api/_lib/proof/store.mjs";
import { seedContent } from "../api/_lib/proof/seed.mjs";
import { resultsLead, caseCardsHTML, testimonialsInnerHTML } from "../assets/proof-render.mjs";

const file = new URL("../index.html", import.meta.url);
const before = readFileSync(file, "utf8");
const pub = buildPublished(seedContent());
const indent = (s, n) => s.replace(/^(?=.)/gm, " ".repeat(n));
let html = before;
const swap = (re, fn, what) => {
  if (!re.test(html)) throw new Error(`index.html: can't find ${what}`);
  html = html.replace(re, fn);
};

swap(/<section id="results" class="proof sec" aria-labelledby="results-h"(?: data-proof-version="[^"]*")?>/,
  () => `<section id="results" class="proof sec" aria-labelledby="results-h" data-proof-version="${pub.version}">`, "the case studies section");
swap(/(<h2 id="results-h" class="h2">[^<]*<\/h2>\s*<p class="lead">)[^<]*(<\/p>)/,
  (m, a, b) => `${a}${resultsLead(pub.cases)}${b}`, "the case studies lead");
swap(/(<div class="cs-grid">\n)[\s\S]*?(\n    <\/div>\n    <p class="cs-note">)/,
  (m, a, b) => `${a}${indent(caseCardsHTML(pub.cases, pub.testimonials), 6)}${b}`, "the case study cards");
swap(/<section id="testimonials" class="vt-sec(?: vt-many)?" aria-labelledby="vt-h"(?: data-proof-version="[^"]*")?>/,
  () => `<section id="testimonials" class="vt-sec${pub.testimonials.length > 1 ? " vt-many" : ""}" aria-labelledby="vt-h" data-proof-version="${pub.version}">`, "the video section");
swap(/(<div class="wrap vt-sec-grid">\n)[\s\S]*?(\n  <\/div>\n<\/section>)/,
  (m, a, b) => `${a}    ${testimonialsInnerHTML(pub.testimonials, pub.cases)}${b}`, "the video testimonials");

if (html === before) console.log(`index.html is up to date (version ${pub.version})`);
else if (process.argv.includes("--check")) { console.error("index.html is out of date: run npm run render-landing"); process.exit(1); }
else { writeFileSync(file, html); console.log(`index.html: rendered ${pub.cases.length} case studies and ${pub.testimonials.length} video(s), version ${pub.version}`); }
