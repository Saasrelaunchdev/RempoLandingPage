#!/usr/bin/env node
/**
 * checkout/checkout.sql in a throwaway local Postgres: it runs twice cleanly; record_checkout() stores a session and
 * updates it in place; record_handoff() marks the handoff (and an error, then its all-clear); a second paid webhook
 * sees the handoff already done; an abandoned checkout sees that the same email paid elsewhere; the website's roles
 * (anon, authenticated) can neither read the table nor call the functions; the server's role (service_role) can.
 *
 * Needs Postgres installed locally (initdb, pg_ctl, psql). Without it, prints SKIPPED and exits 0.
 *   node checkout/tests/check-sql.mjs
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync, rmSync, chmodSync, copyFileSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const SQL = fileURLToPath(new URL("../checkout.sql", import.meta.url));
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
const dir = mkdtempSync(join(tmpdir(), "rempo-checkout-sql-"));
chmodSync(dir, 0o777);
const data = join(dir, "data");
const sqlFile = join(dir, "checkout.sql");
copyFileSync(SQL, sqlFile); chmodSync(sqlFile, 0o644);
const psql = (sql, role) => run([join(bin, "psql"), "-h", dir, "-p", String(port), "-U", "postgres", "-d", "postgres", "-v", "ON_ERROR_STOP=1", "-At", "-c", role ? `set role ${role}; ${sql}` : sql]).trim();
const psqlFile = (f) => run([join(bin, "psql"), "-h", dir, "-p", String(port), "-U", "postgres", "-d", "postgres", "-v", "ON_ERROR_STOP=1", "-q", "-f", f]);
const denied = (sql, role) => { try { psql(sql, role); return false; } catch (e) { return /permission denied/.test(String(e.stderr || e.message)); } };
const lit = (o) => `'${JSON.stringify(o).replace(/'/g, "''")}'::jsonb`;
const record = (o) => JSON.parse(psql(`select public.record_checkout(${lit(o)})`, "service_role").split("\n").pop());

try {
  run([join(bin, "initdb"), "-D", data, "-U", "postgres", "--auth=trust", "-E", "UTF8"]);
  run([join(bin, "pg_ctl"), "-D", data, "-l", join(dir, "server.log"), "-o", `-p ${port} -k ${dir} -c listen_addresses=''`, "-w", "start"]);
  // The roles a Supabase project has
  psql("create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;");
  psqlFile(sqlFile);
  let twice = true;
  try { psqlFile(sqlFile); } catch { twice = false; }
  ok("the SQL runs, and runs again cleanly", twice);
  ok("checkout_health() answers checkout v1", psql("select public.checkout_health()", "service_role").split("\n").pop() === "checkout v1");

  const paid = { stripe_session_id: "cs_test_a1", livemode: false, status: "complete", payment_status: "paid", mode: "subscription",
    stripe_customer_id: "cus_1", stripe_subscription_id: "sub_1", email: "Tom@MapleStreet.com", name: "Tom", phone: "5125550134",
    business: "Maple Street Plumbing", plan: "done-for-you", billing: "monthly", profiles: 2, bump: true, amount_total: 109100, currency: "usd",
    terms_accepted: true, consent: { email: true, texts: false, notice_version: "2026-11-08" }, visit: "v_abc123",
    lead_id: "00000000-0000-4000-8000-000000000001", metadata: { answers: { runs: "handle" } }, paid: true, expired: false };
  const first = record(paid);
  ok("a paid session is stored, first seen, not handed off yet", first.first_seen === true && first.handed_off_at === null && first.id, JSON.stringify(first));
  const row = psql("select email, profiles, amount_total, bump, paid_at is not null, lead_id from public.purchases where stripe_session_id = 'cs_test_a1'");
  ok("its fields are kept, the email lowercased", row === "tom@maplestreet.com|2|109100|t|t|00000000-0000-4000-8000-000000000001", row);

  psql("select public.record_handoff('cs_test_a1', null, 'GoHighLevel answered HTTP 503')", "service_role");
  const again = record(paid);
  ok("the same session again: updated in place, its failed handoff remembered", again.first_seen === false && again.handoff_error === "GoHighLevel answered HTTP 503" && again.handed_off_at === null, JSON.stringify(again));
  psql("select public.record_handoff('cs_test_a1', 'ghl_contact_9', null)", "service_role");
  const done = record(paid);
  ok("after the handoff: handed_off_at set, the error cleared, the contact kept", Boolean(done.handed_off_at) && done.handoff_error === null && done.ghl_contact_id === "ghl_contact_9", JSON.stringify(done));
  ok("one row for the session, two attempts counted", psql("select count(*), max(handoff_attempts) from public.purchases where stripe_session_id = 'cs_test_a1'") === "1|2");

  const abandoned = record({ stripe_session_id: "cs_test_b2", status: "expired", payment_status: "unpaid", mode: "subscription", email: "tom@maplestreet.com",
    plan: "done-for-you", billing: "annual", profiles: 1, recovery_url: "https://checkout.stripe.com/r/abc", consent: { email: true }, expired: true, lead_id: "not-a-uuid" });
  ok("an abandoned session of an email that paid elsewhere says so", abandoned.email_paid_elsewhere === true && abandoned.first_seen === true, JSON.stringify(abandoned));
  ok("an expired session keeps its recovery link and no paid time; a bad lead id is dropped",
    psql("select recovery_url, paid_at is null, expired_at is not null, lead_id is null from public.purchases where stripe_session_id = 'cs_test_b2'") === "https://checkout.stripe.com/r/abc|t|t|t");
  const stranger = record({ stripe_session_id: "cs_test_c3", status: "expired", email: "new@example.com", expired: true });
  ok("an abandoned session of a new email does not", stranger.email_paid_elsewhere === false, JSON.stringify(stranger));

  let refused = false;
  try { psql(`select public.record_checkout('{"email":"x@y.z"}'::jsonb)`, "service_role"); } catch (e) { refused = /stripe_session_id/.test(String(e.stderr || e.message)); }
  ok("a payload without stripe_session_id is refused", refused);

  ok("the website's public role cannot read the purchases", denied("select * from public.purchases", "anon"));
  ok("nor call record_checkout()", denied(`select public.record_checkout(${lit({ stripe_session_id: "cs_x" })})`, "anon"));
  ok("nor record_handoff()", denied("select public.record_handoff('cs_test_a1', 'x', null)", "anon"));
  ok("a signed-in user cannot read them either", denied("select * from public.purchases", "authenticated"));
  ok("row level security is on", psql("select relrowsecurity from pg_class where oid = 'public.purchases'::regclass") === "t");
} catch (e) {
  ok("the database checks ran", false, String(e.stderr || e.message).slice(0, 800));
} finally {
  try { run([join(bin, "pg_ctl"), "-D", data, "-m", "immediate", "stop"]); } catch { /* already down */ }
  rmSync(dir, { recursive: true, force: true });
}
console.log(`check-sql: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
