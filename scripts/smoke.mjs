import * as THREE from 'three';
import { SPECIES_ORDER, makeSpecies } from '../src/species/presets.js';
import { buildBodyGeometry } from '../src/rig/geometry.js';
import { FishSkeleton } from '../src/rig/skeleton.js';
import { Swimmer } from '../src/rig/swim.js';
import { morphParams } from '../src/core/params.js';

function hasNaN(arr) {
  for (let i = 0; i < arr.length; i++) if (!Number.isFinite(arr[i])) return i;
  return -1;
}

let fail = 0;
for (const id of SPECIES_ORDER) {
  const p = makeSpecies(id);
  const { geometry } = buildBodyGeometry(p);
  const pos = geometry.attributes.position.array;
  const nrm = geometry.attributes.normal.array;
  const si = geometry.attributes.skinIndex.array;
  const nBones = p.spine.joints;

  const pNaN = hasNaN(pos);
  const nNaN = hasNaN(nrm);
  const maxIdx = Math.max(...si);
  const skel = new FishSkeleton(p, 0.23);
  const sw = new Swimmer(p);
  sw.advance(0.13);

  // Pose a few times and confirm bone rotations stay finite.
  let poseNaN = false;
  for (let f = 0; f < 5; f++) {
    sw.advance(0.016);
    skel.pose((s) => sw.centreline(s), p.swim.plane || 0);
    for (const b of skel.bones) {
      if (![b.rotation.x, b.rotation.y, b.rotation.z].every(Number.isFinite)) poseNaN = true;
    }
  }
  skel.root.updateMatrixWorld(true);

  const verts = pos.length / 3;
  const ok = pNaN < 0 && nNaN < 0 && maxIdx < nBones && !poseNaN;
  if (!ok) fail++;
  console.log(
    `${ok ? 'ok  ' : 'FAIL'} ${id.padEnd(11)} verts=${String(verts).padStart(6)} ` +
    `bones=${nBones} maxSkinIdx=${maxIdx} freq=${sw.freq.toFixed(2)}Hz ` +
    `fins=${p.fins.length} ${pNaN < 0 ? '' : 'posNaN@' + pNaN} ${nNaN < 0 ? '' : 'nrmNaN@' + nNaN} ${poseNaN ? 'POSE-NaN' : ''}`
  );
}

// Morph midpoint between every adjacent pair.
console.log('\nmorph checks:');
for (let i = 0; i < SPECIES_ORDER.length - 1; i++) {
  const a = makeSpecies(SPECIES_ORDER[i]);
  const b = makeSpecies(SPECIES_ORDER[i + 1]);
  const m = morphParams(a, b, 0.5);
  try {
    const { geometry } = buildBodyGeometry(m);
    const bad = hasNaN(geometry.attributes.position.array);
    const ok = bad < 0;
    if (!ok) fail++;
    console.log(`${ok ? 'ok  ' : 'FAIL'} ${SPECIES_ORDER[i]} <-> ${SPECIES_ORDER[i + 1]}  fins=${m.fins.length}`);
  } catch (e) {
    fail++;
    console.log(`FAIL ${SPECIES_ORDER[i]} <-> ${SPECIES_ORDER[i + 1]}: ${e.message}`);
  }
}

console.log(`\n${fail === 0 ? 'ALL PASS' : fail + ' FAILURES'}`);
process.exit(fail === 0 ? 0 : 1);
