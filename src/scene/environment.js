import * as THREE from 'three';

/**
 * The water. A vertical gradient sky-dome, exponential depth fog, and a small
 * light rig standing in for sun filtered through a surface: a warm-cool key from
 * above, a deep-blue ambient fill, and a dim back rim to catch the iridescence.
 *
 * Everything is authored in body lengths and rescaled per animal by setScale, so
 * the same rig frames a 7 cm minnow and a 26 m whale without the fog swallowing
 * one or the lights being lost around the other. A cheap PMREM of the gradient
 * feeds the PBR reflections that make the clearcoat and iridescence read.
 */
export function buildEnvironment(scene, renderer) {
  const topCol = new THREE.Color(0x1a3a52);
  const midCol = new THREE.Color(0x0a1c2c);
  const deepCol = new THREE.Color(0x03080e);

  // Gradient dome (rendered from the inside).
  const domeGeo = new THREE.SphereGeometry(1, 32, 24);
  const domeMat = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    uniforms: {
      uTop: { value: topCol }, uMid: { value: midCol }, uDeep: { value: deepCol },
      uTime: { value: 0 },
    },
    vertexShader: `varying vec3 vDir; void main(){ vDir = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
    fragmentShader: `
      varying vec3 vDir; uniform vec3 uTop, uMid, uDeep; uniform float uTime;
      void main(){
        float h = normalize(vDir).y;
        vec3 c = mix(uMid, uDeep, smoothstep(0.0, -0.6, h));
        c = mix(c, uTop, smoothstep(0.05, 0.9, h));
        // faint god-ray banding drifting near the surface
        float ray = 0.04 * smoothstep(0.2,1.0,h) * (0.5+0.5*sin(vDir.x*3.0 + uTime*0.15));
        gl_FragColor = vec4(c + ray, 1.0);
      }`,
  });
  const dome = new THREE.Mesh(domeGeo, domeMat);
  dome.scale.setScalar(500);
  scene.add(dome);

  scene.fog = new THREE.FogExp2(midCol.getHex(), 0.02);
  // Keep reflected environment modest so near-black skin (orca) stays black and
  // pale bodies don't wash out.
  scene.environmentIntensity = 0.5;

  // Lights: a strong sun-through-water key for form, a restrained blue fill, and
  // a cool back rim to catch the iridescence.
  const key = new THREE.DirectionalLight(0xfff2d6, 2.6);
  key.position.set(0.5, 3, 1.2);
  scene.add(key);

  const fill = new THREE.HemisphereLight(0x4a7ea8, 0x02060a, 0.55);
  scene.add(fill);

  const rim = new THREE.DirectionalLight(0x3f7faa, 1.15);
  rim.position.set(-1.5, 0.5, -2.0);
  scene.add(rim);

  const caustic = new THREE.PointLight(0xbfe6ff, 0.0, 0, 2);
  caustic.position.set(0, 4, 0);
  scene.add(caustic);

  // Environment reflections from the gradient.
  const pmrem = new THREE.PMREMGenerator(renderer);
  pmrem.compileEquirectangularShader();
  const envScene = new THREE.Scene();
  const envDome = new THREE.Mesh(domeGeo, domeMat.clone());
  envDome.scale.setScalar(10);
  envScene.add(envDome);
  envScene.add(new THREE.HemisphereLight(0x5a90b8, 0x03080e, 1.0));
  const envRT = pmrem.fromScene(envScene);
  scene.environment = envRT.texture;

  return {
    setScale(s) {
      // Fog thins for big animals so a whale doesn't vanish; lights push out.
      scene.fog.density = 0.28 / (s + 0.4);
      key.position.set(s * 0.5, s * 3, s * 1.2);
      rim.position.set(-s * 1.5, s * 0.5, -s * 2.0);
    },
    update(t) {
      domeMat.uniforms.uTime.value = t;
    },
  };
}

/**
 * Marine snow: slow-drifting motes that give the water depth and scale. Points
 * recycle within a box sized to the animal.
 */
export function buildMarineSnow(scene, count = 900) {
  const geo = new THREE.BufferGeometry();
  const pos = new Float32Array(count * 3);
  const spd = new Float32Array(count);
  for (let i = 0; i < count; i++) {
    pos[i * 3] = (Math.random() * 2 - 1);
    pos[i * 3 + 1] = (Math.random() * 2 - 1);
    pos[i * 3 + 2] = (Math.random() * 2 - 1);
    spd[i] = 0.2 + Math.random() * 0.8;
  }
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));

  const mat = new THREE.PointsMaterial({
    color: 0xbcd4e6, size: 0.01, transparent: true, opacity: 0.5,
    depthWrite: false, blending: THREE.AdditiveBlending, sizeAttenuation: true,
  });
  const points = new THREE.Points(geo, mat);
  points.frustumCulled = false;
  scene.add(points);

  let box = 1;
  return {
    points,
    setScale(s) {
      box = s * 2.2;
      points.scale.setScalar(box);
      mat.size = s * 0.006;
    },
    update(dt) {
      const p = geo.attributes.position.array;
      for (let i = 0; i < count; i++) {
        p[i * 3 + 1] -= spd[i] * dt * 0.05;
        p[i * 3] += Math.sin((p[i * 3 + 1] + i) * 2.0) * dt * 0.01;
        if (p[i * 3 + 1] < -1) p[i * 3 + 1] = 1;
      }
      geo.attributes.position.needsUpdate = true;
    },
  };
}
