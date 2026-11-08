#!/usr/bin/env node
// Builds the pages into the repository's customers/ folder (the folder is named by `path` in content/site.mjs): one
// static page per ad angle (content/variants.json), the script, the pictures and fonts, every link starting with that
// path. The master page's Vercel project serves the folder as it is, so the output is committed and Vercel runs no
// build. No dependencies.
//
//   node tools/build.mjs           build ../customers/
//   node tools/build.mjs --check   fail if ../customers/ is not what the sources build (the tests run this)
//
// The copy rules run first (tools/copy-lint.mjs): a banned claim stops the build.
import { readFileSync, writeFileSync, mkdirSync, rmSync, readdirSync, statSync, existsSync, copyFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";
import os from "node:os";
import { lintAll } from "./copy-lint.mjs";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const r = (...p) => path.join(ROOT, ...p);
const CHECK = process.argv.includes("--check");

const read = (p) => readFileSync(r(p), "utf8");
const json = (p) => JSON.parse(read(p));
const SITE = (await import(pathToFileURL(r("content/site.mjs")).href)).default;

// The path the pages live at, and the folder at the repository root that holds them. One plain segment, never a
// folder the repository already uses: the build empties this folder before writing it.
const BASE = String(SITE.path || "");
if (!/^\/[a-z0-9][a-z0-9-]*$/.test(BASE) || ["/api", "/meta", "/lead-capture", "/assets"].includes(BASE)) {
  console.error(`build stopped: site.path must be one segment such as "/customers", not ${JSON.stringify(SITE.path)}`);
  process.exit(1);
}
const SITE_DIR = path.join(ROOT, "..", BASE.slice(1));
const OUT = CHECK ? path.join(os.tmpdir(), `rempo-meta-check-${process.pid}`) : SITE_DIR;
const SURVEY = (await import(pathToFileURL(r("content/survey.mjs")).href)).default;
const COPY = json("content/copy.json");
const { variants: VARIANTS } = json("content/variants.json");
const { fill } = await import(pathToFileURL(r("lib/gapcheck.mjs")).href);

/* ---------- The copy rules first ---------- */
const { errors, warnings } = await lintAll();
warnings.forEach((w) => console.log(`warn  ${w}`));
if (errors.length) {
  errors.forEach((e) => console.log(`ERROR ${e}`));
  console.error(`build stopped: ${errors.length} copy rule errors (rules/copy-rules.json)`);
  process.exit(1);
}

/* ---------- Helpers ---------- */
const esc = (v) => String(v == null ? "" : v).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const ic = (id, cls = "ic") => `<svg class="${cls}" aria-hidden="true"><use href="#${id}"/></svg>`;
const hash = (buf) => createHash("sha256").update(buf).digest("hex").slice(0, 10);
const T = (s) => fill(s, { turnaround: SITE.reportTurnaround });
const tbd = (text) => `<span class="tbd" data-tbd>${esc(text)}</span>`;

/* ---------- Assets: copied with a content version, so they can be cached for a year ---------- */
rmSync(OUT, { recursive: true, force: true });   // a fresh folder: nothing stale is left behind
mkdirSync(path.join(OUT, "assets", "img"), { recursive: true });
mkdirSync(path.join(OUT, "assets", "fonts"), { recursive: true });
const V = {};   // "/assets/img/podium-800.webp" -> "/customers/assets/img/podium-800.webp?v=abc"
function copyTree(from, to) {
  for (const name of readdirSync(from)) {
    const src = path.join(from, name), dst = path.join(to, name);
    if (statSync(src).isDirectory()) { mkdirSync(dst, { recursive: true }); copyTree(src, dst); continue; }
    copyFileSync(src, dst);
    const rel = "/" + path.relative(OUT, dst).split(path.sep).join("/");
    V[rel] = `${BASE}${rel}?v=${hash(readFileSync(src))}`;
  }
}
copyTree(r("src/assets"), path.join(OUT, "assets"));
const A = (p) => { if (!V[p]) throw new Error(`build: no asset ${p} in src/assets`); return V[p]; };
const img = (name, widths, sizes, alt, cls = "", extra = "") => {
  const [w0] = widths;
  const srcset = widths.map((w) => `${A(`/assets/img/${name}-${w}.webp`)} ${w}w`).join(", ");
  return `<img${cls ? ` class="${cls}"` : ""} src="${A(`/assets/img/${name}-${w0}.webp`)}" srcset="${srcset}" sizes="${sizes}" alt="${esc(alt)}" decoding="async"${extra}>`;
};
const IMG = {   // the widths tools/extract-master.py writes
  street: [800, 1200], podium: [800, 1200], "street-six": [800, 1200], house: [480, 800], "team-desk": [480, 800],
  report: [400, 640], bell: [320, 480], crew: [480, 640], notes: [400, 640], toolbox: [400, 640], "mark-3d": [400, 640]
};
const pic = (name, sizes, alt, cls, extra) => img(name, IMG[name], sizes, alt, cls, extra);

/* ---------- The script: the shared scoring module and the page script, in one function ---------- */
const gapcheck = read("lib/gapcheck.mjs").replace(/^export function /gm, "function ");
const appJs = `/* Rempo for Meta ads. Built by tools/build.mjs from lib/gapcheck.mjs and src/js/app.js. */\n(function () {\n${gapcheck}\n${read("src/js/app.js")}\n})();\n`;
writeFileSync(path.join(OUT, "assets", "app.js"), appJs);
V["/assets/app.js"] = `${BASE}/assets/app.js?v=${hash(appJs)}`;

/* ---------- Styles: fonts, tokens, page; comments dropped, inlined in every page ---------- */
const fontFace = (fam, file) => `@font-face{font-family:"${fam}";font-style:normal;font-display:swap;font-weight:100 900;src:url(${A(`/assets/fonts/${file}`)}) format("woff2-variations");unicode-range:U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+0304,U+0308,U+0329,U+2000-206F,U+20AC,U+2122,U+2191,U+2193,U+2212,U+2215,U+FEFF,U+FFFD}`;
const CSS = [fontFace("Outfit", "outfit.woff2"), fontFace("Geist", "geist.woff2"), read("src/styles/tokens.css"), read("src/styles/page.css")]
  .join("\n").replace(/\/\*[\s\S]*?\*\//g, "").replace(/\n\s*\n/g, "\n").replace(/^\s+/gm, "").trim();

const SYMBOLS = read("src/partials/symbols.svg") + read("src/partials/symbols-extra.svg").replace(/<!--[\s\S]*?-->/g, "");

/* ---------- Sections ---------- */
const C = COPY;

function scene(kind) {
  if (kind === "podium") {
    return `<div class="scene">${pic("podium", "(min-width: 900px) 600px, 100vw", "Illustration: three local companies' vans on a podium, first, second and third. Your van is on the street in front of them.", "pic", ' loading="lazy"')}
      <span class="pin rank" style="--x:41.5%;--y:22%" aria-hidden="true">2</span><span class="pin rank" style="--x:52.8%;--y:15%" aria-hidden="true">1</span><span class="pin rank" style="--x:63.5%;--y:25%" aria-hidden="true">3</span>
      <span class="pin you" style="--x:43%;--y:57%" aria-hidden="true">You?</span></div>
      <figcaption class="proof-chip">Illustration · the top three near you</figcaption>`;
  }
  if (kind === "asked") {
    const xs = [21, 33, 45, 58, 71, 85], on = [1, 4];   // just above each roof (tools: measured on the 1440 px render)
    return `<div class="scene">${pic("street-six", "(min-width: 900px) 600px, 100vw", "Illustration: a street of six homes, each with a job done this week. Two of them were asked for a review.", "pic", ' loading="lazy"')}
      ${xs.map((x, i) => `<span class="pin ask${on.includes(i) ? " on" : ""}" style="--x:${x}%;--y:25%" aria-hidden="true">${ic("i-check")}</span>`).join("")}
      <span class="scene-tag" style="--x:50%;--y:87%" aria-hidden="true">Asked this week: <b>2 of 6</b></span></div>
      <figcaption class="proof-chip">Illustration · a typical week</figcaption>`;
  }
  if (kind === "unanswered") {
    const stars = [1, 2, 3, 4, 5].map((n) => ic(n <= 3 ? "i-starf" : "i-star", n <= 3 ? "ic" : "ic off")).join("");
    return `<div class="scene">${pic("street", "(min-width: 900px) 600px, 100vw", "Illustration: a service van outside a customer's house after a job, with her 3-star review above the house and no reply under it.", "pic", ' loading="lazy"')}
      <div class="rv-card waiting" style="--x:45.6%;--y:33%" aria-hidden="true"><span class="rv-av">P</span><span class="rv-head"><b>Priya S.</b><span class="stars">${stars}</span></span><p class="rv-text">Fixed it, but nobody called me back about the second visit.</p><span class="rv-reply wait">${ic("i-clock")}No reply yet · 3 weeks</span></div></div>
      <figcaption class="proof-chip">Illustration · sample review</figcaption>`;
  }
  if (kind === "phone") return phone(true);
  return "";
}

// The request, small, under the headline on a phone (the full phone shows on a PC): the page meets the ad's picture
// before the first question, and the question stays in the first screen
function miniRequest() {
  const P = C.service.phone;
  return `<figure class="mini-req"><div class="mini-bubble">${pic("crew", "96px", P.photoAlt, "", ' loading="eager"')}<p><b>${esc(P.thanks)}</b> ${esc(P.mini)}</p></div><figcaption class="proof-chip">${esc(P.miniCaption)}</figcaption></figure>`;
}

function phone(hero) {
  const P = C.service.phone;
  return `<div class="phone-wrap"><div class="phone" aria-hidden="true"><div class="phone-in-screen">
      <div class="phone-bar"><span>${esc(P.time)}</span><span>${ic("i-send", "ic")}</span></div>
      <div class="phone-from"><span class="phone-av">M</span><b>${esc(P.from)}</b></div>
      <div class="bubble"><div class="bubble-photo">${pic("crew", "260px", P.photoAlt, "", ' loading="lazy"')}<b>${esc(P.thanks)}</b></div>
        <p>${esc(P.text.replace(/\s*g\.page\/\S+$/, ""))} <a>${esc((P.text.match(/g\.page\/\S+$/) || [""])[0])}</a></p><small>${esc(P.stop)}</small></div>
    </div></div></div><p class="sr-only">${esc(P.photoAlt)} ${esc(P.text)} ${esc(P.stop)}</p>
    <figcaption class="proof-chip">${esc(P.caption)}</figcaption>`;
}

/* ---------- The legal pages (../legal-src/, served at /legal): links and the notice at collection ---------- */
const LEGAL = SITE.legal || {};
const TRACKERS = Boolean(SITE.metaPixelId || SITE.clarityId);
const newTabLink = (href, label) => `<a href="${esc(href)}" target="_blank" rel="noopener">${esc(label)}<span class="sr-only"> ${esc(C.legal.newTab)}</span></a>`;
// Under each form: the button that signals agreement, by name, with the Terms and the Privacy Policy, then what Meta
// hears and where to opt out. Links open in a new tab so the form keeps its answers.
function legalNotice(button) {
  const L = C.legal;
  if (!LEGAL.terms || !(LEGAL.privacy || SITE.privacyUrl)) return `<p class="legal-note">${tbd(C.footer.privacyTbd)}</p>`;
  const main = fill(esc(L.notice), { button: esc(button), terms: newTabLink(LEGAL.terms, L.terms), privacy: newTabLink(LEGAL.privacy || SITE.privacyUrl, L.privacy) });
  const meta = LEGAL.choices ? ` ${fill(esc(L.noticeMeta), { choices: newTabLink(LEGAL.choices, L.choices) })}` : "";
  return `<p class="legal-note">${main}${meta}</p>`;
}

function stepHtml(step, i, total) {
  const back = `<button type="button" class="gc-back"${i === 0 ? " hidden" : ""}>${ic("i-back")}${esc(C.check.back)}</button>`;
  const id = (n) => `gc-${n}`;
  if (step.type === "choice") {
    const opts = step.options.map((o) => `<label class="gc-opt"><input type="radio" name="${step.key}" value="${esc(o.v)}"><span>${esc(o.label)}</span></label>`).join("");
    return `<fieldset class="gc-step" data-key="${step.key}" data-kind="choice"${i ? " hidden" : ""}>
      <legend class="gc-q" tabindex="-1">${esc(step.q)}</legend>
      <div class="gc-opts${step.layout === "grid" ? " grid" : ""}">${opts}</div>
      <p class="err" role="alert"></p>
      <div class="gc-nav">${back}<button type="button" class="btn btn-primary gc-next">${esc(C.check.next)}${ic("i-arrow")}</button></div>
    </fieldset>`;
  }
  const fields = step.fields.map((f) => `<div class="field"><label for="${id(f.name)}">${esc(f.label)}</label>${f.help ? `<p class="help" id="${id(f.name)}-h">${esc(f.help)}</p>` : ""}<input id="${id(f.name)}" name="${f.name}" type="${f.type || "text"}"${f.inputmode ? ` inputmode="${f.inputmode}"` : ""} autocomplete="${f.autocomplete}" maxlength="${f.max}"${f.help ? ` aria-describedby="${id(f.name)}-h"` : ""}${f.required ? " data-req" : ""}${f.type === "email" ? ' autocapitalize="off" spellcheck="false"' : ""}></div>`).join("");
  const choice = step.choice ? `<fieldset><legend class="group-l">${esc(step.choice.label)}</legend><div class="chips" data-group="${step.choice.key}">${step.choice.options.map((o, k) => `<label class="chip-opt"><input type="radio" name="${step.choice.key}" value="${esc(o.v)}"${k === 0 ? " data-req" : ""}><span>${esc(o.label)}</span></label>`).join("")}</div></fieldset>` : "";
  const consent = step.consent ? `<label class="consent"><input type="checkbox" name="${step.consent.name}"${step.consent.required ? " data-req" : ""}><span>${esc(step.consent.label)}</span></label>` : "";
  const notice = step.last ? legalNotice(C.check.submit) : "";
  const hp = step.last ? `<div class="hp" aria-hidden="true"><label>Leave this empty <input name="hp" tabindex="-1" autocomplete="off"></label></div>` : "";
  const submit = step.last
    ? `<button type="submit" class="btn btn-primary">${esc(C.check.submit)}${ic("i-arrow")}</button>`
    : `<button type="button" class="btn btn-primary gc-next">${esc(C.check.next)}${ic("i-arrow")}</button>`;
  return `<fieldset class="gc-step" data-key="${step.key}" data-kind="fields"${i ? " hidden" : ""}>
      <legend class="gc-q" tabindex="-1">${esc(step.q)}</legend>${step.hint ? `<p class="gc-hint">${esc(step.hint)}</p>` : ""}
      ${fields}${choice}${consent}${notice}${hp}
      <p class="err" role="alert"></p>
      <div class="gc-nav">${back}${submit}</div>
    </fieldset>`;
}

function checkCard() {
  const total = SURVEY.steps.length;
  return `<div class="hero-card" id="gc-home">
  <div class="gc" id="gap-check" role="region" aria-labelledby="gc-title">
    <div class="gc-top"><span class="gc-label" id="gc-title">${ic("i-file")}${esc(C.check.label)}</span><span class="gc-count" aria-live="polite">${esc(fill(C.check.progress, { n: 1, total }))}</span></div>
    <div class="gc-bar" aria-hidden="true"><i></i></div>
    <p class="gc-frame">${esc(C.check.frame)}</p>
    <noscript><p class="err">${esc(C.check.noscript)}</p></noscript>
    <form class="gc-form" novalidate>
      ${SURVEY.steps.map((s, i) => stepHtml(s, i, total)).join("\n      ")}
    </form>
    <div class="gc-result" hidden></div>
  </div>
</div>`;
}

function hero(v) {
  return `<section class="hero story" id="top" data-scene="${esc(v.scene)}" aria-labelledby="hero-h">
  <div class="wrap hero-grid">
    <div class="hero-copy">
      <p class="pill">${esc(C.hero.eyebrow)}</p>
      <h1 class="display" id="hero-h">${esc(v.h1)}</h1>
      <p class="lead">${esc(v.lead)}</p>${v.scene === "phone" ? miniRequest() : ""}
    </div>
    ${checkCard()}
    <div class="hero-vis">
      <ul class="trust" aria-label="About the report">${C.hero.trust.map((t) => `<li>${ic("i-check")}${esc(T(t))}</li>`).join("")}</ul>
      <figure class="hero-fig${v.scene === "phone" ? " fig-phone" : ""}">${scene(v.scene)}</figure>
    </div>
  </div>
</section>`;
}

const openBtn = (label, from, cls = "btn btn-primary") => `<a class="${cls}" href="#gap-check" data-open-check="${from}">${esc(label)}${ic("i-arrow")}</a>`;

// The picture a section uses, unless the hero above already shows it (then its img2): no picture twice in a row
const HERO_PIC = { podium: "podium", asked: "street-six", unanswered: "street", phone: "crew" };
const pick = (item, v) => (item.img2 && HERO_PIC[v.scene] === item.img ? [item.img2, item.alt2] : [item.img, item.alt]);

function report(v) {
  const R = C.report, S = R.sample;
  const rows = S.rows.map((row) => `<div class="rep-row${row.flag ? " flag" : ""}"><dt>${esc(row.name)}</dt><dd>
      <span class="rep-bar mine"><i style="--w:${row.youPct}%"></i>${esc(row.you)}</span>
      <span class="rep-bar theirs"><i style="--w:${row.topPct}%"></i>${esc(row.top)}</span></dd></div>`).join("");
  return `<section class="proof sec" id="report" aria-labelledby="report-h">
  <div class="wrap">
    <header class="sec-head reveal"><p class="eyebrow">${esc(R.eyebrow)}</p><h2 class="h2" id="report-h">${esc(R.h2)}</h2><p class="lead">${esc(R.lead)}</p></header>
    <ul class="pts">${R.points.map((p) => { const [im, alt] = pick(p, v); return `<li class="pt reveal"><div class="pt-img">${pic(im, "220px", alt, "", ' loading="lazy"')}</div><h3>${esc(p.title)}</h3><p>${esc(p.text)}</p></li>`; }).join("")}</ul>
    <div class="report-grid">
      <figure class="reveal">
        <div class="rep" aria-label="${esc(S.caption)}">
          <div class="rep-top"><div><p class="rep-tag">${esc(S.label)}</p><p class="rep-biz">${esc(S.business)}</p><p class="rep-search">${esc(S.search)}</p></div>
            <div class="rep-score"><b>${esc(S.score)}<small>/100</small></b><span class="tier">${esc(S.tier)}</span></div></div>
          <p class="rep-legend"><span class="mine">${esc(S.you)}</span><span class="theirs">${esc(S.top)}</span></p>
          <dl class="rep-rows">${rows}</dl>
          <p class="rep-theme">${esc(S.theme)}</p>
        </div>
        <figcaption class="proof-chip">${esc(S.caption)}</figcaption>
      </figure>
      <div class="reveal">
        <p class="list-t">${esc(R.checksTitle)}</p>
        <ul class="done-list one">${R.checks.map((t) => `<li>${ic("i-check")}<span>${esc(t)}</span></li>`).join("")}</ul>
        <p class="muted" style="margin-top:14px">${esc(R.checksNote)}</p>
        <div class="sec-cta">${openBtn(R.cta, "report")}</div>
      </div>
    </div>
  </div>
</section>`;
}

function leaks(v) {
  const L = C.leaks;
  return `<section class="proof sec tint" id="leaks" aria-labelledby="leaks-h">
  <div class="wrap">
    <header class="sec-head reveal"><p class="eyebrow">${esc(L.eyebrow)}</p><h2 class="h2" id="leaks-h">${esc(L.h2)}</h2><p class="lead">${esc(L.lead)}</p></header>
    <ul class="cases">${L.cases.map((c) => { const [im, alt] = pick(c, v); return `<li class="case reveal"><div class="case-img">${pic(im, "280px", alt, "", ' loading="lazy"')}</div><span class="tag">${esc(c.tag)}</span><h3>${esc(c.title)}</h3><p>${esc(c.text)}</p><p class="fix"><b>${esc(L.with)}</b> ${esc(c.fix)}</p></li>`; }).join("")}</ul>
  </div>
</section>`;
}

function service() {
  const S = C.service;
  return `<section class="proof sec" id="service" aria-labelledby="service-h">
  <div class="wrap">
    <header class="sec-head reveal"><p class="eyebrow">${esc(S.eyebrow)}</p><h2 class="h2" id="service-h">${esc(S.h2)}</h2><p class="lead">${esc(S.lead)}</p></header>
    <div class="svc-grid">
      <figure class="fig-phone reveal">${phone(false)}</figure>
      <div class="reveal">
        <p class="list-t">${esc(S.listTitle)}</p>
        <ul class="done-list">${S.list.map((t) => `<li>${ic("i-check")}<span>${esc(t)}</span></li>`).join("")}</ul>
      </div>
    </div>
    <div class="start reveal">
      <h3 class="h3">${esc(S.startTitle)}</h3>
      <ol class="steps">${S.start.map((s) => `<li><b>${esc(s.title)}</b><span>${esc(s.text)}</span></li>`).join("")}</ol>
    </div>
    <div class="sec-cta">${openBtn(S.cta, "service")}</div>
  </div>
</section>`;
}

function honest() {
  const H = C.honest;
  return `<section class="proof sec tint" id="honest" aria-labelledby="honest-h">
  <div class="wrap">
    <header class="sec-head reveal"><p class="eyebrow">${esc(H.eyebrow)}</p><h2 class="h2" id="honest-h">${esc(H.h2)}</h2></header>
    <ul class="honest">${H.items.map((h) => `<li class="reveal"><span class="no-ic">${ic("i-x")}</span><b>${esc(h.title)}</b><span>${esc(h.text)}</span></li>`).join("")}</ul>
    <p class="rules reveal">${esc(H.rules)}</p>
    <p class="callout reveal">${ic("i-shield")}<span>${esc(H.tool)}</span></p>
  </div>
</section>`;
}

function faq() {
  const F = C.faq;
  const answer = (it) => {
    if (it.decided && SITE.offer && SITE.offer.decided && SITE.offer.line) return esc(SITE.offer.line);
    return esc(T(it.a)) + (it.decided ? ` ${tbd(C.footer.offerTbd)}` : "");
  };
  return `<section class="proof sec" id="faq" aria-labelledby="faq-h">
  <div class="wrap">
    <header class="sec-head reveal"><p class="eyebrow">${esc(F.eyebrow)}</p><h2 class="h2" id="faq-h">${esc(F.h2)}</h2><p class="lead">${esc(F.lead)}</p></header>
    <div class="faq-groups">${F.groups.map((g) => `<div class="faq-g reveal"><h3>${esc(g.name)}</h3><div class="faq">${g.items.map((it) => `<details data-q="${esc(it.q)}"><summary>${esc(it.q)}${ic("i-down")}</summary><p class="ans">${answer(it)}</p></details>`).join("")}</div></div>`).join("")}</div>
  </div>
</section>`;
}

function founder() {
  const f = SITE.founder;
  if (!f) return `<section class="proof sec" data-tbd aria-label="${esc(C.founder.eyebrow)}"><div class="wrap"><p class="eyebrow">${esc(C.founder.eyebrow)}</p><p style="margin-top:12px">${tbd(C.founder.tbd)}</p></div></section>`;
  return `<section class="proof sec" id="founder" aria-labelledby="founder-h">
  <div class="wrap"><header class="sec-head"><p class="eyebrow" id="founder-h">${esc(C.founder.eyebrow)}</p></header>
    <div class="founder reveal">${f.photo ? `<img src="${esc(f.photo)}" alt="${esc(f.name)}" width="96" height="96" loading="lazy">` : ""}<div><b>${esc(f.name)}</b><span>${esc(f.role || "")}</span></div>${f.line ? `<p>${esc(f.line)}</p>` : ""}</div>
  </div>
</section>`;
}

function final() {
  const F = C.final;
  return `<section class="story sec final" id="final" aria-labelledby="final-h">
  <div class="wrap">
    <p class="eyebrow">${esc(F.eyebrow)}</p>
    <h2 class="h2" id="final-h" style="margin-top:12px">${esc(F.h2)}</h2>
    <ul class="stack">${F.stack.map((s) => `<li>${esc(s)}</li>`).join("")}</ul>
    <p class="lead">${esc(F.lead)}</p>
    <div class="sec-cta">${openBtn(F.cta, "final")}</div>
    <ul class="trust">${C.hero.trust.map((t) => `<li>${ic("i-check")}${esc(T(t))}</li>`).join("")}</ul>
  </div>
</section>`;
}

function footer() {
  const F = C.footer;
  const company = SITE.company ? esc(SITE.company) : `Rempo ${tbd(F.companyTbd)}`;
  const privacy = SITE.privacyUrl ? `<a href="${esc(SITE.privacyUrl)}">${esc(F.privacy)}</a>` : tbd(F.privacyTbd);
  const link = (href, label) => (href ? `<a href="${esc(href)}">${esc(label)}</a>` : "");
  const legal = [link(LEGAL.terms, F.terms), link(LEGAL.cookies, F.cookies), link(LEGAL.sms, F.sms), link(LEGAL.accessibility, F.accessibility), link(LEGAL.hub, F.hub)].join("");
  const choices = link(LEGAL.choices, F.choices);
  const settings = TRACKERS ? `<button type="button" class="foot-btn" data-cookie-settings>${esc(F.settings)}</button>` : "";
  return `<footer class="foot">
  <div class="wrap foot-grid">
    <span class="brand" aria-label="Rempo"><svg viewBox="0 0 211.2 64" role="img" aria-label="Rempo"><use href="#logo-h"/></svg></span>
    <p>${esc(F.about)}</p>
    <p class="foot-links">${SITE.masterUrl ? `<a href="${esc(SITE.masterUrl)}">${esc(F.master)}</a>` : ""}${privacy}</p>
    ${legal || choices ? `<nav class="foot-legal" aria-label="${esc(F.legalLabel)}">${legal}${choices}${settings}</nav>` : ""}
    <p class="foot-small">${company}</p>
  </div>
</footer>`;
}

/* ---------- The cookie notice: only when a pixel or Clarity id is set. The tools themselves load from the page's
   script (src/js/app.js), and only as site.trackingConsent allows: never with Global Privacy Control ---------- */
const TOOLS = [SITE.metaPixelId && C.cookie.pixel, SITE.clarityId && C.cookie.clarity].filter(Boolean);
function cookieNotice() {
  if (!TRACKERS) return "";
  const K = C.cookie, optIn = SITE.trackingConsent !== "notice";
  const tools = TOOLS.join(` ${K.and} `);
  const text = fill(esc(optIn ? K.optIn : K.notice), { tools: esc(tools) });
  const [no, yes] = optIn ? [K.decline, K.allow] : [K.optOut, K.ok];
  return `<section class="cookie" id="cookie-notice" aria-label="${esc(K.label)}" hidden>
  <p><b>${esc(K.title)}</b> ${text} <a href="${esc(LEGAL.cookies || SITE.privacyUrl || "")}">${esc(K.link)}</a></p>
  <div class="cookie-btns"><button type="button" class="btn btn-line" data-consent="denied">${esc(no)}</button><button type="button" class="btn btn-line" data-consent="granted">${esc(yes)}</button></div>
</section>`;
}

/* ---------- The page ---------- */
const TRACKING = {
  pixel: SITE.metaPixelId ? String(SITE.metaPixelId).replace(/\D/g, "") : null,
  clarity: SITE.clarityId ? String(SITE.clarityId).replace(/[^a-z0-9]/gi, "") : null,
  mode: SITE.trackingConsent === "notice" ? "notice" : "opt-in"
};
const PUBLIC_SITE = { name: SITE.name, endpoint: SITE.endpoint, reportTurnaround: SITE.reportTurnaround, checkoutUrl: SITE.checkoutUrl, vsl: SITE.vsl, privacyUrl: SITE.privacyUrl, legal: LEGAL, noticeVersion: SITE.noticeVersion || null, tracking: TRACKING };
const UI = { check: C.check, result: C.result, legal: C.legal };

function page(v) {
  const urlPath = v.slug ? `${BASE}/${v.slug}` : BASE;
  const canonical = SITE.url ? `${SITE.url.replace(/\/$/, "")}${urlPath}` : null;
  const data = JSON.stringify({ site: PUBLIC_SITE, survey: SURVEY, ui: UI, variant: v.id }).replace(/</g, "\\u003c");
  const ogImage = SITE.url ? `${SITE.url.replace(/\/$/, "")}${A("/assets/og.jpg")}` : A("/assets/og.jpg");
  return `<!doctype html>
<!-- Built by meta/tools/build.mjs from meta/content/ and meta/src/. Do not edit: edit the sources and run node meta/tools/build.mjs -->
<html lang="en" class="no-js" data-variant="${esc(v.id)}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>${esc(C.meta.title)}</title>
<meta name="description" content="${esc(T(C.meta.description))}">
<meta name="robots" content="noindex, nofollow">
${canonical ? `<link rel="canonical" href="${esc(canonical)}">\n` : ""}<meta property="og:type" content="website">
<meta property="og:site_name" content="Rempo">
<meta property="og:title" content="${esc(v.h1)}">
<meta property="og:description" content="${esc(v.lead)}">
<meta property="og:image" content="${esc(ogImage)}">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta property="og:image:alt" content="${esc(C.meta.ogAlt)}">
<meta name="twitter:card" content="summary_large_image">
<meta name="theme-color" content="#FFFFFF">
<link rel="icon" href="${A("/assets/favicon.svg")}" type="image/svg+xml">
<link rel="preload" href="${A("/assets/fonts/outfit.woff2")}" as="font" type="font/woff2" crossorigin>
<link rel="preload" href="${A("/assets/fonts/geist.woff2")}" as="font" type="font/woff2" crossorigin>
<style>${CSS}</style>
</head>
<body>
<svg width="0" height="0" style="position:absolute" aria-hidden="true" focusable="false"><defs>${SYMBOLS}</defs></svg>
<a class="skip-link" href="#gap-check">Skip to the Gap Check</a>
<div class="preview-bar" data-tbd role="note">Preview: open facts are marked {TBD} and hidden from visitors · variant ${esc(v.id)} · <a href="${urlPath}">Production view</a></div>
<header class="hdr"><div class="wrap"><a class="brand" href="#top" aria-label="Rempo, back to top"><svg viewBox="0 0 211.2 64" aria-hidden="true"><use href="#logo-h"/></svg></a></div></header>
<main id="main">
${hero(v)}
${report(v)}
${leaks(v)}
${service()}
${honest()}
${faq()}
${founder()}
${final()}
</main>
${footer()}
<div class="sticky-bar">${openBtn(C.sticky, "sticky", "btn btn-primary")}</div>
<dialog class="dlg" id="gc-sheet" aria-label="${esc(C.check.label)}"><div class="dlg-in"><div class="dlg-head"><button class="dlg-x" type="button" aria-label="Close">${ic("i-x")}</button></div><div class="dlg-body"></div></div></dialog>
${cookieNotice()}
<script type="application/json" id="rm-data">${data}</script>
<script src="${V["/assets/app.js"]}" defer></script>
</body>
</html>
`;
}

const pages = {};
for (const v of VARIANTS) {
  const rel = v.slug ? path.join(v.slug, "index.html") : "index.html";
  pages[rel] = page(v);
}

for (const [rel, body] of Object.entries(pages)) {
  const file = path.join(OUT, rel);
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, body);
}

/* ---------- --check: the committed folder must be exactly what the sources build ---------- */
if (CHECK) {
  const list = (dir, base = dir) => readdirSync(dir).flatMap((n) => { const p = path.join(dir, n); return statSync(p).isDirectory() ? list(p, base) : [path.relative(base, p)]; }).sort();
  const want = list(OUT), have = existsSync(SITE_DIR) ? list(SITE_DIR) : [];
  const diff = [...new Set([...want, ...have])].filter((f) => !want.includes(f) || !have.includes(f) || !readFileSync(path.join(OUT, f)).equals(readFileSync(path.join(SITE_DIR, f))));
  rmSync(OUT, { recursive: true, force: true });
  if (diff.length) { console.error(`${BASE.slice(1)}/ is stale: ${diff.join(", ")}. Run node meta/tools/build.mjs`); process.exit(1); }
  console.log(`build --check: ${BASE.slice(1)}/ is up to date`);
} else {
  const kb = (f) => (statSync(path.join(OUT, f)).size / 1024).toFixed(1);
  console.log(`built ${VARIANTS.length} pages into ${BASE.slice(1)}/: ${VARIANTS.map((v) => (v.slug ? `${BASE}/${v.slug}` : BASE)).join(", ")} (index.html ${kb("index.html")} KB, app.js ${kb("assets/app.js")} KB)`);
}
