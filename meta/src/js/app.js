/* Rempo for Meta ads: the page's script. tools/build.mjs wraps it in one function.
   The page's lead capture is the Review Race (../review-race/public/race, built into assets/race/): its business search
   in the hero, the tool below it. This script hands the race what to keep with each lead (the ad variant, the version
   of the consent wording, the pixel's event ids, the ad-tool ids and the visitor's choice), gives every notice at
   collection this site's legal links and its sentence about Meta, turns the race's steps into pixel events (Lead and
   Schedule only for a trade business: the course's pixel conditioning), and runs the cookie notice, the buttons, the
   sticky bar, and the video and checkout link after a call is booked. */

"use strict";
const DATA = JSON.parse(document.getElementById("rm-data").textContent);
const SITE = DATA.site, UI = DATA.ui, VARIANT = DATA.variant;
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => Array.from(el.querySelectorAll(s));
const html = document.documentElement;
const REDUCE = matchMedia("(prefers-reduced-motion: reduce)").matches;
if (!REDUCE) html.classList.add("motion");
if (/(^|[?&])view=preview(&|$)/.test(location.search)) html.classList.add("is-preview");
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

/* ---------- Consent: whether advertising and analytics tools (Meta's pixel, Clarity) may run. Global Privacy Control
   always means no. Otherwise the visitor's choice, kept in localStorage "rm-consent" ({ ads: "granted" | "denied" })
   and shared with /legal/privacy-choices on the same domain. With no choice yet, site.trackingConsent decides:
   "opt-in" (the default) waits for Allow, "notice" runs until the visitor declines. ---------- */
const GPC = navigator.globalPrivacyControl === true;
const TRACK = SITE.tracking || {};
const CONSENT_KEY = "rm-consent";
function readConsent() {
  try { const c = JSON.parse(localStorage.getItem(CONSENT_KEY) || "null"); return c && (c.ads === "granted" || c.ads === "denied") ? c : null; } catch (e) { return null; }
}
function writeConsent(ads) {
  try { localStorage.setItem(CONSENT_KEY, JSON.stringify({ v: 1, ads, at: new Date().toISOString(), src: "notice" })); } catch (e) { /* not kept: asked again next visit */ }
}
// "granted", "denied" (a choice, or Global Privacy Control), or "unset"; sent with each lead, so the server knows too
const consentState = () => (GPC ? "denied" : (readConsent() || {}).ads || "unset");
const adsAllowed = () => { const s = consentState(); return s === "granted" || (s === "unset" && TRACK.mode === "notice"); };

// The tools themselves, loaded only once they are allowed (never from the page's head)
function loadTrackers() {
  if (window.__rmTrackersOn || !adsAllowed()) return;
  window.__rmTrackersOn = true;
  if (TRACK.pixel) {
    try {
      !function (f, b, e, v, n, t, s) { if (f.fbq) return; n = f.fbq = function () { n.callMethod ? n.callMethod.apply(n, arguments) : n.queue.push(arguments); }; if (!f._fbq) f._fbq = n; n.push = n; n.loaded = !0; n.version = "2.0"; n.queue = []; t = b.createElement(e); t.async = !0; t.src = v; s = b.getElementsByTagName(e)[0]; s.parentNode.insertBefore(t, s); }(window, document, "script", "https://connect.facebook.net/en_US/fbevents.js");
      window.fbq("init", TRACK.pixel);
      window.fbq("track", "PageView");
    } catch (e) { /* tracking never breaks the page */ }
  }
  if (TRACK.clarity) {
    try {
      (function (c, l, a, r, i, t, y) { c[a] = c[a] || function () { (c[a].q = c[a].q || []).push(arguments); }; t = l.createElement(r); t.async = 1; t.src = "https://www.clarity.ms/tag/" + i; y = l.getElementsByTagName(r)[0]; y.parentNode.insertBefore(t, y); })(window, document, "clarity", "script", TRACK.clarity);
    } catch (e) { /* tracking never breaks the page */ }
  }
}

/* ---------- Events: the Meta pixel (only once allowed, never with Global Privacy Control), the dataLayer, and a log
   the tests read. Standard events (Lead, Schedule) go out only for a race whose business is a trade (the race says so:
   its fit): the course's pixel conditioning, so Meta looks for more owners like the ones who fit. ---------- */
const STANDARD = ["Lead", "Schedule", "InitiateCheckout", "ViewContent"];
window.__rmEvents = window.__rmEvents || [];
function track(name, params, eventID) {
  const p = Object.assign({ variant: VARIANT }, params || {});
  const std = STANDARD.includes(name);
  window.__rmEvents.push({ name, params: p, eventID: eventID || null, standard: std });
  if (adsAllowed() && typeof window.fbq === "function") {
    try { window.fbq(std ? "track" : "trackCustom", name, p, eventID ? { eventID } : undefined); } catch (e) { /* tracking never breaks the page */ }
  }
  (window.dataLayer = window.dataLayer || []).push(Object.assign({ event: `rempo_${name}` }, p));
}
const cookie = (n) => { const m = document.cookie.match(`(?:^|; )${n}=([^;]*)`); return m ? decodeURIComponent(m[1]) : ""; };
const fbc = () => cookie("_fbc") || (attr.fbclid ? `fb.1.${attr.fbclidAt || Date.now()}.${attr.fbclid}` : "");
const tracking = (extra) => {
  const out = consentState() === "denied";
  return Object.assign({ fbc: out ? "" : fbc(), fbp: out ? "" : cookie("_fbp"), gpc: GPC, consent: consentState() }, extra);
};

/* ---------- The cookie notice (in the page only when a pixel or Clarity id is set): shown until the visitor
   chooses, never with Global Privacy Control; the footer's "Cookie settings" opens it again ---------- */
const notice = document.getElementById("cookie-notice");
function showNotice(open) {
  if (!notice) return;
  notice.hidden = !open;
  document.body.classList.toggle("cookie-open", open);
}
if (notice) {
  if (!GPC && !readConsent()) showNotice(true);
  $$("[data-consent]", notice).forEach((b) => b.addEventListener("click", () => {
    writeConsent(b.dataset.consent);
    showNotice(false);
    if (b.dataset.consent === "granted") loadTrackers();
    else if (window.__rmTrackersOn) location.reload();   // a tool that already ran stops only with a fresh page
  }));
  $$("[data-cookie-settings]").forEach((b) => b.addEventListener("click", () => { showNotice(true); const first = $("[data-consent]", notice); if (first) first.focus(); }));
}
loadTrackers();

/* ---------- The Review Race: what this page adds to each of its requests, and its own legal links and sentence for
   every notice at collection (review-race/public/race/race.js reads window.ReviewRace). The server checks each value
   (review-race/api/_lib/race/core.mjs, hostOf) and keeps them with the race and the lead. ---------- */
const LEGAL = SITE.legal || {};
const fill = (s, v) => String(s).replace(/\{(\w+)\}/g, (m, k) => (v && v[k] != null ? String(v[k]) : m));
// One event id per visit for each standard event, shared by the pixel (here) and the Conversions API (the server), so
// Meta counts each once. Made from the visit id, so it needs no storage of its own (the cookie notice lists rm-visit)
const eventId = (kind) => `${kind}-${String(visit).replace(/[^A-Za-z0-9-]/g, "").slice(0, 60)}`;
window.ReviewRace = {
  legal: { terms: LEGAL.terms, privacy: LEGAL.privacy || SITE.privacyUrl, sms: LEGAL.sms },
  notice: LEGAL.choices ? { text: fill(UI.legal.noticeMeta, { choices: "" }).trim(), href: LEGAL.choices, label: UI.legal.choices } : null,
  extra(action) {
    const out = { variant: VARIANT, tracking: tracking() };
    if (SITE.noticeVersion) out.noticeVersion = SITE.noticeVersion;   // the consent and policy wording this lead agrees to
    if (action === "unlock") out.eventId = eventId("lead");
    if (action === "book") out.eventId = eventId("schedule");
    return out;
  }
};

/* ---------- The race's steps (it announces each one as a "reviewrace" window event) ---------- */
let done = false, focused = false;
window.addEventListener("reviewrace", (e) => {
  const d = (e && e.detail) || {};
  const trade = d.fit === "trade";
  if (d.step === "search_focus") { if (!focused) { focused = true; track("RaceSearchFocus", {}); } }
  else if (d.step === "business_picked") track("RaceStart", { manual: Boolean(d.manual) });
  else if (d.step === "preview_shown") track("RacePreview", { rivals: d.rivals || 0, fit: d.fit || "" });
  else if (d.step === "unlock_submitted") track("RaceUnlock", {});
  else if (d.step === "results_shown") {
    track("RaceResults", { fit: d.fit || "" });
    if (trade) track("Lead", { content_name: "Review Race" }, eventId("lead"));
  } else if (d.step === "later_submitted") { done = true; track("RaceLaterRequested", { reason: d.reason || "" }); }
  else if (d.step === "booked") {
    done = true;
    track("RaceBooked", { fit: d.fit || "" });
    if (trade) track("Schedule", { content_name: "Review Race call" }, eventId("schedule"));
    afterBooking();
  }
  syncSticky();
});

/* ---------- After a call is booked: the video (site.vsl) and the checkout link (site.checkoutUrl), each when set ---------- */
function videoHtml() {
  const v = SITE.vsl;
  if (!v) return "";
  const B = UI.booked;
  let player = "";
  if (v.type === "youtube" && v.id) player = `<iframe src="https://www.youtube-nocookie.com/embed/${encodeURIComponent(v.id)}?cc_load_policy=1&rel=0&playsinline=1" title="${esc(B.videoTitle)}" allow="autoplay; encrypted-media; picture-in-picture" allowfullscreen loading="lazy"></iframe>`;
  else if (v.src) player = `<video controls playsinline preload="metadata"${v.poster ? ` poster="${esc(v.poster)}"` : ""}><source src="${esc(v.src)}" type="video/mp4">${v.captions ? `<track kind="captions" src="${esc(v.captions)}" srclang="en" label="English" default>` : ""}</video>`;
  if (!player) return "";
  return `<div class="vsl"><b class="list-t">${esc(B.videoTitle)}</b><div class="vsl-frame">${player}</div><p class="muted">${esc(fill(B.videoLead, { length: v.length || "" }))}</p></div>`;
}
function checkoutHref() {
  if (!SITE.checkoutUrl) return "";
  try {
    const u = new URL(SITE.checkoutUrl);
    u.searchParams.set("client_reference_id", visit);
    ATTR.forEach((k) => { if (attr[k] && k.startsWith("utm_")) u.searchParams.set(k, attr[k]); });
    return u.toString();
  } catch (e) { return ""; }
}
function afterBooking() {
  const box = $("#review-race .rr-book");
  if (!box || (box.nextElementSibling && box.nextElementSibling.classList.contains("after-book"))) return;
  const vid = videoHtml(), co = checkoutHref();
  if (!vid && !co) return;
  const wrap = document.createElement("div");
  wrap.className = "after-book";
  wrap.innerHTML = `${vid}${co ? `<a class="link-btn" data-checkout href="${esc(co)}">${esc(UI.booked.checkout)}${icon("i-arrow")}</a>` : ""}`;
  box.after(wrap);
  const ck = $("[data-checkout]", wrap);
  if (ck) ck.addEventListener("click", () => track("InitiateCheckout", { content_name: "Rempo" }));
}

/* ---------- Every button on the page leads to the race: the hero's search (focused) until a race has started, then
   the race itself ---------- */
function openRace(from) {
  track("RaceOpened", { from });
  const started = $("#review-race .rr-chip");
  const target = started ? $("#review-race") : $("#race-home");
  if (!target) return;
  target.scrollIntoView({ block: started ? "start" : "center", behavior: REDUCE ? "auto" : "smooth" });
  const input = started ? null : $("#hero-race input");
  if (input) setTimeout(() => input.focus({ preventScroll: true }), REDUCE ? 0 : 450);
}
$$("[data-race-open]").forEach((a) => a.addEventListener("click", (e) => { e.preventDefault(); openRace(a.dataset.raceOpen || "page"); }));

/* ---------- The sticky bar (phones): once the hero's search and the race are both off screen; not over the final call
   or a section's own button, and not once a call is booked or a race was asked for by email ---------- */
const sticky = $(".sticky-bar");
const ctaSeen = new Set();
let heroVisible = true, raceVisible = false, finalVisible = false;
function syncSticky() {
  if (!sticky) return;
  sticky.classList.toggle("show", !heroVisible && !raceVisible && !finalVisible && !ctaSeen.size && !done);
}
if ("IntersectionObserver" in window && sticky) {
  const home = $("#race-home"), race = $("#review-race"), fin = $("#final");
  if (home) new IntersectionObserver((es) => { heroVisible = es[0].isIntersecting; syncSticky(); }, { rootMargin: "0px 0px -20% 0px" }).observe(home);
  if (race) new IntersectionObserver((es) => { raceVisible = es[0].isIntersecting; syncSticky(); }, { threshold: 0.05 }).observe(race);
  if (fin) new IntersectionObserver((es) => { finalVisible = es[0].isIntersecting; syncSticky(); }, { threshold: 0.2 }).observe(fin);
  const ctaIO = new IntersectionObserver((es) => {
    es.forEach((e) => { if (e.isIntersecting) ctaSeen.add(e.target); else ctaSeen.delete(e.target); });
    syncSticky();
  }, { rootMargin: "0px 0px -12% 0px" });
  $$(".sec-cta").forEach((el) => ctaIO.observe(el));
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
