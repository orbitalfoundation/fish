import * as THREE from 'three';
import { buildBodyGeometry } from './geometry.js';
import { FishSkeleton } from './skeleton.js';
import { buildFins } from './fins.js';
import { Swimmer } from './swim.js';
import { makeBodyMaterial, makeFinMaterial, applyBodySurface, applyFinSurface } from '../shading/FishMaterial.js';

/**
 * Assembles a complete, animating fish (or whale) from a parameter set: skinned
 * body, spine rooted at the recoil pivot, fins bound to the same spine, and eyes.
 * One update(dt) per frame drives the whole thing off the Swimmer.
 */
export class FishRig extends THREE.Group {
  constructor(params, rdTexture, shared, materials = null) {
    super();
    this.params = params;
    this.shared = shared;

    const { geometry, profile } = buildBodyGeometry(params);
    this.profile = profile;
    this.skeleton = new FishSkeleton(params, 0.23);

    // Materials are created once and reused across rebuilds so structural edits
    // (body shape, fins, morph) never trigger a costly shader recompile; their
    // uniforms are refreshed from the current params instead.
    if (materials) {
      this.bodyMaterial = materials.body;
      this.finMaterial = materials.fin;
      applyBodySurface(this.bodyMaterial, params.surface, params.pattern);
      applyFinSurface(this.finMaterial, params.surface);
    } else {
      const surf = { ...params.surface, _rdScaleU: params.pattern.scaleU, _rdScaleV: params.pattern.scaleV, enabled: params.pattern.enabled };
      this.bodyMaterial = makeBodyMaterial(surf, rdTexture, shared);
      this.finMaterial = makeFinMaterial(params.surface, shared);
    }

    this.body = new THREE.SkinnedMesh(geometry, this.bodyMaterial);
    this.body.frustumCulled = false;
    this.body.add(this.skeleton.root); // bones live under the body
    this.body.bind(this.skeleton.skeleton, new THREE.Matrix4());
    this.add(this.body);

    // Fins.
    this.fins = buildFins(params, this.skeleton, profile);
    for (const f of this.fins) {
      f.mesh.material = this.finMaterial;
      this.add(f.mesh);
    }

    if (params.eyes?.enabled) this._buildEyes(params, profile);

    this.swimmer = new Swimmer(params);

    // Frame the fish so its centre sits at the world origin.
    this._recentre();
  }

  _buildEyes(params, profile) {
    const L = params.scale;
    // Never let an eye grow larger than the head it sits in (protects thin
    // bodies and morphs between very different shapes).
    const headE = profile.extents(params.eyes.s);
    const radius = Math.min(params.eyes.radius, 0.7 * headE.half, 0.7 * headE.width);
    const eg = new THREE.SphereGeometry(radius * L, 20, 16);
    const mat = new THREE.MeshPhysicalMaterial({
      color: new THREE.Color(params.eyes.irisColor),
      roughness: 0.15, clearcoat: 1.0, clearcoatRoughness: 0.05,
    });
    const ringMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(params.eyes.scleraColor) });
    const s = params.eyes.s;
    const e = profile.extents(s);
    const x = profile.xAt(s);
    const hy = params.eyes.height; // fraction of half-depth, above midline
    const y = profile.midY(s) * L + hy * e.half * L;
    const bone = this.skeleton.bones[this.skeleton._nearestBone(s)];
    const bx = bone.getWorldPosition(new THREE.Vector3()).x;

    // Seat the eye on the actual flank surface at that height (the cross-section
    // narrows toward the top), sitting just proud so it reads as a bulging eye
    // rather than being buried under a fuller head.
    const zSurf = e.width * L * Math.sqrt(Math.max(0.04, 1 - hy * hy));
    for (const side of [1, -1]) {
      const z = side * (zSurf - radius * L * 0.35);
      const eye = new THREE.Group();
      const ball = new THREE.Mesh(eg, mat);
      const ring = new THREE.Mesh(new THREE.SphereGeometry(radius * L * 1.35, 20, 16), ringMat);
      ring.scale.z = 0.35;
      ring.position.z = side * -radius * L * 0.5;
      eye.add(ring); eye.add(ball);
      eye.position.set(x - bx, y, z);
      bone.add(eye);
    }
  }

  _recentre() {
    this.body.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(this.body);
    const c = box.getCenter(new THREE.Vector3());
    this.position.set(-c.x, -c.y, -c.z);
  }

  /** Longest body dimension in world units, for camera framing. */
  get span() {
    return this.params.scale;
  }

  update(dt) {
    this.swimmer.advance(dt);
    const plane = this.params.swim.plane || 0;
    this.skeleton.pose((s) => this.swimmer.centreline(s), plane);
    for (const f of this.fins) f.update(this.swimmer);
    // Push bone matrices to the skinning texture.
    this.body.updateMatrixWorld(true);
    this.skeleton.skeleton.update();
  }

  get materials() {
    return { body: this.bodyMaterial, fin: this.finMaterial };
  }

  /** Dispose per-rig resources. Materials are owned by the app and reused, so
   *  they are only freed when `disposeMaterials` is set (final teardown). */
  dispose(disposeMaterials = false) {
    this.body.geometry.dispose();
    for (const f of this.fins) f.mesh.geometry.dispose();
    this.skeleton.dispose();
    if (disposeMaterials) { this.bodyMaterial.dispose(); this.finMaterial.dispose(); }
  }
}
