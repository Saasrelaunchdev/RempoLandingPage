// Plain Node http helpers shared by the proof endpoints (the same handlers run on Vercel and in tests/dev-server.mjs)
import { StoreError } from "./store.mjs";

export function send(res, status, data, cache) {
  res.statusCode = status;
  res.setHeader("content-type", "application/json; charset=utf-8");
  res.setHeader("cache-control", cache || "no-store");
  res.setHeader("x-content-type-options", "nosniff");
  res.end(JSON.stringify(data));
}
export function sendHtml(res, status, html, cache) {
  res.statusCode = status;
  res.setHeader("content-type", "text/html; charset=utf-8");
  res.setHeader("cache-control", cache || "no-store");
  res.setHeader("x-content-type-options", "nosniff");
  res.end(html);
}
export const query = (req) => new URL(req.url || "/", "http://local").searchParams;

export async function readRaw(req, limit) {
  if (req.body !== undefined && req.body !== null && !(typeof req.body === "object" && !Buffer.isBuffer(req.body) && typeof req.body.pipe === "function")) {
    if (Buffer.isBuffer(req.body)) return req.body;
    if (typeof req.body === "string") return Buffer.from(req.body);
    return Buffer.from(JSON.stringify(req.body));
  }
  const chunks = [];
  let size = 0;
  for await (const c of req) {
    size += c.length;
    if (size > limit) throw Object.assign(new Error("too large"), { status: 413 });
    chunks.push(c);
  }
  return Buffer.concat(chunks);
}
// Vercel parses a JSON body into req.body already; a plain Node server leaves the stream
export async function readJson(req, limit = 4 * 1024 * 1024) {
  if (req.body && typeof req.body === "object" && !Buffer.isBuffer(req.body) && typeof req.body.pipe !== "function") return req.body;
  const raw = await readRaw(req, limit);
  try { return JSON.parse(raw.toString("utf8") || "{}"); } catch { throw Object.assign(new Error("invalid JSON"), { status: 400 }); }
}

export function fail(res, e) {
  const status = (e && e.status) || (e instanceof StoreError ? e.status : 500);
  if (status >= 500) console.error(e);
  send(res, status, { error: (e && e.message) || "error", code: (e && e.code) || undefined });
}
