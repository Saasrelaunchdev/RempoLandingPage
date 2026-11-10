// A local stand-in for Vercel: the static site with range requests (video), vercel.json's rewrites, the api/ handlers,
// and the local store's public files at /__store/. Uses PROOF_STORE_DIR for storage (a temporary folder by default).
//
//   npm run dev                      http://localhost:3000, admin password "local-admin-password" unless ADMIN_PASSWORD
//   PROOF_FAKE_AI=1 npm run dev      Claude and the transcription replaced by fixed answers (tests/fakes.mjs), no keys
import { createServer } from "node:http";
import { createReadStream, existsSync, mkdtempSync, readFileSync, statSync } from "node:fs";
import { extname, join, normalize, sep } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
process.env.PROOF_STORE_DIR ||= mkdtempSync(join(tmpdir(), "proof-store-"));
process.env.ADMIN_PASSWORD ||= "local-admin-password";
if (process.env.PROOF_FAKE_AI) {
  const { installFakes } = await import("./fakes.mjs");
  installFakes();
}

const TYPES = { ".html": "text/html; charset=utf-8", ".css": "text/css", ".js": "text/javascript", ".mjs": "text/javascript", ".json": "application/json",
  ".svg": "image/svg+xml", ".png": "image/png", ".jpg": "image/jpeg", ".webp": "image/webp", ".woff2": "font/woff2", ".mp4": "video/mp4",
  ".webm": "video/webm", ".vtt": "text/vtt", ".srt": "text/plain", ".mp3": "audio/mpeg", ".txt": "text/plain" };
const vercel = JSON.parse(readFileSync(join(ROOT, "vercel.json"), "utf8"));

function rewrite(pathname) {
  for (const r of vercel.rewrites || []) {
    const names = [];
    const re = new RegExp("^" + r.source.replace(/\/:(\w+)/g, (_, n) => { names.push(n); return "/([^/]+)"; }) + "$");
    const m = pathname.match(re);
    if (m) return names.reduce((d, n, i) => d.replace(`:${n}`, encodeURIComponent(decodeURIComponent(m[i + 1]))), r.destination);
  }
  return null;
}

function serveFile(req, res, file) {
  const size = statSync(file).size;
  const type = TYPES[extname(file).toLowerCase()] || "application/octet-stream";
  const range = /bytes=(\d*)-(\d*)/.exec(req.headers.range || "");
  res.setHeader("accept-ranges", "bytes");
  res.setHeader("content-type", type);
  res.setHeader("cache-control", "no-store");
  if (range) {
    const start = range[1] ? Number(range[1]) : size - Number(range[2]);
    const end = range[1] && range[2] ? Number(range[2]) : size - 1;
    res.writeHead(206, { "content-range": `bytes ${start}-${end}/${size}`, "content-length": end - start + 1 });
    return createReadStream(file, { start, end }).pipe(res);
  }
  res.writeHead(200, { "content-length": size });
  if (req.method === "HEAD") return res.end();
  createReadStream(file).pipe(res);
}

const handlers = new Map();
async function api(name) {
  if (!handlers.has(name)) {
    const mod = await import(pathToFileURL(join(ROOT, "api", `${name}.mjs`)).href);
    handlers.set(name, typeof mod.default === "function" ? mod.default : webHandler(mod));
  }
  return handlers.get(name);
}

// A function written the Web way (export async function POST(request) { return new Response(...) }), as Vercel runs it:
// the request becomes a Request with its raw body, and the Response is written back. api/stripe-webhook.mjs is one.
const HOP = new Set(["connection", "keep-alive", "transfer-encoding", "upgrade", "expect", "host", "content-length"]);
function webHandler(mod) {
  return async (req, res) => {
    const fn = mod[req.method] || (req.method === "HEAD" ? mod.GET : undefined);
    if (typeof fn !== "function") {
      res.writeHead(405, { allow: Object.keys(mod).filter((k) => /^[A-Z]+$/.test(k)).join(", ") });
      return res.end();
    }
    const chunks = [];
    for await (const c of req) chunks.push(c);
    const headers = Object.entries(req.headers).filter(([k]) => !HOP.has(k)).map(([k, v]) => [k, Array.isArray(v) ? v.join(", ") : String(v)]);
    const request = new Request(new URL(req.url, `http://${req.headers.host || "localhost"}`), {
      method: req.method, headers, body: req.method === "GET" || req.method === "HEAD" ? undefined : Buffer.concat(chunks)
    });
    const response = await fn(request);
    res.writeHead(response.status, Object.fromEntries(response.headers));
    res.end(req.method === "HEAD" ? undefined : Buffer.from(await response.arrayBuffer()));
  };
}

export function start(port = Number(process.env.PORT) || 3000) {
  const server = createServer(async (req, res) => {
    try {
      const url = new URL(req.url, "http://local");
      let path = decodeURIComponent(url.pathname);
      const to = rewrite(url.pathname);
      if (to) { const u = new URL(to, "http://local"); path = u.pathname; u.searchParams.forEach((v, k) => url.searchParams.set(k, v)); req.url = path + "?" + url.searchParams; }
      const m = path.match(/^\/api\/([\w-]+)$/);
      if (m && existsSync(join(ROOT, "api", `${m[1]}.mjs`))) return await (await api(m[1]))(req, res);
      if (path.startsWith("/__store/")) {
        const file = normalize(join(process.env.PROOF_STORE_DIR, "public", path.slice(9)));
        if (file.startsWith(normalize(join(process.env.PROOF_STORE_DIR, "public")) + sep) && existsSync(file)) return serveFile(req, res, file);
        res.writeHead(404); return res.end("not found");
      }
      let file = normalize(join(ROOT, path));
      if (!file.startsWith(ROOT) || /[\\/](\.git|node_modules|tests|api)([\\/]|$)/.test(file.slice(ROOT.length))) { res.writeHead(404); return res.end("not found"); }
      if (existsSync(file) && statSync(file).isDirectory()) file = join(file, "index.html");
      if (!existsSync(file)) { res.writeHead(404); return res.end("not found"); }
      return serveFile(req, res, file);
    } catch (e) {
      console.error(e);
      if (!res.headersSent) { res.writeHead(500); res.end("server error"); }
    }
  });
  return new Promise((resolve) => server.listen(port, () => resolve(server)));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const server = await start();
  console.log(`http://localhost:${server.address().port}  store: ${process.env.PROOF_STORE_DIR}  admin password: ${process.env.ADMIN_PASSWORD === "local-admin-password" ? "local-admin-password" : "(ADMIN_PASSWORD)"}`);
}
