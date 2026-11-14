/* Rempo proof: case studies and video testimonials. Shared by the landing page and the case study pages.
   - 3D stacks (.s3d[data-s3d]): CSS 3D only, no libraries. A plate tilted toward the camera with one column of
     reviews per moment. Measured at its end state and fitted to its box; it rises once in view, turns a little,
     and leans toward the pointer (up to 6 degrees, smoothed in one requestAnimationFrame loop).
   - Before and after ([data-pf]): the business's own Google profile, switched in place.
   - Video testimonials ([data-vt]): the card plays on hover, muted, with the words on screen. A click or a tap
     opens the film full screen with sound; the card grows into it.
   - Films ([data-vt="film"], the hero's story): no preview; a click on [data-vt-open] inside it, or on a
     [data-vt-for="<its id>"] button anywhere (the phone's link), opens it in the same dialog, 16:9 when
     data-shape="wide". The video loads only then.
   Tier C (reduced motion, Save-Data, ?tier=c): every scene at its end state, nothing plays by itself.
   The landing page's two sections are rendered again from the published set when it is newer than the page (what
   the admin at /admin publishes); init(root) wires whatever was put in. */
(() => {
  "use strict";
  const html = document.documentElement;
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
  const params = new URLSearchParams(location.search);
  const saveData = !!(navigator.connection && navigator.connection.saveData);
  if (matchMedia("(prefers-reduced-motion: reduce)").matches || saveData || params.get("tier") === "c") html.classList.add("tier-c");
  html.classList.replace("no-js", "js");
  const tierC = () => html.classList.contains("tier-c");
  const finePointer = matchMedia("(hover: hover) and (pointer: fine)");
  const el = (tag, cls, parent, css) => {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (css) e.style.cssText = css;
    if (parent) parent.appendChild(e);
    return e;
  };

  /* ---------- Case study pages: the theme switch and the header (the landing page runs its own) ---------- */
  if (document.body.classList.contains("cs-page")) {
    const themeMeta = $('meta[name="theme-color"]');
    const applyTheme = (t, persist) => {
      html.dataset.theme = t;
      $$(".theme-toggle").forEach((b) => b.setAttribute("aria-checked", String(t === "dark")));
      if (themeMeta) themeMeta.content = getComputedStyle(html).getPropertyValue("--c-bg").trim();
      if (persist) { try { localStorage.setItem("lp-theme", t); } catch (e) { /* storage blocked: this visit only */ } }
    };
    let picked = false;
    $$(".theme-toggle").forEach((b) => b.addEventListener("click", () => {
      picked = true;
      const next = html.dataset.theme === "dark" ? "light" : "dark";
      if (!document.startViewTransition || tierC()) return applyTheme(next, true);
      const r = b.getBoundingClientRect(), x = r.left + r.width / 2, y = r.top + r.height / 2;
      html.classList.add("vt-reveal");
      const vt = document.startViewTransition(() => applyTheme(next, true));
      vt.ready.then(() => {
        const end = Math.hypot(Math.max(x, innerWidth - x), Math.max(y, innerHeight - y));
        html.animate({ clipPath: [`circle(0px at ${x}px ${y}px)`, `circle(${end}px at ${x}px ${y}px)`] },
          { duration: 400, easing: "cubic-bezier(.22,1,.36,1)", pseudoElement: "::view-transition-new(root)" });
      }, () => {});
      vt.finished.finally(() => html.classList.remove("vt-reveal"));
    }));
    applyTheme(html.dataset.theme === "dark" ? "dark" : "light", false);
    matchMedia("(prefers-color-scheme: dark)").addEventListener("change", (e) => {
      let stored = false; try { stored = !!localStorage.getItem("lp-theme"); } catch (err) { /* blocked */ }
      if (!picked && !params.has("theme") && !stored) applyTheme(e.matches ? "dark" : "light", false);
    });
    const hdr = $(".hdr");
    if (hdr) {
      const solid = () => hdr.classList.toggle("solid", scrollY > 8);
      addEventListener("scroll", solid, { passive: true });
      solid();
    }
  }

  /* ---------- Reveal on scroll, once ---------- */
  const revealIO = new IntersectionObserver((es) => es.forEach((e) => {
    if (e.isIntersecting) { e.target.classList.add("is-in"); revealIO.unobserve(e.target); }
  }), { rootMargin: "0px 0px -10% 0px" });
  const initReveal = (root) => $$("[data-reveal]", root).forEach((n) => revealIO.observe(n));

  /* ============================================================
     The 3D stacks
     ============================================================ */
  const RX = 60, RZ = -32, PERSP = 1700, COL = 76, GAP = 76, PADX = 72, PADY = 60, FRONT = 124;
  const rad = (d) => (d * Math.PI) / 180;
  const cz = Math.cos(rad(RZ)), sz = Math.sin(rad(RZ)), cx = Math.cos(rad(RX)), sx = Math.sin(rad(RX));
  // a point on the plate (x right, y toward the viewer, z up; origin at the plate's centre) to the camera's frame
  const proj = (x, y, z) => {
    const x1 = x * cz - y * sz, y1 = x * sz + y * cz;
    return [x1, y1 * cx - z * sx, y1 * sx + z * cx];
  };
  const face = (bx, cls, w, h, tf) => el("i", "s3d-f " + cls, bx, `width:${w}px;height:${h}px;margin:${-h / 2}px 0 0 ${-w / 2}px;transform:${tf}`);

  function build3d(host) {
    let cfg;
    try { cfg = JSON.parse(host.dataset.s3d); } catch (e) { return; }
    host.textContent = "";
    const unit = cfg.unit || 2, cols = cfg.cols || [], n = cols.length;
    const W = n * COL + (n - 1) * GAP + 2 * PADX, D = PADY + COL + FRONT;
    const cam = el("div", "s3d-cam", host);
    const rig = el("div", "s3d-rig", cam);
    const world = el("div", "s3d-world", rig, `width:${W}px;height:${D}px;left:${-W / 2}px;top:${-D / 2}px;transform:rotateX(${RX}deg) rotateZ(${RZ}deg)`);
    const turn = el("div", "s3d-turn", world);
    const plate = el("div", "s3d-plate", turn);
    const pts = [[0, 0, 0], [W, 0, 0], [0, D, 0], [W, D, 0]];
    const labels = [];
    const lb = (x, y, z, cls, inner, delay) => {
      const a = el("div", "s3d-lb " + cls, turn, `left:${x}px;top:${y}px;transform:translateZ(${z}px) rotateZ(${-RZ}deg) rotateX(${-RX}deg)`);
      const s = el("span", "", a, `--d:${delay}ms`);
      s.innerHTML = inner;
      labels.push({ x, y, z, cls, s });
    };
    let tEnd = 0;
    cols.forEach((col, i) => {
      const x0 = PADX + i * (COL + GAP), y0 = PADY, mx = x0 + COL / 2, my = y0 + COL / 2;
      const total = col.segs.reduce((t, s) => t + s.n, 0) * unit;
      el("i", "s3d-shadow" + (col.rq ? " s3d-glow" : ""), plate, `left:${x0 - 22}px;top:${y0 - 6}px;width:${COL + 60}px;height:${COL + 54}px`);
      const c = el("div", "s3d-col", turn, `left:${x0}px;top:${y0}px;width:${COL}px;height:${COL}px`);
      let base = 0, d = 160 + i * 280;
      col.segs.forEach((sg) => {
        const h = Math.max(3, sg.n * unit);
        const seg = el("div", "s3d-seg", c, `transform:translateZ(${base.toFixed(2)}px)`);
        const bx = el("div", "s3d-bx k-" + (sg.k || "old"), seg, `--d:${d}ms;--ten:${(10 * unit).toFixed(2)}px`);
        face(bx, "s3d-top", COL, COL, `translateZ(${h}px)`);
        face(bx, "s3d-fr", COL, h, `translateZ(${h / 2}px) rotateX(-90deg) translateZ(${COL / 2}px)`);
        face(bx, "s3d-lf", h, COL, `translateZ(${h / 2}px) rotateY(-90deg) translateZ(${COL / 2}px)`);
        [[x0, y0], [x0 + COL, y0], [x0, y0 + COL], [x0 + COL, y0 + COL]].forEach(([px, py]) => pts.push([px, py, base], [px, py, base + h]));
        // the pill names what the segment is, beside the column's right edge
        if (sg.pill) lb(x0 + COL, y0 + COL, base + h / 2, "s3d-side", `<b class="s3d-pill${sg.soft ? " s3d-soft" : ""}">${sg.pill}</b>`, d + 640);
        base += h; d += 420; tEnd = Math.max(tEnd, d);
      });
      lb(mx, my, total + 16, "s3d-above", `<b class="s3d-num">${col.num}</b>`, d + 160);
      if (col.cap) lb(mx, y0 + COL + 86, 0, "s3d-base", `<span class="s3d-cap">${col.cap}</span>`, 160 + i * 280 + 260);
      if (col.rq) {
        // the requests: cards travel up the front of the newest column, one after another
        const [, ys] = proj(mx - W / 2, y0 + COL + 10 - D / 2, 0), [, yt] = proj(mx - W / 2, my - D / 2, total);
        [-27, -15, -3, 9].forEach((dx, k) => {   // left of the pill on the column's right edge
          const r = el("div", "s3d-rq", turn, `left:${mx + dx}px;top:${y0 + COL + 10}px;transform:rotateZ(${-RZ}deg) rotateX(${-RX}deg)`);
          el("i", "", r, `--d:${2300 + k * 1400}ms;--rise:${(yt - ys + 26).toFixed(1)}px`);
        });
      }
    });
    host._fit = () => {
      const hw = host.clientWidth, hh = host.clientHeight;
      if (!hw || !hh) return;
      const sizes = labels.map((L) => [L.s.offsetWidth, L.s.offsetHeight]);
      // labels keep a readable size when the scene is drawn small (--k scales them back up)
      const kOf = (s) => Math.min(2, Math.max(1, 0.92 / s));
      const box = (s) => {
        const kl = kOf(s);
        let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
        const add = (x, y) => { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; };
        const at = (x, y, z) => { const [X, Y, Z] = proj(x - W / 2, y - D / 2, z); const k = PERSP / (PERSP - Z * s); return [X * s * k, Y * s * k, s * k]; };
        pts.forEach(([x, y, z]) => { const [X, Y] = at(x, y, z); add(X, Y); });
        labels.forEach((L, i) => {
          const [X, Y, k] = at(L.x, L.y, L.z), w = sizes[i][0] * k * kl, h = sizes[i][1] * k * kl;
          if (L.cls === "s3d-side") { add(X + 16 * k, Y - h / 2); add(X + 16 * k + w, Y + h / 2); }
          else { add(X - w / 2, Y - h); add(X + w / 2, Y); }
        });
        return { x0, y0, x1, y1 };
      };
      let s = 1;
      for (let k = 0; k < 3; k++) {
        const b = box(s);
        s *= Math.min((hw * 0.94) / (b.x1 - b.x0), (hh * 0.92) / (b.y1 - b.y0));
      }
      s = Math.min(s, cfg.max || 1.7);
      const b = box(s);
      cam.style.left = (hw / 2 - (b.x0 + b.x1) / 2).toFixed(1) + "px";
      cam.style.top = (hh / 2 - (b.y0 + b.y1) / 2).toFixed(1) + "px";
      host._s = s;
      host.style.setProperty("--k", kOf(s).toFixed(3));
      host._paint();
    };
    // pointer tilt, smoothed in one frame loop
    let tx = 0, ty = 0, gx = 0, gy = 0, raf = 0;
    host._paint = () => { rig.style.transform = `scale(${(host._s || 1).toFixed(4)}) rotateX(${tx.toFixed(2)}deg) rotateY(${ty.toFixed(2)}deg)`; };
    const step = () => {
      raf = 0;
      tx += (gx - tx) * 0.09; ty += (gy - ty) * 0.09;
      host._paint();
      if (Math.abs(gx - tx) > 0.02 || Math.abs(gy - ty) > 0.02) raf = requestAnimationFrame(step);
    };
    const zone = host.closest("[data-tilt]") || host;
    zone.addEventListener("pointermove", (e) => {
      if (e.pointerType !== "mouse" || tierC()) return;
      const r = zone.getBoundingClientRect();
      gx = -((e.clientY - r.top) / r.height - 0.5) * 12;
      gy = ((e.clientX - r.left) / r.width - 0.5) * 12;
      if (!raf) raf = requestAnimationFrame(step);
    });
    zone.addEventListener("pointerleave", () => { gx = gy = 0; if (!raf) raf = requestAnimationFrame(step); });
    host._fit();
    new ResizeObserver(() => host._fit()).observe(host);
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(() => host._fit());
  }
  const sceneIO = new IntersectionObserver((es) => es.forEach((e) => {
    e.target.classList.toggle("s3d-vis", e.isIntersecting);
    if (e.isIntersecting && e.intersectionRatio >= 0.3) e.target.classList.add("s3d-in");
  }), { threshold: [0, 0.3] });
  const initScenes = (root) => $$(".s3d[data-s3d]", root).forEach((h) => { build3d(h); sceneIO.observe(h); });

  /* ============================================================
     Before and after: the same Google profile, switched in place. Once in view it turns to the after
     picture by itself, unless the visitor has already chosen
     ============================================================ */
  const pfIO = new IntersectionObserver((es) => es.forEach((e) => {
    if (!e.isIntersecting) return;
    pfIO.unobserve(e.target);
    setTimeout(() => { if (!e.target._user) e.target._show(1); }, 1100);
  }), { threshold: 0.6 });
  const initPf = (root) => $$("[data-pf]", root).forEach((pf) => {
    const frame = $(".pf-frame", pf), btns = $$(".pf-tabs button", pf);
    pf._show = (k, user) => {
      if (user) pf._user = true;
      frame.dataset.show = String(k);
      btns.forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.k === String(k))));
      frame.classList.remove("pf-ping"); void frame.offsetWidth; frame.classList.add("pf-ping");
    };
    btns.forEach((b) => b.addEventListener("click", () => pf._show(+b.dataset.k, true)));
    if (tierC()) pf._show(1); else { frame.dataset.show = "0"; btns.forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.k === "0"))); pfIO.observe(pf); }
  });

  /* ============================================================
     Video testimonials
     ============================================================ */
  const cuesFor = new Map();
  const toSec = (t) => t.split(":").reduce((a, v) => a * 60 + parseFloat(v), 0);
  function parseVtt(txt) {
    const out = [];
    txt.replace(/\r/g, "").split(/\n{2,}/).forEach((block) => {
      const lines = block.split("\n"), i = lines.findIndex((l) => l.includes("-->"));
      if (i < 0) return;
      const [a, b] = lines[i].split("-->").map((t) => toSec(t.trim().split(/\s+/)[0]));
      const text = lines.slice(i + 1).join(" ").replace(/<[^>]*>/g, "").trim();
      if (text) out.push({ a, b, text });
    });
    return out;
  }
  const loadCues = (url) => {
    if (!url) return Promise.resolve([]);
    if (!cuesFor.has(url)) cuesFor.set(url, fetch(url).then((r) => (r.ok ? r.text() : "")).then(parseVtt).catch(() => []));
    return cuesFor.get(url);
  };
  function drawCap(box, cues, t) {
    const c = cues.find((q) => t >= q.a && t < q.b), text = c ? c.text : "";
    if (box._t === text) return;
    box._t = text;
    if (text) box.firstElementChild.textContent = text;
    box.classList.toggle("vt-on", !!text);
  }
  const fmt = (t) => { t = Math.max(0, Math.floor(t || 0)); return Math.floor(t / 60) + ":" + String(t % 60).padStart(2, "0"); };

  let touchIO = null;
  const initFilm = (card) => {
    if (card._film) return;
    card._film = true;
    const v = $("video", card), track = v && $("track", v);
    card._vtt = track ? track.getAttribute("src") : card.dataset.vtt;   // fetched when the film opens, not before
    const open = (e) => openFilm(card, e.currentTarget);
    $$("[data-vt-open]", card).forEach((b) => b.addEventListener("click", open));
    if (card.id) $$(`[data-vt-for="${card.id}"]`).forEach((b) => b.addEventListener("click", open));
  };
  const initCards = (root) => {
  $$('[data-vt="film"]', root).forEach(initFilm);
  const vtCards = $$("[data-vt]:not([data-vt='film'])", root);
  vtCards.forEach((card) => {
    const btn = $(".vt-frame", card), v = $("video", card), cap = $(".vt-cap", card), bar = $(".vt-bar", card);
    const track = $("track", v);
    card._vtt = track ? track.getAttribute("src") : card.dataset.vtt;
    // the words are drawn by the page (the same look everywhere); the track stays for the browser's own player
    const hideNative = () => { for (const t of v.textTracks) t.mode = "hidden"; };
    hideNative(); v.textTracks.addEventListener && v.textTracks.addEventListener("addtrack", hideNative);
    let cues = [], raf = 0, live = false;
    loadCues(card._vtt).then((c) => { cues = c; });
    const tick = () => {
      raf = 0;
      drawCap(cap, cues, v.currentTime);
      if (bar) bar.style.setProperty("--p", (v.currentTime / (v.duration || 1)).toFixed(4));
      if (live) raf = requestAnimationFrame(tick);
    };
    card._start = () => {
      if (tierC() || live) return;
      live = true;
      card.classList.add("vt-live");
      v.muted = true;
      v.preload = "auto";
      const p = v.play();
      if (p) p.catch(() => {});
      if (!raf) raf = requestAnimationFrame(tick);
    };
    card._stop = () => {
      live = false;
      card.classList.remove("vt-live");
      v.pause();
      cap.classList.remove("vt-on"); cap._t = "";
    };
    const mouse = (e) => e.pointerType === "mouse" || e.pointerType === "pen";
    btn.addEventListener("pointerenter", (e) => { if (mouse(e)) card._start(); });
    btn.addEventListener("pointerleave", (e) => { if (mouse(e)) card._stop(); });
    btn.addEventListener("focus", () => { if (btn.matches(":focus-visible")) card._start(); });
    btn.addEventListener("blur", () => card._stop());
    btn.addEventListener("click", () => { card._stop(); openFilm(card); });
  });
  // Touch screens have no hover: a card plays (muted, with the words) while it is mostly on screen
  if (!finePointer.matches && vtCards.length) {
    if (!touchIO) touchIO = new IntersectionObserver((es) => es.forEach((e) => {
      const card = e.target;
      if (e.isIntersecting && e.intersectionRatio >= 0.6 && !html.classList.contains("vt-open")) card._start();
      else card._stop();
    }), { threshold: [0, 0.6] });
    vtCards.forEach((c) => touchIO.observe(c));
  }
  };

  /* ---------- The film: one dialog for every card ---------- */
  let dlg = null, stage, big, capBig, from = null, fromBtn = null, idleT = 0, raf2 = 0, bigCues = [];
  const icon = (id, cls) => `<svg class="ic${cls ? " " + cls : ""}" aria-hidden="true"><use href="#i-${id}"/></svg>`;
  function filmUI() {
    if (dlg) return;
    dlg = el("dialog", "vt-dlg", document.body);
    dlg.innerHTML =
      `<div class="vt-stage vt-paused">
        <video playsinline preload="auto"></video>
        <div class="vt-name"><img alt="" width="34" height="34"><span><b></b><small></small></span></div>
        <p class="vt-cap" aria-hidden="true"><span></span></p>
        <span class="vt-big-play" aria-hidden="true">${icon("play")}</span>
        <div class="vt-ctl">
          <button type="button" class="vt-pp" aria-label="Play">${icon("play", "vt-fill")}${icon("pause", "vt-fill vt-off")}</button>
          <div class="vt-seekwrap"><input class="vt-seek" type="range" min="0" max="1000" step="1" value="0" aria-label="Seek"><span class="vt-time">0:00 / 0:00</span></div>
          <button type="button" class="vt-snd" aria-label="Mute">${icon("volume")}${icon("volume-x", "vt-off")}</button>
          <button type="button" class="vt-cc" aria-pressed="true" aria-label="Captions">${icon("captions")}</button>
          <button type="button" class="vt-fs" aria-label="Full screen">${icon("maximize")}${icon("minimize", "vt-off")}</button>
        </div>
      </div>
      <button type="button" class="vt-x" aria-label="Close video">${icon("x")}</button>`;
    stage = $(".vt-stage", dlg); big = $("video", stage); capBig = $(".vt-cap", stage);
    const pp = $(".vt-pp", dlg), seek = $(".vt-seek", dlg), time = $(".vt-time", dlg), snd = $(".vt-snd", dlg), cc = $(".vt-cc", dlg), fsb = $(".vt-fs", dlg);
    const swap = (b, on) => { const [a, z] = $$("svg", b); a.classList.toggle("vt-off", on); z.classList.toggle("vt-off", !on); };
    // the controls step aside while the film plays and the pointer rests
    const wake = (hold) => {
      stage.classList.remove("vt-idle");
      clearTimeout(idleT);
      if (!hold && !big.paused) idleT = setTimeout(() => stage.classList.add("vt-idle"), 2600);
    };
    const paint = () => {
      const d = big.duration || 0, t = big.currentTime || 0;
      if (!seek._drag) { seek.value = d ? Math.round((t / d) * 1000) : 0; }
      seek.style.setProperty("--p", (d ? (t / d) * 100 : 0).toFixed(2) + "%");
      seek.setAttribute("aria-valuetext", `${fmt(t)} of ${fmt(d)}`);
      time.textContent = `${fmt(t)} / ${fmt(d)}`;
      if (cc.getAttribute("aria-pressed") === "true") drawCap(capBig, bigCues, t);
    };
    const loop = () => { raf2 = 0; paint(); if (!big.paused) raf2 = requestAnimationFrame(loop); };
    big.addEventListener("play", () => { stage.classList.remove("vt-paused"); swap(pp, true); pp.setAttribute("aria-label", "Pause"); if (!raf2) raf2 = requestAnimationFrame(loop); wake(); });
    big.addEventListener("pause", () => { stage.classList.add("vt-paused"); swap(pp, false); pp.setAttribute("aria-label", "Play"); paint(); wake(true); });
    big.addEventListener("ended", () => { stage.classList.add("vt-paused"); wake(true); });
    ["loadedmetadata", "seeked", "durationchange"].forEach((ev) => big.addEventListener(ev, paint));
    big.addEventListener("volumechange", () => { swap(snd, big.muted); snd.setAttribute("aria-label", big.muted ? "Unmute" : "Mute"); });
    const toggle = () => { if (big.paused || big.ended) { const p = big.play(); if (p) p.catch(() => {}); } else big.pause(); };
    pp.addEventListener("click", toggle);
    big.addEventListener("click", toggle);
    seek.addEventListener("input", () => { seek._drag = true; if (big.duration) big.currentTime = (seek.value / 1000) * big.duration; paint(); });
    seek.addEventListener("change", () => { seek._drag = false; });
    snd.addEventListener("click", () => { big.muted = !big.muted; });
    cc.addEventListener("click", () => {
      const on = cc.getAttribute("aria-pressed") !== "true";
      cc.setAttribute("aria-pressed", String(on));
      capBig.hidden = !on;
      if (on) { capBig._t = null; paint(); }
    });
    // Full screen: the stage itself, so the words and controls stay on. iPhone has only the video's own player
    const fsEl = () => document.fullscreenElement || document.webkitFullscreenElement;
    fsb.addEventListener("click", () => {
      if (fsEl()) return (document.exitFullscreen || document.webkitExitFullscreen).call(document);
      if (stage.requestFullscreen) stage.requestFullscreen().catch(() => {});
      else if (stage.webkitRequestFullscreen) stage.webkitRequestFullscreen();
      else if (big.webkitEnterFullscreen) {
        for (const t of big.textTracks) t.mode = cc.getAttribute("aria-pressed") === "true" ? "showing" : "hidden";
        big.webkitEnterFullscreen();
      }
    });
    ["fullscreenchange", "webkitfullscreenchange"].forEach((ev) => document.addEventListener(ev, () => {
      const on = fsEl() === stage;
      swap(fsb, on);
      fsb.setAttribute("aria-label", on ? "Exit full screen" : "Full screen");
    }));
    big.addEventListener("webkitendfullscreen", () => { for (const t of big.textTracks) t.mode = "hidden"; });
    stage.addEventListener("pointermove", () => wake());
    stage.addEventListener("pointerdown", () => wake());
    dlg.addEventListener("focusin", () => wake());
    dlg.addEventListener("keydown", (e) => {
      const tag = e.target.tagName, onRange = e.target === seek, onBtn = tag === "BUTTON";
      const k = e.key.toLowerCase();
      if ((k === " " && !onBtn && !onRange) || k === "k") { e.preventDefault(); toggle(); }
      else if (k === "m") snd.click();
      else if (k === "c") cc.click();
      else if (k === "f") fsb.click();
      else if (!onRange && (k === "arrowleft" || k === "arrowright")) { e.preventDefault(); big.currentTime = Math.max(0, Math.min(big.duration || 0, big.currentTime + (k === "arrowleft" ? -5 : 5))); }
      wake();
    });
    $(".vt-x", dlg).addEventListener("click", closeFilm);
    dlg.addEventListener("cancel", (e) => { e.preventDefault(); closeFilm(); });
    dlg.addEventListener("click", (e) => { if (e.target === dlg) closeFilm(); });
  }

  const rectFlip = (r0, r1) => `translate(${(r0.left - r1.left).toFixed(1)}px,${(r0.top - r1.top).toFixed(1)}px) scale(${(r0.width / r1.width).toFixed(4)},${(r0.height / r1.height).toFixed(4)})`;
  function openFilm(card, origin) {
    const v = $("video", card), frame = origin || $(".vt-frame", card);
    // no <dialog> (older iPhones): the browser's own full-screen player, with sound and the captions track
    if (typeof HTMLDialogElement !== "function" || !HTMLDialogElement.prototype.showModal) {
      v.muted = false;
      for (const t of v.textTracks) t.mode = "showing";
      const p = v.play(); if (p) p.catch(() => {});
      if (v.webkitEnterFullscreen) v.webkitEnterFullscreen(); else if (v.requestFullscreen) v.requestFullscreen().catch(() => {});
      return;
    }
    filmUI();
    if (from !== card) {
      big.innerHTML = "";
      $$("source", v).forEach((s) => big.append(s.cloneNode()));
      const tr = $("track", v);
      if (tr) { const t = tr.cloneNode(); t.removeAttribute("default"); big.append(t); }
      big.poster = v.getAttribute("poster") || v.dataset.poster || "";
      big.load();
      const img = $(".vt-name img", stage);
      img.src = card.dataset.avatar || ""; img.hidden = !card.dataset.avatar;
      $(".vt-name", stage).hidden = !card.dataset.name;
      $(".vt-name b", stage).textContent = card.dataset.name || "";
      $(".vt-name small", stage).textContent = card.dataset.role || "";
      stage.classList.toggle("vt-wide", card.dataset.shape === "wide");
      dlg.setAttribute("aria-label", card.dataset.label || (card.dataset.name ? card.dataset.name + ", " : "") + "video testimonial");
      bigCues = [];
      loadCues(card._vtt).then((c) => { bigCues = c; });
      from = card;
    }
    fromBtn = frame;
    capBig._t = null; capBig.classList.remove("vt-on");
    // the film carries on from where the preview was, with sound
    const t0 = v.currentTime > 0.5 && v.currentTime < (v.duration || 0) - 1.5 ? v.currentTime : 0;
    const seekTo = () => { try { big.currentTime = t0; } catch (e) { /* not seekable yet */ } };
    if (big.readyState >= 1) seekTo(); else big.addEventListener("loadedmetadata", seekTo, { once: true });
    big.muted = false;
    const r0 = frame.getBoundingClientRect();   // before the page's scrollbar goes
    dlg.showModal();
    html.classList.add("vt-open");
    const p = big.play();
    if (p) p.catch(() => { stage.classList.add("vt-paused"); });
    if (!tierC() && stage.animate) {
      const r1 = stage.getBoundingClientRect();
      stage.animate([{ transform: rectFlip(r0, r1) }, { transform: "none" }], { duration: 540, easing: "cubic-bezier(.22,1,.36,1)" });
      dlg.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 260, easing: "ease-out", pseudoElement: "::backdrop" });
    }
    $(".vt-pp", dlg).focus({ preventScroll: true });
  }
  function closeFilm() {
    if (!dlg || !dlg.open) return;
    const card = from, frame = card && (fromBtn || $(".vt-frame", card)), v = card && $("video", card);
    big.pause();
    if (v) { try { v.currentTime = big.ended ? 0 : big.currentTime; } catch (e) { /* ignore */ } }
    const done = () => {
      dlg.close();
      html.classList.remove("vt-open");
      if (frame) frame.focus({ preventScroll: true });
      // on a touch screen the card goes back to playing quietly while it is on screen
      if (card && card._start && !finePointer.matches) {
        const r = frame.getBoundingClientRect();
        if (r.top >= -r.height * 0.4 && r.bottom <= innerHeight + r.height * 0.4) card._start();
      }
    };
    const fs = document.fullscreenElement || document.webkitFullscreenElement;
    if (fs) { (document.exitFullscreen || document.webkitExitFullscreen).call(document); return done(); }
    const r0 = frame && frame.getBoundingClientRect();
    if (!tierC() && stage.animate && r0 && r0.bottom > 0 && r0.top < innerHeight) {
      const a = stage.animate([{ transform: "none" }, { transform: rectFlip(r0, stage.getBoundingClientRect()) }], { duration: 380, easing: "cubic-bezier(.22,1,.36,1)" });
      dlg.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 380, easing: "ease-out", pseudoElement: "::backdrop" });
      $(".vt-x", dlg).animate([{ opacity: 1 }, { opacity: 0 }], { duration: 200, fill: "forwards" });
      a.finished.then(() => { done(); $(".vt-x", dlg).getAnimations().forEach((x) => x.cancel()); }, done);
    } else done();
  }

  const init = (root) => { initReveal(root); initScenes(root); initPf(root); initCards(root); };
  init(document);

  /* ---------- The landing page: the case studies and videos as published now ----------
     The page is built with the set it was deployed with (data-proof-version). When the admin has published since,
     /api/proof is newer: the two sections are rendered again from it, with the renderer the case study pages use. */
  const results = $("#results[data-proof-version]"), voices = $("#testimonials[data-proof-version]");
  if ((results || voices) && window.fetch) {
    fetch("/api/proof", { credentials: "omit" }).then((r) => (r.ok ? r.json() : null)).then(async (pub) => {
      if (!pub || !Array.isArray(pub.cases) || pub.version === (results || voices).dataset.proofVersion) return;
      const R = await import("/assets/proof-render.mjs");
      if (results) {
        results.hidden = !pub.cases.length;
        if (pub.cases.length) {
          const grid = $(".cs-grid", results), lead = $(".sec-head .lead", results);
          if (lead) lead.textContent = R.resultsLead(pub.cases);
          grid.innerHTML = R.caseCardsHTML(pub.cases, pub.testimonials);
          init(grid);
        }
        results.dataset.proofVersion = pub.version;
      }
      if (voices) {
        voices.hidden = !pub.testimonials.length;
        if (pub.testimonials.length) {
          const inner = $(".vt-sec-grid", voices);
          $$("[data-vt]", inner).forEach((c) => { if (c._stop) c._stop(); });
          inner.innerHTML = R.testimonialsInnerHTML(pub.testimonials, pub.cases);
          voices.classList.toggle("vt-many", pub.testimonials.length > 1);
          init(inner);
        }
        voices.dataset.proofVersion = pub.version;
      }
      document.dispatchEvent(new CustomEvent("proof:updated", { detail: { version: pub.version } }));
    }).catch(() => { /* the page keeps what it was built with */ });
  }
})();
