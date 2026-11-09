// Stand-ins for Claude and the transcription with fixed, plausible answers, so an upload runs end to end with no keys
// and no network: `PROOF_FAKE_AI=1 npm run dev`, and the tests. They answer in the same shapes as the real ones.
//
// The transcription "hears" German Aquino's testimonial (with his name misheard, as the real service did) spread over
// the audio's length. Claude knows the first two case studies from the original document; any other business gets a
// case study built from the numbers in its text ("from 12 to 40 Google reviews ... 28 new reviews ... in three months").
import { setProviders } from "../api/_lib/proof/providers.mjs";
import { asDraft, EXAMPLE_PICTURES } from "../api/_lib/proof/prompts.mjs";
import { SEED_CASES, SEED_TESTIMONIALS } from "../api/_lib/proof/seed.mjs";
import { alignWords } from "../api/_lib/proof/stt.mjs";
import { sameBusiness } from "../api/_lib/proof/items.mjs";

const SAID = SEED_TESTIMONIALS[0].transcript.replace("German Aquino", "Herman Aquino");
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const delay = () => wait(Number(process.env.PROOF_FAKE_DELAY_MS ?? 300));

export const fakeStt = {
  sttConfigured: () => true,
  async transcribe(audio) {
    await delay();
    const seconds = Math.max(4, audio.length / 4000);   // 32 kbit/s
    const toks = SAID.split(/\s+/);
    const step = (seconds - 1) / toks.length;
    const words = toks.map((t, i) => ({ word: t.replace(/[^\w'-]/g, ""), start: 0.5 + i * step, end: 0.5 + i * step + step * 0.8 }));
    return { text: SAID, words: alignWords(SAID, words), language: "en" };
  }
};

const findSpan = (words, first, last) => {
  const from = words.findIndex((w, i) => w.w.replace(/\W/g, "") === first[0] && (words[i + 1] || {}).w?.replace(/\W/g, "") === first[1]);
  if (from < 0) return { from: 0, to: Math.min(words.length - 1, 12) };
  const to = words.findIndex((w, i) => i > from && w.w.replace(/\W/g, "").toLowerCase() === last);
  return { from, to: to < 0 ? Math.min(words.length - 1, from + 14) : to };
};

function genericDraft(name, text) {
  const t = String(text);
  const range = /from (\d+) to (\d+)/i.exec(t);
  const before = range ? Number(range[1]) : -1, after = range ? Number(range[2]) : 0;
  const gained = Number((/(\d+) new/i.exec(t) || [])[1] ?? (after - Math.max(0, before)));
  const period = (/in (?:their first |the first )?((?:one|two|three|four|five|six|seven|eight|nine|ten|twelve) (?:days?|weeks?|months?))/i.exec(t) || [])[1] || "three months";
  const city = (/located in ([A-Z][a-zA-Z ]+?),? (California|Texas|Oregon|Washington|Florida|New York)/.exec(t) || []);
  const short = name.replace(/\s+(LLC|Inc\.?)$/i, "");
  const P = period.charAt(0).toUpperCase() + period.slice(1);
  return {
    business: { name, short, nick: short.split(" ")[0], industry: "Home services", icon: "i-building", owner: "", city: city[1] || "", region: city[2] || "", regionCode: city[2] === "California" ? "CA" : "", country: "US", area: "", areaServed: [], schemaType: "LocalBusiness" },
    card: { tag: P, line: `${short} asked after each job. Rempo handled the follow-up.`, stats: [{ big: `+${gained}`, label: "new Google reviews" }, { big: String(after), label: "Google reviews in all" }] },
    hero: { h1: `From ${before} to ${after} Google reviews in ${period}.`, lead: `${short} had ${before} Google reviews. Rempo took over the follow-up.`, facts: [{ big: `+${gained}`, label: "new Google reviews" }, { big: String(after), label: `Google reviews, up from ${before}` }, { big: P, label: "with Rempo" }] },
    gbp: { rating: "", count: String(after), was: before >= 0 ? String(before) : "", kind: "" },
    numbers: { before, after, gained, pill: `+${gained}`, beforeCaption: "Before Rempo", afterCaption: `${P} with Rempo` },
    sceneLabel: `${short}'s Google reviews: ${before} before Rempo; ${after} after ${period} with Rempo, ${gained} of them new.`,
    glance: [{ dt: "The business", dd: name }, { dt: "Based in", dd: [city[1], city[2]].filter(Boolean).join(", ") || "Not stated" }, { dt: "Serves", dd: "Its local area" }, { dt: "Before Rempo", dd: `${before} Google reviews` }],
    chapters: {
      before: { label: "Before Rempo", h2: "The work was good. The reviews were few.", lead: `${short} had ${before} Google reviews before Rempo.`, paras: [], miss: { items: [{ text: "Customers were happy", miss: false }, { text: "Some said they would leave a review", miss: false }, { text: "Most never got to it", miss: true }], big: String(before), small: "Google reviews before Rempo" } },
      did: { label: "What Rempo did", h2: "Rempo took over the follow-up.", lead: "Customers got a review request after the job, and a reminder if they had not left one.", paras: [], steps: [{ h: "A review request", p: "After the job, customers got a request to share their experience on Google." }, { h: "A reminder", p: "Anyone who had not left one got a reminder." }, { h: "Nothing to track", p: "Nobody on the team had to keep track." }] },
      result: { label: "The result", h2: `${gained} new Google reviews in ${period}.`, lead: `In ${period} with Rempo, ${short} went from ${before} to ${after} Google reviews.`, paras: [], proofTabs: ["Before Rempo", `After ${period}`], proofCap: { bold: "Their Google profile, as customers see it.", rest: `Screenshots from Google, before Rempo and after ${period}.` }, stat: { big: `+${gained}`, label: "new Google reviews" } }
    },
    payoff: { lead: "The customers were already happy.", accent: "Rempo made sure they were asked." },
    note: `Review counts from ${short}'s Google Business Profile, before Rempo and after ${period}.`,
    seo: { title: `${short}: ${before} to ${after} Google reviews · Rempo case study`, description: `${short} went from ${before} to ${after} Google reviews in ${period} with Rempo running the follow-up.`, ogTitle: `${short}: from ${before} to ${after} Google reviews` },
    pictures: { before: { image: -1, crop: { x: 0, y: 0, w: 1, h: 1 }, count: { x: 0, y: 0, w: 0, h: 0 }, alt: "" }, after: { image: -1, crop: { x: 0, y: 0, w: 1, h: 1 }, count: { x: 0, y: 0, w: 0, h: 0 }, alt: "" }, photo: { image: -1, box: { x: 0, y: 0, w: 0, h: 0 } } },
    readFromPictures: [],
    notes: ""
  };
}

export const fakeClaude = {
  claudeConfigured: () => true,
  async lookAtVideo({ stills }) {
    await delay();
    return { mirrored: false, poster: Math.min(2, stills.length - 1), face: { x: 0.3, y: 0.16, w: 0.4, h: 0.28 }, textSeen: ["RANCHERO"], notes: "" };
  },
  async tidyTranscript({ words }) {
    await delay();
    const fixes = words.map((w, i) => (/^Herman/.test(w.w) ? { i, w: w.w.replace("Herman", "German") } : null)).filter(Boolean);
    const quote = findSpan(words, ["We", "went"], "week");
    const quoteLong = findSpan(words, ["We", "went"], "system");
    return {
      model: "fake",
      data: {
        fixes, drop: [],
        person: { name: "German Aquino", role: "Owner, Ranchero Plumbing", business: "Ranchero Plumbing", location: "Half Moon Bay, CA" },
        caseStudy: "ranchero-plumbing", quote, quoteLong,
        intro: "German Aquino owns Ranchero Plumbing in Half Moon Bay. Rempo set up their review system. Here is the first week, in German's words.",
        title: "German Aquino, owner of Ranchero Plumbing, on Rempo",
        summary: "German Aquino on the first week of Rempo's review system for Ranchero Plumbing.",
        notes: ""
      }
    };
  },
  async splitUpload({ text }) {
    await delay();
    const seeds = SEED_CASES.filter((cs) => text.includes(cs.business.short.split(" ")[0]));
    if (seeds.length) return { businesses: seeds.map((cs) => ({ name: cs.business.name, images: Object.values(EXAMPLE_PICTURES[cs.slug].pictures).map((p) => p.image), story: cs.hero.lead })), notes: "" };
    const first = String(text).replace(/<[^>]+>/g, "\n").split("\n").map((l) => l.trim()).find((l) => l && !/^\[image/.test(l));
    if (!first) return { businesses: [], notes: "There is no customer story in this upload." };
    return { businesses: [{ name: first.split(/ located| in | went/i)[0].trim().slice(0, 60), images: [], story: "" }], notes: "" };
  },
  async draftCaseStudy(upload, { business }) {
    await delay();
    const seed = SEED_CASES.find((cs) => sameBusiness(cs.business.name, business.name));
    return { model: "fake", data: seed ? asDraft(seed, EXAMPLE_PICTURES[seed.slug]) : genericDraft(business.name, upload.text) };
  },
  async repairCaseStudy(upload, task, draft) {
    await delay();
    return { model: "fake", data: draft };
  }
};

export function installFakes() {
  setProviders({ claude: fakeClaude, stt: fakeStt });
  // so the admin's setup check reads as ready; the fakes answer every call, so these never reach a real service
  process.env.ANTHROPIC_API_KEY ||= "fake";
  process.env.OPENAI_API_KEY ||= "fake";
}
