// Where races, queued emails and opt-outs are kept: Supabase (sql/race.sql), through its REST API with a secret key
// that only the server holds. RACE_STORE=memory (or RACE_FAKE=1 with no Supabase set) keeps everything in this
// process instead, for local work and tests; it forgets on restart and is not shared between server instances.
//
// The lead itself also goes to the landing page's own table through public.submit_lead() when that exists in the same
// Supabase project (lead-capture/leads.sql), so every lead is in one place.
import { fetchJson } from "./http.mjs";

/* ---------- Supabase ---------- */
function supa(cfg) {
  const base = `${cfg.url}/rest/v1`;
  // A new secret key (sb_secret_...) goes in apikey only; a legacy service_role JWT goes in both headers
  const headers = (extra = {}) => ({ apikey: cfg.key, ...(cfg.key.startsWith("eyJ") ? { authorization: `Bearer ${cfg.key}` } : {}), ...extra });
  const call = async (path, opts = {}) => {
    const r = await fetchJson(`${base}/${path}`, { ...opts, headers: headers(opts.headers), timeoutMs: opts.timeoutMs || 10000 });
    if (r.status >= 400) {
      const m = r.data && typeof r.data === "object" ? [r.data.code, r.data.message].filter(Boolean).join(": ") : String(r.data || "").slice(0, 200);
      throw Object.assign(new Error(`Supabase answered HTTP ${r.status}${m ? `: ${m}` : ""}`), { status: r.status === 404 ? 503 : 502, code: "database", supabaseStatus: r.status });
    }
    return r;
  };
  const enc = encodeURIComponent;
  const count = async (path) => {
    const r = await call(`${path}${path.includes("?") ? "&" : "?"}select=id`, { headers: { prefer: "count=exact", range: "0-0" } });
    const m = String(r.headers.get("content-range") || "").match(/\/(\d+)$/);
    return m ? Number(m[1]) : Array.isArray(r.data) ? r.data.length : 0;
  };
  return {
    kind: "supabase",
    async health() {
      const r = await call("rpc/race_health", { method: "POST", body: {} });
      return r.data;
    },
    async createRun(row) {
      const r = await call("race_runs", { method: "POST", body: row, headers: { prefer: "return=representation" } });
      return Array.isArray(r.data) ? r.data[0] : r.data;
    },
    async getRun(token) {
      const r = await call(`race_runs?token=eq.${enc(token)}&select=*&limit=1`);
      return Array.isArray(r.data) ? r.data[0] || null : null;
    },
    async getRunById(id) {
      const r = await call(`race_runs?id=eq.${enc(id)}&select=*&limit=1`);
      return Array.isArray(r.data) ? r.data[0] || null : null;
    },
    // Patches the run; with `when`, only if those columns are still null (a claim). Returns the row, or null if the
    // claim was already taken.
    async updateRun(token, patch, { whenNull = [] } = {}) {
      const filters = whenNull.map((c) => `&${c}=is.null`).join("");
      const r = await call(`race_runs?token=eq.${enc(token)}${filters}`, { method: "PATCH", body: { ...patch, updated_at: new Date().toISOString() }, headers: { prefer: "return=representation" } });
      return Array.isArray(r.data) ? r.data[0] || null : null;
    },
    async recentReady(placeId, sinceIso) {
      const r = await call(`race_runs?place_id=eq.${enc(placeId)}&status=eq.ready&created_at=gt.${enc(sinceIso)}&order=created_at.desc&limit=1&select=*`);
      return Array.isArray(r.data) ? r.data[0] || null : null;
    },
    countByIp: (ipHash, sinceIso) => count(`race_runs?ip_hash=eq.${enc(ipHash)}&created_at=gt.${enc(sinceIso)}`),
    countSince: (sinceIso) => count(`race_runs?created_at=gt.${enc(sinceIso)}&source_run=is.null`),
    async submitLead(payload) {
      try {
        const r = await call("rpc/submit_lead", { method: "POST", body: { payload } });
        return typeof r.data === "string" ? r.data : null;
      } catch (e) {
        if (e.supabaseStatus === 404) return null; // the landing page's leads table is not in this project
        throw e;
      }
    },
    async queueEmails(rows) {
      if (!rows.length) return [];
      const r = await call("race_emails", { method: "POST", body: rows, headers: { prefer: "return=representation" } });
      return r.data || [];
    },
    async dueEmails(nowIso, limit = 40) {
      const r = await call(`race_emails?status=eq.queued&send_at=lte.${enc(nowIso)}&order=send_at.asc&limit=${limit}&select=*`);
      return r.data || [];
    },
    async updateEmail(id, patch) {
      await call(`race_emails?id=eq.${enc(id)}`, { method: "PATCH", body: patch });
    },
    async skipEmailsFor(raceId) {
      await call(`race_emails?race_id=eq.${enc(raceId)}&status=eq.queued`, { method: "PATCH", body: { status: "skipped", error: "stopped" } });
    },
    async unsubscribe(email, source) {
      await call("race_unsubscribes?on_conflict=email", { method: "POST", body: { email, source }, headers: { prefer: "resolution=ignore-duplicates" } });
      await call(`race_emails?email=eq.${enc(email)}&status=eq.queued`, { method: "PATCH", body: { status: "skipped", error: "unsubscribed" } });
    },
    async isUnsubscribed(email) {
      const r = await call(`race_unsubscribes?email=eq.${enc(email)}&select=email&limit=1`);
      return Array.isArray(r.data) && r.data.length > 0;
    },
    // Housekeeping: the owner's recent reviews (read for Claude) go after a day at most; the three reviews kept beside
    // the drafts go after 30 days; races nobody unlocked go after 30 days
    async purge({ picksBefore, recentBefore }) {
      await call(`race_runs?created_at=lt.${enc(recentBefore)}&recent=not.is.null`, { method: "PATCH", body: { recent: null } });
      await call(`race_runs?created_at=lt.${enc(picksBefore)}&picks=not.is.null`, { method: "PATCH", body: { picks: null } });
      await call(`race_runs?created_at=lt.${enc(picksBefore)}&email=is.null`, { method: "DELETE" });
    }
  };
}

/* ---------- Memory (local work and tests) ---------- */
const mem = globalThis.__reviewRaceMemory || (globalThis.__reviewRaceMemory = { runs: [], emails: [], unsubscribes: new Set(), leads: [] });
let seq = 0;
const id = () => `00000000-0000-4000-8000-${String(++seq).padStart(12, "0")}`;

function memory() {
  const clone = (v) => (v ? structuredClone(v) : v);
  return {
    kind: "memory",
    _state: mem,
    async health() { return "review-race v1 (memory)"; },
    async createRun(row) { const r = { id: id(), created_at: new Date().toISOString(), updated_at: new Date().toISOString(), ...clone(row) }; mem.runs.push(r); return clone(r); },
    async getRun(token) { return clone(mem.runs.find((r) => r.token === token) || null); },
    async getRunById(rid) { return clone(mem.runs.find((r) => r.id === rid) || null); },
    async updateRun(token, patch, { whenNull = [] } = {}) {
      const r = mem.runs.find((x) => x.token === token);
      if (!r) return null;
      if (whenNull.some((c) => r[c] !== null && r[c] !== undefined)) return null;
      Object.assign(r, clone(patch), { updated_at: new Date().toISOString() });
      return clone(r);
    },
    async recentReady(placeId, sinceIso) { return clone([...mem.runs].reverse().find((r) => r.place_id === placeId && r.status === "ready" && r.created_at > sinceIso) || null); },
    async countByIp(h, sinceIso) { return mem.runs.filter((r) => r.ip_hash === h && r.created_at > sinceIso).length; },
    async countSince(sinceIso) { return mem.runs.filter((r) => r.created_at > sinceIso && !r.source_run).length; },
    async submitLead(payload) { const lid = id(); mem.leads.push({ id: lid, ...clone(payload) }); return lid; },
    async queueEmails(rows) { const out = rows.map((r) => ({ id: id(), created_at: new Date().toISOString(), status: "queued", ...clone(r) })); mem.emails.push(...out); return clone(out); },
    async dueEmails(nowIso, limit = 40) { return clone(mem.emails.filter((e) => e.status === "queued" && e.send_at <= nowIso).sort((a, b) => a.send_at.localeCompare(b.send_at)).slice(0, limit)); },
    async updateEmail(eid, patch) { const e = mem.emails.find((x) => x.id === eid); if (e) Object.assign(e, clone(patch)); },
    async skipEmailsFor(raceId) { mem.emails.filter((e) => e.race_id === raceId && e.status === "queued").forEach((e) => { e.status = "skipped"; e.error = "stopped"; }); },
    async unsubscribe(email) { mem.unsubscribes.add(email); mem.emails.filter((e) => e.email === email && e.status === "queued").forEach((e) => { e.status = "skipped"; e.error = "unsubscribed"; }); },
    async isUnsubscribed(email) { return mem.unsubscribes.has(email); },
    async purge({ picksBefore, recentBefore }) {
      mem.runs.forEach((r) => { if (r.created_at < recentBefore) r.recent = null; if (r.created_at < picksBefore) r.picks = null; });
      mem.runs = mem.runs.filter((r) => r.created_at >= picksBefore || r.email);
    }
  };
}

export function openStore(c) {
  if (c.store === "memory") return memory();
  if (!c.supabase.url || !c.supabase.key) throw Object.assign(new Error("The database is not set up: set SUPABASE_URL and SUPABASE_SECRET_KEY."), { status: 503, code: "not-configured" });
  return supa(c.supabase);
}

/* ---------- The by-hand path's store: the full store when it is set up; otherwise only the lead, through the
   landing page's publishable key (SUPABASE_ANON_KEY) and public.submit_lead(), so a request is never lost while the
   race's own secret key is missing. That key is the public role's: it can call submit_lead() and nothing else. ---------- */
export function openLeadStore(c) {
  if (c.store === "memory" || (c.supabase.url && c.supabase.key)) return openStore(c);
  const key = c.supabase.anonKey;
  if (!c.supabase.url || !key || /^sb_secret_/i.test(key)) throw Object.assign(new Error("The database is not set up: set SUPABASE_URL and SUPABASE_ANON_KEY (or SUPABASE_SECRET_KEY)."), { status: 503, code: "not-configured" });
  // A new publishable key goes in apikey only; a legacy anon key is a JWT and also goes in Authorization
  const headers = { apikey: key, ...(key.startsWith("eyJ") ? { authorization: `Bearer ${key}` } : {}) };
  return {
    kind: "leads",
    async submitLead(payload) {
      const r = await fetchJson(`${c.supabase.url}/rest/v1/rpc/submit_lead`, { method: "POST", body: { payload }, headers, timeoutMs: 10000 });
      if (r.status >= 400) throw Object.assign(new Error(`Supabase answered HTTP ${r.status}`), { status: 502, code: "database", supabaseStatus: r.status });
      return typeof r.data === "string" ? r.data : null;
    },
    async isUnsubscribed() { return false; }
  };
}

export function resetMemory() { mem.runs = []; mem.emails = []; mem.unsubscribes = new Set(); mem.leads = []; }
