// The Gap Check's logic: which answers are valid, the score, the tier, the three biggest gaps, the fit Meta is told
// about, the routing, and the call days. Pure functions over content/survey.mjs, no imports and no state.
//
// One file for both sides: the server imports it (api/lead.mjs scores again, so nothing stored or sent to Meta trusts
// the browser), and the build inlines it into the page's script (tools/build.mjs drops the `export` keywords), so the
// score on screen and the score stored can never disagree. Keep it to `export function` declarations.

/** The step with this key, or undefined. */
export function stepOf(survey, key) {
  return survey.steps.find((s) => s.key === key);
}

/** Every multiple-choice question: the choice steps, and the choice inside a fields step (Google profiles). */
export function choiceQuestions(survey) {
  const out = [];
  for (const s of survey.steps) {
    if (s.type === "choice") out.push({ key: s.key, options: s.options, step: s });
    else if (s.choice) out.push({ key: s.choice.key, options: s.choice.options, step: s });
  }
  return out;
}

/** The option with value v for question key, or null. */
export function optionOf(survey, key, v) {
  const q = choiceQuestions(survey).find((c) => c.key === key);
  return (q && q.options.find((o) => o.v === v)) || null;
}

/** Keeps only answers that are one of the question's own options; lists the questions left unanswered. */
export function cleanAnswers(survey, raw) {
  const answers = {};
  const missing = [];
  for (const c of choiceQuestions(survey)) {
    const v = raw && typeof raw[c.key] === "string" ? raw[c.key] : "";
    if (c.options.some((o) => o.v === v)) answers[c.key] = v;
    else missing.push(c.key);
  }
  return { answers, missing };
}

/** The score out of 100: the points of the scored answers. Higher means a bigger gap (the GTM scorecard's rule). */
export function scoreOf(survey, answers) {
  let total = 0;
  for (const s of survey.steps) {
    if (!s.scored) continue;
    const o = optionOf(survey, s.key, answers[s.key]);
    if (o && typeof o.points === "number") total += o.points;
  }
  return Math.max(0, Math.min(100, total));
}

/** The tier for a score. */
export function tierOf(survey, score) {
  return survey.tiers.find((t) => score >= t.min && score <= t.max) || survey.tiers[survey.tiers.length - 1];
}

/** The tier's message, with the week's jobs filled in where the message uses them. */
export function tierMessage(survey, tier, answers) {
  const jobs = optionOf(survey, "jobs", answers.jobs);
  if (tier.msg.includes("{jobs}")) {
    if (jobs && jobs.words) return tier.msg.replace("{jobs}", jobs.words);
    return tier.msgNoJobs || tier.msg.replace("At {jobs} jobs a week, t", "T");
  }
  return tier.msg;
}

/** The n biggest gaps: scored answers worth points, most points first, ties in question order. */
export function gapsOf(survey, answers, n = 3) {
  const list = [];
  survey.steps.forEach((s, i) => {
    if (!s.scored) return;
    const o = optionOf(survey, s.key, answers[s.key]);
    const words = survey.gaps[s.key] && survey.gaps[s.key][answers[s.key]];
    if (o && o.points > 0 && words) list.push({ key: s.key, v: o.v, points: o.points, order: i, title: words[0], line: words[1] });
  });
  list.sort((a, b) => b.points - a.points || a.order - b.order);
  return list.slice(0, n).map(({ order, ...g }) => g);
}

/** What Meta is told about this visitor: "qualified", or the first fit rule the answers meet. */
export function fitOf(survey, answers) {
  for (const rule of survey.fit) {
    const hit = Object.entries(rule.when).some(([key, values]) => values.includes(answers[key]));
    if (hit) return rule.key;
  }
  return survey.qualifiedFit;
}

/** Routing: a call with no checkout link for no software or 3 or more profiles (the GTM's overrides). */
export function routeOf(survey, answers) {
  for (const [key, values] of Object.entries(survey.callOnly)) {
    if (values.includes(answers[key])) return { callOnly: true, why: key };
  }
  return { callOnly: false, why: null };
}

/** Everything the result needs, from raw answers. ok is false when a question is unanswered. */
export function evaluate(survey, raw) {
  const { answers, missing } = cleanAnswers(survey, raw);
  const score = scoreOf(survey, answers);
  const tier = tierOf(survey, score);
  const fit = fitOf(survey, answers);
  const route = routeOf(survey, answers);
  const trade = optionOf(survey, "trade", answers.trade);
  return {
    ok: missing.length === 0,
    missing,
    answers,
    score,
    tier: tier.key,
    tierName: tier.name,
    tierMsg: tierMessage(survey, tier, answers),
    fit,
    qualified: fit === survey.qualifiedFit,
    callOnly: route.callOnly,
    why: route.why,
    gaps: gapsOf(survey, answers, 3),
    service: trade ? trade.service : "home services"
  };
}

/** Fills {name} placeholders from vars; unknown names are left as they are. */
export function fill(template, vars) {
  return String(template).replace(/\{(\w+)\}/g, (m, k) => (vars && vars[k] !== undefined && vars[k] !== null ? String(vars[k]) : m));
}

/** "2026-11-10" for a date, in its own (local) calendar. */
export function isoDay(d) {
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/** The call days on offer: the next `days` weekdays, starting tomorrow (the course: never the same day, no weekends,
 *  about five days out). Labels like "Tue, Nov 10". */
export function bookingDays(survey, now) {
  const out = [];
  const d = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const DOW = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  while (out.length < survey.booking.days) {
    d.setDate(d.getDate() + 1);
    const w = d.getDay();
    if (w === 0 || w === 6) continue;
    out.push({ v: isoDay(d), label: `${DOW[w]}, ${MON[d.getMonth()]} ${d.getDate()}`, long: `${DOW[w]} ${MON[d.getMonth()]} ${d.getDate()}` });
  }
  return out;
}

/** The label for a stored day ("2026-11-10" to "Tue, Nov 10"), or the value itself if it is not a date. */
export function dayLabel(v) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(v || ""));
  if (!m) return String(v || "");
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  const DOW = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  return `${DOW[d.getDay()]}, ${MON[d.getMonth()]} ${d.getDate()}`;
}

/** True when day is a weekday from tomorrow to `maxAhead` days out, as seen from `now` (the server allows a day either
 *  side for time zones). */
export function dayAllowed(day, now, maxAhead) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(day || ""));
  if (!m) return false;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  if (isoDay(d) !== day) return false;
  const w = d.getDay();
  if (w === 0 || w === 6) return false;
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const diff = Math.round((d - today) / 86400000);
  return diff >= 0 && diff <= maxAhead;
}

/** The booking window with value v, or null. */
export function windowOf(survey, v) {
  return survey.booking.windows.find((w) => w.v === v) || null;
}

/** US phone digits: 10 digits, or 11 starting with 1. Returns the 10 digits, or "" when it is not a US number. */
export function usPhone(p) {
  const d = String(p || "").replace(/\D/g, "");
  if (d.length === 11 && d[0] === "1") return d.slice(1);
  return d.length === 10 ? d : "";
}
