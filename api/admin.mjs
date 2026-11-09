// /api/admin?action=...: the admin panel's API (the panel is /admin). Every action but session, login and health needs
// the admin's session cookie (ADMIN_PASSWORD), and every POST must come from this site's own pages.
//
//   GET  session     whether this browser is signed in, and what the deployment is set up for
//   POST login       { password }                      POST logout
//   POST upload      the browser's Vercel Blob client upload asks for a token here (files go straight to Blob)
//   PUT  upload-local?name=...   local development only: the file in the body, saved to PROOF_STORE_DIR
//   GET  items       every case study and video, drafts included, with their checks
//   POST save        { id?, kind: "case"|"video", data, publish?, force?, source? }
//   POST status      { id, status: "published"|"draft", force? }
//   POST delete      { id }                            POST reorder  { kind, ids: [...] }
//   POST settings    { autoPublish }                   POST preview  { kind, data }   (HTML)
//   GET  health      which settings this deployment sees (true or false, never a value)
import { randomUUID } from "node:crypto";
import { createWriteStream, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { pipeline } from "node:stream/promises";
import { isAdmin, login, logout, passwordConfigured, passwordStrong, sameOrigin } from "./_lib/proof/auth.mjs";
import { send, sendHtml, query, readJson, fail } from "./_lib/proof/http.mjs";
import { storeMode, loadContent, mutateContent, deleteFiles, privateOk, StoreError } from "./_lib/proof/store.mjs";
import { normalizeCase, normalizeVideo } from "./_lib/proof/model.mjs";
import { now, summary, runChecks, upsertItem } from "./_lib/proof/items.mjs";
import { sttConfigured } from "./_lib/proof/stt.mjs";
import { caseStudyPageHTML, videoCardHTML } from "../assets/proof-render.mjs";
import * as shell from "../assets/proof-shell.mjs";
import { SCHEMA_TYPES } from "./_lib/proof/prompts.mjs";

const UPLOAD_TYPES = [
  "video/*", "image/*", "application/pdf", "text/plain", "text/markdown", "text/html", "text/rtf", "application/rtf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document", "application/msword",
  "application/vnd.oasis.opendocument.text", "application/octet-stream"
];
const MAX_UPLOAD = 500 * 1024 * 1024;   // a function has 512 MB of disk to work in; a few minutes of phone video fit
const env = (n) => Boolean(process.env[n] && String(process.env[n]).trim());

export default async function handler(req, res) {
  const action = query(req).get("action") || "";
  try {
    if (action === "health") return send(res, 200, await health());
    if (action === "session") {
      const signedIn = isAdmin(req);
      // uploads go in private where the store takes private files (found out once, and only for a signed-in admin)
      const uploadAccess = signedIn && storeMode() === "blob" && !(await privateOk().catch(() => true)) ? "public" : "private";
      return send(res, 200, { authenticated: signedIn, uploadMode: storeMode(), uploadAccess, setup: setup() });
    }
    if (req.method === "POST" && !sameOrigin(req)) return send(res, 403, { error: "forbidden" });
    if (action === "login") {
      if (req.method !== "POST") return send(res, 405, { error: "method not allowed" });
      if (!passwordConfigured()) return send(res, 503, { error: "ADMIN_PASSWORD is not set on this deployment. Set it in Vercel (Settings > Environment Variables), then redeploy." });
      const body = await readJson(req, 4096);
      return (await login(req, res, String(body.password || ""))) ? send(res, 200, { ok: true }) : send(res, 401, { error: "That password is not right." });
    }
    if (action === "logout") { logout(req, res); return send(res, 200, { ok: true }); }
    if (!isAdmin(req)) return send(res, 401, { error: "Sign in first." });

    switch (action) {
      case "upload": return await uploadToken(req, res);
      case "upload-local": return await uploadLocal(req, res);
      case "items": return send(res, 200, await listItems());
      case "save": return send(res, 200, await save(await readJson(req)));
      case "status": return send(res, 200, await setStatus(await readJson(req)));
      case "delete": return send(res, 200, await remove(await readJson(req)));
      case "reorder": return send(res, 200, await reorder(await readJson(req)));
      case "settings": return send(res, 200, await settings(await readJson(req)));
      case "preview": return sendHtml(res, 200, await preview(await readJson(req)));
      default: return send(res, 404, { error: "unknown action" });
    }
  } catch (e) {
    return fail(res, e);
  }
}

function setup() {
  return {
    password: passwordConfigured(), passwordStrong: passwordStrong(),
    storage: storeMode(), anthropic: env("ANTHROPIC_API_KEY"), transcription: sttConfigured()
  };
}

async function health() {
  const s = setup();
  let storage = { mode: s.storage, ok: s.storage !== "none" };
  if (storage.ok) {
    try {
      const { seeded } = await loadContent();
      storage.seeded = seeded;
      storage.privateFiles = await privateOk();
    } catch (e) { storage = { ...storage, ok: false, problem: e.message }; }
  }
  const fixes = [];
  if (!s.password) fixes.push("Set ADMIN_PASSWORD (12 characters or more) in Vercel, then redeploy.");
  else if (!s.passwordStrong) fixes.push("ADMIN_PASSWORD is shorter than 12 characters: use a longer one.");
  if (s.storage === "none") fixes.push("Connect a Vercel Blob store to this project (Storage > Create > Blob), then redeploy: it adds BLOB_READ_WRITE_TOKEN.");
  else if (!storage.ok) fixes.push(`The Blob store can't be used: ${storage.problem}`);
  if (!s.anthropic) fixes.push("Set ANTHROPIC_API_KEY: Claude writes the case studies and cleans up the captions.");
  if (!s.transcription) fixes.push("Set OPENAI_API_KEY: OpenAI's Whisper transcribes the videos for the captions.");
  return { ready: s.password && s.storage !== "none" && s.anthropic && s.transcription, setup: s, storage, fixes };
}

/* ---------- Uploads ---------- */
const safeName = (n) => String(n || "file").normalize("NFKD").replace(/[^\w.\-]+/g, "-").replace(/^-+|-+$/g, "").slice(-120) || "file";

async function uploadToken(req, res) {
  if (storeMode() !== "blob") throw new StoreError("Uploads go to Vercel Blob: connect a Blob store to the project first.", 503, "not-configured");
  const { handleUpload } = await import("@vercel/blob/client");
  const body = await readJson(req, 64 * 1024);
  const result = await handleUpload({
    request: req,
    body,
    onBeforeGenerateToken: async (pathname) => {
      if (!/^proof\/uploads\/[\w-]+\/[\w.\-]+$/.test(pathname) || pathname.includes("..")) throw new StoreError("bad upload path", 400, "pathname");
      return { allowedContentTypes: UPLOAD_TYPES, maximumSizeInBytes: MAX_UPLOAD, addRandomSuffix: true, allowOverwrite: false };
    }
  });
  return send(res, 200, result);
}

// Local development: the browser PUTs the file here (in production it goes to Blob directly)
async function uploadLocal(req, res) {
  if (storeMode() !== "local") return send(res, 400, { error: "local uploads are for development only" });
  const pathname = `proof/uploads/${randomUUID()}/${safeName(query(req).get("name"))}`;
  const file = `${process.env.PROOF_STORE_DIR}/private/${pathname}`;
  mkdirSync(dirname(file), { recursive: true });
  await pipeline(req, createWriteStream(file));
  return send(res, 200, { pathname, url: `local:${pathname}` });
}

/* ---------- Items ---------- */
async function listItems() {
  const { content, seeded } = await loadContent();
  const order = (a, b) => (a.sort ?? 0) - (b.sort ?? 0);
  return { items: content.items.slice().sort(order).map(summary), settings: content.settings || { autoPublish: true }, seeded, mode: storeMode(), options: { icons: shell.INDUSTRY_ICONS, schemaTypes: SCHEMA_TYPES } };
}

async function save(body) {
  const { result } = await mutateContent((content) => summary(upsertItem(content, body)));
  return { item: result };
}

async function setStatus(body) {
  const { result } = await mutateContent((content) => {
    const item = content.items.find((i) => i.id === body.id);
    if (!item) throw new StoreError("That item no longer exists.", 404, "not-found");
    item.checks = runChecks(content, item);
    if (body.status === "published") {
      if (!item.checks.ok && body.force !== true) throw new StoreError("It does not pass its checks yet: fix them, or publish anyway.", 422, "checks");
      item.status = "published"; item.publishedAt = now();
    } else item.status = "draft";
    item.updatedAt = now();
    return summary(item);
  });
  return { item: result };
}

async function remove(body) {
  let gone = null;
  await mutateContent((content) => {
    const i = content.items.findIndex((x) => x.id === body.id);
    if (i < 0) throw new StoreError("That item no longer exists.", 404, "not-found");
    gone = content.items[i];
    content.items.splice(i, 1);
    // links from the other kind to it go too
    for (const x of content.items) {
      if (gone.kind === "video" && x.kind === "case" && x.data.testimonialId === gone.data.id) x.data.testimonialId = null;
      if (gone.kind === "case" && x.kind === "video" && x.data.caseStudy === gone.data.slug) x.data.caseStudy = null;
    }
  });
  const files = (gone && gone.source && gone.source.files) || {};
  await deleteFiles(files.public || [], { access: "public" });
  await deleteFiles(files.private || [], { access: "private" });
  return { ok: true };
}

async function reorder(body) {
  const ids = Array.isArray(body.ids) ? body.ids : [];
  await mutateContent((content) => {
    ids.forEach((id, n) => { const it = content.items.find((i) => i.id === id); if (it) it.sort = (n + 1) * 10; });
  });
  return { ok: true };
}

async function settings(body) {
  const { result } = await mutateContent((content) => {
    content.settings = { ...(content.settings || {}), ...(typeof body.autoPublish === "boolean" ? { autoPublish: body.autoPublish } : {}) };
    return content.settings;
  });
  return { settings: result };
}

async function preview(body) {
  const { content } = await loadContent();
  if (body.kind === "video") {
    const t = normalizeVideo(body.data);
    return `<!doctype html><html lang="en" class="js" data-theme="light"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/assets/site.css"><link rel="stylesheet" href="/assets/proof.css"></head><body class="cs-page" style="padding:24px;background:var(--c-grad-ink)">${shell.SPRITE}<div class="vt-sec" style="padding:0"><div class="vt-list" style="justify-content:center">${videoCardHTML(t)}</div></div><script src="/assets/proof.js" defer></script></body></html>`;
  }
  const cs = normalizeCase(body.data);
  const t = cs.testimonialId ? (content.items.find((i) => i.kind === "video" && i.data.id === cs.testimonialId) || {}).data || null : null;
  return caseStudyPageHTML(cs, { testimonial: t, shell, preview: true });
}
