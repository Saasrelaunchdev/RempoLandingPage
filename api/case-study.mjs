// GET /case-studies/<slug>/ (rewritten here by vercel.json): one case study page, rendered from the published content
// with the same renderer as the first two, so every case study keeps the same layout, scene and motion.
import { loadPublished } from "./_lib/proof/store.mjs";
import { sendHtml, query } from "./_lib/proof/http.mjs";
import { caseStudyPageHTML, pageContext, esc } from "../assets/proof-render.mjs";
import * as shell from "../assets/proof-shell.mjs";

const CACHE = "public, max-age=0, s-maxage=60, stale-while-revalidate=600";

export default async function handler(req, res) {
  const slug = String(query(req).get("slug") || "").toLowerCase().replace(/[^a-z0-9-]/g, "");
  const pub = await loadPublished();
  const ctx = slug && pageContext(pub, slug);
  if (!ctx) return sendHtml(res, 404, notFound(pub), "public, max-age=0, s-maxage=30");
  const host = String(req.headers["x-forwarded-host"] || req.headers.host || "").split(",")[0].trim();
  const origin = host ? `https://${host}` : "";
  return sendHtml(res, 200, caseStudyPageHTML(ctx.cs, { ...ctx, shell, origin }), CACHE);
}

function notFound(pub) {
  const links = (pub.cases || []).map((c) => `<li><a href="/case-studies/${esc(c.slug)}/">${esc(c.business.short)}: ${esc(c.hero.h1)}</a></li>`).join("");
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>Case study not found · Rempo</title><link rel="stylesheet" href="/assets/site.css"></head>
<body class="cs-page"><main class="wrap sec" style="display:grid;gap:18px;max-width:760px"><h1 class="h2">That case study is not here.</h1><p class="lead">It may have moved or been taken down. These are live:</p><ul style="display:grid;gap:10px;list-style:disc;padding-left:20px">${links}</ul><p><a class="btn btn-primary" href="/#results">All case studies</a></p></main></body></html>`;
}
