// Small numeric toolkit shared by the rig, the profile evaluator and the GUI.

export const TAU = Math.PI * 2;

export const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);
export const lerp = (a, b, t) => a + (b - a) * t;
export const invLerp = (a, b, x) => (b === a ? 0 : (x - a) / (b - a));

export function smoothstep(edge0, edge1, x) {
  const t = clamp(invLerp(edge0, edge1, x), 0, 1);
  return t * t * (3 - 2 * t);
}

/**
 * C-infinity approximation of max() for non-negative arguments. Used to graft the
 * caudal peduncle floor onto the body silhouette without leaving a visible crease
 * where the two curves cross.
 */
export function smoothMax(a, b, k = 8) {
  if (a <= 0) return b;
  if (b <= 0) return a;
  return Math.pow(Math.pow(a, k) + Math.pow(b, k), 1 / k);
}

/**
 * Signed superellipse basis: se(t, n) traces |y/H|^n + |z/W|^n = 1 when fed
 * cos/sin of the ring angle. n = 2 is a plain ellipse; large n squares off the
 * cross-section, which is how a boxfish gets its carapace.
 */
export function se(t, n) {
  const e = 2 / n;
  const a = Math.abs(t);
  return (t < 0 ? -1 : 1) * Math.pow(a, e);
}

/**
 * Normalised beta-style bump on [0,1]: peaks at `girth`, vanishes at both ends.
 * `blunt` controls how rounded the leading end is (0.5 gives a sqrt-like, rounded
 * snout; 2.0 gives a sharp streamlined point). The trailing exponent is derived so
 * that the peak lands exactly on `girth`.
 */
export function betaBump(s, girth, blunt) {
  if (s <= 0 || s >= 1) return 0;
  const g = clamp(girth, 0.02, 0.98);
  const a = Math.max(blunt, 0.02);
  const b = (a * (1 - g)) / g;
  const peak = Math.pow(g, a) * Math.pow(1 - g, b);
  return (Math.pow(s, a) * Math.pow(1 - s, b)) / peak;
}

/** Monotone-ish evaluation of a polyline of [x, y] control points. */
export function curveAt(points, x) {
  const n = points.length;
  if (n === 0) return 0;
  if (x <= points[0][0]) return points[0][1];
  if (x >= points[n - 1][0]) return points[n - 1][1];
  for (let i = 0; i < n - 1; i++) {
    const [x0, y0] = points[i];
    const [x1, y1] = points[i + 1];
    if (x <= x1) {
      const t = smoothstep(x0, x1, x);
      return lerp(y0, y1, t);
    }
  }
  return points[n - 1][1];
}

/** Deterministic hash -> [0,1). Keeps every run reproducible from a seed. */
export function hash1(n) {
  const s = Math.sin(n * 127.1) * 43758.5453;
  return s - Math.floor(s);
}

export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Recursively blend two parameter trees. Numbers lerp, everything else snaps at t>=0.5. */
export function lerpTree(a, b, t) {
  if (typeof a === 'number' && typeof b === 'number') return lerp(a, b, t);
  if (Array.isArray(a) && Array.isArray(b)) {
    // Arrays of the same length blend elementwise; otherwise snap.
    if (a.length !== b.length) return t < 0.5 ? clone(a) : clone(b);
    return a.map((v, i) => lerpTree(v, b[i], t));
  }
  if (a && b && typeof a === 'object' && typeof b === 'object') {
    const out = {};
    const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
    for (const k of keys) {
      if (!(k in a)) out[k] = clone(b[k]);
      else if (!(k in b)) out[k] = clone(a[k]);
      else out[k] = lerpTree(a[k], b[k], t);
    }
    return out;
  }
  return t < 0.5 ? clone(a) : clone(b);
}

export function clone(v) {
  if (Array.isArray(v)) return v.map(clone);
  if (v && typeof v === 'object') {
    const o = {};
    for (const k of Object.keys(v)) o[k] = clone(v[k]);
    return o;
  }
  return v;
}

/** Blend hex colours in linear-ish space; good enough for palette morphing. */
export function lerpHex(a, b, t) {
  const ar = (a >> 16) & 255, ag = (a >> 8) & 255, ab = a & 255;
  const br = (b >> 16) & 255, bg = (b >> 8) & 255, bb = b & 255;
  const r = Math.round(lerp(ar * ar, br * br, t) ** 0.5);
  const g = Math.round(lerp(ag * ag, bg * bg, t) ** 0.5);
  const bl = Math.round(lerp(ab * ab, bb * bb, t) ** 0.5);
  return (r << 16) | (g << 8) | bl;
}
