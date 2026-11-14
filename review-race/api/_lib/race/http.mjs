// Small HTTP helpers shared by the Review Race endpoints and its outside services.
import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";

export function send(res, status, body, headers = {}) {
  res.statusCode = status;
  res.setHeader("content-type", "application/json; charset=utf-8");
  res.setHeader("cache-control", "no-store");
  for (const [k, v] of Object.entries(headers)) res.setHeader(k, v);
  res.end(JSON.stringify(body));
}

export function sendHtml(res, status, html) {
  res.statusCode = status;
  res.setHeader("content-type", "text/html; charset=utf-8");
  res.setHeader("cache-control", "no-store");
  res.setHeader("x-robots-tag", "noindex, nofollow");
  res.end(html);
}

// The body as JSON (or form fields), at most 64 KB. Vercel may hand over a parsed body already.
export async function readBody(req) {
  if (req.body && typeof req.body === "object" && !Buffer.isBuffer(req.body)) return req.body;
  let raw = "";
  if (typeof req.body === "string") raw = req.body;
  else if (Buffer.isBuffer(req.body)) raw = req.body.toString("utf8");
  else {
    raw = await new Promise((resolve, reject) => {
      let s = "";
      req.setEncoding("utf8");
      req.on("data", (c) => { s += c; if (s.length > 65536) { reject(Object.assign(new Error("too large"), { status: 413 })); req.destroy(); } });
      req.on("end", () => resolve(s));
      req.on("error", reject);
    });
  }
  if (!raw) return {};
  const type = String(req.headers["content-type"] || "");
  if (type.includes("application/x-www-form-urlencoded")) return Object.fromEntries(new URLSearchParams(raw));
  try { return JSON.parse(raw); } catch { throw Object.assign(new Error("invalid json"), { status: 400 }); }
}

export const host = (req) => String(req.headers["x-forwarded-host"] || req.headers.host || "").split(",")[0].trim();

// A browser always sends Origin with a POST: only this site's own pages may post here
export function sameOrigin(req) {
  const origin = req.headers.origin;
  if (!origin) return true;
  try { return new URL(origin).host === host(req); } catch { return false; }
}

export function clientIp(req) {
  return String(req.headers["x-forwarded-for"] || req.headers["x-real-ip"] || req.socket?.remoteAddress || "").split(",")[0].trim();
}

export const ipHash = (ip, salt) => (ip ? createHash("sha256").update(`${salt}|${ip}`).digest("hex") : null);
export const newToken = () => randomBytes(24).toString("base64url");
export const sign = (value, secret) => createHmac("sha256", secret).update(String(value)).digest("base64url").slice(0, 32);
export function verifySig(value, sig, secret) {
  const a = Buffer.from(sign(value, secret)), b = Buffer.from(String(sig || ""));
  return a.length === b.length && timingSafeEqual(a, b);
}

// fetch with a timeout; returns { status, ok, data, headers } and never throws on an HTTP error status
export async function fetchJson(url, { method = "GET", headers = {}, body, timeoutMs = 20000, form = false } = {}) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const init = { method, headers: { accept: "application/json", ...headers }, signal: ctrl.signal };
    if (body !== undefined) {
      if (form) { init.body = new URLSearchParams(body).toString(); init.headers["content-type"] = "application/x-www-form-urlencoded"; }
      else { init.body = JSON.stringify(body); init.headers["content-type"] = "application/json"; }
    }
    const r = await fetch(url, init);
    const text = await r.text();
    let data = null;
    try { data = text ? JSON.parse(text) : null; } catch { data = text; }
    return { status: r.status, ok: r.ok, data, headers: r.headers };
  } catch (e) {
    if (e && e.name === "AbortError") throw Object.assign(new Error(`timed out after ${timeoutMs} ms: ${url.split("?")[0]}`), { code: "timeout" });
    throw e;
  } finally {
    clearTimeout(timer);
  }
}

export const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
export const clean = (v, max = 200) => String(v ?? "").replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, max);
export const EMAIL = /^[^\s@<>,]+@[^\s@<>,]+\.[^\s@<>,]+$/;
export function usPhone(p) {
  const d = String(p || "").replace(/\D/g, "");
  if (d.length === 11 && d[0] === "1") return d.slice(1);
  return d.length === 10 ? d : "";
}
