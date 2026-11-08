// The content document in Vercel Blob, with an in-memory stand-in for the service: a store that takes both private and
// public files, one that takes public files only, and one that takes private files only.   npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";

delete process.env.PROOF_STORE_DIR;
delete process.env.PROOF_BLOB_PRIVATE;
process.env.BLOB_READ_WRITE_TOKEN = "vercel_blob_rw_test_token";
const store = await import("../../api/_lib/proof/store.mjs");

class BlobPreconditionFailedError extends Error {}
function fakeBlob(takes) {
  const files = new Map();
  let clock = 0;
  const etagOf = (b) => `"${createHash("sha1").update(b).digest("hex")}"`;
  return {
    files, BlobPreconditionFailedError,
    async put(pathname, body, o) {
      if (!takes.includes(o.access)) throw new Error("Access denied, please provide a valid token for this resource.");
      const cur = files.get(pathname);
      if (o.ifMatch && (!cur || cur.etag !== o.ifMatch)) throw new BlobPreconditionFailedError("precondition failed");
      if (cur && !o.allowOverwrite && !o.ifMatch) throw new Error("This blob already exists, use allowOverwrite: true");
      const buf = Buffer.from(typeof body === "string" ? body : body);
      files.set(pathname, { access: o.access, buf, etag: etagOf(buf), at: ++clock, contentType: o.contentType });
      return { pathname, url: `https://store.${o.access}.blob.test/${pathname}`, etag: etagOf(buf) };
    },
    async get(pathname, o) {
      const f = files.get(pathname);
      if (!f || f.access !== o.access) return null;
      return { statusCode: 200, stream: new Response(f.buf).body, blob: { etag: f.etag, contentType: f.contentType } };
    },
    async list({ prefix }) {
      return { blobs: [...files.keys()].filter((k) => k.startsWith(prefix)).map((pathname) => ({ pathname, uploadedAt: new Date(files.get(pathname).at) })) };
    },
    async del(list) { for (const p of [].concat(list)) files.delete(p); }
  };
}
const addNote = (text) => (c) => { c.settings.notes = [...(c.settings.notes || []), text]; };

let blob;
test("a store with private and public files: the content is one private file; the site's snapshot is public", async () => {
  blob = fakeBlob(["private", "public"]);
  store.useBlobForTests(blob);
  assert.equal(await store.privateOk(), true);
  await store.mutateContent(addNote("one"));
  await store.mutateContent(addNote("two"));
  assert.equal(blob.files.get("proof/content.json").access, "private");
  assert.equal(blob.files.get("proof/published.json").access, "public");
  const { content, seeded } = await store.loadContent();
  assert.equal(seeded, false);
  assert.deepEqual(content.settings.notes, ["one", "two"]);
});

test("a store with public files only: numbered versions under a folder nobody can guess, never overwritten", async () => {
  blob = fakeBlob(["public"]);
  store.useBlobForTests(blob);
  assert.equal(await store.privateOk(), false);
  for (const n of ["a", "b", "c", "d", "e", "f", "g"]) await store.mutateContent(addNote(n));
  const versions = [...blob.files.keys()].filter((k) => /^proof\/content-[0-9a-f-]{36}\/\d{6}\.json$/.test(k)).sort();
  assert.equal(versions.length, 5, "the last five are kept");
  assert.match(versions.at(-1), /000007\.json$/);
  assert.ok([...blob.files.values()].every((f) => f.access === "public"));
  // a second instance finds the same folder by listing
  store.useBlobForTests(blob);
  assert.deepEqual((await store.loadContent()).content.settings.notes, ["a", "b", "c", "d", "e", "f", "g"]);
});

test("two saves at once: the one that loses reads again and keeps both changes", async () => {
  blob = fakeBlob(["public"]);
  store.useBlobForTests(blob);
  await store.mutateContent(addNote("first"));
  let raced = false;
  await store.mutateContent(async (c) => {
    if (!raced) { raced = true; await store.mutateContent(addNote("meanwhile")); }   // another save lands in between
    addNote("mine")(c);
  });
  assert.deepEqual((await store.loadContent()).content.settings.notes, ["first", "meanwhile", "mine"]);
});

test("the same race with the private file and its ETag", async () => {
  blob = fakeBlob(["private", "public"]);
  store.useBlobForTests(blob);
  await store.mutateContent(addNote("first"));
  let raced = false;
  await store.mutateContent(async (c) => {
    if (!raced) { raced = true; await store.mutateContent(addNote("meanwhile")); }
    addNote("mine")(c);
  });
  assert.deepEqual((await store.loadContent()).content.settings.notes, ["first", "meanwhile", "mine"]);
});

test("a store with private files only says what to do", async () => {
  blob = fakeBlob(["private"]);
  store.useBlobForTests(blob);
  await assert.rejects(store.mutateContent(addNote("x")), /public access/);
});
