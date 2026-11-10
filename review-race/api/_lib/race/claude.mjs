// Claude writes the words of the race: three fixes, a reply draft for each picked review, and the themes. It never
// computes a number: it is handed the numbers metrics.mjs measured and writes about them. Every answer is JSON in a
// fixed schema (structured outputs), checked against Rempo's claim rules and the reply rules before anyone sees it;
// a line that fails is dropped and replaced by a rule-based line (copy.mjs).
//
// Same setup as the landing page's /admin (api/_lib/proof/claude.mjs): the same model, effort set explicitly,
// the system prompt cached, and fallbacks: "default" so a declined request re-runs on Anthropic's fallback model.
import Anthropic from "@anthropic-ai/sdk";
import { lintCopy, lintReply } from "./lint.mjs";

export const MODEL = "claude-opus-5-5";
const BETAS = ["server-side-fallback-2026-07-01"];

let client = null;
let clientKey = "";
const anthropic = (key) => {
  if (!client || clientKey !== key) { client = new Anthropic({ apiKey: key, maxRetries: 2, timeout: 110000 }); clientKey = key; }
  return client;
};

/* ---------- The schema (every object closed, every field required) ---------- */
const obj = (props) => ({ type: "object", additionalProperties: false, required: Object.keys(props), properties: props });
const str = { type: "string" };
const AREAS = ["Momentum", "Care", "Trust", "First impression"];
export const SCHEMA = obj({
  summary: str,
  fixes: { type: "array", items: obj({ area: { type: "string", enum: AREAS }, title: str, why: str, firstStep: str }) },
  drafts: { type: "array", items: obj({ reviewId: str, reply: str, callFirst: { type: "boolean" } }) },
  praise: { type: "array", items: str },
  complaints: { type: "array", items: obj({ theme: str, count: { type: "integer" } }) }
});

export const SYSTEM = `You write the analysis inside Rempo's Review Race, a free tool for owners of home-service businesses (HVAC, plumbing and similar trades) in the United States. The owner has just compared their Google reviews with the three businesses a homeowner sees first when searching their category near them. You receive the measured numbers and the owner's own recent reviews, and you write three fixes, a reply draft for each review in reviews_to_answer, and the themes in their reviews.

Who reads it: the owner, on a phone, between jobs. Proud of the work, short on time, wary of marketing companies. Write plainly, in short sentences, in the second person ("you", "your customers"). No jargon, no hype, no exclamation marks.

Numbers:
- Use only numbers that appear in the input, exactly as given. Never work out new numbers, percentages or estimates.
- Write shares as counts ("7 of your last 30 reviews"), never as percentages.
- The only statistics you may cite are these three, word for word, each with its source in the same sentence, and at most one of them in total:
  "74% of consumers look for reviews from the last three months (BrightLocal 2026)"
  "80% of consumers are more likely to use a business that replies to all its reviews (BrightLocal 2026)"
  "50% of consumers are put off by generic or templated replies (BrightLocal 2026)"

Strict rules:
- Never promise or predict results: no more reviews, higher ratings, better rankings, more calls, more jobs or more revenue. Describe what the owner controls: asking every customer, following up once, replying to every review.
- Never write these phrases: "more reviews", "new reviews", "get reviews", "extra reviews", "reviews a month", "rank higher", "guarantee", "instant", "automatic", "autopilot", "reputation management", "leverage", "unlock", "seamless", "robust", "streamline", "empower".
- Never suggest asking only happy customers, offering anything in return for a review, asking customers to mention a staff member by name, suggesting what a customer should write, setting review targets for staff, or removing reviews.
- Never blame staff or crews. When asking slips, it is because the shop is busy.
- Never mention Rempo, prices, plans, or any software by name. The fixes are advice the owner can follow alone.
- No em dashes or en dashes. Use commas, colons or periods.

The three fixes:
- Exactly three, the most important first. area is one of: "Momentum" (reviews in the last 90 days and how recent the newest one is), "Care" (how many reviews got a reply), "Trust" (total reviews and the star cushion), "First impression" (star rating and profile basics).
- title: at most eight words, an action, in sentence case ("Answer every review within two days").
- why: one or two sentences that set one of the owner's numbers next to the rivals' number from the input.
- firstStep: one concrete thing the owner can do this week, without buying anything.
- Be honest. Where the owner is level with or ahead of the rivals, say so and make that fix about keeping it. Never invent a gap.

The reply drafts, one for each review in reviews_to_answer, with its id as reviewId:
- Written as the owner, using "we" and "our team". Two or three sentences, under 60 words.
- Thank the reviewer by first name when one is given, and mention one specific thing they said.
- For 1 to 3 stars: stay calm, acknowledge what they said without arguing or making excuses, and invite them to call the office so you can make it right. Set callFirst to true. Never admit legal fault, and never mention prices, refunds, discounts or anything in return, and never ask them to change or remove the review.
- For 4 or 5 stars: warm and specific, never generic. Set callFirst to false.
- Never add details the reviewer did not write: no job details, dates, addresses, staff names, or anything personal about the customer.
- Start each reply differently. Avoid stock lines such as "We appreciate your feedback" or "Sorry for any inconvenience".
- If a review has no text, write a short thank-you for the stars.

Themes:
- praise: up to three short phrases (three to six words each) for what customers praise again and again in the owner's reviews.
- complaints: themes that appear in at least two of the owner's reviews in the input, each with the number of reviews that mention it. Empty when there are none.
- summary: one sentence, under 25 words, saying where the owner stands in the race, with one number from the input.`;

const fail = (message, status = 502, code = "claude") => Object.assign(new Error(message), { status, code });

export async function analyze({ key, effort = "medium", input, deadline }) {
  const left = deadline ? deadline - Date.now() : 100000;
  if (left < 15000) throw fail("Not enough time left in this request for Claude to answer.", 504, "timeout");
  let msg;
  try {
    const stream = anthropic(key).beta.messages.stream({
      model: MODEL,
      max_tokens: 12000,
      betas: BETAS,
      fallbacks: "default",
      system: [{ type: "text", text: SYSTEM, cache_control: { type: "ephemeral" } }],
      output_config: { effort, format: { type: "json_schema", schema: SCHEMA } },
      messages: [{ role: "user", content: [{ type: "text", text: `<race>\n${JSON.stringify(input)}\n</race>\nWrite the summary, the three fixes, a reply draft for each review in reviews_to_answer, and the themes.` }] }]
    }, { signal: AbortSignal.timeout(Math.max(10000, left - 5000)) });
    msg = await stream.finalMessage();
  } catch (e) {
    if (e instanceof Anthropic.APIError) throw fail(`Claude could not answer (HTTP ${e.status ?? "error"}): ${String(e.message).slice(0, 240)}`, e.status === 429 || e.status === 529 ? 503 : 502);
    if (e && (e.name === "AbortError" || e.name === "TimeoutError" || e instanceof Anthropic.APIUserAbortError)) throw fail("Claude took too long to answer.", 504, "timeout");
    throw e;
  }
  if (msg.stop_reason === "refusal") throw fail("Claude declined this one.", 422, "refusal");
  if (msg.stop_reason === "max_tokens") throw fail("Claude's answer was cut off.", 502, "max-tokens");
  // A model that declined part way leaves a fallback block; the answer is what came after the last one
  let from = 0;
  msg.content.forEach((b, i) => { if (b.type === "fallback") from = i + 1; });
  const text = msg.content.slice(from).filter((b) => b.type === "text").map((b) => b.text).join("");
  let data;
  try { data = JSON.parse(text); } catch { throw fail("Claude's answer was not the JSON it was asked for."); }
  const u = msg.usage || {};
  console.log(`claude ${msg.model} in=${u.input_tokens} cached=${u.cache_read_input_tokens || 0} out=${u.output_tokens}`);
  return { data, model: msg.model, usage: { input: u.input_tokens || 0, output: u.output_tokens || 0, cached: u.cache_read_input_tokens || 0 } };
}

// Keeps only what passes the rules. Returns the clean analysis and what was dropped, and why.
export function check(data, { picks = [], maxComplaint = 30 } = {}) {
  const dropped = [];
  const ok = (text, where) => { const e = lintCopy(text, { stats: true }); if (e.length) dropped.push({ where, errors: e }); return e.length === 0; };
  const d = data && typeof data === "object" ? data : {};
  const fixes = (Array.isArray(d.fixes) ? d.fixes : []).filter((f, i) => {
    const where = `fix ${i + 1}`;
    if (!f || !AREAS.includes(f.area)) { dropped.push({ where, errors: ["not one of the four areas"] }); return false; }
    if (!/\d/.test(String(f.why))) { dropped.push({ where, errors: ["the why cites no number"] }); return false; }
    if (String(f.title).split(/\s+/).length > 10) { dropped.push({ where, errors: ["title over ten words"] }); return false; }
    return ok(f.title, `${where} title`) && ok(f.why, `${where} why`) && ok(f.firstStep, `${where} first step`);
  }).slice(0, 3);
  const ids = new Set(picks.map((p) => p.id));
  const seen = new Set();
  const drafts = (Array.isArray(d.drafts) ? d.drafts : []).filter((x, i) => {
    if (!x || !ids.has(x.reviewId) || seen.has(x.reviewId)) { dropped.push({ where: `draft ${i + 1}`, errors: ["not one of the picked reviews"] }); return false; }
    const e = lintReply(x.reply);
    if (e.length) { dropped.push({ where: `draft ${i + 1}`, errors: e }); return false; }
    seen.add(x.reviewId);
    return true;
  }).map((x) => ({ reviewId: x.reviewId, reply: x.reply.trim(), callFirst: Boolean(x.callFirst) }));
  const praise = (Array.isArray(d.praise) ? d.praise : []).filter((p, i) => typeof p === "string" && p.length <= 60 && ok(p, `praise ${i + 1}`)).slice(0, 3);
  const complaints = (Array.isArray(d.complaints) ? d.complaints : [])
    .filter((c, i) => c && typeof c.theme === "string" && Number.isInteger(c.count) && c.count >= 2 && c.count <= maxComplaint && ok(c.theme, `complaint ${i + 1}`)).slice(0, 3);
  const summary = typeof d.summary === "string" && ok(d.summary, "summary") ? d.summary.trim() : "";
  return { analysis: { summary, fixes, drafts, praise, complaints }, dropped };
}
