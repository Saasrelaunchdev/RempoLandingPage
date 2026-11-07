#!/usr/bin/env node
// The lead library shared with the master page: api/_lib/lead-store.mjs, lead-fields.mjs and lead-notify.mjs must be
// byte-for-byte the master's (../api/_lib), so both sites store and announce leads the same way. If this fails, the
// master's library changed: run node tools/sync-shared.mjs, then run the tests again.
import { readFileSync, existsSync } from "node:fs";
import { SHARED, masterFile, copyFile } from "../tools/sync-shared.mjs";
let pass = 0, fail = 0;
for (const f of SHARED) {
  const same = existsSync(masterFile(f)) && existsSync(copyFile(f)) && readFileSync(masterFile(f)).equals(readFileSync(copyFile(f)));
  if (same) { pass++; console.log(`ok   api/_lib/${f} is the master page's`); } else { fail++; console.log(`FAIL api/_lib/${f} differs from ../api/_lib/${f}: run node tools/sync-shared.mjs`); }
}
console.log(`check-shared: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
