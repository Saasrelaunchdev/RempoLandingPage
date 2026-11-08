// The facts every legal page reads. Fill a null, run `node legal-src/tools/build.mjs`, commit.
// null means "not decided yet": the pages fall back to the brand name or leave the line out, and the preview view
// (add ?view=preview to any /legal page) lists what is still missing. Never put a guess here: these are legal facts.
export default {
  brand: "Rempo",

  // The legal entity that signs the Terms, for example "Rempo LLC, a California limited liability company".
  // Until set, the documents name "Rempo". Set it before checkout goes live (see legal-src/README.md, "Before launch").
  legalName: null,

  // Where the founder operates. Used for governing law, venue, and the footer line.
  city: "San Diego, California",

  // The mailing address for legal notices and the postal address commercial email must carry (CAN-SPAM).
  // A PO box or a commercial mail receiving agency works. Until set, notices go by email only.
  address: null,

  site: "rempo.io",
  siteUrl: "https://rempo.io",

  // Mailboxes the documents give out. Create each one (or an alias that forwards) before the pages go live.
  emails: {
    privacy: "privacy@rempo.io",
    support: "support@rempo.io",
    legal: "legal@rempo.io"
  },

  // A phone number for support and texting HELP replies. Optional.
  phone: null,

  // The date printed as "Last updated" on every document. Change it whenever a document's meaning changes.
  updated: "2026-11-08",

  // The version stored with every lead (the forms send it), so a lead can be matched to the wording it agreed to.
  // Bump it to the new date whenever form consent wording or these documents change, in the forms too.
  noticeVersion: "2026-11-08",

  // Rempo's own text-message program (call confirmations and service notices), as registered with the carriers.
  smsProgram: "Rempo call and service notices",

  // Keep search engines off these pages while the master page is noindex (pre-launch). Set to false at launch.
  noindex: true,

  // The Stripe customer portal link where clients cancel online, once checkout is live. Until set, cancel by email.
  billingPortalUrl: null
};
