// /start: three questions, the plan they point to with its price from Stripe, the buyer's details, then Stripe's checkout.
// The routing and the renewal words are shared with the server (/assets/checkout-shared.mjs), so the page and
// /api/checkout always agree. What the page sends: see readInput() in api/checkout.mjs.
import { routeFor, priceSummary, renewalText, formatMoney } from "/assets/checkout-shared.mjs";

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
const params = new URLSearchParams(location.search);
const NOTICE_VERSION = "2026-11-08";   // the consent and policy wording on this page (legal-src/settings.mjs, noticeVersion)
const UTM = ["utm_source", "utm_medium", "utm_campaign", "utm_content", "utm_term", "fbclid", "gclid"];
const bornAt = Date.now();
const store = { get(k) { try { return JSON.parse(sessionStorage.getItem(k) || "null"); } catch { return null; } },
  set(k, v) { try { sessionStorage.setItem(k, JSON.stringify(v)); } catch { /* storage blocked: kept for this page only */ } } };

// The visit: the landing page's id (it adds client_reference_id to its Get started links), so a purchase can be matched
// to the visit's leads; the campaign tags kept for the whole visit, even back from a cancelled checkout
const visit = (() => {
  const make = () => "v_" + Array.from(crypto.getRandomValues(new Uint8Array(10)), (b) => b.toString(16).padStart(2, "0")).join("");
  const fromLink = params.get("client_reference_id");
  let v = fromLink && /^[A-Za-z0-9_-]{6,64}$/.test(fromLink) ? fromLink : null;
  try { v = v || sessionStorage.getItem("lp-visit") || make(); sessionStorage.setItem("lp-visit", v); } catch { v = v || make(); }
  return v;
})();
const utm = { ...(store.get("st-utm") || {}) };
for (const k of UTM) { const v = params.get(k); if (v) utm[k] = v.slice(0, 200); }
store.set("st-utm", utm);

const form = $("#st-form");
const WHY = {
  profiles: "With 3 or more Google profiles, we quote per location. A 15-minute call is the quickest way.",
  "software-check": "Let's check your job software first. On a 15-minute call we confirm the connection before any monthly charge.",
  "plan-not-offered": "That plan isn't available online yet. Book a 15-minute call and we'll set you up."
};
let catalog = null, current = null;

const picked = (name) => { const r = $(`input[name="${name}"]:checked`, form); return r ? r.value : ""; };
const answers = () => ({ profiles: picked("profiles"), software: picked("software"), runs: picked("runs") });
const show = (el, on) => { if (el) el.hidden = !on; };

function setErr(id, msg) {
  const e = $(`#e-${id}`);
  if (e) e.textContent = msg || "";
  const box = e && e.closest(".field, .opts");
  if (box) box.setAttribute("aria-invalid", msg ? "true" : "false");
}

function row(label, value, total) {
  const d = document.createElement("div");
  if (total) d.className = "st-total";
  const dt = document.createElement("dt"), dd = document.createElement("dd");
  dt.textContent = label; dd.textContent = value;
  d.append(dt, dd);
  return d;
}

// The plan card: price per profile, the setup fee, what is paid today, the renewal terms, the guarantee once there is one
function renderPlan() {
  const plan = catalog.plans[current.plan];
  const a = answers();
  const profiles = plan.mode === "payment" ? 1 : Number(a.profiles) || 1;
  $("#st-plan-name").textContent = plan.label;
  $("#st-plan-blurb").textContent = plan.blurb || "";
  const list = $("#st-includes");
  list.replaceChildren(...(plan.includes || []).map((text) => {
    const li = document.createElement("li");
    li.innerHTML = '<svg class="ic" aria-hidden="true"><use href="#i-check"/></svg>';
    li.append(text);
    return li;
  }));
  show(list, Boolean(plan.includes && plan.includes.length));
  const both = plan.mode === "subscription" && plan.monthly && plan.annual;
  show($("#g-billing"), both);
  if (both) {
    const opts = catalog.settings;
    $("#opt-monthly").textContent = `Monthly, ${formatMoney(plan.monthly.amount, plan.currency)} a month`;
    $("#opt-annual").textContent = `Yearly, ${formatMoney(plan.annual.amount, plan.currency)} a year${plan.setup && opts.setupWaivedOnAnnual ? ", no setup fee" : ""}`;
  }
  const billing = plan.mode === "payment" ? "once" : both ? picked("billing") || "monthly" : plan.monthly ? "monthly" : "annual";
  const s = priceSummary(plan, billing, profiles, catalog.settings);
  const sum = $("#st-sum");
  sum.replaceChildren();
  if (s.renews === null) {
    sum.append(row("One payment", formatMoney(s.today, plan.currency)));
  } else {
    const each = `${formatMoney(s.recurring, plan.currency)} a ${s.per}`;
    sum.append(row(s.profiles > 1 ? `${s.profiles} Google profiles at ${each} each` : `1 Google profile at ${each}`, formatMoney(s.renews, plan.currency)));
    if (s.setup) sum.append(row("Setup, once", formatMoney(s.setup, plan.currency)));
  }
  sum.append(row("Today", formatMoney(s.today, plan.currency), true));
  const bump = $("#st-bump");
  show(bump, Boolean(plan.bump));
  if (plan.bump) bump.textContent = `At checkout you can add ${plan.bump.name || "an add-on"} for ${formatMoney(plan.bump.amount, plan.currency)}.`;
  const g = catalog.settings.guarantee;
  show($("#st-guarantee"), Boolean(g));
  if (g) $("#st-guarantee span").textContent = g;
  $("#st-terms").textContent = renewalText(plan, billing, profiles, { ...catalog.settings, guarantee: null });
}

function route() {
  const r = routeFor(answers(), (id) => Boolean(catalog.plans[id]));
  current = r;
  show($("#st-call"), r.to === "call");
  if (r.to === "call") $("#st-call-why").textContent = WHY[r.why] || WHY["plan-not-offered"];
  show($("#st-plan"), r.to === "plan");
  show($("#st-you"), r.to === "plan");
  if (r.to === "plan") renderPlan();
  setErr("answers", "");
  saveForm();
}

/* ---------- The answers and details last for the visit, so a buyer back from Stripe's Back link finds them again ---------- */
const FIELDS = ["firstName", "business", "email", "phone"];
function saveForm() {
  const s = { ...answers(), billing: picked("billing") };
  for (const f of FIELDS) s[f] = form.elements[f].value;
  s.consentEmail = $("#f-cemail").checked; s.consentPhone = $("#f-cphone").checked;
  store.set("st-form", s);
}
function restoreForm() {
  const s = store.get("st-form");
  if (!s) return;
  for (const name of ["profiles", "software", "runs", "billing"]) {
    const r = s[name] && $(`input[name="${name}"][value="${CSS.escape(s[name])}"]`, form);
    if (r) r.checked = true;
  }
  for (const f of FIELDS) if (typeof s[f] === "string") form.elements[f].value = s[f];
  $("#f-cemail").checked = Boolean(s.consentEmail); $("#f-cphone").checked = Boolean(s.consentPhone);
}

function check() {
  const v = (id) => $(id).value.trim();
  const digits = v("#f-phone").replace(/\D/g, "");
  const errs = {
    firstName: v("#f-name") ? "" : "Please enter your first name.",
    business: v("#f-business") ? "" : "Please enter your business name.",
    email: /^[^\s@<>,]+@[^\s@<>,]+\.[^\s@<>,]+$/.test(v("#f-email")) ? "" : "Please enter a valid email.",
    phone: digits.length === 10 || (digits.length === 11 && digits[0] === "1") ? "" : "Please enter a 10-digit phone number."
  };
  for (const [k, m] of Object.entries(errs)) setErr(k, m);
  const bad = Object.entries(errs).find(([, m]) => m);
  if (bad) { const box = $(`#e-${bad[0]}`).closest(".field"); const input = box && $("input", box); if (input) input.focus(); }
  return !bad;
}

async function send(e) {
  e.preventDefault();
  if ($("#f-web").value) return;                         // a bot: the trap is filled
  if (Date.now() - bornAt < 2000) return;               // sent faster than a person reads the page: a bot
  if (!current || current.to !== "plan") { setErr("answers", "Please answer the three questions."); return; }
  if (!check()) return;
  const btn = $("#st-pay");
  btn.setAttribute("aria-busy", "true");
  btn.disabled = true;
  $("#e-send").textContent = "";
  const body = { answers: answers(), billing: picked("billing") || "monthly", firstName: $("#f-name").value, business: $("#f-business").value,
    email: $("#f-email").value, phone: $("#f-phone").value, consentEmail: $("#f-cemail").checked, consentPhone: $("#f-cphone").checked,
    website: $("#f-web").value, visit, utm, noticeVersion: NOTICE_VERSION, page: document.referrer ? document.referrer.slice(0, 300) : "" };
  try {
    const r = await fetch("/api/checkout", { method: "POST", headers: { "content-type": "application/json", accept: "application/json" }, body: JSON.stringify(body) });
    const data = await r.json().catch(() => ({}));
    if (r.ok && data.url) { saveForm(); location.assign(data.url); return; }
    if (data.fields) for (const [k, m] of Object.entries(data.fields)) setErr(k, m);
    if (data.route === "call") {
      show($("#st-call"), true); show($("#st-plan"), false); show($("#st-you"), false);
      $("#st-call-why").textContent = data.error || WHY["plan-not-offered"];
      $("#st-call").scrollIntoView({ behavior: "smooth", block: "center" });
    } else {
      $("#e-send").textContent = data.error || "Something went wrong. Please try again in a minute.";
    }
  } catch {
    $("#e-send").textContent = "We couldn't reach the checkout. Check your connection and try again.";
  }
  btn.removeAttribute("aria-busy");
  btn.disabled = false;
}

async function start() {
  if (params.get("canceled")) show($("#st-canceled"), true);
  try {
    const r = await fetch("/api/checkout", { headers: { accept: "application/json" } });
    catalog = await r.json();
  } catch {
    catalog = null;
  }
  show($("#st-loading"), false);
  if (!catalog || !catalog.open || !catalog.plans || !Object.keys(catalog.plans).length) { show($("#st-closed"), true); return; }
  restoreForm();
  show(form, true);
  form.addEventListener("change", (e) => { if (e.target.name === "billing" && current && current.to === "plan") { renderPlan(); saveForm(); } else route(); });
  form.addEventListener("input", (e) => { if (FIELDS.includes(e.target.name)) { setErr(e.target.name, ""); saveForm(); } });
  form.addEventListener("submit", send);
  route();
}

start();
