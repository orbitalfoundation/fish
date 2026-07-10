import * as THREE from 'three';
import { mulberry32 } from '../core/math.js';

/**
 * Live Gray-Scott reaction-diffusion on the GPU.
 *
 *   dU/dt = Du*lap(U) - U*V^2 + F*(1-U)
 *   dV/dt = Dv*lap(V) + U*V^2 - (F+k)*V
 *
 * U is stored in R, V in G of a half-float ping-pong target. The fish material
 * samples V as its melanophore (dark pigment) mask. Running it live rather than
 * baking a static texture is the whole point: at the "worms"/"labyrinth" F,k the
 * stripes slowly branch and rearrange, reproducing the growing-fish pattern that
 * Kondo & Asai (1995) filmed on a live angelfish.
 *
 * Anisotropy scales the Laplacian along the texture X axis (which the fish
 * material maps to body length). Boosting diffusion along an axis suppresses
 * variation along it (Shoji, Iwasa & Kondo 2002), so anisotropy > 1 gives
 * head-to-tail stripes and anisotropy < 1 gives dorsoventral bars.
 */

const QUAD_VS = /* glsl */ `
varying vec2 vUv;
void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }
`;

const STEP_FS = /* glsl */ `
precision highp float;
varying vec2 vUv;
uniform sampler2D uState;
uniform vec2 uTexel;
uniform float uFeed, uKill, uDu, uDv, uDt, uAniso;

vec2 samp(vec2 uv) { return texture2D(uState, uv).xy; }

void main() {
  vec2 c = samp(vUv);
  // 9-point weighted Laplacian (Karl Sims): center -1, edges .2, corners .05,
  // with an anisotropic scale on the X (body-length) axis. The split is BOUNDED
  // (ax + ay = 2, each in (0,2)) rather than ax=a, ay=1/a: an unbounded 1/a makes
  // the explicit diffusion step blow up for a<1 (the field saturates to a solid
  // mask instead of forming stripes). This keeps it stable across the whole range.
  float ax = 2.0 * uAniso / (1.0 + uAniso); // along body
  float ay = 2.0 / (1.0 + uAniso);          // around body
  vec2 e = uTexel;
  vec2 lap = vec2(0.0);
  lap += (samp(vUv + vec2( e.x, 0.0)) + samp(vUv + vec2(-e.x, 0.0))) * (0.2 * ax);
  lap += (samp(vUv + vec2(0.0,  e.y)) + samp(vUv + vec2(0.0, -e.y))) * (0.2 * ay);
  lap += (samp(vUv + vec2( e.x,  e.y)) + samp(vUv + vec2(-e.x,  e.y))
        + samp(vUv + vec2( e.x, -e.y)) + samp(vUv + vec2(-e.x, -e.y))) * 0.05;
  float wsum = 0.2 * ax * 2.0 + 0.2 * ay * 2.0 + 0.05 * 4.0;
  lap -= c * wsum;

  float u = c.x, v = c.y;
  float reaction = u * v * v;
  float du = uDu * lap.x - reaction + uFeed * (1.0 - u);
  float dv = uDv * lap.y + reaction - (uFeed + uKill) * v;
  vec2 n = c + uDt * vec2(du, dv);
  gl_FragColor = vec4(clamp(n, 0.0, 1.0), 0.0, 1.0);
}
`;

export class ReactionDiffusion {
  constructor(renderer, params) {
    this.renderer = renderer;
    this.p = params.pattern;
    this._make();
    this.reseed(this.p.seed, this.p.seedMode);
    this.settled = false;
  }

  _make() {
    const { width, height } = this.p;
    const opts = {
      type: THREE.HalfFloatType,
      format: THREE.RGBAFormat,
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
      wrapS: THREE.RepeatWrapping,
      wrapT: THREE.RepeatWrapping,
      depthBuffer: false,
    };
    this.rtA = new THREE.WebGLRenderTarget(width, height, opts);
    this.rtB = new THREE.WebGLRenderTarget(width, height, opts);

    this.scene = new THREE.Scene();
    this.cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    this.mat = new THREE.ShaderMaterial({
      vertexShader: QUAD_VS,
      fragmentShader: STEP_FS,
      uniforms: {
        uState: { value: null },
        uTexel: { value: new THREE.Vector2(1 / width, 1 / height) },
        uFeed: { value: this.p.feed },
        uKill: { value: this.p.kill },
        uDu: { value: this.p.du },
        uDv: { value: this.p.dv },
        uDt: { value: this.p.dt },
        uAniso: { value: this.p.anisotropy },
      },
    });
    this.quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.mat);
    this.scene.add(this.quad);
  }

  get texture() {
    return this.rtA.texture;
  }

  reseed(seed = 7, mode = 'blobs') {
    const { width: w, height: h } = this.p;
    const data = new Uint8Array(w * h * 4); // seed via a data texture, then upload
    const rnd = mulberry32((seed | 0) * 2654435761 + 12345);
    const buf = new Float32Array(w * h * 2);
    for (let i = 0; i < w * h; i++) { buf[i * 2] = 1; buf[i * 2 + 1] = 0; }

    const stamp = (cx, cy, rad) => {
      for (let y = -rad; y <= rad; y++) {
        for (let x = -rad; x <= rad; x++) {
          if (x * x + y * y > rad * rad) continue;
          const px = ((cx + x) % w + w) % w;
          const py = ((cy + y) % h + h) % h;
          const idx = (py * w + px) * 2;
          buf[idx] = 0.5;
          buf[idx + 1] = 0.9;
        }
      }
    };

    if (mode === 'bands') {
      for (let bx = 0; bx < w; bx += Math.floor(w / 10)) {
        for (let y = 0; y < h; y++) stamp(bx, y, 1);
      }
    } else if (mode === 'bars') {
      for (let by = 0; by < h; by += Math.floor(h / 8)) {
        for (let x = 0; x < w; x++) stamp(x, by, 1);
      }
    } else {
      const n = Math.floor((w * h) / 900);
      for (let i = 0; i < n; i++) stamp((rnd() * w) | 0, (rnd() * h) | 0, 2 + ((rnd() * 3) | 0));
    }

    // Upload floats via a FloatType data texture blit.
    const tex = new THREE.DataTexture(
      floatToRGBA(buf, w, h), w, h, THREE.RGBAFormat, THREE.FloatType
    );
    tex.needsUpdate = true;
    const blitMat = new THREE.MeshBasicMaterial({ map: tex });
    const blit = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), blitMat);
    const scene = new THREE.Scene();
    scene.add(blit);
    const prev = this.renderer.getRenderTarget();
    this.renderer.setRenderTarget(this.rtA);
    this.renderer.render(scene, this.cam);
    this.renderer.setRenderTarget(this.rtB);
    this.renderer.render(scene, this.cam);
    this.renderer.setRenderTarget(prev);
    tex.dispose(); blitMat.dispose(); blit.geometry.dispose();
    void data;
    this.settled = false;
  }

  syncUniforms() {
    this.mat.uniforms.uFeed.value = this.p.feed;
    this.mat.uniforms.uKill.value = this.p.kill;
    this.mat.uniforms.uDu.value = this.p.du;
    this.mat.uniforms.uDv.value = this.p.dv;
    this.mat.uniforms.uDt.value = this.p.dt;
    this.mat.uniforms.uAniso.value = this.p.anisotropy;
  }

  step(count) {
    this.syncUniforms();
    const prev = this.renderer.getRenderTarget();
    const xr = this.renderer.xr.enabled; this.renderer.xr.enabled = false;
    for (let i = 0; i < count; i++) {
      this.mat.uniforms.uState.value = this.rtA.texture;
      this.renderer.setRenderTarget(this.rtB);
      this.renderer.render(this.scene, this.cam);
      const tmp = this.rtA; this.rtA = this.rtB; this.rtB = tmp;
    }
    this.renderer.setRenderTarget(prev);
    this.renderer.xr.enabled = xr;
  }

  settle() {
    const total = this.p.settleSteps | 0;
    const batch = 200;
    for (let done = 0; done < total; done += batch) this.step(Math.min(batch, total - done));
    this.settled = true;
  }

  update() {
    if (this.p.live) this.step(this.p.stepsPerFrame | 0);
  }

  dispose() {
    this.rtA.dispose(); this.rtB.dispose();
    this.mat.dispose(); this.quad.geometry.dispose();
  }
}

function floatToRGBA(buf2, w, h) {
  const out = new Float32Array(w * h * 4);
  for (let i = 0; i < w * h; i++) {
    out[i * 4] = buf2[i * 2];
    out[i * 4 + 1] = buf2[i * 2 + 1];
    out[i * 4 + 2] = 0;
    out[i * 4 + 3] = 1;
  }
  return out;
}
