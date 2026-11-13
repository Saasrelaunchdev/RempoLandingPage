// The story, shot by shot. update(t) sets the whole frame (camera, people, vans, light, every card) from the time
// alone, keyed to when each line and word of the narration is spoken (../audio/timings.json).
//
// The claims follow the GTM brain's rules: no promised reviews, rankings, calls or jobs; every statistic with its
// source on screen; the same honest ask to every customer; nothing blames staff. Names are the landing page's own
// sample (Maple Street Plumbing, Dana); the shop down the road is "Down the Road Plumbing & Air".
import * as THREE from 'three';
import { W, H } from './stage.js';
import { LANE_NEAR, LANE_FAR } from './town.js';
import { pose } from './kit.js';
import { clamp, lerp, prog, ease, tween, keys, inOut } from './anim.js';

const ICON = (id, cls = '') => `<svg class="ic ${cls}" aria-hidden="true"><use href="#i-${id}"/></svg>`;
const PATHS = {
  pot: '<path d="M2 12h20M20 12v8a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2v-8M4 8l16-4M8.86 6.78l-.45-1.81a2 2 0 0 1 1.45-2.43l1.94-.48a2 2 0 0 1 2.43 1.46l.45 1.8"/>',
  kids: '<circle cx="12" cy="12" r="9"/><path d="M9 11h.01M15 11h.01M9.5 15a3.5 3.5 0 0 0 5 0M12 3c1.5 0 2.5 1 2.5 2.2S13.6 7.5 12.5 7.5"/>',
  cal: '<rect x="3" y="4" width="18" height="18" rx="2"/><path d="M8 2v4M16 2v4M3 10h18M8 14h.01M12 14h.01M16 14h.01M8 18h.01M12 18h.01"/>',
};
const SVG = (k) => `<svg class="ic" viewBox="0 0 24 24" aria-hidden="true">${PATHS[k]}</svg>`;
const stars = (n, full = 5) => `<span class="stars">${Array.from({ length: full }, (_, i) => ICON('starf', 'f' + (i < n ? '' : ' e'))).join('')}</span>`;

export function createStory({ S, T, B, crewPhoto, timings }) {
  const cam = S.camera;
  const ov = document.getElementById('ov');
  const veil = document.getElementById('veil');
  const bgn = document.getElementById('bgn');
  const canvas = document.getElementById('gl');
  const beamsSvg = document.getElementById('beams');

  // ------------------------------------------------------------------ narration timing
  const L = Object.fromEntries(timings.lines.map((l) => [l.id, l]));
  const s = (id) => L[id].start, e = (id) => L[id].end;
  const norm = (x) => x.toLowerCase().replace(/[^a-z0-9']/g, '');
  // when a word starts (the nth time it is said in that line); estimated from its place in the line if no timing
  function w(id, word, n = 0) {
    const l = L[id];
    if (l.words) { let c = 0; for (const x of l.words) if (norm(x.w) === norm(word) && c++ === n) return x.t; }
    const i = l.text.toLowerCase().indexOf(word.toLowerCase());
    return l.start + (l.end - l.start) * (i < 0 ? 0 : i / l.text.length);
  }

  // ------------------------------------------------------------------ the 2D layer
  const all = [];
  let frame = 0;
  function mk(html, cls = '') {
    const d = document.createElement('div');
    d.className = 'o ' + cls;
    d.innerHTML = html;
    ov.appendChild(d);
    all.push(d);
    return d;
  }
  function size(el) {
    if (el._w == null) { el._w = el.offsetWidth; el._h = el.offsetHeight; }
    return [el._w, el._h];
  }
  // show el this frame with its anchor point (ax, ay as fractions of its box) at (x, y)
  function show(el, { o = 1, x = W / 2, y = H / 2, s = 1, r = 0, ax = 0.5, ay = 0.5, z } = {}) {
    if (o <= 0.002) return;
    const [w0, h0] = size(el);
    el._f = frame;
    el.style.opacity = clamp(o).toFixed(3);
    el.style.transformOrigin = `${ax * 100}% ${ay * 100}%`;
    el.style.transform = `translate(${(x - ax * w0).toFixed(1)}px,${(y - ay * h0).toFixed(1)}px) scale(${s.toFixed(4)}) rotate(${r.toFixed(2)}deg)`;
    if (z != null) el.style.zIndex = z;
  }
  const pop = (t, a, d = 0.42) => ease.outBack(prog(t, a, a + d));      // a springy entrance, 0..1+
  const fade = (t, a, d = 0.35) => ease.out(prog(t, a, a + d));
  const gone = (t, a, d = 0.3) => 1 - ease.in(prog(t, a, a + d));

  // 3D to screen
  const v3 = new THREE.Vector3();
  function proj(x, y, z) {
    v3.set(x, y, z).project(cam);
    return [((v3.x + 1) / 2) * W, ((1 - v3.y) / 2) * H];
  }
  function projOf(obj, dy = 0, dx = 0, dz = 0) {
    obj.getWorldPosition(v3);
    return proj(v3.x + dx, v3.y + dy, v3.z + dz);
  }

  // beams: arcs between two screen points, drawn from a to b as k goes 0..1
  const beamPool = [];
  let beamN = 0;
  function beam(a, b, k, { o = 1, lift = 0.32, cls = '' } = {}) {
    if (k <= 0 || o <= 0) return;
    let p = beamPool[beamN];
    if (!p) {
      p = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      p.setAttribute('pathLength', '1');
      p.setAttribute('stroke-dasharray', '1');
      beamsSvg.appendChild(p);
      beamPool.push(p);
    }
    beamN++;
    const mx = (a[0] + b[0]) / 2, my = (a[1] + b[1]) / 2 - Math.hypot(b[0] - a[0], b[1] - a[1]) * lift;
    p.setAttribute('d', `M${a[0].toFixed(1)} ${a[1].toFixed(1)} Q${mx.toFixed(1)} ${my.toFixed(1)} ${b[0].toFixed(1)} ${b[1].toFixed(1)}`);
    p.setAttribute('stroke-dashoffset', (1 - clamp(k)).toFixed(4));
    p.setAttribute('class', cls);
    p.style.opacity = o;
    p.style.display = '';
  }
  const glowPool = [], ringPool = [];
  let glowN = 0, ringN = 0;
  function glow(x, y, k) {
    if (k <= 0) return;
    const g = glowPool[glowN] || (glowPool[glowN] = mk('', 'glow'));
    glowN++;
    show(g, { x: x + 46, y: y + 46, o: clamp(k), s: 0.4 + 0.6 * ease.outBack(clamp(k)) });
  }
  // rings spreading from a point: a phone ringing, a request landing
  function rings(x, y, t, a, b, color = '#1f86ff', every = 0.55) {
    if (t < a || t > b) return;
    for (let i = 0; i < 3; i++) {
      const ph = ((t - a) / every - i / 3);
      if (ph < 0) continue;
      const k = ph % 1;
      const r = ringPool[ringN] || (ringPool[ringN] = mk('', 'ring'));
      ringN++;
      r.style.color = color;
      show(r, { x: x + 120, y: y + 120, s: 0.2 + k * 0.85, o: (1 - k) * 0.9 * fade(t, a, 0.2) * gone(t, b - 0.25, 0.25) });
    }
  }

  // ------------------------------------------------------------------ the cards
  const pill = (icon, text, cls = 'dark') => mk(`<span class="pill ${cls}">${icon ? ICON(icon) : ''}${text}</span>`);
  const P = {
    furnace: pill('check', 'Furnace fixed, same day'),
    leak: pill('check', 'Leak found, first visit'),
    call: pill('phone', 'Next call', 'dark'),
    tonight: pill('moon', '9:12 pm', 'dark'),
    ringRival: pill('phone', 'Ringing', 'rival'),
    yoursOld: mk(`<span class="pill light big">${ICON('starf', 'f')}<b>4.9</b><span class="sub">Maple Street Plumbing</span></span>`),
    yoursOldNote: pill('clock', 'Newest review: 5 months ago', 'amber'),
    rivalNew: mk(`<span class="pill rival big">${ICON('starf', 'f')}<b>4.6</b><span class="sub">Down the Road Plumbing</span></span>`),
    rivalNewNote: pill('clock', 'Newest review: 2 days ago', 'green'),
    mark: mk(`<span class="pill light big"><b>Rempo</b><span class="sub">runs your Google reviews for you</span></span>`),
    connected: pill('plug', 'Connected', 'light'),
    sent: pill('send', 'Thank-you sent to Dana', 'dark'),
    nothing: pill('check', 'Nothing for you to run', 'light'),
    reach: pill('search', 'Read by the next homeowner', 'light'),
    ringYours: pill('phone', 'Ringing', 'light'),
  };
  P.asked = [0, 1, 2, 3, 4].map(() => pill('check', 'Asked', 'light'));
  P.done = [0, 1, 2, 3, 4].map(() => pill('check', 'Job done', 'dark'));

  const say = mk(`<div class="say">We'd recommend you to anyone!</div>`);
  const ghostCard = (mini = '') => `<div class="rv ghost ${mini}"><span class="av"></span><span class="head">${stars(0)}</span><span class="bar"></span><span class="bar s"></span></div>`;
  const think = mk(`<div class="think"><span class="t">Leave them a review...</span>${ghostCard('mini')}<i></i><i></i></div>`);
  const life = [mk(`<div class="life">${SVG('pot')}</div>`), mk(`<div class="life">${SVG('kids')}</div>`), mk(`<div class="life">${SVG('cal')}</div>`)];
  const ghosts = [0, 1, 2, 3, 4].map(() => mk(ghostCard('mini')));
  const ghostsB = [0, 1].map(() => mk(ghostCard('mini')));

  const review = (name, av, text, cls = '', avc = '') => `<div class="rv ${cls}"><span class="av ${avc}">${av}</span><span class="head"><b>${name}</b>${stars(5)}</span><p>${text}</p></div>`;
  const rivalCards = [
    mk(review('Chris P.', 'C', 'Showed up fast.', 'mini notail', 'g')),
    mk(review('Ana M.', 'A', 'Fair price, good work.', 'mini notail', 'b')),
    mk(review('Joe T.', 'J', 'Would call again.', 'mini notail')),
  ];
  const danaCard = mk(`<div class="rv"><span class="av">D</span><span class="head"><b>Dana R.</b>${stars(5)}</span><p>Fixed our heat the same day. We'd recommend them to anyone.</p></div>`);
  const replyCard = mk(`<div class="rv notail" style="width:560px;background:#f5f9ff"><span class="av b">M</span><span class="head"><b>Maple Street Plumbing</b><small>Owner's reply</small></span><p>Thanks, Dana! Glad we got your heat back on the same day. We're here whenever you need us.</p><span class="chip">${ICON('reply')}Reply written for this review</span></div>`);
  const heroCard = mk(`<div class="rv"><span class="av">D</span><span class="head"><b>Dana R.</b>${stars(5)}</span><p>Fixed our heat the same day. We'd recommend them to anyone.</p><span class="chip">${ICON('reply')}Reply written</span></div>`);
  const afterCards = [
    mk(review('Dana R.', 'D', 'Fixed our heat the same day.', 'mini')),
    mk(review('Sam K.', 'S', 'Found the leak right away.', 'mini', 'g')),
    mk(review('Rosa L.', 'R', 'On time and tidy.', 'mini', 'b')),
  ];
  const afterChips = [0, 1, 2].map(() => pill('reply', 'Reply written', 'light'));

  // the statistics, each with its source
  const months = Array.from({ length: 12 }, (_, i) => `<span class="${i >= 9 ? 'in' : ''}">${['Dec', 'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov'][i]}</span>`).join('');
  const stat1 = mk(`<div class="stat"><div class="num"><span class="n">74</span><small>%</small></div><div><div class="lab">look for reviews from the last three months.</div><div class="months">${months}</div><div class="src">Source: BrightLocal, Local Consumer Review Survey 2026</div></div></div>`);
  const mkOld = mk(`<span class="mk old">${ICON('clock')}Your newest review</span>`);
  const mkNew = mk(`<span class="mk new">${ICON('clock')}Theirs, 2 days ago</span>`);
  const stat2 = mk(`<div class="stat"><div class="num"><span class="n">80</span><small>%</small></div><div><div class="lab">are more likely to use a business that replies to all its reviews.</div><div class="src">Source: BrightLocal, Local Consumer Review Survey 2026</div></div></div>`);
  const s2a = mk(`<div class="rv mini notail"><span class="av g">S</span><span class="head"><b>Sam K.</b>${stars(5)}</span><p>Quick and honest.</p><span class="chip">${ICON('reply')}Owner replied</span></div>`);
  const s2b = mk(`<div class="rv mini notail"><span class="av">L</span><span class="head"><b>Lee W.</b>${stars(5)}</span><p>Great job on the boiler.</p><span class="chip" style="background:#fff3dc;color:#7a4a00">${ICON('info')}No reply</span></div>`);

  // your job software (named generically: Rempo connects to the one you use)
  const jobs = mk(`<div class="jobs"><h4>${ICON('list')}Your job software<small>Today</small></h4>
    <div class="job j0"><b>Furnace repair</b><small>Dana R. · 2:38 pm</small><span class="stt">${ICON('clock')}In progress</span></div>
    <div class="job"><b>Water heater</b><small>Tom B. · 4:00 pm</small><span class="stt">Scheduled</span></div>
    <div class="job"><b>Leak check</b><small>Sam K. · 5:30 pm</small><span class="stt">Scheduled</span></div></div>`);
  const j0 = jobs.querySelector('.j0'), j0s = j0.querySelector('.stt');

  // the phone and its screens
  const phone = mk(`<div class="phone"><div class="scr"><span class="notch"></span><div class="sb"><span class="clock">9:14</span><span class="bat"></span></div>
    <div class="view v-search">
      <div class="q">${ICON('search')}<span class="typed"></span><span class="caret"></span></div>
      <div class="map"><svg viewBox="0 0 508 200" preserveAspectRatio="none"><rect width="508" height="200" fill="#e7eef4"/><path d="M0 70H508M0 150H508M120 0V200M330 0V200" stroke="#fff" stroke-width="16"/><path d="M0 110L508 40" stroke="#fff" stroke-width="10"/><rect x="150" y="90" width="150" height="40" rx="6" fill="#cfe8c8"/><rect x="360" y="160" width="120" height="30" rx="6" fill="#cfe8c8"/></svg>
        <span class="pin" style="left:30%;top:52%;color:#1f86ff">${ICON('pin', 'f')}</span><span class="pin" style="left:72%;top:64%;color:#ee7d57">${ICON('pin', 'f')}</span></div>
      <div class="res">
        <div class="biz b-you"><div class="nm">Maple Street Plumbing<span class="you">You</span></div><div class="rt"><b>4.9</b>${stars(5)}</div>
          <div class="ln old l-recent"><span class="dot"></span><span class="lt">Newest review: 5 months ago</span></div><div class="ln old l-reply"><span class="dot"></span><span class="lt">No replies to reviews</span></div>
          <div class="snip" style="display:none"><b>"Fixed our heat the same day."</b> Dana R.</div>
          <div class="act"><span class="call">${ICON('phone')}Call</span><span>${ICON('pin')}Directions</span></div></div>
        <div class="biz b-rival"><div class="nm">Down the Road Plumbing</div><div class="rt"><b>4.6</b>${stars(4)}</div>
          <div class="ln new l-recent"><span class="dot"></span>Newest review: 2 days ago</div><div class="ln new l-reply"><span class="dot"></span>Replies to every review</div>
          <div class="act"><span class="call">${ICON('phone')}Call</span><span>${ICON('pin')}Directions</span></div></div>
      </div>
      <span class="tap"></span>
    </div>
    <div class="view calling c-rival"><div class="who">D<i></i></div><div class="st">Calling...</div><div class="nm">Down the Road Plumbing</div><span class="end">${ICON('phone')}</span></div>
    <div class="view calling c-you"><div class="who b">M<i></i></div><div class="st">Calling...</div><div class="nm">Maple Street Plumbing</div><span class="end">${ICON('phone')}</span></div>
    <div class="view msgs"><div class="hd"><span class="av">M</span><b>Maple Street Plumbing</b></div><div class="body">
      <div class="day">Today 2:40 pm</div>
      <div class="bub img m1"><div class="ph"><b>Thanks, Dana!</b></div><p>Hi Dana, thanks for having us out today. Would you share an honest review of your visit? <u>Leave a review</u><small>Reply STOP to opt out.</small></p></div>
      <div class="day m2">Thursday 10:00 am</div>
      <div class="bub m3">A quick reminder, if you have a minute: we'd value your honest review. <u>Leave a review</u></div>
    </div></div>
  </div></div>`);
  const ph = {
    search: phone.querySelector('.v-search'), callRival: phone.querySelector('.c-rival'), callYou: phone.querySelector('.c-you'),
    msgs: phone.querySelector('.msgs'), typed: phone.querySelector('.typed'), caret: phone.querySelector('.caret'),
    map: phone.querySelector('.map'), you: phone.querySelector('.b-you'), rival: phone.querySelector('.b-rival'),
    tap: phone.querySelector('.tap'), clock: phone.querySelector('.clock'), snip: phone.querySelector('.snip'),
    m1: phone.querySelector('.m1'), m2: phone.querySelector('.m2'), m3: phone.querySelector('.m3'), body: phone.querySelector('.msgs .body'),
  };
  ph.photo = phone.querySelector('.ph');
  const viewOf = (v, o) => { v.style.opacity = o; };
  function phoneReset() {
    for (const v of [ph.search, ph.callRival, ph.callYou, ph.msgs]) viewOf(v, 0);
    ph.tap.style.opacity = 0;
    for (const el of phone.querySelectorAll('.hl,.hl-old,.hl-new')) el.classList.remove('hl', 'hl-old', 'hl-new');
  }
  const ringEls = phone.querySelectorAll('.calling .who i');
  function tapAt(btn) {
    const r = btn.getBoundingClientRect(), v = ph.search.getBoundingClientRect(), k = v.width / ph.search.offsetWidth;
    ph.tap.style.left = ((r.left - v.left + r.width / 2) / k).toFixed(1) + 'px';
    ph.tap.style.top = ((r.top - v.top + r.height / 2) / k).toFixed(1) + 'px';
  }

  const endCard = mk(`<div class="end"><svg class="logo" viewBox="0 0 211.2 64" aria-hidden="true" style="--c-logo-ink:#0A1A33"><use href="#logo-h"/></svg><h2>Your reputation, as good as your work.</h2><p>Every customer asked. Every review answered.</p></div>`);

  // ------------------------------------------------------------------ the 3D cast, at rest
  const H0 = T.houses[0], H1 = T.houses[1], HF = T.houses.slice(0, 5);
  const ppl = T.people;
  const doorOf = (h, dz = 0) => { const p = h.localToWorld(new THREE.Vector3(h.front.x, 0, h.front.z - 0.55 + dz)); return p; };
  T.group.updateMatrixWorld(true);
  const danaDoor = doorOf(H0), leakDoor = doorOf(H1);
  const shopDoor = T.yours.localToWorld(T.yours.front.clone()).add(new THREE.Vector3(0, 0, -0.5));
  const rivalDoor = T.rival.localToWorld(T.rival.front.clone()).add(new THREE.Vector3(0, 0, -0.5));
  const nextHouse = T.houses[4];
  const nextDoor = doorOf(nextHouse);
  const roofTop = (h) => h.localToWorld(new THREE.Vector3(0, 3.55, 0));

  function rest(t) {
    for (const k of Object.keys(ppl)) { ppl[k].visible = false; pose(ppl[k], {}); ppl[k].rotation.set(0, 0, 0); }
    for (const h of T.houses) { h.door.rotation.y = 0; h.inside.emissiveIntensity = 0; }
    const vy = T.vans.yours; vy.visible = true; vy.position.set(-30, 0, LANE_NEAR); vy.rotation.y = Math.PI / 2; vy.userData.lightsOn = undefined;
    const vr = T.vans.rival; vr.visible = true; vr.position.set(20.2, 0, 3.15); vr.rotation.y = -Math.PI / 2; vr.userData.lightsOn = undefined;
    T.vans.rival2.visible = false;
    T.mark.visible = false;
    T.yours.userData.on = 1; T.rival.userData.on = 1;
    for (const m of T.windows) m.userData.on = 1;
    B.group.visible = false;
    crewPhoto.group.visible = false;
    canvas.style.filter = '';
    veil.style.opacity = 0;
    veil.style.background = '#fff';
    bgn.style.opacity = 0;
  }
  function spin(v, dist) { v.wheels.forEach((wh) => { wh.rotation.x = dist / 0.29; }); }
  function setCam(pos, tgt, fov = 26) {
    cam.position.set(pos[0], pos[1], pos[2]);
    cam.fov = fov;
    cam.updateProjectionMatrix();
    cam.lookAt(tgt[0], tgt[1], tgt[2]);
    cam.updateMatrixWorld();
  }
  function night(n, focus = [0, 0, 0], span = 26) {
    S.setNight(n, new THREE.Vector3(...focus), span);
    bgn.style.opacity = n.toFixed(3);
  }
  // a person walking from a to b between t0 and t1 (x, z), facing the way they walk, then facing `face` once there
  function walk(p, t, t0, t1, a, b, face = null, extra = {}) {
    const k = ease.inOutSine(prog(t, t0, t1));
    p.position.set(lerp(a[0], b[0], k), 0, lerp(a[1], b[1], k));
    const moving = t > t0 && t < t1;
    const heading = Math.atan2(b[0] - a[0], b[1] - a[1]);
    p.rotation.y = moving || face == null ? heading : face;
    const dist = Math.hypot(b[0] - a[0], b[1] - a[1]) * k;
    pose(p, { walk: dist / 0.75, walking: moving ? 1 : 0, t, ...extra });
  }

  // ------------------------------------------------------------------ the shots
  const shots = [];
  const shot = (t0, name, fn) => shots.push({ t0, name, fn });

  // 1. Your crew does great work. Morning on your street.
  shot(0, 'work', (t) => {
    night(0, [-8, 0, 2], 15);
    const cu = w('A2', 'Customers');
    setCam(keys(t, [[0, [-2, 26, 40]], [3.6, [-3.6, 10.2, 21.0], 'inOut'], [cu - 0.3, [-2.6, 9.9, 20.4], 'inOutSine'], [cu + 1.6, [-6.4, 5.2, 12.2], 'inOut'], [11.6, [-6.7, 5.0, 11.6], 'inOutSine']]),
      keys(t, [[0, [-6, 0, 1]], [3.6, [-8.0, 2.5, 1.8], 'inOut'], [cu - 0.3, [-7.4, 2.5, 1.8], 'inOutSine'], [cu + 1.6, [-10.1, 1.95, 2.2], 'inOut'], [11.6, [-10.2, 1.95, 2.2], 'inOutSine']]), 24);
    const vy = T.vans.yours;
    const vx = keys(t, [[0.2, -27], [3.2, -10.0, 'out']]);
    vy.position.set(vx, 0, LANE_NEAR); spin(vy, vx);
    // tech A walks from the van to Dana's door; she opens it
    const A = ppl.techA; A.visible = t > 3.3;
    walk(A, t, 3.3, 4.9, [-10.4, 5.25], [danaDoor.x, danaDoor.z + 0.75], Math.PI);
    H0.door.rotation.y = -1.45 * ease.inOut(prog(t, 4.3, 4.9));
    H0.inside.emissiveIntensity = 0.0;
    const D = ppl.dana; D.visible = t > 4.45;
    D.position.set(danaDoor.x, 0, danaDoor.z - 0.45 + 0.57 * ease.out(prog(t, 4.45, 5.0)));
    pose(D, { wave: inOut(t, w('A2', 'Customers') - 0.1, 11.3, 0.35, 0.4), t });
    // tech B already at the next door with the leak customer
    const Bt = ppl.techB; Bt.visible = true; Bt.position.set(leakDoor.x + 0.1, 0, leakDoor.z + 0.8); Bt.rotation.y = Math.PI; pose(Bt, {});
    H1.door.rotation.y = -1.45;
    const K = ppl.leak; K.visible = true; K.position.set(leakDoor.x, 0, leakDoor.z + 0.12);
    pose(K, { wave: inOut(t, w('A2', 'Customers') + 0.3, 11.3, 0.35, 0.4) * 0.8, t: t + 0.4 });
    // the work, named
    const [fx, fy] = projOf(H0, 3.9, 0.3);
    show(P.furnace, { x: fx, y: fy, ay: 1, o: fade(t, w('A2', 'Furnaces')) * gone(t, cu - 0.1), s: 0.85 + 0.15 * pop(t, w('A2', 'Furnaces')) });
    const [lx, ly] = projOf(H1, 3.9, -0.4);
    show(P.leak, { x: lx, y: ly, ay: 1, o: fade(t, w('A2', 'Leaks')) * gone(t, cu - 0.1), s: 0.85 + 0.15 * pop(t, w('A2', 'Leaks')) });
    const [dx, dy] = projOf(D, 1.75);
    show(say, { x: dx - 40, y: dy - 30, ax: 0.1, ay: 1, o: fade(t, cu + 0.5) * gone(t, 11.6), s: 0.8 + 0.2 * pop(t, cu + 0.5) });
  });

  // 2. But a happy customer is a quiet one. Then life happens, and the shop is on to the next call.
  shot(11.6, 'quiet', (t) => {
    night(0, [-11, 0, 2], 15);
    const t2 = s('B3');
    setCam(keys(t, [[11.6, [-6.7, 5.0, 11.6]], [13.4, [-5.4, 6.9, 14.6], 'inOut'], [t2 - 0.4, [-5.0, 7.1, 15.2], 'inOutSine'], [t2 + 2.4, [-6.0, 13.2, 29.0], 'inOut'], [24.7, [-6.4, 13.4, 29.4]]]),
      keys(t, [[11.6, [-10.2, 1.95, 2.2]], [13.4, [-10.1, 3.1, 1.6], 'inOut'], [t2 - 0.4, [-10.0, 3.2, 1.6], 'inOutSine'], [t2 + 2.4, [-11.6, 2.9, 1.0], 'inOut'], [24.7, [-11.8, 2.9, 1.0]]]), 24);
    const vy = T.vans.yours;
    const vx = keys(t, [[t2 + 0.3, -10.0], [24.4, 9, 'in']]);
    vy.position.set(vx, 0, LANE_NEAR); spin(vy, vx);
    // Dana goes back in and the door closes; tech A goes back to the van
    const D = ppl.dana; D.visible = t < 12.75;
    D.position.set(danaDoor.x, 0, danaDoor.z + 0.12 - 0.5 * prog(t, 12.2, 12.75));
    D.rotation.y = 0;
    H0.door.rotation.y = -1.45 * (1 - ease.inOut(prog(t, 12.6, 13.2)));
    const A = ppl.techA; A.visible = t < 13.5;
    walk(A, t, 12.1, 13.5, [danaDoor.x, danaDoor.z + 0.75], [-10.4, 5.25]);
    const Bt = ppl.techB; Bt.visible = t < 13.5;
    walk(Bt, t, 12.3, 13.5, [leakDoor.x + 0.1, leakDoor.z + 0.8], [-8.9, 5.25]);
    const K = ppl.leak; K.visible = t < 12.9;
    K.position.set(leakDoor.x, 0, leakDoor.z + 0.12 - 0.5 * prog(t, 12.4, 12.9));
    H1.door.rotation.y = -1.45 * (1 - ease.inOut(prog(t, 12.8, 13.4)));
    // the review she means to write, and life in the way
    const [hx, hy] = projOf(H0, 4.1, 0.4);
    const outT = w('B2', 'life') + 0.75;
    const thinkO = fade(t, 12.9, 0.45) * gone(t, outT, 0.35);
    const shake = t > w('B2', 'dinner') && t < outT ? Math.sin(t * 22) * 1.6 * prog(t, w('B2', 'dinner'), outT) : 0;
    show(think, { x: hx + 30, y: hy - 10, ax: 0.15, ay: 1, o: thinkO, s: (0.82 + 0.18 * pop(t, 12.9)) * (1 - 0.25 * prog(t, outT, outT + 0.35)), r: shake });
    const lw = [w('B2', 'dinner'), w('B2', 'kids'), w('B2', 'life')];
    const lpos = [[-250, -190], [-330, 20], [300, -60]];
    life.forEach((el, i) => show(el, { x: hx + lpos[i][0], y: hy + lpos[i][1], o: fade(t, lw[i] - 0.05, 0.2) * gone(t, outT + 0.25), s: pop(t, lw[i] - 0.05, 0.4), r: (i - 1) * 8 }));
    // on to the next call: the owner picks up at the shop
    const O = ppl.owner; O.visible = true;
    O.position.set(shopDoor.x, 0, shopDoor.z + 0.65); O.rotation.y = 0.25;
    pose(O, { call: ease.inOut(prog(t, t2 + 0.6, t2 + 1.1)), t });
    const [ox, oy] = projOf(O, 1.6);
    rings(ox, oy - 40, t, t2 + 0.1, t2 + 0.9, '#1f86ff', 0.45);
    show(P.call, { x: ox, y: oy - 20, ay: 1, o: fade(t, t2 + 0.5) , s: 0.9 + 0.1 * pop(t, t2 + 0.5) });
    // the reviews that did not happen, over the houses where the work was done
    for (const [i, h] of [[0, H0], [1, H1]]) {
      const [gx, gy] = projOf(h, 3.9);
      show(ghostsB[i], { x: gx, y: gy - 6 * Math.sin(t * 1.3 + i), ay: 1, o: 0.95 * fade(t, t2 + 1.2 + i * 0.25, 0.5), s: 0.92 * pop(t, t2 + 1.2 + i * 0.25, 0.5) });
    }
    // dip to night
    veil.style.background = '#06112a';
    veil.style.opacity = (ease.in(prog(t, 24.25, 24.7))).toFixed(3);
  });

  // 3. Tonight, across town: water on the basement floor. She grabs her phone.
  shot(24.7, 'basement', (t) => {
    B.group.visible = true;
    night(1, [B.group.position.x, 0, 0], 7);
    T.group.visible = false;
    const bx = B.group.position.x;
    setCam(keys(t, [[24.7, [bx + 8.8, 8.0, 15.2]], [28.2, [bx + 6.6, 5.6, 11.4], 'inOutSine'], [31.2, [bx + 5.6, 4.6, 9.6], 'inOutSine']]),
      keys(t, [[24.7, [bx - 0.4, 1.5, -0.6]], [28.2, [bx - 1.0, 1.4, -0.2], 'inOutSine'], [31.2, [bx - 1.1, 1.3, 0.0], 'inOutSine']]), 26);
    veil.style.background = '#06112a';
    veil.style.opacity = (1 - ease.out(prog(t, 24.7, 25.3))).toFixed(3);
    B.light.intensity = 9;
    // the leak
    const pk = ease.out(prog(t, 24.9, 31.5));
    B.puddle.scale.set(0.35 + 2.15 * pk, 0.3 + 1.55 * pk, 1);
    B.drops.forEach((d, i) => {
      const k = ((t * 1.6 + i / 3) % 1);
      d.position.set(2.4, 0.62 - k * 0.6, -1.72 + k * 0.05);
      d.visible = true;
    });
    // she comes down the stairs, sees the water, takes out her phone
    const Wm = B.woman; Wm.visible = true;
    const z = keys(t, [[25.0, -2.7], [27.2, 0.95, 'linear']]);
    const stepH = (zz) => { const i = clamp(Math.round((zz + 2.85) / 0.55), 0, 6); return zz > 0.75 ? 0 : 0.5 * (7 - i) * (1 - clamp((zz - 0.45) / 0.3)); };
    if (t < 27.2) {
      Wm.position.set(-3.4, stepH(z), z); Wm.rotation.y = 0;
      pose(Wm, { walk: (t - 25) * 1.6, walking: 1, t });
    } else {
      walk(Wm, t, 27.2, 28.3, [-3.4, 0.95], [-1.2, 0.55], 1.05, { worried: t > 27.9 ? 1 : 0, phone: ease.inOut(prog(t, s('C2') + 0.2, s('C2') + 0.8)) });
    }
    Wm.parts.screenMat.emissiveIntensity = 1.3 * prog(t, s('C2') + 0.4, s('C2') + 0.9);
    const [cx, cy] = [180, 120];
    show(P.tonight, { x: cx, y: cy, ax: 0, ay: 0.5, o: fade(t, 25.4) * gone(t, 31.0), s: 0.9 + 0.1 * pop(t, 25.4) });
  });

  // 4. The search: your better rating, your old review, no replies; their review two days ago, every one answered.
  shot(31.2, 'search', (t) => {
    B.group.visible = true; T.group.visible = false;
    night(1, [B.group.position.x, 0, 0], 7);
    const bx = B.group.position.x;
    setCam([bx + 5.6, 4.6, 9.6], [bx - 1.1, 1.3, 0.0], 26);
    B.light.intensity = 9;
    B.puddle.scale.set(2.5, 1.85, 1);
    const Wm = B.woman; Wm.visible = true; Wm.position.set(-1.2, 0, 0.55); Wm.rotation.y = 1.05; pose(Wm, { phone: 1, worried: 1 });
    Wm.parts.screenMat.emissiveIntensity = 1.3;
    canvas.style.filter = `blur(${(9 * fade(t, 31.2, 0.5)).toFixed(1)}px) brightness(${(1 - 0.45 * fade(t, 31.2, 0.5)).toFixed(3)})`;
    phoneReset();
    const callAt = w('C5', 'calls');
    viewOf(ph.search, t < callAt + 0.45 ? 1 : 0);
    viewOf(ph.callRival, t >= callAt + 0.45 ? 1 : 0);
    ph.clock.textContent = '9:14';
    const q = 'plumber near me';
    const n = Math.round(clamp((t - 31.5) / 1.2) * q.length);
    ph.typed.textContent = q.slice(0, n);
    ph.caret.style.opacity = t < 32.9 ? (Math.floor(t * 3) % 2 ? 1 : 0.2) : 0;
    const rk = fade(t, 32.8, 0.5);
    ph.map.style.opacity = rk; ph.you.style.opacity = rk; ph.rival.style.opacity = fade(t, 33.0, 0.5);
    ph.you.style.transform = `translateY(${(1 - rk) * 40}px)`;
    ph.rival.style.transform = `translateY(${(1 - fade(t, 33.0, 0.5)) * 40}px)`;
    ph.snip.style.display = 'none';
    ph.you.querySelector('.l-recent .lt').textContent = 'Newest review: 5 months ago';
    ph.you.querySelector('.l-reply .lt').textContent = 'No replies to reviews';
    ph.you.querySelectorAll('.ln').forEach((x) => { x.classList.add('old'); x.classList.remove('new'); });
    // the highlights follow the narration
    const youRt = ph.you.querySelector('.rt'), youRecent = ph.you.querySelector('.l-recent'), youReply = ph.you.querySelector('.l-reply');
    const rvRecent = ph.rival.querySelector('.l-recent'), rvReply = ph.rival.querySelector('.l-reply');
    youRt.classList.toggle('hl', t > s('C3') && t < w('C3', 'But'));
    youRecent.classList.toggle('hl-old', t > w('C3', 'newest') && t < callAt);
    youReply.classList.toggle('hl-old', t > w('C3', 'reply') && t < callAt);
    rvRecent.classList.toggle('hl-new', t > w('C4', 'two') - 0.1 && t < callAt + 0.45);
    rvReply.classList.toggle('hl-new', t > w('C4', 'answered') - 0.1 && t < callAt + 0.45);
    // she taps their number
    const tapK = prog(t, callAt - 0.05, callAt + 0.4);
    if (tapK > 0 && tapK < 1) {
      tapAt(ph.rival.querySelector('.call'));
      ph.tap.style.opacity = (1 - tapK).toFixed(2);
      ph.tap.style.transform = `scale(${0.6 + tapK * 0.8})`;
    }
    ringEls.forEach((r, i) => { const k = ((t * 1.4 + i * 0.5) % 1); r.style.transform = `scale(${1 + k * 0.4})`; r.style.opacity = (1 - k).toFixed(2); });
    const inK = ease.outQuint(prog(t, 31.2, 31.9));
    show(phone, { x: 960, y: 540 + (1 - inK) * 700, o: 1 });
    veil.style.background = '#06112a';
    veil.style.opacity = (ease.in(prog(t, 47.05, 47.35)) * 0.9).toFixed(3);
  });

  // 5. She calls them: the phone rings at the shop down the road, and their van heads out.
  shot(47.35, 'rival', (t) => {
    night(1, [14, 0, 2], 16);
    setCam(keys(t, [[47.35, [27, 7.8, 17]], [49.4, [25.5, 7.2, 15.8], 'linear']]), [15.5, 1.2, 3.2], 28);
    veil.style.background = '#06112a';
    veil.style.opacity = ((1 - ease.out(prog(t, 47.35, 47.7))) * 0.9).toFixed(3);
    T.yours.userData.on = 0;
    const vr = T.vans.rival; vr.userData.lightsOn = 1;
    const k = ease.in(prog(t, 47.7, 49.4));
    vr.position.set(20.2 - k * 2.0, 0, 3.15 + k * 1.6);
    vr.rotation.y = -Math.PI / 2 + 0.45 * k;
    const R = ppl.rivalTech; R.visible = true;
    R.position.set(rivalDoor.x, 0, rivalDoor.z + 0.7); R.rotation.y = 0.4; pose(R, { call: 1, t });
    const [rx, ry] = projOf(T.rival, 2.9, 0.65, 1.6);
    rings(rx, ry, t, 47.4, 49.6, '#ee7d57', 0.5);
    show(P.ringRival, { x: rx, y: ry - 80, ay: 1, o: fade(t, 47.5), s: 0.9 + 0.1 * pop(t, 47.5) });
    veil.style.background = '#ffffff';
    veil.style.opacity = Math.max(+veil.style.opacity || 0, ease.inOut(prog(t, 49.1, 49.6))).toFixed(3);
  });

  // 6. The numbers: three in four look at the last three months; four in five lean toward businesses that reply.
  shot(49.6, 'stats', (t) => {
    T.group.visible = false;
    veil.style.background = 'radial-gradient(60% 60% at 85% 0%,#e4f0ff 0%,transparent 70%),radial-gradient(55% 55% at 0% 100%,#eef4fd 0%,transparent 70%),#fff';
    veil.style.opacity = '1';
    const out1 = s('D2') - 0.25;
    const k1 = fade(t, 49.6, 0.5) * gone(t, out1, 0.35);
    show(stat1, { x: 960, y: 520, o: k1, s: 0.97 + 0.03 * fade(t, 49.6, 0.6) });
    stat1.querySelector('.n').textContent = Math.round(74 * ease.out(prog(t, 49.7, 50.9)));
    const ms = stat1.querySelectorAll('.months span');
    if (stat1._f === frame) {
      const r0 = ms[6].getBoundingClientRect(), r1 = ms[11].getBoundingClientRect();
      show(mkOld, { x: r0.left + r0.width / 2, y: r0.top - 14, ay: 1, o: k1 * fade(t, 51.0), s: pop(t, 51.0) });
      show(mkNew, { x: r1.right, y: r1.bottom + 18, ax: 1, ay: 0, o: k1 * fade(t, 51.5), s: pop(t, 51.5) });
    }
    const k2 = fade(t, out1 + 0.3, 0.5) * gone(t, 58.55, 0.35);
    show(stat2, { x: 960, y: 420, o: k2, s: 0.97 + 0.03 * fade(t, out1 + 0.3, 0.6) });
    stat2.querySelector('.n').textContent = Math.round(80 * ease.out(prog(t, out1 + 0.4, out1 + 1.6)));
    show(s2a, { x: 900, y: 780, o: k2 * fade(t, w('D2', 'replies')), s: pop(t, w('D2', 'replies')) });
    show(s2b, { x: 1320, y: 780, o: k2 * fade(t, w('D2', 'replies') + 0.35), s: pop(t, w('D2', 'replies') + 0.35) });
  });

  // 7. Every great job that never becomes a review: proof you earned, and never got to use.
  shot(58.6, 'ghosts', (t) => {
    night(0, [-1, 0, 1], 18);
    setCam(keys(t, [[58.6, [-10.5, 10.0, 23.5]], [65.5, [3.5, 10.0, 23.5], 'inOutSine']]),
      keys(t, [[58.6, [-7.4, 3.3, 0.6]], [65.5, [3.0, 3.3, 0.6], 'inOutSine']]), 30);
    veil.style.background = '#ffffff';
    veil.style.opacity = (1 - ease.out(prog(t, 58.6, 59.1))).toFixed(3);
    T.vans.yours.position.set(-30, 0, LANE_NEAR);
    const fadeAt = w('D3', 'never', 1) - 0.2;
    HF.forEach((h, i) => {
      const a = 59.0 + i * 0.32;
      const [gx, gy] = projOf(h, 3.95);
      const up = ease.in(prog(t, fadeAt + i * 0.18, fadeAt + i * 0.18 + 1.0));
      show(ghosts[i], { x: gx, y: gy - up * 90 - 5 * Math.sin(t * 1.4 + i), ay: 1, o: fade(t, a, 0.4) * (1 - up), s: 0.95 * pop(t, a, 0.45) });
      const [dx, dy] = projOf(h, 0.2, h.front.x, h.front.z);
      show(P.done[i], { x: dx, y: dy, ay: 0.5, o: fade(t, a + 0.15, 0.3) * gone(t, 65.3, 0.3), s: 0.75 * pop(t, a + 0.15) });
    });
  });

  // 8. You did the better work. They just had the proof. Your shop and theirs, side by side.
  const camL = new THREE.PerspectiveCamera(30, (W / 2) / H, 0.5, 400), camR = camL.clone();
  function projSplit(c, obj, half, dy = 0) {
    obj.getWorldPosition(v3); v3.y += dy; v3.project(c);
    return [half * W / 2 + ((v3.x + 1) / 2) * (W / 2), ((1 - v3.y) / 2) * H];
  }
  const divider = mk('', 'divider'), tagYou = mk('<span class="side-tag you">Your shop</span>'), tagThem = mk('<span class="side-tag them">The shop down the road</span>');
  shot(65.5, 'twoShops', (t) => {
    night(0, [0, 0, 1], 26);
    const drift = ease.inOutSine(prog(t, 65.5, 69.6));
    const yc = T.yours.position, rc = T.rival.position;
    camL.position.set(yc.x + 5.4 - drift * 0.6, 7.2, yc.z + 13.6 - drift * 0.8); camL.lookAt(yc.x + 0.4, 3.5, yc.z + 0.6); camL.updateMatrixWorld();
    camR.position.set(rc.x - 5.4 + drift * 0.6, 7.2, rc.z + 13.6 - drift * 0.8); camR.lookAt(rc.x - 0.4, 3.5, rc.z + 0.6); camR.updateMatrixWorld();
    S.state.split = [camL, camR];
    T.vans.yours.position.set(-19.4, 0, 3.4); T.vans.yours.rotation.y = 0;
    const O = ppl.owner; O.visible = true; O.position.set(shopDoor.x - 0.4, 0, shopDoor.z + 0.9); O.rotation.y = 0.3; pose(O, {});
    const R = ppl.rivalTech; R.visible = true; R.position.set(rivalDoor.x, 0, rivalDoor.z + 0.9); R.rotation.y = -0.3; pose(R, {});
    const wipe = ease.outQuint(prog(t, 65.5, 66.1));
    show(divider, { x: 960, y: 540, o: 1, s: 1 });
    divider.style.transform += ` scaleY(${wipe.toFixed(3)})`;
    show(tagYou, { x: 480, y: 92, o: fade(t, 65.6), s: 0.9 + 0.1 * pop(t, 65.6) });
    show(tagThem, { x: 1440, y: 92, o: fade(t, 65.8), s: 0.9 + 0.1 * pop(t, 65.8) });
    const [yx, yy] = projSplit(camL, T.yours, 0, 3.3);
    show(P.yoursOld, { x: yx, y: yy - 70, ay: 1, o: fade(t, w('D4', 'better') - 0.3), s: 0.92 * pop(t, w('D4', 'better') - 0.3) });
    show(P.yoursOldNote, { x: yx, y: yy - 56, ay: 0, o: fade(t, w('D4', 'work') ), s: 0.86 * pop(t, w('D4', 'work')) });
    const [rx, ry] = projSplit(camR, T.rival, 1, 3.3);
    show(P.rivalNew, { x: rx, y: ry - 70, ay: 1, o: fade(t, w('D4', 'They') - 0.2), s: 0.92 * pop(t, w('D4', 'They') - 0.2) });
    show(P.rivalNewNote, { x: rx, y: ry - 56, ay: 0, o: fade(t, w('D4', 'had')), s: 0.86 * pop(t, w('D4', 'had')) });
    rivalCards.forEach((c, i) => {
      const a = w('D4', 'proof') - 0.25 + i * 0.16;
      show(c, { x: rx + (i - 1) * 46, y: ry - 150 - i * 52, ay: 1, o: fade(t, a, 0.3), s: 0.76 * pop(t, a, 0.45), r: (1 - i) * 4 });
    });
    veil.style.background = '#ffffff';
    veil.style.opacity = (ease.inOut(prog(t, 69.3, 69.6)) * 0.6).toFixed(3);
  });

  // 9. Rempo runs your Google reviews for you, connected to the software you already log jobs in.
  shot(69.6, 'rempo', (t) => {
    night(0, [-9, 0, 1], 18);
    setCam(keys(t, [[69.6, [-3.0, 15.5, 34]], [72.4, [-4.0, 10.8, 25.5], 'inOut'], [77.4, [-4.6, 10.2, 24.2], 'inOutSine']]),
      keys(t, [[69.6, [-6.0, 2.6, 1.0]], [72.4, [-9.4, 3.2, 1.4], 'inOut'], [77.4, [-9.8, 3.2, 1.4], 'inOutSine']]), 30);
    veil.style.background = '#ffffff';
    veil.style.opacity = ((1 - ease.out(prog(t, 69.6, 70.0))) * 0.6).toFixed(3);
    T.vans.yours.position.set(-19.4, 0, 3.4); T.vans.yours.rotation.y = 0;
    const O = ppl.owner; O.visible = true; O.position.set(shopDoor.x - 0.4, 0, shopDoor.z + 0.8); O.rotation.y = 0.3; pose(O, {});
    const M = T.mark; M.visible = true;
    const dropK = prog(t, 69.85, 70.9);
    M.position.set(-8.6, lerp(15, 5.4, ease.outBack(dropK)), 1.2);
    M.rotation.y = -0.35 + Math.sin(t * 0.8) * 0.06;
    M.position.y += Math.sin(t * 1.6) * 0.08;
    const [mx, my] = projOf(M, 0.0);
    rings(mx, my + 10, t, 70.75, 71.9, '#1f86ff', 0.6);
    show(P.mark, { x: mx, y: my + 36, ay: 0, o: fade(t, 71.0) * gone(t, s('E2') + 0.2), s: 0.85 * pop(t, 71.0) });
    // the job software, connected
    const jin = ease.outQuint(prog(t, s('E2') + 0.1, s('E2') + 0.8));
    show(jobs, { x: 110 + (jin - 1) * 900, y: 600, ax: 0, ay: 0.5, o: jin });
    j0.classList.remove('hl'); j0s.classList.remove('done'); j0s.innerHTML = `${ICON('clock')}In progress`;
    const con = w('E2', 'connect');
    const a = [110 + 760 * jin, 470], b = [mx - 50, my + 40];
    beam(a, b, ease.inOut(prog(t, con, con + 0.8)), { lift: 0.18 });
    glow(b[0], b[1], fade(t, con + 0.7));
    show(P.connected, { x: (a[0] + b[0]) / 2 + 40, y: (a[1] + b[1]) / 2 - 70, o: fade(t, con + 0.6), s: 0.8 * pop(t, con + 0.6) });
  });

  // 10. A job marked complete; the thank-you with your crew's photo and her first name; then one reminder.
  shot(77.4, 'request', (t) => {
    night(0, [-9, 0, 2], 14);
    setCam(keys(t, [[77.4, [-4.6, 10.2, 24.2]], [80.4, [-1.6, 6.6, 15.6], 'inOut'], [86.5, [-1.9, 6.4, 15.0], 'inOutSine']]),
      keys(t, [[77.4, [-9.8, 3.2, 1.4]], [80.4, [-8.2, 2.3, 2.0], 'inOut'], [86.5, [-8.4, 2.3, 2.0], 'inOutSine']]), 30);
    T.vans.yours.position.set(-19.4, 0, 3.4); T.vans.yours.rotation.y = 0;
    const M = T.mark; M.visible = true;
    const mk2 = ease.inOut(prog(t, 77.4, 79.2));
    M.position.set(lerp(-8.6, -9.3, mk2), lerp(5.4, 4.3, mk2) + Math.sin(t * 1.6) * 0.08, lerp(1.2, 1.6, mk2)); M.rotation.y = -0.35 + Math.sin(t * 0.8) * 0.06;
    const D = ppl.dana; D.visible = true; D.position.set(danaDoor.x + 0.2, 0, danaDoor.z + 0.9); D.rotation.y = 0.5;
    const look = ease.inOut(prog(t, w('E3', 'customer') + 0.4, w('E3', 'customer') + 1.0));
    pose(D, { phone: look });
    D.parts.screenMat.emissiveIntensity = 0.9 * look;
    const done = w('E3', 'complete');
    const jout = ease.in(prog(t, done + 1.1, done + 1.6));
    show(jobs, { x: 110 - jout * 900, y: 600, ax: 0, ay: 0.5, o: 1 - jout });
    const isDone = t > done;
    j0.classList.toggle('hl', t > done - 0.5);
    j0s.classList.toggle('done', isDone);
    j0s.innerHTML = isDone ? `${ICON('check')}Complete` : `${ICON('clock')}In progress`;
    // the thank-you goes out to Dana
    const [mx, my] = projOf(M, 0.0);
    const [hx, hy] = projOf(D, 1.5);
    const sendAt = w('E3', 'customer');
    beam([mx, my + 30], [hx, hy], ease.inOut(prog(t, sendAt - 0.2, sendAt + 0.5)), { lift: 0.22, o: gone(t, 85.9, 0.4) });
    glow(hx, hy, fade(t, sendAt + 0.45) * gone(t, 85.9, 0.4));
    show(P.sent, { x: hx + 40, y: hy + 90, ax: 0, ay: 0.5, o: fade(t, sendAt + 0.5) * gone(t, 85.9, 0.4), s: 0.85 * pop(t, sendAt + 0.5) });
    // her phone
    phoneReset();
    viewOf(ph.msgs, 1);
    ph.clock.textContent = '2:40';
    const pin = ease.outQuint(prog(t, sendAt + 0.6, sendAt + 1.3));
    const photoAt = w('E3', 'photo') - 0.4;
    ph.m1.style.opacity = fade(t, photoAt, 0.4);
    ph.m1.style.transform = `translateY(${(1 - fade(t, photoAt, 0.4)) * 30}px) scale(${0.96 + 0.04 * fade(t, photoAt, 0.4)})`;
    const remAt = w('E3', 'reminder') - 0.3;
    ph.m2.style.opacity = fade(t, remAt, 0.3);
    ph.m3.style.opacity = fade(t, remAt + 0.2, 0.4);
    ph.m3.style.transform = `translateY(${(1 - fade(t, remAt + 0.2, 0.4)) * 30}px)`;
    ph.body.style.transform = `translateY(${-130 * ease.inOut(prog(t, remAt - 0.1, remAt + 0.5))}px)`;
    show(phone, { x: 1450 + (1 - pin) * 900, y: 540, o: 1, s: 0.98 });
  });

  // 11. Every review gets a reply, written for that review.
  shot(86.5, 'reply', (t) => {
    night(0, [-9, 0, 2], 14);
    setCam(keys(t, [[86.5, [-1.9, 6.4, 15.0]], [90.7, [-2.4, 6.8, 16.4], 'inOutSine']]), [-8.0, 2.4, 2.0], 30);
    const D = ppl.dana; D.visible = true; D.position.set(danaDoor.x + 0.2, 0, danaDoor.z + 0.9); D.rotation.y = 0.5; pose(D, { phone: 1 });
    D.parts.screenMat.emissiveIntensity = 0.9;
    T.vans.yours.position.set(-19.4, 0, 3.4); T.vans.yours.rotation.y = 0;
    const out = 90.45;
    show(danaCard, { x: 1320, y: 470, ay: 1, o: fade(t, 86.6) * gone(t, out), s: pop(t, 86.6, 0.5) });
    show(replyCard, { x: 1370, y: 520, ay: 0, o: fade(t, w('E4', 'reply')) * gone(t, out), s: pop(t, w('E4', 'reply'), 0.5) });
    const [hx, hy] = projOf(D, 1.6);
    beam([hx, hy], [1320 - 240, 380], ease.inOut(prog(t, 86.6, 87.2)), { lift: 0.25, o: 0.8 * gone(t, out) });
  });

  // 12. The same honest ask to every customer, and nothing for you to run.
  shot(90.7, 'asked', (t) => {
    night(0, [-4, 0, 1], 24);
    setCam(keys(t, [[90.7, [-5.0, 15.0, 35.5]], [99.4, [-4.0, 14.0, 33.0], 'inOutSine']]),
      keys(t, [[90.7, [-5.4, 2.6, 0.6]], [99.4, [-4.6, 2.6, 0.6], 'inOutSine']]), 30);
    veil.style.background = '#ffffff';
    veil.style.opacity = ((1 - ease.out(prog(t, 90.7, 91.05))) * 0.85).toFixed(3);
    const M = T.mark; M.visible = true;
    M.position.set(-1.5, 6.4 + Math.sin(t * 1.6) * 0.08, 1.4); M.rotation.y = -0.2 + Math.sin(t * 0.8) * 0.05;
    T.vans.yours.position.set(-19.4, 0, 3.4); T.vans.yours.rotation.y = 0;
    const O = ppl.owner; O.visible = true; O.position.set(shopDoor.x - 0.2, 0, shopDoor.z + 0.9); O.rotation.y = 0.15;
    const nv = w('E5', 'never');
    pose(O, { wave: inOut(t, nv - 0.1, 95.2, 0.35, 0.4), t });
    const [mx, my] = projOf(M, 0.0);
    const ask0 = s('E5') + 0.15;
    HF.forEach((h, i) => {
      const a = ask0 + i * 0.32;
      const [dx, dy] = projOf(h, 2.1, h.front.x, h.front.z - 0.4);
      beam([mx, my + 20], [dx, dy], ease.inOut(prog(t, a, a + 0.55)), { lift: 0.15, o: 0.85 * gone(t, 95.4, 0.5) });
      glow(dx, dy, fade(t, a + 0.5) * gone(t, 95.4, 0.5));
      show(P.asked[i], { x: dx, y: dy - 34, ay: 1, o: fade(t, a + 0.5) * gone(t, 99.3, 0.3), s: 0.8 * pop(t, a + 0.5) });
    });
    const [ox, oy] = projOf(O, 1.7);
    show(P.nothing, { x: ox + 10, y: oy - 20, ax: 0.2, ay: 1, o: fade(t, nv) * gone(t, 95.5), s: 0.85 * pop(t, nv) });
    // Every customer asked. Every review answered: some write one, and every one gets a reply
    const revAt = [s('F1') + 0.1, s('F1') + 0.45, s('F1') + 0.8];
    [0, 2, 3].forEach((hi, j) => {
      const h = HF[hi];
      const [gx, gy] = projOf(h, 4.0);
      show(afterCards[j], { x: gx, y: gy - 30, ay: 1, o: fade(t, revAt[j]), s: 0.82 * pop(t, revAt[j], 0.5) });
      const ca = w('F1', 'answered') + j * 0.2;
      show(afterChips[j], { x: gx, y: gy - 22, ay: 0, o: fade(t, ca), s: 0.7 * pop(t, ca) });
    });
    veil.style.background = '#06112a';
    veil.style.opacity = Math.max(+veil.style.opacity || 0, ease.in(prog(t, 99.1, 99.45)) * 0.9).toFixed(3);
  });

  // 13. The next time someone searches at nine at night, they see what your customers already know.
  shot(99.45, 'nextSearch', (t) => {
    night(1, [8, 0, 2], 12);
    setCam(keys(t, [[99.45, [14.5, 4.6, 12.5]], [104.9, [13.2, 4.2, 10.8], 'inOutSine']]), [9.6, 1.5, 2.6], 30);
    veil.style.background = '#06112a';
    veil.style.opacity = ((1 - ease.out(prog(t, 99.45, 99.85))) * 0.9).toFixed(3);
    const N = ppl.next; N.visible = true;
    N.position.set(nextDoor.x, 0, nextDoor.z + 0.75); N.rotation.y = -0.35;
    pose(N, { phone: ease.inOut(prog(t, 99.8, 100.4)) });
    N.parts.screenMat.emissiveIntensity = 1.3 * prog(t, 100.0, 100.5);
    nextHouse.door.rotation.y = -1.45;
    nextHouse.inside.emissiveIntensity = 1.2;
    const srch = w('F2', 'searches');
    canvas.style.filter = `blur(${(7 * fade(t, srch, 0.5)).toFixed(1)}px) brightness(${(1 - 0.35 * fade(t, srch, 0.5)).toFixed(3)})`;
    phoneReset();
    const callAt = 104.35;
    viewOf(ph.search, t < callAt + 0.45 ? 1 : 0);
    viewOf(ph.callYou, t >= callAt + 0.45 ? 1 : 0);
    ph.clock.textContent = '9:03';
    ph.typed.textContent = 'plumber near me';
    ph.caret.style.opacity = 0;
    ph.map.style.opacity = 1; ph.you.style.opacity = 1; ph.rival.style.opacity = 1;
    ph.you.style.transform = ''; ph.rival.style.transform = '';
    ph.you.querySelector('.l-recent .lt').textContent = 'Newest review: yesterday';
    ph.you.querySelector('.l-reply .lt').textContent = 'Replies to every review';
    ph.you.querySelectorAll('.ln').forEach((x) => { x.classList.remove('old'); x.classList.add('new'); });
    ph.snip.style.display = t > w('F2', 'see') - 0.2 ? '' : 'none';
    ph.you.querySelector('.l-recent').classList.toggle('hl-new', t > w('F2', 'they') - 0.2 && t < callAt);
    ph.you.querySelector('.l-reply').classList.toggle('hl-new', t > w('F2', 'they') && t < callAt);
    const tapK = prog(t, callAt - 0.05, callAt + 0.4);
    if (tapK > 0 && tapK < 1) {
      tapAt(ph.you.querySelector('.call'));
      ph.tap.style.opacity = (1 - tapK).toFixed(2);
      ph.tap.style.transform = `scale(${0.6 + tapK * 0.8})`;
    }
    ringEls.forEach((r, i) => { const k = ((t * 1.4 + i * 0.5) % 1); r.style.transform = `scale(${1 + k * 0.4})`; r.style.opacity = (1 - k).toFixed(2); });
    const pin = ease.outQuint(prog(t, srch, srch + 0.7));
    show(phone, { x: 1300 + (1 - pin) * 900, y: 540, o: 1 });
    veil.style.opacity = Math.max(+veil.style.opacity || 0, ease.in(prog(t, 105.15, 105.45)) * 0.9).toFixed(3);
  });

  // 14. The phone rings at your shop.
  shot(105.45, 'ringYours', (t) => {
    night(1, [-14, 0, 2], 12);
    setCam(keys(t, [[105.45, [-8.5, 5.8, 15.5]], [107.2, [-9.4, 5.6, 14.2], 'linear']]), [-16.4, 1.4, 2.6], 30);
    veil.style.background = '#06112a';
    veil.style.opacity = ((1 - ease.out(prog(t, 105.45, 105.8))) * 0.9).toFixed(3);
    T.vans.yours.position.set(-19.4, 0, 3.4); T.vans.yours.rotation.y = 0; T.vans.yours.userData.lightsOn = ease.out(prog(t, 106.1, 106.4));
    const O = ppl.owner; O.visible = true; O.position.set(shopDoor.x, 0, shopDoor.z + 0.7); O.rotation.y = 0.35;
    pose(O, { call: ease.inOut(prog(t, 105.9, 106.3)), t });
    const [ox, oy] = projOf(O, 1.7);
    rings(ox, oy - 30, t, 105.5, 106.4, '#1f86ff', 0.45);
    show(P.ringYours, { x: ox, y: oy - 30, ay: 1, o: fade(t, 105.55), s: 0.95 * pop(t, 105.55) });
    veil.style.background = '#ffffff';
    veil.style.opacity = Math.max(+veil.style.opacity || 0, ease.inOut(prog(t, 106.75, 107.2))).toFixed(3);
  });

  // 15. Rempo. Your reputation, as good as your work. The street as the page's hero shows it, then the close.
  shot(107.2, 'close', (t) => {
    night(0, [-8, 0, 2], 16);
    setCam(keys(t, [[107.2, [-0.4, 12.6, 25.5]], [113, [-1.2, 12.0, 24.0]]]), [-7.2, 2.7, 0.4], 26);
    T.vans.yours.position.set(-10.0, 0, LANE_NEAR); T.vans.yours.rotation.y = Math.PI / 2;
    const D = ppl.dana; D.visible = true; D.position.set(danaDoor.x + 0.3, 0, danaDoor.z + 0.85); D.rotation.y = 0.3; pose(D, { wave: 0.8, t });
    const N = ppl.next; N.visible = true; N.position.set(-3.6, 0, 3.6); N.rotation.y = -0.6; pose(N, { phone: 1 });
    N.parts.screenMat.emissiveIntensity = 0.6;
    const [hx, hy] = projOf(H0, 4.0);
    const endK = ease.inOut(prog(t, 109.6, 110.3));
    const k = fade(t, 107.3, 0.5) * (1 - endK);
    show(heroCard, { x: hx, y: hy - 6, ay: 1, o: k, s: 0.86 * pop(t, 107.3, 0.5) });
    const src = [hx, hy - 110];
    [T.houses[1], T.houses[2], T.houses[7], T.houses[8]].forEach((h, i) => {
      const [x, y] = projOf(h, 2.6);
      beam(src, [x, y], ease.inOut(prog(t, 107.7 + i * 0.1, 108.4 + i * 0.1)), { lift: 0.25, o: 1 - endK });
      glow(x, y, fade(t, 108.3 + i * 0.1) * (1 - endK));
    });
    const [nx, ny] = projOf(N, 1.7);
    show(P.reach, { x: nx, y: ny - 10, ay: 1, o: fade(t, 108.5) * (1 - endK), s: 0.85 * pop(t, 108.5) });
    veil.style.background = '#ffffff';
    veil.style.opacity = Math.max((1 - ease.out(prog(t, 107.2, 107.6))), ease.inOut(prog(t, 109.6, 110.3)) * 0.96).toFixed(3);
    show(endCard, { x: 960, y: 540, o: fade(t, 109.9, 0.6), s: 0.98 + 0.02 * fade(t, 109.9, 0.8), z: 20 });
  });

  // ------------------------------------------------------------------ the frame
  // the crew photo for the thank-you, rendered once from the 3D set into the message
  function snapCrew() {
    crewPhoto.group.visible = true;
    T.group.visible = false;
    pose(crewPhoto.crew[2], { wave: 0.8, t: 0.2 });
    S.setNight(0, crewPhoto.group.position.clone(), 8);
    const g = crewPhoto.group.position;
    setCam([g.x + 0.1, g.y + 1.45, g.z + 6.4], [g.x, g.y + 0.95, g.z], 24);
    S.scene.background = new THREE.Color('#d5e7ff');
    S.render();
    const url = canvas.toDataURL('image/jpeg', 0.92);
    S.scene.background = null;
    crewPhoto.group.visible = false;
    T.group.visible = true;
    ph.photo.style.backgroundImage = `url(${url})`;
  }
  snapCrew();

  function update(t) {
    frame++;
    beamN = 0; glowN = 0; ringN = 0;
    T.group.visible = true;
    S.state.split = null;
    rest(t);
    let cur = shots[0];
    for (const sh of shots) if (t >= sh.t0) cur = sh;
    cur.fn(t);
    for (const el of all) if (el._f !== frame) el.style.opacity = '0';
    for (let i = beamN; i < beamPool.length; i++) beamPool[i].style.display = 'none';
    S.render();
    return cur.name;
  }
  // tell the layout cache about the final fonts
  for (const el of all) { el._w = null; }
  return { update, duration: timings.duration, shots: shots.map((x) => [x.t0, x.name]) };
}
