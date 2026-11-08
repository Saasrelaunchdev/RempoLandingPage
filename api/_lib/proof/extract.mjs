// What a dropped document says: its text in reading order, with a marker where each picture sat, and the pictures
// themselves. Word (.docx), OpenDocument (.odt), PDF, RTF, plain text, Markdown and HTML; loose screenshots too. An old
// binary Word file (.doc) or a Pages file is turned away with how to save it in a readable format.
import mammoth from "mammoth";
import JSZip from "jszip";
import { rawToImage } from "./media.mjs";

export const DOC_EXTS = ["docx", "odt", "pdf", "rtf", "txt", "text", "md", "markdown", "html", "htm"];
export const IMAGE_EXTS = ["png", "jpg", "jpeg", "webp", "gif", "bmp", "tif", "tiff", "avif"];
export const VIDEO_EXTS = ["mp4", "mov", "m4v", "webm", "mkv", "avi", "3gp", "mpg", "mpeg"];
export const extOf = (name) => (String(name || "").toLowerCase().match(/\.([a-z0-9]+)$/) || [])[1] || "";

const unreadable = (message) => Object.assign(new Error(message), { status: 422, code: "unreadable" });
// Pictures are marked in the text as \u0000IMG<k>\u0000 (k counts within the file); readUploads numbers them [image N]
const mark = (k) => `\u0000IMG${k}\u0000`;
const IMAGE_TYPES = { png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", webp: "image/webp", gif: "image/gif", bmp: "image/bmp", tif: "image/tiff", tiff: "image/tiff", avif: "image/avif", emf: "image/emf", wmf: "image/wmf", svg: "image/svg+xml" };

/* ---------- Text from markup ---------- */
const ENT = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", rsquo: "’", lsquo: "‘", rdquo: "”", ldquo: "“", mdash: "—", ndash: "–", hellip: "…", bull: "•", middot: "·", copy: "©", reg: "®", trade: "™", eacute: "é", egrave: "è", aacute: "á", ntilde: "ñ", oacute: "ó", uacute: "ú", iacute: "í", uuml: "ü", ouml: "ö", auml: "ä", ccedil: "ç" };
export function decodeEntities(s) {
  return String(s).replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e) => {
    if (e[0] === "#") {
      const cp = e[1].toLowerCase() === "x" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(cp) && cp > 0 && cp < 0x110000 ? String.fromCodePoint(cp) : m;
    }
    return ENT[e.toLowerCase()] ?? m;
  });
}
const tidy = (s) => String(s).replace(/\r\n?/g, "\n").replace(/[ \t ]+/g, " ").replace(/ *\n */g, "\n").replace(/\n{3,}/g, "\n\n").trim();

export function htmlToText(html) {
  const s = String(html)
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<(script|style|head|noscript|template|svg)\b[\s\S]*?<\/\1>/gi, "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<li\b[^>]*>/gi, "\n- ")
    .replace(/<\/(p|div|h[1-6]|li|tr|table|ul|ol|blockquote|section|article|header|footer|figure|figcaption|pre)>/gi, "\n\n")
    .replace(/<(td|th)\b[^>]*>/gi, " ")
    .replace(/<[^>]+>/g, "");
  return tidy(decodeEntities(s));
}

// <img src="data:image/png;base64,..."> and <img src="rempo-img:K"> become markers; the data ones join `images`
function htmlImages(html, images) {
  return String(html).replace(/<img\b[^>]*?\bsrc\s*=\s*["']([^"']+)["'][^>]*>/gi, (m, src) => {
    const own = /^rempo-img:(\d+)$/.exec(src);
    if (own) return `\n${mark(Number(own[1]))}\n`;
    const data = /^data:(image\/[\w.+-]+);base64,([\s\S]+)$/i.exec(src);
    if (!data) return "";
    images.push({ buffer: Buffer.from(data[2].replace(/\s+/g, ""), "base64"), type: data[1].toLowerCase() });
    return `\n${mark(images.length - 1)}\n`;
  });
}

/* ---------- Each format ---------- */
async function fromDocx(buffer) {
  const images = [];
  const { value } = await mammoth.convertToHtml({ buffer }, {
    convertImage: mammoth.images.imgElement(async (img) => {
      images.push({ buffer: Buffer.from(await img.read()), type: img.contentType || "" });
      return { src: `rempo-img:${images.length - 1}` };
    })
  });
  return { text: htmlToText(htmlImages(value, images)), images };
}

async function fromOdt(buffer) {
  const zip = await JSZip.loadAsync(buffer);
  const xml = zip.file("content.xml") && (await zip.file("content.xml").async("string"));
  if (!xml) throw unreadable("That OpenDocument file has no text in it.");
  const hrefs = [];
  const body = xml
    .replace(/<office:automatic-styles[\s\S]*?<\/office:automatic-styles>/g, "")
    .replace(/<draw:image\b[^>]*?xlink:href="([^"]+)"[^>]*\/?>/g, (m, href) => { hrefs.push(href); return mark(hrefs.length - 1); })
    .replace(/<text:s(?:\s+text:c="(\d+)")?\s*\/>/g, (m, c) => " ".repeat(Math.min(40, Number(c || 1))))
    .replace(/<text:tab\s*\/>/g, "\t").replace(/<text:line-break\s*\/>/g, "\n")
    .replace(/<text:list-item\b[^>]*>/g, "\n- ")
    .replace(/<\/text:(p|h)>/g, "\n\n")
    .replace(/<[^>]+>/g, "");
  const images = [];
  for (const href of hrefs) {
    const f = zip.file(decodeURIComponent(href));
    images.push(f ? { buffer: await f.async("nodebuffer"), type: IMAGE_TYPES[extOf(href)] || "" } : null);
  }
  return { text: tidy(decodeEntities(body)), images };
}

// RTF: the text and its PNG and JPEG pictures; fonts, styles, headers and other destinations are skipped
const CP1252 = { 0x80: "€", 0x82: "‚", 0x83: "ƒ", 0x84: "„", 0x85: "…", 0x86: "†", 0x87: "‡", 0x88: "ˆ", 0x89: "‰", 0x8a: "Š", 0x8b: "‹", 0x8c: "Œ", 0x8e: "Ž", 0x91: "‘", 0x92: "’", 0x93: "“", 0x94: "”", 0x95: "•", 0x96: "–", 0x97: "—", 0x98: "˜", 0x99: "™", 0x9a: "š", 0x9b: "›", 0x9c: "œ", 0x9e: "ž", 0x9f: "Ÿ" };
const SKIP = new Set(["fonttbl", "colortbl", "stylesheet", "info", "header", "headerl", "headerr", "headerf", "footer", "footerl", "footerr", "footerf", "listtable", "listoverridetable", "rsidtbl", "generator", "xmlnstbl", "themedata", "colorschememapping", "latentstyles", "datastore", "pgdsctbl", "revtbl", "filetbl", "fldinst", "nonshppict", "object", "footnote", "annotation", "comment", "mmathPr", "userprops"]);
export function rtfToText(src) {
  const s = String(src);
  const out = [], images = [], stack = [];
  let st = { skip: false, pict: null, own: false, uc: 1 };
  let i = 0, fallback = 0, star = false, first = false;
  const emit = (t) => { if (!st.skip && !st.pict) out.push(t); };
  while (i < s.length) {
    const ch = s[i];
    if (ch === "{") { stack.push(st); st = { ...st, own: false }; first = true; star = false; i++; continue; }
    if (ch === "}") {
      if (st.own && st.pict && st.pict.type && !st.skip) {
        const hex = st.pict.hex.join("");
        images.push({ buffer: Buffer.from(hex.length % 2 ? hex.slice(0, -1) : hex, "hex"), type: st.pict.type });
        st = stack.pop() || { skip: false, pict: null, own: false, uc: 1 };
        emit(`\n${mark(images.length - 1)}\n`);
      } else st = stack.pop() || { skip: false, pict: null, own: false, uc: 1 };
      first = false; i++; continue;
    }
    if (ch === "\\") {
      const nx = s[i + 1];
      if (nx === "\\" || nx === "{" || nx === "}") { if (fallback > 0) fallback--; else emit(nx); i += 2; first = false; continue; }
      if (nx === "'") {
        const code = parseInt(s.substr(i + 2, 2), 16);
        if (fallback > 0) fallback--; else if (Number.isFinite(code)) emit(CP1252[code] || String.fromCharCode(code));
        i += 4; first = false; continue;
      }
      if (nx === "*") { star = true; i += 2; continue; }
      if (nx === "~") { emit(" "); i += 2; continue; }
      if (nx === "_") { emit("-"); i += 2; continue; }
      if (nx === "-") { i += 2; continue; }
      if (nx === "\n" || nx === "\r") { emit("\n"); i += 2; continue; }
      const m = /^([a-zA-Z]{1,32})(-?\d{1,10})? ?/.exec(s.slice(i + 1, i + 48));
      if (!m) { i += 2; continue; }
      i += 1 + m[0].length;
      const word = m[1], arg = m[2] === undefined ? null : Number(m[2]);
      const atStart = first; first = false;
      if (star) { star = false; if (word !== "shppict") st.skip = true; continue; }
      if (atStart && SKIP.has(word)) { st.skip = true; continue; }
      if (word === "bin" && arg > 0) { i += arg; continue; }
      if (word === "pict") { st.pict = { hex: [], type: null }; st.own = true; continue; }
      if (st.pict) { if (word === "pngblip") st.pict.type = "image/png"; else if (word === "jpegblip") st.pict.type = "image/jpeg"; continue; }
      switch (word) {
        case "par": case "line": case "row": case "page": case "sect": emit("\n"); break;
        case "tab": emit("\t"); break;
        case "cell": emit(" "); break;
        case "u": emit(String.fromCharCode(arg < 0 ? arg + 65536 : arg)); fallback = st.uc; break;
        case "uc": st.uc = arg ?? 1; break;
        case "emdash": emit("—"); break;
        case "endash": emit("–"); break;
        case "lquote": emit("‘"); break;
        case "rquote": emit("’"); break;
        case "ldblquote": emit("“"); break;
        case "rdblquote": emit("”"); break;
        case "bullet": emit("•"); break;
        case "emspace": case "enspace": case "qmspace": emit(" "); break;
      }
      continue;
    }
    i++;
    if (ch === "\r" || ch === "\n") continue;
    if (st.pict) { if (st.own && /[0-9a-fA-F]/.test(ch)) st.pict.hex.push(ch); continue; }
    if (fallback > 0) { fallback--; continue; }
    first = false;
    emit(ch);
  }
  return { text: tidy(out.join("")), images };
}

export function decodeText(buffer) {
  const b = Buffer.from(buffer);
  if (b[0] === 0xff && b[1] === 0xfe) return b.subarray(2).toString("utf16le");
  if (b[0] === 0xfe && b[1] === 0xff) { const sw = Buffer.from(b.subarray(2)); sw.swap16(); return sw.toString("utf16le"); }
  try { return new TextDecoder("utf-8", { fatal: true }).decode(b).replace(/^﻿/, ""); }
  catch { return [...b].map((c) => CP1252[c] || String.fromCharCode(c)).join(""); }
}

// A PDF: the text of each page and its pictures (big enough to be screenshots). A scan has no text of its own: its
// pages come through as pictures, and its numbers can't be checked against its text.
async function fromPdf(buffer) {
  const { getDocumentProxy, extractText, extractImages } = await import("unpdf");
  let doc;
  try { doc = await getDocumentProxy(new Uint8Array(buffer)); }
  catch { throw unreadable("That PDF could not be opened (it may be protected with a password)."); }
  const { totalPages, text: pages } = await extractText(doc, { mergePages: false });
  const images = [], seen = new Set(), parts = [];
  for (let p = 1; p <= Math.min(totalPages, 40); p++) {
    parts.push(String(pages[p - 1] || ""));
    let objs = [];
    try { objs = await extractImages(doc, p); } catch { objs = []; }
    for (const o of objs) {
      if (!o || o.width < 200 || o.height < 120 || images.length >= 24) continue;
      const key = `${o.width}x${o.height}:${Buffer.from(o.data.buffer, o.data.byteOffset, Math.min(o.data.byteLength, 4096)).toString("base64")}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const png = await rawToImage(o.data, o.width, o.height, o.channels).catch(() => null);
      if (png) { images.push({ buffer: png, type: "image/png" }); parts.push(mark(images.length - 1)); }
    }
  }
  const text = tidy(parts.join("\n\n"));
  const words = text.replace(/\u0000IMG\d+\u0000/g, "").split(/\s+/).filter(Boolean).length;
  // a scan has next to no text of its own (one with a text layer from OCR reads like any PDF)
  return { text, images, scan: words < 3 * Math.min(totalPages, 40), pages: totalPages };
}

/* ---------- One file ---------- */
export async function extractFile(buffer, name) {
  const ext = extOf(name);
  const b = Buffer.from(buffer);
  const head = b.subarray(0, 8);
  if (ext === "doc" || (head[0] === 0xd0 && head[1] === 0xcf && head[2] === 0x11 && head[3] === 0xe0)) throw unreadable(`${name} is an older Word file (.doc). Open it in Word, save it as a Word Document (.docx), and drop that in.`);
  if (ext === "pages" || ext === "key" || ext === "numbers") throw unreadable(`${name} is an Apple iWork file. Export it as Word (.docx) or PDF (File > Export To), and drop that in.`);
  if (ext === "heic" || ext === "heif") throw unreadable(`${name} is a HEIC photo, which this can't read. Export it as JPEG or PNG, or take the screenshot again (screenshots are PNG).`);
  if (IMAGE_EXTS.includes(ext)) return { text: mark(0), images: [{ buffer: b, type: IMAGE_TYPES[ext] }], loose: true };
  const zip = head[0] === 0x50 && head[1] === 0x4b;
  if (ext === "docx" || (zip && ext !== "odt" && /word\//.test(b.subarray(0, 4000).toString("latin1")))) return fromDocx(b);
  if (ext === "odt") return fromOdt(b);
  if (ext === "pdf" || head.toString("latin1", 0, 5) === "%PDF-") return fromPdf(b);
  if (ext === "rtf" || head.toString("latin1", 0, 5) === "{\\rtf") return rtfToText(decodeText(b));
  if (["html", "htm"].includes(ext)) { const images = []; return { text: htmlToText(htmlImages(decodeText(b), images)), images }; }
  if (["txt", "text", "md", "markdown", "csv", ""].includes(ext)) {
    const images = [];
    const t = decodeText(b).replace(/!\[[^\]]*\]\((data:image\/[\w.+-]+;base64,[^)]+)\)/g, (m, uri) => htmlImages(`<img src="${uri}">`, images));
    if (/[\u0000-\u0008\u000e-\u001f]/.test(t.slice(0, 2000).replace(/\u0000IMG\d+\u0000/g, ""))) throw unreadable(`${name} doesn't look like a text file.`);
    return { text: tidy(t), images };
  }
  throw unreadable(`${name}: this can't read .${ext} files. Drop a Word (.docx), PDF, text, Markdown, RTF, OpenDocument or HTML file, or paste the text.`);
}

/* ---------- Everything dropped in at once ---------- */
// files: [{ buffer, name }]; pasted: text. Returns the text as Claude reads it (documents in <document> tags, pictures
// numbered [image N] where they sat, loose screenshots at the end), the plain words the checks hold the numbers to,
// the pictures, and whether any part had no text to check against (a scan).
export async function readUploads(files, pasted = "") {
  const parts = [], plain = [], images = [], warnings = [];
  let unverified = false;
  const loose = [];
  for (const f of files) {
    const r = await extractFile(f.buffer, f.name);
    const at = images.length;
    const kept = new Map();
    (r.images || []).forEach((im, k) => {
      if (!im || !im.buffer || !im.buffer.length) return;
      if (/emf|wmf|svg/.test(im.type || "")) { warnings.push(`A picture in ${f.name} is a drawing format this can't use (${im.type}); it was left out.`); return; }
      images.push({ n: images.length + 1, buffer: im.buffer, type: im.type, name: r.loose ? f.name : `picture ${k + 1} in ${f.name}` });
      kept.set(k, images.length);
    });
    const text = r.text.replace(/\u0000IMG(\d+)\u0000/g, (m, k) => (kept.has(Number(k)) ? `[image ${kept.get(Number(k))}]` : ""));
    if (r.loose) { if (kept.size) loose.push(`[image ${at + 1}] (dropped in: ${f.name})`); continue; }
    if (r.scan) { unverified = true; warnings.push(`${f.name} looks like a scan, with no text of its own: Claude reads its pages as pictures, so check its numbers by hand.`); }
    parts.push(`<document name="${f.name.replace(/["<>]/g, "")}">\n${text}\n</document>`);
    plain.push(text.replace(/\[image \d+\]/g, " "));
  }
  if (String(pasted || "").trim()) { parts.push(`<pasted_text>\n${tidy(pasted)}\n</pasted_text>`); plain.push(tidy(pasted)); }
  if (loose.length) parts.push(`<screenshots>\n${loose.join("\n")}\n</screenshots>`);
  return { text: parts.join("\n\n"), sourceText: plain.join("\n\n").slice(0, 200000), images, warnings, unverified };
}
