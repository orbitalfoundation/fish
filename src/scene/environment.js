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
  // Underwater column: bright surface light up top, deepening to dark blue below.
  // The horizon band (where the camera usually looks) is a legible mid-blue, not
  // black -- that was the whole "why is it pure black" problem: the old gradient
  // put the darkest value right at eye level.
  const surfaceCol = new THREE.Color(0x4f9ac2); // sunlit surface
  const midCol = new THREE.Color(0x123f5c); // horizon water
  const deepCol = new THREE.Color(0x040f1c); // below, into the dark

  const domeGeo = new THREE.SphereGeometry(1, 48, 32);
  const domeMat = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    uniforms: {
      uSurface: { value: surfaceCol }, uMid: { value: midCol }, uDeep: { value: deepCol },
      uTime: { value: 0 },
    },
    vertexShader: `varying vec3 vDir; void main(){ vDir = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
    fragmentShader: /* glsl */`
      varying vec3 vDir;
      uniform vec3 uSurface, uMid, uDeep;
      uniform float uTime;

      // Cheap animated caustic/shimmer: layered advected sine cells.
      float caustic(vec2 p, float t){
        vec2 q = p;
        float v = 0.0, amp = 0.5;
        for(int i=0;i<3;i++){
          q += vec2(sin(q.y*1.7 + t), cos(q.x*1.7 - t)) * 0.6;
          v += amp * (0.5 + 0.5*sin(q.x*2.3)*cos(q.y*2.1));
          amp *= 0.55; t *= 1.3; q *= 1.8;
        }
        return pow(clamp(v, 0.0, 1.0), 3.0);
      }

      void main(){
        vec3 nd = normalize(vDir);
        float h = nd.y;                       // -1 down .. +1 up

        // Vertical gradient, lighter toward the surface.
        vec3 col = mix(uMid, uDeep, smoothstep(-0.05, -0.75, h));
        col = mix(col, uSurface, smoothstep(0.02, 0.85, h));

        // God-ray shafts descending from the surface, strongest overhead.
        float a = atan(nd.z, nd.x);
        float rays = sin(a*7.0 + uTime*0.09)
                   + 0.6*sin(a*15.0 - uTime*0.12)
                   + 0.4*sin(a*27.0 + uTime*0.06);
        rays = max(rays, 0.0) / 2.0;
        float rayMask = smoothstep(0.05, 1.0, h) * rays * rays;
        col += uSurface * rayMask * 0.5;

        // Caustic shimmer, concentrated near the surface.
        float c = caustic(nd.xz * 5.0 + vec2(0.0, uTime*0.05), uTime*0.4);
        col += vec3(0.45,0.72,0.92) * c * smoothstep(0.15, 1.0, h) * 0.14;

        gl_FragColor = vec4(col, 1.0);
      }`,
  });
  const dome = new THREE.Mesh(domeGeo, domeMat);
  dome.renderOrder = -1;
  dome.frustumCulled = false;
  scene.add(dome);

  // Fog tinted to the horizon water, so distance fades to blue haze (never black).
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
    update(t, camera) {
      domeMat.uniforms.uTime.value = t;
      // Keep the sky-dome centred on the camera and sized inside the frustum, so
      // it always fills the background regardless of how the far plane is scaled
      // for the current animal (a whale's far plane is huge, a minnow's tiny).
      if (camera) {
        dome.position.copy(camera.position);
        dome.scale.setScalar((camera.far - camera.near) * 0.45);
      }
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
