# Devlog — Fish simulator: research & first working rig
**2026-07-10**

Building a skeletally accurate, parameterized fish/whale swim rig in Three.js. Goal:
one adaptable bone-driven skinned rig that morphs across minnows → tropical fish →
marine megafauna, accurate and beautiful but real-time and game-like (one hero animal,
orbit camera), not a museum piece. This log is the detailed narrative behind the code;
the `README.md` is the reference.

---

## 1. Research phase

Kicked off four parallel research agents before writing any code, to ground the
parameters in real numbers rather than eyeballing them. Key takeaways that made it into
the code (full citations in the README):

- **One amplitude envelope for everything.** Di Santo et al. 2021 (PNAS, 44 species)
  found a single quadratic `A(s) = 0.05 − 0.13s + 0.28s²` (peak-to-peak, body lengths)
  explains 92% of individuals. The BCF modes (anguilliform→thunniform→ostraciiform)
  differ mainly by **wavelength on the body** and **where undulation starts**, not by
  envelope shape. That collapsed "five locomotion types" into two continuous sliders.
  The negative linear term puts the recoil node at s≈0.23 — which is where I rooted the
  spine.
- **Amplitudes are peak-to-peak.** The famous "tail beat ≈ 0.2 BL" is peak-to-peak;
  lateral offset is half. Noting this up front avoided the classic seizure-fish bug.
- **Drive frequency from the Strouhal number**, not a typed-in Hz. `St = f·A/U`, animals
  cluster 0.2–0.4. This is what keeps a whale from flapping like a guppy when you drag
  the size slider.
- **Cetaceans are a 90° rotation, not a new rig.** Dorsoventral fluke oscillation,
  horizontal fluke, posterior-third flexion. Crucially: fluke pitch is zero at maximum
  displacement and maximal mid-stroke — i.e. proportional to *velocity*. That means a
  velocity-driven trailing model gives correct fluke pitch for free.
- **Fin lag is velocity, not a delay.** Dorsal/anal fins trail their socket by 21–28% of
  a tailbeat. Since a socket's velocity is a quarter-cycle behind its displacement,
  driving fin curl by velocity reproduces the measured lag with zero hand-tuning.
- **Stripes vs bars = anisotropy direction.** Shoji/Iwasa/Kondo 2002: boosting diffusion
  along an axis suppresses variation along it, so stripes run *parallel* to the
  high-diffusion axis. That's the whole bars-vs-stripes control.
- **Anatomy → parameters.** Normalized fin socket positions, caudal-shape series
  (rounded→lunate ↔ slow→fast), body-form archetypes, and the cetacean body plan gave
  the nine species presets.

## 2. Architecture

Kept a hard split between pure math (no THREE) and rendering, so geometry and pose maths
run in a Node smoke test:

- `core/` — the parameter space, envelope/Strouhal maths, morphing (recursive tree-lerp),
  Gray-Scott and BCF-mode presets.
- `rig/` — `profile.js` (rest silhouette), `geometry.js` (skinned tube), `skeleton.js`
  (spine), `swim.js` (traveling wave), `fins.js`, `FishRig.js`.
- `pattern/` — GPU reaction-diffusion.
- `shading/` — the layered material.
- `scene/` — water environment.

**Decisions that paid off:**

- **Spine rooted at the recoil pivot** (~s=0.23) with a forward branch to the head and a
  back branch to the tail. A head-rooted chain makes the head a nailed anchor and looks
  like waving a dead fish; pivot-rooting makes the head counter-sway on its own.
- **Every fin is a SkinnedMesh bound to the same spine**, so body undulation carries it,
  with membrane trailing applied on top in bind space. An eel's continuous fringe and a
  tuna's tail both follow the body with no per-fin attachment code.
- **Materials created once, reused across rebuilds.** Structural edits rebuild geometry
  only and refresh uniforms — dragging a body-shape slider never recompiles a shader.
- **`swim.plane` = one knob for cetaceans.** It rotates the spinal bending axis *and*
  rolls the caudal fin from vertical to horizontal simultaneously.

## 3. Verification

No trusting-the-render. Three layers:

- `scripts/smoke.mjs` — builds geometry + poses the skeleton for all nine species and
  every adjacent morph midpoint; asserts no NaNs and skin indices in range.
- `scripts/browsercheck.mjs` — drives headless Chrome over the DevTools protocol (no
  puppeteer), collects console/shader errors, screenshots each species.
- `scripts/motioncheck.mjs` — reads spine bone rotations at two instants and asserts the
  traveling wave is actually moving them.

## 4. Bugs found and fixed (in order)

1. **`transmission` fin shader wouldn't compile.** Three r185's IBL volume-refraction
   path errored under SwiftShader (`material.ior` field). Dropped true transmission —
   it's a heavy extra render pass anyway — for an alpha membrane with a fresnel
   translucency glow. Reads the same, always compiles.
2. **`void pipe;` re-declaration.** My unused-var suppressor `void x;` actually declared
   a variable of type void. Removed; cleaned the reversed-`smoothstep` warnings too.
3. **Screen-door scales.** The procedural scale bump was a hard checkerboard drowning the
   pigment. Cut the albedo AO to ~4%, clamped the normal derivative, dropped the bump
   strength. Now reads as scales in raking light, not a grid.
4. **Oversized eyes on thin fish.** Default eye radius was nearly the eel's whole
   cross-section. Added per-species overrides and a hard cap against local body depth.
5. **Ostraciiform frequency blowup.** Strouhal-derived frequency divides by tail
   amplitude, which is ~0 for a rigid boxfish → 16 Hz. Clamped the band and pinned
   ostraciiform species with a frequency override (they scull the tail, not the body).
6. **Pale/washed bodies.** Two causes: (a) a smooth low-roughness orca mirrored the
   bright environment to grey — matte-ed the cetacean skin and dropped
   `scene.environmentIntensity`; (b) the countershade formula collapsed to a constant
   mid-grey at countershade=0. Rewrote it so 0 = flat flank colour (correct for an
   orca's hard black/white mask) and 1 = full gradient.
7. **The big one — reaction-diffusion saturating to a solid mask.** The angelfish body
   went uniformly dark no matter the F/k or threshold. Isolated it by forcing
   `patternStrength=0` (body turned correctly silver → confirmed it was the RD field).
   Root cause: the anisotropic Laplacian used `ax=a, ay=1/a`, and `1/a` grows unbounded
   for `a<1`, destabilising the explicit diffusion step so V saturates to 1 everywhere.
   Fixed with a **bounded split `ax = 2a/(1+a)`, `ay = 2/(1+a)`** (`ax+ay=2`, each in
   (0,2)). This single change is what makes the angelfish bars *and* the minnow
   vermiculation appear at all — every anisotropic pattern in the project was silently
   broken before it.

## 5. Result

All nine species render distinctly and recognizably, the spine animates the traveling
wave, patterns grow live, and you can morph continuously between any two. Screenshots in
`examples/`. Runs comfortably real-time (software-GL headless was ~25 fps at 1280×720;
a real GPU is far higher).

## 6. Next steps

- Per-ray fin splay/fold (erect the dorsal, spread the caudal lobes).
- Run reaction-diffusion on the mesh surface with a curvature-aligned flow field to kill
  the last UV-seam stretch near the tail.
- Multilayer thin-film iridescence instead of the fresnel approximation.
- Maybe: a school, or a second animal, once the single-animal rig is locked.
