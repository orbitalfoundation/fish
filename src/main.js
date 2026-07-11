import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import GUI from 'lil-gui';

import { makeSpecies, SPECIES, SPECIES_ORDER } from './species/presets.js';
import { morphParams, applySwimMode, SWIM_MODES, RD_PRESETS } from './core/params.js';
import { encodeGenome, encodeGenomeSync, decodeGenome } from './genome.js';
import { clone } from './core/math.js';
import { FishRig } from './rig/FishRig.js';
import { BRAINS } from './rig/behavior.js';
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
// What the URL encoder diffs `params` against: the preset ({s}) or morph pair
// ({s,b,t}) the current fish started from. See src/genome.js.
let genomeBase = { s: 'minnow' };
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
  } else {
    // Keep the current viewing angle but re-fit the distance to the new size, so
    // morphing a minnow into a whale backs the camera off instead of leaving it
    // buried inside the animal.
    const dir = camera.position.clone().sub(controls.target);
    if (dir.lengthSq() < 1e-9) dir.set(0, 0, 1);
    dir.normalize();
    camera.position.copy(controls.target).addScaledVector(dir, dist);
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
gui.domElement.id = 'gui-panel'; // ID so the pull-up-bar CSS wins over lil-gui's own positioning
// Hide lil-gui's own root title bar — our #panel-tab is the single pull-up control,
// so the built-in "fish rig" bar was a confusing second one.
if (gui.$title) gui.$title.style.display = 'none';

/**
 * Overwrite `params` IN PLACE from a source tree, preserving the identity of the
 * object and every nested object (swim, surface, pattern, ...). This is what lets
 * every GUI controller and the RD sim keep their live binding across a species
 * switch or a morph — replacing `params` wholesale silently orphaned them, so
 * surface/pattern edits landed on a discarded copy and appeared to do nothing.
 */
function syncInto(target, source) {
  if (Array.isArray(source)) {
    target.length = 0;
    for (const v of source) target.push(clone(v));
    return;
  }
  for (const k of Object.keys(target)) if (!(k in source)) delete target[k];
  for (const k of Object.keys(source)) {
    const sv = source[k];
    if (sv && typeof sv === 'object') {
      const isArr = Array.isArray(sv);
      if (!target[k] || typeof target[k] !== 'object' || Array.isArray(target[k]) !== isArr) {
        target[k] = isArr ? [] : {};
      }
      syncInto(target[k], sv);
    } else {
      target[k] = sv;
    }
  }
}

// Keep the URL in sync with the fish as it's edited, so people can just copy it
// from the address bar. Debounced (encoding the whole tree on every slider frame
// would be wasteful), and replaceState so it doesn't spam browser history.
let urlTimer = 0, urlSeq = 0;
function scheduleUrlUpdate() {
  clearTimeout(urlTimer);
  urlTimer = setTimeout(async () => {
    const seq = ++urlSeq;
    const code = await encodeGenome(params, genomeBase);
    // A newer edit may have started encoding while we awaited; let it win.
    if (seq === urlSeq) history.replaceState(null, '', `${location.origin}${location.pathname}#fish=${code}`);
  }, 500);
}

function setSpecies(id) {
  currentSpecies = id;
  ui.morph = 0;
  genomeBase = { s: id };
  syncInto(params, makeSpecies(id));
  rd.reseed(params.pattern.seed, params.pattern.seedMode);
  rd.settle();
  rebuild(false);
  highlightSpecies(id);
  refreshControllers();
  scheduleUrlUpdate();
}

function applyMorph() {
  const a = makeSpecies(currentSpecies);
  const b = makeSpecies(ui.blendTo);
  genomeBase = ui.morph > 0 ? { s: currentSpecies, b: ui.blendTo, t: ui.morph } : { s: currentSpecies };
  syncInto(params, morphParams(a, b, ui.morph));
  rebuild(true);
  refreshControllers();
  scheduleUrlUpdate();
}

// -- Explore folder
const fExplore = gui.addFolder('explore');

// One-tap species chips instead of a dropdown (a dropdown is two taps, and worse
// on touch). The active species is highlighted.
const SPECIES_LABELS = {
  minnow: 'Minnow', clownfish: 'Clownfish', angelfish: 'Angelfish', boxfish: 'Boxfish',
  pufferfish: 'Puffer', tuna: 'Tuna', eel: 'Eel', orca: 'Orca', bluewhale: 'Whale',
};
const speciesChips = {};
function highlightSpecies(id) {
  for (const k in speciesChips) speciesChips[k].classList.toggle('active', k === id);
}
(function buildSpeciesChips() {
  const bar = document.createElement('div');
  bar.className = 'species-chips';
  for (const id of SPECIES_ORDER) {
    const b = document.createElement('button');
    b.className = 'chip';
    b.textContent = SPECIES_LABELS[id] || id;
    b.addEventListener('click', () => setSpecies(id));
    speciesChips[id] = b;
    bar.appendChild(b);
  }
  const container = fExplore.$children || fExplore.domElement;
  container.insertBefore(bar, container.firstChild);
})();

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
fLoco.add(params.behavior, 'brain', Object.keys(BRAINS)).name('temperament').onChange((b) => {
  if (rig) rig.behavior.set(BRAINS[b]);
  updateLabels();
});
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

// -- Share (top-level, always visible): copy a link that encodes this exact fish.
gui.add({ share: shareFish }, 'share').name('🔗 copy link to this fish');

function onSurface() {
  applyBodySurface(materials.body, params.surface, params.pattern);
  applyFinSurface(materials.fin, params.surface);
}

// `params` keeps its identity across species/morph (see syncInto), so controllers
// stay bound — a refresh is just re-reading the new values into the widgets.
function refreshControllers() {
  for (const c of gui.controllersRecursive()) c.updateDisplay();
}

// Mobile: the control panel is a pull-up bottom sheet (see index.html CSS). The
// tab toggles it; collapse it again after a slider drag would be annoying, so it
// stays open until tapped closed. Also fold the panel by default on small screens.
const panelTab = document.getElementById('panel-tab');
gui.domElement.addEventListener('click', (e) => { e.stopPropagation(); });

// When the panel is up as a full-width bottom sheet (mobile), it hides the lower
// half of the screen — but the fish is centred, so half of it disappears behind
// the panel. Pan the camera up (setViewOffset, no zoom) so the fish re-centres in
// the visible area above the panel. On desktop the panel is a narrow bottom-left
// card and doesn't cover the fish, so no offset is applied.
function updateViewOffset() {
  const bottomSheet = matchMedia('(max-width: 560px), (pointer: coarse)').matches;
  const open = document.body.classList.contains('panel-open');
  if (bottomSheet && open) {
    const panelTop = gui.domElement.getBoundingClientRect().top;
    const hidden = Math.max(0, innerHeight - panelTop); // px covered at the bottom
    camera.setViewOffset(innerWidth, innerHeight, 0, hidden / 2, innerWidth, innerHeight);
  } else {
    camera.clearViewOffset();
  }
}

panelTab?.addEventListener('click', () => {
  const opening = !document.body.classList.contains('panel-open');
  document.body.classList.toggle('panel-open');
  // Wait for the slide-up transition before measuring the panel's height.
  if (opening) setTimeout(updateViewOffset, 330); else updateViewOffset();
});

// Open by default on roomy screens (discoverability); collapsed on phones so the
// fish isn't covered.
if (innerWidth > 560) document.body.classList.add('panel-open');

// ---- shareable genome in the URL ---------------------------------------------
// A fish is encoded as its baseline preset/morph plus only the tweaked leaves
// (see src/genome.js), so a typical link is <100 chars instead of the old ~3k
// whole-tree base64 — which still decodes, for links already in the wild.
function shareFish() {
  // Prefer the synchronous diff encoding: the clipboard write then happens
  // inside the click gesture (Safari drops permission across an await).
  const fast = encodeGenomeSync(params, genomeBase);
  if (fast !== null) copyShareUrl(fast);
  else encodeGenome(params, genomeBase).then(copyShareUrl);
}
function copyShareUrl(code) {
  const url = `${location.origin}${location.pathname}#fish=${code}`;
  history.replaceState(null, '', url);
  if (navigator.clipboard) navigator.clipboard.writeText(url).then(() => toast('link copied — share your fish!'), () => toast('copy failed — URL is in the address bar'));
  else toast('URL updated — copy it from the address bar');
}
async function loadGenomeFromHash() {
  const m = location.hash.match(/#fish=(.+)/);
  if (!m) return false;
  try {
    const { params: tree, base } = await decodeGenome(m[1]);
    syncInto(params, tree);
    // Legacy whole-tree links carry no baseline; diff future edits against the
    // species they claim to be (or minnow if the id is unrecognized).
    genomeBase = base ?? { s: SPECIES[params.id] ? params.id : 'minnow' };
    if (base === null) {
      // Promote old-style links to the compact format in the address bar, so
      // anything re-shared from here is short.
      const code = await encodeGenome(params, genomeBase);
      history.replaceState(null, '', `${location.origin}${location.pathname}#fish=${code}`);
    }
    return true;
  } catch (e) { console.warn('bad fish code in URL', e); return false; }
}
let toastTimer = 0;
function toast(msg) {
  let el = document.getElementById('toast');
  if (!el) {
    el = document.createElement('div');
    el.id = 'toast';
    el.style.cssText = 'position:fixed;left:50%;top:24px;transform:translateX(-50%);z-index:30;padding:9px 16px;border-radius:999px;background:rgba(20,32,44,.94);color:#eaf2f8;font:600 12px ui-sans-serif,system-ui,sans-serif;box-shadow:0 4px 16px rgba(0,0,0,.4);transition:opacity .3s;backdrop-filter:blur(6px);';
    document.body.appendChild(el);
  }
  el.textContent = msg;
  el.style.opacity = '1';
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.style.opacity = '0'; }, 2200);
}

// Any GUI edit refreshes the shareable URL (debounced inside).
gui.onChange(scheduleUrlUpdate);

// ---- boot ---------------------------------------------------------------------
// Async because a z:-compressed genome inflates through DecompressionStream.
// The IIFE's first await defers the rest past the module body, so everything
// below (clock, hud, animate) exists by the time it resumes.
(async () => {
  const sharedFish = await loadGenomeFromHash();
  if (sharedFish) {
    currentSpecies = genomeBase.s;
    // A morph link restores the blend controls too, so the slider keeps
    // working from where the shared fish was.
    if (genomeBase.b != null) { ui.blendTo = genomeBase.b; ui.morph = genomeBase.t; }
    rd.reseed(params.pattern.seed, params.pattern.seedMode);
    rd.settle();
  }
  rebuild(false);
  highlightSpecies(currentSpecies);
  refreshControllers();
  document.getElementById('loader').style.opacity = '0';
  setTimeout(() => document.getElementById('loader')?.remove(), 700);
  animate();
})();

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
  env.update(shared.time.value, camera);
  controls.update();
  renderer.render(scene, camera);

  frames++; fpsT += dt;
  if (fpsT >= 0.5) { fps = Math.round(frames / fpsT); frames = 0; fpsT = 0; }
  hud.textContent =
    `${params.id}  ·  ${rig.swimmer.freq.toFixed(2)} Hz  ·  ${(rig.span).toFixed(2)} m  ·  ${fps} fps`;
}

addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
  updateViewOffset();
});

// expose for console tinkering
window.FISH = {
  get params() { return params; },
  rig: () => rig, rd, setSpecies, share: shareFish,
  encode: () => encodeGenome(params, genomeBase),
};
