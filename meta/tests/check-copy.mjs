#!/usr/bin/env node
// The copy rules: the content passes, and the linter really catches what the GTM bans (a test of the test).
import { readFileSync } from "node:fs";
import { lintAll, lint, collect } from "../tools/copy-lint.mjs";
import survey from "../content/survey.mjs";
import emails from "../content/emails.mjs";
let pass = 0, fail = 0;
const ok = (name, cond, info = "") => { if (cond) { pass++; console.log(`ok   ${name}`); } else { fail++; console.log(`FAIL ${name}${info ? `: ${info}` : ""}`); } };
const read = (p) => JSON.parse(readFileSync(new URL(p, import.meta.url), "utf8"));
const rules = read("../rules/copy-rules.json");
const { errors, warnings } = await lintAll();
ok("the content passes every copy rule", errors.length === 0, errors.join(" | "));
ok("no copy warnings", warnings.length === 0, warnings.join(" | "));
const copy = read("../content/copy.json"), variants = read("../content/variants.json");
const strings = collect(copy, variants, survey, emails);
ok("the linter reads the page, the variants, the survey and the emails", ["copy.hero.eyebrow", "variants.top-three.h1", "survey.steps.1.q", "emails.call.subject"].every((k) => strings.some((s) => s.key === k)));
const one = (text, key = "copy.test") => lint([{ key, text }], rules);
ok("catches a promise of reviews", one("Get more reviews every month.").errors.length > 0);
ok("catches a ranking promise", one("Rank higher on Google in 30 days.").errors.length > 0);
ok("catches a price while the offer is undecided", one("Only $297 a month.").errors.length > 0);
ok("catches 'automatically'", one("Requests go out automatically.").errors.length > 0);
ok("catches a named job software as supported", one("Rempo works with Jobber.").errors.length > 0);
ok("catches an em dash", one("Fast \u2014 and simple.").errors.length > 0);
ok("catches a statistic without its source", one("74% of people read reviews.").errors.length > 0);
ok("lets a refusal through", one("We don't remove reviews.").errors.length === 0 && one("No screening out unhappy customers.").errors.length === 0);
ok("still catches the same words said as a promise", one("We remove bad reviews for you.").errors.length > 0);
ok("catches a headline over budget", one("This headline has far more than ten words in it for sure", "variants.x.h1").errors.length > 0);
console.log(`check-copy: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
