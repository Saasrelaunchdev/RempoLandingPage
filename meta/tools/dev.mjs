#!/usr/bin/env node
// The pages on your machine, laid out as on Vercel: the built ../customers/ folder at /customers (/customers/recent
// serves ../customers/recent/index.html), the legal pages (../legal/, built from ../legal-src/) at /legal, and
// /api/race running the Review Race (../api/race.mjs, which runs ../review-race/api/race.mjs), the page's lead capture.
//
//   node tools/dev.mjs                 http://localhost:8790/customers, /api/race uses the variables in your environment
//   node tools/dev.mjs --stub          the Review Race's demo mode: sample businesses, an in-memory store, and Meta's
//                                      Conversions API answered locally. What the race kept and sent is listed at /__stub
//                                      (leads, races, and the emails and Meta events it would have sent; DELETE /__stub
//                                      clears it). Nothing leaves the machine.
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
const RACE_API = (SITE.race && SITE.race.api) || "/api/race";

if (STUB) {
  // Demo mode: the race's sample businesses, reviews and calendar (review-race/api/_lib/race/fakes.mjs), its in-memory
  // store, and a pixel and a token so its Conversions API events are built (they go to the demo outbox, not to Meta)
  const defaults = { RACE_FAKE: "1", RACE_STORE: "memory", META_PIXEL_ID: "1234567890", META_CAPI_TOKEN: "EAAstub", RACE_PUBLIC_URL: `http://localhost:${PORT}` };
  for (const [k, v] of Object.entries(defaults)) if (!process.env[k]) process.env[k] = v;
}

const race = (await import(pathToFileURL(path.join(ROOT, "..", "api", "race.mjs")).href)).default;
const { resetMemory } = await import(pathToFileURL(path.join(ROOT, "..", "review-race", "api", "_lib", "race", "store.mjs")).href);
const TYPES = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".svg": "image/svg+xml",
  ".webp": "image/webp", ".jpg": "image/jpeg", ".png": "image/png", ".woff2": "font/woff2", ".txt": "text/plain; charset=utf-8", ".json": "application/json", ".ics": "text/calendar",
  ".mjs": "text/javascript; charset=utf-8", ".mp4": "video/mp4", ".webm": "video/webm", ".vtt": "text/vtt; charset=utf-8" };
// The master page's proof, which the pages share in production (one Vercel project): its styles and script
// (/assets/proof.*), its pictures and films (/media/...), and /api/proof (here: the seed, the set the pages are built with)
const MASTER = path.join(ROOT, "..");
const MASTER_FILES = /^\/(assets\/(proof\.css|proof\.js|proof-render\.mjs)|media\/[a-z0-9/._-]+)$/;
const { buildPublished } = await import(pathToFileURL(path.join(MASTER, "api", "_lib", "proof", "store.mjs")).href);
const { seedContent } = await import(pathToFileURL(path.join(MASTER, "api", "_lib", "proof", "seed.mjs")).href);

async function file(res, p, status = 200) {
  const body = await readFile(p);
  res.writeHead(status, { "content-type": TYPES[path.extname(p)] || "application/octet-stream", "cache-control": "no-store" });
  res.end(body);
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  try {
    if (url.pathname === RACE_API) return await race(req, res);
    if (STUB && url.pathname === "/__stub") {
      const mem = globalThis.__reviewRaceMemory || { leads: [], runs: [] };
      const outbox = globalThis.__reviewRaceOutbox || [];
      if (req.method === "DELETE") { resetMemory(); outbox.length = 0; }
      res.writeHead(200, { "content-type": "application/json" });
      return res.end(JSON.stringify({ leads: mem.leads, runs: mem.runs.map((r) => ({ token: r.token, meta: r.meta, booking: r.booking || null, email: r.email || null })), outbox }));
    }
    if (url.pathname === "/") { res.writeHead(302, { location: BASE }); return res.end(); }
    if (url.pathname === "/api/proof") { res.writeHead(200, { "content-type": "application/json" }); return res.end(JSON.stringify(buildPublished(seedContent()))); }
    if (MASTER_FILES.test(url.pathname) && !url.pathname.includes("..")) return await file(res, path.join(MASTER, url.pathname));
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
server.listen(PORT, () => console.log(`Rempo for Meta: http://localhost:${PORT}${BASE}${STUB ? " (the Review Race in demo mode: /__stub)" : ""}`));
