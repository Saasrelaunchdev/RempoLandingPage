// Time helpers. Every frame is a pure function of t (seconds), so any frame renders the same way twice and the
// render can jump to any frame or split the work across browsers.

export const clamp = (v, a = 0, b = 1) => Math.min(b, Math.max(a, v));
export const lerp = (a, b, k) => a + (b - a) * k;
export const prog = (t, a, b) => (b <= a ? (t >= a ? 1 : 0) : clamp((t - a) / (b - a)));

export const ease = {
  linear: (k) => k,
  in: (k) => k * k * k,
  out: (k) => 1 - Math.pow(1 - k, 3),
  inOut: (k) => (k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2),
  outQuint: (k) => 1 - Math.pow(1 - k, 5),
  inOutSine: (k) => -(Math.cos(Math.PI * k) - 1) / 2,
  outBack: (k) => { const c1 = 1.70158, c3 = c1 + 1; return 1 + c3 * Math.pow(k - 1, 3) + c1 * Math.pow(k - 1, 2); },
  outBackSoft: (k) => { const c1 = 0.9, c3 = c1 + 1; return 1 + c3 * Math.pow(k - 1, 3) + c1 * Math.pow(k - 1, 2); },
  outElastic: (k) => (k === 0 || k === 1 ? k : Math.pow(2, -10 * k) * Math.sin((k * 10 - 0.75) * (2 * Math.PI) / 3) + 1),
};

// tween(t, a, b, from, to, easeFn): from at t<=a, to at t>=b
export function tween(t, a, b, from, to, e = ease.inOut) {
  const k = e(prog(t, a, b));
  if (Array.isArray(from)) return from.map((f, i) => lerp(f, to[i], k));
  return lerp(from, to, k);
}

// Keyframes: [[t, value, easeName?], ...]; the ease of a key shapes the segment that ends on it.
export function keys(t, list) {
  if (t <= list[0][0]) return list[0][1];
  for (let i = 1; i < list.length; i++) {
    const [t1, v1, e] = list[i];
    if (t <= t1) {
      const [t0, v0] = list[i - 1];
      const fn = typeof e === 'function' ? e : ease[e || 'inOut'];
      const k = fn(prog(t, t0, t1));
      if (Array.isArray(v0)) return v0.map((x, j) => lerp(x, v1[j], k));
      return lerp(v0, v1, k);
    }
  }
  return list[list.length - 1][1];
}

// In and out: 0 before a, rises over `rin`, holds, falls over `rout` ending at b.
export function inOut(t, a, b, rin = 0.35, rout = 0.35) {
  if (t < a || t > b) return 0;
  return Math.min(ease.out(prog(t, a, a + rin)), 1 - ease.in(prog(t, b - rout, b)));
}

// A small deterministic random generator, so scatter layouts are the same on every frame and every run.
export function rng(seed = 7) {
  let s = seed >>> 0 || 1;
  return () => { s = (s * 16807) % 2147483647; return (s - 1) / 2147483646; };
}

// A point along a polyline of [x, z] points, k in 0..1 by length; returns [x, z, headingRadians].
export function along(points, k) {
  const seg = [];
  let total = 0;
  for (let i = 1; i < points.length; i++) {
    const d = Math.hypot(points[i][0] - points[i - 1][0], points[i][1] - points[i - 1][1]);
    seg.push(d); total += d;
  }
  let dist = clamp(k) * total;
  for (let i = 0; i < seg.length; i++) {
    if (dist <= seg[i] || i === seg.length - 1) {
      const a = points[i], b = points[i + 1], f = seg[i] ? dist / seg[i] : 0;
      return [lerp(a[0], b[0], f), lerp(a[1], b[1], f), Math.atan2(b[0] - a[0], b[1] - a[1])];
    }
    dist -= seg[i];
  }
  const n = points.length;
  return [points[n - 1][0], points[n - 1][1], 0];
}
