// The uploads, start to finish.
//
// A video: read it, look at it (mirrored? the face? the cover?), hear it (the words and when each was said), tidy the
// words (misheard names, the quote, the intro), write the captions, make the web version, poster and avatar, and save
// it as a video testimonial, linked to its business's case study when there is one.
//
// A document, in two requests so each fits a function's time: plan (read every file, number the pictures, find the
// businesses with a story) and then one case study per business (Claude writes it, the pictures are cut and framed,
// the checks run, Claude fixes what they found once, and it is saved). Every new item publishes by itself only if its
// checks pass and auto-publish is on; otherwise it waits as a draft with what to fix.
import { randomUUID } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { downloadTo, getFile, putFile, deleteFiles, loadContent, mutateContent, StoreError } from "./store.mjs";
import { probe, stills, webVideo, poster, avatar, speech, toWebp, screenshotPair, ringFor, squarePicture } from "./media.mjs";
import { buildCues, toVtt, toSrt, transcriptOf } from "./captions.mjs";
import { readUploads, extOf, VIDEO_EXTS } from "./extract.mjs";
import { checkCase } from "./checks.mjs";
import { normalizeCase } from "./model.mjs";
import { providers } from "./providers.mjs";
import { upsertItem, knownOf, sameBusiness, summary, now } from "./items.mjs";

const UPLOAD = /^proof\/uploads\/[\w-]+\/[\w.\-]+$/;
const uploadPath = (p) => {
  const s = String(p || "");
  if (!UPLOAD.test(s) || s.includes("..")) throw new StoreError("That upload can't be found. Drop the file again.", 400, "pathname");
  return s;
};
const clean = (v, max = 120) => String(v || "").replace(/\s+/g, " ").trim().slice(0, max);
const short = (e) => String((e && e.message) || e).slice(0, 300);
const workDir = (tag) => mkdtempSync(join(tmpdir(), `${tag}-`));
const left = (deadline) => deadline - Date.now();

/* ---------- Video ---------- */
const spread = (d, n) => Array.from({ length: n }, (_, i) => Math.max(0, Math.min(d - 0.2, d * (0.1 + (0.8 * i) / (n - 1)))));
const sentence = (s) => { const t = String(s || "").trim().replace(/[,;:\s]+$/, ""); return t ? t.charAt(0).toUpperCase() + t.slice(1) + (/[.?!]["”']?$/.test(t) ? "" : ".") : ""; };

export async function ingestVideo(body, { step, deadline }) {
  const pathname = uploadPath(body.pathname);
  const hints = { name: clean(body.name), role: clean(body.role), business: clean(body.business) };
  const P = providers();
  const dir = workDir("video");
  const notes = [];
  try {
    let s = step("read", "Reading the video");
    const ext = VIDEO_EXTS.includes(extOf(pathname)) ? extOf(pathname) : "mp4";
    const src = join(dir, `source.${ext}`);
    await downloadTo(pathname, src);
    const info = await probe(src);
    if (!info.duration) throw Object.assign(new Error("That video has no length ffmpeg can read."), { status: 422 });
    if (info.duration > 600) throw Object.assign(new Error("That video is longer than 10 minutes. Trim it to the testimonial and drop it again."), { status: 422 });
    s.done(`${Math.round(info.duration)} seconds, ${info.width}×${info.height}${info.hasAudio ? "" : ", no sound"}`);

    const times = spread(info.duration, 6);
    const shots = await stills(src, times, dir);
    const { content } = await loadContent();
    const known = knownOf(content);

    // Look and listen at the same time
    const sLook = step("look", "Looking at the video");
    const looking = (async () => {
      if (!P.claude.claudeConfigured()) { sLook.skip("Claude is not set up: no mirror check, the middle frame as the cover"); return null; }
      try { const r = await P.claude.lookAtVideo({ stills: shots, times, hints }, { deadline: deadline - 120000 }); sLook.done(r.mirrored ? "Mirrored by the camera: it will be flipped back" : "Not mirrored"); return r; }
      catch (e) { sLook.fail(short(e)); notes.push(`Looking at the video failed (${short(e)}): the middle frame is the cover.`); return null; }
    })();
    const sHear = step("hear", "Transcribing what was said");
    const hearing = (async () => {
      if (!info.hasAudio) { sHear.skip("The video has no sound"); return null; }
      if (!P.stt.sttConfigured()) { sHear.skip("Transcription is not set up: no captions"); notes.push("Transcription is not set up (OPENAI_API_KEY), so the video has no captions."); return null; }
      try {
        const mp3 = join(dir, "speech.mp3");
        await speech(src, mp3);
        const glossary = ["Rempo", hints.name, hints.business, ...known.cases.flatMap((c) => [c.name, c.owner]), ...known.videos.map((v) => v.name)].filter(Boolean);
        const r = await P.stt.transcribe(readFileSync(mp3), { prompt: `${[...new Set(glossary)].join(", ")}.`, filename: "speech.mp3" });
        sHear.done(`${r.words.length} words`);
        return r;
      } catch (e) { sHear.fail(short(e)); notes.push(`Transcription failed (${short(e)}): the video has no captions.`); return null; }
    })();
    const [look, heard] = await Promise.all([looking, hearing]);
    const mirrored = Boolean(look && look.mirrored);
    const posterIdx = look && Number.isInteger(look.poster) && look.poster >= 0 && look.poster < times.length ? look.poster : Math.floor(times.length / 2);
    const tAt = times[posterIdx];

    // The web version while Claude tidies the words
    const sMake = step("make", "Making the web version");
    const making = (async () => {
      const out = { mp4: join(dir, "web.mp4"), poster: join(dir, "poster.webp"), avatar: join(dir, "avatar.webp") };
      const size = await webVideo(src, out.mp4, { flip: mirrored, hasAudio: info.hasAudio, fps: info.fps });
      await poster(src, tAt, out.poster, { flip: mirrored });
      await avatar(src, tAt, look && look.face && look.face.w > 0 ? look.face : null, info, out.avatar, { flip: mirrored });
      sMake.done(`${(size / 1048576).toFixed(1)} MB${mirrored ? ", flipped back" : ""}`);
      return out;
    })();

    const words = heard ? heard.words : [];
    let tidy = null, model = null;
    if (words.length) {
      const sTidy = step("tidy", "Checking names and picking the quote");
      if (!P.claude.claudeConfigured()) { sTidy.skip("Claude is not set up: the words as transcribed, no quote or intro"); notes.push("Claude is not set up (ANTHROPIC_API_KEY): write the intro and quote in the editor."); }
      else {
        try {
          const cases = content.items.filter((i) => i.kind === "case").map((i) => ({ slug: i.data.slug, summary: `${i.data.business.name}, ${i.data.business.city}. ${i.data.hero.h1} ${i.data.hero.lead} ${i.data.chapters.result.lead}` }));
          const r = await P.claude.tidyTranscript({ words, hints, textSeen: (look && look.textSeen) || [], known, caseStudies: cases }, { deadline: deadline - 25000 });
          tidy = r.data; model = r.model;
          sTidy.done(tidy.fixes.length ? `Fixed ${tidy.fixes.length} misheard word${tidy.fixes.length === 1 ? "" : "s"}` : "No misheard words");
          if (tidy.notes) notes.push(tidy.notes);
        } catch (e) { sTidy.fail(short(e)); notes.push(`Claude could not tidy the transcript (${short(e)}): write the intro and quote in the editor.`); }
      }
    }
    const made = await making;

    // The words as they will show: fixes in, fillers out, the speaker's own timing
    const fixes = new Map(((tidy && tidy.fixes) || []).filter((f) => Number.isInteger(f.i) && f.i >= 0 && f.i < words.length).map((f) => [f.i, clean(f.w, 60)]));
    const drop = new Set(((tidy && tidy.drop) || []).filter((i) => Number.isInteger(i)));
    const shown = [];
    words.forEach((w, i) => { if (drop.has(i)) return; const t = fixes.has(i) ? fixes.get(i) : w.w; if (t) shown.push({ ...w, w: t, i }); });
    const span = (r) => (r && Number.isInteger(r.from) && Number.isInteger(r.to) && r.to >= r.from ? sentence(transcriptOf(shown.filter((w) => w.i >= r.from && w.i <= r.to))) : "");
    const transcript = transcriptOf(shown);
    const cues = buildCues(shown, { duration: info.duration });

    const sSave = step("save", "Saving the video");
    const person = (tidy && tidy.person) || {};
    const name = clean(hints.name || person.name, 80);
    const folder = `proof/media/vt-${randomUUID().slice(0, 8)}`;
    const base = (name ? name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") : "testimonial") || "testimonial";
    const put = (file, buf, type) => putFile(`${folder}/${file}`, buf, { access: "public", contentType: type });
    const [mp4, pst, av, vtt, srt] = await Promise.all([
      put(`${base}.mp4`, readFileSync(made.mp4), "video/mp4"),
      put(`${base}-poster.webp`, readFileSync(made.poster), "image/webp"),
      put(`${base}-avatar.webp`, readFileSync(made.avatar), "image/webp"),
      cues.length ? put(`${base}.en.vtt`, toVtt(cues), "text/vtt") : null,
      cues.length ? put(`${base}.en.srt`, toSrt(cues), "application/x-subrip") : null
    ]);
    const data = {
      name, role: clean(hints.role || person.role), business: clean(hints.business || person.business), location: clean(person.location),
      caseStudy: (tidy && tidy.caseStudy) || null,
      intro: clean(tidy && tidy.intro, 600), quote: span(tidy && tidy.quote), quoteLong: span(tidy && tidy.quoteLong),
      title: clean(tidy && tidy.title, 160), summary: clean(tidy && tidy.summary, 300),
      duration: Math.round(info.duration * 10) / 10, uploadDate: now().slice(0, 10), lang: "en",
      src: mp4.url, vtt: vtt ? vtt.url : "", srt: srt ? srt.url : "", poster: pst.url, avatar: av.url, transcript
    };
    const files = { public: [mp4, pst, av, vtt, srt].filter(Boolean).map((f) => f.url), private: [] };
    const { result } = await mutateContent((c) => {
      const cs = c.items.find((i) => i.kind === "case" && (i.data.slug === data.caseStudy || (data.business && sameBusiness(i.data.business.name, data.business))));
      data.caseStudy = cs ? cs.data.slug : null;
      const item = upsertItem(c, {
        kind: "video", data, publish: "auto",
        source: { ingested: true, files, notes, model, mirrored, hintsText: [hints.name, hints.role, hints.business].filter(Boolean).join("\n"), heard: heard ? heard.text : "" }
      });
      if (cs && !cs.data.testimonialId) { cs.data.testimonialId = item.data.id; cs.updatedAt = now(); }
      return summary(item);
    });
    sSave.done(result.status === "published" ? "Published" : "Saved as a draft");
    return { item: result, notes };
  } finally {
    rmSync(dir, { recursive: true, force: true });
    // the upload as it came from the phone is not kept: the web version, cover and captions are what the site uses
    await deleteFiles([pathname], { access: "private" }).catch(() => {});
  }
}

/* ---------- Document, part 1: read it and find the businesses ---------- */
const jobPath = (id, file) => `proof/jobs/${id}/${file}`;

export async function planDocument(body, { step, deadline }) {
  const files = (Array.isArray(body.files) ? body.files : []).slice(0, 12).map((f) => ({ pathname: uploadPath(f.pathname), name: clean(f.name, 160) || "upload" }));
  const pasted = String(body.text || "").slice(0, 200000);
  if (!files.length && !pasted.trim()) throw Object.assign(new Error("Drop a document or paste the text first."), { status: 400 });
  const P = providers();
  if (!P.claude.claudeConfigured()) throw Object.assign(new Error("Claude writes the case studies, and it is not set up: set ANTHROPIC_API_KEY in Vercel, then redeploy."), { status: 503, code: "not-configured" });
  const dir = workDir("doc");
  try {
    const s = step("read", files.length > 1 ? `Reading ${files.length} files` : "Reading the document");
    const loaded = [];
    for (const [i, f] of files.entries()) {
      const local = join(dir, `in-${i}.${extOf(f.pathname) || "bin"}`);
      await downloadTo(f.pathname, local);
      loaded.push({ name: f.name, buffer: readFileSync(local) });
    }
    const up = await readUploads(loaded, pasted);
    if (!up.sourceText.trim() && !up.images.length) throw Object.assign(new Error("There is no text or picture in that upload."), { status: 422 });
    // Each picture twice: small for Claude to read, and as uploaded for the page
    const id = randomUUID();
    const images = [];
    for (const im of up.images.slice(0, 30)) {
      const forClaude = await toWebp(im.buffer, dir, `img-${im.n}`, { maxSide: 1568, quality: 82 }).catch(() => null);
      if (!forClaude) { up.warnings.push(`${im.name} could not be read as a picture; it was left out.`); continue; }
      const [a, b] = await Promise.all([
        putFile(jobPath(id, `img-${im.n}.webp`), forClaude.buffer, { access: "private", contentType: "image/webp", exact: true }),
        putFile(jobPath(id, `orig-${im.n}`), im.buffer, { access: "private", contentType: im.type || "application/octet-stream", exact: true })
      ]);
      images.push({ n: im.n, name: im.name, width: forClaude.sourceWidth, height: forClaude.sourceHeight, claude: a.pathname, orig: b.pathname });
    }
    s.done(`${up.sourceText.split(/\s+/).filter(Boolean).length} words, ${images.length} picture${images.length === 1 ? "" : "s"}`);

    const s2 = step("split", "Finding the case studies in it");
    const forClaude = await Promise.all(images.map(async (im) => ({ n: im.n, name: im.name, buffer: (await getFile(im.claude, { access: "private" })).buffer, mediaType: "image/webp" })));
    const plan = await P.claude.splitUpload({ text: up.text, images: forClaude }, { deadline });
    const businesses = (plan.businesses || []).slice(0, 8).map((b, key) => ({ key, name: clean(b.name, 120), story: clean(b.story, 300), images: (b.images || []).filter((n) => images.some((im) => im.n === n)) }));
    s2.done(businesses.length ? businesses.map((b) => b.name).join(", ") : "None found");
    const job = { id, createdAt: now(), files: files.map((f) => f.pathname), names: files.map((f) => f.name), text: up.text, sourceText: up.sourceText, unverified: up.unverified, warnings: up.warnings, images, businesses, notes: clean(plan.notes, 600) };
    await putFile(jobPath(id, "job.json"), JSON.stringify(job), { access: "private", contentType: "application/json", exact: true });
    return { job: id, businesses, notes: job.notes, warnings: up.warnings };
  } finally {
    rmSync(dir, { recursive: true, force: true });
    // what was dropped in now lives in the job (its text and its pictures); the files themselves are not kept
    await deleteFiles(files.map((f) => f.pathname), { access: "private" }).catch(() => {});
  }
}

/* ---------- Document, part 2: one business's case study ---------- */
const isBox = (b) => b && b.w > 0.005 && b.h > 0.005;

function toPage(d, pics) {
  const r = d.chapters.result;
  const result = { label: r.label, h2: r.h2, lead: r.lead, paras: r.paras || [] };
  if (pics.proof) {
    const tabs = (r.proofTabs || []).filter(Boolean).slice(0, 2);
    result.proof = {
      tabs: tabs.length === 2 ? tabs : ["Before Rempo", "After Rempo"],
      imgs: pics.proof.imgs.map((im, i) => ({ ...im, alt: (i ? d.pictures.after.alt : d.pictures.before.alt) || "" })),
      ...(pics.proof.ring ? { ring: pics.proof.ring } : {}),
      ar: pics.proof.ar, cap: r.proofCap
    };
  } else result.stat = r.stat;
  const b = { ...d.business, areaServed: d.business.areaServed || [] };
  if (!b.owner) delete b.owner;
  const n = d.numbers;
  const before = d.chapters.before;
  return {
    business: b,
    card: { tag: d.card.tag, title: d.hero.h1, line: d.card.line, stats: (d.card.stats || []).slice(0, 2) },
    hero: { h1: d.hero.h1, lead: d.hero.lead, facts: (d.hero.facts || []).slice(0, 3) },
    gbp: { rating: d.gbp.rating, count: d.gbp.count, was: d.gbp.was, kind: d.gbp.kind, photo: pics.photo || "" },
    numbers: { before: n.before >= 0 ? n.before : null, after: n.after >= 0 ? n.after : null, gained: n.gained >= 0 ? n.gained : null, pill: n.pill, beforeCaption: n.beforeCaption, afterCaption: n.afterCaption },
    sceneLabel: d.sceneLabel,
    glance: d.glance,
    chapters: {
      before: { label: before.label, h2: before.h2, lead: before.lead, paras: before.paras || [], miss: { items: before.miss.items.map((i) => (i.miss ? { text: i.text, miss: true } : { text: i.text })), big: before.miss.big, small: before.miss.small } },
      did: { label: d.chapters.did.label, h2: d.chapters.did.h2, lead: d.chapters.did.lead, paras: d.chapters.did.paras || [], steps: d.chapters.did.steps },
      result
    },
    payoff: d.payoff, note: d.note, seo: d.seo, testimonialId: null
  };
}

// The screenshots and the photo, cut and framed for the page and stored in public
async function makePictures(d, job, dir, folder) {
  const byN = new Map(job.images.map((im) => [im.n, im]));
  const pics = { proof: null, photo: "", urls: [] };
  const local = async (im) => {
    const f = join(dir, `orig-${im.n}`);
    const got = await getFile(im.orig, { access: "private" });
    if (!got) throw new Error("picture missing");
    writeFileSync(f, got.buffer);
    return f;
  };
  const bi = byN.get(d.pictures.before.image), ai = byN.get(d.pictures.after.image);
  if (bi && ai && bi !== ai) {
    const files = [await local(bi), await local(ai)];
    const pair = await screenshotPair(files, [d.pictures.before.crop, d.pictures.after.crop], dir);
    const srcs = await Promise.all(files.map((f) => probe(f)));
    const ring = ringFor(isBox(d.pictures.after.count) ? d.pictures.after.count : null, pair.cuts[1], srcs[1], pair)
      || ringFor(isBox(d.pictures.before.count) ? d.pictures.before.count : null, pair.cuts[0], srcs[0], pair);
    const [b, a] = await Promise.all(pair.buffers.map((buf, i) => putFile(`${folder}/${i ? "after" : "before"}.webp`, buf, { access: "public", contentType: "image/webp" })));
    pics.proof = { imgs: [{ src: b.url, w: pair.width, h: pair.height }, { src: a.url, w: pair.width, h: pair.height }], ring, ar: `${pair.width} / ${pair.height}` };
    pics.urls.push(b.url, a.url);
  }
  const pi = byN.get(d.pictures.photo.image);
  if (pi && isBox(d.pictures.photo.box)) {
    const buf = await squarePicture(await local(pi), d.pictures.photo.box, join(dir, "photo.webp"));
    const p = await putFile(`${folder}/photo.webp`, buf, { access: "public", contentType: "image/webp" });
    pics.photo = p.url;
    pics.urls.push(p.url);
  }
  return pics;
}

export async function draftCase(body, { step, deadline }) {
  const id = String(body.job || "");
  if (!/^[0-9a-f-]{36}$/.test(id)) throw new StoreError("That upload has expired. Drop it again.", 400, "job");
  const got = await getFile(jobPath(id, "job.json"), { access: "private" });
  if (!got) throw new StoreError("That upload has expired. Drop it again.", 404, "job");
  const job = JSON.parse(got.buffer.toString("utf8"));
  const biz = job.businesses.find((b) => b.key === Number(body.key));
  if (!biz) throw new StoreError("That business is not in the upload.", 404, "job");
  const P = providers();
  const dir = workDir("case");
  try {
    const { content } = await loadContent();
    const known = knownOf(content);
    const video = content.items.find((i) => i.kind === "video" && sameBusiness(i.data.business, biz.name));
    const testimonial = video ? { id: video.data.id, name: video.data.name, role: video.data.role, transcript: video.data.transcript } : null;
    const many = job.images.length > 10;
    const images = await Promise.all(job.images.filter((im) => !many || biz.images.includes(im.n)).map(async (im) => ({ n: im.n, name: im.name, buffer: (await getFile(im.claude, { access: "private" })).buffer, mediaType: "image/webp" })));
    const upload = { text: job.text, images };
    const task = { business: biz, known, testimonial };

    let s = step("write", `Writing ${biz.name}'s case study`);
    let { data: draft, model } = await P.claude.draftCaseStudy(upload, task, { deadline: deadline - 45000 });
    s.done();

    s = step("pictures", "Cutting the screenshots and the photo");
    const folder = `proof/media/cs-${randomUUID().slice(0, 8)}`;
    let pics = { proof: null, photo: "", urls: [] };
    try {
      pics = await makePictures(draft, job, dir, folder);
      s.done([pics.proof ? "Before and after" : "No before and after screenshots", pics.photo ? "a profile photo" : "no photo"].join(", "));
    } catch (e) { s.fail(short(e)); }

    const sourceText = [job.sourceText, testimonial && testimonial.transcript].filter(Boolean).join("\n\n");
    const numbersFrom = (dr) => (dr.readFromPictures || []).map((r) => clean(r.number, 20)).filter(Boolean);
    const check = (dr) => checkCase({ ...normalizeCase(toPage(dr, pics)), slug: "draft" }, { sourceText, sourceNumbers: numbersFrom(dr), unverified: job.unverified });

    s = step("check", "Checking the copy and every number");
    let res = check(draft);
    const errors = (r) => r.issues.filter((i) => i.level === "error" && i.field !== "slug" && !/scan with no text/.test(i.message));
    if (!errors(res).length) s.done("All clear");
    else if (left(deadline) < 75000) s.fail(`${errors(res).length} to fix in the editor`);
    else {
      s.done(`${errors(res).length} to fix`);
      const s2 = step("fix", "Fixing what the checks found");
      try {
        const r2 = await P.claude.repairCaseStudy(upload, task, draft, errors(res), { deadline: deadline - 15000 });
        const res2 = check(r2.data);
        if (errors(res2).length <= errors(res).length) { draft = r2.data; res = res2; model = r2.model; }
        errors(res).length ? s2.fail(`${errors(res).length} left to fix in the editor`) : s2.done("All clear");
      } catch (e) { s2.fail(short(e)); }
    }

    s = step("save", "Saving the case study");
    const notes = [...(job.warnings || []), draft.notes, job.notes].map((x) => clean(x, 600)).filter(Boolean);
    const data = toPage(draft, pics);
    const { result } = await mutateContent((c) => {
      const v = testimonial && c.items.find((i) => i.kind === "video" && i.data.id === testimonial.id);
      if (v) data.testimonialId = v.data.id;
      const item = upsertItem(c, {
        kind: "case", data, publish: "auto",
        source: { ingested: true, job: id, text: sourceText.slice(0, 100000), numbers: numbersFrom(draft), pictureNumbers: draft.readFromPictures || [], unverified: Boolean(job.unverified), files: { public: pics.urls, private: [] }, notes, model }
      });
      if (v && !v.data.caseStudy) { v.data.caseStudy = item.data.slug; v.updatedAt = now(); }
      return summary(item);
    });
    s.done(result.status === "published" ? "Published" : "Saved as a draft");
    return { item: result, notes };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
