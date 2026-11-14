#!/usr/bin/env node
/**
 * The Gap Check's logic (lib/gapcheck.mjs over content/survey.mjs) against the GTM's scorecard spec
 * (rempogtmbuild, dashboards/lead-magnet-spec.md): every point value, the 100-point total, the tier edges, the tier
 * messages, the three biggest gaps, the fit Meta is told about (the ICP floor in dashboards/04-icp.md), the routing
 * overrides, the call days (weekdays from tomorrow, never today), and the phone check.
 *   node tests/check-gapcheck.mjs
 */
import S from "../content/survey.mjs";
import * as G from "../lib/gapcheck.mjs";

let pass = 0, fail = 0;
const ok = (name, cond, info = "") => { if (cond) { pass++; console.log(`ok   ${name}`); } else { fail++; console.log(`FAIL ${name}${info ? `: ${info}` : ""}`); } };

// The GTM scorecard's points, question by question (lead magnet spec, questions 3 to 7)
const SPEC = {
  asks: { none: 25, remember: 20, techs: 15, software: 8, tool: 3 },
  newest: { week: 0, month: 6, "1to3": 14, over3: 20, unsure: 12 },
  replies: { all: 0, most: 4, some: 8, rarely: 12, never: 15 },
  compare: { ahead: 0, even: 8, behind: 18, far: 25, unchecked: 15 },
  jobs: { lt5: 3, "5to15": 8, "16to40": 12, over40: 15, unsure: 8 }
};
for (const [key, pts] of Object.entries(SPEC)) {
  const step = G.stepOf(S, key);
  const have = Object.fromEntries(step.options.map((o) => [o.v, o.points]));
  ok(`points for ${key} match the GTM spec`, JSON.stringify(have) === JSON.stringify(pts), JSON.stringify(have));
}
ok("five scored questions", S.steps.filter((s) => s.scored).length === 5);
const base = { trade: "hvac", records: "fieldsoftware", profiles: "1" };
const worst = { ...base, asks: "none", newest: "over3", replies: "never", compare: "far", jobs: "over40" };
const best = { ...base, asks: "tool", newest: "week", replies: "all", compare: "ahead", jobs: "lt5" };
ok("the most gap scores 100", G.evaluate(S, worst).score === 100);
ok("the least gap scores 6", G.evaluate(S, best).score === 6);
const at = (score) => G.tierOf(S, score).key;
ok("tier edges: 39 steady, 40 leaky, 69 leaky, 70 stalled", at(0) === "steady" && at(39) === "steady" && at(40) === "leaky" && at(69) === "leaky" && at(70) === "stalled" && at(100) === "stalled");
const leaky = { ...base, asks: "techs", newest: "1to3", replies: "some", compare: "even", jobs: "5to15" };   // 15+14+8+8+8 = 53
const ev = G.evaluate(S, leaky);
ok("a leaky answer set scores 53", ev.score === 53 && ev.tier === "leaky");
ok("the leaky message names the week's jobs", ev.tierMsg.includes("At 5 to 15 jobs a week"));
ok("not sure about jobs: the leaky message without a number", G.evaluate(S, { ...leaky, jobs: "unsure" }).tierMsg.startsWith("Some customers get asked and some don't. Week after week"));
ok("the three biggest gaps, most points first, ties in question order", ev.gaps.map((g) => g.key).join() === "asks,newest,replies", ev.gaps.map((g) => `${g.key}:${g.points}`).join());
const tie = G.evaluate(S, { ...base, asks: "software", newest: "month", replies: "some", compare: "even", jobs: "5to15" });   // 8,6,8,8,8
ok("ties keep question order", tie.gaps.map((g) => g.key).join() === "asks,replies,compare", tie.gaps.map((g) => g.key).join());
ok("an answer worth 0 points is not a gap", G.evaluate(S, best).gaps.every((g) => g.points > 0) && !G.evaluate(S, best).gaps.some((g) => g.key === "newest"));
ok("every gap has its words", Object.entries(SPEC).every(([k, pts]) => Object.entries(pts).every(([v, p]) => p === 0 || (S.gaps[k][v] && S.gaps[k][v].length === 2))));
ok("fit: qualified with job software and 5 or more jobs", G.evaluate(S, leaky).fit === "qualified" && G.evaluate(S, leaky).qualified);
ok("fit: 'not sure' on both still qualifies (start wide)", G.evaluate(S, { ...leaky, jobs: "unsure", records: "unsure" }).fit === "qualified");
ok("fit: another CRM qualifies", G.evaluate(S, { ...leaky, records: "crm" }).fit === "qualified");
ok("fit: fewer than 5 jobs a week is under the floor", G.evaluate(S, { ...leaky, jobs: "lt5" }).fit === "under-floor");
ok("fit: paper or spreadsheets is no-software", G.evaluate(S, { ...leaky, records: "paper" }).fit === "no-software");
ok("routing: paper goes to a call", G.evaluate(S, { ...leaky, records: "paper" }).callOnly && G.evaluate(S, { ...leaky, records: "paper" }).why === "records");
ok("routing: 3 or more profiles go to a call", G.evaluate(S, { ...leaky, profiles: "3to9" }).why === "profiles" && G.evaluate(S, { ...leaky, profiles: "10plus" }).callOnly);
ok("routing: software and 1 or 2 profiles keep checkout open", !G.evaluate(S, leaky).callOnly && !G.evaluate(S, { ...leaky, profiles: "2" }).callOnly);
const dirty = G.cleanAnswers(S, { ...leaky, trade: "carpentry", asks: 5, extra: "x" });
ok("answers outside the options are dropped and listed", !dirty.answers.trade && !dirty.answers.asks && dirty.missing.includes("trade") && dirty.missing.includes("asks") && !("extra" in dirty.answers));
ok("the service words follow the trade", G.evaluate(S, { ...leaky, trade: "both" }).service === "HVAC and plumbing" && G.evaluate(S, { ...leaky, trade: "other" }).service === "home services");
const fri = G.bookingDays(S, new Date(2026, 10, 6));    // Friday 6 November 2026
ok("call days from a Friday: Monday to Friday next week", fri.map((d) => d.v).join() === "2026-11-09,2026-11-10,2026-11-11,2026-11-12,2026-11-13", fri.map((d) => d.v).join());
const wed = G.bookingDays(S, new Date(2026, 10, 4, 23, 30));   // Wednesday, late
ok("call days from a Wednesday: Thursday onward, skipping the weekend, never today", wed.map((d) => d.v).join() === "2026-11-05,2026-11-06,2026-11-09,2026-11-10,2026-11-11", wed.map((d) => d.v).join());
ok("call day labels read like 'Mon, Nov 9'", fri[0].label === "Mon, Nov 9" && G.dayLabel("2026-11-09") === "Mon, Nov 9");
const now = new Date(2026, 10, 6, 12);
ok("dayAllowed: tomorrow-ish weekdays yes; weekends, the past and far away no", G.dayAllowed("2026-11-09", now, 14) && !G.dayAllowed("2026-11-07", now, 14) && !G.dayAllowed("2026-11-05", now, 14) && !G.dayAllowed("2026-12-01", now, 14) && !G.dayAllowed("2026-02-30", now, 14) && !G.dayAllowed("nope", now, 14));
ok("usPhone: 10 digits, or 11 with the 1", G.usPhone("(512) 555-0134") === "5125550134" && G.usPhone("+1 512 555 0134") === "5125550134" && G.usPhone("555-0134") === "" && G.usPhone("44 20 7946 0958") === "");
ok("fill: known names filled, unknown left", G.fill("{a} and {b}", { a: 1 }) === "1 and {b}");
console.log(`check-gapcheck: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
