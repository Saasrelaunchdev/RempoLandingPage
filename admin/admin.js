// The admin panel: sign in, drop a video or a document, watch it become a video testimonial or a case study (each
// step streamed from /api/admin-ingest), then edit, preview, publish, reorder or delete what is on the site.
const $ = (s, el = document) => el.querySelector(s);
const ESC = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ESC[c]);
const ic = (name) => `<svg class="ic" aria-hidden="true"><use href="#a-${name}"/></svg>`;
const html = (s) => { const t = document.createElement("template"); t.innerHTML = s.trim(); return t.content.firstElementChild; };

const VIDEO = /\.(mp4|mov|m4v|webm|mkv|avi|3gp|mpe?g)$/i;
const DOC = /\.(docx|odt|pdf|rtf|txt|text|md|markdown|html?|png|jpe?g|webp|gif)$/i;
const safeName = (n) => String(n || "file").normalize("NFKD").replace(/[^\w.\-]+/g, "-").replace(/^-+|-+$/g, "").slice(-120) || "file";

const state = { session: null, items: [], settings: { autoPublish: true }, seeded: false, kind: "case", editing: null, options: {} };

/* ---------- The API ---------- */
async function api(action, body) {
  const r = await fetch(`/api/admin?action=${action}`, body === undefined ? { credentials: "same-origin" } : { method: "POST", credentials: "same-origin", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const data = await r.json().catch(() => ({}));
  if (r.status === 401 && action !== "login") { location.reload(); throw new Error("Signed out"); }
  if (!r.ok) throw Object.assign(new Error(data.error || `Something went wrong (HTTP ${r.status}).`), { status: r.status, data });
  return data;
}

// The long work: one JSON object per line, as it happens; resolves with the last one ({ done, ... })
async function stream(action, body, onEvent) {
  const r = await fetch(`/api/admin-ingest?action=${action}`, { method: "POST", credentials: "same-origin", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  if (!r.ok || !r.body) { const d = await r.json().catch(() => ({})); throw new Error(d.error || `Something went wrong (HTTP ${r.status}).`); }
  const reader = r.body.getReader(), dec = new TextDecoder();
  let buf = "", last = null;
  for (;;) {
    const { value, done } = await reader.read();
    if (value) buf += dec.decode(value, { stream: true });
    let i;
    while ((i = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, i).trim(); buf = buf.slice(i + 1);
      if (!line) continue;
      let ev; try { ev = JSON.parse(line); } catch { continue; }
      if (ev.beat) continue;
      if ("done" in ev) last = ev; else onEvent(ev);
    }
    if (done) break;
  }
  if (!last) throw new Error("The connection closed before the work finished. It may still have been saved: the list below updates in a minute.");
  if (!last.done) throw new Error(last.error || "Something went wrong.");
  return last;
}

async function uploadFile(file, onProgress) {
  const pathname = `proof/uploads/${crypto.randomUUID()}/${safeName(file.name)}`;
  const mode = state.session.uploadMode;
  if (mode === "blob") {
    const { upload } = await import("/admin/vendor/blob-client.mjs");
    const blob = await upload(pathname, file, {
      access: state.session.uploadAccess || "private", handleUploadUrl: "/api/admin?action=upload", contentType: file.type || undefined,
      multipart: file.size > 20 * 1024 * 1024, onUploadProgress: (p) => onProgress(p.percentage / 100)
    });
    return { pathname: blob.pathname, name: file.name };
  }
  if (mode === "local") {
    return new Promise((resolve, reject) => {
      const x = new XMLHttpRequest();
      x.open("PUT", `/api/admin?action=upload-local&name=${encodeURIComponent(safeName(file.name))}`);
      x.upload.onprogress = (e) => e.lengthComputable && onProgress(e.loaded / e.total);
      x.onload = () => { try { const d = JSON.parse(x.responseText); x.status === 200 ? resolve({ pathname: d.pathname, name: file.name }) : reject(new Error(d.error || "Upload failed")); } catch { reject(new Error("Upload failed")); } };
      x.onerror = () => reject(new Error("Upload failed: check the connection."));
      x.send(file);
    });
  }
  throw new Error("Storage is not connected, so nothing can be uploaded yet. See “Finish setting up” above.");
}

/* ---------- Signing in ---------- */
async function boot() {
  try { state.session = await api("session"); }
  catch (e) { $("#boot").textContent = `The admin can't reach its API: ${e.message}`; return; }
  $("#boot").hidden = true;
  if (!state.session.authenticated) return showLogin();
  showApp();
}

function showLogin() {
  $("#login").hidden = false;
  const form = $("#login-form"), err = $("#login-error");
  if (!state.session.setup.password) {
    err.hidden = false;
    err.textContent = "ADMIN_PASSWORD is not set on this deployment. Set it in Vercel (Settings, Environment Variables), then redeploy.";
    form.querySelector("button").disabled = true;
  }
  form.password.focus();
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const btn = form.querySelector("button");
    btn.disabled = true; err.hidden = true;
    try { await api("login", { password: form.password.value }); location.reload(); }
    catch (x) { err.hidden = false; err.textContent = x.message; btn.disabled = false; form.password.select(); }
  });
}

async function showApp() {
  $("#app").hidden = false;
  $("#signout").hidden = false;
  $("#signout").addEventListener("click", async () => { await api("logout", {}).catch(() => {}); location.reload(); });
  wireAdding();
  wireList();
  wireEditor();
  loadHealth();
  await loadItems();
}

async function loadHealth() {
  try {
    const h = await api("health");
    if (h.ready && h.setup.passwordStrong) return;
    $("#setup-list").innerHTML = h.fixes.map((f) => `<li>${esc(f)}</li>`).join("");
    $("#setup").hidden = !h.fixes.length;
  } catch { /* the list still loads */ }
}

/* ---------- Adding ---------- */
function wireAdding() {
  const drop = $("#drop"), input = $("#file");
  ["dragenter", "dragover"].forEach((t) => drop.addEventListener(t, (e) => { e.preventDefault(); drop.classList.add("is-over"); }));
  ["dragleave", "drop"].forEach((t) => drop.addEventListener(t, () => drop.classList.remove("is-over")));
  drop.addEventListener("drop", (e) => { e.preventDefault(); route([...e.dataTransfer.files]); });
  input.addEventListener("change", () => { route([...input.files]); input.value = ""; });
  // dropping anywhere else on the page must not open the file in the tab
  window.addEventListener("dragover", (e) => e.preventDefault());
  window.addEventListener("drop", (e) => { if (!drop.contains(e.target)) e.preventDefault(); });
  $("#paste-go").addEventListener("click", () => {
    const text = $("#paste").value.trim();
    if (text.length < 40) { $("#paste").focus(); return; }
    runDocument([], text);
    $("#paste").value = "";
    $("#paste-box").open = false;
  });
  const auto = $("#auto");
  auto.addEventListener("change", async () => {
    try { const r = await api("settings", { autoPublish: auto.checked }); state.settings = r.settings; }
    catch (e) { auto.checked = !auto.checked; alert(e.message); }
  });
}

const MAX = 500 * 1024 * 1024;
function route(files) {
  if (!files.length) return;
  for (const f of files.filter((x) => x.size > MAX)) {
    makeJob(f.name, "video").fail(`It is ${Math.round(f.size / 1048576)} MB, and the most is 500 MB. Trim the video to the testimonial, or export it at 1080p, and drop it again.`);
  }
  files = files.filter((x) => x.size <= MAX);
  const videos = files.filter((f) => (f.type || "").startsWith("video/") || VIDEO.test(f.name));
  const docs = files.filter((f) => !videos.includes(f) && (DOC.test(f.name) || (f.type || "").startsWith("image/")));
  const other = files.filter((f) => !videos.includes(f) && !docs.includes(f));
  for (const f of other) {
    const why = /\.doc$/i.test(f.name) ? "It is an older Word file: open it in Word and save it as .docx." : /\.(pages|key|numbers)$/i.test(f.name) ? "Export it from Pages as Word (.docx) or PDF." : /\.hei[cf]$/i.test(f.name) ? "Export the photo as JPEG or PNG." : "Drop a video, a Word, PDF, text, Markdown, RTF, OpenDocument or HTML file, or a screenshot.";
    const job = makeJob(f.name, "doc");
    job.fail(`This file can't be used. ${why}`);
  }
  videos.forEach((v) => runVideo(v));
  if (docs.length) runDocument(docs, "");
}

// A card that shows one upload's progress
function makeJob(title, icon) {
  const el = html(`<article class="adm-card adm-job">
    <div class="adm-job-head">${ic(icon)}<b>${esc(title)}</b><span class="adm-pill is-working">Uploading</span></div>
    <div class="adm-bar" hidden><i></i></div>
    <ol class="adm-steps"></ol>
  </article>`);
  $("#jobs").prepend(el);
  const pill = $(".adm-pill", el), bar = $(".adm-bar", el);
  const job = {
    el,
    pill(kind, text) { pill.className = `adm-pill is-${kind}`; pill.textContent = text; },
    progress(f) { if (f == null) { bar.hidden = true; return; } bar.hidden = false; $("i", bar).style.width = `${Math.round(f * 100)}%`; },
    steps: stepList($(".adm-steps", el)),
    fail(msg) { job.progress(null); job.pill("failed", "Didn't work"); el.append(html(`<p class="adm-error">${esc(msg)}</p>`)); },
    sub(name) {
      const s = html(`<section class="adm-sub"><h3>${esc(name)}</h3><ol class="adm-steps"></ol></section>`);
      el.append(s);
      return { el: s, steps: stepList($(".adm-steps", s)), fail: (msg) => s.append(html(`<p class="adm-error">${esc(msg)}</p>`)) };
    }
  };
  return job;
}

function stepList(ol) {
  const rows = new Map();
  return (ev) => {
    let li = rows.get(ev.step);
    if (!li) { li = html(`<li><i></i><span></span></li>`); rows.set(ev.step, li); ol.append(li); }
    li.className = `is-${ev.state}`;
    $("i", li).innerHTML = ic({ done: "check", failed: "x", skipped: "skip" }[ev.state] || "check");
    $("span", li).textContent = ev.label;
    const old = $("small", li); if (old) old.remove();
    if (ev.detail) li.append(html(`<small>${esc(ev.detail)}</small>`));
  };
}

function resultHTML(item, notes = []) {
  const errs = item.checks.issues.filter((i) => i.level === "error");
  const status = item.status === "published" ? `<span class="adm-pill is-published">${ic("check")}Published</span>` : `<span class="adm-pill is-draft">Draft</span>`;
  const fix = errs.length ? `<span class="adm-pill is-fix">${errs.length} to fix</span>` : "";
  const open = item.status === "published" ? `<a class="adm-btn adm-btn-quiet adm-btn-sm" href="${esc(item.url)}" target="_blank" rel="noopener">${ic("ext")}Open</a>` : "";
  const list = [...notes, ...item.checks.issues.filter((i) => i.level === "warn").map((i) => i.message)];
  return `<div class="adm-result">${status}${fix}<b>${esc(item.title || "")}</b>${open}<button class="adm-btn adm-btn-quiet adm-btn-sm" type="button" data-edit="${esc(item.id)}">${ic("edit")}${errs.length ? "Fix and publish" : "Edit"}</button></div>${list.length ? `<ul class="adm-notes">${list.map((n) => `<li>${esc(n)}</li>`).join("")}</ul>` : ""}`;
}

async function runVideo(file) {
  const job = makeJob(file.name, "video");
  try {
    const up = await uploadFile(file, (f) => job.progress(f));
    job.progress(null);
    job.pill("working", "Working");
    const hints = { name: $("#h-name").value.trim(), role: $("#h-role").value.trim(), business: $("#h-business").value.trim() };
    const fin = await stream("video", { pathname: up.pathname, ...hints }, job.steps);
    job.pill(fin.item.status === "published" ? "published" : "draft", fin.item.status === "published" ? "Published" : "Saved as a draft");
    job.el.append(html(`<div>${resultHTML(fin.item, fin.notes)}</div>`));
  } catch (e) { job.fail(e.message); }
  loadItems();
}

async function runDocument(files, text) {
  const job = makeJob(files.length ? files.map((f) => f.name).join(", ") : "Pasted text", "doc");
  try {
    const ups = [];
    const total = files.reduce((n, f) => n + f.size, 0) || 1;
    let sent = 0;
    for (const f of files) {
      ups.push(await uploadFile(f, (p) => job.progress((sent + p * f.size) / total)));
      sent += f.size;
    }
    job.progress(null);
    job.pill("working", "Working");
    const plan = await stream("plan", { files: ups, text }, job.steps);
    if (plan.warnings && plan.warnings.length) job.el.append(html(`<ul class="adm-notes">${plan.warnings.map((w) => `<li>${esc(w)}</li>`).join("")}</ul>`));
    if (!plan.businesses.length) { job.fail(plan.notes || "No case study was found in it."); return; }
    let published = 0, drafts = 0;
    // two at a time: each is its own request with its own time
    const queue = plan.businesses.slice();
    const worker = async () => {
      for (let b; (b = queue.shift()); ) {
        const sub = job.sub(b.name);
        try {
          const fin = await stream("case", { job: plan.job, key: b.key }, sub.steps);
          fin.item.status === "published" ? published++ : drafts++;
          sub.el.append(html(`<div>${resultHTML(fin.item, fin.notes)}</div>`));
        } catch (e) { sub.fail(e.message); }
        loadItems();
      }
    };
    await Promise.all([worker(), worker()]);
    job.pill(published && !drafts ? "published" : drafts ? "draft" : "failed", [published && `${published} published`, drafts && `${drafts} draft${drafts > 1 ? "s" : ""}`].filter(Boolean).join(", ") || "Didn't work");
  } catch (e) { job.fail(e.message); }
}

/* ---------- The list ---------- */
async function loadItems() {
  try {
    const r = await api("items");
    state.items = r.items; state.settings = r.settings; state.seeded = r.seeded; state.options = r.options || {};
    $("#auto").checked = r.settings.autoPublish !== false;
    renderList();
  } catch (e) { $("#items-note").textContent = e.message; }
}

function renderList() {
  const mine = state.items.filter((i) => i.kind === state.kind);
  $("#n-case").textContent = state.items.filter((i) => i.kind === "case").length;
  $("#n-video").textContent = state.items.filter((i) => i.kind === "video").length;
  $("#items-note").textContent = mine.length ? "The site shows the published ones, in this order." : state.kind === "case" ? "No case studies yet: drop a document above." : "No videos yet: drop one above.";
  $("#list").innerHTML = mine.map((i, n) => {
    const errs = i.checks.issues.filter((x) => x.level === "error").length, warns = i.checks.issues.length - errs;
    const thumb = i.thumb ? `<img class="adm-thumb" src="${esc(i.thumb)}" alt="" loading="lazy">` : `<span class="adm-thumb" aria-hidden="true">${esc((i.subtitle || i.title || "?").charAt(0))}</span>`;
    const open = i.status === "published" ? `<a class="adm-btn adm-btn-quiet adm-btn-sm" href="${esc(i.url)}" target="_blank" rel="noopener">${ic("ext")}Open</a>` : "";
    return `<li class="adm-row" data-id="${esc(i.id)}">
      ${thumb}
      <div class="adm-row-main"><b>${esc(i.title || "(untitled)")}</b><span class="adm-muted">${esc(i.subtitle || "")}</span>
        <span class="adm-row-tags">${i.status === "published" ? `<span class="adm-pill is-published">${ic("check")}Published</span>` : `<span class="adm-pill is-draft">Draft</span>`}${errs ? `<span class="adm-pill is-fix">${errs} to fix</span>` : ""}${warns ? `<span class="adm-pill is-note">${warns} note${warns > 1 ? "s" : ""}</span>` : ""}</span></div>
      <div class="adm-row-act">
        <span class="adm-order"><button class="adm-icon" type="button" data-move="-1" aria-label="Move up"${n === 0 ? " disabled" : ""}>${ic("arrow-up")}</button><button class="adm-icon" type="button" data-move="1" aria-label="Move down"${n === mine.length - 1 ? " disabled" : ""}>${ic("arrow-down")}</button></span>
        ${open}
        <button class="adm-btn adm-btn-quiet adm-btn-sm" type="button" data-edit="${esc(i.id)}">${ic("edit")}Edit</button>
        <button class="adm-btn adm-btn-quiet adm-btn-sm" type="button" data-status="${i.status === "published" ? "draft" : "published"}">${i.status === "published" ? "Unpublish" : "Publish"}</button>
        <button class="adm-btn adm-btn-danger adm-btn-sm" type="button" data-delete aria-label="Delete">${ic("trash")}</button>
      </div>
    </li>`;
  }).join("");
}

function wireList() {
  document.querySelectorAll(".adm-tabs [role=tab]").forEach((t) => t.addEventListener("click", () => {
    state.kind = t.dataset.kind;
    document.querySelectorAll(".adm-tabs [role=tab]").forEach((x) => x.setAttribute("aria-selected", String(x === t)));
    renderList();
  }));
  // edit buttons live in the list and in the upload results
  document.addEventListener("click", (e) => { const b = e.target.closest("[data-edit]"); if (b) openEditor(b.dataset.edit); });
  $("#list").addEventListener("click", async (e) => {
    const row = e.target.closest(".adm-row"); if (!row) return;
    const item = state.items.find((i) => i.id === row.dataset.id); if (!item) return;
    const b = e.target.closest("button"); if (!b) return;
    try {
      if (b.dataset.move) {
        const ids = state.items.filter((i) => i.kind === item.kind).map((i) => i.id);
        const at = ids.indexOf(item.id), to = at + Number(b.dataset.move);
        if (to < 0 || to >= ids.length) return;
        [ids[at], ids[to]] = [ids[to], ids[at]];
        b.disabled = true;
        await api("reorder", { kind: item.kind, ids });
      } else if (b.dataset.status) {
        b.disabled = true;
        try { await api("status", { id: item.id, status: b.dataset.status }); }
        catch (x) {
          if (x.status !== 422) throw x;
          const errs = item.checks.issues.filter((i) => i.level === "error").map((i) => `• ${i.message}`).join("\n");
          if (!confirm(`It doesn't pass its checks yet:\n${errs}\n\nPublish it anyway?`)) return;
          await api("status", { id: item.id, status: "published", force: true });
        }
      } else if ("delete" in b.dataset) {
        if (!confirm(`Delete “${item.title}”? ${item.kind === "case" ? "Its page" : "The video"} and its files go too. This can't be undone.`)) return;
        await api("delete", { id: item.id });
      }
    } catch (x) { alert(x.message); }
    finally { b.disabled = false; loadItems(); }
  });
}

/* ---------- The editor ---------- */
const LABELS = {
  "business": "The business", "business.name": "Name, as listed", "business.short": "Short name", "business.nick": "Name in a sentence", "business.industry": "Industry",
  "business.icon": "Icon", "business.owner": "Owner", "business.region": "State", "business.regionCode": "State code", "business.area": "Area, with its preposition (“in Austin”)",
  "business.areaServed": "Places it serves", "business.schemaType": "Schema.org type",
  "card": "The card on the landing page", "card.tag": "Tag (the time frame)", "card.line": "Line", "card.stats": "Two numbers",
  "hero": "The top of the page", "hero.h1": "Headline (also the card's title)", "hero.lead": "Lead", "hero.facts": "Three numbers",
  "gbp": "The Google profile card", "gbp.rating": "Rating", "gbp.count": "Review count now", "gbp.was": "Review count before", "gbp.kind": "Category", "gbp.photo": "Photo",
  "numbers": "The review stack (3D)", "numbers.before": "Reviews before Rempo", "numbers.after": "Reviews after", "numbers.gained": "New reviews from Rempo",
  "numbers.pill": "Label on the new reviews", "numbers.beforeCaption": "Caption before", "numbers.afterCaption": "Caption after",
  "sceneLabel": "The review stack, for screen readers", "glance": "At a glance", "glance[].dt": "Label", "glance[].dd": "Value",
  "chapters": "The story", "chapters.before": "1. Before Rempo", "chapters.did": "2. What Rempo did", "chapters.result": "3. The result",
  "chapters.before.miss": "The before list", "chapters.before.miss.items": "Lines", "chapters.before.miss.items[].miss": "This line is what was missing",
  "chapters.before.miss.big": "Number", "chapters.before.miss.small": "What it counts", "chapters.did.steps": "Steps", "chapters.did.steps[].h": "Step", "chapters.did.steps[].p": "Text",
  "chapters.result.proof": "Before and after screenshots", "chapters.result.proof.tabs": "Tab names", "chapters.result.proof.imgs": "Screenshots",
  "chapters.result.proof.imgs[].alt": "What it shows (for screen readers)", "chapters.result.proof.ring": "Ring around the review count (% of the picture)",
  "chapters.result.proof.ar": "Aspect ratio", "chapters.result.proof.cap": "Caption", "chapters.result.stat": "The number shown (no screenshots)",
  "payoff": "Closing line", "payoff.lead": "First part", "payoff.accent": "Second part", "note": "Where the numbers come from",
  "seo": "Search and sharing", "seo.title": "Page title", "seo.ogTitle": "Title when shared", "slug": "Web address: /case-studies/…/",
  "intro": "Intro on the site", "quote": "Quote on the card (word for word)", "quoteLong": "Longer quote (word for word)", "title": "Title, for search", "summary": "Summary, for search",
  "caseStudy": "Case study", "testimonialId": "Owner's video", "src": "Video", "vtt": "Captions (WebVTT)", "srt": "Captions (SRT)", "poster": "Cover picture", "avatar": "Face picture", "duration": "Length (seconds)", "uploadDate": "Upload date"
};
const KEY_LABELS = { big: "Number", label: "Label", text: "Line", h2: "Heading", lead: "Lead", paras: "Paragraphs", bold: "Bold part", rest: "The rest", alt: "Description", src: "File", w: "Width", h: "Height", x: "Left", y: "Top", name: "Name", role: "Role", location: "Location", city: "City", country: "Country", description: "Description", transcript: "Transcript" };
const LONG = /(^|\.)(lead|line|intro|quote|quoteLong|summary|note|description|transcript|sceneLabel|p|alt|rest|text|paras\[\])$/;
const HIDE = new Set(["scene", "card.title", "id", "lang", "srcWebm"]);
const FILES = /(^|\.)(src|poster|avatar|photo|vtt|srt)$/;
const norm = (path) => path.replace(/\[\d+\]/g, "[]");
const human = (k) => String(k).replace(/([A-Z])/g, " $1").replace(/^./, (c) => c.toUpperCase());
const labelOf = (path, key) => LABELS[norm(path)] || KEY_LABELS[key] || human(key);

function getAt(obj, path) { return path.split(/\.|\[(\d+)\]/).filter((p) => p !== undefined && p !== "").reduce((o, k) => (o == null ? o : o[k]), obj); }
function setAt(obj, path, value) {
  const keys = path.split(/\.|\[(\d+)\]/).filter((p) => p !== undefined && p !== "");
  let o = obj;
  keys.slice(0, -1).forEach((k) => { o = o[k]; });
  o[keys[keys.length - 1]] = value;
}

function fieldHTML(path, key, value, bad) {
  const id = `f-${path.replace(/[^\w]/g, "_")}`;
  const cls = `adm-field${bad.has(path) ? " is-bad" : ""}`;
  const label = `<span>${esc(labelOf(path, key))}</span>`;
  const pick = { "business.icon": state.options.icons, "business.schemaType": state.options.schemaTypes }[path];
  if (pick && pick.length) return `<label class="${cls}">${label}<select id="${id}" data-path="${esc(path)}">${pick.map((o) => `<option${o === value ? " selected" : ""}>${esc(o)}</option>`).join("")}</select></label>`;
  if (path === "testimonialId" || path === "caseStudy") {
    const opts = path === "testimonialId"
      ? state.items.filter((i) => i.kind === "video").map((i) => [i.data.id, i.data.name])
      : state.items.filter((i) => i.kind === "case").map((i) => [i.data.slug, i.data.business.short || i.data.business.name]);
    return `<label class="${cls}">${label}<select id="${id}" data-path="${esc(path)}" data-type="nullable"><option value="">None</option>${opts.map(([v, t]) => `<option value="${esc(v)}"${v === value ? " selected" : ""}>${esc(t)}</option>`).join("")}</select></label>`;
  }
  if (typeof value === "boolean") return `<label class="adm-switch"><input type="checkbox" id="${id}" data-path="${esc(path)}" data-type="bool"${value ? " checked" : ""}><span class="adm-switch-ui" aria-hidden="true"></span><span>${esc(labelOf(path, key))}</span></label>`;
  if (typeof value === "number" || (value === null && /^numbers\./.test(path))) return `<label class="${cls}">${label}<input type="number" id="${id}" data-path="${esc(path)}" data-type="number" value="${value ?? ""}"></label>`;
  const v = String(value ?? "");
  const file = FILES.test(path) && v ? `<span class="adm-file">${/\.(webp|png|jpe?g)/i.test(v) ? `<img src="${esc(v)}" alt="">` : ""}<a href="${esc(v)}" target="_blank" rel="noopener">Open the file</a></span>` : "";
  if (LONG.test(norm(path)) || v.length > 90) return `<label class="${cls}">${label}<textarea id="${id}" data-path="${esc(path)}" rows="${Math.min(10, Math.max(2, Math.ceil(v.length / 70)))}">${esc(v)}</textarea>${file}</label>`;
  return `<label class="${cls}">${label}<input id="${id}" data-path="${esc(path)}" value="${esc(v)}">${file}</label>`;
}

function formHTML(value, path, bad) {
  if (Array.isArray(value)) {
    if (value.every((v) => typeof v === "string")) {
      const rows = value.map((v, i) => fieldHTML(`${path}[${i}]`, String(i + 1), v, bad)).join("");
      return `<fieldset class="adm-fs"><legend>${esc(labelOf(path, path.split(".").pop()))}</legend>${rows}<span><button class="adm-btn adm-btn-quiet adm-btn-sm" type="button" data-add="${esc(path)}">Add one</button>${value.length ? ` <button class="adm-btn adm-btn-quiet adm-btn-sm" type="button" data-remove="${esc(path)}">Remove the last</button>` : ""}</span></fieldset>`;
    }
    return `<fieldset class="adm-fs"><legend>${esc(labelOf(path, path.split(".").pop()))}</legend>${value.map((v, i) => formHTML(v, `${path}[${i}]`, bad)).join("")}</fieldset>`;
  }
  if (value && typeof value === "object") {
    const keys = Object.keys(value).filter((k) => !HIDE.has(path ? `${path}.${k}` : k));
    const inner = keys.map((k) => formHTML(value[k], path ? `${path}.${k}` : k, bad)).join("");
    if (!path) return inner;
    const flat = keys.every((k) => value[k] === null || typeof value[k] !== "object");
    const legend = /\[\d+\]$/.test(path) ? "" : `<legend>${esc(labelOf(path, path.split(".").pop()))}</legend>`;
    return `<fieldset class="adm-fs">${legend}${flat && keys.length <= 4 && keys.every((k) => typeof value[k] !== "string" || value[k].length < 60) ? `<div class="adm-fs-row">${inner}</div>` : inner}</fieldset>`;
  }
  const key = path.split(/\.|\[/).pop().replace("]", "");
  return fieldHTML(path, key, value, bad);
}

const ORDER = ["slug", "business", "hero", "card", "gbp", "numbers", "sceneLabel", "glance", "chapters", "payoff", "note", "seo", "testimonialId",
  "name", "role", "business", "location", "caseStudy", "intro", "quote", "quoteLong", "title", "summary", "transcript", "src", "poster", "avatar", "vtt", "srt", "duration", "uploadDate"];
const ordered = (data) => Object.fromEntries(Object.keys(data).sort((a, b) => ((ORDER.indexOf(a) + 1) || 99) - ((ORDER.indexOf(b) + 1) || 99)).map((k) => [k, data[k]]));

function renderEditor() {
  const ed = state.editing;
  const bad = new Set(ed.checks.issues.filter((i) => i.level === "error").map((i) => i.field));
  $("#ed-kind").textContent = `${ed.kind === "case" ? "Case study" : "Video testimonial"} · ${ed.status === "published" ? "Published" : "Draft"}`;
  $("#ed-h").textContent = ed.kind === "case" ? ed.data.hero && ed.data.hero.h1 : ed.data.name;
  $("#ed-issues").innerHTML = ed.checks.issues.length ? `<ul class="adm-issues">${ed.checks.issues.map((i) => `<li class="is-${i.level}">${ic(i.level === "error" ? "x" : "warn")}<span>${esc(i.message)} <code>${esc(i.field)}</code></span></li>`).join("")}</ul>` : "";
  const notes = [...(ed.notes || []), ...((ed.numbersFromPictures || []).length ? [`Numbers read off the screenshots: ${ed.numbersFromPictures.map((n) => `${n.number} (${n.where})`).join("; ")}.`] : [])];
  $("#ed-notes").innerHTML = notes.length ? `<ul class="adm-notes">${notes.map((n) => `<li>${esc(n)}</li>`).join("")}</ul>` : "";
  $("#ed-fields").innerHTML = formHTML(ordered(ed.data), "", bad);
  $("#ed-json").value = JSON.stringify(ed.data, null, 2);
  $("#ed-force").hidden = ed.checks.ok;
  $("#ed-error").hidden = true;
}

function openEditor(id) {
  const item = state.items.find((i) => i.id === id);
  if (!item) return;
  state.editing = { id: item.id, kind: item.kind, status: item.status, data: structuredClone(item.data), checks: item.checks, notes: item.notes, numbersFromPictures: item.numbersFromPictures };
  renderEditor();
  $("#editor").showModal();
  refreshPreview();
}

let previewTimer = 0;
async function refreshPreview() {
  const ed = state.editing; if (!ed) return;
  try {
    const r = await fetch("/api/admin?action=preview", { method: "POST", credentials: "same-origin", headers: { "content-type": "application/json" }, body: JSON.stringify({ kind: ed.kind, data: ed.data }) });
    $("#ed-frame").srcdoc = r.ok ? await r.text() : `<p style="font:16px system-ui;padding:20px">The preview can't show this yet (HTTP ${r.status}).</p>`;
  } catch { /* keep the last preview */ }
}

function wireEditor() {
  const fields = $("#ed-fields");
  fields.addEventListener("input", (e) => {
    const el = e.target.closest("[data-path]"); if (!el) return;
    const t = el.dataset.type;
    const v = t === "bool" ? el.checked : t === "number" ? (el.value === "" ? null : Number(el.value)) : t === "nullable" ? (el.value || null) : el.value;
    setAt(state.editing.data, el.dataset.path, v);
    $("#ed-json").value = JSON.stringify(state.editing.data, null, 2);
    clearTimeout(previewTimer); previewTimer = setTimeout(refreshPreview, 700);
  });
  fields.addEventListener("change", (e) => { if (e.target.matches("select,[type=checkbox]")) e.target.dispatchEvent(new Event("input", { bubbles: true })); });
  fields.addEventListener("click", (e) => {
    const add = e.target.closest("[data-add]"), rem = e.target.closest("[data-remove]");
    if (!add && !rem) return;
    const path = (add || rem).dataset.add || (add || rem).dataset.remove;
    const arr = getAt(state.editing.data, path);
    if (add) arr.push(""); else arr.pop();
    renderEditor();
  });
  $("#ed-json-apply").addEventListener("click", () => {
    try { state.editing.data = JSON.parse($("#ed-json").value); renderEditor(); refreshPreview(); }
    catch (x) { alert(`That JSON doesn't read: ${x.message}`); }
  });
  $("#ed-refresh").addEventListener("click", refreshPreview);
  const save = async (publish, force = false) => {
    const ed = state.editing;
    const err = $("#ed-error");
    err.hidden = true;
    if (ed.kind === "case" && ed.data.card && ed.data.hero) ed.data.card.title = ed.data.hero.h1;
    document.querySelectorAll(".adm-ed-foot button").forEach((b) => { b.disabled = true; });
    try {
      const r = await api("save", { id: ed.id, kind: ed.kind, data: ed.data, publish, force });
      Object.assign(ed, { status: r.item.status, checks: r.item.checks, data: structuredClone(r.item.data) });
      await loadItems();
      if (publish && r.item.status !== "published") {
        renderEditor();
        err.hidden = false;
        err.textContent = "Saved as a draft: it doesn't pass its checks yet. Fix what is listed, or publish it anyway.";
      } else $("#editor").close();
    } catch (x) { err.hidden = false; err.textContent = x.message; }
    finally { document.querySelectorAll(".adm-ed-foot button").forEach((b) => { b.disabled = false; }); }
  };
  $("#ed-draft").addEventListener("click", () => save(false));
  $("#ed-publish").addEventListener("click", () => save(true));
  $("#ed-force").addEventListener("click", () => { if (confirm("Publish it with the problems listed at the top?")) save(true, true); });
  $("#editor").addEventListener("close", () => { state.editing = null; $("#ed-frame").srcdoc = ""; });
}

/* ---------- Theme ---------- */
$("#theme").addEventListener("click", () => {
  const d = document.documentElement, t = d.dataset.theme === "dark" ? "light" : "dark";
  d.dataset.theme = t;
  try { localStorage.setItem("lp-theme", t); } catch { /* private window */ }
});

boot();
