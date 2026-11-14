// Every word the Review Race shows on the page. Change words here, never in race.js. Placeholders in braces are filled
// on the page. tests/copy.test.mjs runs Rempo's claim rules over all of it (no promised reviews or rankings, no em
// dashes, every statistic sourced in its own sentence).
export default {
  hero: {
    eyebrow: "For HVAC and plumbing shop owners",
    h1: "Your work is better. Do your reviews show it?",
    lead: "See how your Google reviews compare with the three shops homeowners see first near you. Free, in about a minute.",
    label: "Find your business on Google",
    placeholder: "Your business name",
    button: "See where you stand",
    note: "Free. No card, no call needed."
  },
  section: {
    eyebrow: "Free review race",
    h2: "You against the three shops homeowners see first.",
    lead: "Type your business name. We find the three businesses a homeowner sees first when they search your trade near you, and put your Google reviews next to theirs.",
    trust: ["Free, no card", "About a minute", "No call needed"]
  },
  demo: "Demo mode: sample businesses and reviews. Nothing is sent anywhere.",
  search: {
    label: "Your business on Google",
    placeholder: "Start typing your business name",
    hint: "Pick your business from the list.",
    searching: "Searching Google...",
    none: "No match yet. Try your business name and town.",
    attribution: "Business search powered by Google",
    error: "The search isn't working right now. Try again in a minute.",
    change: "Change business",
    pick: "Pick your business from the list first.",
    // When the search runs on SerpApi (no Google key): type, press Find, pick
    find: "Find",
    findPlaceholder: "Your business name and town",
    findHint: "Type your business name and town, then press Find.",
    findSearching: "Searching Google Maps...",
    findNone: "No match. Try your business name and town as they show on Google Maps.",
    findPick: "Pick your business from the list.",
    findAttribution: "Results from public Google Maps listings"
  },
  loading: {
    title: "Finding the three shops homeowners see first",
    steps: ["Finding your business on Google Maps", "Searching your trade near you", "Lining up the top three"]
  },
  preview: {
    kicker: "Free preview",
    title: "Who a homeowner sees first for “{query}” near {where}",
    you: "You",
    rank: "#{n} in this search",
    notRanked: "Not in the first 20 results",
    reviews: "{n} reviews",
    oneReview: "1 review",
    noRating: "No rating yet",
    gap: {
      behind: "The three shops a homeowner sees first average {avg} Google reviews. You have {n}.",
      level: "Your review count is level with the top three near you. The race is about who is adding reviews now.",
      ahead: "Your review count is ahead of the top three near you. The race is about who is adding reviews now.",
      unknown: "Here is how your Google profile sits next to the three shops a homeowner sees first."
    },
    searchNote: "We searched “{query}” near {where} on {date}. Run the same search on Google Maps to check it.",
    noRivals: "We couldn't find nearby businesses to compare with for “{query}” near {where}. Leave your email and we'll look it up by hand."
  },
  locked: {
    title: "Your full race is one step away",
    lead: "Three more things, built from your own reviews:",
    drafts: "We wrote replies to {n} of your reviews that have no reply yet",
    draftsOne: "We wrote a reply to 1 of your reviews that has no reply yet",
    draftsNone: "Every review we read has a reply. Your full race shows what else stands out",
    draftsWait: "Reading your reviews to find the ones without a reply",
    unanswered: "{n} of your last {m} reviews have no reply.",
    race: "Your 12-month race against the top three",
    fixes: "The three things you're missing, in plain words",
    formTitle: "Where should we send your full race?",
    firstName: "First name",
    email: "Email",
    consentEmail: "Email me my race and reply drafts, and the occasional tip. Unsubscribe any time.",
    noticeBefore: "By tapping Show my full race, you agree to our ",
    terms: "Terms of Service",
    noticeMiddle: " and acknowledge our ",
    privacy: "Privacy Policy",
    noticeAfter: ", which explains what we collect and how we use it. We keep your details in our CRM to send your race and follow up.",
    button: "Show my full race",
    errors: { firstName: "Please enter your first name.", email: "Please check your email address.", consent: "Please tick the box so we can email your race." }
  },
  analyzing: {
    title: "Building your full race",
    steps: ["Reading your recent reviews", "Comparing your pace with the top three", "Writing your replies", "Checking every line"]
  },
  results: {
    kicker: "Your review race",
    raceTitle: "Google reviews in the last 90 days",
    paceYou: "At the pace of the last 90 days, you would add about {a} Google reviews over the next 12 months.",
    paceThem: "The top three near you would add about {b} each.",
    atLeast: "at least",
    areasTitle: "Where you stand",
    topThree: "Top three",
    status: { ahead: "Ahead", level: "Level", behind: "Behind", unknown: "Not enough data" },
    areas: {
      firstImpression: { title: "First impression", line: "Your star rating and profile basics, next to theirs.", rating: "Star rating", basics: "Profile basics", basicsValue: "{n} of 5" },
      trust: { title: "Trust", line: "How many customers vouch for you.", count: "Total reviews", cushionAbove: "{k} one-star reviews would take you under 4.5 stars.", cushionAboveOne: "1 one-star review would take you under 4.5 stars.", cushionBelow: "{m} five-star reviews in a row would bring you to 4.5 stars.", cushionStat: "31% of consumers only use businesses rated 4.5 stars or higher, up from 17% (BrightLocal 2026)." },
      momentum: { title: "Momentum", line: "Whether your reviews are still coming in.", last90: "Last 90 days", newest: "Newest review" },
      care: { title: "Care", line: "Whether homeowners can see you answer.", replied: "Replied to", repliedValue: "{r} of {w}", theirValue: "about {s} of 30" }
    },
    days: { today: "today", yesterday: "yesterday", many: "{n} days ago", unknown: "not known" },
    fixesTitle: "What you're missing",
    firstStep: "First step:",
    draftsTitle: "{n} replies, ready to post",
    draftsTitleOne: "A reply, ready to post",
    draftsTitleNone: "Your replies",
    draftsLead: "Read each one, make it yours, then post it as your reply on Google: open Google Maps, tap your business, tap Reviews, then Reply.",
    copy: "Copy reply",
    copied: "Copied",
    openGoogle: "Open on Google",
    callFirst: "Call them first if you can, then post the reply.",
    aCustomer: "A customer",
    noText: "Left stars without words.",
    draftsAllAnswered: "Every review we read has a reply. That's rare, and homeowners can see it.",
    draftsUnavailable: "The reply drafts aren't available right now. Your race and your three fixes are below.",
    mentionsTitle: "What your customers mention",
    praise: "Praised",
    complaint: "{theme}: {n} reviews",
    nextTitle: "Rather hand it over?",
    nextRest: "{n} more of your recent reviews have no reply.",
    nextRestOne: "1 more of your recent reviews has no reply.",
    nextPitch: "That's the part Rempo runs: a request after every completed job, one reminder, and a reply written for every review. You see the work every month.",
    how: "See how Rempo runs it",
    footnote: "We searched “{query}” near {where} on {date}. Public data from Google Maps.",
    emailed: "A copy is on its way to {email}."
  },
  booking: {
    title: "Last step: pick a time",
    lead: "A 15-minute call to walk through your race and what we'd run first.",
    loading: "Finding open times...",
    day: "Day",
    time: "Time",
    none: "No open times in the next few days.",
    external: "Pick a time on our calendar",
    noCalendar: "Reply to your results email and we'll set a time that works.",
    phone: "Best number to call",
    phoneHint: "US number, 10 digits.",
    consentCall: "You may call me about Rempo.",
    consentText: "You may text me to confirm or move the call.",
    button: "Book my call",
    booking: "Booking...",
    booked: "You're booked: {when}. We'll call {phone}.",
    bookedShort: "You're booked for {when}.",
    expect: "On the call we walk through your race and what we'd run first. Bring whoever runs the office.",
    addToCalendar: "Add to my calendar",
    errors: { slot: "Pick a time first.", phone: "Please enter a 10-digit phone number.", consent: "Please tick the box so we can call you." }
  },
  later: {
    title: "We'll send your race by email",
    lead: "Leave your name and email, and someone on our team will put your race together and email it within one business day.",
    button: "Email me my race",
    done: "Thanks, {name}. We'll email your race within one business day."
  },
  errors: {
    generic: "Something went wrong. Please try again in a minute.",
    network: "We couldn't reach the server. Check your connection and try again.",
    retry: "Try again"
  }
};
