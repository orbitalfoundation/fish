import { clone, lerpTree, smoothMax, smoothstep } from './math.js';

/**
 * ============================================================================
 *  THE FISH PARAMETER SPACE
 * ============================================================================
 *
 *  Everything about an animal here is a number. Species are just points in this
 *  space, and you can walk a straight line between any two of them (see
 *  `morphParams`). That is the whole design premise: a minnow, a boxfish and a
 *  blue whale are the same rig with different coordinates.
 *
 *  UNITS AND CONVENTIONS
 *  --------------------
 *  - Body axis runs along +X. The snout is at x = +L/2, the tail tip at -L/2.
 *  - `s` is the normalised body coordinate: s = 0 at the snout, s = 1 at the tail tip.
 *  - +Y is dorsal (up), +Z is the animal's left flank.
 *  - Lengths marked "BL" are fractions of total body length, so the whole rig is
 *    scale-invariant and `scale` is the only thing carrying metres.
 *
 *  AMPLITUDES ARE PEAK-TO-PEAK
 *  ---------------------------
 *  The swim envelope below is quoted in *peak-to-peak* body lengths, matching
 *  Di Santo et al. 2021. Lateral displacement is half of it. This matters: the
 *  classic "tail beat is 0.2 BL" figure is peak-to-peak, and getting this wrong
 *  gives you a fish that swims like it is having a seizure.
 */

/**
 * Amplitude envelope A(s), peak-to-peak, in body lengths.
 *
 * Default coefficients are the 44-species empirical fit from
 *   Di Santo, Goerig, Wainwright, Akanyeti, Liao, Castro-Santos & Lauder (2021),
 *   "Convergence of undulatory swimming kinematics across a diversity of fishes",
 *   PNAS 118(49):e2113206118.
 *
 *   A(s) = 0.05 - 0.13 s + 0.28 s^2
 *
 * Note the negative linear term. It puts a minimum ("node", the recoil pivot) at
 * s = 0.13/(2*0.28) = 0.232, which is where real fish pivot. The head does not sit
 * still: it sways ~0.03-0.05 BL in counter-phase. That falls out of the wave for
 * free and should not be faked with a special-case counter-rotation.
 */
export function envelopeAt(env, s) {
  const base = env.c0 + env.c1 * s + env.c2 * s * s;

  // `stiffness` suppresses anterior bending, sliding carangiform -> thunniform.
  // At stiffness = 1 the body only bends aft of `stiffStart`.
  const stiffened = base * smoothstep(env.stiffStart, 1.0, s);
  let a = base + (stiffened - base) * env.stiffness;

  // ...but snout yaw is conserved across modes (Di Santo 2021: ~2-5% BL even on a
  // sleek tuna), so graft a head-sway floor back on rather than letting the
  // stiffening zero it out. smoothMax keeps the join C-infinity.
  const headFloor = env.headYaw * (1 - smoothstep(0.0, 0.28, s));
  a = smoothMax(Math.max(a, 0), Math.max(headFloor, 0), 6);

  return a * env.gain;
}

/** d/ds of envelopeAt, by central difference. Cheap, and the curve is smooth. */
export function envelopeSlope(env, s, h = 1e-3) {
  return (envelopeAt(env, s + h) - envelopeAt(env, s - h)) / (2 * h);
}

/**
 * Tail-beat frequency from swimming speed via the Strouhal number.
 *
 *   St = f * A_pp / U
 *
 * where A_pp is peak-to-peak tail excursion. Animals from tuna to dolphins to
 * bats cluster in St = 0.2-0.4 (Taylor, Nudds & Thomas 2003, Nature 425:707),
 * with the hydrodynamic thrust optimum at 0.25-0.35 (Triantafyllou et al. 1993).
 * Odontocetes sit slightly lower, peaking at 0.225-0.275 (Rohr & Fish 2004).
 *
 * Driving frequency from (speed, Strouhal) rather than typing in a Hz number is
 * what keeps a whale from flapping like a guppy when you drag the size slider.
 */
export function frequencyFromStrouhal(swim) {
  const tailAmpPP = Math.max(envelopeAt(swim.envelope, 1.0), 1e-4);
  return (swim.strouhal * swim.speedBL) / tailAmpPP;
}

export function defaultEnvelope() {
  return {
    c0: 0.05,
    c1: -0.13,
    c2: 0.28,
    gain: 1.0,
    stiffness: 0.0,
    stiffStart: 0.35,
    headYaw: 0.04, // peak-to-peak BL of snout sway
  };
}

export function defaultParams() {
  return {
    id: 'perciform',
    displayName: 'Generic Perciform',
    scale: 1.0, // total body length in world units (metres)

    body: {
      sections: 140, // geometry rings along the body
      radial: 30, // vertices around each ring

      // Dorsal and ventral silhouettes are independent curves. This is the single
      // biggest win for shape fidelity: a fish's back and belly are not mirrored.
      // `peak` is half-depth in BL, `girth` is where it peaks, `blunt` is the
      // leading-edge exponent (0.5 = rounded snout, 2.0 = sharp point).
      dorsal: { peak: 0.115, girth: 0.34, blunt: 0.62 },
      ventral: { peak: 0.105, girth: 0.44, blunt: 0.78 },

      peduncle: 0.022, // minimum half-depth at the tail stalk, BL
      widthRatio: 0.5, // width / depth. Compression axis: angelfish ~0.18, puffer ~0.95
      pedNarrow: 0.55, // extra lateral squeeze of the caudal peduncle
      headWide: 1.1, // width multiplier at the snout (skulls are round)
      boxiness: 2.15, // superellipse exponent: 2 = ellipse, 6+ = boxfish carapace
      inflate: 0.0, // pufferfish: blends the whole profile toward a sphere
    },

    spine: { joints: 28 },

    swim: {
      // 0 = lateral undulation (fish). 1 = dorsoventral (cetacean).
      // This one number simultaneously rotates the spinal bending axis AND rolls
      // the caudal fin from a vertical tail to a horizontal fluke.
      plane: 0.0,

      speedBL: 1.6, // body lengths per second
      strouhal: 0.3, // f * A_pp / U
      freqOverride: 0, // > 0 pins frequency in Hz and ignores Strouhal

      // Waves present on the body at once (= L / lambda).
      // Di Santo 2021 medians: anguilliform 1.33, subcarangiform 1.08,
      // carangiform 1.00, thunniform 0.88, ostraciiform 0 (pure oscillation).
      waves: 1.0,

      envelope: defaultEnvelope(),

      turn: 0.0, // steady curvature bias, radians across the whole body
      roll: 0.0, // bank angle, radians
      idle: 0.35, // slow secondary drift (breathing, hovering)
      recoil: 1.0, // 1 = hold the recoil pivot still (fish swims "in place")
    },

    fins: [],

    /**
     * PATTERN — a Gray-Scott reaction-diffusion field.
     *
     *   dU/dt = Du*lap(U) - U*V^2 + F*(1-U)
     *   dV/dt = Dv*lap(V) + U*V^2 - (F+k)*V
     *
     * Du:Dv = 2:1 (Karl Sims / Pearson 1993). V is the slow-diffusing activator
     * and is what we read as the melanophore mask.
     *
     * `anisotropy` scales diffusion along the body axis relative to around it.
     * Shoji, Iwasa & Kondo 2002 (J. Theor. Biol. 214:549): boosting diffusion
     * along an axis SUPPRESSES variation along it, so stripes run PARALLEL to the
     * high-diffusion axis. Hence:
     *    anisotropy > 1  -> diffusion along body -> horizontal STRIPES (zebrafish)
     *    anisotropy < 1  -> diffusion around body -> vertical BARS (angelfish)
     * Keep the ratio in 2-4x; past that Shoji shows it flips to perpendicular.
     */
    pattern: {
      enabled: true,
      width: 384,
      height: 192,
      feed: 0.037, // F
      kill: 0.06, // k
      du: 1.0,
      dv: 0.5,
      dt: 1.0,
      anisotropy: 1.0,
      seed: 7,
      seedMode: 'blobs', // 'blobs' | 'bands' | 'bars'
      stepsPerFrame: 12,
      live: true,
      settleSteps: 2200, // burn-in before first frame is shown
      contrast: 0.5,
      threshold: 0.22,
      softness: 0.09,
      scaleU: 1.0, // tile the field along the body
      scaleV: 1.0,
    },

    /**
     * SURFACE — a layered chromatophore stack, bottom to top:
     *   melanophore  dark structural pattern (RD-driven)
     *   xanthophore  bright pigment (yellow -> red ramp)
     *   leucophore   matte white (belly, bars)
     *   iridophore   guanine platelet thin-film: structural, view-dependent
     * plus a clearcoat standing in for the mucus layer every fish is wrapped in.
     */
    surface: {
      dorsalColor: 0x2c4a63,
      flankColor: 0x7b96a8,
      bellyColor: 0xe8eef2,
      patternColor: 0x101820,
      xanthoColor: 0xe8a02a,
      xantho: 0.0, // strength of the bright pigment layer

      countershade: 0.85, // dark back / pale belly (Thayer's law) - near-universal
      countershadeSharp: 0.55,

      lateralLine: 0.35, // the sensory-line stripe, very common and very cheap
      lateralLineWidth: 0.02,
      lateralLineColor: 0x0f1a24,

      iridescence: 0.55, // thin-film strength (three's KHR_materials_iridescence)
      iridescenceIOR: 1.32,
      iridThicknessMin: 180,
      iridThicknessMax: 520,
      iridFlank: 0.8, // concentrate iridophores on the flanks, not the back
      iridOnPattern: -0.6, // negative: dark melanophore bars suppress iridescence

      clearcoat: 1.0, // mucus
      clearcoatRoughness: 0.06,
      roughness: 0.42,
      roughnessPattern: 0.18, // dark scales read slightly rougher
      metalness: 0.0,

      scaleDensity: 46.0, // scale rows along the body
      scaleDepth: 0.35, // normal-map strength
      scaleAspect: 1.6,

      sss: 0.5, // cheap wrapped-diffuse translucency
      sssColor: 0xd9573c,

      finTransmission: 0.72,
      finRoughness: 0.32,
      finAnisotropy: 0.65, // highlights stretch along the fin rays
      finTint: 0xb9cdd8,
      finOpacity: 0.9,
      finRayContrast: 0.45,
    },

    eyes: {
      enabled: true,
      s: 0.115, // position along the body
      height: 0.28, // fraction of local half-depth, above midline
      radius: 0.028, // BL
      irisColor: 0x0a0a0c,
      scleraColor: 0xd8c98a,
      ring: 0.35,
    },
  };
}

/** Blend two full parameter trees. Fin arrays only blend when they line up by id. */
export function morphParams(a, b, t) {
  const out = lerpTree(stripFins(a), stripFins(b), t);
  out.fins = morphFins(a.fins, b.fins, t);
  out.id = t < 0.5 ? a.id : b.id;
  out.displayName = t <= 0 ? a.displayName : t >= 1 ? b.displayName : `${a.displayName} ↔ ${b.displayName}`;
  return out;
}

function stripFins(p) {
  const c = clone(p);
  delete c.fins;
  return c;
}

/**
 * Fins morph by matching `id`. A fin present in only one parent fades its size to
 * zero rather than popping, which is how a boxfish's tiny anal fin can grow into
 * an angelfish's sail without the topology changing.
 */
function morphFins(fa, fb, t) {
  const ids = [];
  for (const f of fa) if (!ids.includes(f.id)) ids.push(f.id);
  for (const f of fb) if (!ids.includes(f.id)) ids.push(f.id);

  const out = [];
  for (const id of ids) {
    const A = fa.find((f) => f.id === id);
    const B = fb.find((f) => f.id === id);
    if (A && B) {
      out.push(lerpTree(A, B, t));
    } else if (A) {
      const g = clone(A);
      g.height *= 1 - t;
      if (g.chord !== undefined) g.chord *= 1 - t;
      if (g.span !== undefined) g.span *= 1 - t;
      out.push(g);
    } else {
      const g = clone(B);
      g.height *= t;
      if (g.chord !== undefined) g.chord *= t;
      if (g.span !== undefined) g.span *= t;
      out.push(g);
    }
  }
  return out.filter((f) => f.height > 1e-4 || f.kind === 'caudal');
}

/** Gray-Scott presets. F/k from Pearson 1993 classes and Karl Sims' catalogue. */
export const RD_PRESETS = {
  spots: { feed: 0.03, kill: 0.062 },
  mitosis: { feed: 0.0367, kill: 0.0649 },
  labyrinth: { feed: 0.055, kill: 0.062 },
  hedgerows: { feed: 0.05, kill: 0.063 }, // Pearson kappa - branching mazes
  worms: { feed: 0.046, kill: 0.063 }, // Pearson mu - parallel worm stripes
  holes: { feed: 0.039, kill: 0.058 },
  solitons: { feed: 0.026, kill: 0.061 }, // Pearson lambda
  coral: { feed: 0.0545, kill: 0.062 },
  uniform: { feed: 0.014, kill: 0.057 },
};

/** BCF locomotion modes: wavelength + envelope shape. Everything else is shared. */
export const SWIM_MODES = {
  anguilliform: {
    waves: 1.33, // lambda ~ 0.75 L
    envelope: { c0: 0.02, c1: 0.02, c2: 0.22, stiffness: 0.0, stiffStart: 0.2, headYaw: 0.03 },
  },
  subcarangiform: {
    waves: 1.08, // lambda ~ 0.93 L
    envelope: { c0: 0.05, c1: -0.12, c2: 0.31, stiffness: 0.2, stiffStart: 0.3, headYaw: 0.04 },
  },
  carangiform: {
    waves: 1.0, // lambda ~ 1.00 L
    envelope: { c0: 0.05, c1: -0.13, c2: 0.28, stiffness: 0.35, stiffStart: 0.38, headYaw: 0.04 },
  },
  thunniform: {
    waves: 0.88, // lambda ~ 1.14 L
    envelope: { c0: 0.04, c1: -0.13, c2: 0.29, stiffness: 0.8, stiffStart: 0.6, headYaw: 0.03 },
  },
  ostraciiform: {
    // Rigid carapace. The body wave is essentially zero; all thrust is a pendulum
    // swing of the caudal fin about the peduncle, plus median-fin rowing.
    waves: 0.2,
    envelope: { c0: 0.004, c1: 0.0, c2: 0.02, stiffness: 1.0, stiffStart: 0.9, headYaw: 0.006 },
  },
};

export function applySwimMode(params, mode) {
  const m = SWIM_MODES[mode];
  if (!m) return params;
  params.swim.waves = m.waves;
  Object.assign(params.swim.envelope, m.envelope);
  return params;
}
