// Shared by api/lead.mjs (files under api/_lib are helpers, not endpoints). Installed by the landing-page-lead-capture
// skill.
//
// The Supabase project comes from the Vercel project's environment variables. The names the Supabase integration for
// Vercel creates work as well as the plain ones:
//   SUPABASE_URL        the Project URL, https://<ref>.supabase.co
//   SUPABASE_ANON_KEY   the publishable key (sb_publishable_...) or the legacy anon key (eyJ...)
// Never the secret or service_role key: the site only needs the public role, and public.submit_lead() (see
// lead-capture/leads.sql) is the one thing that role may do. A secret key here is refused, not used.

const env = (n) => (process.env[n] ? String(process.env[n]).trim() : "");
const pick = (...names) => { for (const n of names) if (env(n)) return env(n); return ""; };

export function supabaseConfig() {
  const url = pick("SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_URL", "VITE_SUPABASE_URL").replace(/\/+$/, "");
  const key = pick("SUPABASE_ANON_KEY", "SUPABASE_PUBLISHABLE_KEY", "NEXT_PUBLIC_SUPABASE_ANON_KEY",
    "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "VITE_SUPABASE_ANON_KEY", "VITE_SUPABASE_PUBLISHABLE_KEY");
  const problem = !url || !key ? "missing"
    : !/^https?:\/\/[^/\s]+$/.test(url) ? "bad-url"
    : isSecretKey(key) ? "secret-key"
    : null;
  return { url, key, ok: !problem, problem };
}

// A secret key must never be used by the site: sb_secret_... keys, and legacy JWT keys whose role is not anon
export function isSecretKey(key) {
  if (/^sb_secret_/i.test(key)) return true;
  if (/^eyJ/.test(key)) {
    try {
      const payload = JSON.parse(Buffer.from(key.split(".")[1], "base64url").toString("utf8"));
      return Boolean(payload && payload.role !== "anon");
    } catch { return false; }
  }
  return false;
}

// A legacy key is a JWT and also goes in Authorization; a new publishable key goes in apikey only (sent as a Bearer
// token it is read as a JWT and refused), and Supabase's gateway maps it to the anon role.
function headers(key, extra) {
  const h = { apikey: key, accept: "application/json", ...extra };
  if (/^eyJ/.test(key)) h.authorization = `Bearer ${key}`;
  return h;
}

// Call the Supabase REST API: returns { status, data } and never throws on an HTTP error; a network failure or the
// timeout throws (an AbortError for the timeout)
export async function rest(cfg, path, { method = "GET", body, timeoutMs = 8000 } = {}) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const r = await fetch(`${cfg.url}/rest/v1/${path}`, {
      method,
      headers: headers(cfg.key, body === undefined ? {} : { "content-type": "application/json" }),
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: ctrl.signal
    });
    const text = await r.text();
    let data = null;
    try { data = text ? JSON.parse(text) : null; } catch { data = text; }
    return { status: r.status, data };
  } finally {
    clearTimeout(timer);
  }
}

/* ---------- Why a lead was not stored, in words the owner can act on (the "NOT SAVED" notices and GET /api/lead).
   Three ways: this deployment is not connected, Supabase refused, or Supabase did not answer. ---------- */
export function notConnected(cfg) {
  if (cfg.problem === "bad-url") return "SUPABASE_URL on this deployment is not a project URL like https://abcdefghijklmnop.supabase.co";
  if (cfg.problem === "secret-key") return "SUPABASE_ANON_KEY on this deployment holds a secret key; it needs the publishable key (sb_publishable_...) or the legacy anon key";
  const missing = [!cfg.url && "SUPABASE_URL", !cfg.key && "SUPABASE_ANON_KEY"].filter(Boolean).join(" and ");
  return `this deployment cannot see ${missing}: set ${missing.includes(" and ") ? "them" : "it"} in Vercel for this deployment's environment (Production or Preview), then redeploy`;
}
export function refused(status, data, fn = "public.submit_lead()") {
  const said = data && typeof data === "object" ? [data.code, data.message].filter(Boolean).join(": ") : typeof data === "string" ? data : "";
  const hint = status === 404 ? `; the project has no ${fn}: run lead-capture/leads.sql in the project SUPABASE_URL names`
    : status === 401 || status === 403 ? "; the key was refused: SUPABASE_ANON_KEY must be the publishable (or anon) key of the project SUPABASE_URL names"
    : status >= 500 ? "; Supabase had an error, or the project is paused (restore it in Supabase)"
    : "";
  return `Supabase answered HTTP ${status}${hint}${said ? `. Supabase said: ${String(said).replace(/\s+/g, " ").slice(0, 200)}` : ""}`;
}
export function unreachable(e) {
  if (e && e.name === "AbortError") return "Supabase did not answer within 8 seconds";
  const code = e && e.cause && e.cause.code;
  if (code === "ENOTFOUND") return "the host in SUPABASE_URL does not exist: check the project URL";
  return `Supabase could not be reached (${(e && e.message) || "network error"}${code ? `, ${code}` : ""})`;
}

// Which deployment is answering: Vercel's Production or Preview (or local), its branch and short commit. Never a secret.
export function deployment() {
  const sha = env("VERCEL_GIT_COMMIT_SHA");
  return { env: env("VERCEL_ENV") || "local", branch: env("VERCEL_GIT_COMMIT_REF") || null, commit: sha ? sha.slice(0, 7) : null };
}

// Responses: plain Node http, so the same handler runs on Vercel and in the kit's local test servers
export function send(res, status, data, cache) {
  res.statusCode = status;
  res.setHeader("content-type", "application/json; charset=utf-8");
  res.setHeader("cache-control", cache || "no-store");
  res.setHeader("x-content-type-options", "nosniff");
  res.end(JSON.stringify(data));
}

// The request body as an object. Vercel parses JSON into req.body already; a plain Node server leaves the stream.
export async function readJson(req, limit = 32 * 1024) {
  if (req.body !== undefined && req.body !== null) {
    if (typeof req.body === "object" && !Buffer.isBuffer(req.body)) return req.body;
    const s = Buffer.isBuffer(req.body) ? req.body.toString("utf8") : String(req.body);
    if (s.length > limit) throw Object.assign(new Error("too large"), { status: 413 });
    return JSON.parse(s || "{}");
  }
  const chunks = [];
  let size = 0;
  for await (const c of req) {
    size += c.length;
    if (size > limit) throw Object.assign(new Error("too large"), { status: 413 });
    chunks.push(c);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
}
