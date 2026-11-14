// Rempo's claim rules, applied to every word a visitor reads: the page copy, the emails, and everything Claude writes.
// The rules are the landing page's own (meta/rules/copy-rules.json, from the GTM build's do-not-say list), copied here
// so this project stands alone, plus the GTM brief's banned words and the rules for review replies.

const NEGATION = /\b(no|not|never|don't|doesn't|won't|isn't|aren't|can't|cannot|without|nor|none)\b|n't\b/i;
const SOURCED = /\((BrightLocal|ACHR News|Census|IBISWorld|Roofing Contractor)[^)]*\d{4}\)/;

export const RULES = [
  { id: "more-reviews", re: /\b(get|gets|getting|more|extra|new) (more )?reviews\b(?! in)|\breviews? a month\b/i, msg: "Never promise reviews: describe the asking, not the result", refusalOk: true },
  { id: "ranking", re: /\b(rank|ranks|ranking|rankings) (higher|better|up|first)\b|\bhigher ranking\b|\btop of google\b/i, msg: "Never promise rankings", refusalOk: true },
  { id: "guarantee", re: /\bguarantee/i, msg: "No guarantees of results", refusalOk: true },
  { id: "lift", re: /\b(personali[sz]ed|photo) (requests? )?(get|gets|drive|drives|boost|boosts|raise|raises)\b/i, msg: "No lift claimed for the personalized request" },
  { id: "hyper", re: /\bhyper-?personali[sz]/i, msg: "Say 'personalized request'" },
  { id: "instant", re: /\binstant(ly)?\b|\bautomatic(ally)?\b|\bautopilot\b/i, msg: "No 'instant', 'automatic' or 'autopilot'" },
  { id: "always-on", re: /24\/7/, msg: "'24/7' is dropped" },
  { id: "old-names", re: /google search boost|geotag|ai employee/i, msg: "Dropped names and claims" },
  { id: "rep-mgmt", re: /\breputation management\b/i, msg: "Name what is included instead" },
  { id: "remove", re: /\bremov\w* (bad |negative )?reviews?\b/i, msg: "Only as a refusal: Rempo does not remove reviews", refusalOk: true },
  { id: "gating", re: /\b(catch|filter|screen)\w* (out )?unhappy\b/i, msg: "Only as a refusal: no review gating", refusalOk: true },
  { id: "offer", re: /\$\s?\d|month to month|money back|free trial|start free/i, msg: "No prices or terms: the offer is not decided" },
  { id: "works-with", re: /\bworks with (jobber|housecall|servicetitan)|\bintegrates with\b/i, msg: "Name no job software as supported" },
  { id: "banned-words", re: /\b(leverage|unlock|seamless|robust|streamline|cutting-edge|empower)\w*/i, msg: "Banned word (GTM brief)" },
  { id: "promise", re: /\b(will|would) (bring|get|win|earn|drive|boost|increase|double|grow) (you )?(more )?(calls|jobs|customers|revenue|leads|sales)\b/i, msg: "Never promise calls, jobs or revenue" }
];

const sentences = (t) => String(t).split(/(?<=[.!?])\s+/).filter(Boolean);

// Errors for one visitor-facing string. `stats: false` skips the source check for numbers that are the business's own
// (a reply rate on its own reviews is a measurement, not a statistic that needs a source).
export function lintCopy(text, { stats = true, allow = [] } = {}) {
  const errors = [];
  const t = String(text ?? "");
  if (/[–—]/.test(t)) errors.push("no em or en dashes");
  for (const s of sentences(t)) {
    for (const r of RULES) {
      if (allow.includes(r.id) || !r.re.test(s)) continue;
      if (r.refusalOk && NEGATION.test(s)) continue;
      errors.push(`${r.msg} (${r.id}): ${s}`);
    }
    if (stats && /\d+(\.\d+)?%/.test(s) && !SOURCED.test(s)) errors.push(`a statistic needs its source in the same sentence: ${s}`);
  }
  return errors;
}

const REPLY_BANS = [
  [/\b(refund|discount|coupon|gift card|voucher|compensat\w*|credit (you|your account))\b/i, "no offers or money in a reply"],
  [/\b(remove|delete|take down|change|update|edit|revise)\b[^.]{0,30}\breview\b/i, "never ask to change or remove a review"],
  [/\bgoogle('s)? (policy|policies|guidelines|terms)\b/i, "no policy talk in a reply"],
  [/https?:\/\/|www\.|@[a-z0-9-]+\.[a-z]/i, "no links or email addresses in a reply"],
  [/\bsorry for (any|the) inconvenience\b|\bwe appreciate your feedback\b|\bvalued customer\b/i, "stock phrase: write it for this review"],
  [/%/, "no percentages in a reply"]
];

// Errors for one reply draft, on top of the claim rules
export function lintReply(text) {
  const t = String(text ?? "").trim();
  const errors = lintCopy(t, { stats: false });
  if (!t) errors.push("empty reply");
  const words = t.split(/\s+/).filter(Boolean).length;
  if (words > 70) errors.push(`too long: ${words} words (70 at most)`);
  if (sentences(t).length > 4) errors.push("more than four sentences");
  for (const [re, msg] of REPLY_BANS) if (re.test(t)) errors.push(msg);
  return errors;
}

// Every string in a nested object or array, with its path
export function strings(value, path = "") {
  if (typeof value === "string") return [{ path, text: value }];
  if (Array.isArray(value)) return value.flatMap((v, i) => strings(v, `${path}[${i}]`));
  if (value && typeof value === "object") return Object.entries(value).flatMap(([k, v]) => (k.startsWith("_") ? [] : strings(v, path ? `${path}.${k}` : k)));
  return [];
}
