import * as THREE from 'three';
import { se, lerp } from '../core/math.js';
import { Profile } from './profile.js';

/**
 * Remap uniform section index -> body coordinate, clustering rings toward the
 * head and tail (cosine easing). Heads are where people look and tails carry the
 * caudal peduncle, so both deserve more geometry than the mid-body. An extra pull
 * toward the head (the sqrt term, weighted small) biases density forward.
 */
function sBias(u) {
  const ends = 0.5 - 0.5 * Math.cos(Math.PI * u); // dense at both ends
  const s = lerp(u, ends, 0.55);
  return lerp(s, Math.sqrt(s), 0.12); // nudge a little more density to the head
}

/**
 * Builds the body as a skinned tube: a stack of cross-section rings from snout to
 * tail, each ring an (optionally squared-off) superellipse sized by the Profile.
 *
 * Skinning strategy: every vertex is bound to the two spine bones that straddle
 * its body coordinate, weighted linearly. Two bones is enough for a smooth bend
 * and keeps the weight maths trivial to reason about. The bone index order here
 * (0 = snout ... N-1 = tail) MUST match the order the Skeleton is built in, since
 * that order is what `skinIndex` looks up.
 *
 * The u seam is placed on the ventral midline (least-seen, and a natural place
 * for the belly). u runs 0..1 around the ring, v runs 0..1 snout->tail.
 */
export function buildBodyGeometry(params) {
  const profile = new Profile(params);
  const L = params.scale;
  const nSec = Math.max(24, params.body.sections | 0);
  const nRad = Math.max(6, params.body.radial | 0);
  const nBones = Math.max(2, params.spine.joints | 0);

  const ringVerts = nRad + 1; // +1 duplicates the seam so uv.v is continuous
  const noseCap = ringVerts * (nSec + 1); // index of the nose cap vertex
  const tailCap = noseCap + 1;
  const vertCount = ringVerts * (nSec + 1) + 2; // + nose & tail cap centres

  const pos = new Float32Array(vertCount * 3);
  const uv = new Float32Array(vertCount * 2);
  const skinIndex = new Uint16Array(vertCount * 4);
  const skinWeight = new Float32Array(vertCount * 4);
  // Extra per-vertex channels the shader wants: body coord s, and a signed
  // dorsal(+1)/ventral(-1) factor used for countershading and iridophore masking.
  const aBody = new Float32Array(vertCount);
  const aDorsal = new Float32Array(vertCount);

  let vi = 0;
  for (let i = 0; i <= nSec; i++) {
    const s = sBias(i / nSec);
    const x = profile.xAt(s);
    const e = profile.extents(s);
    const n = profile.boxiness(s);
    const cy = profile.midY(s) * L;

    // Bone binding for this ring.
    const bf = s * (nBones - 1);
    let i0 = Math.floor(bf);
    let i1 = Math.min(i0 + 1, nBones - 1);
    const w1 = bf - i0;
    const w0 = 1 - w1;

    for (let j = 0; j <= nRad; j++) {
      const th = (j / nRad) * Math.PI * 2 - Math.PI / 2; // start at ventral seam
      const ct = Math.cos(th); // +1 at top
      const st = Math.sin(th);

      const yUnit = se(ct, n);
      const zUnit = se(st, n);
      const yr = (yUnit >= 0 ? e.up : e.down) * L;
      const zr = e.width * L;

      const px = x;
      const py = cy + yUnit * yr;
      const pz = zUnit * zr;

      pos[vi * 3] = px;
      pos[vi * 3 + 1] = py;
      pos[vi * 3 + 2] = pz;

      uv[vi * 2] = j / nRad;
      uv[vi * 2 + 1] = s;

      skinIndex[vi * 4] = i0;
      skinIndex[vi * 4 + 1] = i1;
      skinIndex[vi * 4 + 2] = 0;
      skinIndex[vi * 4 + 3] = 0;
      skinWeight[vi * 4] = w0;
      skinWeight[vi * 4 + 1] = w1;
      skinWeight[vi * 4 + 2] = 0;
      skinWeight[vi * 4 + 3] = 0;

      aBody[vi] = s;
      aDorsal[vi] = yUnit; // -1..1 dorsoventral factor
      vi++;
    }
  }

  // Nose and tail cap centre vertices, so the (now rounded, nonzero-radius) snout
  // and peduncle are closed with a hemispherical fan instead of a hard disc.
  const capVert = (idx, s, forward, bone) => {
    const e = profile.extents(s);
    const rAvg = 0.5 * (e.up + e.down) * L;
    const x = profile.xAt(s) + forward * rAvg * 0.9; // push the tip out to round it
    pos[idx * 3] = x;
    pos[idx * 3 + 1] = profile.midY(s) * L;
    pos[idx * 3 + 2] = 0;
    uv[idx * 2] = 0.5;
    uv[idx * 2 + 1] = s;
    skinIndex[idx * 4] = bone;
    skinWeight[idx * 4] = 1;
    aBody[idx] = s;
    aDorsal[idx] = 0;
  };
  capVert(noseCap, 0, +1, 0);
  capVert(tailCap, 1, -1, nBones - 1);

  // Index buffer: quad grid + two triangle fans for the caps.
  const index = [];
  for (let i = 0; i < nSec; i++) {
    for (let j = 0; j < nRad; j++) {
      const a = i * ringVerts + j;
      const b = a + 1;
      const c = a + ringVerts;
      const d = c + 1;
      index.push(a, c, b, b, c, d);
    }
  }
  // Cap fans. Winding matches the body's outward orientation: for a shared ring
  // edge, the adjacent cap triangle must traverse it opposite to the body quad,
  // or the cap normals point inward and get back-face culled (a hole in the snout).
  for (let j = 0; j < nRad; j++) {
    index.push(noseCap, j, j + 1); // nose fan (first ring, i=0)
  }
  const lastBase = nSec * ringVerts;
  for (let j = 0; j < nRad; j++) {
    index.push(tailCap, lastBase + j + 1, lastBase + j); // tail fan (last ring)
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  geo.setAttribute('skinIndex', new THREE.BufferAttribute(skinIndex, 4));
  geo.setAttribute('skinWeight', new THREE.BufferAttribute(skinWeight, 4));
  geo.setAttribute('aBody', new THREE.BufferAttribute(aBody, 1));
  geo.setAttribute('aDorsal', new THREE.BufferAttribute(aDorsal, 1));
  geo.setIndex(index); // plain array -> three picks Uint16/Uint32 automatically
  geo.computeVertexNormals();
  weldSeamNormals(geo, nSec, nRad, ringVerts);
  geo.computeTangents === undefined || null; // tangents added later if needed
  geo.computeBoundingSphere();

  return { geometry: geo, profile, nSec, nRad, ringVerts };
}

/**
 * computeVertexNormals leaves a crease at the duplicated u seam because the two
 * coincident vertices accumulate different face sets. Average them so the belly
 * seam disappears.
 */
function weldSeamNormals(geo, nSec, nRad, ringVerts) {
  const nrm = geo.attributes.normal.array;
  for (let i = 0; i <= nSec; i++) {
    const first = (i * ringVerts + 0) * 3;
    const last = (i * ringVerts + nRad) * 3;
    const nx = nrm[first] + nrm[last];
    const ny = nrm[first + 1] + nrm[last + 1];
    const nz = nrm[first + 2] + nrm[last + 2];
    const len = Math.hypot(nx, ny, nz) || 1;
    nrm[first] = nrm[last] = nx / len;
    nrm[first + 1] = nrm[last + 1] = ny / len;
    nrm[first + 2] = nrm[last + 2] = nz / len;
  }
  geo.attributes.normal.needsUpdate = true;
}
