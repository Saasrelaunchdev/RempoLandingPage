// /api/race: the Review Race, which the Meta ads page (/customers, built from meta/) runs in place of the Gap Check
// since 2026-11-14. The handler lives with the rest of the tool, in review-race/api/race.mjs; Vercel bundles everything
// it imports. Open https://<the-site>/api/race?action=health to see which parts are set up (true or false, never a value).
import handler from "../review-race/api/race.mjs";

export default handler;
