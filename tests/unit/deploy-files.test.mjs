// What Vercel uploads, checked. .vercelignore must keep out only what it means to (sources, docs, tests, tools), never a
// file the site serves or a function imports. Git's own matching is used: Vercel reads .vercelignore with the same rules.
//
// Why this test exists: on Nov 13, 2026 the line "hero-video/" (meant for the film's sources at the root) also matched
// media/hero-video/, so the story film was left out of every deployment and its dialog opened black, in preview and in
// production; "checkout/" also dropped api/_lib/checkout/. Locally everything worked, because the dev server reads the
// repository, not the upload.
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, normalize, relative } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));
const git = (args, input) => execFileSync("git", ["-C", ROOT, ...args], { encoding: "utf8", input, maxBuffer: 1 << 26 });
const tracked = git(["ls-files"]).split("\n").filter(Boolean);

// The tracked files .vercelignore keeps out of the upload
const dropped = (() => {
  let out = "";
  try {
    out = git(["-c", `core.excludesFile=${join(ROOT, ".vercelignore")}`, "check-ignore", "--no-index", "--stdin", "-v"], tracked.join("\n"));
  } catch (e) {
    if (e.status === 1) return new Set();   // exit 1: nothing matched
    throw e;
  }
  return new Set(out.split("\n").filter((l) => l.split("\t")[0].includes(".vercelignore")).map((l) => l.split("\t")[1]));
})();
const uploaded = (p) => tracked.includes(p) && !dropped.has(p);

test("everything the site serves is uploaded: pages, assets, media (the story film too), functions", () => {
  const served = tracked.filter((p) => /^(api|assets|media|start|customers|legal|admin)\//.test(p));
  assert.ok(served.some((p) => p.startsWith("media/hero-video/")), "the story film is not in the repository");
  const missing = served.filter((p) => dropped.has(p));
  assert.deepEqual(missing, [], `.vercelignore keeps these out of the deployment: ${missing.join(", ")}`);
  for (const p of ["index.html", "vercel.json", "package.json", "package-lock.json"]) assert.ok(uploaded(p), `${p} is not uploaded`);
});

test("every module a function imports is uploaded", () => {
  const seen = new Set();
  const queue = tracked.filter((p) => /^api\/[^/]+\.mjs$/.test(p));
  const IMPORT = /(?:\bimport|\bexport)\s[^'"]*?\bfrom\s*["'](\.{1,2}\/[^"']+)["']|\bimport\(\s*["'](\.{1,2}\/[^"']+)["']\s*\)/g;
  while (queue.length) {
    const file = queue.shift();
    if (seen.has(file)) continue;
    seen.add(file);
    assert.ok(uploaded(file), `${file} is imported by a function but not uploaded`);
    for (const m of readFileSync(join(ROOT, file), "utf8").matchAll(IMPORT)) {
      const target = relative(ROOT, normalize(join(ROOT, dirname(file), m[1] || m[2]))).split("\\").join("/");
      if (existsSync(join(ROOT, target))) queue.push(target);
    }
  }
  assert.ok(seen.has("api/_lib/checkout/stripe.mjs"), "the import walk did not reach the checkout's modules");
  assert.ok(seen.has("review-race/api/_lib/race/core.mjs"), "the import walk did not reach the Review Race's function (the Meta page's)");
});

test("what is meant to stay out still stays out", () => {
  for (const dir of ["hero-video/", "checkout/", "tests/", "tools/", "lead-capture/", "legal-src/", ".claude/", "meta/", "review-race/public/", "review-race/tests/", "review-race/tools/"]) {
    const files = tracked.filter((p) => p.startsWith(dir));
    const kept = files.filter((p) => !dropped.has(p));
    assert.deepEqual(kept, [], `${dir} is meant to stay out of the deployment, but these would be uploaded: ${kept.join(", ")}`);
  }
  for (const p of ["CLAUDE.md", "PROOF.md"]) assert.ok(dropped.has(p), `${p} would be uploaded`);
});
