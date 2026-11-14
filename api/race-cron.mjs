// /api/race-cron: the Review Race's daily job (follow-up emails, race updates, clearing old review text), run by Vercel
// Cron (vercel.json "crons") with CRON_SECRET. The handler lives in review-race/api/race-cron.mjs.
import handler from "../review-race/api/race-cron.mjs";

export default handler;
