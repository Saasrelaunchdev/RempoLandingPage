// Rempo proof renderer: the case study cards, the video testimonial cards and their landing page sections, and the
// full case study page. One module for the server (api/case-study.mjs renders the pages) and the browser (the landing
// page re-renders its two sections from /api/proof), so a case study made in the admin looks exactly like the first
// two. Pure functions over plain data; every text value is escaped. The one inline markup: text in curly quotes
// (“like this”) is set as a quotation.

// Text and double-quoted attributes need & < > " escaped; the one single-quoted attribute (data-s3d) needs & and '
const ESC = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" };
export const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ESC[c]);
// Text with “quotations”: escaped, then each curly-quoted run becomes <q> (the page's q style adds the marks back)
export const prose = (s) => esc(s).replace(/\u201C([^\u201C\u201D]+)\u201D/g, "<q>$1</q>");
const attrJson = (o) => JSON.stringify(o).replace(/&/g, "&amp;").replace(/'/g, "&#39;").replace(/</g, "&lt;");

export const ic = (name, extra) => `<svg class="ic${extra ? " " + extra : ""}" aria-hidden="true"><use href="#${esc(name)}"/></svg>`;
const STARS = '<span class="stars" aria-hidden="true">' + '<svg class="ic"><use href="#i-starf"/></svg>'.repeat(5) + "</span>";
export const NEVER_PROMISE = "Every business is different, and Rempo never promises a number of reviews.";

export const caseUrl = (cs) => `/case-studies/${encodeURIComponent(cs.slug)}/`;
const firstName = (name) => String(name || "").trim().split(/\s+/)[0] || "";
const vtn = (slug, part) => ` data-vtn="${part}" style="--vtn:cs-${esc(slug)}${part === "title" ? "-t" : ""}"`;

/* ---------- Pieces ---------- */
export function sceneHTML(scene) {
  return `<div class="s3d" aria-hidden="true" data-s3d='${attrJson(scene)}'></div>`;
}

export function gbpHTML(cs, { was = false } = {}) {
  const g = cs.gbp || {};
  const photo = g.photo
    ? `<img class="gbp-ph" src="${esc(g.photo)}" alt="" width="52" height="52" decoding="async">`
    : `<span class="gbp-ph gbp-ini" aria-hidden="true">${esc((cs.business.short || cs.business.name || "?").trim().charAt(0).toUpperCase())}</span>`;
  const kind = g.kind ? `<span class="gbp-t">${esc(g.kind)}</span>` : "";
  const before = was && g.was ? `<span class="gbp-was">${ic("i-arrow")}Up from <s>${esc(g.was)}</s></span>` : "";
  return `<div class="gbp" aria-hidden="true">${photo}<span class="gbp-b"><b class="gbp-n">${esc(cs.business.name)}</b><span class="gbp-r">${g.rating ? `<b>${esc(g.rating)}</b>` : ""}${STARS}<span class="gbp-c">${esc(g.count)} Google reviews</span></span>${kind}</span>${before}</div>`;
}

const cardMeta = (cs) => cs.card.meta || [cs.business.industry, [cs.business.city, cs.business.regionCode].filter(Boolean).join(", ")].filter(Boolean).join(" · ");

/* ---------- The case study card (landing page grid, and "next case study") ---------- */
export function caseCardHTML(cs, { named = false, testimonial = null } = {}) {
  const c = cs.card;
  const av = testimonial
    ? `<span class="cs-av"><img src="${esc(testimonial.avatar)}" alt="" width="28" height="28" decoding="async">${ic("i-play")}Owner's video</span>`
    : "";
  const stats = (c.stats || []).map((s) => `<li><b>${esc(s.big)}</b><span>${esc(s.label)}</span></li>`).join("");
  return `<a class="cs-card" href="${caseUrl(cs)}">
  <div class="cs-vis" data-tilt${named ? vtn(cs.slug, "vis") : ""}>
    <span class="cs-tag">${ic("i-clock")}${esc(c.tag)}</span>${av}
    ${sceneHTML(cs.scene)}
    ${gbpHTML(cs)}
  </div>
  <div class="cs-body">
    <p class="cs-meta">${esc(cardMeta(cs))}</p>
    <h3${named ? vtn(cs.slug, "title") : ""}>${esc(c.title || cs.hero.h1)}</h3>
    <p>${prose(c.line)}</p>
    <ul class="cs-stats">${stats}</ul>
    <span class="cs-more">Read the case study${ic("i-arrow")}</span>
  </div>
</a>`;
}

/* ---------- The video testimonial card: plays on hover, muted, with the words on screen; a click opens it full screen
   with sound (assets/proof.js) ---------- */
export const durationLabel = (sec) => { const s = Math.max(0, Math.round(Number(sec) || 0)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`; };

export function videoCardHTML(t) {
  const sources = [
    t.src ? `<source src="${esc(t.src)}" type='video/mp4; codecs="avc1.640028, mp4a.40.2"'>` : "",
    t.srcWebm ? `<source src="${esc(t.srcWebm)}" type='video/webm; codecs="vp9, opus"'>` : ""
  ].filter(Boolean).join("\n      ");
  const track = t.vtt ? `\n      <track kind="captions" srclang="${esc(t.lang || "en")}" label="English" src="${esc(t.vtt)}" default>` : "";
  const where = [t.role, t.location, durationLabel(t.duration)].filter(Boolean).join(" · ");
  return `<figure class="vt-card" data-vt data-name="${esc(t.name)}" data-role="${esc(t.role)}" data-avatar="${esc(t.avatar)}">
  <button class="vt-frame" type="button" aria-label="Play ${esc(t.name)}'s video testimonial, full screen with sound" style="background-image:url(${esc(t.poster)})">
    <video muted playsinline loop preload="none" poster="${esc(t.poster)}" disablepictureinpicture>
      ${sources}${track}
    </video>
    <span class="vt-ui" aria-hidden="true">
      <span class="vt-name"><img src="${esc(t.avatar)}" alt="" width="34" height="34" decoding="async"><span><b>${esc(t.name)}</b><small>${esc(t.role)}</small></span></span>
      <span class="vt-grow">${ic("i-expand")}</span>
      <span class="vt-cap"><span></span></span>
      <span class="vt-hint"><i>${ic("i-play")}</i><span class="t-hover">Hover to play · click for sound</span><span class="t-touch">Tap to play with sound</span></span>
      <span class="vt-mute">${ic("i-volume-x")}Muted preview</span>
      <span class="vt-bar"><i></i></span>
    </span>
  </button>
  <figcaption class="vt-who"><b>${esc(t.name)}</b><span>${esc(where)}</span></figcaption>
</figure>`;
}

/* ---------- The landing page's two sections ---------- */
const NUMBER_WORDS = ["No", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine", "Ten", "Eleven", "Twelve"];
// "Two home-service businesses on the San Francisco Peninsula. ..." follows the published set
export function resultsLead(cases) {
  const n = cases.length;
  const count = n < NUMBER_WORDS.length ? NUMBER_WORDS[n] : String(n);
  const areas = [...new Set(cases.map((c) => c.business.area).filter(Boolean))];
  // business.area carries its own preposition ("on the San Francisco Peninsula", "in Austin")
  const area = areas.length === 1 && cases.every((c) => c.business.area) ? ` ${areas[0]}` : "";
  const what = n === 1 ? "home-service business" : "home-service businesses";
  return `${count} ${what}${area}. Their own Google reviews, before and after Rempo.`;
}

export function caseCardsHTML(cases, testimonials = []) {
  const byId = new Map(testimonials.map((t) => [t.id, t]));
  return cases.map((cs) => caseCardHTML(cs, { named: true, testimonial: cs.testimonialId ? byId.get(cs.testimonialId) || null : null })).join("\n");
}

export function testimonialsInnerHTML(testimonials, cases = []) {
  if (!testimonials.length) return "";
  const featured = testimonials[0];
  const cs = featured.caseStudy ? cases.find((c) => c.slug === featured.caseStudy) : null;
  const many = testimonials.length > 1;
  const link = cs ? `\n      <p class="vt-links"><a href="${caseUrl(cs)}">Read ${esc(cs.business.nick || cs.business.short)}'s case study${ic("i-arrow")}</a></p>` : "";
  return `<div class="vt-sec-copy">
      <header class="sec-head">
        <p class="label eyebrow">Video testimonials</p>
        <h2 id="vt-h" class="h2">${many ? "Hear it from the owners." : "Hear it from the owner."}</h2>
        <p class="lead">${prose(featured.intro)}</p>
      </header>
      <blockquote class="vt-section-quote">
        <q>${esc(featured.quote)}</q>
        <cite><img src="${esc(featured.avatar)}" alt="" width="44" height="44" loading="lazy" decoding="async"><span><b>${esc(featured.name)}</b>${esc(featured.role)}</span></cite>
      </blockquote>${link}
    </div>
    <div class="vt-list">
${testimonials.map((t) => videoCardHTML(t).replace(/^/gm, "      ")).join("\n")}
    </div>`;
}

/* ---------- The full case study page ---------- */
function missHTML(m) {
  const li = m.items.map((it) => `<li${it.miss ? ' class="no"' : ""}><i>${ic(it.miss ? "i-clock" : "i-check")}</i><span>${prose(it.text)}</span></li>`).join("");
  return `<figure class="miss" data-reveal><ol>${li}</ol><figcaption><b>${esc(m.big)}</b><span>${esc(m.small)}</span></figcaption></figure>`;
}
function stepsHTML(steps) {
  const li = steps.map((s, i) => `<li${i === steps.length - 1 ? ' class="hot"' : ""}><b>${i + 1}</b><div><h3>${esc(s.h)}</h3><p>${prose(s.p)}</p></div></li>`).join("");
  return `<ol class="steps" data-reveal>${li}</ol>`;
}
function proofHTML(p) {
  const btns = p.tabs.map((t, i) => `<button type="button" data-k="${i}" aria-pressed="${i === 1}">${esc(t)}</button>`).join("");
  const pics = p.imgs.map((im, i) => `<img data-k="${i}" src="${esc(im.src)}" width="${Number(im.w) || 1200}" height="${Number(im.h) || 750}" alt="${esc(im.alt)}" loading="lazy" decoding="async">`).join("");
  const r = p.ring;
  const ring = r ? `<span class="pf-ring" style="--x:${esc(r.x)};--y:${esc(r.y)};--w:${esc(r.w)};--h:${esc(r.h)}" aria-hidden="true"></span>` : "";
  return `<figure class="pf" data-pf data-reveal>
        <div class="pf-tabs" role="group" aria-label="Their Google profile">${btns}</div>
        <div class="pf-frame" data-show="1" style="--ar:${esc(p.ar)}">${pics}${ring}</div>
        <figcaption class="pf-cap"><b>${esc(p.cap.bold)}</b> ${esc(p.cap.rest)}</figcaption>
      </figure>`;
}
function statHTML(s) {
  return `<figure class="miss csx-stat" data-reveal><figcaption><b>${esc(s.big)}</b><span>${esc(s.label)}</span></figcaption></figure>`;
}
function chapterHTML(n, ch, visual, flip, hid) {
  const paras = (ch.paras || []).map((p) => `<p>${prose(p)}</p>`).join("");
  return `
<section class="proof chap-sec" aria-labelledby="${hid}">
  <div class="wrap chap${flip ? " flip" : ""}">
    <div class="chap-copy" data-reveal>
      <p class="label eyebrow chap-n"><i>${String(n).padStart(2, "0")}</i>${esc(ch.label)}</p>
      <h2 id="${hid}" class="h2">${prose(ch.h2)}</h2>
      <p class="lead">${prose(ch.lead)}</p>
      ${paras}
    </div>
    ${visual}
  </div>
</section>`;
}
function videoSectionHTML(t) {
  const first = firstName(t.name);
  return `
<section class="proof sec" id="video" aria-labelledby="v-h">
  <div class="wrap csx-video">
    <div class="chap-copy" data-reveal>
      <p class="label eyebrow chap-n"><i>04</i>In ${esc(first)}'s words</p>
      <h2 id="v-h" class="h2">Hear it from ${esc(first)}.</h2>
      <blockquote class="vt-section-quote">
        <q>${esc(t.quoteLong || t.quote)}</q>
        <cite><img src="${esc(t.avatar)}" alt="" width="44" height="44" loading="lazy" decoding="async"><span><b>${esc(t.name)}</b>${esc(t.role)}</span></cite>
      </blockquote>
      <details class="transcript"><summary>Read the transcript${ic("i-down")}</summary><p>${esc(t.transcript)}</p></details>
    </div>
    ${videoCardHTML(t)}
  </div>
</section>`;
}

function ldFor(cs, t, origin) {
  const abs = (u) => (u && origin && u.startsWith("/") ? origin + u : u);
  const b = cs.business;
  const article = {
    "@type": "Article", headline: String(cs.hero.h1).replace(/\.$/, ""), description: cs.seo.description,
    about: {
      "@type": b.schemaType || "LocalBusiness", name: b.name,
      address: { "@type": "PostalAddress", addressLocality: b.city, addressRegion: b.regionCode, addressCountry: b.country || "US" },
      ...(b.areaServed && b.areaServed.length ? { areaServed: b.areaServed } : {})
    },
    publisher: { "@type": "Organization", name: "Rempo", url: "https://rempo.io" }
  };
  if (!t) return { "@context": "https://schema.org", ...article };
  const video = {
    "@type": "VideoObject", name: t.title || `${t.name}, ${t.role}, on Rempo`, description: t.summary || t.quote,
    thumbnailUrl: abs(t.poster), contentUrl: abs(t.src), ...(t.uploadDate ? { uploadDate: t.uploadDate } : {}),
    duration: `PT${Math.round(Number(t.duration) || 0)}S`, inLanguage: t.lang || "en", transcript: t.transcript
  };
  return { "@context": "https://schema.org", "@graph": [article, video] };
}
// JSON inside <script>: never let the data close the element
const ldScript = (o) => JSON.stringify(o).replace(/</g, "\\u003c").replace(/>/g, "\\u003e").replace(/&/g, "\\u0026");

export function caseStudyPageHTML(cs, { next = null, nextTestimonial = null, testimonial = null, origin = "", shell, preview = false } = {}) {
  const h = cs.hero, b = cs.business, ch = cs.chapters;
  const location = [b.city, b.region].filter(Boolean).join(", ");
  const facts = h.facts.map((f, i) => `<li class="csx-fact${i === 0 ? " hot" : ""}"><b>${esc(f.big)}</b><span>${esc(f.label)}</span></li>`).join("");
  const chips = `<li class="chip">${ic(b.icon || "i-building")}${esc(b.industry)}</li><li class="chip">${ic("i-pin")}${esc(location)}</li>`;
  const visExtra = testimonial
    ? `\n      <a class="cs-av" href="#video"><img src="${esc(testimonial.avatar)}" alt="" width="28" height="28" decoding="async">${ic("i-play")}Watch ${esc(firstName(testimonial.name))}'s video</a>`
    : "";
  const glance = `
<section class="proof glance-sec" aria-label="At a glance">
  <div class="wrap"><dl class="glance">${cs.glance.map((g) => `<div><dt>${esc(g.dt)}</dt><dd>${esc(g.dd)}</dd></div>`).join("")}</dl></div>
</section>`;
  const result = ch.result.proof ? proofHTML(ch.result.proof) : statHTML(ch.result.stat || { big: h.facts[0].big, label: h.facts[0].label });
  const body = glance
    + chapterHTML(1, ch.before, missHTML(ch.before.miss), false, "c1-h")
    + chapterHTML(2, ch.did, stepsHTML(ch.did.steps), true, "c2-h")
    + chapterHTML(3, ch.result, result, false, "c3-h")
    + (testimonial ? videoSectionHTML(testimonial) : "")
    + `\n<section class="proof" aria-label="In short"><div class="wrap" style="padding-bottom:96px"><p class="csx-payoff" data-reveal>${prose(cs.payoff.lead)} <span>${prose(cs.payoff.accent)}</span></p></div></section>\n`;
  const nextHTML = next ? `
    <div class="csx-next" data-reveal>
      <p class="label eyebrow">Next case study</p>
      ${caseCardHTML(next, { testimonial: nextTestimonial })}
    </div>` : "";
  const note = [cs.note, NEVER_PROMISE].filter(Boolean).join(" ");
  const s = shell || { FAVICON: "", SPRITE: "" };
  return `<!doctype html>
<html lang="en" class="no-js">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>${esc(cs.seo.title)}</title>
<meta name="description" content="${esc(cs.seo.description)}">
<meta name="robots" content="noindex, nofollow">
<meta property="og:type" content="article">
<meta property="og:site_name" content="Rempo">
<meta property="og:title" content="${esc(cs.seo.ogTitle || cs.hero.h1)}">
<meta property="og:description" content="${esc(cs.seo.description)}">
<meta property="og:image" content="/og.png">
<meta name="twitter:card" content="summary_large_image">
<meta name="theme-color" content="#FFFFFF">
<link rel="icon" href="${s.FAVICON}" type="image/svg+xml">
<!-- Theme and motion tier before first paint, the same rules as the landing page: the visitor's choice, else ?theme=,
     else the device's setting. Reduced motion, Save-Data or ?tier=c: every scene at its end state -->
<script>(function(){var d=document.documentElement,t=null;d.classList.replace("no-js","js");try{t=new URLSearchParams(location.search).get("theme")||localStorage.getItem("lp-theme")}catch(e){}if(t!=="dark"&&t!=="light")t=matchMedia("(prefers-color-scheme: dark)").matches?"dark":"light";d.dataset.theme=t;if(matchMedia("(prefers-reduced-motion: reduce)").matches||(navigator.connection&&navigator.connection.saveData)||/[?&]tier=c\\b/.test(location.search))d.classList.add("tier-c")})();</script>
<link rel="preload" href="/assets/fonts/outfit.woff2" as="font" type="font/woff2" crossorigin>
<link rel="preload" href="/assets/fonts/geist.woff2" as="font" type="font/woff2" crossorigin>
<link rel="stylesheet" href="/assets/site.css">
<link rel="stylesheet" href="/assets/proof.css">
<script type="application/ld+json">${ldScript(ldFor(cs, testimonial, origin))}</script>
</head>
<body class="cs-page">
${s.SPRITE}
${preview ? '<p class="cs-preview-bar" role="note">Preview · not published</p>\n' : ""}
<a class="skip-link" href="#main">Skip to content</a>

<!-- ============ Header: the same as the landing page, the links go back to it ============ -->
<header class="hdr" id="top">
  <div class="wrap hdr-in">
    <a class="brand-logo" href="/" aria-label="Rempo, home"><svg class="logo-full" viewBox="0 0 211.2 64" aria-hidden="true"><use href="#logo-h"/></svg><svg class="logo-mark" viewBox="0 0 64 64" aria-hidden="true"><use href="#logo-mark"/></svg></a>
    <nav class="hdr-nav" aria-label="Main"><a href="/#why">Why reviews</a><a href="/#journey">How it works</a><a href="/#results" aria-current="true">Results</a><a href="/#compare">Compare</a><a href="/#questions">Questions</a></nav>
    <button class="theme-toggle" type="button" role="switch" aria-checked="false" aria-label="Dark mode">${ic("i-sun")}${ic("i-moon")}<span class="knob"></span></button>
    <a class="btn btn-primary btn-sm hdr-cta" href="/#final">Get started</a>
  </div>
</header>

<main id="main">

<!-- ============ Hero: the result in one line, the numbers, and the stack in 3D with their Google profile in front ============ -->
<section class="story csx-hero" aria-labelledby="cs-h">
  <div class="wrap csx-grid">
    <div class="csx-copy">
      <nav class="crumbs" aria-label="Breadcrumb"><a href="/#results">${ic("i-back")}Case studies</a><span aria-hidden="true">/</span><span aria-current="page">${esc(b.short)}</span></nav>
      <ul class="chips csx-chips" aria-label="About the business">${chips}</ul>
      <h1 id="cs-h" class="csx-h1"${vtn(cs.slug, "title")}>${prose(h.h1)}</h1>
      <p class="lead">${prose(h.lead)}</p>
      <ul class="csx-facts" aria-label="The numbers">${facts}</ul>
    </div>
    <figure class="csx-vis" data-tilt${vtn(cs.slug, "vis")}>
      ${sceneHTML(cs.scene)}
      ${gbpHTML(cs, { was: true })}${visExtra}
      <figcaption class="sr-only">${esc(cs.sceneLabel)}</figcaption>
    </figure>
  </div>
</section>
${body}
<!-- ============ The close: the next step, the note on the numbers, and the next case study ============ -->
<section class="story sec" aria-labelledby="cta-h">
  <div class="wrap csx-close">
    <div class="csx-cta-in" data-reveal>
      <h2 id="cta-h" class="h2">Want your <span class="nowrap">follow-up</span> run for you?</h2>
      <p class="lead">Our team sets it up and runs it, from the job software you already use. You approve your messages, then we run it.</p>
      <div class="cta-btns"><a class="btn btn-primary" href="/#final">Get started</a><a class="btn btn-line" href="/#try">Book a 15-minute call</a></div>
      <p class="csx-note">${ic("i-info")}<span>${esc(note)}</span></p>
    </div>${nextHTML}
  </div>
</section>

</main>

<!-- ============ Footer ============ -->
<footer class="foot logo-rev">
  <div class="wrap">
    <div class="foot-grid">
      <div style="display:grid;gap:18px;align-content:start">
        <p class="foot-logo"><svg viewBox="0 0 211.2 64" role="img" aria-label="Rempo" style="height:40px;width:auto"><use href="#logo-h"/></svg></p>
        <div class="foot-cta"><a class="btn btn-primary btn-sm" href="/#final">Get started</a><a href="/#results">All case studies</a></div>
      </div>
      <dl>
        <div class="foot-co"><dt>Company</dt><dd>Rempo · rempo.io</dd></div>
      </dl>
    </div>
  </div>
</footer>

<script src="/assets/proof.js" defer></script>
</body>
</html>
`;
}

/* ---------- The whole published set, in one call: what /api/proof serves and what the page renders from ---------- */
export function pageContext(published, slug) {
  const cases = published.cases || [], tests = published.testimonials || [];
  const i = cases.findIndex((c) => c.slug === slug);
  if (i < 0) return null;
  const cs = cases[i];
  const byId = new Map(tests.map((t) => [t.id, t]));
  const next = cases.length > 1 ? cases[(i + 1) % cases.length] : null;
  return {
    cs,
    testimonial: cs.testimonialId ? byId.get(cs.testimonialId) || null : null,
    next,
    nextTestimonial: next && next.testimonialId ? byId.get(next.testimonialId) || null : null
  };
}
