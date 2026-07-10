import * as THREE from 'three';
import { curveAt, clamp, lerp, TAU, se } from '../core/math.js';

/**
 * Fins.
 *
 * Every fin is a SkinnedMesh bound to the SAME spine skeleton as the body, with
 * skin weights taken from where the fin sits along the body. That means body
 * undulation carries the fins for free -- an eel's continuous fin fringe bends
 * with the eel, a tuna's tail follows the peduncle -- without any per-fin
 * attachment bookkeeping.
 *
 * On top of that, each fin adds its own membrane motion in BIND (straight-body)
 * space by rewriting its position attribute each frame. Because skinning is
 * applied afterwards, the membrane flex and the body bend compose correctly.
 *
 * Membrane motion has three ingredients:
 *   - trailing: the fin lags its socket, driven by the socket's VELOCITY, which
 *     is a quarter cycle behind displacement (the real dorsal/anal phase lag).
 *   - rigidPitch: blends the flex from "curls into an arc" to "pitches as a rigid
 *     plate", which is how a cetacean fluke behaves.
 *   - swing: an active oscillation for fins that propel by themselves (a boxfish
 *     sculling its tail, a wrasse rowing its pectorals) where the body cannot help.
 */

export function buildFins(params, skeleton, profile) {
  const fins = [];
  for (const spec of params.fins) {
    if (spec.kind === 'caudal') fins.push(buildCaudal(spec, params, skeleton, profile));
    else if (spec.kind === 'ridge') fins.push(buildRidge(spec, params, skeleton, profile));
    else if (spec.kind === 'finlets') fins.push(...buildFinlets(spec, params, skeleton, profile));
    else if (spec.kind === 'paired') fins.push(...buildPaired(spec, params, skeleton, profile));
  }
  return fins;
}

// --- skin binding helper: weight a body coordinate s to the two spanning bones.
function bindS(skeleton, s) {
  const N = skeleton.N;
  const bf = clamp(s, 0, 1) * (N - 1);
  const i0 = Math.floor(bf);
  const i1 = Math.min(i0 + 1, N - 1);
  const w1 = bf - i0;
  return [i0, i1, 1 - w1, w1];
}

// A membrane grid: nU rays across the base, nR steps outward. Caller supplies a
// point(u, r) -> {p, s} function returning world-rest position and body coord.
function membrane(nU, nR, point, skeleton, opts = {}) {
  const cols = nU + 1;
  const rows = nR + 1;
  const count = cols * rows;
  const pos = new Float32Array(count * 3);
  const rest = new Float32Array(count * 3);
  const uv = new Float32Array(count * 2);
  const aRay = new Float32Array(count); // 0..1 across base (ray striping)
  const aSpan = new Float32Array(count); // 0..1 outward from base
  const skinIndex = new Uint16Array(count * 4);
  const skinWeight = new Float32Array(count * 4);

  let vi = 0;
  for (let iu = 0; iu <= nU; iu++) {
    const u = iu / nU;
    for (let ir = 0; ir <= nR; ir++) {
      const r = ir / nR;
      const { p, s } = point(u, r);
      pos[vi * 3] = rest[vi * 3] = p.x;
      pos[vi * 3 + 1] = rest[vi * 3 + 1] = p.y;
      pos[vi * 3 + 2] = rest[vi * 3 + 2] = p.z;
      uv[vi * 2] = u;
      uv[vi * 2 + 1] = r;
      aRay[vi] = u;
      aSpan[vi] = r;
      const [i0, i1, w0, w1] = bindS(skeleton, s);
      skinIndex[vi * 4] = i0; skinIndex[vi * 4 + 1] = i1;
      skinWeight[vi * 4] = w0; skinWeight[vi * 4 + 1] = w1;
      vi++;
    }
  }

  const index = [];
  for (let iu = 0; iu < nU; iu++) {
    for (let ir = 0; ir < nR; ir++) {
      const a = iu * rows + ir;
      const b = a + 1;
      const c = a + rows;
      const d = c + 1;
      index.push(a, c, b, b, c, d);
    }
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  geo.setAttribute('aRay', new THREE.BufferAttribute(aRay, 1));
  geo.setAttribute('aSpan', new THREE.BufferAttribute(aSpan, 1));
  geo.setAttribute('skinIndex', new THREE.BufferAttribute(skinIndex, 4));
  geo.setAttribute('skinWeight', new THREE.BufferAttribute(skinWeight, 4));
  geo.setIndex(index);
  geo.computeVertexNormals();
  geo.userData.rest = rest;
  geo.userData.cols = cols;
  geo.userData.rows = rows;
  return geo;
}

function skinnedFin(geo, skeleton, material) {
  const mesh = new THREE.SkinnedMesh(geo, material);
  mesh.frustumCulled = false;
  mesh.bind(skeleton.skeleton, new THREE.Matrix4());
  return mesh;
}

// ---------------------------------------------------------------------------
//  RIDGE  (dorsal / anal): a membrane rising from the dorsal or ventral midline.
// ---------------------------------------------------------------------------
function buildRidge(spec, params, skeleton, profile) {
  const L = params.scale;
  const sign = spec.anchor === 'dorsal' ? 1 : -1;
  const nU = Math.max(6, spec.rays | 0);
  const nR = 6;

  const point = (u, r) => {
    const s = lerp(spec.s0, spec.s1, u);
    const e = profile.extents(s);
    const baseY = (profile.midY(s) + sign * (sign > 0 ? e.up : e.down)) * L;
    const len = spec.height * L * curveAt(spec.outline, u);
    const x = profile.xAt(s);
    return { p: new THREE.Vector3(x, baseY + sign * len * r, 0), s };
  };

  const geo = membrane(nU, nR, point, skeleton);
  const mesh = skinnedFin(geo, skeleton, null);
  const socketS = 0.5 * (spec.s0 + spec.s1);

  return finController(mesh, spec, {
    socketS,
    bendDir: new THREE.Vector3(0, 0, 1), // trails laterally
    L,
    stiffFrac: spec.spineFrac,
  });
}

// ---------------------------------------------------------------------------
//  FINLETS: the little fixed triangles behind a tuna's second dorsal/anal.
// ---------------------------------------------------------------------------
function buildFinlets(spec, params, skeleton, profile) {
  const L = params.scale;
  const sign = spec.anchor === 'dorsal' ? 1 : -1;
  const out = [];
  for (let f = 0; f < spec.count; f++) {
    const s0 = lerp(spec.s0, spec.s1, f / spec.count);
    const s1 = s0 + (spec.s1 - spec.s0) / spec.count * 0.7;
    const point = (u, r) => {
      const s = lerp(s0, s1, u);
      const e = profile.extents(s);
      const baseY = (profile.midY(s) + sign * (sign > 0 ? e.up : e.down)) * L;
      const len = spec.height * L * (1 - u) * (1 - 0.3 * u);
      return { p: new THREE.Vector3(profile.xAt(s), baseY + sign * len * r, 0), s };
    };
    const geo = membrane(3, 2, point, skeleton);
    const mesh = skinnedFin(geo, skeleton, null);
    out.push(finController(mesh, spec, {
      socketS: 0.5 * (s0 + s1),
      bendDir: new THREE.Vector3(0, 0, 1),
      L,
      stiffFrac: 1.0,
    }));
  }
  return out;
}

// ---------------------------------------------------------------------------
//  CAUDAL: the tail. Built in a canonical VERTICAL plane (span along Y, chord
//  along X) then rolled toward horizontal by `plane` so a fish's vertical tail
//  becomes a cetacean's horizontal fluke.
// ---------------------------------------------------------------------------
function buildCaudal(spec, params, skeleton, profile) {
  const L = params.scale;
  const plane = params.swim.plane || 0;
  const nU = Math.max(8, spec.rays | 0);
  const nR = 7;

  const s0 = spec.s0;
  const baseX = profile.xAt(s0);
  const pedE = profile.extents(s0);
  const baseHalf = Math.max(pedE.up, pedE.down) * L;

  // Caudal outline C(v): fork/round shaping. v in [-1,1] spanwise.
  const chord = spec.chord * L;
  const span = spec.span * L;
  const fork = spec.fork, forkExp = spec.forkExp, round = spec.roundness;

  const rollQ = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), (plane * Math.PI) / 2);

  const point = (u, r) => {
    // u across the span (both lobes), r outward (chord depth from base to edge).
    const v = u * 2 - 1; // -1 bottom lobe .. +1 top lobe
    const av = Math.abs(v);
    // Ray length from the peduncle out to the trailing edge for this spanwise pos.
    const lobe = (fork + (1 - fork) * Math.pow(av, forkExp)) * (1 - round) + round * Math.sqrt(Math.max(0, 1 - v * v));
    const rayLen = chord * (0.35 + 0.65 * lobe);
    const spanY = v * span;
    // Base sits on the peduncle; the fin sweeps back (-X) as it goes out.
    const p = new THREE.Vector3(baseX - rayLen * r, spanY * (0.4 + 0.6 * r), 0);
    p.applyQuaternion(rollQ); // vertical -> horizontal for cetaceans
    return { p, s: lerp(s0, 1.0, r * 0.4) };
  };

  const geo = membrane(nU, nR, point, skeleton);
  const mesh = skinnedFin(geo, skeleton, null);

  const bendDir = new THREE.Vector3(0, 0, 1).applyQuaternion(rollQ).normalize();
  return finController(mesh, spec, {
    socketS: 0.995,
    bendDir,
    L,
    stiffFrac: 0.05,
    isCaudal: true,
    baseHalf,
  });
}

// ---------------------------------------------------------------------------
//  PAIRED  (pectoral / pelvic): a fan from a flank socket, built as a mirrored
//  left/right pair. Rowing/flapping is an active rotation about the socket.
// ---------------------------------------------------------------------------
function buildPaired(spec, params, skeleton, profile) {
  const L = params.scale;
  const out = [];
  for (const side of [1, -1]) {
    const s = spec.s0;
    const e = profile.extents(s);
    const baseY = (profile.midY(s) + spec.heightFrac * e.half) * L;
    const baseZ = side * e.width * L * 0.9;
    const base = new THREE.Vector3(profile.xAt(s), baseY, baseZ);

    const [aPitch, aYaw, aRoll] = spec.aimDeg.map((d) => (d * Math.PI) / 180);
    // Local frame: fin extends outward (+Z*side), sweeps back and pitches.
    const q = new THREE.Quaternion()
      .setFromEuler(new THREE.Euler(aRoll * side, aYaw * side, aPitch, 'ZYX'));

    const nU = Math.max(5, spec.rays | 0);
    const nR = 5;
    const [fanA, fanB] = spec.fanDeg.map((d) => (d * Math.PI) / 180);
    const point = (u, r) => {
      const ang = lerp(fanA, fanB, u);
      const len = spec.height * L * curveAt(spec.outline, u);
      // Fan in the fin's local X-Z-ish plane, extending outward along side.
      const local = new THREE.Vector3(
        Math.sin(ang) * len * r * 0.9,
        0,
        side * Math.cos(ang) * len * r
      );
      local.applyQuaternion(q);
      return { p: base.clone().add(local), s };
    };

    const geo = membrane(nU, nR, point, skeleton);
    const mesh = skinnedFin(geo, skeleton, null);
    out.push(finController(mesh, spec, {
      socketS: s,
      bendDir: new THREE.Vector3(0, side, 0).normalize(), // flaps roughly vertically
      L,
      stiffFrac: spec.spineFrac,
      paired: true,
      side,
      base,
    }));
  }
  return out;
}

/**
 * Wraps a fin mesh with per-frame membrane deformation. Returns
 * { mesh, socketS, update(swimmer) }.
 */
function finController(mesh, spec, cfg) {
  const geo = mesh.geometry;
  const rest = geo.userData.rest;
  const posAttr = geo.attributes.position;
  const arr = posAttr.array;
  const spanAttr = geo.attributes.aSpan.array;
  const m = spec.motion;
  const bd = cfg.bendDir;

  return {
    mesh,
    spec,
    socketS: cfg.socketS,
    update(swimmer) {
      const t = swimmer.t;
      const drive = swimmer.finDrive(cfg.socketS); // trailing signal, [-1,1]-ish
      const swing = m.swingAmp * Math.sin(swimmer.omega * m.freqMul * t + m.swingPhase);
      // Trailing amplitude in world units: a fraction of the socket span.
      const reach = (cfg.isCaudal ? spec.chord : spec.height) * cfg.L;
      const amp = reach * (m.curlGain * drive * 0.9 + swing);

      const n = spanAttr.length;
      for (let i = 0; i < n; i++) {
        let r = spanAttr[i];
        // Stiff spine fraction near the leading edge does not bend.
        r = Math.max(0, (r - 0)); // span already 0 at base
        // Blend arc-curl (r^exp) with rigid-plate pitch (linear r).
        const curl = lerp(Math.pow(r, m.curlExp), r, m.rigidPitch);
        const d = amp * curl;
        arr[i * 3] = rest[i * 3] + bd.x * d;
        arr[i * 3 + 1] = rest[i * 3 + 1] + bd.y * d;
        arr[i * 3 + 2] = rest[i * 3 + 2] + bd.z * d;
      }
      posAttr.needsUpdate = true;
    },
  };
}

// Re-export a couple of primitives used by the caudal shaping in case a caller
// wants to preview outlines.
export { se, TAU };
