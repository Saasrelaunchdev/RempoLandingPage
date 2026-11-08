// GET /api/proof: the published case studies and video testimonials, in order, as the landing page shows them. The page
// renders its two sections from this (assets/proof.js + assets/proof-render.mjs). Cached at the edge for a minute, so a
// change made in /admin is live within about two minutes; the seed content when nothing is stored yet.
import { loadPublished } from "./_lib/proof/store.mjs";
import { send } from "./_lib/proof/http.mjs";

export default async function handler(req, res) {
  if (req.method !== "GET" && req.method !== "HEAD") { res.setHeader("allow", "GET"); return send(res, 405, { error: "method not allowed" }); }
  const pub = await loadPublished();
  return send(res, 200, pub, "public, max-age=0, s-maxage=60, stale-while-revalidate=600");
}
