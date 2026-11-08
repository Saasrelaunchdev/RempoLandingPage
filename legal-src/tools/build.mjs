#!/usr/bin/env node
// Builds the legal pages into the repository's legal/ folder, served at /legal by the master page's Vercel project
// (the output is committed; Vercel runs no build). No dependencies.
//
//   node legal-src/tools/build.mjs           build ../../legal/
//   node legal-src/tools/build.mjs --check   fail if legal/ is not what the sources build (the tests run this)
//
// Each document is a Markdown file in legal-src/docs/ with a small header (title, slug, order, summary). The facts
// they share (company name, emails, dates) come from legal-src/settings.mjs as {{placeholders}}; the build stops on a
// placeholder it doesn't know, an em or en dash, or a link to a page or section that doesn't exist.
import { readFileSync, writeFileSync, mkdirSync, rmSync, readdirSync, statSync, copyFileSync, existsSync } from "node:fs";
import { createHash } from "node:crypto";
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";
import os from "node:os";

const SRC = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const REPO = path.dirname(SRC);
const LIVE = path.join(REPO, "legal");
const CHECK = process.argv.includes("--check");
const OUT = CHECK ? path.join(os.tmpdir(), `rempo-legal-check-${process.pid}`) : LIVE;
const BASE = "/legal";

const S = (await import(pathToFileURL(path.join(SRC, "settings.mjs")).href)).default;
const read = (p) => readFileSync(path.join(SRC, p), "utf8");
const hash = (buf) => createHash("sha256").update(buf).digest("hex").slice(0, 10);
const esc = (v) => String(v == null ? "" : v).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const fail = (msg) => { console.error(`build stopped: ${msg}`); process.exit(1); };

/* ---------- The facts ---------- */
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const longDate = (iso) => { const [y, m, d] = String(iso).split("-").map(Number); return `${MONTHS[m - 1]} ${d}, ${y}`; };
if (!/^\d{4}-\d{2}-\d{2}$/.test(S.updated || "")) fail("settings.updated must be a date like 2026-11-08");
const company = S.legalName || S.brand;
const VARS = {
  brand: S.brand,
  company,
  city: S.city,
  site: S.site,
  privacyEmail: S.emails.privacy,
  supportEmail: S.emails.support,
  legalEmail: S.emails.legal,
  smsProgram: S.smsProgram,
  updated: longDate(S.updated),
  addressSuffix: S.address ? `, or by mail to ${S.address}` : "",
  addressSentence: S.address ? ` Mail: ${S.address}.` : "",
  phoneSentence: S.phone ? ` You can also call ${S.phone}.` : "",
  portalSuffix: S.billingPortalUrl ? `, at ${S.billingPortalUrl}, also linked from every receipt` : " (we email you its link when your plan starts)"
};
// What the preview view lists as still missing
const MISSING = [
  !S.legalName && "the legal entity name (settings.legalName)",
  !S.address && "the mailing address for notices and email (settings.address)",
  !S.billingPortalUrl && "the billing portal link for online cancellation (settings.billingPortalUrl)"
].filter(Boolean);

/* ---------- Markdown, the small subset these documents use ---------- */
const slugify = (t) => t.toLowerCase().replace(/<[^>]+>/g, "").replace(/&[a-z]+;/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

function inline(text) {
  const links = [];
  let s = esc(text);
  // [label](url): kept aside so emails inside them are not linked twice
  s = s.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_, label, url) => {
    const ext = /^https?:\/\//.test(url);
    links.push(`<a href="${url}"${ext ? ' rel="noopener"' : ""}>${label}</a>`);
    return `\u0000${links.length - 1}\u0000`;
  });
  s = s.replace(/\b([A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,})\b/g, '<a href="mailto:$1">$1</a>');
  s = s.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>").replace(/(^|[^*])\*([^*\s][^*]*)\*/g, "$1<em>$2</em>").replace(/`([^`]+)`/g, "<code>$1</code>");
  return s.replace(/\u0000(\d+)\u0000/g, (_, i) => links[+i]);
}

function render(md) {
  const lines = md.split("\n");
  const out = [], toc = [];
  let i = 0;
  const heading = (raw) => { const m = raw.match(/^(.*?)\s*\{#([a-z0-9-]+)\}\s*$/); return m ? { text: m[1], id: m[2] } : { text: raw, id: slugify(raw) }; };
  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) { i++; continue; }
    let m;
    if ((m = line.match(/^(#{2,3})\s+(.*)$/))) {
      const level = m[1].length, h = heading(m[2]);
      if (level === 2) toc.push(h);
      out.push(`<h${level} id="${h.id}">${inline(h.text)}<a class="anchor" href="#${h.id}" aria-label="Link to this section">#</a></h${level}>`);
      i++; continue;
    }
    if (line.startsWith("<")) {   // raw HTML, up to the next blank line
      const block = [];
      while (i < lines.length && lines[i].trim()) block.push(lines[i++]);
      out.push(block.join("\n"));
      continue;
    }
    if (line.startsWith(">")) {
      const block = [];
      while (i < lines.length && lines[i].startsWith(">")) block.push(lines[i++].replace(/^>\s?/, ""));
      const paras = block.join("\n").split(/\n\s*\n/).map((p) => `<p>${inline(p.replace(/\n/g, " "))}</p>`).join("");
      out.push(`<div class="callout">${paras}</div>`);
      continue;
    }
    if (line.startsWith("|")) {
      const rows = [];
      while (i < lines.length && lines[i].startsWith("|")) rows.push(lines[i++]);
      const cells = (r) => r.trim().replace(/^\||\|$/g, "").split("|").map((c) => c.trim());
      const head = cells(rows[0]);
      const body = rows.slice(2).map(cells);
      const thead = head.some(Boolean) ? `<thead><tr>${head.map((c) => `<th scope="col">${inline(c)}</th>`).join("")}</tr></thead>` : "";
      const tbody = `<tbody>${body.map((r) => `<tr>${r.map((c, k) => (k === 0 && !thead ? `<th scope="row">${inline(c)}</th>` : `<td>${inline(c)}</td>`)).join("")}</tr>`).join("")}</tbody>`;
      out.push(`<div class="tbl" role="region" aria-label="Table" tabindex="0"><table>${thead}${tbody}</table></div>`);
      continue;
    }
    if (/^(-|\d+\.)\s/.test(line)) {
      const ordered = /^\d+\.\s/.test(line);
      const items = [];
      while (i < lines.length && lines[i].trim() && !/^(#{2,3}\s|>|\||<)/.test(lines[i])) {
        const l = lines[i];
        if (/^(-|\d+\.)\s/.test(l)) items.push(l.replace(/^(-|\d+\.)\s+/, ""));
        else items[items.length - 1] += " " + l.trim();
        i++;
      }
      const tag = ordered ? "ol" : "ul";
      out.push(`<${tag}>${items.map((t) => `<li>${inline(t)}</li>`).join("")}</${tag}>`);
      continue;
    }
    const para = [];
    while (i < lines.length && lines[i].trim() && !/^(#{2,3}\s|>|\||<|-\s|\d+\.\s)/.test(lines[i])) para.push(lines[i++].trim());
    out.push(`<p>${inline(para.join(" "))}</p>`);
  }
  return { html: out.join("\n"), toc };
}

function fillVars(text, file) {
  const s = text.replace(/\{\{(\w+)\}\}/g, (all, k) => {
    if (!(k in VARS)) fail(`${file}: unknown placeholder ${all}`);
    return VARS[k];
  });
  if (/\{\{|\}\}/.test(s)) fail(`${file}: a broken placeholder`);
  return s;
}

/* ---------- The documents ---------- */
const docs = readdirSync(path.join(SRC, "docs")).filter((f) => f.endsWith(".md")).map((file) => {
  const raw = read(`docs/${file}`);
  if (/[–—]/.test(raw)) fail(`${file}: no em or en dashes`);
  const m = raw.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  if (!m) fail(`${file}: missing the header (--- title, slug, order, summary ---)`);
  const meta = Object.fromEntries(m[1].split("\n").map((l) => { const k = l.indexOf(":"); return [l.slice(0, k).trim(), l.slice(k + 1).trim()]; }));
  for (const k of ["title", "slug", "order", "summary"]) if (!meta[k]) fail(`${file}: header needs ${k}`);
  const { html, toc } = render(fillVars(m[2], file));
  return { file, ...meta, order: +meta.order, html, toc };
}).sort((a, b) => a.order - b.order);

const FOR_CLIENTS = new Set(["acceptable-use", "dpa", "baa", "subprocessors", "billing"]);

/* ---------- Assets ---------- */
rmSync(OUT, { recursive: true, force: true });
mkdirSync(path.join(OUT, "assets", "fonts"), { recursive: true });
const V = {};
for (const rel of ["favicon.svg", "fonts/outfit.woff2", "fonts/geist.woff2"]) {
  const from = path.join(SRC, "assets", rel);
  copyFileSync(from, path.join(OUT, "assets", rel));
  V[rel] = `${BASE}/assets/${rel}?v=${hash(readFileSync(from))}`;
}
const js = read("js/legal.js");
writeFileSync(path.join(OUT, "assets", "legal.js"), js);
V["legal.js"] = `${BASE}/assets/legal.js?v=${hash(js)}`;
const fontFace = (fam, rel) => `@font-face{font-family:"${fam}";font-style:normal;font-display:swap;font-weight:100 900;src:url(${V[rel]}) format("woff2-variations")}`;
const CSS = [fontFace("Outfit", "fonts/outfit.woff2"), fontFace("Geist", "fonts/geist.woff2"), read("styles/legal.css")]
  .join("\n").replace(/\/\*[\s\S]*?\*\//g, "").replace(/\n\s*\n/g, "\n").replace(/^\s+/gm, "").trim();
const LOGO = read("partials/logo.svg");

/* ---------- The page ---------- */
const year = S.updated.slice(0, 4);
const LINKS = [["terms", "Terms"], ["privacy", "Privacy"], ["cookies", "Cookies"], ["privacy-choices", "Do Not Sell or Share My Personal Information"], ["sms", "SMS terms"], ["accessibility", "Accessibility"]];
const href = (slug) => (slug ? `${BASE}/${slug}` : BASE);

function shell({ slug, title, summary, main }) {
  const canonical = S.siteUrl ? `${S.siteUrl.replace(/\/$/, "")}${href(slug)}` : null;
  const nav = docs.map((d) => `<li><a href="${href(d.slug)}"${d.slug === slug ? ' aria-current="page"' : ""}>${esc(d.title)}</a></li>`).join("");
  return `<!doctype html>
<!-- Built by legal-src/tools/build.mjs from legal-src/docs/. Do not edit: edit the sources and run node legal-src/tools/build.mjs -->
<html lang="en" data-theme="light">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>${esc(title)} · ${esc(S.brand)}</title>
<meta name="description" content="${esc(summary)}">
${S.noindex === false ? "" : '<meta name="robots" content="noindex, nofollow">\n'}${canonical ? `<link rel="canonical" href="${esc(canonical)}">\n` : ""}<meta name="theme-color" content="#FFFFFF">
<link rel="icon" href="${V["favicon.svg"]}" type="image/svg+xml">
<link rel="preload" href="${V["fonts/outfit.woff2"]}" as="font" type="font/woff2" crossorigin>
<link rel="preload" href="${V["fonts/geist.woff2"]}" as="font" type="font/woff2" crossorigin>
<script>(function(){var d=document.documentElement,t=null;try{t=localStorage.getItem("lp-theme")}catch(e){}if(t!=="dark"&&t!=="light")t=matchMedia("(prefers-color-scheme: dark)").matches?"dark":"light";d.dataset.theme=t;if(/(^|[?&])view=preview(&|$)/.test(location.search))d.classList.add("is-preview")})();</script>
<style>${CSS}</style>
</head>
<body>
<svg width="0" height="0" style="position:absolute" aria-hidden="true" focusable="false"><defs>${LOGO}</defs></svg>
<a class="skip-link" href="#main">Skip to content</a>
${MISSING.length ? `<div class="preview-bar" data-tbd role="note">Preview: still to fill in legal-src/settings.mjs: ${esc(MISSING.join("; "))}.</div>\n` : ""}<header class="hdr"><div class="wrap hdr-in"><a class="brand" href="/" aria-label="${esc(S.brand)} home"><svg viewBox="0 0 211.2 64" aria-hidden="true"><use href="#logo-h"/></svg></a><a class="hdr-link" href="${BASE}">Legal center</a></div></header>
<div class="wrap layout">
<nav class="side" aria-label="Legal documents"><p class="side-t">Legal documents</p><ul>${nav}</ul></nav>
<main id="main" class="doc">
${main}
</main>
</div>
<footer class="foot"><div class="wrap">
<nav class="foot-links" aria-label="Legal">${LINKS.map(([s, l]) => `<a href="${href(s)}">${esc(l)}</a>`).join("")}<a href="${BASE}">Legal center</a></nav>
<p class="foot-small">© ${year} ${esc(company)} · ${esc(S.city)} · <a href="mailto:${esc(S.emails.privacy)}">${esc(S.emails.privacy)}</a></p>
</div></footer>
<script src="${V["legal.js"]}" defer></script>
</body>
</html>
`;
}

function docPage(d) {
  // The headings carry their own numbers, so the contents list has no markers of its own
  const toc = d.toc.length > 2 ? `<details class="toc" open><summary>On this page</summary><ul>${d.toc.map((h) => `<li><a href="#${h.id}">${inline(h.text)}</a></li>`).join("")}</ul></details>` : "";
  // The plain-words summary (a document's opening callout) comes before the contents
  const lead = d.html.match(/^<div class="callout">[\s\S]*?<\/div>\n?/);
  const main = `<p class="eyebrow">${FOR_CLIENTS.has(d.slug) ? "Legal · for clients" : "Legal"}</p>
<h1>${esc(d.title)}</h1>
<p class="updated">Last updated ${esc(VARS.updated)}</p>
${lead ? lead[0].trim() : ""}
${toc}
<div class="prose">
${lead ? d.html.slice(lead[0].length) : d.html}
</div>
<p class="doc-foot">Questions about this document? Email <a href="mailto:${esc(S.emails.legal)}">${esc(S.emails.legal)}</a>. <a href="#main">Back to top</a></p>`;
  return shell({ slug: d.slug, title: d.title, summary: d.summary, main });
}

function hubPage() {
  const card = (d) => `<li class="card"><a href="${href(d.slug)}"><b>${esc(d.title)}</b><span>${esc(d.summary)}</span></a></li>`;
  const everyone = docs.filter((d) => !FOR_CLIENTS.has(d.slug)), clients = docs.filter((d) => FOR_CLIENTS.has(d.slug));
  const main = `<p class="eyebrow">Legal</p>
<h1>Legal center</h1>
<p class="updated">Last updated ${esc(VARS.updated)}</p>
<div class="prose"><p class="lead">The terms, policies, and agreements that govern ${esc(S.site)} and ${esc(S.brand)}'s services, in plain words where we can. ${esc(S.brand)} is based in ${esc(S.city)}.</p></div>
<h2 id="everyone">For everyone</h2>
<ul class="cards">${everyone.map(card).join("")}</ul>
<h2 id="clients">For clients</h2>
<ul class="cards">${clients.map(card).join("")}</ul>
<h2 id="contact">Contact</h2>
<div class="prose"><ul>
<li>Privacy requests: <a href="mailto:${esc(S.emails.privacy)}">${esc(S.emails.privacy)}</a></li>
<li>Support, billing, and cancellation: <a href="mailto:${esc(S.emails.support)}">${esc(S.emails.support)}</a></li>
<li>Legal notices: <a href="mailto:${esc(S.emails.legal)}">${esc(S.emails.legal)}</a>${S.address ? `, or by mail to ${esc(S.address)}` : ""}</li>
</ul></div>`;
  return shell({ slug: "", title: "Legal center", summary: `Terms, privacy, and policies for ${S.site} and ${S.brand}'s services.`, main });
}

/* ---------- Links: every /legal link and in-page anchor must exist ---------- */
const anchors = new Map(docs.map((d) => [d.slug, new Set([...d.html.matchAll(/ id="([^"]+)"/g)].map((x) => x[1]))]));
anchors.set("", new Set(["everyone", "clients", "contact"]));
for (const d of docs) {
  for (const [, url] of d.html.matchAll(/href="([^"]+)"/g)) {
    let target = null, frag = null;
    if (url.startsWith("#")) { target = d.slug; frag = url.slice(1); }
    else if (url.startsWith(BASE)) { const [p, f] = url.slice(BASE.length).replace(/^\//, "").split("#"); target = p; frag = f || null; }
    else continue;
    if (!anchors.has(target)) fail(`${d.file}: links to ${url}, a page that doesn't exist`);
    if (frag && !anchors.get(target).has(frag)) fail(`${d.file}: links to ${url}, a section that doesn't exist`);
  }
}

/* ---------- Write ---------- */
const pages = { "index.html": hubPage() };
for (const d of docs) pages[path.join(d.slug, "index.html")] = docPage(d);
for (const [rel, body] of Object.entries(pages)) {
  if (/[–—]/.test(body)) fail(`${rel}: an em or en dash in the output`);
  const file = path.join(OUT, rel);
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, body);
}

/* ---------- --check: the committed folder must be exactly what the sources build ---------- */
function listFiles(dir, base = dir) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).flatMap((n) => { const p = path.join(dir, n); return statSync(p).isDirectory() ? listFiles(p, base) : [path.relative(base, p)]; }).sort();
}
if (CHECK) {
  const built = listFiles(OUT), live = listFiles(LIVE);
  const diff = [...new Set([...built, ...live])].filter((f) => !built.includes(f) || !live.includes(f) || !readFileSync(path.join(OUT, f)).equals(readFileSync(path.join(LIVE, f))));
  rmSync(OUT, { recursive: true, force: true });
  if (diff.length) { console.error(`legal/ is out of date (${diff.join(", ")}): run node legal-src/tools/build.mjs and commit`); process.exit(1); }
  console.log(`legal/ matches the sources (${built.length} files)`);
} else {
  console.log(`built ${Object.keys(pages).length} pages into legal/: ${docs.map((d) => d.slug).join(", ")}${MISSING.length ? `\nstill to fill in settings.mjs: ${MISSING.join("; ")}` : ""}`);
}
