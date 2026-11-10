// The Review Race on a page: no framework, no build step. Two mount points, so it drops into any page:
//   <section id="review-race" data-review-race></section>        the whole tool (the section)
//   <div data-review-race-cta data-target="#review-race"></div>   a business search for the hero: picking a business
//                                                                 scrolls to the section and starts the race there
// Both talk to /api/race (data-api="..." on the element changes it). Every word comes from copy.js. Text from the
// server is always set as text, never as HTML. The page hears each step as a "reviewrace" window event (for a pixel
// or analytics): search_focus, business_picked, preview_shown, unlock_submitted, results_shown, booked.
import COPY from "./copy.js";

const fill = (s, v) => String(s).replace(/\{(\w+)\}/g, (m, k) => (v && v[k] !== undefined && v[k] !== null ? String(v[k]) : m));
const emit = (step, detail = {}) => { try { window.dispatchEvent(new CustomEvent("reviewrace", { detail: { step, ...detail } })); } catch { /* old browser */ } };

function h(tag, attrs, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v === null || v === undefined || v === false) continue;
    if (k === "class") el.className = v;
    else if (k === "text") el.textContent = v;
    else if (k.startsWith("on") && typeof v === "function") el.addEventListener(k.slice(2), v);
    else el.setAttribute(k, v === true ? "" : String(v));
  }
  for (const kid of kids.flat(Infinity)) {
    if (kid === null || kid === undefined || kid === false) continue;
    el.append(kid instanceof Node ? kid : document.createTextNode(String(kid)));
  }
  return el;
}

async function api(base, action, { method = "GET", params = {}, body } = {}) {
  const url = method === "GET" ? `${base}?${new URLSearchParams({ action, ...params })}` : base;
  let r;
  try {
    r = await fetch(url, { method, credentials: "same-origin", headers: method === "GET" ? {} : { "content-type": "application/json" }, body: method === "GET" ? undefined : JSON.stringify({ action, ...body }) });
  } catch {
    throw Object.assign(new Error(COPY.errors.network), { code: "network" });
  }
  let data = null;
  try { data = await r.json(); } catch { data = null; }
  if (!r.ok) throw Object.assign(new Error((data && data.error) || COPY.errors.generic), { code: data && data.code, later: Boolean(data && data.later), status: r.status });
  return data;
}

const configs = new Map();
const getConfig = (base) => { if (!configs.has(base)) configs.set(base, api(base, "config").catch(() => ({}))); return configs.get(base); };

const store = { get(k) { try { return window.sessionStorage.getItem(k); } catch { return null; } }, set(k, v) { try { window.sessionStorage.setItem(k, v); } catch { /* private mode */ } } };
const uuid = () => (window.crypto && crypto.randomUUID ? crypto.randomUUID() : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`);
function visitId() { let v = store.get("rr-visit"); if (!v) { v = uuid(); store.set("rr-visit", v); } return v; }
function utm() {
  const p = new URLSearchParams(location.search);
  const out = {};
  for (const [k, v] of p) if (/^(utm_[a-z]+|fbclid|gclid)$/.test(k)) out[k] = v.slice(0, 200);
  return out;
}

const fmtRating = (r) => (typeof r === "number" ? r.toFixed(1) : null);
const fmtInt = (n) => (typeof n === "number" ? n.toLocaleString("en-US") : "?");
function daysText(d) {
  const t = COPY.results.days;
  if (d === null || d === undefined) return t.unknown;
  return d === 0 ? t.today : d === 1 ? t.yesterday : fill(t.many, { n: d });
}
const stars = (r) => (typeof r === "number" ? h("span", { class: "rr-stars", "aria-label": `${fmtRating(r)} stars` }, "★", h("span", { "aria-hidden": "true", text: ` ${fmtRating(r)}` })) : h("span", { class: "rr-muted", text: COPY.preview.noRating }));
const reviewsText = (n) => (n === 1 ? COPY.preview.oneReview : fill(COPY.preview.reviews, { n: fmtInt(n) }));

/* ---------- Cloudflare Turnstile (only when the server gives a site key) ---------- */
let turnstileLoad = null;
function loadTurnstile() {
  if (window.turnstile) return Promise.resolve();
  if (!turnstileLoad) {
    turnstileLoad = new Promise((resolve, reject) => {
      const s = document.createElement("script");
      s.src = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
      s.async = true;
      s.onload = () => resolve();
      s.onerror = () => { turnstileLoad = null; reject(new Error("bot check did not load")); };
      document.head.append(s);
    });
  }
  return turnstileLoad;
}

/* ---------- The business search box (used by the section and the hero) ---------- */
function searchBox({ base, session, onPick, compact, idPrefix }) {
  const listId = `${idPrefix}-list`;
  const input = h("input", { class: "rr-input", type: "text", id: `${idPrefix}-input`, name: "business", autocomplete: "off", spellcheck: "false", role: "combobox", "aria-autocomplete": "list", "aria-expanded": "false", "aria-controls": listId, "aria-describedby": `${idPrefix}-status`, placeholder: compact ? COPY.hero.placeholder : COPY.search.placeholder, enterkeyhint: "search" });
  const list = h("ul", { class: "rr-list", id: listId, role: "listbox", "aria-label": COPY.search.label, hidden: true });
  const status = h("p", { class: "rr-search-status", id: `${idPrefix}-status`, "aria-live": "polite" });
  let items = [], active = -1, timer = null, seq = 0, chosen = null;
  const close = () => { list.hidden = true; input.setAttribute("aria-expanded", "false"); input.removeAttribute("aria-activedescendant"); };
  const render = () => {
    list.replaceChildren(...items.map((it, i) => h("li", {
      id: `${listId}-${i}`, role: "option", class: `rr-option${i === active ? " is-active" : ""}`, "aria-selected": i === active ? "true" : "false",
      onmousedown: (e) => { e.preventDefault(); pick(i); }
    }, h("span", { class: "rr-option-main", text: it.main }), it.secondary ? h("span", { class: "rr-option-sub", text: it.secondary }) : null)));
    const open = items.length > 0;
    list.hidden = !open;
    input.setAttribute("aria-expanded", open ? "true" : "false");
    if (open && active >= 0) input.setAttribute("aria-activedescendant", `${listId}-${active}`); else input.removeAttribute("aria-activedescendant");
  };
  const pick = (i) => {
    const it = items[i];
    if (!it) return;
    chosen = it;
    input.value = it.main;
    items = [];
    render();
    status.textContent = "";
    onPick(it);
  };
  const query = async () => {
    const q = input.value.trim();
    chosen = null;
    if (q.length < 2) { items = []; render(); status.textContent = ""; return; }
    const mine = ++seq;
    status.textContent = COPY.search.searching;
    try {
      const d = await api(base, "suggest", { params: { q, s: session() } });
      if (mine !== seq) return;
      items = (d && d.suggestions) || [];
      active = items.length ? 0 : -1;
      render();
      status.textContent = items.length ? "" : COPY.search.none;
    } catch (e) {
      if (mine !== seq) return;
      items = [];
      render();
      status.textContent = e.message || COPY.search.error;
    }
  };
  input.addEventListener("input", () => { clearTimeout(timer); timer = setTimeout(query, 220); });
  input.addEventListener("keydown", (e) => {
    if (e.key === "ArrowDown") { e.preventDefault(); if (items.length) { active = (active + 1) % items.length; render(); } }
    else if (e.key === "ArrowUp") { e.preventDefault(); if (items.length) { active = (active - 1 + items.length) % items.length; render(); } }
    else if (e.key === "Enter") { if (items.length && active >= 0) { e.preventDefault(); pick(active); } }
    else if (e.key === "Escape") close();
  });
  input.addEventListener("blur", () => setTimeout(close, 160));
  input.addEventListener("focus", () => { emit("search_focus"); if (items.length) render(); });
  return {
    input, list, status,
    get chosen() { return chosen; },
    pickFirst() { if (items.length) { pick(Math.max(0, active)); return true; } return false; },
    hint(t) { status.textContent = t; }
  };
}

/* ---------- The section ---------- */
class Race {
  constructor(root) {
    this.root = root;
    this.base = root.dataset.api || "/api/race";
    this.uid = root.id || "review-race";
    this.sessionToken = null;
    this.config = {};
    this.data = null;
    this.email = "";
    root.classList.add("rr");
    root.raceStart = (sel) => this.begin(sel);
    this.head = h("div", { class: "rr-head" },
      h("p", { class: "rr-eyebrow", text: COPY.section.eyebrow }),
      h("h2", { class: "rr-h2", text: COPY.section.h2 }),
      h("p", { class: "rr-lead", text: COPY.section.lead }));
    this.banner = h("p", { class: "rr-demo", hidden: true, text: COPY.demo });
    this.stage = h("div", { class: "rr-stage", "aria-live": "polite" });
    root.replaceChildren(h("div", { class: "rr-wrap" }, this.head, this.banner, this.stage));
    this.ready = getConfig(this.base).then((c) => { this.config = c || {}; if (this.config.demo) this.banner.hidden = false; return this.config; });
  }

  session() { if (!this.sessionToken) this.sessionToken = uuid(); return this.sessionToken; }

  async init() {
    await this.ready;
    const r = new URLSearchParams(location.search).get("r");
    if (r && /^[A-Za-z0-9_-]{16,64}$/.test(r)) return this.load(r);
    this.showSearch();
  }

  show(...kids) { this.stage.replaceChildren(...kids); }
  focus(el) { if (el) { el.setAttribute("tabindex", "-1"); el.focus({ preventScroll: false }); } }

  showSearch(message) {
    const box = searchBox({ base: this.base, session: () => this.session(), onPick: (sel) => this.begin(sel), idPrefix: `${this.uid}-search` });
    this.show(h("div", { class: "rr-card rr-search" },
      h("label", { class: "rr-label", for: box.input.id, text: COPY.search.label }),
      h("div", { class: "rr-combo" }, box.input, box.list),
      box.status,
      message ? h("p", { class: "rr-error", role: "alert", text: message }) : null,
      h("p", { class: "rr-attrib", text: COPY.search.attribution }),
      h("ul", { class: "rr-trust" }, COPY.section.trust.map((t) => h("li", { text: t })))));
  }

  chip(sel) {
    const where = sel.secondary || (this.data && this.data.search && this.data.search.where) || "";
    return h("div", { class: "rr-chip" },
      h("span", { class: "rr-chip-name", text: sel.main }),
      where ? h("span", { class: "rr-chip-where", text: where }) : null,
      h("button", { type: "button", class: "rr-link", onclick: () => { this.data = null; this.showSearch(); }, text: COPY.search.change }));
  }

  steps(list, title) {
    const items = list.map((t) => h("li", { text: t }));
    const box = h("div", { class: "rr-card rr-steps", role: "status" }, h("p", { class: "rr-steps-title", text: title }), h("ol", {}, items));
    let i = 0;
    items[0].classList.add("is-on");
    const timer = setInterval(() => {
      if (!box.isConnected) return clearInterval(timer);
      if (i < items.length - 1) { items[i].classList.replace("is-on", "is-done"); i += 1; items[i].classList.add("is-on"); }
    }, 2600);
    return box;
  }

  async humanToken() {
    const key = this.config && this.config.turnstileSiteKey;
    if (!key) return null;
    try { await loadTurnstile(); } catch { return null; }
    return new Promise((resolve) => {
      const box = h("div", { class: "rr-turnstile" });
      this.root.append(box);
      let wid = null;
      const done = (t) => {
        clearTimeout(timer);
        resolve(t || null);
        setTimeout(() => { try { window.turnstile.remove(wid); } catch { /* gone */ } box.remove(); }, 0);
      };
      const timer = setTimeout(() => done(null), 25000);
      wid = window.turnstile.render(box, { sitekey: key, appearance: "interaction-only", callback: done, "error-callback": () => done(null), "expired-callback": () => done(null) });
    });
  }

  async begin(sel) {
    this.sel = sel;
    this.sessionToken = null;
    this.data = null;
    emit("business_picked");
    this.show(this.chip(sel), this.steps(COPY.loading.steps, COPY.loading.title));
    try {
      await this.ready;
      const turnstile = await this.humanToken();
      const d = await api(this.base, "start", { method: "POST", body: { placeId: sel.id, main: sel.main, secondary: sel.secondary || "", turnstile, visit: visitId(), utm: utm(), page: location.href.split("#")[0].slice(0, 300) } });
      this.data = d;
      this.showPreview();
      emit("preview_shown", { rivals: (d.preview && d.preview.rivals || []).length });
      if (d.status !== "no-rivals" && !d.locked) this.loadReviews();
    } catch (e) {
      this.showError(e);
    }
  }

  async loadReviews() {
    try {
      const d = await api(this.base, "reviews", { method: "POST", body: { token: this.data.token } });
      if (this.data && d.token === this.data.token) { this.data.locked = d.locked; this.updateLocked(); }
    } catch { /* unlock reads them again if this failed */ }
  }

  async load(token) {
    this.show(this.steps(COPY.loading.steps, COPY.loading.title));
    try {
      const d = await api(this.base, "result", { params: { t: token } });
      this.data = d;
      this.sel = { main: d.business.name, secondary: d.search && d.search.where };
      if (d.unlocked) { this.showResults(); if (location.hash === "#book") setTimeout(() => { const b = this.root.querySelector(".rr-book"); if (b) b.scrollIntoView({ behavior: "smooth", block: "start" }); }, 300); return; }
      this.showPreview();
      if (!d.locked && d.status !== "no-rivals") this.loadReviews();
    } catch (e) {
      this.showSearch(e.message);
    }
  }

  /* ----- the free preview and the locked part ----- */
  showPreview() {
    const d = this.data, p = d.preview || {};
    const rows = [...(p.rivals || []).map((r) => ({ ...r, you: false })), { ...(p.owner || {}), you: true }]
      .sort((a, b) => (a.position ?? 999) - (b.position ?? 999));
    const title = h("h3", { class: "rr-h3", text: fill(COPY.preview.title, { query: p.query, where: p.where }) });
    const table = h("ol", { class: "rr-board" }, rows.map((r) => h("li", { class: `rr-board-row${r.you ? " is-you" : ""}` },
      h("span", { class: "rr-board-pos", text: r.position ? `#${r.position}` : "" }),
      h("span", { class: "rr-board-name" }, h("span", { text: r.name }), r.you ? h("span", { class: "rr-you", text: COPY.preview.you }) : null,
        r.you && !r.position ? h("span", { class: "rr-board-note", text: COPY.preview.notRanked }) : null),
      h("span", { class: "rr-board-rating" }, stars(r.rating)),
      h("span", { class: "rr-board-count", text: reviewsText(r.count) }))));
    const gapKind = (p.headline && p.headline.kind) || "unknown";
    const gap = h("p", { class: "rr-gap", text: fill(COPY.preview.gap[gapKind] || COPY.preview.gap.unknown, { avg: p.headline && fmtInt(p.headline.avg), n: p.headline && fmtInt(p.headline.n) }) });
    const note = h("p", { class: "rr-note", text: fill(COPY.preview.searchNote, { query: p.query, where: p.where, date: d.search && d.search.date }) });
    const preview = h("div", { class: "rr-card rr-preview" }, h("p", { class: "rr-kicker", text: COPY.preview.kicker }), title, table, gap, note);
    if (d.status === "no-rivals") {
      this.show(this.chip(this.sel), preview, this.laterForm({ code: "no-rivals" }, fill(COPY.preview.noRivals, { query: p.query, where: p.where })));
      return;
    }
    this.lockedDrafts = h("span", { text: COPY.locked.draftsWait });
    this.lockedUnanswered = h("span", { class: "rr-locked-sub" });
    const locked = h("div", { class: "rr-card rr-locked" },
      h("h3", { class: "rr-h3", text: COPY.locked.title }),
      h("p", { class: "rr-lead", text: COPY.locked.lead }),
      h("ul", { class: "rr-locked-list" },
        h("li", {}, h("span", { class: "rr-lock", "aria-hidden": "true" }), h("span", { class: "rr-locked-text" }, this.lockedDrafts, this.lockedUnanswered), h("span", { class: "rr-blur", "aria-hidden": "true" })),
        h("li", {}, h("span", { class: "rr-lock", "aria-hidden": "true" }), h("span", { class: "rr-locked-text", text: COPY.locked.race }), h("span", { class: "rr-blur rr-blur-bars", "aria-hidden": "true" })),
        h("li", {}, h("span", { class: "rr-lock", "aria-hidden": "true" }), h("span", { class: "rr-locked-text", text: COPY.locked.fixes }), h("span", { class: "rr-blur", "aria-hidden": "true" }))),
      this.unlockForm());
    this.show(this.chip(this.sel), preview, locked);
    this.updateLocked();
    this.focus(title);
  }

  updateLocked() {
    const l = this.data && this.data.locked;
    if (!l || !this.lockedDrafts) return;
    this.lockedDrafts.textContent = l.drafts === 0 ? COPY.locked.draftsNone : l.drafts === 1 ? COPY.locked.draftsOne : fill(COPY.locked.drafts, { n: l.drafts });
    this.lockedUnanswered.textContent = l.fetched ? ` ${fill(COPY.locked.unanswered, { n: l.unanswered, m: l.fetched })}` : "";
  }

  consentNotice() {
    return h("p", { class: "rr-notice" }, COPY.locked.noticeBefore,
      h("a", { href: this.config.termsUrl || "https://rempo.io/legal/terms", target: "_blank", rel: "noopener", text: COPY.locked.terms }),
      COPY.locked.noticeMiddle,
      h("a", { href: this.config.privacyUrl || "https://rempo.io/legal/privacy", target: "_blank", rel: "noopener", text: COPY.locked.privacy }),
      COPY.locked.noticeAfter);
  }

  field(id, label, attrs) {
    return h("div", { class: "rr-field" }, h("label", { for: id, class: "rr-label", text: label }), h("input", { id, class: "rr-input", ...attrs }));
  }

  unlockForm() {
    const id = (s) => `${this.uid}-${s}`;
    const err = h("p", { class: "rr-error", role: "alert" });
    const button = h("button", { type: "submit", class: "rr-btn", text: COPY.locked.button });
    const form = h("form", { class: "rr-form", novalidate: true },
      h("p", { class: "rr-form-title", text: COPY.locked.formTitle }),
      h("div", { class: "rr-row" },
        this.field(id("first"), COPY.locked.firstName, { name: "firstName", autocomplete: "given-name", maxlength: "60", required: true }),
        this.field(id("email"), COPY.locked.email, { name: "email", type: "email", autocomplete: "email", inputmode: "email", maxlength: "254", required: true })),
      h("input", { type: "text", name: "website", class: "rr-hp", tabindex: "-1", autocomplete: "off", "aria-hidden": "true" }),
      h("label", { class: "rr-check" }, h("input", { type: "checkbox", name: "consentEmail", required: true }), h("span", { text: COPY.locked.consentEmail })),
      this.consentNotice(),
      err,
      button);
    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      const f = new FormData(form);
      const firstName = String(f.get("firstName") || "").trim();
      const email = String(f.get("email") || "").trim();
      const consent = f.get("consentEmail") === "on";
      err.textContent = "";
      if (!firstName) { err.textContent = COPY.locked.errors.firstName; form.elements.firstName.focus(); return; }
      if (!/^[^\s@<>,]+@[^\s@<>,]+\.[^\s@<>,]+$/.test(email)) { err.textContent = COPY.locked.errors.email; form.elements.email.focus(); return; }
      if (!consent) { err.textContent = COPY.locked.errors.consent; form.elements.consentEmail.focus(); return; }
      this.email = email;
      button.disabled = true;
      emit("unlock_submitted");
      const progress = this.steps(COPY.analyzing.steps, COPY.analyzing.title);
      form.hidden = true;
      form.after(progress);
      try {
        const d = await api(this.base, "unlock", { method: "POST", body: { token: this.data.token, firstName, email, consentEmail: true, website: String(f.get("website") || "") } });
        this.data = d;
        try { const u = new URL(location.href); u.searchParams.set("r", d.token); history.replaceState(null, "", u.pathname + u.search + "#review-race"); } catch { /* no history */ }
        this.showResults();
        emit("results_shown", { fixes: (d.result && d.result.analysis.fixes || []).length, drafts: (d.result && d.result.analysis.drafts || []).length });
      } catch (ex) {
        progress.remove();
        form.hidden = false;
        button.disabled = false;
        err.textContent = ex.message;
      }
    });
    return form;
  }

  /* ----- errors, and the by-hand path ----- */
  showError(e) {
    if (e && (e.later || ["not-found", "daily-cap", "rate-limit", "quota", "serpapi", "not-configured"].includes(e.code))) {
      this.show(this.sel ? this.chip(this.sel) : null, this.laterForm(e, e.message));
      return;
    }
    this.show(this.sel ? this.chip(this.sel) : null, h("div", { class: "rr-card" },
      h("p", { class: "rr-error", role: "alert", text: (e && e.message) || COPY.errors.generic }),
      h("button", { type: "button", class: "rr-btn rr-btn-2", onclick: () => this.begin(this.sel), text: COPY.errors.retry })));
  }

  laterForm(e, message) {
    const id = (s) => `${this.uid}-later-${s}`;
    const err = h("p", { class: "rr-error", role: "alert" });
    const button = h("button", { type: "submit", class: "rr-btn", text: COPY.later.button });
    const form = h("form", { class: "rr-form", novalidate: true },
      h("div", { class: "rr-row" },
        this.field(id("first"), COPY.locked.firstName, { name: "firstName", autocomplete: "given-name", maxlength: "60", required: true }),
        this.field(id("email"), COPY.locked.email, { name: "email", type: "email", autocomplete: "email", inputmode: "email", maxlength: "254", required: true })),
      h("input", { type: "text", name: "website", class: "rr-hp", tabindex: "-1", autocomplete: "off", "aria-hidden": "true" }),
      h("label", { class: "rr-check" }, h("input", { type: "checkbox", name: "consentEmail", required: true }), h("span", { text: COPY.locked.consentEmail })),
      this.consentNotice(), err, button);
    const card = h("div", { class: "rr-card rr-later" }, message ? h("p", { class: "rr-error", text: message }) : null, h("h3", { class: "rr-h3", text: COPY.later.title }), h("p", { class: "rr-lead", text: COPY.later.lead }), form);
    form.addEventListener("submit", async (ev) => {
      ev.preventDefault();
      const f = new FormData(form);
      const firstName = String(f.get("firstName") || "").trim(), email = String(f.get("email") || "").trim();
      err.textContent = "";
      if (!firstName) { err.textContent = COPY.locked.errors.firstName; return; }
      if (!/^[^\s@<>,]+@[^\s@<>,]+\.[^\s@<>,]+$/.test(email)) { err.textContent = COPY.locked.errors.email; return; }
      if (f.get("consentEmail") !== "on") { err.textContent = COPY.locked.errors.consent; return; }
      button.disabled = true;
      try {
        await api(this.base, "later", { method: "POST", body: { firstName, email, consentEmail: true, main: this.sel && this.sel.main, secondary: this.sel && this.sel.secondary, reason: e && e.code, website: String(f.get("website") || "") } });
        card.replaceChildren(h("p", { class: "rr-done", role: "status", text: fill(COPY.later.done, { name: firstName }) }));
      } catch (ex) { button.disabled = false; err.textContent = ex.message; }
    });
    return card;
  }

  /* ----- the full race ----- */
  showResults() {
    const d = this.data, res = d.result, race = res.race, a = res.analysis || {}, R = COPY.results;
    const you = race.you, avg = race.average;
    const title = h("h3", { class: "rr-h3 rr-summary", text: a.summary || "" });
    const top = h("div", { class: "rr-card rr-result-top" }, h("p", { class: "rr-kicker", text: R.kicker }), title,
      this.email ? h("p", { class: "rr-note", text: fill(R.emailed, { email: this.email }) }) : null);

    // The race: reviews in the last 90 days, you against each rival
    const bars = [{ name: d.business.name, v: you.last90, capped: you.capped, you: true }, ...race.rivals.map((r) => ({ name: r.name, v: r.last90, capped: r.capped }))];
    const max = Math.max(1, ...bars.map((b) => b.v || 0));
    const chart = h("div", { class: "rr-card rr-race" }, h("h4", { class: "rr-h4", text: R.raceTitle }),
      h("ul", { class: "rr-bars" }, bars.map((b) => h("li", { class: b.you ? "is-you" : "" },
        h("span", { class: "rr-bar-name" }, h("span", { text: b.name }), b.you ? h("span", { class: "rr-you", text: COPY.preview.you }) : null),
        h("span", { class: "rr-bar-track", "aria-hidden": "true" }, h("span", { class: "rr-bar-fill", style: `width:${Math.max(3, Math.round(((b.v || 0) / max) * 100))}%` })),
        h("span", { class: "rr-bar-val", text: b.v === null || b.v === undefined ? "?" : `${b.v}${b.capped ? "+" : ""}` })))),
      you.pace12 !== null && avg.pace12 !== null ? h("p", { class: "rr-pace" },
        fill(R.paceYou, { a: `${you.capped ? `${R.atLeast} ` : ""}${you.pace12}` }), " ", fill(R.paceThem, { b: avg.pace12 })) : null);

    // The four areas, with the landing page's own names
    const status = (s) => h("span", { class: `rr-status is-${s}`, text: R.status[s] || R.status.unknown });
    const pair = (label, mine, theirs) => h("div", { class: "rr-pair" }, h("span", { class: "rr-pair-label", text: label }), h("span", { class: "rr-pair-you", text: mine }), h("span", { class: "rr-pair-them", text: `${R.topThree}: ${theirs}` }));
    const A = R.areas;
    const cushion = race.cushion ? (race.cushion.kind === "above" ? (race.cushion.k === 1 ? A.trust.cushionAboveOne : fill(A.trust.cushionAbove, { k: race.cushion.k })) : fill(A.trust.cushionBelow, { m: race.cushion.m })) : null;
    const areas = h("div", { class: "rr-areas" },
      h("div", { class: "rr-card rr-area" }, h("div", { class: "rr-area-head" }, h("h4", { class: "rr-h4", text: A.firstImpression.title }), status(race.areas.firstImpression)), h("p", { class: "rr-note", text: A.firstImpression.line }),
        pair(A.firstImpression.rating, fmtRating(you.rating) || "?", fmtRating(avg.rating) || "?"),
        pair(A.firstImpression.basics, you.basics === null ? "?" : fill(A.firstImpression.basicsValue, { n: you.basics }), avg.basics === null ? "?" : fill(A.firstImpression.basicsValue, { n: avg.basics }))),
      h("div", { class: "rr-card rr-area" }, h("div", { class: "rr-area-head" }, h("h4", { class: "rr-h4", text: A.trust.title }), status(race.areas.trust)), h("p", { class: "rr-note", text: A.trust.line }),
        pair(A.trust.count, fmtInt(you.count), fmtInt(avg.count)),
        cushion ? h("p", { class: "rr-cushion" }, cushion, " ", h("span", { class: "rr-muted", text: A.trust.cushionStat })) : null),
      h("div", { class: "rr-card rr-area" }, h("div", { class: "rr-area-head" }, h("h4", { class: "rr-h4", text: A.momentum.title }), status(race.areas.momentum)), h("p", { class: "rr-note", text: A.momentum.line }),
        pair(A.momentum.last90, you.last90 === null ? "?" : `${you.last90}${you.capped ? "+" : ""}`, avg.last90 === null ? "?" : String(avg.last90)),
        pair(A.momentum.newest, daysText(you.newestDays), daysText(avg.newestDays))),
      h("div", { class: "rr-card rr-area" }, h("div", { class: "rr-area-head" }, h("h4", { class: "rr-h4", text: A.care.title }), status(race.areas.care)), h("p", { class: "rr-note", text: A.care.line }),
        pair(A.care.replied, you.window ? fill(A.care.repliedValue, { r: you.replied, w: you.window }) : "?", avg.replyRate === null ? "?" : fill(A.care.theirValue, { s: Math.round(avg.replyRate * 30) }))));

    // What you're missing
    const fixes = (a.fixes || []).length ? h("div", { class: "rr-card rr-fixes" }, h("h4", { class: "rr-h4", text: R.fixesTitle }),
      h("ol", {}, a.fixes.map((f) => h("li", {}, h("p", { class: "rr-fix-title", text: f.title }), h("p", { text: f.why }), h("p", { class: "rr-fix-step" }, h("b", { text: R.firstStep }), " ", f.firstStep))))) : null;

    // The replies
    const drafts = (a.drafts || []).map((x) => ({ ...x, review: res.picks.find((p) => p.id === x.reviewId) || null }));
    const draftBox = h("div", { class: "rr-card rr-drafts" }, h("h4", { class: "rr-h4", text: drafts.length === 1 ? R.draftsTitleOne : drafts.length ? fill(R.draftsTitle, { n: drafts.length }) : R.draftsTitleNone }));
    if (drafts.length) {
      draftBox.append(h("p", { class: "rr-note", text: R.draftsLead }), ...drafts.map((x) => this.draftCard(x)));
    } else {
      draftBox.append(h("p", { class: "rr-note", text: a.fallback ? R.draftsUnavailable : you.unanswered === 0 ? R.draftsAllAnswered : R.draftsUnavailable }));
    }

    // What customers mention
    const mentions = (a.praise || []).length || (a.complaints || []).length ? h("div", { class: "rr-card rr-mentions" }, h("h4", { class: "rr-h4", text: R.mentionsTitle }),
      h("ul", { class: "rr-tags" }, (a.praise || []).map((p) => h("li", { class: "is-good", text: p })), (a.complaints || []).map((c) => h("li", { class: "is-bad", text: fill(R.complaint, { theme: c.theme, n: c.count }) })))) : null;

    // Rather hand it over? The booking
    const rest = Math.max(0, (you.unanswered || 0) - drafts.length);
    const book = h("div", { class: "rr-book", id: "book" });
    const next = h("div", { class: "rr-card rr-next" }, h("h4", { class: "rr-h4", text: R.nextTitle }),
      rest > 0 ? h("p", { class: "rr-gap", text: rest === 1 ? R.nextRestOne : fill(R.nextRest, { n: rest }) }) : null,
      h("p", { text: R.nextPitch }), book,
      h("p", {}, h("a", { class: "rr-link", href: this.config.siteUrl || "https://rempo.io", target: "_blank", rel: "noopener", text: R.how })));

    const foot = h("p", { class: "rr-note rr-foot", text: fill(R.footnote, { query: d.search.query, where: d.search.where, date: d.search.date }) });
    this.show(this.chip(this.sel || { main: d.business.name, secondary: d.search.where }), top, chart, h("h3", { class: "rr-h3 rr-section-title", text: R.areasTitle }), areas, fixes, draftBox, mentions, next, foot);
    this.mountBooking(book);
    this.focus(title);
  }

  draftCard(x) {
    const R = COPY.results, rv = x.review;
    const copyBtn = h("button", { type: "button", class: "rr-btn rr-btn-2 rr-copy", text: R.copy });
    copyBtn.addEventListener("click", async () => {
      try { await navigator.clipboard.writeText(x.reply); }
      catch {
        const t = h("textarea", { class: "rr-hp", "aria-hidden": "true" });
        t.value = x.reply; document.body.append(t); t.select();
        try { document.execCommand("copy"); } catch { /* nothing more to try */ }
        t.remove();
      }
      copyBtn.textContent = R.copied;
      setTimeout(() => { copyBtn.textContent = R.copy; }, 2000);
    });
    return h("article", { class: "rr-draft" },
      rv ? h("div", { class: "rr-review" },
        h("p", { class: "rr-review-meta" }, stars(rv.rating), " ", h("span", { text: `${rv.author || R.aCustomer}, ${daysText(rv.daysAgo)}` })),
        h("p", { class: "rr-review-text", text: rv.text ? `“${rv.text.length > 320 ? `${rv.text.slice(0, 320)}...` : rv.text}”` : R.noText })) : null,
      h("p", { class: "rr-reply", text: x.reply }),
      x.callFirst ? h("p", { class: "rr-callfirst", text: R.callFirst }) : null,
      h("div", { class: "rr-draft-actions" }, copyBtn, rv && rv.link ? h("a", { class: "rr-link", href: rv.link, target: "_blank", rel: "noopener", text: R.openGoogle }) : null));
  }

  /* ----- the calendar ----- */
  async mountBooking(box) {
    const B = COPY.booking, res = this.data.result;
    const tz = (() => { try { return Intl.DateTimeFormat().resolvedOptions().timeZone; } catch { return "America/Chicago"; } })();
    const fmtTime = (iso) => new Date(iso).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZone: tz });
    const fmtDay = (iso) => new Date(iso).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: tz });
    const fmtWhen = (iso) => new Date(iso).toLocaleString("en-US", { weekday: "long", month: "long", day: "numeric", hour: "numeric", minute: "2-digit", timeZone: tz, timeZoneName: "short" });
    const head = [h("h4", { class: "rr-h4", text: B.title }), h("p", { class: "rr-note", text: B.lead })];
    if (res.booked && res.booked.start) { box.replaceChildren(...head, h("p", { class: "rr-done", text: fill(B.bookedShort, { when: fmtWhen(res.booked.start) }) })); return; }
    const external = res.bookingUrl || this.config.bookingUrl;
    if (!res.calendar) {
      box.replaceChildren(...head, external ? h("a", { class: "rr-btn", href: external, target: "_blank", rel: "noopener", text: B.external }) : h("p", { text: B.noCalendar }));
      return;
    }
    box.replaceChildren(...head, h("p", { class: "rr-note", role: "status", text: B.loading }));
    let days = [];
    try { days = (await api(this.base, "slots", { params: { t: this.data.token, tz } })).days || []; } catch { days = []; }
    if (!days.length) {
      box.replaceChildren(...head, h("p", { text: B.none }), external ? h("a", { class: "rr-btn", href: external, target: "_blank", rel: "noopener", text: B.external }) : h("p", { text: B.noCalendar }));
      return;
    }
    const id = (s) => `${this.uid}-book-${s}`;
    let day = 0, slot = null;
    const dayRow = h("div", { class: "rr-days", role: "radiogroup", "aria-label": B.day });
    const slotRow = h("div", { class: "rr-slots", role: "radiogroup", "aria-label": B.time });
    const renderDays = () => dayRow.replaceChildren(...days.map((dd, i) => h("button", { type: "button", role: "radio", "aria-checked": i === day ? "true" : "false", class: `rr-day${i === day ? " is-on" : ""}`, onclick: () => { day = i; slot = null; renderDays(); renderSlots(); }, text: fmtDay(dd.slots[0]) })));
    const renderSlots = () => slotRow.replaceChildren(...days[day].slots.map((s) => h("button", { type: "button", role: "radio", "aria-checked": s === slot ? "true" : "false", class: `rr-slot${s === slot ? " is-on" : ""}`, onclick: () => { slot = s; renderSlots(); }, text: fmtTime(s) })));
    renderDays(); renderSlots();
    const err = h("p", { class: "rr-error", role: "alert" });
    const button = h("button", { type: "submit", class: "rr-btn", text: B.button });
    const form = h("form", { class: "rr-form", novalidate: true }, dayRow, slotRow,
      h("div", { class: "rr-field" }, h("label", { for: id("phone"), class: "rr-label", text: B.phone }), h("input", { id: id("phone"), class: "rr-input", name: "phone", type: "tel", inputmode: "tel", autocomplete: "tel-national", maxlength: "20", "aria-describedby": id("phone-hint") }), h("p", { class: "rr-note", id: id("phone-hint"), text: B.phoneHint })),
      h("label", { class: "rr-check" }, h("input", { type: "checkbox", name: "consentCall", required: true }), h("span", { text: B.consentCall })),
      h("label", { class: "rr-check" }, h("input", { type: "checkbox", name: "consentText" }), h("span", { text: B.consentText })),
      err, button);
    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      const f = new FormData(form);
      const digits = String(f.get("phone") || "").replace(/\D/g, "").replace(/^1(?=\d{10}$)/, "");
      err.textContent = "";
      if (!slot) { err.textContent = B.errors.slot; return; }
      if (digits.length !== 10) { err.textContent = B.errors.phone; form.elements.phone.focus(); return; }
      if (f.get("consentCall") !== "on") { err.textContent = B.errors.consent; return; }
      button.disabled = true;
      button.textContent = B.booking;
      try {
        const r = await api(this.base, "book", { method: "POST", body: { token: this.data.token, start: slot, phone: digits, consentCall: true, consentText: f.get("consentText") === "on", tz } });
        const when = fmtWhen(r.start || slot);
        const phone = `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`;
        box.replaceChildren(...head, h("p", { class: "rr-done", role: "status", text: fill(B.booked, { when, phone }) }), h("p", { text: B.expect }), this.icsLink(r.start || slot, phone));
        emit("booked");
      } catch (ex) {
        button.disabled = false;
        button.textContent = B.button;
        err.textContent = ex.message;
      }
    });
    box.replaceChildren(...head, form);
  }

  icsLink(start, phone) {
    const t = (d) => new Date(d).toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
    const end = new Date(Date.parse(start) + 15 * 60000).toISOString();
    const ics = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Rempo//Review Race//EN", "BEGIN:VEVENT", `UID:${this.data.token}@review-race`, `DTSTAMP:${t(Date.now())}`, `DTSTART:${t(start)}`, `DTEND:${t(end)}`, "SUMMARY:Rempo: 15-minute call about your review race", `DESCRIPTION:We'll call ${phone}.`, "END:VEVENT", "END:VCALENDAR"].join("\r\n");
    const href = URL.createObjectURL(new Blob([ics], { type: "text/calendar" }));
    return h("a", { class: "rr-link", href, download: "rempo-call.ics", text: COPY.booking.addToCalendar });
  }
}

/* ---------- The hero's business search ---------- */
function mountCta(el) {
  const base = el.dataset.api || "/api/race";
  const targetSel = el.dataset.target || "[data-review-race]";
  let session = null;
  const idPrefix = el.id || `rr-cta-${Math.random().toString(36).slice(2, 8)}`;
  const go = (sel) => {
    const target = document.querySelector(targetSel);
    session = null;
    if (target && target.raceStart) {
      target.scrollIntoView({ behavior: "smooth", block: "start" });
      target.raceStart(sel);
    }
  };
  const box = searchBox({ base, session: () => (session ||= uuid()), onPick: go, compact: true, idPrefix });
  const button = h("button", { type: "submit", class: "rr-btn", text: COPY.hero.button });
  const form = h("form", { class: "rr-cta-form", role: "search", novalidate: true },
    h("label", { class: "rr-label", for: box.input.id, text: COPY.hero.label }),
    h("div", { class: "rr-cta-row" }, h("div", { class: "rr-combo" }, box.input, box.list), button),
    box.status,
    h("p", { class: "rr-attrib", text: COPY.search.attribution }));
  form.addEventListener("submit", (e) => {
    e.preventDefault();
    if (box.chosen) return go(box.chosen);
    if (!box.pickFirst()) { box.hint(COPY.search.pick); box.input.focus(); }
  });
  el.classList.add("rr", "rr-cta");
  el.replaceChildren(form);
}

function boot() {
  document.querySelectorAll("[data-review-race]").forEach((el) => { if (!el.raceStart) new Race(el).init(); });
  document.querySelectorAll("[data-review-race-cta]").forEach((el) => { if (!el.classList.contains("rr-cta")) mountCta(el); });
}
if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot); else boot();
