#!/usr/bin/env node
/**
 * The database for real: lead-capture/leads.sql in a throwaway local Postgres, behind PostgREST (the REST layer
 * Supabase runs) and a small stand-in for Supabase's gateway, with ../../api/lead.mjs calling it as it does on Vercel.
 * Only Resend and Slack are stubbed. Checks: the SQL refuses a public.leads it did not make; it runs twice cleanly; the
 * public role can call submit_lead() and nothing else (no read, no direct write); each form shape is stored as it
 * should be; the rate limit; the health report, with and without the schema; a lead kept when the database is down.
 * Installed by the landing-page-lead-capture skill.
 *
 * Needs Postgres installed locally (initdb, pg_ctl, psql). PostgREST is found on the PATH or fetched once from its
 * GitHub releases (Linux x64) into ~/.cache/lead-capture. Without either it prints SKIPPED and exits 0: say so in
 * the handover, never count a skip as a pass.
 *
 *   node lead-capture/tests/check-db.mjs
 */
import { execFileSync, spawn } from "node:child_process";
import { createHmac } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync, chmodSync } from "node:fs";
import { createServer, request as httpRequest } from "node:http";
import { homedir, tmpdir, platform, arch } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const SQL = fileURLToPath(new URL("../leads.sql", import.meta.url));
const PGRST_VERSION = "v12.2.12";
const JWT_SECRET = "lead-capture-local-test-secret-0123456789";

let pass = 0, fail = 0;
const ok = (name, cond, info = "") => { if (cond) { pass++; console.log(`ok   ${name}`); } else { fail++; console.log(`FAIL ${name}${info ? `: ${info}` : ""}`); } };
const skip = (why) => { console.log(`SKIPPED check-db: ${why}`); process.exit(0); };
const sh = (cmd, args, opts = {}) => execFileSync(cmd, args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], ...opts });
const has = (cmd) => { try { sh("sh", ["-c", `command -v ${cmd}`]); return true; } catch { return false; } };
const freePort = () => new Promise((ok2) => { const s = createServer(); s.listen(0, "127.0.0.1", () => { const p = s.address().port; s.close(() => ok2(p)); }); });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* ---------- Postgres: find it, start a throwaway cluster ---------- */
function pgBin() {
  try { const d = sh("pg_config", ["--bindir"]).trim(); if (existsSync(join(d, "initdb"))) return d; } catch { /* look further */ }
  const roots = ["/usr/lib/postgresql", "/usr/local/opt", "/opt/homebrew/opt"];
  for (const r of roots) {
    if (!existsSync(r)) continue;
    const found = readdirSync(r).filter((v) => /^(\d+|postgresql(@\d+)?)$/.test(v)).sort((a, b) => parseFloat(b.replace(/\D+/g, "") || 0) - parseFloat(a.replace(/\D+/g, "") || 0));
    for (const v of found) { const d = join(r, v, "bin"); if (existsSync(join(d, "initdb"))) return d; }
  }
  if (has("initdb")) return sh("sh", ["-c", "dirname $(command -v initdb)"]).trim();
  return null;
}
const bin = pgBin();
if (!bin) skip("no local Postgres (install postgresql, then run this again)");
const root = typeof process.getuid === "function" && process.getuid() === 0;
// Postgres refuses to run as root: run the server as the postgres user, in a folder that user can reach
const asPg = (args) => (root ? ["runuser", ["-u", "postgres", "--", ...args]] : [args[0], args.slice(1)]);
if (root) { try { sh("id", ["postgres"]); } catch { skip("running as root and there is no postgres user to run the server"); } if (!has("runuser")) skip("running as root without runuser"); }

/* ---------- PostgREST: on the PATH, cached, or fetched once ---------- */
async function postgrest() {
  if (has("postgrest")) return "postgrest";
  const dir = join(process.env.XDG_CACHE_HOME || join(homedir(), ".cache"), "lead-capture", `postgrest-${PGRST_VERSION}`);
  const exe = join(dir, "postgrest");
  if (existsSync(exe)) return exe;
  if (platform() !== "linux" || arch() !== "x64") return null;
  mkdirSync(dir, { recursive: true });
  const url = `https://github.com/PostgREST/postgrest/releases/download/${PGRST_VERSION}/postgrest-${PGRST_VERSION}-linux-static-x86-64.tar.xz`;
  const tar = join(dir, "postgrest.tar.xz");
  console.log(`fetching PostgREST ${PGRST_VERSION} (once) from github.com/PostgREST`);
  try { sh("curl", ["-fsSL", "-o", tar, url], { timeout: 120000 }); } catch {
    try { const r = await fetch(url); if (!r.ok) return null; writeFileSync(tar, Buffer.from(await r.arrayBuffer())); } catch { return null; }
  }
  try { sh("tar", ["-xJf", tar, "-C", dir]); chmodSync(exe, 0o755); rmSync(tar, { force: true }); } catch { return null; }
  return existsSync(exe) ? exe : null;
}

const b64 = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
const jwt = (payload) => { const h = b64({ alg: "HS256", typ: "JWT" }), p = b64(payload); return `${h}.${p}.${createHmac("sha256", JWT_SECRET).update(`${h}.${p}`).digest("base64url")}`; };
const ANON = jwt({ role: "anon" }), SERVICE = jwt({ role: "service_role" }), AUTHED = jwt({ role: "authenticated", sub: "00000000-0000-4000-8000-000000000001" });

const exe = await postgrest();
if (!exe) skip("PostgREST is not installed and could not be fetched (put postgrest on the PATH, then run this again)");

const work = mkdtempSync(join(root ? "/var/tmp" : tmpdir(), "lead-capture-db-"));
const data = join(work, "pg");
const pgPort = await freePort(), restPort = await freePort();
let pgrst = null, gateway = null;
const psql = (args, input) => sh(join(bin, "psql"), ["-h", "127.0.0.1", "-p", String(pgPort), "-U", "postgres", "-d", "postgres", "-X", "-q", "-v", "ON_ERROR_STOP=1", ...args], input ? { input, stdio: ["pipe", "pipe", "pipe"] } : {});
const runSql = () => { try { psql(["-f", SQL]); return null; } catch (e) { return String(e.stderr || e.message); } };

async function cleanup() {
  try { if (pgrst) { const gone = new Promise((r) => pgrst.once("exit", r)); pgrst.kill(); await Promise.race([gone, sleep(3000)]); } } catch { /* gone */ }
  try { if (gateway) gateway.close(); } catch { /* gone */ }
  try { const [c, a] = asPg([join(bin, "pg_ctl"), "-D", data, "-m", "immediate", "stop"]); sh(c, a); } catch { /* not running */ }
  rmSync(work, { recursive: true, force: true });
}
process.on("SIGINT", async () => { await cleanup(); process.exit(130); });

try {
  if (root) sh("chown", ["-R", "postgres", work]);
  { const [c, a] = asPg([join(bin, "initdb"), "-D", data, "-A", "trust", "-U", "postgres", "-E", "UTF8", "--no-sync"]); sh(c, a); }
  { const [c, a] = asPg([join(bin, "pg_ctl"), "-D", data, "-l", join(data, "log"), "-w", "-o", `-p ${pgPort} -c listen_addresses=127.0.0.1 -c unix_socket_directories=''`, "start"]); sh(c, a); }

  // Supabase's roles: anon and authenticated (the public keys), service_role (bypasses row level security),
  // authenticator (the REST layer's login), and the default grants a Supabase project gives them
  psql(["-c", `
    create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
    create role authenticator login noinherit; grant anon, authenticated, service_role to authenticator;
    grant usage on schema public to anon, authenticated, service_role;
    alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
    alter default privileges in schema public grant all on functions to anon, authenticated, service_role;`]);

  /* ---------- The SQL file ---------- */
  psql(["-c", "create table public.leads (id serial primary key, first_name text not null); comment on table public.leads is 'an older admin panel';"]);
  let err = runSql();
  ok("leads.sql refuses a public.leads it did not create, and changes nothing", err && /was not created by lead capture/.test(err) && psql(["-tAc", "select obj_description('public.leads'::regclass)"]).trim() === "an older admin panel", err && err.split("\n")[0]);
  psql(["-c", "drop table public.leads;"]);
  err = runSql();
  ok("leads.sql runs on a fresh project", err === null, err);
  err = runSql();
  ok("leads.sql runs again cleanly (safe to re-run)", err === null, err);
  ok("row level security is on, with no policies", psql(["-tAc", "select relrowsecurity::text || '/' || (select count(*) from pg_policies where tablename = 'leads') from pg_class where oid = 'public.leads'::regclass"]).trim() === "true/0");

  /* ---------- PostgREST and a gateway like Supabase's (/rest/v1, apikey) ---------- */
  writeFileSync(join(work, "pgrst.conf"), [
    `db-uri = "postgres://authenticator@127.0.0.1:${pgPort}/postgres"`, `db-schemas = "public"`, `db-anon-role = "anon"`,
    `jwt-secret = "${JWT_SECRET}"`, `server-host = "127.0.0.1"`, `server-port = ${restPort}`
  ].join("\n"));
  pgrst = spawn(exe, [join(work, "pgrst.conf")], { stdio: "ignore" });
  // Ready means 200: before its schema cache is loaded PostgREST answers 503 (PGRST002)
  let up = 0;
  for (let i = 0; i < 100 && up !== 200; i++) { try { up = (await fetch(`http://127.0.0.1:${restPort}/`)).status; } catch { up = 0; } if (up !== 200) await sleep(200); }
  if (up !== 200) throw new Error(`PostgREST did not become ready (last answer: ${up || "none"})`);
  gateway = createServer((req, res) => {
    if (!req.url.startsWith("/rest/v1/")) { res.writeHead(404); return res.end(); }
    const headers = { ...req.headers, host: `127.0.0.1:${restPort}` };
    if (!headers.authorization && /^eyJ/.test(headers.apikey || "")) headers.authorization = `Bearer ${headers.apikey}`;
    const up = httpRequest({ host: "127.0.0.1", port: restPort, path: req.url.replace(/^\/rest\/v1/, ""), method: req.method, headers }, (r) => { res.writeHead(r.statusCode, r.headers); r.pipe(res); });
    up.on("error", () => { res.writeHead(502, { "content-type": "text/plain" }); res.end("upstream unavailable"); });
    req.pipe(up);
  });
  await new Promise((r) => gateway.listen(0, "127.0.0.1", r));
  const GW = `http://127.0.0.1:${gateway.address().port}`;
  const restAs = (key, path, init = {}) => fetch(`${GW}/rest/v1/${path}`, { ...init, headers: { apikey: key, "content-type": "application/json", ...(init.headers || {}) } });

  /* ---------- The endpoint, as on Vercel, with only Resend and Slack stubbed ---------- */
  Object.assign(process.env, {
    SUPABASE_URL: GW, SUPABASE_ANON_KEY: ANON, LEAD_HASH_SALT: "db-test-salt",
    RESEND_API_KEY: "re_db_test", LEAD_NOTIFY_FROM: "Leads <leads@example.com>", LEAD_NOTIFY_TO: "owner@example.com",
    SLACK_WEBHOOK_URL: "https://hooks.slack.com/services/T0/B0/DBTEST"
  });
  const realFetch = globalThis.fetch, sent = [];
  globalThis.fetch = async (url, init) => {
    const u = String(url);
    if (u.startsWith("https://api.resend.com/") || u.startsWith("https://hooks.slack.com/")) { sent.push({ to: u.includes("resend") ? "email" : "slack", body: JSON.parse(init.body) }); return new Response(u.includes("resend") ? '{"id":"e1"}' : "ok", { status: 200 }); }
    return realFetch(url, init);
  };
  const quiet = console.error; console.error = () => {};
  const { default: handler } = await import(new URL("../../api/lead.mjs", import.meta.url));
  const call = async (body, { method = "POST", ip = "198.51.100.7" } = {}) => {
    const res = { statusCode: 0, setHeader() {}, end(s) { this.body = s ? JSON.parse(s) : null; } };
    await handler({ method, headers: { host: "www.example.com", origin: "https://www.example.com", "x-forwarded-for": ip }, body }, res);
    return res;
  };
  const row = async (email) => (await (await restAs(SERVICE, `leads?select=*&email=eq.${encodeURIComponent(email)}&order=created_at.asc`, { headers: { authorization: `Bearer ${SERVICE}` } })).json())[0] || {};

  let r = await call(undefined, { method: "GET" });
  ok("GET /api/lead: ready, the schema found through the public role", r.body.ready === true && r.body.database.schema === "lead-capture v1", JSON.stringify(r.body.database));

  r = await call({ form: "demo", full_name: " Jo Bloggs ", work_email: " Jo@Northwind.Example ", company: "Northwind", team_size: "11-50", message: "Show me", consent: true, page: "https://www.example.com/?utm_source=li", utm_source: "li" });
  let x = await row("jo@northwind.example");
  ok("a plain form's lead is stored: 200 and one row", r.statusCode === 200 && x.id, JSON.stringify(r.body));
  ok("its columns: email lowercased, name, company, message, form", x.email === "jo@northwind.example" && x.name === "Jo Bloggs" && x.company === "Northwind" && x.message === "Show me" && x.form === "demo", JSON.stringify(x));
  ok("its other fields, consent and campaign kept as JSON; status new; a hashed IP", x.fields?.team_size === "11-50" && x.consent?.consent === true && x.meta?.utm_source === "li" && x.status === "new" && /^[0-9a-f]{64}$/.test(x.ip_hash || ""), JSON.stringify(x));
  ok("both notices went out for it", sent.filter((s) => s.to === "email").length === 1 && sent.filter((s) => s.to === "slack").length === 1);

  r = await call({ firstName: "Ana", company: "Crew Co", size: "11-50", phone: "5035550123", email: "", website: "", consentPhone: true, consentEmail: false, calculator: '{"total":1200}' }, { ip: "198.51.100.8" });
  x = (await (await restAs(SERVICE, "leads?select=*&phone=eq.5035550123", { headers: { authorization: `Bearer ${SERVICE}` } })).json())[0] || {};
  ok("a phone-only lead (the gtm-landing-page form) is stored with no email", r.statusCode === 200 && x.phone === "5035550123" && x.email === null && x.consent?.consentPhone === true && x.fields?.calculator?.total === 1200, JSON.stringify(x));

  r = await call({ firstName: "Ada", email: "ada@ordvia.example", website: "https://ordvia.example", stage: "MVP in market", tried: "Two agencies", consentEmail: true, scope: { sprints: [1, 2] } }, { ip: "198.51.100.9" });
  x = await row("ada@ordvia.example");
  ok("a calculator-style form's extra fields are kept", r.statusCode === 200 && x.fields?.stage === "MVP in market" && x.fields?.scope?.sprints?.length === 2 && x.fields?.website === "https://ordvia.example", JSON.stringify(x.fields));

  let d = await restAs(ANON, "rpc/submit_lead", { method: "POST", body: JSON.stringify({ payload: { name: "no contact" } }) });
  ok("submit_lead() itself refuses a lead with no email or phone (400)", d.status === 400 && /email or a phone/.test(await d.text()));
  d = await restAs(ANON, "rpc/submit_lead", { method: "POST", body: JSON.stringify({ payload: { email: "bad@" } }) });
  ok("submit_lead() itself refuses an invalid email (400)", d.status === 400);

  const statuses = [];
  for (let i = 0; i < 5; i++) statuses.push((await call({ name: `Repeat ${i}`, email: "repeat@example.com", consent: true }, { ip: `203.0.113.${10 + i}` })).statusCode);
  ok("the rate limit: the 6th lead from one email within an hour is refused with 429", JSON.stringify(statuses) === "[200,200,200,200,200]" && (await call({ name: "Repeat 5", email: "repeat@example.com", consent: true }, { ip: "203.0.113.99" })).statusCode === 429, JSON.stringify(statuses));

  d = await restAs(ANON, "leads?select=*");
  ok("the public key cannot read the leads", d.status === 401 || d.status === 403, String(d.status));
  d = await restAs(ANON, "leads", { method: "POST", body: JSON.stringify({ email: "direct@example.com" }) });
  ok("the public key cannot write to the table directly", d.status === 401 || d.status === 403, String(d.status));
  d = await restAs(ANON, "leads?select=*", { headers: { authorization: `Bearer ${AUTHED}` } });
  ok("a signed-in user cannot read the leads either", d.status === 401 || d.status === 403, String(d.status));

  psql(["-c", "drop function public.lead_capture_health(); notify pgrst, 'reload schema';"]);
  await sleep(1500);
  r = await call(undefined, { method: "GET" });
  ok("GET /api/lead without the schema says to run leads.sql", r.body.ready === false && /run lead-capture\/leads\.sql/.test(r.body.database.fix || ""), JSON.stringify(r.body.database));
  err = runSql();
  await sleep(1500);
  for (let i = 0; i < 20; i++) { r = await call(undefined, { method: "GET" }); if (r.body.ready) break; await sleep(250); }
  ok("running leads.sql again restores it", err === null && r.body.ready === true, err || JSON.stringify(r.body.database));

  { const gone = new Promise((r2) => pgrst.once("exit", r2)); pgrst.kill(); await Promise.race([gone, sleep(3000)]); pgrst = null; }
  await sleep(300);
  sent.length = 0;
  r = await call({ name: "Down", email: "down@example.com", consent: true }, { ip: "203.0.113.200" });
  const mail = (sent.find((s) => s.to === "email") || {}).body || {};
  ok("database down: the visitor still gets 200, and the email carries the lead marked NOT SAVED with the reason", r.statusCode === 200 && r.body.stored === false && /^\[NOT SAVED\]/.test(mail.subject || "") && /HTTP 502/.test(mail.text || ""), `${r.statusCode} ${mail.subject}`);
  console.error = quiet;
} catch (e) {
  fail++;
  console.log(`FAIL check-db crashed: ${e && (e.stderr || e.stack || e.message)}`);
} finally {
  await cleanup();
}
console.log(`check-db: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
