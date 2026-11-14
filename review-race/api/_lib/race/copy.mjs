// Every word the server writes to an owner: the rule-based fixes (used when Claude is unavailable or a line fails the
// rules), the emails, the unsubscribe page, and the alert to the team. The page's own words are in
// public/race/copy.js. All of it passes lint.mjs (tests/copy.test.mjs checks every template with sample data).
import { esc } from "./http.mjs";
import { share } from "./metrics.mjs";

const n = (v) => (v === null || v === undefined ? "?" : String(v));
const rating = (v) => (typeof v === "number" ? v.toFixed(1) : "no rating");
export const daysAgo = (d) => (d === null || d === undefined ? "unknown" : d === 0 ? "today" : d === 1 ? "yesterday" : `${d} days ago`);
const plural = (k, one, many) => (k === 1 ? one : many);

/* ---------- Rule-based fixes ---------- */
export function ruleFixes(race) {
  const { you, average, areas, cushion } = race;
  const c = [];
  const push = (score, f) => c.push({ score, ...f });
  if (you.last90 !== null && average.last90 !== null) {
    if (areas.momentum === "behind") push(10, { area: "Momentum", title: "Ask every customer after every job", why: `You had ${you.last90} Google reviews in the last 90 days. The top three near you averaged ${average.last90}.`, firstStep: "This week, send your review link to every customer whose job you finish, the same way for everyone." });
    else push(3, { area: "Momentum", title: "Keep your pace through busy season", why: `You had ${you.last90} Google reviews in the last 90 days, against ${average.last90} on average for the top three near you.`, firstStep: "Before your next busy stretch, decide who sends the review link when the phones are ringing." });
  }
  if (you.replyRate !== null && you.window) {
    const theirs = share(average.replyRate, 30);
    if (areas.care === "behind") push(9, { area: "Care", title: "Answer every review within two days", why: `You replied to ${you.replied} of your last ${you.window} reviews. The top three near you replied to about ${n(theirs)} of every 30.`, firstStep: "Reply to your five most recent reviews this week, each in your own words." });
    else push(2, { area: "Care", title: "Keep answering every review", why: `You replied to ${you.replied} of your last ${you.window} reviews, against about ${n(theirs)} of every 30 for the top three near you.`, firstStep: "When a hard review posts, call the customer first, then reply calmly in public." });
  }
  if (you.newestDays !== null && you.newestDays > 21 && (average.newestDays === null || you.newestDays > average.newestDays + 7)) {
    push(8, { area: "Momentum", title: "Keep reviews coming every week", why: `Your newest review is ${you.newestDays} days old.${average.newestDays !== null ? ` At the top three near you, the newest is ${average.newestDays} days old on average.` : ""}`, firstStep: "Ask the customers from this week's jobs before Friday, and again next week." });
  }
  if (areas.trust === "behind") push(6, { area: "Trust", title: "Build depth by asking everyone", why: `You have ${you.count} Google reviews. The top three near you average ${n(average.count)}.`, firstStep: "Make the review request part of closing every job, so every customer gets the same chance." });
  else if (cushion && cushion.kind === "above") push(1, { area: "Trust", title: "Protect your star cushion", why: `${cushion.k} one-star ${plural(cushion.k, "review", "reviews")} would take you under 4.5 stars.`, firstStep: "Turn on review notifications in your Google Business Profile, so a hard review reaches you the day it posts." });
  if (areas.firstImpression === "behind") push(5, { area: "First impression", title: "Answer the reviews that cost you stars", why: `Your rating is ${rating(you.rating)} stars. The top three near you average ${rating(average.rating)}.`, firstStep: "Reply calmly to your lowest recent reviews this week, and call those customers first." });
  if (you.basics !== null && you.basics < 5) push(4, { area: "First impression", title: "Fill in your Google profile basics", why: `Your profile shows ${you.basics} of 5 basics: hours, website, phone, description and photos.`, firstStep: "Add what is missing in your Google Business Profile this week." });
  c.sort((a, b) => b.score - a.score);
  const out = [];
  for (const f of c) { if (out.length < 3 && !out.some((o) => o.title === f.title)) out.push(f); }
  return out.map(({ score, ...f }) => f);
}

export function ruleSummary(race) {
  const { you, average } = race;
  if (you.last90 !== null && average.last90 !== null) return `In the last 90 days you had ${you.last90} Google reviews, against ${average.last90} on average for the top three near you.`;
  return `You have ${you.count} Google reviews, against ${n(average.count)} on average for the top three near you.`;
}

/* ---------- Emails ---------- */
const BTN = "display:inline-block;padding:13px 20px;border-radius:12px;background:#0B6BEF;color:#ffffff;font-weight:600;text-decoration:none;font-family:Arial,sans-serif;font-size:15px";
const LINK2 = "color:#0057B3;font-family:Arial,sans-serif;font-size:15px";
const P = "margin:0 0 14px;font:15px/1.55 Arial,sans-serif;color:#0A1A33";
const H = "margin:22px 0 10px;font:600 18px/1.3 Arial,sans-serif;color:#0A1A33";
const SMALL = "margin:0 0 8px;font:13px/1.5 Arial,sans-serif;color:#5E6F8E";

function layout({ preheader, body, footer }) {
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Rempo</title></head>
<body style="margin:0;background:#F2F6FD"><span style="display:none;max-height:0;overflow:hidden">${esc(preheader)}</span>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#F2F6FD"><tr><td align="center" style="padding:24px 12px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;background:#ffffff;border-radius:16px"><tr><td style="padding:28px 24px">
<p style="margin:0 0 18px;font:700 20px Arial,sans-serif;color:#0A1A33">Rempo</p>
${body}
</td></tr></table>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px"><tr><td style="padding:16px 24px">${footer}</td></tr></table>
</td></tr></table></body></html>`;
}

function footer(c, unsubscribeUrl, plain = false) {
  const host = (() => { try { return new URL(c.publicUrl).host; } catch { return "our site"; } })();
  const lines = [
    `You're getting this because you asked for your review race on ${host}.`,
    `Unsubscribe: ${unsubscribeUrl}`,
    [c.company, c.postalAddress].filter(Boolean).join(", ")
  ].filter(Boolean);
  if (plain) return lines.join("\n");
  return lines.map((l) => `<p style="${SMALL}">${l.startsWith("Unsubscribe: ") ? `<a href="${esc(unsubscribeUrl)}" style="color:#5E6F8E">Unsubscribe</a>` : esc(l)}</p>`).join("");
}

function raceTable(race) {
  const y = race.you, a = race.average;
  const rows = [
    ["Star rating", rating(y.rating), rating(a.rating)],
    ["Total Google reviews", n(y.count), n(a.count)],
    ["Last 90 days", `${n(y.last90)}${y.capped ? "+" : ""}`, n(a.last90)],
    ["Replied to, last 30", y.window ? `${y.replied} of ${y.window}` : "?", a.replyRate !== null ? `about ${share(a.replyRate, 30)} of 30` : "?"],
    ["Newest review", daysAgo(y.newestDays), daysAgo(a.newestDays)]
  ];
  const td = "padding:8px 6px;border-bottom:1px solid #EAEFF6;font:14px Arial,sans-serif;color:#0A1A33";
  return {
    html: `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 8px"><tr><td style="${td};color:#5E6F8E"></td><td style="${td};font-weight:700">You</td><td style="${td};font-weight:700">Top three average</td></tr>${rows.map(([k, v, w]) => `<tr><td style="${td};color:#5E6F8E">${esc(k)}</td><td style="${td}">${esc(v)}</td><td style="${td}">${esc(w)}</td></tr>`).join("")}</table>`,
    text: rows.map(([k, v, w]) => `${k}: you ${v}, top three ${w}`).join("\n")
  };
}

const stars = (r) => (typeof r === "number" ? "★".repeat(Math.round(r)) + "☆".repeat(5 - Math.round(r)) : "");

export function resultsEmail({ c, run, links }) {
  const race = run.race, a = run.analysis || {};
  const first = run.first_name || "there";
  const biz = run.business.name;
  const summary = a.summary || ruleSummary(race);
  const table = raceTable(race);
  const fixes = a.fixes || [];
  const drafts = (a.drafts || []).map((d) => ({ ...d, review: (run.picks || []).find((p) => p.id === d.reviewId) || null }));
  const unanswered = race.you.unanswered || 0;
  const rest = Math.max(0, unanswered - drafts.length);
  const subject = `Your review race: ${biz} and the top three near you`;
  const html = layout({
    preheader: summary,
    body: [
      `<p style="${P}">Hi ${esc(first)},</p>`,
      `<p style="${P}">${esc(summary)}</p>`,
      `<p style="${SMALL}">We searched "${esc(run.search.query)}" near ${esc(run.search.where)} on ${esc(run.search.date)} and read the three businesses a homeowner sees first.</p>`,
      table.html,
      fixes.length ? `<h2 style="${H}">What you're missing</h2>` + fixes.map((f, i) => `<p style="${P}"><b>${i + 1}. ${esc(f.title)}</b><br>${esc(f.why)}<br><span style="color:#0057B3">First step:</span> ${esc(f.firstStep)}</p>`).join("") : "",
      drafts.length ? `<h2 style="${H}">${drafts.length === 1 ? "A reply, ready to post" : `${drafts.length} replies, ready to post`}</h2><p style="${SMALL}">Read each one, make it yours, then post it as your reply on Google: open Google Maps, tap your business, tap Reviews, then Reply.</p>` + drafts.map((d) => `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 14px;border:1px solid #EAEFF6;border-radius:12px"><tr><td style="padding:14px">${d.review ? `<p style="${SMALL}"><span style="color:#C27F00">${stars(d.review.rating)}</span> ${esc(d.review.author || "A customer")}, ${esc(daysAgo(d.review.daysAgo))}</p>${d.review.text ? `<p style="${P};color:#465C7E">"${esc(d.review.text.slice(0, 280))}${d.review.text.length > 280 ? "..." : ""}"</p>` : ""}` : ""}<p style="${P}"><b>Your reply:</b> ${esc(d.reply)}</p>${d.callFirst ? `<p style="${SMALL};color:#7D5000">Call them first if you can, then post the reply.</p>` : ""}</td></tr></table>`).join("") : "",
      `<p style="margin:20px 0 12px"><a href="${esc(links.results)}" style="${BTN}">See your full race</a></p>`,
      `<p style="margin:0 0 18px"><a href="${esc(links.book)}" style="${LINK2}">Pick a time for a 15-minute call</a></p>`,
      rest > 0 ? `<p style="${P}">${rest} more of your recent reviews ${rest === 1 ? "has" : "have"} no reply. If you'd rather hand it over, that's the part Rempo runs: a request after every job, one reminder, and a reply written for every review.</p>` : `<p style="${P}">If you'd rather hand it over, that's the part Rempo runs: a request after every job, one reminder, and a reply written for every review.</p>`,
      `<p style="${P}"><a href="${esc(c.siteUrl)}" style="${LINK2}">See how Rempo runs it</a></p>`,
      `<p style="${P}">The Rempo team</p>`
    ].join(""),
    footer: footer(c, links.unsubscribe)
  });
  const text = [
    `Hi ${first},`, "", summary, "",
    `We searched "${run.search.query}" near ${run.search.where} on ${run.search.date}.`, "", table.text, "",
    ...(fixes.length ? ["What you're missing:", ...fixes.map((f, i) => `${i + 1}. ${f.title}\n${f.why}\nFirst step: ${f.firstStep}`), ""] : []),
    ...(drafts.length ? ["Replies, ready to post (open Google Maps, tap your business, tap Reviews, then Reply):", ...drafts.map((d) => `${d.review ? `${d.review.author || "A customer"}, ${daysAgo(d.review.daysAgo)}: "${(d.review.text || "").slice(0, 280)}"\n` : ""}Your reply: ${d.reply}${d.callFirst ? "\n(Call them first if you can.)" : ""}`), ""] : []),
    `See your full race: ${links.results}`, `Pick a time for a 15-minute call: ${links.book}`, `See how Rempo runs it: ${c.siteUrl}`, "", "The Rempo team", "", footer(c, links.unsubscribe, true)
  ].join("\n");
  return { subject, html, text };
}

// The follow-up emails. `kind` is the template name stored in race_emails.
export function nurtureEmail({ c, run, kind, links, update }) {
  const race = run.race, a = run.analysis || {};
  const first = run.first_name || "there";
  const biz = run.business.name;
  let subject, paras = [];
  if (kind === "day2") {
    const k = (a.drafts || []).length;
    const rest = Math.max(0, (race.you.unanswered || 0) - k);
    subject = k ? `Did your replies go up, ${first}?` : `Your review race, two days on`;
    paras = k ? [
      `Two days ago we wrote ${k} ${plural(k, "reply", "replies")} for your Google reviews. If ${plural(k, "it is", "they are")} still waiting, here is the fastest way to post: open Google Maps on your phone, tap your business, tap Reviews, then Reply under each one.`,
      rest > 0 ? `${rest} more of your recent reviews ${rest === 1 ? "has" : "have"} no reply. If you'd rather not write them, that's the part we run.` : "Once those are up, the next step is replying to each new review within two days."
    ] : [
      `Your newest Google review is ${daysAgo(race.you.newestDays)}. 74% of consumers look for reviews from the last three months (BrightLocal 2026).`,
      "The fix is one habit: every customer gets the same request after every job, with one reminder."
    ];
  } else if (kind === "day5") {
    const behind = race.areas.momentum === "behind";
    subject = behind ? "What the top three near you do differently" : "Keeping your lead through busy season";
    paras = [
      race.average.last90 !== null ? `In the last 90 days, the top three near you averaged ${race.average.last90} Google reviews. You had ${n(race.you.last90)}.` : `The top three near you average ${n(race.average.count)} Google reviews. You have ${race.you.count}.`,
      behind ? "The difference is rarely the work. It is one habit: every customer is asked after every job, the same way, with one reminder." : "The shops that keep a lead keep asking in their busiest weeks, when it is easiest to skip.",
      "Three ways to start this week: save your review link where the office can paste it in one step; send it when the job is marked complete, not at the end of the day; and on Friday, count jobs finished against requests sent."
    ];
  } else if (kind === "day9") {
    subject = "A shop like yours";
    paras = [
      `Here is a case study from a home-service business that runs this with Rempo: ${c.caseStudyUrl}`,
      "It shows their Google profile before and after, in their own numbers, and what they did once to start."
    ];
  } else {
    subject = `Race update: ${biz} and the top three`;
    const lines = (update && update.rows) || [];
    paras = [
      `Since your race on ${run.search.date}, here is how the four profiles moved, from a fresh read of public Google data:`,
      ...lines.map((r) => `${r.name}: ${r.before} to ${r.after} Google reviews (${r.after - r.before >= 0 ? "+" : ""}${r.after - r.before})`),
      "Whoever asks every customer every week keeps the freshest profile. That is the part we run."
    ];
  }
  const html = layout({
    preheader: paras[0] || subject,
    body: [`<p style="${P}">Hi ${esc(first)},</p>`, ...paras.map((p) => `<p style="${P}">${esc(p)}</p>`),
      `<p style="margin:20px 0 12px"><a href="${esc(links.book)}" style="${BTN}">Pick a time for a 15-minute call</a></p>`,
      `<p style="margin:0 0 18px"><a href="${esc(links.results)}" style="${LINK2}">See your full race again</a></p>`,
      `<p style="${P}">The Rempo team</p>`].join(""),
    footer: footer(c, links.unsubscribe)
  });
  const text = [`Hi ${first},`, "", ...paras.flatMap((p) => [p, ""]), `Pick a time for a 15-minute call: ${links.book}`, `See your full race again: ${links.results}`, "", "The Rempo team", "", footer(c, links.unsubscribe, true)].join("\n");
  return { subject, html, text };
}

/* ---------- The team ---------- */
export function teamAlert({ run, links, kind = "lead", reason = "" }) {
  const r = run.race;
  const who = [run.first_name, run.email && `<${run.email}>`].filter(Boolean).join(" ");
  const biz = `${run.business.name}${run.search && run.search.where ? `, ${run.search.where}` : ""}`;
  if (kind === "later") {
    return { subject: `Review Race could not run: ${run.business.name}`, text: `${who} asked for a review race for ${biz}, and it could not run (${reason}). Build their race by hand (their Google reviews next to the three shops a homeowner sees first near them) and email it within one business day.` };
  }
  const lines = [
    `New Review Race lead: ${who}, ${biz}.`,
    r ? `Rating ${rating(r.you.rating)} on ${r.you.count} reviews; top three ${rating(r.average.rating)} on ${n(r.average.count)}.` : "",
    r && r.you.last90 !== null ? `Last 90 days: ${r.you.last90} against ${n(r.average.last90)}. Replied to ${r.you.replied} of the last ${r.you.window}; ${n(r.you.unanswered)} without a reply.` : "",
    `Results: ${links.results}`
  ].filter(Boolean);
  return { subject: `New Review Race lead: ${run.business.name}`, text: lines.join("\n") };
}

export function bookedAlert({ run, when, phone, links }) {
  return { subject: `Review Race call booked: ${run.business.name}`, text: `${run.first_name || "A lead"} <${run.email}> booked a 15-minute call for ${when}. Phone: ${phone}. Results: ${links.results}` };
}

/* ---------- Unsubscribe page ---------- */
export function unsubscribePage({ state, action, email }) {
  const body = state === "done"
    ? `<h1>You're unsubscribed.</h1><p>We won't email ${esc(email)} about the review race again.</p>`
    : state === "bad"
      ? `<h1>This link doesn't work.</h1><p>Reply to any of our emails with "unsubscribe" and we'll take you off the list.</p>`
      : `<h1>Unsubscribe?</h1><p>Stop emails about the review race to ${esc(email)}.</p><form method="post" action="${esc(action)}"><button type="submit">Unsubscribe</button></form>`;
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>Rempo</title>
<style>body{margin:0;font:16px/1.5 system-ui,sans-serif;color:#0A1A33;background:#F2F6FD}main{max-width:480px;margin:12vh auto;padding:28px;background:#fff;border-radius:16px}h1{font-size:24px;margin:0 0 10px}button{font:600 16px system-ui,sans-serif;padding:12px 20px;border:0;border-radius:12px;background:#0B6BEF;color:#fff;cursor:pointer}</style></head>
<body><main>${body}</main></body></html>`;
}
