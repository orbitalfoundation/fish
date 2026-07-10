import { betaBump, smoothMax, smoothstep, lerp, clamp } from '../core/math.js';

/**
 * The rest-pose silhouette of a body, evaluated from parameters. This is the
 * straight, un-animated fish: the swim rig bends it, the geometry builder wraps
 * skin around it, and the fin placer reads heights off it. Keeping it a pure
 * function of `s` (and free of any THREE types) means it runs the same in the
 * geometry baker and in a Node smoke test.
 *
 * Axis convention (see core/params.js): +X headward, snout at +L/2; s in [0,1]
 * runs snout->tail; +Y dorsal; +Z the left flank.
 */
export class Profile {
  constructor(params) {
    this.p = params;
    this.L = params.scale;
    const b = params.body;
    this.b = b;
    // Average girth/blunt used for the width envelope and superellipse blend.
    this._girth = 0.5 * (b.dorsal.girth + b.ventral.girth);
    this._blunt = 0.5 * (b.dorsal.blunt + b.ventral.blunt);
    // Radius of the inflated sphere target, in BL.
    this._sphereR = 0.46;
  }

  /** world X for a normalised body coordinate. */
  xAt(s) {
    return this.L * (0.5 - s);
  }

  /** Dorsal (up) and ventral (down) half-depths in BL, before inflation. */
  _rawUp(s) {
    return this.b.dorsal.peak * betaBump(s, this.b.dorsal.girth, this.b.dorsal.blunt);
  }
  _rawDown(s) {
    return this.b.ventral.peak * betaBump(s, this.b.ventral.girth, this.b.ventral.blunt);
  }

  /** Caudal-peduncle floor: a nonzero minimum depth that only exists in the rear
   *  so the body tapers to a stalk (not a needle) where the tail attaches. */
  _pedFloor(s) {
    return this.b.peduncle * smoothstep(0.42, 0.82, s);
  }

  /** Snout floor: a rounded, nonzero radius near the head so the face isn't a
   *  needle point. `snout` = 0 keeps a sharp snout (eel); ~0.5 gives a blunt,
   *  rounded head (pufferfish, boxfish). Fades out by s = 0.14. */
  _headFloor(s) {
    const avg = 0.5 * (this.b.dorsal.peak + this.b.ventral.peak);
    return (this.b.snout || 0) * avg * smoothstep(0.14, 0.0, s);
  }

  /** Melon / forehead: a rounded bulge on the head. Drives an orca's or dolphin's
   *  bulbous melon and an angelfish's steep brow. A gaussian centred at `melonPos`
   *  added mostly to the dorsal profile, with some to the flanks and belly so the
   *  whole head reads as a rounded mass rather than a fin-like ridge. */
  _melon(s) {
    const m = this.b.melon || 0;
    if (m <= 0) return 0;
    const mu = this.b.melonPos ?? 0.12;
    const w = this.b.melonWidth ?? 0.07;
    const t = (s - mu) / w;
    return m * this.b.dorsal.peak * Math.exp(-t * t);
  }

  /** Returns {up, down, half, width} half-extents in BL at body coordinate s. */
  extents(s) {
    const ped = this._pedFloor(s);
    const headEnds = smoothMax(ped, this._headFloor(s), 6);
    const mel = this._melon(s);
    let up = smoothMax(this._rawUp(s) + mel, headEnds, 6);
    let down = smoothMax(this._rawDown(s) + mel * 0.35, headEnds, 6);

    // Girth envelope for width: fattest at mid-body, tapering both ways.
    const g = betaBump(s, this._girth, this._blunt);
    const depthAvg = 0.5 * (up + down);

    // Width tracks depth via widthRatio, then head-widening and peduncle-squeeze.
    const headWide = lerp(this.b.headWide, 1.0, smoothstep(0.0, 0.22, s));
    const pedSqueeze = lerp(1.0, this.b.pedNarrow, smoothstep(0.6, 0.95, s));
    let width = this.b.widthRatio * (0.6 * depthAvg + 0.4 * this._sphereR * this.b.dorsal.peak * 3.0 * g);
    width += mel * 0.5; // the melon rounds the head in width too
    width *= headWide * pedSqueeze;
    width = smoothMax(width, headEnds * this.b.widthRatio, 6);

    // Inflation blends every extent toward a common spherical radius.
    const inflate = this.b.inflate || 0;
    if (inflate > 0) {
      const sph = this._sphereR * Math.sqrt(Math.max(0, 1 - (2 * s - 1) ** 2));
      up = lerp(up, sph, inflate);
      down = lerp(down, sph, inflate);
      width = lerp(width, sph, inflate);
    }

    return { up, down, half: 0.5 * (up + down), width };
  }

  /** Superellipse exponent, relaxed toward a plain ellipse under inflation. */
  boxiness(s) {
    const inflate = this.b.inflate || 0;
    return lerp(this.b.boxiness, 2.0, clamp(inflate * 1.3, 0, 1));
  }

  /** Dorsal/ventral silhouette midline offset (fish bodies aren't centred on the
   *  spine: the belly bulges below the vertebral line). Returns the Y of the
   *  cross-section centre in BL. */
  midY(s) {
    const e = this.extents(s);
    return 0.5 * (e.up - e.down) * 0.35;
  }
}
