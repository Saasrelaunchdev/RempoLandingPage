// Rempo's claim rules over every word an owner can read: the page copy, the standalone page's hero, the rule-based
// fixes for many kinds of race, and every email template rendered with sample data.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ok, section, report } from "./harness.mjs";
import COPY from "../public/race/copy.js";
import { lintCopy, lintReply, strings } from "../api/_lib/race/lint.mjs";
import { ruleFixes, ruleSummary, resultsEmail, nurtureEmail, teamAlert, bookedAlert, unsubscribePage } from "../api/_lib/race/copy.mjs";
import { buildRace, DAY } from "../api/_lib/race/metrics.mjs";
import * as fakes from "../api/_lib/race/fakes.mjs";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const NOW = Date.parse("2026-11-10T12:00:00Z");
const fails = (where, text, opts) => { const e = lintCopy(text, opts); ok(`${where}: ${String(text).slice(0, 60)}`, e.length === 0, e); };

await section("the lint itself", () => {
  ok("a promise is caught", lintCopy("Get more reviews every week.").length > 0);
  ok("a refusal passes", lintCopy("We don't promise more reviews.").length === 0);
  ok("an unsourced statistic is caught", lintCopy("74% of people read reviews.").length > 0);
  ok("a sourced statistic passes", lintCopy("74% of consumers look for reviews from the last three months (BrightLocal 2026).").length === 0);
  ok("an em dash is caught", lintCopy("Fast — and friendly.").length > 0);
  ok("a banned word is caught", lintCopy("Unlock your potential.").length > 0);
  ok("a price is caught", lintCopy("Only $297 a month.").length > 0);
  ok("rankings are caught", lintCopy("You'll rank higher on Google.").length > 0);
  ok("a reply offering a refund is caught", lintReply("Sorry, we'll refund you.").length > 0);
  ok("a reply asking to change the review is caught", lintReply("Please update your review once we fix it.").length > 0);
  ok("a long reply is caught", lintReply(Array(80).fill("word").join(" ")).length > 0);
  ok("a good reply passes", lintReply("Thanks, Dana. Glad we got your heat back on the same day, and we're here whenever you need us.").length === 0);
});

await section("page copy (public/race/copy.js)", () => {
  for (const s of strings(COPY)) fails(`copy.${s.path}`, s.text);
});

await section("the standalone page's own words (public/index.html)", () => {
  const html = fs.readFileSync(path.join(ROOT, "public/index.html"), "utf8");
  const text = html.replace(/<style[\s\S]*?<\/style>/g, "").replace(/<script[\s\S]*?<\/script>/g, "").replace(/<!--[\s\S]*?-->/g, "").replace(/<[^>]+>/g, "\n");
  for (const line of text.split("\n").map((l) => l.trim()).filter(Boolean)) fails("index.html", line);
  const meta = html.match(/name="description" content="([^"]+)"/);
  fails("index.html description", meta && meta[1]);
});

// Races of every shape: behind, level, ahead, no data
function race(kind) {
  const owner = { name: "Maple Street Plumbing", rating: kind === "ahead" ? 4.9 : kind === "low" ? 4.2 : 4.6, count: kind === "ahead" ? 300 : 87, basics: { hours: true, website: kind !== "behind", phone: true, description: false, photos: true } };
  const rivals = [{ name: "A", rating: 4.8, count: 200 }, { name: "B", rating: 4.7, count: 150 }, { name: "C", rating: 4.9, count: 120 }];
  const step = kind === "ahead" ? 2 : kind === "level" ? 5 : 15;
  const mk = (s, replied) => ({ reviews: Array.from({ length: 40 }, (_, i) => ({ id: `x${i}`, rating: 5, iso: new Date(NOW - (3 + i * s) * DAY).toISOString(), text: "Good", replied: replied(i) })), more: true });
  return buildRace({ owner, rivals, ownerReviews: mk(step, (i) => (kind === "behind" ? i % 4 === 0 : i % 4 !== 0)), rivalReviews: rivals.map(() => mk(5, (i) => i % 3 !== 0)), now: NOW });
}

await section("rule-based fixes, every kind of race", () => {
  for (const kind of ["behind", "level", "ahead", "low"]) {
    const r = race(kind);
    const fixes = ruleFixes(r);
    ok(`${kind}: three fixes`, fixes.length === 3, fixes.map((f) => f.title));
    for (const f of fixes) { fails(`${kind} fix title`, f.title); fails(`${kind} fix why`, f.why); fails(`${kind} fix step`, f.firstStep); ok(`${kind}: the why cites a number`, /\d/.test(f.why)); }
    fails(`${kind} summary`, ruleSummary(r));
  }
});

await section("emails", () => {
  const c = { publicUrl: "https://review-race.example.com", siteUrl: "https://rempo.io", company: "Rempo", postalAddress: "1 Main St, Springfield, IL 62701", caseStudyUrl: "https://rempo.io/case-studies/ranchero-plumbing" };
  const r = race("behind");
  const picks = [{ id: "p1", rating: 5, author: "Dana", daysAgo: 4, text: "" }, { id: "p2", rating: 3, author: "Mike", daysAgo: 20, text: "" }];
  const analysis = { summary: ruleSummary(r), fixes: ruleFixes(r), drafts: [{ reviewId: "p1", reply: "Thanks so much, Dana. It means a lot, and we'll pass it on to the team.", callFirst: false }, { reviewId: "p2", reply: "Thank you for telling us, Mike. Please call our office so we can make it right.", callFirst: true }] };
  const run = { token: "tok", first_name: "Tom", email: "tom@example.com", business: { name: "Maple Street Plumbing" }, search: { query: "Plumber", where: "Springfield, IL", date: "November 10, 2026" }, race: r, analysis, picks, rivals: [] };
  const links = { results: "https://x/?r=tok", book: "https://x/?r=tok#book", unsubscribe: "https://x/api/race?action=unsubscribe&e=tom%40example.com&s=sig" };
  const check = (name, m) => {
    fails(`${name} subject`, m.subject);
    for (const line of m.text.split("\n").filter((l) => l.trim() && !/^(Unsubscribe|See your|Pick a time|See how)/.test(l))) fails(`${name} text`, line);
    ok(`${name}: no em dash in the HTML`, !/[–—]/.test(m.html || ""));
    ok(`${name}: has the unsubscribe link`, (m.text || "").includes(links.unsubscribe) || !m.html);
  };
  check("results", resultsEmail({ c, run, links }));
  for (const kind of ["day2", "day5", "day9"]) check(kind, nurtureEmail({ c, run, kind, links }));
  check("update", nurtureEmail({ c, run, kind: "update", links, update: { rows: [{ name: "Maple Street Plumbing (you)", before: 87, after: 89 }, { name: "A", before: 200, after: 209 }] } }));
  const noDrafts = { ...run, analysis: { ...analysis, drafts: [] } };
  check("day2 without drafts", nurtureEmail({ c, run: noDrafts, kind: "day2", links }));
  const t = teamAlert({ run, links });
  ok("team alert names the lead", t.text.includes("tom@example.com") && t.text.includes("Maple Street Plumbing"));
  ok("booked alert", bookedAlert({ run, when: "Wednesday", phone: "+12175550142", links }).text.includes("+12175550142"));
  ok("unsubscribe page escapes the email", !unsubscribePage({ state: "ask", action: "/x", email: "<b>@x.com" }).includes("<b>@x.com"));
});

await section("the demo stand-in for Claude passes the same checks", () => {
  const r = race("behind");
  const input = { reviews_to_answer: [{ id: "a", stars: 5, firstName: "Dana", text: "Great" }, { id: "b", stars: 2, firstName: null, text: "Late" }, { id: "c", stars: 5, firstName: "Ann", text: "" }] };
  const a = fakes.analyze(input, r);
  for (const d of a.drafts) ok(`demo draft ${d.reviewId}`, lintReply(d.reply).length === 0, lintReply(d.reply));
  for (const p of a.praise) fails("demo praise", p);
});

report("copy.test");
