// Claude, for the uploads: it reads a document and writes the case study, looks at a video's stills (is it mirrored,
// where is the face, which still makes the cover), and tidies a transcript (misheard names, the quote, the intro).
// Every answer is JSON in a fixed schema (structured outputs). Opus 5.5 thinks before it answers; effort sets how much.
// fallbacks: "default" lets the API re-run a declined request on Anthropic's recommended fallback model.
import Anthropic from "@anthropic-ai/sdk";
import { INDUSTRY_ICONS } from "../../../assets/proof-shell.mjs";
import { CASE_SYSTEM, SPLIT_SYSTEM, LOOK_SYSTEM, TIDY_SYSTEM, SCHEMA_TYPES } from "./prompts.mjs";

export const MODEL = "claude-opus-5-5";
const BETAS = ["server-side-fallback-2026-07-01"];
const env = (n) => (process.env[n] ? String(process.env[n]).trim() : "");
export const claudeConfigured = () => Boolean(env("ANTHROPIC_API_KEY"));

let client = null;
const anthropic = () => (client ||= new Anthropic({ maxRetries: 2, timeout: 280000 }));

/* ---------- Schemas (structured outputs: every object closed, every field required) ---------- */
const obj = (props) => ({ type: "object", additionalProperties: false, required: Object.keys(props), properties: props });
const str = { type: "string" };
const int = { type: "integer" };
const num = { type: "number" };
const bool = { type: "boolean" };
const arr = (items) => ({ type: "array", items });
const BOX = obj({ x: num, y: num, w: num, h: num });
const BIG = obj({ big: str, label: str });
const SHOT = obj({ image: int, crop: BOX, count: BOX, alt: str });

const CASE = obj({
  business: obj({
    name: str, short: str, nick: str, industry: str, icon: { type: "string", enum: INDUSTRY_ICONS }, owner: str,
    city: str, region: str, regionCode: str, country: str, area: str, areaServed: arr(str), schemaType: { type: "string", enum: SCHEMA_TYPES }
  }),
  card: obj({ tag: str, line: str, stats: arr(BIG) }),
  hero: obj({ h1: str, lead: str, facts: arr(BIG) }),
  gbp: obj({ rating: str, count: str, was: str, kind: str }),
  numbers: obj({ before: int, after: int, gained: int, pill: str, beforeCaption: str, afterCaption: str }),
  sceneLabel: str,
  glance: arr(obj({ dt: str, dd: str })),
  chapters: obj({
    before: obj({ label: str, h2: str, lead: str, paras: arr(str), miss: obj({ items: arr(obj({ text: str, miss: bool })), big: str, small: str }) }),
    did: obj({ label: str, h2: str, lead: str, paras: arr(str), steps: arr(obj({ h: str, p: str })) }),
    result: obj({ label: str, h2: str, lead: str, paras: arr(str), proofTabs: arr(str), proofCap: obj({ bold: str, rest: str }), stat: BIG })
  }),
  payoff: obj({ lead: str, accent: str }),
  note: str,
  seo: obj({ title: str, description: str, ogTitle: str }),
  pictures: obj({ before: SHOT, after: SHOT, photo: obj({ image: int, box: BOX }) }),
  readFromPictures: arr(obj({ number: str, where: str })),
  notes: str
});
const SPLIT = obj({ businesses: arr(obj({ name: str, images: arr(int), story: str })), notes: str });
const LOOK = obj({ mirrored: bool, poster: int, face: BOX, textSeen: arr(str), notes: str });
const SPAN = obj({ from: int, to: int });
const TIDY = obj({
  fixes: arr(obj({ i: int, w: str })), drop: arr(int),
  person: obj({ name: str, role: str, business: str, location: str }), caseStudy: str,
  quote: SPAN, quoteLong: SPAN, intro: str, title: str, summary: str, notes: str
});

/* ---------- One request ---------- */
const fail = (message, status = 502, code = "claude") => Object.assign(new Error(message), { status, code });

async function ask({ system, content, schema, effort, maxTokens, deadline }) {
  if (!claudeConfigured()) throw fail("Claude is not set up: set ANTHROPIC_API_KEY.", 503, "not-configured");
  const left = deadline ? deadline - Date.now() : 240000;
  if (left < 15000) throw fail("Not enough time left in this request for Claude to answer.", 504, "timeout");
  let msg;
  try {
    const stream = anthropic().beta.messages.stream({
      model: MODEL,
      max_tokens: maxTokens,
      betas: BETAS,
      fallbacks: "default",
      system: [{ type: "text", text: system, cache_control: { type: "ephemeral" } }],
      output_config: { effort, format: { type: "json_schema", schema } },
      messages: [{ role: "user", content }]
    }, { signal: AbortSignal.timeout(left - 5000) });
    msg = await stream.finalMessage();
  } catch (e) {
    if (e instanceof Anthropic.APIError) throw fail(`Claude could not answer (HTTP ${e.status ?? "error"}): ${String(e.message).slice(0, 240)}`, e.status === 429 || e.status === 529 ? 503 : 502);
    if (e && (e.name === "AbortError" || e.name === "TimeoutError" || e instanceof Anthropic.APIUserAbortError)) throw fail("Claude took too long to answer.", 504, "timeout");
    throw e;
  }
  if (msg.stop_reason === "refusal") throw fail("Claude declined to write this one. Check the upload, or write it by hand in the editor.", 422, "refusal");
  if (msg.stop_reason === "max_tokens") throw fail("Claude's answer was cut off before it finished.", 502, "max-tokens");
  // A model that declined part way leaves a fallback block; the answer is what came after the last one
  let from = 0;
  msg.content.forEach((b, i) => { if (b.type === "fallback") from = i + 1; });
  const text = msg.content.slice(from).filter((b) => b.type === "text").map((b) => b.text).join("");
  let data;
  try { data = JSON.parse(text); } catch { throw fail("Claude's answer was not the JSON it was asked for."); }
  const u = msg.usage || {};
  console.log(`claude ${msg.model} in=${u.input_tokens} cached=${u.cache_read_input_tokens || 0} out=${u.output_tokens}`);
  return { data, model: msg.model };
}

const image = (buffer, mediaType) => ({ type: "image", source: { type: "base64", media_type: mediaType, data: Buffer.from(buffer).toString("base64") } });
const pdf = (buffer) => ({ type: "document", source: { type: "base64", media_type: "application/pdf", data: Buffer.from(buffer).toString("base64") } });
const text = (t) => ({ type: "text", text: t });

// The upload as Claude reads it: the text (with [image N] where each picture was), each picture under its number, and
// any PDF that has no text of its own (a scan). The last block is cached, so a second call on the same upload is cheap.
function uploadBlocks({ text: body, images = [], pdfs = [] }) {
  const blocks = [text(`<upload>\n${String(body || "").slice(0, 180000)}\n</upload>`)];
  for (const p of pdfs) blocks.push(pdf(p.buffer));
  for (const im of images) blocks.push(text(`[image ${im.n}]${im.name ? ` (${im.name})` : ""}`), image(im.buffer, im.mediaType || "image/webp"));
  blocks[blocks.length - 1] = { ...blocks[blocks.length - 1], cache_control: { type: "ephemeral" } };
  return blocks;
}

function knownBlock(known = {}) {
  const cases = (known.cases || []).map((c) => `- ${c.slug}: ${c.name}${c.city ? `, ${c.city}` : ""}${c.owner ? ` (owner: ${c.owner})` : ""}`).join("\n");
  const videos = (known.videos || []).map((v) => `- ${v.name}, ${v.role}${v.business ? ` (${v.business})` : ""}`).join("\n");
  return `<on_the_site>\nCase studies:\n${cases || "- none yet"}\nVideo testimonials:\n${videos || "- none yet"}\n</on_the_site>`;
}

/* ---------- Documents ---------- */
export async function splitUpload(upload, { deadline } = {}) {
  const content = [...uploadBlocks(upload), text("List the businesses in this upload that have a review story.")];
  const { data } = await ask({ system: SPLIT_SYSTEM, content, schema: SPLIT, effort: "low", maxTokens: 8000, deadline });
  return data;
}

function caseTask({ business, known, testimonial }) {
  const video = testimonial
    ? `\n<owner_video>\n${testimonial.name}, ${testimonial.role}, has a video testimonial on the site. What they said, word for word:\n${testimonial.transcript}\n</owner_video>`
    : "";
  return `Write the case study for ${business.name}${business.story ? ` (${business.story})` : ""}.${business.images && business.images.length ? ` Its pictures are probably ${business.images.map((n) => `[image ${n}]`).join(", ")}.` : ""}
${knownBlock(known)}${video}
Answer with this one business's case study.`;
}

// Medium effort fits a case study, a fix round and the pictures into one function's 300 seconds. On a plan with longer
// functions, PROOF_CLAUDE_EFFORT=high gives Claude more room to think.
const WRITE_EFFORT = ["low", "medium", "high", "xhigh", "max"].includes(env("PROOF_CLAUDE_EFFORT")) ? env("PROOF_CLAUDE_EFFORT") : "medium";

export async function draftCaseStudy(upload, task, { deadline } = {}) {
  const content = [...uploadBlocks(upload), text(caseTask(task))];
  return ask({ system: CASE_SYSTEM, content, schema: CASE, effort: WRITE_EFFORT, maxTokens: 32000, deadline });
}

export async function repairCaseStudy(upload, task, draft, issues, { deadline } = {}) {
  const list = issues.map((i) => `- ${i.field}: ${i.message}`).join("\n");
  const content = [...uploadBlocks(upload), text(`${caseTask(task)}

This draft was written for it, and the page checks found these problems:
${list}

<draft>
${JSON.stringify(draft)}
</draft>

Answer with the whole case study again, with every problem fixed and everything else kept as it is. A number that is not in the upload comes out (or is replaced by one that is); it is never kept by putting it in readFromPictures unless a picture shows it.`)];
  return ask({ system: CASE_SYSTEM, content, schema: CASE, effort: "medium", maxTokens: 32000, deadline });
}

/* ---------- Videos ---------- */
export async function lookAtVideo({ stills, times, hints = {} }, { deadline } = {}) {
  const content = [];
  stills.forEach((s, i) => content.push(text(`Still ${i} (at ${times[i].toFixed(1)} s)`), image(s, "image/jpeg")));
  const h = [hints.name && `the speaker is ${hints.name}`, hints.business && `the business is ${hints.business}`].filter(Boolean).join("; ");
  content.push(text(`Look at these ${stills.length} stills.${h ? ` The admin says ${h}.` : ""}`));
  const { data } = await ask({ system: LOOK_SYSTEM, content, schema: LOOK, effort: "low", maxTokens: 8000, deadline });
  return data;
}

export async function tidyTranscript({ words, hints = {}, textSeen = [], known = {}, caseStudies = [] }, { deadline } = {}) {
  const list = words.map((w, i) => `${i} ${w.w}`).join("\n");
  const cs = caseStudies.map((c) => `<case_study slug="${c.slug}">\n${c.summary}\n</case_study>`).join("\n");
  const h = [hints.name && `Speaker: ${hints.name}`, hints.role && `Role: ${hints.role}`, hints.business && `Business: ${hints.business}`].filter(Boolean).join("\n");
  const content = [text(`<words>\n${list}\n</words>
${h ? `<hints>\n${h}\n</hints>\n` : ""}${textSeen.length ? `<text_seen_in_the_video>\n${textSeen.join("\n")}\n</text_seen_in_the_video>\n` : ""}${knownBlock(known)}
${cs}
Prepare this testimonial.`)];
  return ask({ system: TIDY_SYSTEM, content, schema: TIDY, effort: "medium", maxTokens: 16000, deadline });
}
