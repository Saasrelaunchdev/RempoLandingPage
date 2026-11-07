// The Gap Check: the survey in the hero, its scoring, the result and the call step. Read by the page (questions, the
// result on screen) and by the server (it scores again, so what is stored and what Meta hears never trusts the browser).
//
// Built on the GTM's Review Engine Scorecard (rempogtmbuild, dashboards/lead-magnet-spec.md): the same scored
// questions, the same points, tiers and routing, worded for HVAC and plumbing. Two changes for Meta traffic: the trade
// is asked first (an easy "that's me" tap that sets the words for the report), and the scorecard's "search your
// service and your town" instruction is rephrased so nobody leaves the page mid-survey.
//
// Option keys (v) are what is stored; change a label freely, never a key that has data behind it.
export default {
  form: "meta-gap-report",
  callForm: "meta-call",

  steps: [
    {
      key: "trade", type: "choice", layout: "grid",
      q: "What's your trade?",
      options: [
        { v: "hvac", label: "HVAC", service: "HVAC" },
        { v: "plumbing", label: "Plumbing", service: "plumbing" },
        { v: "both", label: "HVAC and plumbing", service: "HVAC and plumbing" },
        { v: "other", label: "Another home service", service: "home services" }
      ]
    },
    {
      key: "asks", type: "choice", scored: true,
      q: "How do you ask customers for Google reviews today?",
      options: [
        { v: "none", label: "We don't really ask", points: 25 },
        { v: "remember", label: "When someone remembers", points: 20 },
        { v: "techs", label: "Our technicians ask in person", points: 15 },
        { v: "software", label: "Our job software sends a request", points: 8 },
        { v: "tool", label: "A review tool sends requests and follow-ups", points: 3 }
      ]
    },
    {
      key: "newest", type: "choice", scored: true,
      q: "When did your most recent Google review come in?",
      options: [
        { v: "week", label: "This week", points: 0 },
        { v: "month", label: "This month", points: 6 },
        { v: "1to3", label: "1 to 3 months ago", points: 14 },
        { v: "over3", label: "More than 3 months ago", points: 20 },
        { v: "unsure", label: "Not sure", points: 12 }
      ]
    },
    {
      key: "replies", type: "choice", scored: true,
      q: "How often do you reply to your Google reviews?",
      options: [
        { v: "all", label: "Every review, within two days", points: 0 },
        { v: "most", label: "Most of them", points: 4 },
        { v: "some", label: "Some of them", points: 8 },
        { v: "rarely", label: "Rarely", points: 12 },
        { v: "never", label: "Never", points: 15 }
      ]
    },
    {
      key: "compare", type: "choice", scored: true,
      q: "Next to the top three companies near you on Google, your reviews look...",
      options: [
        { v: "ahead", label: "Ahead", points: 0 },
        { v: "even", label: "About even", points: 8 },
        { v: "behind", label: "Behind", points: 18 },
        { v: "far", label: "Far behind", points: 25 },
        { v: "unchecked", label: "Haven't checked", points: 15 }
      ]
    },
    {
      key: "jobs", type: "choice", scored: true, layout: "grid",
      q: "About how many jobs do you finish in a typical week?",
      options: [
        { v: "lt5", label: "Fewer than 5", points: 3, words: "a few" },
        { v: "5to15", label: "5 to 15", points: 8, words: "5 to 15" },
        { v: "16to40", label: "16 to 40", points: 12, words: "16 to 40" },
        { v: "over40", label: "More than 40", points: 15, words: "more than 40" },
        { v: "unsure", label: "Not sure", points: 8, words: null }
      ]
    },
    {
      key: "records", type: "choice",
      q: "Where are your finished jobs recorded?",
      options: [
        { v: "fieldsoftware", label: "Job software built for the trades" },
        { v: "crm", label: "Another CRM or booking system with customer phone or email" },
        { v: "paper", label: "Paper or spreadsheets" },
        { v: "unsure", label: "Not sure" }
      ]
    },
    {
      key: "business", type: "fields",
      q: "Which business should we look up?",
      hint: "We read your public Google profile and the three companies that show up first near you.",
      fields: [
        { name: "company", label: "Business name", help: "As it shows on Google.", autocomplete: "organization", required: true, max: 120 },
        { name: "city", label: "City or town", help: "Where your customers search for you.", autocomplete: "address-level2", required: true, max: 80 }
      ],
      choice: {
        key: "profiles", label: "How many Google profiles (locations) do you have?",
        options: [
          { v: "1", label: "1" }, { v: "2", label: "2" }, { v: "3to9", label: "3 to 9" }, { v: "10plus", label: "10 or more" }
        ]
      }
    },
    {
      key: "contact", type: "fields", last: true,
      q: "Where should we send your Gap Report?",
      fields: [
        { name: "firstName", label: "First name", autocomplete: "given-name", required: true, max: 60 },
        { name: "email", label: "Email", type: "email", autocomplete: "email", inputmode: "email", required: true, max: 254 }
      ],
      consent: { name: "consentEmail", label: "Email me my score and Gap Report, and the occasional tip. Unsubscribe any time.", required: true }
    }
  ],

  // Tiers and messages: the GTM's, worded for home services. A higher score means a bigger gap.
  tiers: [
    { key: "steady", name: "Steady engine", min: 0, max: 39,
      msg: "You ask consistently, and your answers show it. The next gains are in replying to every review and putting your best ones to work on your site and profile." },
    { key: "leaky", name: "Leaky engine", min: 40, max: 69,
      msg: "Some customers get asked and some don't. At {jobs} jobs a week, that adds up to a lot of customers who were never asked.",
      msgNoJobs: "Some customers get asked and some don't. Week after week, that adds up to a lot of customers who were never asked." },
    { key: "stalled", name: "Stalled engine", min: 70, max: 100,
      msg: "Right now, asking depends on someone remembering on a busy day. That is the part Rempo runs for you, from the software you already use." }
  ],
  ruleLine: "Every customer gets the same request after every job: no filtering, no rewards, no staff names.",

  // The three biggest gaps: the scored answers with the most points, each in one plain line. An answer worth 0 points
  // is not a gap. Ties go in question order.
  gaps: {
    asks: {
      none: ["Most customers never get asked.", "94% of consumers are open to writing a local review (BrightLocal 2026). Most are never asked."],
      remember: ["Asking depends on who remembers.", "On a busy day, nobody does. That is the part Rempo runs."],
      techs: ["The ask leaves with the van.", "An ask at the door is easy to forget by the time the customer sits down."],
      software: ["Requests go out. Nobody runs them.", "No follow-up, and replies wait until someone has time."],
      tool: ["Your tool still needs someone to run it.", "Someone on your team checks it and writes the replies."]
    },
    newest: {
      month: ["Your newest review is weeks old.", "74% of consumers look for reviews from the last three months (BrightLocal 2026)."],
      "1to3": ["Your newest review is one to three months old.", "74% of consumers look for reviews from the last three months (BrightLocal 2026)."],
      over3: ["Your newest review is over three months old.", "74% of consumers look for reviews from the last three months (BrightLocal 2026)."],
      unsure: ["You're not sure when your last review came in.", "Your Gap Report shows the date, next to the top three."]
    },
    replies: {
      most: ["Some reviews still wait for a reply.", "80% of consumers are more likely to use a business that replies to all its reviews (BrightLocal 2026)."],
      some: ["Many of your reviews have no reply.", "80% of consumers are more likely to use a business that replies to all its reviews (BrightLocal 2026)."],
      rarely: ["Most of your reviews have no reply.", "80% of consumers are more likely to use a business that replies to all its reviews (BrightLocal 2026)."],
      never: ["Your reviews have no replies.", "80% of consumers are more likely to use a business that replies to all its reviews (BrightLocal 2026)."]
    },
    compare: {
      even: ["You're level with the top three.", "Level means one slow month puts you behind. The report shows each measure."],
      behind: ["You're behind the top three near you.", "Your Gap Report shows by how much, measure by measure."],
      far: ["You're far behind the top three near you.", "Your Gap Report shows where the gap is biggest, so you know what to fix first."],
      unchecked: ["You haven't checked against the top three.", "Your Gap Report does it: the search and the date are printed on it."]
    },
    jobs: {
      lt5: ["A few customers a week go unasked.", "Every one of them could vouch for you to the next homeowner."],
      "5to15": ["5 to 15 customers a week could be asked.", "Every one who isn't asked is a vouch you never hear."],
      "16to40": ["16 to 40 customers a week could be asked.", "Every one who isn't asked is a vouch you never hear."],
      over40: ["More than 40 customers a week could be asked.", "Every one who isn't asked is a vouch you never hear."],
      unsure: ["Every finished job is a customer who could be asked.", "Your report shows what that adds up to next to the top three."]
    }
  },

  // Fit decides only what Meta is told (pixel conditioning, the course's rule): everyone gets the score, the report
  // and the call. The floor and the system of record are the GTM's ICP 1 qualifiers (dashboards/04-icp.md):
  // "5 or more completed jobs a week" and "field-service software or a CRM holding customer phone or email".
  // Start wide; tighten after a quarter of data.
  fit: [
    { key: "under-floor", when: { jobs: ["lt5"] } },
    { key: "no-software", when: { records: ["paper"] } }
  ],
  qualifiedFit: "qualified",

  // Routing, from the GTM's overrides: no software holding contact details, or 3 or more Google profiles, go to a call
  // with no checkout link.
  callOnly: { records: ["paper"], profiles: ["3to9", "10plus"] },
  callOnlyWhy: { records: "your jobs are on paper or in spreadsheets", profiles: "you run three or more locations" },

  // The call step. The course's booking rules: a short window (about 5 business days), never the same day, no weekends.
  booking: {
    days: 5,
    windows: [
      { v: "morning", label: "Morning", hint: "8 to 11 am", start: 8, end: 11 },
      { v: "midday", label: "Midday", hint: "11 am to 2 pm", start: 11, end: 14 },
      { v: "afternoon", label: "Afternoon", hint: "2 to 5 pm", start: 14, end: 17 }
    ],
    phone: { name: "phone", label: "Best number to call", prefix: "+1", autocomplete: "tel-national", inputmode: "tel" },
    consentPhone: { name: "consentPhone", label: "You may call me about Rempo.", required: true },
    consentText: { name: "consentText", label: "You may text me to confirm or move the call.", required: false }
  }
};
