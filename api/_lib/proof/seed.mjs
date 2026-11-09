// The first two case studies and the first video, as data. This is what the site shows until the admin has saved its
// own content (or when Vercel Blob is not connected), and what the admin starts from: the first save copies it into the
// store, after which every item can be edited there. Files under /media are part of the site itself.

export const SEED_TESTIMONIALS = [
  {
    id: "german-aquino",
    name: "German Aquino",
    role: "Owner, Ranchero Plumbing",
    business: "Ranchero Plumbing",
    location: "Half Moon Bay, CA",
    caseStudy: "ranchero-plumbing",
    intro: "German Aquino owns Ranchero Plumbing in Half Moon Bay. Two months after opening, Rempo set up their review system. Here is the first week, in German's words.",
    quote: "We went from getting little to no reviews to having 10 in the first week.",
    quoteLong: "We went from getting little to no reviews to having 10 in the first week that Sam set up our system.",
    title: "German Aquino, owner of Ranchero Plumbing, on Rempo",
    summary: "German Aquino on the first week of Rempo's review system for Ranchero Plumbing.",
    duration: 34.1,
    uploadDate: "2026-09-14",
    lang: "en",
    src: "/media/testimonials/german-aquino.mp4",
    srcWebm: "/media/testimonials/german-aquino.webm",
    vtt: "/media/testimonials/german-aquino.en.vtt",
    srt: "/media/testimonials/german-aquino.en.srt",
    poster: "/media/testimonials/german-aquino-poster.webp",
    avatar: "/media/testimonials/german-aquino-avatar.webp",
    transcript: "Hello everybody, my name is German Aquino. I'm the owner of Ranchero Plumbing, and I would highly recommend Sam and the rest of the Rempo team to take care of all your back-end stuff. They handle our complete review system setup. We approximately got 10 to 12 reviews in the first week, which I think that was amazing. We went from getting little to no reviews to having 10 in the first week that Sam set up our system. If you're looking for a hands-free business setup, I highly recommend Sam and the rest of the Rempo team. They help their business tremendously, and I'm very happy and looking forward to keep working with them. Thank you so much."
  }
];

export const SEED_CASES = [
  {
    slug: "junkaway-movers",
    business: {
      name: "Junkaway & Movers LLC", short: "Junkaway & Movers", nick: "Junkaway & Movers",
      industry: "Junk removal and moving", icon: "i-van",
      city: "San Mateo", region: "California", regionCode: "CA", country: "US",
      area: "on the San Francisco Peninsula", areaServed: ["San Francisco Peninsula", "Silicon Valley"], schemaType: "LocalBusiness"
    },
    card: {
      tag: "Six months",
      title: "From 32 to 102 Google reviews in six months.",
      line: "The team already asked after each job. Rempo took over the follow-up.",
      stats: [{ big: "+70", label: "new five-star reviews" }, { big: "6", label: "months with Rempo" }]
    },
    hero: {
      h1: "From 32 to 102 Google reviews in six months.",
      lead: "Junkaway & Movers already asked for a review after each job. Rempo took over the follow-up.",
      facts: [{ big: "+70", label: "new five-star reviews" }, { big: "102", label: "Google reviews, up from 32" }, { big: "6", label: "months with Rempo" }]
    },
    gbp: { rating: "5.0", count: "102", was: "32", kind: "Junk removal service", photo: "/media/case-studies/junkaway-truck.webp" },
    numbers: { before: 32, after: 102, gained: 70, pill: "+70", beforeCaption: "Two years before Rempo", afterCaption: "Six months with Rempo" },
    scene: {
      unit: 2.1, cols: [
        { num: "32", cap: "Two years before Rempo", segs: [{ n: 32, k: "old" }] },
        { num: "102", cap: "Six months with Rempo", rq: true, segs: [{ n: 32, k: "old" }, { n: 70, k: "new", pill: "+70" }] }
      ]
    },
    sceneLabel: "Junkaway & Movers' Google reviews: 32 after two years before Rempo; 102 after six months with Rempo, 70 of them new.",
    glance: [
      { dt: "The business", dd: "Junkaway & Movers LLC, junk removal and moving" },
      { dt: "Based in", dd: "San Mateo, California" },
      { dt: "Serves", dd: "The San Francisco Peninsula and Silicon Valley" },
      { dt: "Before Rempo", dd: "32 Google reviews, collected over two years" }
    ],
    chapters: {
      before: {
        label: "Before Rempo",
        h2: "The asking was there. The follow-up wasn't.",
        lead: "Over two years, Junkaway & Movers collected 32 Google reviews. The team was already asking for a review after each job.",
        paras: ["Happy customers often said they'd leave one. Then they got busy, and forgot."],
        miss: {
          items: [{ text: "The team asked after each job" }, { text: "Happy customers said they'd leave a review" }, { text: "Then they got busy, and forgot", miss: true }],
          big: "32", small: "Google reviews in two years"
        }
      },
      did: {
        label: "What Rempo did",
        h2: "Rempo took over the follow-up.",
        lead: "Customers got a review request, and anyone who hadn't left one got a reminder. Nobody on the team had to keep track.",
        paras: [],
        steps: [
          { h: "A review request", p: "After the job, customers got a request to share their experience on Google." },
          { h: "A reminder, if they hadn't", p: "Anyone who hadn't left a review yet got a reminder, and another chance to share their experience." },
          { h: "Nothing for the team to track", p: "Nobody had to keep track of who still needed a reminder. The team kept working." }
        ]
      },
      result: {
        label: "The result",
        h2: "70 new five-star reviews in six months.",
        lead: "In their first six months with Rempo, Junkaway & Movers received 70 new five-star Google reviews, taking their total from 32 to 102.",
        paras: ["That is more than twice as many reviews in six months as in the two years before."],
        proof: {
          tabs: ["Before Rempo", "After six months"],
          imgs: [
            { src: "/media/case-studies/junkaway-before.webp", w: 1200, h: 768, alt: "Junkaway & Movers LLC on Google before Rempo: rated 5.0, with 32 Google reviews." },
            { src: "/media/case-studies/junkaway-after.webp", w: 1200, h: 770, alt: "Junkaway & Movers LLC on Google after six months with Rempo: rated 5.0, with 102 Google reviews." }
          ],
          ring: { x: "24.6%", y: "82.6%", w: "33.6%", h: "10.4%" },
          ar: "1200 / 769",
          cap: { bold: "Their Google profile, as customers see it.", rest: "Screenshots from Google, before Rempo and after their first six months." }
        }
      }
    },
    payoff: { lead: "Customers meant to leave a review.", accent: "The reminder did the remembering." },
    note: "Review counts from Junkaway & Movers' Google Business Profile, before Rempo and after their first six months.",
    seo: {
      title: "Junkaway & Movers: 32 to 102 Google reviews in six months · Rempo case study",
      description: "Junkaway & Movers collected 32 Google reviews in two years. In their first six months with Rempo running the follow-up, they received 70 new five-star reviews.",
      ogTitle: "Junkaway & Movers: from 32 to 102 Google reviews in six months"
    },
    testimonialId: null
  },
  {
    slug: "ranchero-plumbing",
    business: {
      name: "Ranchero Plumbing", short: "Ranchero Plumbing", nick: "Ranchero",
      industry: "Plumbing", icon: "i-wrench", owner: "German Aquino",
      city: "Half Moon Bay", region: "California", regionCode: "CA", country: "US",
      area: "on the San Francisco Peninsula", areaServed: ["San Francisco Peninsula", "Silicon Valley"], schemaType: "Plumber"
    },
    card: {
      tag: "First week",
      title: "10 five-star reviews in the first week.",
      line: "Two months after opening, Rempo reached back out to the customers Ranchero had already served.",
      stats: [{ big: "+10", label: "five-star reviews in week one" }, { big: "32", label: "reviews, under nine months open" }]
    },
    hero: {
      h1: "10 five-star reviews in the first week.",
      lead: "Ranchero Plumbing had been open for two months. Rempo reached back out to the customers they had already served.",
      facts: [{ big: "+10", label: "five-star reviews in week one" }, { big: "32", label: "Google reviews, under nine months open" }, { big: "2", label: "months open when they started" }]
    },
    gbp: { rating: "5.0", count: "32", was: "5", kind: "", photo: "/media/case-studies/ranchero-van.webp" },
    numbers: { before: 5, after: 32, gained: 10, pill: "+10 in week one", beforeCaption: "Before Rempo", afterCaption: "Under nine months open" },
    scene: {
      unit: 6, cols: [
        { num: "5", cap: "Before Rempo", segs: [{ n: 5, k: "old" }] },
        { num: "32", cap: "Under nine months open", rq: true, segs: [{ n: 5, k: "old" }, { n: 10, k: "new", pill: "+10 in week one" }, { n: 17, k: "later" }] }
      ]
    },
    sceneLabel: "Ranchero Plumbing's Google reviews: 5 before Rempo; 32 at under nine months open, 10 of them from the first week with Rempo.",
    glance: [
      { dt: "The business", dd: "Ranchero Plumbing" },
      { dt: "Owner", dd: "German Aquino" },
      { dt: "Based in", dd: "Half Moon Bay, California" },
      { dt: "Serves", dd: "The San Francisco Peninsula and Silicon Valley" }
    ],
    chapters: {
      before: {
        label: "Before Rempo",
        h2: "The work was done. The reviews weren't there yet.",
        lead: "Ranchero Plumbing had only been open for two months when they started working with Rempo.",
        paras: ["They had a small list of past customers, and a chance to turn the work they had already done into reviews that future customers could see."],
        miss: {
          items: [{ text: "Open for two months" }, { text: "A small list of past customers" }, { text: "Little to show for it on Google", miss: true }],
          big: "5", small: "Google reviews before Rempo"
        }
      },
      did: {
        label: "What Rempo did",
        h2: "Rempo reached back out to the customers they had served.",
        lead: "A review reactivation campaign: the people Ranchero had already served got a direct link to share their experience on Google.",
        paras: [],
        steps: [
          { h: "The setup, done for them", p: "Rempo's team set up the review system. In German's words: “They handle our complete review system setup.”" },
          { h: "Back to past customers", p: "Rempo reached back out to people Ranchero had already served, on their customer list." },
          { h: "One direct link to Google", p: "Each customer got a direct link to share their experience on Google." }
        ]
      },
      result: {
        label: "The result",
        h2: "10 new five-star reviews in week one.",
        lead: "In the first week with Rempo, the campaign brought in 10 new five-star Google reviews.",
        paras: ["Less than nine months after opening, Ranchero Plumbing had 32 Google reviews."],
        proof: {
          tabs: ["Before Rempo", "Under nine months open"],
          imgs: [
            { src: "/media/case-studies/ranchero-before.webp", w: 1200, h: 702, alt: "Ranchero Plumbing on Google before Rempo: rated 5.0, with 5 Google reviews." },
            { src: "/media/case-studies/ranchero-after.webp", w: 1200, h: 702, alt: "Ranchero Plumbing on Google at under nine months open: rated 5.0, with 32 Google reviews." }
          ],
          ring: { x: "25%", y: "87.6%", w: "31%", h: "9.8%" },
          ar: "1200 / 702",
          cap: { bold: "Their Google profile, as customers see it.", rest: "Screenshots from Google, before Rempo and at under nine months open." }
        }
      }
    },
    payoff: { lead: "The work was already done.", accent: "Rempo asked the people it was done for." },
    note: "Review counts from Ranchero Plumbing's Google Business Profile. The captions follow German's own words.",
    seo: {
      title: "Ranchero Plumbing: 10 five-star reviews in the first week · Rempo case study",
      description: "Ranchero Plumbing had been open for two months. Rempo's review reactivation campaign brought in 10 new five-star Google reviews in the first week.",
      ogTitle: "Ranchero Plumbing: 10 five-star reviews in the first week"
    },
    testimonialId: "german-aquino"
  }
];

// The store's shape: every item with its status; the site shows the published ones, in this order
export function seedContent() {
  const now = "2026-11-07T00:00:00.000Z";
  return {
    v: 1,
    settings: { autoPublish: true },
    items: [
      ...SEED_CASES.map((data, i) => ({ id: `cs-${data.slug}`, kind: "case", status: "published", sort: (i + 1) * 10, data, checks: { ok: true, issues: [] }, source: { seed: true }, createdAt: now, updatedAt: now, publishedAt: now })),
      ...SEED_TESTIMONIALS.map((data, i) => ({ id: `vt-${data.id}`, kind: "video", status: "published", sort: (i + 1) * 10, data, checks: { ok: true, issues: [] }, source: { seed: true }, createdAt: now, updatedAt: now, publishedAt: now }))
    ]
  };
}
