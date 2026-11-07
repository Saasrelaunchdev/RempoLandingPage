#!/usr/bin/env node
// Copies the master page's lead library (../api/_lib/lead-store.mjs, lead-fields.mjs, lead-notify.mjs) into this
// project's api/_lib/, so both sites store leads and send notices the same way while each deploys on its own.
// tests/check-shared.mjs fails when the copies drift. Run this after the master page's library changes:
//   node tools/sync-shared.mjs
import { copyFileSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
export const SHARED = ["lead-store.mjs", "lead-fields.mjs", "lead-notify.mjs"];
export const masterFile = (f) => path.join(ROOT, "..", "api", "_lib", f);
export const copyFile = (f) => path.join(ROOT, "api", "_lib", f);

if (import.meta.url === `file://${process.argv[1]}`) {
  for (const f of SHARED) {
    copyFileSync(masterFile(f), copyFile(f));
    console.log(`copied ../api/_lib/${f} -> api/_lib/${f} (${readFileSync(copyFile(f)).length} bytes)`);
  }
}
