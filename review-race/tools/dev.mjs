// Local server: public/ as static files and the two functions at /api/race and /api/race-cron, as Vercel runs them.
//   npm run dev          with the settings in .env.local (copy .env.example)
//   npm run dev:fake     sample data and an in-memory store: no keys needed
// PORT=3210 by default.
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const PUBLIC = path.join(ROOT, "public");

// .env.local, if present: KEY=value lines (no export, no quotes needed)
const envFile = path.join(ROOT, ".env.local");
if (fs.existsSync(envFile)) {
  for (const line of fs.readFileSync(envFile, "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (m && !line.trim().startsWith("#") && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "").replace(/\s+#.*$/, "");
  }
}

const TYPES = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".svg": "image/svg+xml", ".woff2": "font/woff2", ".png": "image/png", ".ico": "image/x-icon", ".json": "application/json" };
const handlers = {
  "/api/race": (await import(pathToFileURL(path.join(ROOT, "api/race.mjs")).href)).default,
  "/api/race-cron": (await import(pathToFileURL(path.join(ROOT, "api/race-cron.mjs")).href)).default
};

export function createServer() {
  return http.createServer(async (req, res) => {
    const url = new URL(req.url, "http://localhost");
    const fn = handlers[url.pathname];
    if (fn) {
      try { await fn(req, res); } catch (e) { console.error(e); if (!res.headersSent) { res.statusCode = 500; res.end("error"); } }
      return;
    }
    let file = path.normalize(path.join(PUBLIC, decodeURIComponent(url.pathname)));
    if (!file.startsWith(PUBLIC)) { res.statusCode = 403; return res.end(); }
    if (fs.existsSync(file) && fs.statSync(file).isDirectory()) file = path.join(file, "index.html");
    if (!fs.existsSync(file)) { res.statusCode = 404; return res.end("not found"); }
    res.setHeader("content-type", TYPES[path.extname(file)] || "application/octet-stream");
    res.setHeader("cache-control", "no-store");
    fs.createReadStream(file).pipe(res);
  });
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const port = Number(process.env.PORT || 3210);
  createServer().listen(port, () => console.log(`Review Race on http://localhost:${port}${process.env.RACE_FAKE ? " (demo data)" : ""}`));
}
