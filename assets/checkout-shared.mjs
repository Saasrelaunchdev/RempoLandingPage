// The checkout's shared rules, used by the page (/start, start/start.mjs) and by the server (api/checkout.mjs), so
// both route a buyer the same way and show the same words about price and renewal. Plain functions, no imports.
//
// The routing is the GTM's qualifier (go-to-market build, dashboard 15, section 15.2): how many Google profiles, whether
// the job software records every completed job, and who will run the program.

export const ANSWERS = {
  profiles: ["1", "2", "3+"],
  software: ["yes", "no", "not-sure"],
  runs: ["handle", "office", "not-sure"]
};

// The plan a buyer's answers point to, if Rempo sells it online now (available(id) says whether its prices are in
// Stripe). { to: "plan", plan } | { to: "call", why } | { to: "incomplete" }
export function routeFor(a, available = () => true) {
  const answers = a || {};
  if (!ANSWERS.profiles.includes(answers.profiles) || !ANSWERS.software.includes(answers.software) || !ANSWERS.runs.includes(answers.runs)) {
    return { to: "incomplete" };
  }
  // 3 or more profiles: quoted on a call (Local Authority)
  if (answers.profiles === "3+") return { to: "call", why: "profiles" };
  // Not sure the software records every job: the team checks the connection before any monthly charge
  if (answers.software === "not-sure") return { to: "call", why: "software-check" };
  // No software to connect, or not sure who will run it: the one-time Jumpstart. Otherwise the monthly plan they chose
  const plan = answers.software === "no" || answers.runs === "not-sure" ? "jumpstart" : answers.runs === "handle" ? "done-for-you" : "engine-software";
  return available(plan) ? { to: "plan", plan } : { to: "call", why: "plan-not-offered" };
}

// $297, or $297.50: whole amounts without cents
export function formatMoney(minor, currency = "usd") {
  const n = Number(minor) / 100;
  try {
    return new Intl.NumberFormat("en-US", { style: "currency", currency: String(currency || "usd").toUpperCase(),
      minimumFractionDigits: Number.isInteger(n) ? 0 : 2, maximumFractionDigits: 2 }).format(n);
  } catch {
    return `$${n.toFixed(Number.isInteger(n) ? 0 : 2)}`;
  }
}

// What the buyer pays today and what renews. plan: the catalog's plan ({ mode, currency, monthly, annual, setup, once },
// each price with its amount in cents). billing: "monthly", "annual" or "once"
export function priceSummary(plan, billing, profiles, { setupPerProfile = false, setupWaivedOnAnnual = true } = {}) {
  const n = Math.max(1, Number(profiles) || 1);
  if (plan.mode === "payment") {
    const once = plan.once.amount;
    return { today: once, renews: null, per: null, recurring: null, setup: null, profiles: 1 };
  }
  const annual = billing === "annual" && plan.annual;
  const rec = annual ? plan.annual : plan.monthly;
  const setupCharged = plan.setup && !(annual && setupWaivedOnAnnual);
  const setup = setupCharged ? plan.setup.amount * (setupPerProfile ? n : 1) : null;
  return { today: rec.amount * n + (setup || 0), renews: rec.amount * n, per: annual ? "year" : "month", recurring: rec.amount, setup, profiles: n };
}

// The renewal terms, said next to the pay button on /start and inside Stripe's checkout (custom_text.submit): the price,
// how often it renews, that it runs until cancelled, the one-time fee, and how to cancel (California's automatic
// renewal law and the billing policy at /legal/billing). At most 1,200 characters, Stripe's limit.
export function renewalText(plan, billing, profiles, options = {}) {
  const s = priceSummary(plan, billing, profiles, options);
  const cur = plan.currency;
  const parts = [];
  if (s.renews === null) {
    parts.push(`One payment of ${formatMoney(s.today, cur)}. Nothing renews.`);
  } else {
    const each = s.profiles > 1 ? ` per Google profile, ${formatMoney(s.renews, cur)} for ${s.profiles} profiles,` : "";
    parts.push(`Renews every ${s.per} at ${formatMoney(s.recurring, cur)}${each} until you cancel.`);
    if (s.setup) parts.push(`The ${formatMoney(s.setup, cur)} setup fee is charged once, today.`);
    parts.push("Cancel any time online or by email. You keep the service until the end of the period you paid for.");
  }
  if (options.guarantee) parts.push(String(options.guarantee));
  return parts.join(" ").slice(0, 1200);
}
