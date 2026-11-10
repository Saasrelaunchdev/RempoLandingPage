// /start/welcome: where Stripe sends the buyer after paying (success_url, with the session id). It asks /api/checkout
// whether the payment went through and shows the next step at once: the founder's onboarding link, filled in with the
// buyer's details. It never waits for the webhook; the handoff to GoHighLevel happens behind it.
const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
const state = (name) => $$("[data-state]").forEach((el) => { el.hidden = el.dataset.state !== name; });
const fill = (attr, text) => $$(`[${attr}]`).forEach((el) => { el.textContent = text; });

async function start() {
  const id = new URLSearchParams(location.search).get("session_id") || "";
  if (!/^cs_(test|live)_[A-Za-z0-9]+$/.test(id)) { state("unknown"); return; }
  let data = null;
  for (let attempt = 0; attempt < 3 && !data; attempt++) {
    try {
      const r = await fetch(`/api/checkout?session_id=${encodeURIComponent(id)}`, { headers: { accept: "application/json" } });
      if (r.ok) data = await r.json();
      else if (r.status === 404 || r.status === 400) break;
    } catch { /* the network blinked: try again */ }
    if (!data) await new Promise((res) => setTimeout(res, 800 * (attempt + 1)));
  }
  if (!data) { state("unknown"); return; }
  if (data.support) $$("[data-support]").forEach((a) => { a.href = `mailto:${data.support}`; a.textContent = data.support; });
  if (data.email) fill("data-email", data.email);
  if (data.processing) { state("processing"); return; }
  if (!data.paid) { state("unknown"); return; }
  fill("data-first", data.firstName ? `, ${data.firstName}` : "");
  fill("data-plan", data.plan ? ` ${data.plan}` : "");
  $$("[data-test]").forEach((el) => { el.hidden = !data.test; });
  const link = $$("[data-onboarding]")[0];
  if (data.onboardingUrl && link) {
    link.href = data.onboardingUrl;
  } else {
    $$("[data-next]").forEach((el) => { el.hidden = true; });
    $$("[data-next-later]").forEach((el) => { el.hidden = false; });
  }
  // Paid: the checkout's saved answers are no longer needed
  try { sessionStorage.removeItem("st-form"); } catch { /* storage blocked */ }
  state("paid");
  document.title = `You're in${data.firstName ? `, ${data.firstName}` : ""} | Rempo`;
}

start();
