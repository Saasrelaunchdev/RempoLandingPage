// Where the case studies and videos live. Vercel Blob in production (BLOB_READ_WRITE_TOKEN, added when a Blob store is
// connected to the project); a folder on disk for local development and tests (PROOF_STORE_DIR). Without either, the
// site shows the seed content and the admin can read but not save.
//
//   proof/content.json     private   every item, drafts included, with its checks and settings (one document, written
//                                    with the ETag it was read at, so two saves can never overwrite each other)
//   proof/published.json   public    what the site shows: the published items, in order (rebuilt on every save)
//   proof/uploads/...      private   what the admin dropped in (videos, documents, screenshots)
//   proof/media/<id>/...   public    what the pages use (the web video, poster, captions, screenshots)
import { createHash, randomUUID } from "node:crypto";
import { createWriteStream, existsSync, mkdirSync, readFileSync, writeFileSync, rmSync, statSync } from "node:fs";
import { dirname, join, normalize, sep } from "node:path";
import { pipeline } from "node:stream/promises";
import { Readable } from "node:stream";
import { seedContent } from "./seed.mjs";

const env = (n) => (process.env[n] ? String(process.env[n]).trim() : "");
export const CONTENT = "proof/content.json";
export const PUBLISHED = "proof/published.json";

export function storeMode() {
  if (env("PROOF_STORE_DIR")) return "local";
  if (env("BLOB_READ_WRITE_TOKEN") || (env("VERCEL_OIDC_TOKEN") && env("BLOB_STORE_ID"))) return "blob";
  return "none";
}

export class StoreError extends Error {
  constructor(message, status = 500, code = "store") { super(message); this.status = status; this.code = code; }
}
const notConfigured = () => new StoreError("Storage is not connected: connect a Vercel Blob store to the project (Storage > Blob), then redeploy.", 503, "not-configured");
export const sha = (s) => createHash("sha256").update(s).digest("hex");

/* ---------- The local store: the same contract, files on disk ---------- */
const localRoot = () => env("PROOF_STORE_DIR");
function localPath(access, pathname) {
  const p = normalize(join(localRoot(), access, pathname));
  if (!p.startsWith(normalize(join(localRoot(), access)) + sep)) throw new StoreError("bad pathname", 400, "pathname");
  return p;
}
const localUrl = (pathname) => `/__store/${pathname.split("/").map(encodeURIComponent).join("/")}`;
function localMeta(file) { try { return JSON.parse(readFileSync(file + ".meta.json", "utf8")); } catch { return {}; } }

/* ---------- Blob, loaded only when used ---------- */
let blobLib = null;
const blob = async () => (blobLib ||= await import("@vercel/blob"));
// tests stand in for Vercel Blob with an in-memory store
export const useBlobForTests = (lib) => { blobLib = lib; privateP = null; vault = null; memo = { at: 0, pub: null }; };

// Whether the store takes private files. A store that takes only public ones still works: what would be private (the
// content document, the uploads, the work files) is kept public under names nobody can guess and never linked from
// the site. Found once per instance with a small probe; PROOF_BLOB_PRIVATE=1 or 0 says so instead.
let privateP = null;
export function privateOk() {
  if (storeMode() !== "blob") return Promise.resolve(true);
  const forced = env("PROOF_BLOB_PRIVATE");
  if (forced === "0" || forced === "1") return Promise.resolve(forced === "1");
  return (privateP ||= (async () => {
    const { put } = await blob();
    let refused = null;
    const takes = (access) => put(`proof/probe-${access}.txt`, "ok", { access, contentType: "text/plain", addRandomSuffix: false, allowOverwrite: true })
      .then(() => true, (e) => { refused = e; return false; });
    const [priv, pub] = await Promise.all([takes("private"), takes("public")]);
    if (pub) {
      if (!priv) console.warn("This Blob store does not take private files; drafts and uploads are kept public under unguessable names:", refused && refused.message);
      return priv;
    }
    privateP = null;
    throw new StoreError(priv
      ? "This Blob store takes private files only, and the site's videos and pictures must be public: connect a Blob store with public access."
      : `The Blob store refused a test file: ${(refused && refused.message) || "unknown error"}`, 503, "store");
  })());
}
// The access a file really gets in this store (every private name but the content document's has a random part)
async function placed(pathname, access) {
  if (access !== "private" || storeMode() !== "blob" || (await privateOk())) return { pathname, access };
  return { pathname, access: "public" };
}

const randomName = (pathname) => {
  const i = pathname.lastIndexOf(".");
  const tag = createHash("sha1").update(String(Math.random()) + Date.now()).digest("hex").slice(0, 10);
  return i > pathname.lastIndexOf("/") ? `${pathname.slice(0, i)}-${tag}${pathname.slice(i)}` : `${pathname}-${tag}`;
};

// Write a file. Public files get a unique name (they are cached for a long time); pass { exact: true } to keep the name.
export async function putFile(pathname, body, { access = "public", contentType, exact = false, ifMatch, maxAge } = {}) {
  const mode = storeMode();
  if (mode === "none") throw notConfigured();
  const name = exact ? pathname : randomName(pathname);
  if (mode === "local") {
    const file = localPath(access, name);
    mkdirSync(dirname(file), { recursive: true });
    const cur = existsSync(file) ? localMeta(file).etag : null;
    if (ifMatch && cur && ifMatch !== cur) throw new StoreError("changed since it was read", 409, "precondition");
    const buf = Buffer.isBuffer(body) ? body : typeof body === "string" ? Buffer.from(body) : Buffer.from(await new Response(body).arrayBuffer());
    writeFileSync(file, buf);
    const etag = `"${sha(buf).slice(0, 32)}"`;
    writeFileSync(file + ".meta.json", JSON.stringify({ etag, contentType: contentType || "" }));
    return { pathname: name, url: access === "public" ? localUrl(name) : `local:${name}`, etag };
  }
  const { put, BlobPreconditionFailedError } = await blob();
  const at = await placed(name, access);
  try {
    const r = await put(at.pathname, body, {
      access: at.access, contentType, addRandomSuffix: false, allowOverwrite: exact,
      ...(ifMatch ? { ifMatch } : {}), ...(maxAge ? { cacheControlMaxAge: maxAge } : {}),
      multipart: Buffer.isBuffer(body) ? body.length > 8 * 1024 * 1024 : false
    });
    return { pathname: r.pathname, url: r.url, etag: r.etag };
  } catch (e) {
    if (BlobPreconditionFailedError && e instanceof BlobPreconditionFailedError) throw new StoreError("changed since it was read", 409, "precondition");
    throw e;
  }
}

// Read a file: { buffer, etag, contentType } or null. Always from origin, never a cached copy.
export async function getFile(pathname, { access = "private" } = {}) {
  const mode = storeMode();
  if (mode === "none") return null;
  if (mode === "local") {
    const file = localPath(access, pathname);
    if (!existsSync(file)) return null;
    const m = localMeta(file);
    return { buffer: readFileSync(file), etag: m.etag || null, contentType: m.contentType || "" };
  }
  const { get } = await blob();
  const at = await placed(pathname, access);
  const r = await get(at.pathname, { access: at.access, useCache: false });
  if (!r || r.statusCode !== 200) return null;
  return { buffer: Buffer.from(await new Response(r.stream).arrayBuffer()), etag: r.blob.etag, contentType: r.blob.contentType };
}

// Stream a stored file to a local path (big uploads go straight to /tmp)
export async function downloadTo(pathname, file, { access = "private" } = {}) {
  const mode = storeMode();
  if (mode === "none") throw notConfigured();
  mkdirSync(dirname(file), { recursive: true });
  if (mode === "local") {
    const src = localPath(access, pathname);
    if (!existsSync(src)) throw new StoreError("file not found", 404, "not-found");
    writeFileSync(file, readFileSync(src));
    return statSync(file).size;
  }
  const { get } = await blob();
  const at = await placed(pathname, access);
  const r = await get(at.pathname, { access: at.access, useCache: false });
  if (!r || r.statusCode !== 200) throw new StoreError("file not found", 404, "not-found");
  await pipeline(Readable.fromWeb(r.stream), createWriteStream(file));
  return statSync(file).size;
}

export async function deleteFiles(urlsOrPathnames, { access = "public" } = {}) {
  const list = urlsOrPathnames.filter((u) => typeof u === "string" && u && !u.startsWith("/media/"));
  if (!list.length) return;
  const mode = storeMode();
  if (mode === "local") {
    for (const u of list) {
      const pathname = u.startsWith("/__store/") ? decodeURIComponent(u.slice(9)) : u.startsWith("local:") ? u.slice(6) : u;
      for (const a of ["public", "private"]) { try { const f = localPath(a, pathname); rmSync(f, { force: true }); rmSync(f + ".meta.json", { force: true }); } catch { /* ignore */ } }
    }
    return;
  }
  if (mode === "blob") { const { del } = await blob(); await del(list).catch(() => {}); }
}

/* ---------- The content document ----------
   Where the store takes private files (and on disk): one private file, written with the ETag it was read at, so two
   saves never overwrite each other. Where it takes public files only: numbered versions in a folder nobody can guess,
   each written once. Public files are served through the edge, which may hold one for a while, so none is ever
   overwritten: a save creates the next number, and a save that finds its number taken reads again. */
const pad = (n) => String(n).padStart(6, "0");
const VERSION = /^proof\/content-[0-9a-f-]{36}\/(\d{6})\.json$/;
let vault = null;
async function vaultFolder() {
  if (vault) return vault;
  const { list } = await blob();
  const { blobs } = await list({ prefix: "proof/content-", limit: 1000 });
  const folders = [...new Set(blobs.map((b) => b.pathname).filter((x) => VERSION.test(x)).map((x) => x.replace(/\d{6}\.json$/, "")))].sort();
  return (vault = folders[0] || `proof/content-${randomUUID()}/`);
}
async function vaultVersions() {
  const folder = await vaultFolder();
  const { list } = await blob();
  const { blobs } = await list({ prefix: folder, limit: 1000 });
  return blobs.map((b) => ({ pathname: b.pathname, seq: Number((VERSION.exec(b.pathname) || [])[1] || 0) })).filter((v) => v.seq > 0).sort((a, b) => a.seq - b.seq);
}
const vaulted = async () => storeMode() === "blob" && !(await privateOk());

export async function loadContent() {
  if (await vaulted()) {
    const last = (await vaultVersions()).pop();
    if (!last) return { content: seedContent(), etag: "v0", seeded: true };
    const { get } = await blob();
    const r = await get(last.pathname, { access: "public" });
    if (!r || r.statusCode !== 200) throw new StoreError("The content could not be read just now. Try again in a moment.", 503, "busy");
    return { content: JSON.parse(Buffer.from(await new Response(r.stream).arrayBuffer()).toString("utf8")), etag: `v${last.seq}`, seeded: false };
  }
  const f = await getFile(CONTENT, { access: "private" });
  if (!f) return { content: seedContent(), etag: null, seeded: true };
  return { content: JSON.parse(f.buffer.toString("utf8")), etag: f.etag, seeded: false };
}

async function saveContent(content, etag) {
  const body = JSON.stringify(content);
  if (!(await vaulted())) return putFile(CONTENT, body, { access: "private", contentType: "application/json", exact: true, ...(etag ? { ifMatch: etag } : {}) });
  const seq = Number(String(etag || "v0").slice(1)) + 1;
  const folder = await vaultFolder();
  const { put, del } = await blob();
  try {
    await put(`${folder}${pad(seq)}.json`, body, { access: "public", contentType: "application/json", addRandomSuffix: false, allowOverwrite: false, cacheControlMaxAge: 31536000 });
  } catch (e) {
    if (/exist/i.test(String(e && e.message))) throw new StoreError("changed since it was read", 409, "precondition");
    throw e;
  }
  // keep the last five versions
  const old = (await vaultVersions().catch(() => [])).filter((v) => v.seq <= seq - 5).map((v) => v.pathname);
  if (old.length) await del(old).catch(() => {});
}

// Apply a change to the content and save it, as read; if someone saved in between, read again and apply the change
// again (up to three times). Rebuilds the public snapshot after each save.
export async function mutateContent(change) {
  if (storeMode() === "none") throw notConfigured();
  for (let attempt = 0; attempt < 3; attempt++) {
    if (attempt) await new Promise((r) => setTimeout(r, 300 * attempt));
    const { content, etag } = await loadContent();
    const result = await change(content);
    try {
      await saveContent(content, etag);
    } catch (e) {
      if (e instanceof StoreError && e.code === "precondition") continue;
      throw e;
    }
    await writePublished(content);
    return { content, result };
  }
  throw new StoreError("Another save happened at the same time three times in a row. Try again.", 409, "busy");
}

/* ---------- What the site shows ---------- */
let memo = { at: 0, pub: null };
export function buildPublished(content) {
  const order = (a, b) => (a.sort ?? 0) - (b.sort ?? 0) || String(a.createdAt).localeCompare(String(b.createdAt));
  const pub = (content.items || []).filter((i) => i.status === "published").sort(order);
  let cases = pub.filter((i) => i.kind === "case").map((i) => i.data);
  let testimonials = pub.filter((i) => i.kind === "video").map((i) => i.data);
  const tIds = new Set(testimonials.map((t) => t.id)), cSlugs = new Set(cases.map((c) => c.slug));
  cases = cases.map((c) => (c.testimonialId && !tIds.has(c.testimonialId) ? { ...c, testimonialId: null } : c));
  testimonials = testimonials.map((t) => (t.caseStudy && !cSlugs.has(t.caseStudy) ? { ...t, caseStudy: null } : t));
  const body = { cases, testimonials };
  return { v: 1, version: sha(JSON.stringify(body)).slice(0, 12), ...body };
}

async function writePublished(content) {
  const pub = buildPublished(content);
  await putFile(PUBLISHED, JSON.stringify(pub), { access: "public", contentType: "application/json", exact: true, maxAge: 60 });
  memo = { at: Date.now(), pub };
  return pub;
}

// The public snapshot, read from the store itself (the pages that use it are cached at the edge for a minute, so these
// reads stay few); the seed when nothing is stored yet or storage is not connected.
export async function loadPublished() {
  if (memo.pub && Date.now() - memo.at < 10000) return memo.pub;
  let pub = null;
  const mode = storeMode();
  try {
    if (mode === "local") { const f = await getFile(PUBLISHED, { access: "public" }); pub = f ? JSON.parse(f.buffer.toString("utf8")) : null; }
    else if (mode === "blob") {
      const { get } = await blob();
      const r = await get(PUBLISHED, { access: "public", useCache: false });
      if (r && r.statusCode === 200) pub = JSON.parse(Buffer.from(await new Response(r.stream).arrayBuffer()).toString("utf8"));
    }
  } catch (e) {
    console.error("published snapshot unreadable, using the seed:", e && e.message);
  }
  if (!pub) pub = buildPublished(seedContent());
  memo = { at: Date.now(), pub };
  return pub;
}
