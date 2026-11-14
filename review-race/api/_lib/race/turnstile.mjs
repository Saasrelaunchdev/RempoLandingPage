// Cloudflare Turnstile: the invisible check that a person, not a script, started a race (each race spends SerpApi
// searches). Off until TURNSTILE_SITE_KEY and TURNSTILE_SECRET_KEY are both set.
import { fetchJson } from "./http.mjs";

export async function verifyHuman(c, token, ip) {
  if (c.fake || !c.turnstile.secret || !c.turnstile.siteKey) return { ok: true, skipped: true };
  if (!token) return { ok: false, reason: "missing" };
  const r = await fetchJson("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
    method: "POST", form: true, timeoutMs: 8000,
    body: { secret: c.turnstile.secret, response: String(token).slice(0, 2048), ...(ip ? { remoteip: ip } : {}) }
  });
  const ok = Boolean(r.ok && r.data && r.data.success);
  return { ok, reason: ok ? null : ((r.data && r.data["error-codes"]) || []).join(",") || `HTTP ${r.status}` };
}
