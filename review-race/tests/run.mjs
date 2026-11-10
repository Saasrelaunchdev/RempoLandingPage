// npm test: every check, each file in its own process so their settings never mix.
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const DIR = path.dirname(fileURLToPath(import.meta.url));
const files = ["metrics.test.mjs", "copy.test.mjs", "api.test.mjs", "page.test.mjs"];
let failed = 0;
for (const f of files) {
  const r = spawnSync(process.execPath, [path.join(DIR, f)], { stdio: ["ignore", "pipe", "pipe"], encoding: "utf8", env: { ...process.env } });
  const out = `${r.stdout || ""}${r.stderr || ""}`;
  const summary = out.split("\n").filter((l) => /: \d+ passed, \d+ failed|FAIL|skipped|Error/.test(l));
  console.log(summary.join("\n") || out.trim().split("\n").slice(-3).join("\n"));
  if (r.status !== 0) failed += 1;
}
console.log(failed ? `\n${failed} test file(s) failed` : "\nAll checks passed");
process.exit(failed ? 1 : 0);
