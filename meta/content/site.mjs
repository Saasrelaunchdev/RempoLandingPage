// Site settings, read by the build (the page) and by the server (/api/meta-lead and its emails).
// null means "not decided yet": the page leaves the thing out, and the preview view (add ?view=preview to any page)
// shows a {TBD} chip where it will go. Fill a value, run `node tools/build.mjs`, commit. PLAN.md section 11 lists them.
export default {
  name: "Rempo",

  // Where these pages live on the master page's domain: /customers, /customers/recent, /customers/replies and
  // /customers/request. The build writes them to the repository's customers/ folder, which the master page's Vercel
  // project serves as it is. To move them: change this, update the "/customers" headers in the root vercel.json,
  // build, delete the old folder, commit.
  path: "/customers",

  // Where the page sends its leads: the function api/meta-lead.mjs at the repository root (it runs api/lead.mjs here).
  // Its own address, so it never meets the master page's /api/lead.
  endpoint: "/api/meta-lead",

  // The master page's address once its domain points at Vercel, with no path (for example "https://rempo.io").
  // Sets the canonical link (this address followed by the page's path) and the share image's full URL. Until then
  // both are left out or relative.
  url: null,

  // The master page, for the footer link. The GTM names rempo.io as the company site.
  masterUrl: "https://rempo.io",

  // Legal name and city for the footer and the emails, for example "Rempo LLC, Austin, Texas".
  company: null,

  // The postal address that commercial email must carry (CAN-SPAM). The prospect emails add it when set.
  postalAddress: null,

  // The privacy notice. Needed before ads run: Meta's terms ask that a site using the pixel says so.
  privacyUrl: null,

  // Where "Rather skip the call? Get started" goes once the offer is decided: a Stripe Payment Link or the checkout.
  // It carries the campaign and the visit id. Until then the page shows no checkout link anywhere.
  checkoutUrl: null,

  // The offer. Undecided in the GTM (dashboards 06, 09, 12 are PLANNED), so the page states no price or terms.
  // When decided: set decided: true and line to the exact words the founder approved (for example the GTM's planned
  // line "$297 a month per Google profile, $497 setup..."), and the FAQ's cost answer shows it.
  offer: { decided: false, line: null },

  // The Meta dataset (pixel) id. Public by nature (it is in every page's source). Set the same id as META_PIXEL_ID in
  // Vercel, with META_CAPI_TOKEN, for the Conversions API. Until set, the page loads no pixel.
  metaPixelId: null,

  // Microsoft Clarity project id: session recordings, free (optional).
  clarityId: null,

  // When the Gap Report arrives. From the GTM's lead magnet spec: "by email within one business day".
  reportTurnaround: "within one business day",

  // The founder, for "Who reads your report". Hidden until filled:
  // { name: "First Last", role: "Founder", photo: "/assets/founder.webp", line: "One sentence, in their voice." }
  // Put the photo in src/assets/ (square, 640 px or more) and point photo at /assets/<file>.
  founder: null,

  // The video, once recorded (PLAN.md section 13). Hidden until filled:
  // { type: "mp4", src: "https://.../walkthrough.mp4", poster: "/assets/vsl-poster.webp", captions: "/assets/vsl.vtt",
  //   length: "2 minutes", placement: "booked" }   placement: "booked" (after booking) or "hero" (also in the hero)
  // or { type: "youtube", id: "VIDEO_ID", length: "2 minutes", placement: "booked" }
  vsl: null,

  // Who sends the prospect's emails is a server setting (PROSPECT_EMAIL_FROM in Vercel), not a page setting.
};
