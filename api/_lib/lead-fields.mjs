// Shared by api/lead.mjs. Installed by the landing-page-lead-capture skill.
//
// Any form's JSON, as one lead. The contact fields go to their own columns whatever the form calls them
// (work_email, firstName + lastName, phone_number, organization...), consent boxes are kept one by one, campaign and
// page details go to meta, and every other field is kept as it was sent, in fields. So a new form, or a new field in
// a form, needs no change here or in the database.

const norm = (k) => String(k).toLowerCase().replace(/[^a-z0-9]/g, "");
const ROLE = {
  email: ["email", "workemail", "emailaddress", "businessemail", "youremail", "mail", "contactemail"],
  name: ["name", "fullname", "yourname", "contactname"],
  first: ["firstname", "first", "givenname", "fname"],
  last: ["lastname", "last", "surname", "familyname", "lname"],
  phone: ["phone", "phonenumber", "mobile", "mobilephone", "mobilenumber", "tel", "telephone", "cell", "whatsapp", "contactnumber"],
  company: ["company", "companyname", "organization", "organisation", "business", "businessname", "org"],
  message: ["message", "comments", "comment", "notes", "details", "question", "enquiry", "inquiry", "howcanwehelp", "body"]
};
const ROLE_OF = Object.fromEntries(Object.entries(ROLE).flatMap(([role, keys]) => keys.map((k) => [k, role])));
// Campaign parameters and where the visitor was: meta, not fields
const META = new Set(["page", "pageurl", "referrer", "referer", "src", "p", "e", "utmsource", "utmmedium", "utmcampaign", "utmcontent", "utmterm", "gclid", "fbclid", "lifatid", "msclkid"]);
// Never stored: the form's name (it has its own column) and the fields only a bot fills (checked before this runs)
export const HONEYPOT = ["hp", "_hp", "honeypot", "_gotcha", "botfield", "bot_field"];
const SKIP = new Set(["form", "formname", ...HONEYPOT.map(norm)]);

const LIMIT = { email: 254, name: 200, phone: 40, company: 200, message: 5000 };
const text = (v, max) => (typeof v === "string" ? v.trim().slice(0, max) : typeof v === "number" ? String(v) : "");

// A value as it should be kept: trimmed text, true/false for a ticked box, a list, or a small object. A string that
// holds a JSON object (a calculator's numbers in a hidden field) becomes that object.
function keep(v) {
  if (typeof v === "boolean" || (typeof v === "number" && Number.isFinite(v))) return v;
  if (typeof v === "string") {
    const s = v.trim();
    if (!s) return undefined;
    if (/^\{[\s\S]*\}$/.test(s) && s.length <= 4000) { try { const o = JSON.parse(s); if (o && typeof o === "object") return o; } catch { /* kept as text */ } }
    return s.slice(0, 2000);
  }
  if (Array.isArray(v)) { const a = v.map(keep).filter((x) => x !== undefined && typeof x !== "object").slice(0, 50); return a.length ? a : undefined; }
  if (v && typeof v === "object") { try { return JSON.stringify(v).length <= 4000 ? v : undefined; } catch { return undefined; } }
  return undefined;
}
const ticked = (v) => v === true || (typeof v === "string" && /^(on|true|yes|1|y)$/i.test(v.trim()));

export function normalize(body) {
  const lead = { form: text(body.form || body.formName, 80) || "default", email: "", name: "", phone: "", company: "", message: "", consent: {}, fields: {}, meta: {} };
  let first = "", last = "";
  for (const [k, v] of Object.entries(body)) {
    const n = norm(k);
    if (SKIP.has(n)) continue;
    if (n.startsWith("consent") || n === "optin" || n === "gdpr" || n === "agree" || n === "acceptterms") { lead.consent[k] = ticked(v); continue; }
    if (META.has(n)) { const s = text(v, 2000); if (s) lead.meta[k] = s; continue; }
    const role = ROLE_OF[n] || (n.includes("email") && !lead.email && typeof v === "string" ? "email" : null);
    if (role === "first" && !first) { first = text(v, 100); continue; }
    if (role === "last" && !last) { last = text(v, 100); continue; }
    if (role && role !== "first" && role !== "last" && !lead[role]) { lead[role] = text(v, LIMIT[role]); if (lead[role]) continue; }
    const kept = keep(v);
    if (kept !== undefined) lead.fields[k] = kept;
  }
  if (!lead.name) lead.name = [first, last].filter(Boolean).join(" ").slice(0, LIMIT.name);
  else if (first) lead.fields.firstName = first;
  lead.email = lead.email.toLowerCase();
  return lead;
}

export const EMAIL = /^[^\s@<>,]+@[^\s@<>,]+\.[^\s@<>,]+$/;
export const phoneDigits = (p) => (String(p || "").match(/\d/g) || []).length;
