#!/usr/bin/env node
/**
 * sql/meta-leads-view.sql in a throwaway local Postgres, after the shared ../lead-capture/leads.sql: it runs twice
 * cleanly; it shows the Meta leads (and only those) flattened; the website's roles (anon, authenticated) cannot read
 * it, any more than they can read public.leads; the dashboard's roles can.
 *
 * Needs Postgres installed locally (initdb, pg_ctl, psql). Without it, prints SKIPPED and exits 0.
 *   node tests/check-sql.mjs
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync, rmSync, chmodSync, copyFileSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const LEADS = fileURLToPath(new URL("../../lead-capture/leads.sql", import.meta.url));
const VIEW = fileURLToPath(new URL("../sql/meta-leads-view.sql", import.meta.url));
let pass = 0, fail = 0;
const ok = (name, cond, info = "") => { if (cond) { pass++; console.log(`ok   ${name}`); } else { fail++; console.log(`FAIL ${name}${info ? `: ${info}` : ""}`); } };
const skip = (why) => { console.log(`SKIPPED check-sql: ${why}`); process.exit(0); };
const sh = (cmd, args) => execFileSync(cmd, args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });

const bin = (() => {
  const r = "/usr/lib/postgresql";
  if (existsSync(r)) for (const v of readdirSync(r).sort().reverse()) if (existsSync(join(r, v, "bin", "initdb"))) return join(r, v, "bin");
  try { const d = sh("pg_config", ["--bindir"]).trim(); if (existsSync(join(d, "initdb"))) return d; } catch { /* none */ }
  return null;
})();
if (!bin) skip("no local Postgres");
const root = process.getuid && process.getuid() === 0;
if (root) { try { sh("id", ["postgres"]); } catch { skip("running as root with no postgres user"); } }
const run = (args) => (root ? sh("runuser", ["-u", "postgres", "--", ...args]) : sh(args[0], args.slice(1)));

const port = await new Promise((res) => { const s = createServer(); s.listen(0, "127.0.0.1", () => { const p = s.address().port; s.close(() => res(p)); }); });
const dir = mkdtempSync(join(tmpdir(), "rempo-meta-sql-"));
chmodSync(dir, 0o777);
const data = join(dir, "data");
// Copies the postgres user can read
const leadsSql = join(dir, "leads.sql"), viewSql = join(dir, "view.sql");
copyFileSync(LEADS, leadsSql); copyFileSync(VIEW, viewSql); chmodSync(leadsSql, 0o644); chmodSync(viewSql, 0o644);
const psql = (sql, role) => run([join(bin, "psql"), "-h", dir, "-p", String(port), "-U", "postgres", "-d", "postgres", "-v", "ON_ERROR_STOP=1", "-At", "-c", role ? `set role ${role}; ${sql}` : sql]).trim();
const psqlFile = (f) => run([join(bin, "psql"), "-h", dir, "-p", String(port), "-U", "postgres", "-d", "postgres", "-v", "ON_ERROR_STOP=1", "-q", "-f", f]);
const denied = (sql, role) => { try { psql(sql, role); return false; } catch (e) { return /permission denied/.test(String(e.stderr || e.message)); } };

try {
  run([join(bin, "initdb"), "-D", data, "-U", "postgres", "--auth=trust", "-E", "UTF8"]);
  // -l: the server's output goes to a file, so it does not hold this script's pipes open
  run([join(bin, "pg_ctl"), "-D", data, "-l", join(dir, "server.log"), "-o", `-p ${port} -k ${dir} -c listen_addresses=''`, "-w", "start"]);
  // The roles a Supabase project has
  psql("create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;");
  psqlFile(leadsSql);
  psqlFile(viewSql);
  let twice = true;
  try { psqlFile(viewSql); } catch { twice = false; }
  ok("the view's SQL runs, and runs again cleanly", twice);

  // Leads arrive the way the website sends them: through submit_lead(), as the public role
  const lead = (o) => `select public.submit_lead('${JSON.stringify(o).replace(/'/g, "''")}'::jsonb)`;
  psql(lead({ form: "meta-gap-report", email: "tom@maplestreet.com", name: "Tom", company: "Maple Street Plumbing", consent: { consentEmail: true },
    fields: { trade: "plumbing", city: "Springfield", score: 79, tier: "stalled", fit: "qualified", route: "call or checkout", profiles: "1", jobs: "16to40", records: "fieldsoftware", asks: "remember", newest: "over3", replies: "rarely", compare: "unchecked", variant: "top-three", visit: "v-1" },
    meta: { utm_source: "facebook", utm_campaign: "gap", fbclid: "IwAR0abc" } }), "anon");
  psql(lead({ form: "meta-call", email: "tom@maplestreet.com", name: "Tom", phone: "5125550134", company: "Maple Street Plumbing", consent: { consentPhone: true },
    fields: { city: "Springfield", score: 79, tier: "stalled", fit: "qualified", slotDay: "2026-11-10", slotWindow: "morning", tz: "America/Chicago", variant: "top-three", visit: "v-1" }, meta: {} }), "anon");
  psql(lead({ form: "book-call", email: "ann@example.com", name: "Ann", phone: "5125550199", fields: { trade: "hvac" } }), "anon");

  const rows = psql("select form, first_name, business, city, score, tier, fit, variant, utm_campaign, from_meta_click, call_day, call_window from rempo_reports.meta_leads order by form");
  const lines = rows.split("\n");
  ok("the view shows the two Meta leads, and not the master page's lead", lines.length === 2 && !rows.includes("Ann"), rows);
  ok("the Gap Check row is flattened", lines.some((l) => l === "meta-gap-report|Tom|Maple Street Plumbing|Springfield|79|stalled|qualified|top-three|gap|t||"), rows);
  ok("the call row has its day and window", lines.some((l) => l.startsWith("meta-call|Tom|") && l.endsWith("|2026-11-10|morning")), rows);
  ok("the website's public role cannot read the view", denied("select * from rempo_reports.meta_leads", "anon"));
  ok("a signed-in user cannot read it either", denied("select * from rempo_reports.meta_leads", "authenticated"));
  ok("nor the table under it (unchanged)", denied("select * from public.leads", "anon"));
  let svc = "";
  try { svc = psql("select count(*) from rempo_reports.meta_leads", "service_role"); } catch (e) { svc = String(e.stderr || e.message).trim(); }
  ok("the dashboard's service role can read it", svc.split("\n").pop() === "2", svc);
  ok("the view runs with the reader's rights", psql("select reloptions::text from pg_class where oid = 'rempo_reports.meta_leads'::regclass").includes("security_invoker=true"));
} catch (e) {
  ok("the database checks ran", false, String(e.stderr || e.message).slice(0, 600));
} finally {
  try { run([join(bin, "pg_ctl"), "-D", data, "-m", "immediate", "stop"]); } catch { /* already down */ }
  rmSync(dir, { recursive: true, force: true });
}
console.log(`check-sql: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
