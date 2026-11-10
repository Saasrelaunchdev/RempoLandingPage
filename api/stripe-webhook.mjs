// /api/stripe-webhook: Stripe tells the site that a checkout was paid or abandoned, and the buyer is handed to the
// founder's GoHighLevel (setup: checkout/README.md).
//
//   checkout.session.completed               paid (or, for a delayed payment method, waiting: then nothing yet)
//   checkout.session.async_payment_succeeded the delayed payment came in
//       -> the purchase is recorded in Supabase, the buyer becomes a tagged contact in GoHighLevel (the tag starts the
//          founder's onboarding workflow), and the team gets an email and a Slack message
//   checkout.session.expired                 unpaid after an hour -> only for buyers who agreed to email: the contact
//                                            gets the abandoned tag and Stripe's recovery link, for the founder's
//                                            follow-up
//
// Safe to receive twice: a purchase already handed off is not handed off again. When GoHighLevel cannot be reached, the
// answer is an error, so Stripe sends the event again (for up to three days) and the team is told once.
// Written as a Web handler (POST(request)) because Stripe's signature covers the exact bytes it sent, and only the raw
// body has them. Only sessions this site opened (metadata.source) are handled; anything else is acknowledged and ignored.
import { SOURCE } from "./_lib/checkout/config.mjs";
import { stripeConfig, stripe, stripeError, verifySignature } from "./_lib/checkout/stripe.mjs";
import { ghlConfig, ghlNotConnected, handOffPurchase, handOffAbandoned } from "./_lib/checkout/ghl.mjs";
import { storeConfig, storeNotConnected, recordCheckout, recordHandoff } from "./_lib/checkout/store.mjs";
import { notifyPurchase } from "./_lib/checkout/notify.mjs";
import { purchaseFrom, rowFrom } from "./_lib/checkout/purchase.mjs";

const json = (status, data) => new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" } });

export async function POST(request) {
  const raw = Buffer.from(await request.arrayBuffer());
  const cfg = stripeConfig();
  if (!cfg.webhookSecrets.length) {
    console.error("stripe-webhook: STRIPE_WEBHOOK_SECRET is not set, so the event is refused; Stripe will send it again");
    return json(503, { error: "not configured" });
  }
  const check = verifySignature(raw, request.headers.get("stripe-signature"), cfg.webhookSecrets);
  if (!check.ok) return json(400, { error: `signature check failed: ${check.reason}` });
  let event;
  try { event = JSON.parse(raw.toString("utf8")); } catch { return json(400, { error: "invalid JSON" }); }
  try {
    const out = await handle(event, cfg);
    return json(out.status || 200, out.body);
  } catch (e) {
    console.error("stripe-webhook:", event && event.type, e && e.message);
    return json(500, { error: "not handled yet; Stripe will send it again" });
  }
}

// A quick look at whether the endpoint is set up (the full report: /api/checkout?health=1)
export async function GET() {
  const cfg = stripeConfig();
  return json(200, { endpoint: "stripe-webhook", signingSecret: cfg.webhookSecrets.length > 0, stripeKey: cfg.ok, mode: cfg.mode, report: "/api/checkout?health=1" });
}

export async function handle(event, cfg) {
  const s = event && event.data && event.data.object;
  if (!s || s.object !== "checkout.session") return { body: { received: true, ignored: event && event.type } };
  if (!s.metadata || s.metadata.source !== SOURCE) return { body: { received: true, ignored: "not a checkout from rempo.io/start" } };
  // A live event on a test key (or the reverse): the key cannot read the session. Refused, so it is not lost while the
  // keys are fixed (Stripe sends it again).
  if (cfg.mode && Boolean(event.livemode) !== (cfg.mode === "live")) {
    throw new Error(`a ${event.livemode ? "live" : "test"} event reached a deployment with a ${cfg.mode} key: check STRIPE_SECRET_KEY and the webhook endpoint`);
  }
  switch (event.type) {
    case "checkout.session.completed":
    case "checkout.session.async_payment_succeeded":
      return fulfil(s.id, cfg);
    case "checkout.session.expired":
      return abandoned(s);
    default:
      return { body: { received: true, ignored: event.type } };
  }
}

// Paid: record it, hand it off, tell the team
async function fulfil(sessionId, cfg) {
  // The session as it is now, with its line items (Stripe's advice: never trust the event alone)
  const r = await stripe(cfg, "GET", `/v1/checkout/sessions/${encodeURIComponent(sessionId)}`, { expand: ["line_items"] });
  if (r.status !== 200 || !r.data) throw new Error(`Stripe answered HTTP ${r.status} for the session: ${stripeError(r)}`);
  const p = purchaseFrom(r.data);
  if (!p.paid) return { body: { received: true, waiting: "the payment has not gone through yet" } };

  const store = storeConfig();
  let prior = null, storeProblem = null;
  if (store.ok) {
    try { prior = await recordCheckout(store, rowFrom(p)); } catch (e) { storeProblem = e.message; }
  } else storeProblem = storeNotConnected(store);
  if (prior && prior.handed_off_at) return { body: { received: true, duplicate: true } };

  const ghl = ghlConfig();
  let contactId = null, error = null;
  if (!ghl.ok) error = ghlNotConnected(ghl);
  else {
    try { ({ contactId } = await handOffPurchase(ghl, p)); } catch (e) { error = e.message; }
  }
  if (store.ok && !storeProblem) {
    try { await recordHandoff(store, p.sessionId, { contactId, error }); } catch (e) { storeProblem = e.message; }
  }
  // The team hears once per outcome: the handoff, or its first failure (and again when it finally works)
  const firstFailure = Boolean(error) && !(prior && prior.handoff_error);
  if (!error || firstFailure || storeProblem) await notifyPurchase(p, { handedOff: !error, error, storeProblem });
  if (error) return { status: 500, body: { error: "not in GoHighLevel yet; Stripe will send it again" } };
  return { body: { received: true, handedOff: true } };
}

// Abandoned: only for buyers who agreed to email, and never for someone who has paid since
async function abandoned(s) {
  const p = purchaseFrom(s);
  const store = storeConfig();
  let prior = null;
  if (store.ok) {
    try { prior = await recordCheckout(store, rowFrom(p)); } catch (e) { console.error("stripe-webhook: abandoned checkout not recorded:", e.message); }
  }
  if (prior && prior.handed_off_at) return { body: { received: true, duplicate: true } };
  if (!p.consentEmail || !p.email) return { body: { received: true, followUp: false, why: "did not agree to email" } };
  if (prior && prior.email_paid_elsewhere) return { body: { received: true, followUp: false, why: "paid in another checkout" } };
  const ghl = ghlConfig();
  if (!ghl.ok) return { body: { received: true, followUp: false, why: "GoHighLevel is not connected" } };
  let out;
  try { out = await handOffAbandoned(ghl, p); } catch (e) {
    if (store.ok) { try { await recordHandoff(store, p.sessionId, { error: e.message }); } catch { /* reported below */ } }
    throw e;
  }
  if (store.ok) { try { await recordHandoff(store, p.sessionId, { contactId: out.contactId }); } catch (e) { console.error("stripe-webhook:", e.message); } }
  return { body: { received: true, followUp: !out.skipped, ...(out.skipped ? { why: out.skipped } : {}) } };
}
