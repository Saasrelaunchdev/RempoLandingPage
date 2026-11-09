#!/usr/bin/env node
// Every check, in order. The browser check runs when Playwright is installed (it is in this repo's CI-like sessions).
//   node tests/run.mjs            (npm test)
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import path from "node:path";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const checks = ["check-gapcheck.mjs", "check-copy.mjs", "check-shared.mjs", "check-api.mjs", "check-build.mjs", "check-sql.mjs"];
try { createRequire(import.meta.url).resolve("playwright"); checks.push("check-page.mjs", "check-consent.mjs"); } catch { console.log("skip check-page.mjs and check-consent.mjs: Playwright is not installed"); }
let failed = 0;
for (const c of checks) {
  const r = spawnSync(process.execPath, [path.join(HERE, c)], { encoding: "utf8" });
  const last = (r.stdout || "").trim().split("\n").pop();
  const fails = (r.stdout || "").split("\n").filter((l) => l.startsWith("FAIL"));
  console.log(`${r.status === 0 ? "ok  " : "FAIL"} ${last || c}${r.status !== 0 && r.stderr ? `\n${r.stderr.trim().slice(0, 800)}` : ""}`);
  fails.forEach((f) => console.log(`       ${f}`));
  if (r.status !== 0) failed++;
}
console.log(failed ? `${failed} of ${checks.length} checks failed` : `all ${checks.length} checks passed`);
process.exit(failed ? 1 : 0);
