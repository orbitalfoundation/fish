import * as THREE from 'three';
import { Profile } from './profile.js';

/**
 * The spine.
 *
 * Bones are indexed 0 (snout) .. N-1 (tail) so the index order matches the
 * skinIndex values baked into the geometry. But the HIERARCHY is not a simple
 * head-to-tail chain: it is rooted at the recoil pivot (~s = 0.23, where real
 * fish pivot) with two branches growing out of it -- one forward to the snout,
 * one back to the tail.
 *
 * Why: if you root a chain at the head, the head is nailed in place and only the
 * tail swings, which looks like someone waving a dead fish. Rooting at the pivot
 * lets the snout counter-sway against the tail on its own, which is the real
 * recoil behaviour (Lighthill 1970) and needs no special-case fudge.
 */
export class FishSkeleton {
  constructor(params, pivotS = 0.23) {
    this.params = params;
    this.profile = new Profile(params);
    this.N = Math.max(2, params.spine.joints | 0);
    this.L = params.scale;

    // Even spacing in body coordinate.
    this.sAt = [];
    this.xAt = [];
    for (let i = 0; i < this.N; i++) {
      const s = i / (this.N - 1);
      this.sAt.push(s);
      this.xAt.push(this.profile.xAt(s));
    }

    this.pivot = this._nearestBone(pivotS);

    // Create bones.
    this.bones = [];
    for (let i = 0; i < this.N; i++) this.bones.push(new THREE.Bone());

    const root = this.bones[this.pivot];
    root.position.set(this.xAt[this.pivot], 0, 0);

    // Forward (head) branch: pivot-1, pivot-2, ... 0. Each is a child of the one
    // nearer the pivot, offset by the gap in +X.
    for (let i = this.pivot - 1; i >= 0; i--) {
      const parent = this.bones[i + 1];
      parent.add(this.bones[i]);
      this.bones[i].position.set(this.xAt[i] - this.xAt[i + 1], 0, 0);
    }
    // Tail branch: pivot+1 ... N-1, offset by the gap in -X.
    for (let i = this.pivot + 1; i < this.N; i++) {
      const parent = this.bones[i - 1];
      parent.add(this.bones[i]);
      this.bones[i].position.set(this.xAt[i] - this.xAt[i - 1], 0, 0);
    }

    this.root = root;
    // The Skeleton is constructed from the index-ordered array so skinIndex maps
    // correctly. Inverses are captured from the straight rest pose below.
    root.updateMatrixWorld(true);
    this.skeleton = new THREE.Skeleton(this.bones);
  }

  _nearestBone(s) {
    let best = 0;
    let bestd = Infinity;
    for (let i = 0; i < this.N; i++) {
      const d = Math.abs(i / (this.N - 1) - s);
      if (d < bestd) { bestd = d; best = i; }
    }
    return best;
  }

  /**
   * Pose the spine to a centreline.
   *
   * @param centreline  function(s) -> lateral offset in world units. This is the
   *                    prescribed shape of the backbone at the current instant.
   * @param plane       0 = lateral bending (about Y), 1 = dorsoventral (about Z).
   *                    Cetaceans pass 1; this single number rotates the whole
   *                    propulsion plane 90 degrees.
   *
   * Each bone's local rotation is the change in centreline heading across its
   * segment, so the chain traces the curve by finite differences. Headings are
   * measured relative to the pivot so the pivot itself stays put.
   */
  pose(centreline, plane = 0) {
    const N = this.N;
    const heading = new Array(N);
    const ds = 0.5 / (N - 1);
    for (let i = 0; i < N; i++) {
      const s = this.sAt[i];
      const sa = Math.max(0, s - ds);
      const sb = Math.min(1, s + ds);
      const dLat = centreline(sb) - centreline(sa);
      const dX = this.profile.xAt(sb) - this.profile.xAt(sa); // negative
      heading[i] = Math.atan2(dLat, -dX); // -dX so +s (tailward travel) reads forward
    }
    const ref = heading[this.pivot];

    const yAxis = 1 - plane;
    const zAxis = plane;

    // Root: only whole-body heading (kept at reference => 0 local).
    this.bones[this.pivot].rotation.set(0, 0, 0);

    // Tail branch: local angle = heading[i] - heading[i-1].
    for (let i = this.pivot + 1; i < N; i++) {
      const a = heading[i] - heading[i - 1];
      this.bones[i].rotation.set(0, a * yAxis, a * zAxis);
    }
    // Head branch: walking toward the snout, the parent is i+1. The sign flips
    // because segment direction reverses.
    for (let i = this.pivot - 1; i >= 0; i--) {
      const a = heading[i] - heading[i + 1];
      this.bones[i].rotation.set(0, a * yAxis, a * zAxis);
    }
    void ref;
  }

  dispose() {
    this.skeleton.dispose?.();
  }
}
