// /api/meta-lead: where the Meta ads page (/customers, built from meta/) sends its Gap Check and call leads.
// The handler lives with the rest of that page, in meta/api/lead.mjs; Vercel bundles everything it imports.
// Open https://<the-site>/api/meta-lead for its health report.
import handler from "../meta/api/lead.mjs";

export default handler;
