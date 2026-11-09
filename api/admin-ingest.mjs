// /api/admin-ingest?action=...: the uploads' long work, up to five minutes a request, with its progress streamed back
// as one JSON object per line ({ step, label, state, detail }, then { done, item | businesses | error }), so the admin
// panel shows each step as it happens. Admin only, same-site POSTs only.
//
//   video   { pathname, name?, role?, business? }   a dropped video, start to finish
//   plan    { files: [{ pathname, name }], text? }  read a document and find the businesses in it
//   case    { job, key }                            write, check and save one business's case study
import { isAdmin, sameOrigin } from "./_lib/proof/auth.mjs";
import { query, readJson, send } from "./_lib/proof/http.mjs";
import { ingestVideo, planDocument, draftCase } from "./_lib/proof/ingest.mjs";

const RUN = { video: ingestVideo, plan: planDocument, case: draftCase };

export default async function handler(req, res) {
  if (req.method !== "POST") return send(res, 405, { error: "method not allowed" });
  if (!sameOrigin(req)) return send(res, 403, { error: "forbidden" });
  if (!isAdmin(req)) return send(res, 401, { error: "Sign in first." });
  const run = RUN[query(req).get("action") || ""];
  if (!run) return send(res, 404, { error: "unknown action" });
  let body;
  try { body = await readJson(req, 512 * 1024); } catch (e) { return send(res, e.status || 400, { error: e.message }); }

  res.statusCode = 200;
  res.setHeader("content-type", "application/x-ndjson; charset=utf-8");
  res.setHeader("cache-control", "no-store");
  res.setHeader("x-accel-buffering", "no");
  res.setHeader("x-content-type-options", "nosniff");
  if (typeof res.flushHeaders === "function") res.flushHeaders();
  const line = (o) => { try { res.write(JSON.stringify(o) + "\n"); } catch { /* the browser went away; the work still finishes and saves */ } };
  const step = (key, label) => {
    line({ step: key, label, state: "active" });
    const end = (state) => (detail) => line({ step: key, label, state, ...(detail ? { detail: String(detail) } : {}) });
    return { done: end("done"), skip: end("skipped"), fail: end("failed") };
  };
  // vercel.json gives this function 300 seconds; the work plans to finish well inside them
  const deadline = Date.now() + (Number(process.env.PROOF_INGEST_SECONDS) || 280) * 1000;
  const beat = setInterval(() => line({ beat: true }), 10000);
  try {
    const result = await run(body, { step, deadline });
    line({ done: true, ...result });
  } catch (e) {
    if (!e || !e.status || e.status >= 500) console.error(e);
    line({ done: false, error: (e && e.message) || "Something went wrong.", code: (e && e.code) || undefined });
  } finally {
    clearInterval(beat);
    res.end();
  }
}
