#!/usr/bin/env node
// The pages on your machine, laid out as on Vercel: the built ../customers/ folder at /customers (/customers/recent
// serves ../customers/recent/index.html), the legal pages (../legal/, built from ../legal-src/) at /legal, and
// /api/meta-lead running the real function (../api/meta-lead.mjs).
//
//   node tools/dev.mjs                 http://localhost:8790/customers, /api/meta-lead uses the variables in your environment
//   node tools/dev.mjs --stub          Supabase, Resend, Slack and Meta answered locally: every call is recorded and
//                                      listed at /__stub (DELETE /__stub clears it). Nothing leaves the machine.
//   node tools/dev.mjs --port 9000
//
// Build first (node tools/build.mjs); add ?view=preview to a page to see its {TBD} notes.
import http from "node:http";
import { readFile, stat } from "node:fs/promises";
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const SITE = (await import(pathToFileURL(path.join(ROOT, "content", "site.mjs")).href)).default;
const BASE = SITE.path;                                   // "/customers"
const PUBLIC = path.join(ROOT, "..", BASE.slice(1));      // the repository's customers/ folder
const LEGAL = path.join(ROOT, "..", "legal");             // the repository's legal/ folder, served at /legal
const arg = (n, d) => { const i = process.argv.indexOf(n); return i > 0 ? process.argv[i + 1] : d; };
const PORT = Number(arg("--port", process.env.PORT || 8790));
const STUB = process.argv.includes("--stub");

export const calls = [];
if (STUB) {
  const defaults = {
    SUPABASE_URL: "https://stub-project.supabase.co", SUPABASE_ANON_KEY: "sb_publishable_stub", LEAD_HASH_SALT: "stub-salt",
    RESEND_API_KEY: "re_stub", LEAD_NOTIFY_FROM: "Rempo Leads <leads@example.com>", LEAD_NOTIFY_TO: "owner@example.com",
    SLACK_WEBHOOK_URL: "https://hooks.slack.com/services/T0/B0/STUB", META_PIXEL_ID: "1234567890", META_CAPI_TOKEN: "EAAstub",
    PROSPECT_EMAIL_FROM: "Ali at Rempo <ali@example.com>"
  };
  for (const [k, v] of Object.entries(defaults)) if (!process.env[k]) process.env[k] = v;
  const real = globalThis.fetch;
  globalThis.fetch = async (url, init = {}) => {
    const u = String(url);
    const svc = u.includes(".supabase.co/rest/v1/") ? "supabase" : u.startsWith("https://api.resend.com/") ? "resend"
      : u.startsWith("https://hooks.slack.com/") ? "slack" : u.startsWith("https://graph.facebook.com/") ? "meta" : null;
    if (!svc) return real(url, init);
    let body = null;
    try { body = init.body ? JSON.parse(init.body) : null; } catch { body = init.body; }
    calls.push({ svc, url: u.replace(/access_token=[^&]+/, "access_token=[token]"), body, at: Date.now() });
    const answer = svc === "supabase" ? (u.endsWith("lead_capture_health") ? '"lead-capture v1"' : `"${crypto.randomUUID()}"`)
      : svc === "meta" ? '{"events_received":1,"fbtrace_id":"stub"}' : svc === "slack" ? "ok" : '{"id":"stub"}';
    return new Response(answer, { status: 200 });
  };
}

const handler = (await import(pathToFileURL(path.join(ROOT, "..", "api", "meta-lead.mjs")).href)).default;
const TYPES = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".svg": "image/svg+xml",
  ".webp": "image/webp", ".jpg": "image/jpeg", ".png": "image/png", ".woff2": "font/woff2", ".txt": "text/plain; charset=utf-8", ".json": "application/json", ".ics": "text/calendar" };

async function file(res, p, status = 200) {
  const body = await readFile(p);
  res.writeHead(status, { "content-type": TYPES[path.extname(p)] || "application/octet-stream", "cache-control": "no-store" });
  res.end(body);
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  try {
    if (url.pathname === SITE.endpoint) return await handler(req, res);
    if (STUB && url.pathname === "/__stub") {
      if (req.method === "DELETE") calls.length = 0;
      res.writeHead(200, { "content-type": "application/json" });
      return res.end(JSON.stringify(calls));
    }
    if (url.pathname === "/") { res.writeHead(302, { location: BASE }); return res.end(); }
    const notFound = () => { res.writeHead(404, { "content-type": "text/plain; charset=utf-8" }); res.end("not found"); };
    const legal = url.pathname === "/legal" || url.pathname.startsWith("/legal/");
    if (!legal && url.pathname !== BASE && !url.pathname.startsWith(`${BASE}/`)) return notFound();
    const [dir, prefix] = legal ? [LEGAL, "/legal"] : [PUBLIC, BASE];
    let p = path.normalize(path.join(dir, decodeURIComponent(url.pathname.slice(prefix.length))));
    if (!p.startsWith(dir)) { res.writeHead(403); return res.end(); }
    const s = await stat(p).catch(() => null);
    if (s && s.isDirectory()) p = path.join(p, "index.html");
    else if (!s) {
      const html = `${p}.html`, idx = path.join(p, "index.html");
      if (await stat(idx).catch(() => null)) p = idx;
      else if (await stat(html).catch(() => null)) p = html;
      else return notFound();
    }
    return await file(res, p);
  } catch (e) {
    console.error(e);
    res.writeHead(500);
    res.end("error");
  }
});
server.listen(PORT, () => console.log(`Rempo for Meta: http://localhost:${PORT}${BASE}${STUB ? " (stubbed services: /__stub)" : ""}`));
