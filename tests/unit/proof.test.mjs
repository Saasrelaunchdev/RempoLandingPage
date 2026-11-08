// Unit tests for the proof system: reading uploads, captions, the checks, the scenes, the publish rules, the renderer,
// and the document pipeline with the fakes (no keys, no network).   npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { execFileSync } from "node:child_process";
import JSZip from "jszip";

process.env.PROOF_STORE_DIR = mkdtempSync(join(tmpdir(), "proof-unit-"));
process.env.PROOF_FAKE_DELAY_MS = "0";
const { readUploads, rtfToText, htmlToText, decodeText, extractFile } = await import("../../api/_lib/proof/extract.mjs");
const { alignWords } = await import("../../api/_lib/proof/stt.mjs");
const { buildCues, toVtt, toSrt } = await import("../../api/_lib/proof/captions.mjs");
const { checkCase, checkVideo, numbersIn } = await import("../../api/_lib/proof/checks.mjs");
const { buildScene, normalizeCase } = await import("../../api/_lib/proof/model.mjs");
const { upsertItem, sameBusiness } = await import("../../api/_lib/proof/items.mjs");
const { seedContent, SEED_CASES, SEED_TESTIMONIALS } = await import("../../api/_lib/proof/seed.mjs");
const { caseStudyPageHTML, caseCardsHTML, NEVER_PROMISE } = await import("../../assets/proof-render.mjs");
const shell = await import("../../assets/proof-shell.mjs");
const { EXAMPLE_SOURCE } = await import("../../api/_lib/proof/prompts.mjs");

const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");

// A small Word file: paragraphs, with a picture after the first one
async function docx(paragraphs) {
  const zip = new JSZip();
  zip.file("[Content_Types].xml", `<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Default Extension="png" ContentType="image/png"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>`);
  zip.file("_rels/.rels", `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>`);
  zip.file("word/_rels/document.xml.rels", `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rIdImg" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/image1.png"/></Relationships>`);
  zip.file("word/media/image1.png", PNG);
  const p = (t) => `<w:p><w:r><w:t xml:space="preserve">${t.replace(/&/g, "&amp;").replace(/</g, "&lt;")}</w:t></w:r></w:p>`;
  const pic = `<w:p><w:r><w:drawing><wp:inline><wp:extent cx="9525" cy="9525"/><wp:docPr id="1" name="Picture 1"/><a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic><pic:nvPicPr><pic:cNvPr id="1" name="image1.png"/><pic:cNvPicPr/></pic:nvPicPr><pic:blipFill><a:blip r:embed="rIdImg"/></pic:blipFill><pic:spPr/></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r></w:p>`;
  zip.file("word/document.xml", `<?xml version="1.0" encoding="UTF-8"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"><w:body>${p(paragraphs[0])}${pic}${paragraphs.slice(1).map(p).join("")}</w:body></w:document>`);
  return zip.generateAsync({ type: "nodebuffer" });
}

/* ---------- Reading uploads ---------- */
test("a Word file reads in order, with its picture numbered where it sat", async () => {
  const buf = await docx(["Bayside Roofing located in Pacifica, California", "They went from 12 to 40 Google reviews."]);
  const up = await readUploads([{ buffer: buf, name: "Bayside.docx" }, { buffer: PNG, name: "after.png" }], "Owner: Dana Reyes");
  assert.match(up.text, /<document name="Bayside.docx">\nBayside Roofing located in Pacifica, California\n\n\[image 1\]\n\nThey went from 12 to 40/);
  assert.match(up.text, /<screenshots>\n\[image 2\] \(dropped in: after.png\)/);
  assert.match(up.text, /<pasted_text>\nOwner: Dana Reyes/);
  assert.equal(up.images.length, 2);
  assert.doesNotMatch(up.sourceText, /image \d/);   // picture numbers never count as facts
  assert.deepEqual([...numbersIn(up.sourceText)].sort(), ["12", "40"]);
});

test("RTF: text, smart quotes, unicode, a PNG picture; fonts and generator skipped", () => {
  const hex = PNG.toString("hex");
  const rtf = `{\\rtf1\\ansi{\\fonttbl{\\f0 Arial;}}{\\*\\generator Word;}\\f0 Rempo\\rquote s first week\\par 10 reviews \\u8212? no dash\\par{\\pict\\pngblip\\picw1\\pich1 ${hex}}\\par Done.}`;
  const r = rtfToText(rtf);
  assert.match(r.text, /^Rempo’s first week\n10 reviews — no dash\n\n\u0000IMG0\u0000\n\nDone\.$/);
  assert.equal(r.images.length, 1);
  assert.deepEqual(r.images[0].buffer, PNG);
});

test("HTML, text in UTF-16, and files that can't be read", async () => {
  assert.equal(htmlToText("<h1>Title</h1><p>A &amp; B&nbsp;&#8217;s</p><script>x()</script><ul><li>One</li></ul>"), "Title\n\nA & B ’s\n\n- One");
  assert.equal(decodeText(Buffer.from("﻿hello", "utf16le")), "hello");
  await assert.rejects(extractFile(Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0, 0, 0, 0]), "old.doc"), /older Word file/);
  await assert.rejects(extractFile(Buffer.from("x"), "photo.heic"), /HEIC/);
  await assert.rejects(extractFile(Buffer.from("x"), "deck.pptx"), /can't read \.pptx/);
});

/* ---------- Transcript and captions ---------- */
test("the transcript's words line up with their times, punctuation kept", () => {
  const w = (s) => s.split(" ").map((x, i) => ({ word: x, start: i, end: i + 0.8 }));
  const a = alignWords("Hello everybody, my name is Herman.", w("Hello everybody my name is Herman"));
  assert.deepEqual(a.map((x) => x.w), ["Hello", "everybody,", "my", "name", "is", "Herman."]);
  const b = alignWords("Take care of the back-end stuff.", w("Take care of the back end stuff"));
  assert.deepEqual(b.map((x) => x.w), ["Take", "care", "of", "the", "back-end", "stuff."]);
  assert.equal(b[4].e, 5.8);   // "back-end" covers two timed words
  const c = alignWords("Um, I think it was great.", w("I think it was great"));
  assert.deepEqual(c.map((x) => x.w), ["Um, I", "think", "it", "was", "great."]);
});

test("captions: phrases in order, never overlapping, each up long enough to read", () => {
  const words = SEED_TESTIMONIALS[0].transcript.split(" ").map((t, i) => ({ w: t, s: 0.4 + i * 0.27, e: 0.4 + i * 0.27 + 0.22 }));
  const cues = buildCues(words, { duration: 34.1 });
  assert.ok(cues.length > 8);
  cues.forEach((c, i) => {
    assert.ok(c.end > c.start);
    if (i) assert.ok(c.start >= cues[i - 1].end - 1e-9, "no overlap");
    assert.ok(c.text.length <= 80, c.text);
  });
  assert.equal(cues.map((c) => c.text).join(" "), SEED_TESTIMONIALS[0].transcript);
  assert.match(toVtt(cues), /^WEBVTT\n\n1\n00:00:00\.\d{3} --> /);
  assert.match(toSrt(cues), /^1\n00:00:00,\d{3} --> /);
});

/* ---------- The checks ---------- */
test("the published case studies pass their checks against the document they came from", () => {
  const source = EXAMPLE_SOURCE;
  for (const cs of SEED_CASES) {
    const r = checkCase(cs, { sourceText: source, sourceNumbers: ["5", "5.0"] });
    assert.deepEqual(r.issues, [], cs.slug);
  }
});

test("an invented number, a banned word, a dash and he or she are caught", () => {
  const cs = structuredClone(SEED_CASES[0]);
  cs.hero.lead = "Rempo's seamless follow-up — and 300 more reviews!";
  cs.chapters.did.lead = "He asked every customer.";
  const r = checkCase(cs, { sourceText: EXAMPLE_SOURCE, sourceNumbers: ["5"] });
  const msgs = r.issues.map((i) => `${i.level}:${i.field}:${i.message}`).join("\n");
  assert.equal(r.ok, false);
  assert.match(msgs, /error:hero\.lead:Uses a dash/);
  assert.match(msgs, /error:hero\.lead:Uses “seamless”/);
  assert.match(msgs, /error:hero\.lead:States 300/);
  assert.match(msgs, /warn:hero\.lead:Has an exclamation mark/);
  assert.match(msgs, /warn:chapters\.did\.lead:Says “He”/);
});

test("a video's quotes must be what was said, word for word", () => {
  const t = SEED_TESTIMONIALS[0];
  assert.deepEqual(checkVideo(t, { transcript: t.transcript }).issues, []);
  const bad = checkVideo({ ...t, quote: "Rempo tripled our reviews overnight." }, { transcript: t.transcript });
  assert.equal(bad.ok, false);
  assert.match(bad.issues[0].message, /word for word/);
});

/* ---------- Scenes and the renderer ---------- */
test("the 3D stack is built from the numbers by one rule (the published scenes come out the same)", () => {
  for (const cs of SEED_CASES) assert.deepEqual(buildScene(cs.numbers), cs.scene, cs.slug);
  assert.deepEqual(buildScene({ before: null, after: 20, gained: 8 }).cols.map((c) => c.segs.map((s) => [s.k, s.n])), [[["old", 12], ["new", 8]]]);
});

test("every case study page carries the same parts, and never promises a number", () => {
  const pub = { cases: SEED_CASES, testimonials: SEED_TESTIMONIALS };
  for (const cs of SEED_CASES) {
    const page = caseStudyPageHTML(normalizeCase(cs), { shell, testimonial: cs.testimonialId ? SEED_TESTIMONIALS[0] : null });
    for (const part of ["<h1", 'class="s3d"', 'class="miss"', 'class="steps"', NEVER_PROMISE, "application/ld+json"]) assert.ok(page.includes(part), `${cs.slug}: ${part}`);
    assert.doesNotMatch(page, /<script>[^<]*<\/script>[^]*—/);
  }
  assert.equal((caseCardsHTML(pub.cases, pub.testimonials).match(/class="cs-card"/g) || []).length, 2);
});

test("index.html's two sections match the renderer (npm run render-landing)", () => {
  const out = execFileSync(process.execPath, ["tools/render-landing.mjs", "--check"], { cwd: new URL("../..", import.meta.url) }).toString();
  assert.match(out, /up to date/);
});

/* ---------- Publishing rules ---------- */
test("publishing: checks decide, auto-publish can be off, a second one for the same business waits", () => {
  const content = seedContent();
  const good = structuredClone(SEED_CASES[0]); delete good.slug;
  const twin = upsertItem(content, { kind: "case", data: good, publish: "auto", source: { ingested: true, text: EXAMPLE_SOURCE, numbers: ["5"] } });
  assert.equal(twin.status, "draft");
  assert.ok(twin.checks.issues.some((i) => i.code === "twin"));
  assert.equal(twin.data.slug, "junkaway-movers-2");

  const other = structuredClone(SEED_CASES[0]);
  delete other.slug;
  other.business = { ...other.business, name: "Coastside Movers LLC", short: "Coastside Movers", nick: "Coastside Movers" };
  const src = EXAMPLE_SOURCE + "\nCoastside Movers";
  assert.equal(upsertItem(content, { kind: "case", data: other, publish: "auto", source: { ingested: true, text: src, numbers: ["5"] } }).status, "published");

  content.settings.autoPublish = false;
  const third = structuredClone(other); third.business = { ...third.business, name: "Harbor Movers", short: "Harbor Movers", nick: "Harbor" };
  assert.equal(upsertItem(content, { kind: "case", data: third, publish: "auto", source: { ingested: true, text: src + " Harbor Movers", numbers: ["5"] } }).status, "draft");

  const broken = structuredClone(third); broken.hero.h1 = "From 32 to 999 Google reviews in six months.";
  const b = upsertItem(content, { kind: "case", data: broken, publish: true, source: { ingested: true, text: src + " Harbor Movers", numbers: ["5"] } });
  assert.equal(b.status, "draft");
  assert.equal(upsertItem(content, { id: b.id, kind: "case", data: b.data, publish: true, force: true }).status, "published");
  assert.ok(sameBusiness("Junkaway & Movers LLC", "junkaway and movers"));
});

/* ---------- The document pipeline, with the fakes ---------- */
test("a dropped Word file becomes a published case study", async () => {
  const { installFakes } = await import("../fakes.mjs");
  installFakes();
  const { planDocument, draftCase } = await import("../../api/_lib/proof/ingest.mjs");
  const { loadPublished } = await import("../../api/_lib/proof/store.mjs");
  const buf = await docx([
    "Bayside Roofing located in Pacifica, California",
    "Bayside Roofing went from 12 to 40 Google reviews in three months with Rempo.",
    "Rempo sent each customer a review request and a reminder. In three months, Bayside Roofing received 28 new Google reviews."
  ]);
  const pathname = "proof/uploads/unit-test/bayside.docx";
  const file = join(process.env.PROOF_STORE_DIR, "private", pathname);
  mkdirSync(join(file, ".."), { recursive: true });
  writeFileSync(file, buf);
  const steps = [];
  const step = (k) => { steps.push(k); return { done() {}, skip() {}, fail() {} }; };
  const plan = await planDocument({ files: [{ pathname, name: "bayside.docx" }] }, { step, deadline: Date.now() + 120000 });
  assert.deepEqual(plan.businesses.map((b) => b.name), ["Bayside Roofing"]);
  const r = await draftCase({ job: plan.job, key: 0 }, { step, deadline: Date.now() + 120000 });
  assert.equal(r.item.status, "published", JSON.stringify(r.item.checks.issues));
  assert.equal(r.item.data.slug, "bayside-roofing");
  assert.deepEqual(steps, ["read", "split", "write", "pictures", "check", "save"]);
  const pub = await loadPublished();
  assert.ok(pub.cases.some((c) => c.slug === "bayside-roofing"));
});
