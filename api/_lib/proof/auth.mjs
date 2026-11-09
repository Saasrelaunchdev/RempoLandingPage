// The admin's session. One password (ADMIN_PASSWORD, a Vercel environment variable); a signed, HttpOnly, SameSite=Strict
// cookie for 12 hours. The signing key comes from ADMIN_SESSION_SECRET when set, otherwise from the password itself,
// so changing the password signs everyone out.
import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";

const COOKIE = "rempo_admin";
const TTL_S = 12 * 60 * 60;
const env = (n) => (process.env[n] ? String(process.env[n]) : "");
const password = () => env("ADMIN_PASSWORD");
const key = () => env("ADMIN_SESSION_SECRET").trim() || createHash("sha256").update("rempo-admin-session|" + password()).digest("hex");
const sign = (s) => createHmac("sha256", key()).update(s).digest("base64url");
const same = (a, b) => {
  const x = createHash("sha256").update(String(a)).digest(), y = createHash("sha256").update(String(b)).digest();
  return timingSafeEqual(x, y);
};

export const passwordConfigured = () => password().length > 0;
export const passwordStrong = () => password().length >= 12;

function cookies(req) {
  const out = {};
  String(req.headers.cookie || "").split(";").forEach((p) => {
    const i = p.indexOf("=");
    if (i > 0) { try { out[p.slice(0, i).trim()] = decodeURIComponent(p.slice(i + 1).trim()); } catch { /* a malformed cookie is no cookie */ } }
  });
  return out;
}

export function isAdmin(req) {
  if (!passwordConfigured()) return false;
  const v = cookies(req)[COOKIE];
  if (!v) return false;
  const parts = v.split(".");
  if (parts.length !== 4 || parts[0] !== "v1") return false;
  const [ver, exp, nonce, sig] = parts;
  if (!same(sig, sign(`${ver}.${exp}.${nonce}`))) return false;
  return Number(exp) * 1000 > Date.now();
}

const secure = (req) => {
  const proto = String(req.headers["x-forwarded-proto"] || "").split(",")[0].trim();
  const host = String(req.headers.host || "");
  return proto === "https" || !/^(localhost|127\.0\.0\.1)(:\d+)?$/.test(host);
};

export async function login(req, res, attempt) {
  // A wrong password costs a moment, so guessing is slow; the comparison itself takes the same time either way
  if (!passwordConfigured() || !same(attempt, password())) {
    await new Promise((r) => setTimeout(r, 650));
    return false;
  }
  const exp = Math.floor(Date.now() / 1000) + TTL_S;
  const body = `v1.${exp}.${randomBytes(9).toString("base64url")}`;
  res.setHeader("set-cookie", `${COOKIE}=${body}.${sign(body)}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${TTL_S}${secure(req) ? "; Secure" : ""}`);
  return true;
}

export function logout(req, res) {
  res.setHeader("set-cookie", `${COOKIE}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0${secure(req) ? "; Secure" : ""}`);
}

// A state-changing request must come from this site's own pages (a browser always sends Origin with a POST)
export function sameOrigin(req) {
  const origin = req.headers.origin;
  if (!origin) return true;
  const host = String(req.headers["x-forwarded-host"] || req.headers.host || "").split(",")[0].trim();
  try { return new URL(origin).host === host; } catch { return false; }
}
