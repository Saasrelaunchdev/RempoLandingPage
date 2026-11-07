/* Rempo for Meta ads. Built by tools/build.mjs from lib/gapcheck.mjs and src/js/app.js. */
(function () {
// The Gap Check's logic: which answers are valid, the score, the tier, the three biggest gaps, the fit Meta is told
// about, the routing, and the call days. Pure functions over content/survey.mjs, no imports and no state.
//
// One file for both sides: the server imports it (api/lead.mjs scores again, so nothing stored or sent to Meta trusts
// the browser), and the build inlines it into the page's script (tools/build.mjs drops the `export` keywords), so the
// score on screen and the score stored can never disagree. Keep it to `export function` declarations.

/** The step with this key, or undefined. */
function stepOf(survey, key) {
  return survey.steps.find((s) => s.key === key);
}

/** Every multiple-choice question: the choice steps, and the choice inside a fields step (Google profiles). */
function choiceQuestions(survey) {
  const out = [];
  for (const s of survey.steps) {
    if (s.type === "choice") out.push({ key: s.key, options: s.options, step: s });
    else if (s.choice) out.push({ key: s.choice.key, options: s.choice.options, step: s });
  }
  return out;
}

/** The option with value v for question key, or null. */
function optionOf(survey, key, v) {
  const q = choiceQuestions(survey).find((c) => c.key === key);
  return (q && q.options.find((o) => o.v === v)) || null;
}

/** Keeps only answers that are one of the question's own options; lists the questions left unanswered. */
function cleanAnswers(survey, raw) {
  const answers = {};
  const missing = [];
  for (const c of choiceQuestions(survey)) {
    const v = raw && typeof raw[c.key] === "string" ? raw[c.key] : "";
    if (c.options.some((o) => o.v === v)) answers[c.key] = v;
    else missing.push(c.key);
  }
  return { answers, missing };
}

/** The score out of 100: the points of the scored answers. Higher means a bigger gap (the GTM scorecard's rule). */
function scoreOf(survey, answers) {
  let total = 0;
  for (const s of survey.steps) {
    if (!s.scored) continue;
    const o = optionOf(survey, s.key, answers[s.key]);
    if (o && typeof o.points === "number") total += o.points;
  }
  return Math.max(0, Math.min(100, total));
}

/** The tier for a score. */
function tierOf(survey, score) {
  return survey.tiers.find((t) => score >= t.min && score <= t.max) || survey.tiers[survey.tiers.length - 1];
}

/** The tier's message, with the week's jobs filled in where the message uses them. */
function tierMessage(survey, tier, answers) {
  const jobs = optionOf(survey, "jobs", answers.jobs);
  if (tier.msg.includes("{jobs}")) {
    if (jobs && jobs.words) return tier.msg.replace("{jobs}", jobs.words);
    return tier.msgNoJobs || tier.msg.replace("At {jobs} jobs a week, t", "T");
  }
  return tier.msg;
}

/** The n biggest gaps: scored answers worth points, most points first, ties in question order. */
function gapsOf(survey, answers, n = 3) {
  const list = [];
  survey.steps.forEach((s, i) => {
    if (!s.scored) return;
    const o = optionOf(survey, s.key, answers[s.key]);
    const words = survey.gaps[s.key] && survey.gaps[s.key][answers[s.key]];
    if (o && o.points > 0 && words) list.push({ key: s.key, v: o.v, points: o.points, order: i, title: words[0], line: words[1] });
  });
  list.sort((a, b) => b.points - a.points || a.order - b.order);
  return list.slice(0, n).map(({ order, ...g }) => g);
}

/** What Meta is told about this visitor: "qualified", or the first fit rule the answers meet. */
function fitOf(survey, answers) {
  for (const rule of survey.fit) {
    const hit = Object.entries(rule.when).some(([key, values]) => values.includes(answers[key]));
    if (hit) return rule.key;
  }
  return survey.qualifiedFit;
}

/** Routing: a call with no checkout link for no software or 3 or more profiles (the GTM's overrides). */
function routeOf(survey, answers) {
  for (const [key, values] of Object.entries(survey.callOnly)) {
    if (values.includes(answers[key])) return { callOnly: true, why: key };
  }
  return { callOnly: false, why: null };
}

/** Everything the result needs, from raw answers. ok is false when a question is unanswered. */
function evaluate(survey, raw) {
  const { answers, missing } = cleanAnswers(survey, raw);
  const score = scoreOf(survey, answers);
  const tier = tierOf(survey, score);
  const fit = fitOf(survey, answers);
  const route = routeOf(survey, answers);
  const trade = optionOf(survey, "trade", answers.trade);
  return {
    ok: missing.length === 0,
    missing,
    answers,
    score,
    tier: tier.key,
    tierName: tier.name,
    tierMsg: tierMessage(survey, tier, answers),
    fit,
    qualified: fit === survey.qualifiedFit,
    callOnly: route.callOnly,
    why: route.why,
    gaps: gapsOf(survey, answers, 3),
    service: trade ? trade.service : "home services"
  };
}

/** Fills {name} placeholders from vars; unknown names are left as they are. */
function fill(template, vars) {
  return String(template).replace(/\{(\w+)\}/g, (m, k) => (vars && vars[k] !== undefined && vars[k] !== null ? String(vars[k]) : m));
}

/** "2026-11-10" for a date, in its own (local) calendar. */
function isoDay(d) {
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/** The call days on offer: the next `days` weekdays, starting tomorrow (the course: never the same day, no weekends,
 *  about five days out). Labels like "Tue, Nov 10". */
function bookingDays(survey, now) {
  const out = [];
  const d = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const DOW = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  while (out.length < survey.booking.days) {
    d.setDate(d.getDate() + 1);
    const w = d.getDay();
    if (w === 0 || w === 6) continue;
    out.push({ v: isoDay(d), label: `${DOW[w]}, ${MON[d.getMonth()]} ${d.getDate()}`, long: `${DOW[w]} ${MON[d.getMonth()]} ${d.getDate()}` });
  }
  return out;
}

/** The label for a stored day ("2026-11-10" to "Tue, Nov 10"), or the value itself if it is not a date. */
function dayLabel(v) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(v || ""));
  if (!m) return String(v || "");
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  const DOW = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  return `${DOW[d.getDay()]}, ${MON[d.getMonth()]} ${d.getDate()}`;
}

/** True when day is a weekday from tomorrow to `maxAhead` days out, as seen from `now` (the server allows a day either
 *  side for time zones). */
function dayAllowed(day, now, maxAhead) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(day || ""));
  if (!m) return false;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  if (isoDay(d) !== day) return false;
  const w = d.getDay();
  if (w === 0 || w === 6) return false;
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const diff = Math.round((d - today) / 86400000);
  return diff >= 0 && diff <= maxAhead;
}

/** The booking window with value v, or null. */
function windowOf(survey, v) {
  return survey.booking.windows.find((w) => w.v === v) || null;
}

/** US phone digits: 10 digits, or 11 starting with 1. Returns the 10 digits, or "" when it is not a US number. */
function usPhone(p) {
  const d = String(p || "").replace(/\D/g, "");
  if (d.length === 11 && d[0] === "1") return d.slice(1);
  return d.length === 10 ? d : "";
}

/* Rempo for Meta ads: the page's script. tools/build.mjs wraps it in one function together with lib/gapcheck.mjs
   (evaluate, bookingDays, dayLabel, windowOf, usPhone, fill), so the score on screen is the server's score.
   It runs the Gap Check one question at a time (a tap answers and moves on; contact details last), shows the score,
   offers the call as the last step, and tells Meta about a Lead or a Schedule only when the answers qualify. */

"use strict";
const DATA = JSON.parse(document.getElementById("rm-data").textContent);
const SITE = DATA.site, SURVEY = DATA.survey, UI = DATA.ui, VARIANT = DATA.variant;
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => Array.from(el.querySelectorAll(s));
const html = document.documentElement;
const REDUCE = matchMedia("(prefers-reduced-motion: reduce)").matches;
if (!REDUCE) html.classList.add("motion");
if (/(^|[?&])view=preview(&|$)/.test(location.search)) html.classList.add("is-preview");
const STARTED = Date.now();
const esc = (v) => String(v == null ? "" : v).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const icon = (id, cls = "ic") => `<svg class="${cls}" aria-hidden="true"><use href="#${id}"/></svg>`;

/* ---------- Session storage (it can throw in private modes: the page then just forgets on reload) ---------- */
const store = {
  get(k) { try { return JSON.parse(sessionStorage.getItem(k)); } catch (e) { return null; } },
  set(k, v) { try { sessionStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* not kept */ } }
};

/* ---------- The visit and where it came from: kept for the visit, sent with each lead ---------- */
const newId = () => (window.crypto && crypto.randomUUID ? crypto.randomUUID() : `v${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`);
let visit = store.get("rm-visit");
if (!visit) { visit = newId(); store.set("rm-visit", visit); }
const ATTR = ["utm_source", "utm_medium", "utm_campaign", "utm_content", "utm_term", "fbclid", "src"];
const attr = Object.assign({}, store.get("rm-attr"));
const qs = new URLSearchParams(location.search);
ATTR.forEach((k) => { const v = qs.get(k); if (v) attr[k] = v.slice(0, 300); });
if (qs.get("fbclid") && !attr.fbclidAt) attr.fbclidAt = Date.now();
store.set("rm-attr", attr);

/* ---------- Events: the Meta pixel (only if loaded, never with Global Privacy Control), the dataLayer, and a log
   the tests read. Standard events (Lead, Schedule) go out only for qualified answers: the course's pixel
   conditioning, so Meta looks for more owners like the ones who fit. ---------- */
const GPC = navigator.globalPrivacyControl === true;
const STANDARD = ["Lead", "Schedule", "InitiateCheckout", "ViewContent"];
window.__rmEvents = window.__rmEvents || [];
function track(name, params, eventID) {
  const p = Object.assign({ variant: VARIANT }, params || {});
  const std = STANDARD.includes(name);
  window.__rmEvents.push({ name, params: p, eventID: eventID || null, standard: std });
  if (!GPC && typeof window.fbq === "function") {
    try { window.fbq(std ? "track" : "trackCustom", name, p, eventID ? { eventID } : undefined); } catch (e) { /* tracking never breaks the page */ }
  }
  (window.dataLayer = window.dataLayer || []).push(Object.assign({ event: `rempo_${name}` }, p));
}
const cookie = (n) => { const m = document.cookie.match(`(?:^|; )${n}=([^;]*)`); return m ? decodeURIComponent(m[1]) : ""; };
const fbc = () => cookie("_fbc") || (attr.fbclid ? `fb.1.${attr.fbclidAt || Date.now()}.${attr.fbclid}` : "");
const tracking = (extra) => Object.assign({ fbc: GPC ? "" : fbc(), fbp: GPC ? "" : cookie("_fbp"), gpc: GPC }, extra);

/* ---------- Sending: JSON to site.endpoint (/api/meta-lead), the same endpoint shape as the master page's /api/lead ---------- */
async function send(body) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 15000);
  try {
    const r = await fetch(SITE.endpoint, { method: "POST", headers: { "content-type": "application/json", accept: "application/json" }, body: JSON.stringify(body), signal: ctrl.signal });
    let data = null;
    try { data = await r.json(); } catch (e) { data = null; }
    return { ok: r.ok && data && data.ok, status: r.status, data };
  } catch (e) {
    return { ok: false, status: 0, data: null };
  } finally { clearTimeout(timer); }
}
const common = () => {
  const out = { variant: VARIANT, visit, page: location.href, tz: (() => { try { return Intl.DateTimeFormat().resolvedOptions().timeZone || ""; } catch (e) { return ""; } })() };
  ATTR.forEach((k) => { if (attr[k]) out[k] = attr[k]; });
  return out;
};

/* ============================================================
   The Gap Check
   ============================================================ */
const card = $("#gap-check");
const form = card && $(".gc-form", card);
const steps = form ? $$(".gc-step", form) : [];
const N = steps.length;
const counter = card && $(".gc-count", card);
const bar = card && $(".gc-bar i", card);
const frame = card && $(".gc-frame", card);
const resultEl = card && $(".gc-result", card);
// Declared before anything renders: a restored visit renders at once, and the sticky bar and the sheet are read then
const sheet = $("#gc-sheet");
const home = $("#gc-home");
const wide = matchMedia("(min-width: 900px)");
const sticky = $(".sticky-bar");
let cardVisible = true, finalVisible = false;
let state = Object.assign({ step: 0, answers: {}, sent: null, call: null, emailOnly: false, started: false, seen: [] }, store.get("rm-gc"));
const save = () => store.set("rm-gc", { step: state.step, answers: state.answers, sent: state.sent, call: state.call, emailOnly: state.emailOnly, started: state.started, seen: state.seen });

function setProgress(i, done) {
  if (counter) counter.textContent = done ? UI.check.done : fill(UI.check.progress, { n: i + 1, total: N });
  if (bar) bar.style.setProperty("--p", done ? "100%" : `${Math.max(6, Math.round((i / N) * 100))}%`);
  if (frame) frame.hidden = done || i > 0;
}

// An element on screen (a confirmation that replaced a form further down), without jumping when it already is
function bringIntoView(el) {
  if (!el) return;
  const r = el.getBoundingClientRect();
  if (r.top < 0 || r.top > window.innerHeight * 0.7) el.scrollIntoView({ block: "start", behavior: REDUCE ? "auto" : "smooth" });
}

// The card's top on screen when a step changes, without jumping when it already is
function keepInView() {
  const r = card.getBoundingClientRect();
  if (r.top < 0 || r.top > window.innerHeight * 0.6) card.scrollIntoView({ block: "start", behavior: REDUCE ? "auto" : "smooth" });
}

function show(i, opts = {}) {
  i = Math.max(0, Math.min(N - 1, i));
  state.step = i;
  steps.forEach((s, k) => {
    const on = k === i;
    s.hidden = !on;
    s.classList.toggle("enter", on && !!opts.animate);
  });
  setProgress(i, false);
  const back = $(".gc-back", steps[i]);
  if (back) back.hidden = i === 0;
  if (opts.focus) {
    keepInView();
    const q = $(".gc-q", steps[i]);
    if (q) q.focus({ preventScroll: true });
  }
  save();
}

// A choice step: the answer kept, the step marked answered
function answerOf(step) {
  const c = $("input[type=radio]:checked", step);
  return c ? c.value : "";
}
function markAnswered(step) {
  const v = answerOf(step);
  step.toggleAttribute("data-answered", !!v);
  if (v) state.answers[step.dataset.key] = v;
}

function firstAnswerEvent() {
  if (state.started) return;
  state.started = true;
  track("GapCheckStart", {});
}
function stepEvent(i) {
  const key = steps[i].dataset.key;
  if (state.seen.includes(key)) return;
  state.seen.push(key);
  track("GapCheckStep", { step: i + 1, step_name: key });
}

function setError(step, msg, field) {
  const err = $(".err", step);
  if (err) err.textContent = msg || "";
  $$("[aria-invalid]", step).forEach((el) => el.removeAttribute("aria-invalid"));
  if (field) field.setAttribute("aria-invalid", "true");
}

// Validates a fields step; returns true or shows the first problem
function checkFields(step) {
  const E = UI.check.errors;
  for (const input of $$("input[data-req]", step)) {
    const name = input.name;
    let bad = false;
    if (input.type === "checkbox") bad = !input.checked;
    else if (input.type === "radio") { bad = !$(`input[name="${name}"]:checked`, step); }
    else if (name === "email") bad = !/^[^\s@<>,]+@[^\s@<>,]+\.[^\s@<>,]+$/.test(input.value.trim());
    else if (name === "phone") bad = !usPhone(input.value);
    else bad = !input.value.trim();
    if (bad) {
      const group = input.type === "radio" ? input.closest(".chips") : input;
      setError(step, E[name] || UI.check.required, group);
      (input.type === "radio" ? $(`input[name="${name}"]`, step) : input).focus();
      return false;
    }
  }
  setError(step, "");
  return true;
}

function next(i) {
  const step = steps[i];
  if (step.dataset.kind === "choice") {
    if (!answerOf(step)) { setError(step, UI.check.required, $(".gc-opts", step)); return; }
    setError(step, "");
    markAnswered(step);
  } else if (!checkFields(step)) return;
  if (step.dataset.key === "business") {
    const p = $("input[name=profiles]:checked", step);
    if (p) state.answers.profiles = p.value;
  }
  stepEvent(i);
  if (i < N - 1) show(i + 1, { focus: true, animate: true });
}

if (form) {
  html.classList.remove("no-js");
  // Pointer taps answer and move on; arrow keys only move the selection (Enter moves on)
  let lastPointer = 0;
  form.addEventListener("pointerdown", (e) => { if (e.target.closest(".gc-opt")) lastPointer = Date.now(); });
  form.addEventListener("click", (e) => {
    const input = e.target.closest(".gc-opt input");
    if (!input) return;
    const step = input.closest(".gc-step");
    firstAnswerEvent();
    markAnswered(step);
    setError(step, "");
    save();
    if (Date.now() - lastPointer < 900) {
      const i = steps.indexOf(step);
      setTimeout(() => { if (state.step === i) next(i); }, REDUCE ? 60 : 240);
    }
  });
  form.addEventListener("change", (e) => {
    const step = e.target.closest(".gc-step");
    if (e.target.matches(".gc-opt input")) markAnswered(step);
    if (e.target.name === "profiles") { state.answers.profiles = e.target.value; save(); }
  });
  form.addEventListener("keydown", (e) => {
    if (e.key !== "Enter" || e.target.tagName === "BUTTON" || e.target.tagName === "A") return;
    const step = e.target.closest(".gc-step");
    if (!step) return;
    e.preventDefault();
    const i = steps.indexOf(step);
    if (step.dataset.key === "contact") submitCheck();
    else next(i);
  });
  steps.forEach((step, i) => {
    const back = $(".gc-back", step);
    if (back) back.addEventListener("click", () => show(i - 1, { focus: true, animate: true }));
    const nxt = $(".gc-next", step);
    if (nxt) nxt.addEventListener("click", () => next(i));
  });
  form.addEventListener("submit", (e) => { e.preventDefault(); submitCheck(); });

  // Restore a visit in progress (a reload, or a return from another tab)
  for (const step of steps) {
    const key = step.dataset.key;
    const v = state.answers[key];
    if (v) { const r = $(`input[type=radio][value="${CSS.escape(v)}"]`, step); if (r) { r.checked = true; step.setAttribute("data-answered", ""); } }
    if (key === "business" && state.answers.profiles) {
      const r = $(`input[name=profiles][value="${CSS.escape(state.answers.profiles)}"]`, step);
      if (r) r.checked = true;
    }
  }
  if (state.sent) renderResult(false);
  else show(Math.min(state.step || 0, N - 1));
}

let sending = false;
async function submitCheck() {
  if (sending) return;
  const last = steps[N - 1];
  if (!checkFields(last)) return;
  const ev = evaluate(SURVEY, state.answers);
  if (!ev.ok) { show(steps.findIndex((s) => ev.missing.includes(s.dataset.key) || (s.dataset.key === "business" && ev.missing.includes("profiles"))), { focus: true }); return; }
  const get = (n) => { const el = form.elements[n]; return el ? String(el.value || "").trim() : ""; };
  const hp = get("hp");
  const contact = { firstName: get("firstName"), email: get("email").toLowerCase(), company: get("company"), city: get("city") };
  const leadEventId = `lead-${visit}`;
  // Too fast to be a person, or a filled bot trap: act as if sent, send nothing
  if (hp || Date.now() - STARTED < 3000) { state.sent = Object.assign({ ev, at: Date.now() }, contact); renderResult(true); return; }
  sending = true;
  card.classList.add("gc-sending");
  const btn = $("button[type=submit]", last);
  const label = btn.innerHTML;
  btn.innerHTML = `<span class="spin" aria-hidden="true"></span>${esc(UI.check.sending)}`;
  btn.disabled = true;
  stepEvent(N - 1);
  const body = Object.assign({ form: SURVEY.form }, contact, ev.answers, { consentEmail: true }, common(), { tracking: tracking({ leadEventId }) });
  const r = await send(body);
  sending = false;
  card.classList.remove("gc-sending");
  btn.innerHTML = label;
  btn.disabled = false;
  if (!r.ok) {
    setError(last, r.status === 429 ? UI.check.errors.rate : (r.data && r.data.error && r.status === 400 ? r.data.error : UI.check.errors.send));
    return;
  }
  state.sent = Object.assign({ ev, at: Date.now(), confirmEmail: !!(r.data && r.data.confirmEmail) }, contact);
  save();
  track("GapReportRequested", { fit: ev.fit, tier: ev.tier, score: ev.score, trade: ev.answers.trade });
  if (ev.qualified) track("Lead", { content_name: "Gap Report", content_category: ev.tier }, leadEventId);
  renderResult(true);
}

/* ---------- The result, then the last step ---------- */
function renderResult(fresh) {
  const s = state.sent;
  const ev = evaluate(SURVEY, state.answers);
  const R = UI.result;
  const vars = { business: s.company, service: ev.service, city: s.city, email: s.email, turnaround: SITE.reportTurnaround };
  steps.forEach((st) => { st.hidden = true; });
  setProgress(N - 1, true);
  const gaps = ev.gaps.map((g) => `<li><b>${esc(g.title)}</b><span>${esc(g.line)}</span></li>`).join("");
  resultEl.innerHTML = `
    <div class="score">
      <p class="score-l">${esc(R.label)}</p>
      <div class="score-row"><p class="score-n" tabindex="-1"><span data-count>${fresh && !REDUCE ? 0 : ev.score}</span><small>${esc(R.of)}</small></p><span class="tier ${esc(ev.tier)}">${esc(ev.tierName)}</span></div>
      <div class="meter" aria-hidden="true"><i style="--s:${fresh && !REDUCE ? 0 : ev.score}%"></i></div>
      <p class="score-x">${esc(R.explain)}</p>
    </div>
    <p class="tier-msg">${esc(ev.tierMsg)}</p>
    ${gaps ? `<div class="gaps"><h3>${esc(R.gapsTitle)}</h3><ol>${gaps}</ol><p class="rule">${esc(SURVEY.ruleLine)}</p></div>` : ""}
    <p class="next-box">${icon("i-mail")}<span>${esc(fill(R.reportNext, vars))}</span></p>
    <div class="book-wrap"></div>`;
  resultEl.hidden = false;
  if (fresh) {
    const n = $(".score-n", resultEl);
    keepInView();
    n.focus({ preventScroll: true });
    if (!REDUCE) {
      const span = $("[data-count]", resultEl);
      const t0 = performance.now();
      const tick = (t) => { const k = Math.min(1, (t - t0) / 800); span.textContent = Math.round(ev.score * (1 - Math.pow(1 - k, 3))); if (k < 1) requestAnimationFrame(tick); };
      requestAnimationFrame(tick);
      requestAnimationFrame(() => requestAnimationFrame(() => { $(".meter i", resultEl).style.setProperty("--s", `${ev.score}%`); }));
    }
  }
  if (state.call) renderBooked(false);
  else if (state.emailOnly) renderEmailOnly(false);
  else renderBooking(ev);
  syncSticky();
}

function renderBooking(ev) {
  const R = UI.result, B = SURVEY.booking, s = state.sent;
  const days = bookingDays(SURVEY, new Date());
  const why = ev.callOnly ? fill(R.bookCallOnly, { why: SURVEY.callOnlyWhy[ev.why] }) : fill(R.bookLead, { business: s.company });
  const chip = (name, o, extra) => `<label class="chip-opt"><input type="radio" name="${name}" value="${esc(o.v)}"${extra || ""}><span>${esc(o.label)}${o.hint ? `<small>${esc(o.hint)}</small>` : ""}</span></label>`;
  const wrap = $(".book-wrap", resultEl);
  wrap.innerHTML = `
    <form class="book" novalidate>
      <h3 class="book-t" tabindex="-1">${esc(R.bookTitle)}</h3>
      <p class="book-lead">${esc(why)}</p>
      <fieldset><legend class="group-l">${esc(R.dayLabel)}</legend><div class="chips" data-group="slotDay">${days.map((d, k) => chip("slotDay", { v: d.v, label: d.label }, k === 0 ? " data-req" : "")).join("")}</div></fieldset>
      <fieldset><legend class="group-l">${esc(R.windowLabel)}</legend><div class="chips" data-group="slotWindow">${B.windows.map((w, k) => chip("slotWindow", w, k === 0 ? " data-req" : "")).join("")}</div></fieldset>
      <div class="field"><label for="bk-phone">${esc(B.phone.label)}</label><div class="phone-in"><span aria-hidden="true">${esc(B.phone.prefix)}</span><input id="bk-phone" name="phone" type="tel" inputmode="${esc(B.phone.inputmode)}" autocomplete="${esc(B.phone.autocomplete)}" maxlength="20" data-req></div></div>
      <label class="consent"><input type="checkbox" name="${esc(B.consentPhone.name)}" data-req><span>${esc(B.consentPhone.label)}</span></label>
      <label class="consent"><input type="checkbox" name="${esc(B.consentText.name)}"><span>${esc(B.consentText.label)}</span></label>
      <p class="err" role="alert"></p>
      <button class="btn btn-primary btn-block" type="submit">${icon("i-calendar")}${esc(R.bookSubmit)}</button>
      <button class="link-btn skip" type="button">${esc(R.skip)}</button>
    </form>`;
  const f = $("form", wrap);
  f.addEventListener("submit", (e) => { e.preventDefault(); submitCall(f, ev); });
  $(".skip", f).addEventListener("click", () => { state.emailOnly = true; save(); track("CallSkipped", { fit: ev.fit }); renderEmailOnly(true); });
  f.addEventListener("change", () => setError(f, ""));
}

function slotCheck(f) {
  const E = UI.check.errors;
  const day = $("input[name=slotDay]:checked", f), win = $("input[name=slotWindow]:checked", f);
  if (!day || !win) { setError(f, E.slot, (!day ? $("[data-group=slotDay]", f) : $("[data-group=slotWindow]", f))); (!day ? $("input[name=slotDay]", f) : $("input[name=slotWindow]", f)).focus(); return null; }
  const phone = $("input[name=phone]", f);
  if (!usPhone(phone.value)) { setError(f, E.phone, phone); phone.focus(); return null; }
  const c = $(`input[name=${SURVEY.booking.consentPhone.name}]`, f);
  if (!c.checked) { setError(f, E.consentPhone, c); c.focus(); return null; }
  setError(f, "");
  return { slotDay: day.value, slotWindow: win.value, phone: usPhone(phone.value), consentPhone: true, consentText: $(`input[name=${SURVEY.booking.consentText.name}]`, f).checked };
}

let booking = false;
async function submitCall(f, ev) {
  if (booking) return;
  const slot = slotCheck(f);
  if (!slot) return;
  const s = state.sent;
  const scheduleEventId = `schedule-${visit}`;
  booking = true;
  const btn = $("button[type=submit]", f);
  const label = btn.innerHTML;
  btn.innerHTML = `<span class="spin" aria-hidden="true"></span>${esc(UI.result.bookSending)}`;
  btn.disabled = true;
  const body = Object.assign({ form: SURVEY.callForm, firstName: s.firstName, email: s.email, company: s.company, city: s.city }, ev.answers, slot, common(), { tracking: tracking({ scheduleEventId }) });
  const r = await send(body);
  booking = false;
  btn.innerHTML = label;
  btn.disabled = false;
  if (!r.ok) { setError(f, r.status === 429 ? UI.check.errors.rate : UI.check.errors.send); return; }
  state.call = Object.assign({ confirmEmail: !!(r.data && r.data.confirmEmail) }, slot);
  save();
  track("CallRequested", { fit: ev.fit, window: slot.slotWindow });
  if (ev.qualified) track("Schedule", { content_name: "Gap Report call" }, scheduleEventId);
  renderBooked(true);
}

function calendarHref(day, win) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day);
  if (!m || !win) return "";
  const p = (n) => String(n).padStart(2, "0");
  const at = (h) => `${m[1]}${m[2]}${m[3]}T${p(h)}0000`;
  const now = new Date();
  const stamp = `${now.getUTCFullYear()}${p(now.getUTCMonth() + 1)}${p(now.getUTCDate())}T${p(now.getUTCHours())}${p(now.getUTCMinutes())}00Z`;
  const ics = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Rempo//Gap Report call//EN", "BEGIN:VEVENT", `UID:${visit}@rempo`, `DTSTAMP:${stamp}`,
    `DTSTART:${at(win.start)}`, `DTEND:${at(win.end)}`, `SUMMARY:${UI.result.calendarTitle}`, `DESCRIPTION:${UI.result.calendarBody}`, "END:VEVENT", "END:VCALENDAR"].join("\r\n");
  return `data:text/calendar;charset=utf-8,${encodeURIComponent(ics)}`;
}

function checkoutHref() {
  if (!SITE.checkoutUrl) return "";
  try {
    const u = new URL(SITE.checkoutUrl);
    u.searchParams.set("client_reference_id", visit);
    if (state.sent && state.sent.email) u.searchParams.set("prefilled_email", state.sent.email);
    ATTR.forEach((k) => { if (attr[k] && k.startsWith("utm_")) u.searchParams.set(k, attr[k]); });
    return u.toString();
  } catch (e) { return ""; }
}

function videoHtml() {
  const v = SITE.vsl;
  if (!v) return "";
  const R = UI.result;
  let player = "";
  if (v.type === "youtube" && v.id) player = `<iframe src="https://www.youtube-nocookie.com/embed/${encodeURIComponent(v.id)}?cc_load_policy=1&rel=0&playsinline=1" title="${esc(R.videoTitle)}" allow="autoplay; encrypted-media; picture-in-picture" allowfullscreen loading="lazy"></iframe>`;
  else if (v.src) player = `<video controls playsinline preload="metadata"${v.poster ? ` poster="${esc(v.poster)}"` : ""}><source src="${esc(v.src)}" type="video/mp4">${v.captions ? `<track kind="captions" src="${esc(v.captions)}" srclang="en" label="English" default>` : ""}</video>`;
  if (!player) return "";
  return `<div class="vsl"><b class="list-t">${esc(R.videoTitle)}</b><div class="vsl-frame">${player}</div><p class="muted">${esc(fill(R.videoLead, { length: v.length || "" }))}</p></div>`;
}

function renderBooked(fresh) {
  const R = UI.result, c = state.call, ev = evaluate(SURVEY, state.answers);
  const win = windowOf(SURVEY, c.slotWindow);
  const phone = c.phone ? `(${c.phone.slice(0, 3)}) ${c.phone.slice(3, 6)}-${c.phone.slice(6)}` : "";
  const cal = calendarHref(c.slotDay, win);
  const co = !ev.callOnly ? checkoutHref() : "";
  const wrap = $(".book-wrap", resultEl);
  wrap.innerHTML = `
    <div class="done" role="status">
      <div class="done-head"><svg class="done-ic" viewBox="0 0 24 24" aria-hidden="true"><path pathLength="1" d="M20 6 9 17l-5-5"/></svg>
        <h3 class="done-t" tabindex="-1">${esc(fill(R.bookedTitle, { day: dayLabel(c.slotDay), window: win ? `${win.label.toLowerCase()} (${win.hint})` : "" }))}</h3></div>
      <p>${esc(fill(R.bookedLead, { phone }))}${c.confirmEmail ? ` ${esc(R.bookedConfirm)}` : ""}</p>
      ${cal ? `<a class="btn btn-line" href="${cal}" download="rempo-call.ics">${icon("i-calendar")}${esc(R.calendar)}</a>` : ""}
      ${videoHtml()}
      <div class="heads"><b>${esc(R.headsUpTitle)}</b><p>${esc(R.headsUp)}</p><p>${esc(R.bring)}</p></div>
      ${co ? `<a class="link-btn" data-checkout href="${esc(co)}">${esc(R.checkout)}${icon("i-arrow")}</a>` : ""}
    </div>`;
  const ck = $("[data-checkout]", wrap);
  if (ck) ck.addEventListener("click", () => track("InitiateCheckout", { content_name: "Rempo" }));
  if (fresh) { bringIntoView($(".done", wrap)); $(".done-t", wrap).focus({ preventScroll: true }); }
  syncSticky();
}

function renderEmailOnly(fresh) {
  const R = UI.result, s = state.sent;
  const wrap = $(".book-wrap", resultEl);
  wrap.innerHTML = `
    <div class="done" role="status">
      <div class="done-head"><svg class="done-ic" viewBox="0 0 24 24" aria-hidden="true"><path pathLength="1" d="M20 6 9 17l-5-5"/></svg>
        <h3 class="done-t" tabindex="-1">${esc(R.emailOnlyTitle)}</h3></div>
      <p>${esc(fill(R.emailOnlyLead, { email: s.email, turnaround: SITE.reportTurnaround }))}</p>
      <button class="link-btn" type="button" data-rebook>${icon("i-calendar")}${esc(R.rebook)}</button>
    </div>`;
  $("[data-rebook]", wrap).addEventListener("click", () => { state.emailOnly = false; save(); renderBooking(evaluate(SURVEY, state.answers)); const t = $(".book-t", resultEl); if (t) { bringIntoView(t); t.focus({ preventScroll: true }); } });
  if (fresh) { bringIntoView($(".done", wrap)); $(".done-t", wrap).focus({ preventScroll: true }); }
  syncSticky();
}

/* ============================================================
   Every button on the page opens the Gap Check: a sheet from the bottom on a phone (the card moves in, and back out
   on close, so nothing is lost), a glide to the hero card on a PC
   ============================================================ */
function focusCurrent() {
  const target = state.sent ? ($(".book-t", resultEl) || $(".done-t", resultEl) || $(".score-n", resultEl)) : $(".gc-q", steps[state.step]);
  if (target) target.focus({ preventScroll: true });
}
function openCheck(from) {
  track("CheckOpened", { from });
  if (wide.matches || !sheet || typeof sheet.showModal !== "function") {
    card.scrollIntoView({ block: "start", behavior: REDUCE ? "auto" : "smooth" });
    setTimeout(focusCurrent, REDUCE ? 0 : 450);
    return;
  }
  home.style.minHeight = `${home.offsetHeight}px`;   // the hero keeps its height, so the page behind never jumps
  $(".dlg-body", sheet).append(card);
  sheet.showModal();
  document.body.classList.add("sheet-open");
  focusCurrent();
}
if (sheet && home) {
  sheet.addEventListener("close", () => { home.append(card); home.style.minHeight = ""; document.body.classList.remove("sheet-open"); syncSticky(); });
  sheet.addEventListener("click", (e) => { if (e.target === sheet) sheet.close(); });
  $(".dlg-x", sheet).addEventListener("click", () => sheet.close());
}
$$("[data-open-check]").forEach((a) => a.addEventListener("click", (e) => { e.preventDefault(); openCheck(a.dataset.openCheck || "page"); }));

/* ---------- The sticky bar: on phones, once the hero card is off screen; not over the close, not once done ---------- */
function syncSticky() {
  if (!sticky) return;
  const done = !!(state.call || state.emailOnly);
  const inSheet = sheet && sheet.open;
  sticky.classList.toggle("show", !cardVisible && !finalVisible && !done && !inSheet);
}
if ("IntersectionObserver" in window && sticky && home) {
  new IntersectionObserver((es) => { cardVisible = es[0].isIntersecting; syncSticky(); }, { rootMargin: "0px 0px -20% 0px" }).observe(home);
  const fin = $("#final");
  if (fin) new IntersectionObserver((es) => { finalVisible = es[0].isIntersecting; syncSticky(); }, { threshold: 0.2 }).observe(fin);
}

/* ---------- Reveal on scroll (motion only); everything is visible without it ---------- */
if (!REDUCE && "IntersectionObserver" in window) {
  const io = new IntersectionObserver((es) => es.forEach((e) => { if (e.isIntersecting) { e.target.classList.add("in"); io.unobserve(e.target); } }), { rootMargin: "0px 0px -8% 0px" });
  $$(".reveal").forEach((el) => io.observe(el));
} else {
  $$(".reveal").forEach((el) => el.classList.add("in"));
}

/* ---------- FAQ opened: what owners want to know, as data ---------- */
$$(".faq details").forEach((d) => d.addEventListener("toggle", () => { if (d.open) track("FaqOpened", { question: d.dataset.q || "" }); }));

})();
