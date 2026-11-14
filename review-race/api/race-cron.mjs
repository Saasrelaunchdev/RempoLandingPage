// /api/race-cron: run once a day by Vercel Cron (vercel.json). Sends the follow-up emails that are due (day 2, day 5,
// day 9 when a case study link is set, and the race updates on day 14 and day 44), skips anyone who booked,
// unsubscribed or carries a stop tag in GoHighLevel, and clears old review text. Vercel sends
// "Authorization: Bearer <CRON_SECRET>" when CRON_SECRET is set; anything else is refused.
import { config as getConfig } from "./_lib/race/env.mjs";
import { send } from "./_lib/race/http.mjs";
import { openStore } from "./_lib/race/store.mjs";
import * as core from "./_lib/race/core.mjs";

export default async function handler(req, res) {
  const c = getConfig();
  if (!c.cronSecret || String(req.headers.authorization || "") !== `Bearer ${c.cronSecret}`) return send(res, 401, { error: "unauthorized" });
  try {
    const report = await core.cron({ c, store: openStore(c), svc: core.services(c) });
    console.log("race cron:", JSON.stringify(report));
    return send(res, 200, report);
  } catch (e) {
    console.error("race cron failed:", e.message);
    return send(res, 500, { error: e.message });
  }
}
