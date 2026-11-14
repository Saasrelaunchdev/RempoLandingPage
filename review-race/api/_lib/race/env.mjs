// Settings for the Review Race, read from the Vercel project's environment variables (never from the page).
// Every integration is optional except the four the race cannot run without (SerpApi, Google Places, Claude,
// Supabase): a part whose variables are missing is switched off and named in GET /api/race?action=health.
//
// RACE_FAKE=1 swaps every outside service for fixed sample data (api/_lib/race/fakes.mjs), so the whole flow runs
// with no keys: for local work, tests and a first look at a preview deployment. Nothing is sent anywhere in that mode.

const env = (n) => (process.env[n] ? String(process.env[n]).trim() : "");
const num = (n, d) => { const v = Number(env(n)); return Number.isFinite(v) && v > 0 ? v : d; };
const on = (n, d = true) => { const v = env(n).toLowerCase(); return v ? !["0", "false", "off", "no"].includes(v) : d; };
const url = (n, d) => (env(n) || d || "").replace(/\/+$/, "");

export function config() {
  const fake = on("RACE_FAKE", false);
  // The address in email links: RACE_PUBLIC_URL; else, on a Vercel preview, the branch's own URL (it stays the same
  // between pushes); else the project's production domain
  const vercelHost = (n) => (env(n) ? `https://${env(n)}` : "");
  const publicUrl = url("RACE_PUBLIC_URL", (env("VERCEL_ENV") === "preview" && vercelHost("VERCEL_BRANCH_URL")) || vercelHost("VERCEL_PROJECT_PRODUCTION_URL"));
  const siteUrl = url("RACE_SITE_URL", "https://rempo.io");
  return {
    fake,
    store: env("RACE_STORE") === "memory" || (fake && !env("SUPABASE_URL")) ? "memory" : "supabase",
    serpapiKey: env("SERPAPI_API_KEY"),
    placesKey: env("GOOGLE_PLACES_API_KEY"),
    // The business search: Google Places as the owner types, when its key is set; otherwise SerpApi, once the owner
    // presses Find (one search each). RACE_SEARCH=maps uses SerpApi even when the Google key is set.
    searchMode: env("RACE_SEARCH").toLowerCase() === "maps" || !(fake || env("GOOGLE_PLACES_API_KEY")) ? "maps" : "places",
    anthropicKey: env("ANTHROPIC_API_KEY"),
    supabase: { url: url("SUPABASE_URL"), key: env("SUPABASE_SECRET_KEY") || env("SUPABASE_SERVICE_ROLE_KEY") },
    resendKey: env("RESEND_API_KEY"),
    emailFrom: env("RACE_EMAIL_FROM"),
    replyTo: env("RACE_REPLY_TO"),
    notifyFrom: env("LEAD_NOTIFY_FROM") || env("RACE_EMAIL_FROM"),
    notifyTo: env("LEAD_NOTIFY_TO").split(",").map((s) => s.trim()).filter(Boolean),
    slackWebhook: env("SLACK_WEBHOOK_URL"),
    ghl: {
      token: env("GHL_TOKEN") || env("GHL_PRIVATE_TOKEN"), // GHL_TOKEN is the landing page's own name for it
      locationId: env("GHL_LOCATION_ID"),
      calendarId: env("GHL_CALENDAR_ID"),
      version: env("GHL_API_VERSION") || "2021-07-28",
      calendarVersion: env("GHL_CALENDAR_API_VERSION") || "2021-04-15",
      bookingUrl: env("GHL_BOOKING_URL"),
      stopTags: (env("GHL_STOP_TAGS") || "customer,client,race-booked,race-unsubscribed").split(",").map((s) => s.trim().toLowerCase()).filter(Boolean)
    },
    turnstile: { siteKey: env("TURNSTILE_SITE_KEY"), secret: env("TURNSTILE_SECRET_KEY") },
    cronSecret: env("CRON_SECRET"),
    linkSecret: env("RACE_LINK_SECRET") || env("CRON_SECRET") || env("SUPABASE_SECRET_KEY") || "review-race",
    hashSalt: env("LEAD_HASH_SALT") || "review-race",
    publicUrl,
    siteUrl,
    privacyUrl: url("RACE_PRIVACY_URL", `${siteUrl}/legal/privacy`),
    termsUrl: url("RACE_TERMS_URL", `${siteUrl}/legal/terms`),
    caseStudyUrl: url("RACE_CASE_STUDY_URL"),
    postalAddress: env("RACE_POSTAL_ADDRESS"),
    company: env("RACE_COMPANY") || "Rempo",
    effort: ["low", "medium", "high", "xhigh", "max"].includes(env("RACE_CLAUDE_EFFORT")) ? env("RACE_CLAUDE_EFFORT") : "medium",
    limits: {
      perIpPerDay: num("RACE_IP_DAILY", 5),
      perDay: num("RACE_DAILY_CAP", 40),
      cacheDays: num("RACE_CACHE_DAYS", 7)
    },
    nurture: on("RACE_NURTURE", true),
    updates: on("RACE_UPDATES", true),
    // The deployment that answered, for the health report
    deployment: { env: process.env.VERCEL_ENV || "local", branch: process.env.VERCEL_GIT_COMMIT_REF || "", commit: (process.env.VERCEL_GIT_COMMIT_SHA || "").slice(0, 7) }
  };
}

// What each part needs, and whether it is there: true or false only, never a value
export function parts(c = config()) {
  const has = (v) => Boolean(v && String(v).length);
  return {
    fake: c.fake,
    serpapi: c.fake || has(c.serpapiKey),
    places: c.fake || has(c.placesKey),
    claude: c.fake || has(c.anthropicKey),
    database: c.store === "memory" || (has(c.supabase.url) && has(c.supabase.key)),
    resultsEmail: c.fake || (has(c.resendKey) && has(c.emailFrom)),
    teamEmail: c.fake || (has(c.resendKey) && has(c.notifyFrom) && c.notifyTo.length > 0),
    slack: c.fake || /^https:\/\/hooks\.slack\.com\//.test(c.slackWebhook),
    crm: c.fake || (has(c.ghl.token) && has(c.ghl.locationId)),
    calendar: c.fake || (has(c.ghl.token) && has(c.ghl.locationId) && has(c.ghl.calendarId)),
    botCheck: c.fake ? false : has(c.turnstile.siteKey) && has(c.turnstile.secret),
    cron: has(c.cronSecret),
    links: has(c.publicUrl),
    postalAddress: has(c.postalAddress)
  };
}
