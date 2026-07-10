import { defaultParams, applySwimMode, RD_PRESETS } from '../core/params.js';
import { clone } from '../core/math.js';

/**
 * ============================================================================
 *  SPECIES PRESETS
 * ============================================================================
 *
 *  Each preset is a point in the parameter space defined by core/params.js.
 *  Positions along the body are normalised: s = 0 at the snout, s = 1 at the
 *  tail tip. Depths and fin heights are in body lengths.
 *
 *  Anatomy sourced from Helfman et al. "The Diversity of Fishes", FishBase,
 *  the AFS Fishionary, and (for cetaceans) Fish 1998 / Fish & Rohr 1999.
 *  Where a number is a considered default rather than a measured constant it is
 *  flagged. Treat these as good starting coordinates, not gospel.
 *
 *  FIN GRAMMAR
 *  -----------
 *  kind: 'ridge'   median fin with a base spanning [s0,s1] on the dorsal or
 *                  ventral midline. Rays rise from the base; the outline is the
 *                  envelope of the ray tips.
 *        'paired'  pectoral / pelvic. A fan of rays from a single flank socket.
 *        'caudal'  the tail. Rays fan across the span; ray length is C(v).
 *        'finlets' the little fixed triangles behind a tuna's second dorsal.
 *
 *  motion:
 *    curlGain    how hard the membrane trails under drag. The flex is driven by
 *                the socket's angular VELOCITY, which is inherently a quarter-
 *                cycle behind its displacement -- matching the measured 21-28%
 *                dorsal/anal phase lag (Standen & Lauder 2007) for free.
 *    rigidPitch  0 = the fin curls into an arc; 1 = it pitches as a rigid plate
 *                about its base. Cetacean flukes sit around 0.6: mostly a rigid
 *                pitching hydrofoil, with some chordwise flex.
 *    swingAmp    active oscillation (radians). This is what propels an
 *                ostraciiform boxfish, whose body cannot bend at all.
 *    freqMul     beat frequency relative to the tail beat.
 *    spineFrac   leading fraction of rays that are stiff spines and do not bend.
 */

const ray = (n) => n;

// ---------------------------------------------------------------------------
// Fin outline shapes: [u, lengthFraction] across the fin base, u = 0 anterior.
// ---------------------------------------------------------------------------
const OUTLINE = {
  softDorsal: [[0, 0.30], [0.22, 0.95], [0.6, 1.0], [0.88, 0.72], [1, 0.22]],
  spinyDorsal: [[0, 0.35], [0.18, 1.0], [0.7, 0.78], [1, 0.30]],
  sailDorsal: [[0, 0.18], [0.3, 0.55], [0.7, 0.9], [0.9, 1.0], [1, 0.45]],
  lowRidge: [[0, 0.2], [0.35, 1.0], [0.75, 0.95], [1, 0.25]],
  fringe: [[0, 0.55], [0.15, 1.0], [0.9, 1.0], [1, 0.5]],
  anal: [[0, 0.35], [0.25, 1.0], [0.7, 0.8], [1, 0.25]],
  pectoralFan: [[0, 0.45], [0.35, 1.0], [0.75, 0.9], [1, 0.4]],
  wing: [[0, 0.35], [0.2, 1.0], [0.55, 0.85], [1, 0.15]],
  paddle: [[0, 0.55], [0.4, 1.0], [0.8, 0.92], [1, 0.55]],
  filament: [[0, 0.9], [0.5, 1.0], [1, 0.6]],
  keel: [[0, 0.1], [0.35, 0.95], [0.62, 1.0], [1, 0.12]],
};

// Sensible motion defaults per fin role.
const M = {
  medianStabiliser: { curlGain: 0.9, rigidPitch: 0.1, curlExp: 1.4, swingAmp: 0.0, swingPhase: 0, freqMul: 1 },
  medianPropulsor: { curlGain: 0.5, rigidPitch: 0.15, curlExp: 1.2, swingAmp: 0.42, swingPhase: 0, freqMul: 3.0 },
  caudalFish: { curlGain: 1.15, rigidPitch: 0.25, curlExp: 1.1, swingAmp: 0.0, swingPhase: 0, freqMul: 1 },
  caudalPendulum: { curlGain: 0.3, rigidPitch: 0.8, curlExp: 1.0, swingAmp: 0.5, swingPhase: 0, freqMul: 1 },
  fluke: { curlGain: 0.95, rigidPitch: 0.6, curlExp: 1.0, swingAmp: 0.0, swingPhase: 0, freqMul: 1 },
  pectoralGlide: { curlGain: 0.5, rigidPitch: 0.35, curlExp: 1.3, swingAmp: 0.06, swingPhase: 0.6, freqMul: 0.5 },
  pectoralRow: { curlGain: 0.35, rigidPitch: 0.3, curlExp: 1.3, swingAmp: 0.42, swingPhase: 0.0, freqMul: 2.2 },
  flipper: { curlGain: 0.25, rigidPitch: 0.7, curlExp: 1.0, swingAmp: 0.05, swingPhase: 0.4, freqMul: 0.5 },
  pelvic: { curlGain: 0.8, rigidPitch: 0.2, curlExp: 1.4, swingAmp: 0.09, swingPhase: 1.2, freqMul: 1.0 },
  streamer: { curlGain: 1.9, rigidPitch: 0.05, curlExp: 1.8, swingAmp: 0.05, swingPhase: 0.9, freqMul: 0.7 },
};

/** Caudal fin outline. C(v) = chord * [(fork + (1-fork)|v|^forkExp)(1-round) + round*sqrt(1-v^2)]
 *  fork=1,round=0 -> truncate.  round=1 -> rounded.  fork~0.35 -> forked.
 *  fork~0.12 with a big span/chord ratio -> lunate (aspect ratio 5-10, thunniform). */
const CAUDAL = {
  rounded: { chord: 0.10, span: 0.085, fork: 1.0, forkExp: 1.5, roundness: 1.0 },
  truncate: { chord: 0.11, span: 0.11, fork: 1.0, forkExp: 1.5, roundness: 0.1 },
  emarginate: { chord: 0.105, span: 0.115, fork: 0.72, forkExp: 1.8, roundness: 0.15 },
  forked: { chord: 0.115, span: 0.135, fork: 0.38, forkExp: 1.6, roundness: 0.05 },
  lunate: { chord: 0.075, span: 0.155, fork: 0.14, forkExp: 0.95, roundness: 0.0 },
  fluke: { chord: 0.062, span: 0.10, fork: 0.34, forkExp: 1.25, roundness: 0.18 },
  pointed: { chord: 0.025, span: 0.028, fork: 1.0, forkExp: 1.5, roundness: 1.0 },
};

function caudal(shape, over = {}) {
  return {
    id: 'caudal',
    kind: 'caudal',
    anchor: 'tail',
    s0: 0.965,
    rays: ray(19), // teleosts run ~17-19 principal caudal rays
    bones: 4,
    spineFrac: 0.0,
    rayVisibility: 0.6,
    height: CAUDAL[shape].chord,
    asymmetry: 0.0,
    motion: clone(M.caudalFish),
    ...CAUDAL[shape],
    ...over,
  };
}

function ridge(id, anchor, s0, s1, height, over = {}) {
  return {
    id,
    kind: 'ridge',
    anchor, // 'dorsal' | 'ventral'
    s0,
    s1,
    height,
    rays: ray(16),
    bones: 3,
    spineFrac: 0.35,
    rayVisibility: 0.55,
    outline: OUTLINE.softDorsal,
    motion: clone(M.medianStabiliser),
    ...over,
  };
}

function paired(id, s0, heightFrac, height, over = {}) {
  return {
    id,
    kind: 'paired',
    anchor: 'flank',
    s0,
    heightFrac, // -1 ventral .. +1 dorsal, position on the flank
    height,
    chord: 0.06, // angular half-sweep of the ray fan, as a chord length
    fanDeg: [-42, 42],
    aimDeg: [0, -18, 0], // pitch (nose-up), yaw (sweep back), roll
    rays: ray(14),
    bones: 3,
    spineFrac: 0.12,
    rayVisibility: 0.5,
    outline: OUTLINE.pectoralFan,
    motion: clone(M.pectoralGlide),
    ...over,
  };
}

// ===========================================================================
//  MINNOW  -- Cyprinidae. The ancestral, generic layout: single soft dorsal set
//  at mid-body, pelvic fins ABDOMINAL (not thoracic), forked tail.
//  Subcarangiform: the posterior half undulates.
// ===========================================================================
function minnow() {
  const p = defaultParams();
  p.id = 'minnow';
  p.displayName = 'Minnow';
  p.scale = 0.07; // 7 cm
  Object.assign(p.body, {
    dorsal: { peak: 0.112, girth: 0.40, blunt: 0.62 },
    ventral: { peak: 0.098, girth: 0.46, blunt: 0.8 },
    peduncle: 0.024,
    widthRatio: 0.56,
    pedNarrow: 0.5,
    headWide: 1.12,
    boxiness: 2.1,
  });
  applySwimMode(p, 'subcarangiform');
  Object.assign(p.swim, { speedBL: 3.0, strouhal: 0.32, plane: 0 });
  p.fins = [
    ridge('dorsal1', 'dorsal', 0.44, 0.60, 0.085, { outline: OUTLINE.softDorsal, spineFrac: 0.15 }),
    ridge('anal', 'ventral', 0.62, 0.73, 0.062, { outline: OUTLINE.anal, spineFrac: 0.1 }),
    paired('pectoral', 0.21, -0.2, 0.075, { motion: clone(M.pectoralGlide) }),
    paired('pelvic', 0.46, -0.86, 0.055, { rays: 7, motion: clone(M.pelvic), aimDeg: [0, -14, -12] }),
    caudal('forked'),
  ];
  Object.assign(p.surface, {
    dorsalColor: 0x3d4a3a,
    flankColor: 0xa9b0a3,
    bellyColor: 0xf0efe6,
    patternColor: 0x2b3230,
    countershade: 0.9,
    iridescence: 0.7,
    iridFlank: 0.9,
    lateralLine: 0.5,
    scaleDensity: 60,
  });
  Object.assign(p.pattern, RD_PRESETS.worms, { anisotropy: 3.0, scaleU: 1.2, contrast: 0.35 });
  return p;
}

// ===========================================================================
//  TUNA -- Thunnus. Thunniform. Rigid fusiform body, lunate high-aspect tail on
//  a razor-thin keeled peduncle, retractable first dorsal, and the row of
//  finlets that no one ever models.
// ===========================================================================
function tuna() {
  const p = defaultParams();
  p.id = 'tuna';
  p.displayName = 'Bluefin Tuna';
  p.scale = 2.0;
  Object.assign(p.body, {
    dorsal: { peak: 0.108, girth: 0.34, blunt: 0.72 },
    ventral: { peak: 0.096, girth: 0.38, blunt: 0.86 },
    peduncle: 0.016,
    widthRatio: 0.66, // near-circular section
    pedNarrow: 0.85,
    headWide: 1.02,
    boxiness: 2.3,
  });
  applySwimMode(p, 'thunniform');
  Object.assign(p.swim, { speedBL: 3.4, strouhal: 0.3, plane: 0 });
  p.fins = [
    ridge('dorsal1', 'dorsal', 0.30, 0.42, 0.075, { outline: OUTLINE.spinyDorsal, spineFrac: 0.9, rays: 13 }),
    ridge('dorsal2', 'dorsal', 0.48, 0.57, 0.058, { outline: OUTLINE.lowRidge, spineFrac: 0.1, rays: 12 }),
    ridge('anal', 'ventral', 0.545, 0.63, 0.05, { outline: OUTLINE.lowRidge, spineFrac: 0.1, rays: 11 }),
    {
      id: 'finletsDorsal', kind: 'finlets', anchor: 'dorsal',
      s0: 0.60, s1: 0.86, count: 9, height: 0.014, rays: 3, bones: 2,
      rayVisibility: 0.2, spineFrac: 1.0, motion: clone(M.medianStabiliser),
    },
    {
      id: 'finletsAnal', kind: 'finlets', anchor: 'ventral',
      s0: 0.63, s1: 0.87, count: 8, height: 0.012, rays: 3, bones: 2,
      rayVisibility: 0.2, spineFrac: 1.0, motion: clone(M.medianStabiliser),
    },
    paired('pectoral', 0.275, -0.12, 0.16, { outline: OUTLINE.wing, chord: 0.035, fanDeg: [-22, 22], aimDeg: [-4, -30, 0], motion: clone(M.pectoralGlide) }),
    paired('pelvic', 0.31, -0.82, 0.052, { rays: 6, motion: clone(M.pelvic) }),
    caudal('lunate', { rays: 21, motion: clone(M.caudalFish) }),
  ];
  Object.assign(p.surface, {
    dorsalColor: 0x1b2c48,
    flankColor: 0x9fb3c4,
    bellyColor: 0xf2f4f2,
    patternColor: 0x16233a,
    countershade: 1.0,
    countershadeSharp: 0.4,
    iridescence: 0.9, // mackerel/tuna sheen is almost entirely iridophore
    iridescenceIOR: 1.36,
    iridFlank: 0.7,
    lateralLine: 0.25,
    clearcoat: 1.0,
    roughness: 0.28,
    scaleDensity: 90,
  });
  Object.assign(p.pattern, RD_PRESETS.uniform, { contrast: 0.12 });
  return p;
}

// ===========================================================================
//  EEL -- Anguilliform. More than a full wave on the body at once. The dorsal,
//  caudal and anal fins are fused into one continuous median ribbon, so there is
//  no discrete tail fin to speak of.
// ===========================================================================
function eel() {
  const p = defaultParams();
  p.id = 'eel';
  p.displayName = 'European Eel';
  p.scale = 0.8;
  p.body.sections = 200; // a long body needs more rings to hold the wave
  Object.assign(p.body, {
    dorsal: { peak: 0.03, girth: 0.30, blunt: 0.3 },
    ventral: { peak: 0.028, girth: 0.34, blunt: 0.36 },
    peduncle: 0.008,
    widthRatio: 0.82,
    pedNarrow: 0.35,
    headWide: 1.2,
    boxiness: 2.0,
  });
  p.spine.joints = 40; // needs the resolution to carry >1 wavelength cleanly
  applySwimMode(p, 'anguilliform');
  Object.assign(p.swim, { speedBL: 1.1, strouhal: 0.35, plane: 0 });
  p.fins = [
    ridge('dorsal1', 'dorsal', 0.30, 0.985, 0.020, { outline: OUTLINE.fringe, rays: 40, spineFrac: 0, bones: 2, rayVisibility: 0.15, motion: { ...M.medianStabiliser, curlGain: 1.5 } }),
    ridge('anal', 'ventral', 0.60, 0.985, 0.016, { outline: OUTLINE.fringe, rays: 30, spineFrac: 0, bones: 2, rayVisibility: 0.15, motion: { ...M.medianStabiliser, curlGain: 1.5 } }),
    paired('pectoral', 0.115, -0.05, 0.032, { rays: 9, motion: clone(M.pectoralGlide) }),
    caudal('pointed', { rays: 9, rayVisibility: 0.1 }),
  ];
  Object.assign(p.surface, {
    dorsalColor: 0x23281f,
    flankColor: 0x6f6a4e,
    bellyColor: 0xd8cfa8,
    patternColor: 0x1a1d18,
    countershade: 0.75,
    iridescence: 0.35,
    lateralLine: 0.15,
    scaleDensity: 130,
    roughness: 0.3,
    clearcoat: 1.0,
    clearcoatRoughness: 0.03, // eels are conspicuously slimy
  });
  Object.assign(p.pattern, RD_PRESETS.uniform, { contrast: 0.15 });
  Object.assign(p.eyes, { s: 0.09, height: 0.35, radius: 0.007 });
  return p;
}

// ===========================================================================
//  BOXFISH -- Ostraciiform. The body is a fused bony carapace and literally
//  cannot bend. Thrust comes from the caudal fin swinging like a pendulum on the
//  one flexible joint, plus rapid median- and pectoral-fin rowing.
// ===========================================================================
function boxfish() {
  const p = defaultParams();
  p.id = 'boxfish';
  p.displayName = 'Yellow Boxfish';
  p.scale = 0.2;
  Object.assign(p.body, {
    dorsal: { peak: 0.215, girth: 0.44, blunt: 1.1 },
    ventral: { peak: 0.225, girth: 0.48, blunt: 1.3 },
    peduncle: 0.028,
    widthRatio: 0.92,
    pedNarrow: 0.7,
    headWide: 1.0,
    boxiness: 5.5, // the carapace
  });
  applySwimMode(p, 'ostraciiform');
  Object.assign(p.swim, { speedBL: 0.8, strouhal: 0.5, plane: 0, freqOverride: 2.6 });
  p.fins = [
    ridge('dorsal1', 'dorsal', 0.66, 0.755, 0.05, { rays: 10, spineFrac: 0, outline: OUTLINE.lowRidge, motion: clone(M.medianPropulsor) }),
    ridge('anal', 'ventral', 0.68, 0.775, 0.048, { rays: 10, spineFrac: 0, outline: OUTLINE.lowRidge, motion: { ...M.medianPropulsor, swingPhase: Math.PI } }),
    paired('pectoral', 0.45, -0.05, 0.075, { rays: 11, motion: clone(M.pectoralRow) }),
    caudal('rounded', { rays: 11, s0: 0.94, motion: clone(M.caudalPendulum) }),
  ];
  Object.assign(p.surface, {
    dorsalColor: 0xf2c412,
    flankColor: 0xf7d54a,
    bellyColor: 0xf6e08a,
    patternColor: 0x141008,
    countershade: 0.2,
    iridescence: 0.2,
    lateralLine: 0.0,
    roughness: 0.5,
    scaleDensity: 26,
    scaleDepth: 0.55,
    scaleAspect: 1.0,
    finTint: 0xe8dfae,
  });
  // Aposematic: a bright yellow field studded with hard black spots.
  Object.assign(p.pattern, RD_PRESETS.spots, { anisotropy: 1.0, scaleU: 1.0, scaleV: 1.0, contrast: 1.0, threshold: 0.26, softness: 0.03 });
  return p;
}

// ===========================================================================
//  ANGELFISH -- Pterophyllum. Extreme compressiform: a disc a few millimetres
//  thick. Dorsal and anal fins form the tall sail; the pelvics are trailing
//  filaments. Kondo & Asai's Pomacanthus work is the reason this species is the
//  poster child for Turing patterns, so it gets bars.
// ===========================================================================
function angelfish() {
  const p = defaultParams();
  p.id = 'angelfish';
  p.displayName = 'Freshwater Angelfish';
  p.scale = 0.14;
  Object.assign(p.body, {
    dorsal: { peak: 0.26, girth: 0.36, blunt: 1.0 },
    ventral: { peak: 0.24, girth: 0.40, blunt: 1.15 },
    peduncle: 0.028,
    widthRatio: 0.17, // a leaf
    pedNarrow: 0.35,
    headWide: 1.25,
    boxiness: 2.0,
  });
  applySwimMode(p, 'carangiform');
  Object.assign(p.swim, { speedBL: 0.7, strouhal: 0.35, plane: 0 });
  p.swim.envelope.gain = 0.55; // hovers on its fins more than it undulates
  p.fins = [
    ridge('dorsal1', 'dorsal', 0.26, 0.74, 0.40, { rays: 22, spineFrac: 0.45, outline: OUTLINE.sailDorsal, bones: 4, motion: { ...M.medianStabiliser, curlGain: 1.3 } }),
    ridge('anal', 'ventral', 0.44, 0.80, 0.34, { rays: 20, spineFrac: 0.3, outline: OUTLINE.sailDorsal, bones: 4, motion: { ...M.medianStabiliser, curlGain: 1.3 } }),
    paired('pectoral', 0.30, 0.05, 0.09, { rays: 12, motion: clone(M.pectoralRow) }),
    paired('pelvic', 0.34, -0.95, 0.42, {
      rays: 3, bones: 4, chord: 0.012, fanDeg: [-6, 6], aimDeg: [0, -6, 0],
      outline: OUTLINE.filament, rayVisibility: 0.9, spineFrac: 0.25, motion: clone(M.streamer),
    }),
    caudal('truncate', { rays: 17, chord: 0.13, span: 0.16, motion: { ...M.caudalFish, curlGain: 1.4 } }),
  ];
  Object.assign(p.surface, {
    dorsalColor: 0xa9a08c,
    flankColor: 0xd6cfbc,
    bellyColor: 0xeae4d4,
    patternColor: 0x14171c,
    countershade: 0.35,
    iridescence: 0.5,
    iridFlank: 0.6,
    iridOnPattern: -0.9,
    lateralLine: 0.0,
    roughness: 0.4,
    scaleDensity: 44,
    finTint: 0xc9c3b0,
    finTransmission: 0.85,
    finRayContrast: 0.6,
  });
  // Vertical BARS. anisotropy < 1 boosts diffusion AROUND the body, which
  // suppresses variation in that direction, so the bands run dorsal-to-ventral.
  // Seeding with bands gives the reaction a head start so bold bars lock in.
  Object.assign(p.pattern, RD_PRESETS.worms, {
    anisotropy: 0.35, scaleU: 0.85, scaleV: 1.0, contrast: 0.9,
    threshold: 0.28, softness: 0.08, seedMode: 'bars', settleSteps: 4000,
  });
  return p;
}

// ===========================================================================
//  PUFFERFISH -- globiform, inflatable. No pelvic girdle at all. Hovers on
//  little median fins; the tail is a rudder it barely uses.
// ===========================================================================
function pufferfish() {
  const p = defaultParams();
  p.id = 'pufferfish';
  p.displayName = 'Pufferfish';
  p.scale = 0.25;
  Object.assign(p.body, {
    dorsal: { peak: 0.175, girth: 0.40, blunt: 0.85 },
    ventral: { peak: 0.185, girth: 0.46, blunt: 1.0 },
    peduncle: 0.03,
    widthRatio: 0.88,
    pedNarrow: 0.55,
    headWide: 1.05,
    boxiness: 2.4,
    inflate: 0.15,
  });
  applySwimMode(p, 'ostraciiform');
  Object.assign(p.swim, { speedBL: 0.55, strouhal: 0.5, plane: 0, freqOverride: 2.0 });
  p.swim.envelope.gain = 1.6; // its peduncle is flexible, unlike a boxfish's
  p.fins = [
    ridge('dorsal1', 'dorsal', 0.735, 0.80, 0.045, { rays: 9, spineFrac: 0, outline: OUTLINE.lowRidge, motion: clone(M.medianPropulsor) }),
    ridge('anal', 'ventral', 0.755, 0.815, 0.042, { rays: 9, spineFrac: 0, outline: OUTLINE.lowRidge, motion: { ...M.medianPropulsor, swingPhase: Math.PI } }),
    paired('pectoral', 0.40, -0.02, 0.08, { rays: 12, motion: clone(M.pectoralRow) }),
    caudal('rounded', { rays: 11, s0: 0.955, motion: { ...M.caudalPendulum, swingAmp: 0.28 } }),
  ];
  Object.assign(p.surface, {
    dorsalColor: 0x6a5a3e,
    flankColor: 0xbda878,
    bellyColor: 0xf4ecd8,
    patternColor: 0x1c1a17,
    countershade: 0.8,
    iridescence: 0.25,
    lateralLine: 0.0,
    roughness: 0.62,
    scaleDensity: 34,
    scaleDepth: 0.5,
    clearcoat: 0.7,
  });
  Object.assign(p.pattern, RD_PRESETS.spots, { anisotropy: 1.0, contrast: 0.95, threshold: 0.25, softness: 0.05 });
  return p;
}

// ===========================================================================
//  CLOWNFISH -- Amphiprion. The bars are not a Turing pattern: they are hard,
//  leucophore-backed, aposematic bands with black piping. Handled by a marking
//  mask, not reaction-diffusion. Worth having one species that proves the
//  pattern engine is layered rather than RD-only.
// ===========================================================================
function clownfish() {
  const p = defaultParams();
  p.id = 'clownfish';
  p.displayName = 'Clown Anemonefish';
  p.scale = 0.09;
  Object.assign(p.body, {
    dorsal: { peak: 0.155, girth: 0.36, blunt: 0.8 },
    ventral: { peak: 0.14, girth: 0.42, blunt: 0.95 },
    peduncle: 0.026,
    widthRatio: 0.34,
    pedNarrow: 0.45,
    headWide: 1.15,
    boxiness: 2.05,
  });
  applySwimMode(p, 'carangiform');
  Object.assign(p.swim, { speedBL: 1.2, strouhal: 0.35, plane: 0 });
  p.swim.envelope.gain = 0.75;
  p.fins = [
    ridge('dorsal1', 'dorsal', 0.27, 0.50, 0.085, { rays: 12, spineFrac: 0.95, outline: OUTLINE.spinyDorsal }),
    ridge('dorsal2', 'dorsal', 0.52, 0.74, 0.10, { rays: 12, spineFrac: 0.05, outline: OUTLINE.softDorsal }),
    ridge('anal', 'ventral', 0.60, 0.78, 0.085, { rays: 12, spineFrac: 0.2, outline: OUTLINE.anal }),
    paired('pectoral', 0.31, 0.0, 0.10, { rays: 13, motion: clone(M.pectoralRow) }),
    paired('pelvic', 0.33, -0.9, 0.075, { rays: 6, motion: clone(M.pelvic) }),
    caudal('rounded', { rays: 15, chord: 0.11, span: 0.10 }),
  ];
  Object.assign(p.surface, {
    dorsalColor: 0xd94f0d,
    flankColor: 0xf2731a,
    bellyColor: 0xf59b3c,
    patternColor: 0x0d0b0a,
    xanthoColor: 0xff8a1e,
    xantho: 0.35,
    countershade: 0.25,
    iridescence: 0.18,
    lateralLine: 0.0,
    roughness: 0.36,
    scaleDensity: 48,
    finTint: 0xf2884a,
    finTransmission: 0.35,
    markings: 'clownfish',
  });
  Object.assign(p.pattern, RD_PRESETS.uniform, { contrast: 0.0 });
  p.surface.markings = 'clownfish';
  return p;
}

// ===========================================================================
//  ORCA -- Orcinus orca. Not a fish. `plane = 1` rotates the spinal bending axis
//  into the sagittal plane AND rolls the tail into a horizontal fluke, in one
//  parameter. No pelvic fins, no anal fin, no fin rays anywhere. The dorsal fin
//  is a boneless keel, and the flukes are boneless too.
//
//  Thunniform in the vertical plane: only the posterior third flexes.
//  Rohr & Fish 2004: St clusters at 0.225-0.275, fluke amplitude 0.15-0.25 BL pp.
// ===========================================================================
function orca() {
  const p = defaultParams();
  p.id = 'orca';
  p.displayName = 'Orca';
  p.scale = 7.0;
  Object.assign(p.body, {
    dorsal: { peak: 0.115, girth: 0.35, blunt: 0.9 },
    ventral: { peak: 0.108, girth: 0.40, blunt: 1.0 },
    peduncle: 0.028,
    widthRatio: 0.74,
    pedNarrow: 0.6,
    headWide: 1.0,
    boxiness: 2.2,
  });
  applySwimMode(p, 'thunniform');
  Object.assign(p.swim, {
    plane: 1.0,
    speedBL: 1.0,
    strouhal: 0.25,
    idle: 0.2,
  });
  Object.assign(p.swim.envelope, { c0: 0.02, c1: -0.06, c2: 0.19, stiffness: 0.85, stiffStart: 0.62, headYaw: 0.012 });
  p.fins = [
    // Tall erect triangular keel. Males reach ~1.8 m, height >= 2x base.
    ridge('dorsal1', 'dorsal', 0.40, 0.53, 0.17, { rays: 10, spineFrac: 1.0, rayVisibility: 0.0, outline: OUTLINE.keel, bones: 2, motion: { ...M.medianStabiliser, curlGain: 0.25 } }),
    paired('pectoral', 0.245, -0.35, 0.115, {
      rays: 10, rayVisibility: 0.0, chord: 0.05, fanDeg: [-30, 30], aimDeg: [-6, -22, -8],
      outline: OUTLINE.paddle, motion: clone(M.flipper),
    }),
    caudal('fluke', { rays: 13, rayVisibility: 0.0, bones: 3, motion: clone(M.fluke) }),
  ];
  Object.assign(p.surface, {
    dorsalColor: 0x0b0d10,
    flankColor: 0x14171b,
    bellyColor: 0xf4f5f0,
    patternColor: 0x08090b,
    countershade: 0.0, // orca markings are not countershading; they are a mask
    iridescence: 0.05,
    lateralLine: 0.0,
    roughness: 0.5, // matte-ish skin: a mirror-smooth orca reflects the sky to grey
    clearcoat: 0.5,
    clearcoatRoughness: 0.18,
    scaleDensity: 0.0, // no scales. Skin.
    scaleDepth: 0.0,
    sss: 0.15,
    finTint: 0x111417,
    finTransmission: 0.0,
    finOpacity: 1.0,
    finAnisotropy: 0.0,
    finRayContrast: 0.0,
    markings: 'orca',
  });
  Object.assign(p.pattern, { enabled: false, contrast: 0 });
  Object.assign(p.eyes, { s: 0.135, height: -0.1, radius: 0.008 });
  return p;
}

// ===========================================================================
//  BLUE WHALE -- Balaenoptera musculus. The same cetacean rig, stretched: a much
//  more slender rorqual, an enormous head, tiny far-aft dorsal fin, and narrow
//  high-aspect flippers ~12% of body length.
// ===========================================================================
function blueWhale() {
  const p = defaultParams();
  p.id = 'bluewhale';
  p.displayName = 'Blue Whale';
  p.scale = 26.0;
  p.body.sections = 170;
  Object.assign(p.body, {
    dorsal: { peak: 0.076, girth: 0.36, blunt: 0.5 }, // broad U-shaped rostrum
    ventral: { peak: 0.072, girth: 0.42, blunt: 0.62 },
    peduncle: 0.018,
    widthRatio: 0.82,
    pedNarrow: 0.55,
    headWide: 1.3,
    boxiness: 2.15,
  });
  p.spine.joints = 32;
  applySwimMode(p, 'thunniform');
  Object.assign(p.swim, { plane: 1.0, speedBL: 0.6, strouhal: 0.26, idle: 0.12 });
  Object.assign(p.swim.envelope, { c0: 0.015, c1: -0.05, c2: 0.17, stiffness: 0.88, stiffStart: 0.66, headYaw: 0.008 });
  p.fins = [
    ridge('dorsal1', 'dorsal', 0.755, 0.80, 0.022, { rays: 6, spineFrac: 1.0, rayVisibility: 0.0, outline: OUTLINE.keel, bones: 2, motion: { ...M.medianStabiliser, curlGain: 0.2 } }),
    paired('pectoral', 0.205, -0.34, 0.125, {
      rays: 8, rayVisibility: 0.0, chord: 0.018, fanDeg: [-12, 12], aimDeg: [-4, -20, -6],
      outline: OUTLINE.wing, motion: clone(M.flipper),
    }),
    caudal('fluke', { rays: 13, rayVisibility: 0.0, bones: 3, span: 0.11, chord: 0.05, motion: clone(M.fluke) }),
  ];
  Object.assign(p.surface, {
    dorsalColor: 0x3d4d5c,
    flankColor: 0x5f7183,
    bellyColor: 0x8d9aa2,
    patternColor: 0x8fa0ad,
    countershade: 0.55,
    countershadeSharp: 0.25,
    iridescence: 0.02,
    lateralLine: 0.0,
    roughness: 0.55,
    clearcoat: 0.45,
    scaleDensity: 0.0,
    scaleDepth: 0.0,
    sss: 0.1,
    finTint: 0x4a5a68,
    finTransmission: 0.0,
    finOpacity: 1.0,
    finAnisotropy: 0.0,
    finRayContrast: 0.0,
  });
  // Rorquals are mottled, not patterned: faint light blotches on grey-blue.
  Object.assign(p.pattern, RD_PRESETS.holes, { enabled: true, anisotropy: 1.4, scaleU: 2.2, scaleV: 1.6, contrast: 0.3, threshold: 0.3, softness: 0.2 });
  Object.assign(p.eyes, { s: 0.19, height: -0.55, radius: 0.004 });
  return p;
}

export const SPECIES = {
  minnow,
  clownfish,
  angelfish,
  boxfish,
  pufferfish,
  tuna,
  eel,
  orca,
  bluewhale: blueWhale,
};

export const SPECIES_ORDER = ['minnow', 'clownfish', 'angelfish', 'boxfish', 'pufferfish', 'tuna', 'eel', 'orca', 'bluewhale'];

export function makeSpecies(id) {
  const f = SPECIES[id] || SPECIES.minnow;
  return f();
}
