import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import GUI from 'lil-gui';

import { makeSpecies, SPECIES_ORDER } from './species/presets.js';
import { morphParams, applySwimMode, SWIM_MODES, RD_PRESETS } from './core/params.js';
import { FishRig } from './rig/FishRig.js';
import { ReactionDiffusion } from './pattern/reactionDiffusion.js';
import { buildEnvironment, buildMarineSnow } from './scene/environment.js';
import { applyBodySurface, applyFinSurface } from './shading/FishMaterial.js';

const app = document.getElementById('app');

// ---- renderer / scene / camera ------------------------------------------------
const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;
renderer.outputColorSpace = THREE.SRGBColorSpace;
app.appendChild(renderer.domElement);

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(42, innerWidth / innerHeight, 0.01, 2000);

const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.dampingFactor = 0.06;
controls.autoRotateSpeed = 0.6;
controls.minDistance = 0.05;
controls.maxDistance = 400;

const env = buildEnvironment(scene, renderer);
const snow = buildMarineSnow(scene);

const shared = { time: { value: 0 } };

// ---- reaction-diffusion (persistent across rig rebuilds) ----------------------
let params = makeSpecies('minnow');
const rd = new ReactionDiffusion(renderer, params);
rd.settle();

// ---- the fish -----------------------------------------------------------------
let materials = null;
let rig = null;
let currentSpecies = 'minnow';

function frameCamera(preserve = false) {
  const s = rig.span;
  const dist = s * 1.9 + 0.12;
  if (!preserve) {
    camera.position.set(s * 0.7, s * 0.32, dist);
    controls.target.set(0, 0, 0);
  }
  camera.near = Math.max(0.001, s * 0.01);
  camera.far = s * 400 + 100;
  camera.updateProjectionMatrix();
  // Keep the light rig and fog scaled to the animal so a whale and a minnow both
  // sit in believable water.
  env.setScale(s);
  snow.setScale(s);
}

function rebuild(preserveCamera = true) {
  const wasMat = materials;
  if (rig) { scene.remove(rig); rig.dispose(false); }
  rig = new FishRig(params, rd.texture, shared, wasMat);
  materials = rig.materials;
  scene.add(rig);
  // RD holds a live reference to the pattern block; repoint it after a rebuild.
  rd.p = params.pattern;
  frameCamera(preserveCamera);
  updateLabels();
}

function updateLabels() {
  document.getElementById('species-name').textContent = params.displayName;
  const sw = params.swim;
  document.getElementById('mode-line').textContent =
    `${sw.plane > 0.5 ? 'dorsoventral' : 'lateral'} · ${sw.waves.toFixed(2)} waves · St ${sw.strouhal.toFixed(2)}`;
}

// ---- GUI ----------------------------------------------------------------------
const ui = {
  species: 'minnow',
  blendTo: 'tuna',
  morph: 0,
  swimMode: 'subcarangiform',
  patternPreset: 'worms',
  autoRotate: false,
  paused: false,
  showSnow: true,
};

const gui = new GUI({ title: '🐟 fish rig' });

function setSpecies(id) {
  currentSpecies = id;
  ui.morph = 0;
  params = makeSpecies(id);
  rd.p = params.pattern;
  rd.reseed(params.pattern.seed, params.pattern.seedMode);
  rd.settle();
  rebuild(false);
  refreshControllers();
}

function applyMorph() {
  const a = makeSpecies(currentSpecies);
  const b = makeSpecies(ui.blendTo);
  params = morphParams(a, b, ui.morph);
  rebuild(true);
  refreshControllers();
}

// -- Explore folder
const fExplore = gui.addFolder('explore');
fExplore.add(ui, 'species', SPECIES_ORDER).name('species').onChange(setSpecies);
fExplore.add(ui, 'blendTo', SPECIES_ORDER).name('blend toward');
fExplore.add(ui, 'morph', 0, 1, 0.001).name('blend amount').onChange(applyMorph).listen();

// -- Locomotion
const fLoco = gui.addFolder('locomotion');
fLoco.add(ui, 'swimMode', Object.keys(SWIM_MODES)).name('BCF mode').onChange((m) => {
  applySwimMode(params, m);
  rig.swimmer.set(params);
  refreshControllers();
  updateLabels();
});
const cSpeed = fLoco.add(params.swim, 'speedBL', 0, 6, 0.01).name('speed (BL/s)').onChange(onSwim);
const cStrouhal = fLoco.add(params.swim, 'strouhal', 0.1, 0.6, 0.005).name('Strouhal').onChange(onSwim);
const cWaves = fLoco.add(params.swim, 'waves', 0, 2.5, 0.01).name('waves on body').onChange(onSwimLabels);
const cGain = fLoco.add(params.swim.envelope, 'gain', 0, 2.5, 0.01).name('amplitude').onChange(onSwim);
const cStiff = fLoco.add(params.swim.envelope, 'stiffness', 0, 1, 0.01).name('anterior stiffness').onChange(onSwim);
const cPlane = fLoco.add(params.swim, 'plane', 0, 1, 0.01).name('plane (lat→dorsoven)').onChange(() => rebuild(true));
const cTurn = fLoco.add(params.swim, 'turn', -1, 1, 0.01).name('turn bias').onChange(onSwim);
const cIdle = fLoco.add(params.swim, 'idle', 0, 1, 0.01).name('idle drift').onChange(onSwim);
fLoco.close();

function onSwim() { rig.swimmer.set(params); }
function onSwimLabels() { rig.swimmer.set(params); updateLabels(); }

// -- Body shape (structural rebuilds)
const fBody = gui.addFolder('body shape');
const cScale = fBody.add(params, 'scale', 0.02, 30, 0.01).name('length (m)').onChange(() => structural());
const cDorsalPeak = fBody.add(params.body.dorsal, 'peak', 0.01, 0.35, 0.001).name('back depth').onChange(structural);
const cVentralPeak = fBody.add(params.body.ventral, 'peak', 0.01, 0.35, 0.001).name('belly depth').onChange(structural);
const cWidth = fBody.add(params.body, 'widthRatio', 0.1, 1.0, 0.01).name('width / depth').onChange(structural);
const cBox = fBody.add(params.body, 'boxiness', 2, 7, 0.05).name('boxiness').onChange(structural);
const cInflate = fBody.add(params.body, 'inflate', 0, 1, 0.01).name('inflate (puffer)').onChange(structural);
const cGirthD = fBody.add(params.body.dorsal, 'girth', 0.2, 0.6, 0.01).name('girth position').onChange(structural);
fBody.close();

let structuralPending = false;
function structural() { structuralPending = true; }

// -- Pattern (live RD sim)
const fPat = gui.addFolder('pattern (reaction-diffusion)');
fPat.add(ui, 'patternPreset', Object.keys(RD_PRESETS)).name('preset').onChange((k) => {
  Object.assign(params.pattern, RD_PRESETS[k]);
  refreshControllers();
});
const cFeed = fPat.add(params.pattern, 'feed', 0.0, 0.1, 0.0005).name('feed F').listen();
const cKill = fPat.add(params.pattern, 'kill', 0.03, 0.08, 0.0005).name('kill k').listen();
const cAniso = fPat.add(params.pattern, 'anisotropy', 0.2, 5, 0.05).name('anisotropy (bars↔stripes)');
fPat.add(params.pattern, 'threshold', 0, 1, 0.01).name('threshold').onChange(onSurface).listen();
fPat.add(params.pattern, 'softness', 0.005, 0.3, 0.005).name('edge softness').onChange(onSurface).listen();
fPat.add(params.pattern, 'contrast', 0, 1, 0.01).name('contrast').onChange(onSurface).listen();
fPat.add(params.pattern, 'live').name('live evolve');
fPat.add(params.pattern, 'stepsPerFrame', 0, 40, 1).name('sim speed');
fPat.add(params.pattern, 'enabled').name('pattern on').onChange(onSurface);
fPat.add({ reseed: () => { rd.reseed(params.pattern.seed, params.pattern.seedMode); rd.settle(); } }, 'reseed').name('↻ reseed & settle');
fPat.add(params.pattern, 'scaleU', 0.2, 4, 0.05).name('tile along body').onChange(onSurface);
fPat.close();

// -- Surface (live uniforms)
const fSurf = gui.addFolder('surface');
fSurf.addColor(params.surface, 'dorsalColor').name('back').onChange(onSurface);
fSurf.addColor(params.surface, 'flankColor').name('flank').onChange(onSurface);
fSurf.addColor(params.surface, 'bellyColor').name('belly').onChange(onSurface);
fSurf.addColor(params.surface, 'patternColor').name('pattern').onChange(onSurface);
fSurf.add(params.surface, 'countershade', 0, 1, 0.01).name('countershading').onChange(onSurface);
fSurf.add(params.surface, 'iridescence', 0, 1.5, 0.01).name('iridescence').onChange(onSurface);
fSurf.add(params.surface, 'iridFlank', 0, 1, 0.01).name('irid on flank').onChange(onSurface);
fSurf.add(params.surface, 'xantho', 0, 1, 0.01).name('xanthophore (warm)').onChange(onSurface);
fSurf.add(params.surface, 'clearcoat', 0, 1, 0.01).name('mucus clearcoat').onChange(onSurface);
fSurf.add(params.surface, 'roughness', 0.03, 1, 0.01).name('roughness').onChange(onSurface);
fSurf.add(params.surface, 'scaleDensity', 0, 140, 1).name('scale rows').onChange(onSurface);
fSurf.add(params.surface, 'scaleDepth', 0, 1, 0.01).name('scale relief').onChange(onSurface);
fSurf.add(params.surface, 'sss', 0, 1, 0.01).name('translucency').onChange(onSurface);
fSurf.add(params.surface, 'lateralLine', 0, 1, 0.01).name('lateral line').onChange(onSurface);
fSurf.close();

// -- Scene
const fScene = gui.addFolder('scene');
fScene.add(ui, 'autoRotate').name('auto-rotate').onChange((v) => (controls.autoRotate = v));
fScene.add(ui, 'paused').name('pause swim');
fScene.add(ui, 'showSnow').name('marine snow').onChange((v) => (snow.points.visible = v));
fScene.add({ reset: () => frameCamera(false) }, 'reset').name('reset camera');
fScene.close();

function onSurface() {
  applyBodySurface(materials.body, params.surface, params.pattern);
  applyFinSurface(materials.fin, params.surface);
}

// Controllers that need refreshing after params object is replaced.
const liveControllers = [
  cSpeed, cStrouhal, cWaves, cGain, cStiff, cPlane, cTurn, cIdle,
  cScale, cDorsalPeak, cVentralPeak, cWidth, cBox, cInflate, cGirthD,
  cFeed, cKill, cAniso,
];
function refreshControllers() {
  // Re-point each controller at the (possibly new) params object.
  rebindController(cSpeed, params.swim, 'speedBL');
  rebindController(cStrouhal, params.swim, 'strouhal');
  rebindController(cWaves, params.swim, 'waves');
  rebindController(cGain, params.swim.envelope, 'gain');
  rebindController(cStiff, params.swim.envelope, 'stiffness');
  rebindController(cPlane, params.swim, 'plane');
  rebindController(cTurn, params.swim, 'turn');
  rebindController(cIdle, params.swim, 'idle');
  rebindController(cScale, params, 'scale');
  rebindController(cDorsalPeak, params.body.dorsal, 'peak');
  rebindController(cVentralPeak, params.body.ventral, 'peak');
  rebindController(cWidth, params.body, 'widthRatio');
  rebindController(cBox, params.body, 'boxiness');
  rebindController(cInflate, params.body, 'inflate');
  rebindController(cGirthD, params.body.dorsal, 'girth');
  rebindController(cFeed, params.pattern, 'feed');
  rebindController(cKill, params.pattern, 'kill');
  rebindController(cAniso, params.pattern, 'anisotropy');
  for (const c of gui.controllersRecursive()) c.updateDisplay();
}
function rebindController(ctrl, obj, prop) {
  ctrl.object = obj;
  ctrl.property = prop;
  ctrl.updateDisplay();
}

// ---- boot ---------------------------------------------------------------------
rebuild(false);
document.getElementById('loader').style.opacity = '0';
setTimeout(() => document.getElementById('loader')?.remove(), 700);

// ---- loop ---------------------------------------------------------------------
const clock = new THREE.Clock();
const hud = document.getElementById('hud');
let frames = 0, fpsT = 0, fps = 0;

function animate() {
  requestAnimationFrame(animate);
  const dt = Math.min(clock.getDelta(), 0.05);

  if (structuralPending) { structuralPending = false; rebuild(true); }

  rd.update();
  shared.time.value += dt;
  if (!ui.paused) rig.update(dt);
  snow.update(dt);
  env.update(shared.time.value);
  controls.update();
  renderer.render(scene, camera);

  frames++; fpsT += dt;
  if (fpsT >= 0.5) { fps = Math.round(frames / fpsT); frames = 0; fpsT = 0; }
  hud.textContent =
    `${params.id}  ·  ${rig.swimmer.freq.toFixed(2)} Hz  ·  ${(rig.span).toFixed(2)} m  ·  ${fps} fps`;
}
animate();

addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});

// expose for console tinkering
window.FISH = { get params() { return params; }, rig: () => rig, rd, setSpecies };
