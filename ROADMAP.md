# Roadmap

Where the fish rig goes next. Ordered by leverage — earlier phases unlock later ones.

> **Live:** [fishes.exe.xyz](https://fishes.exe.xyz) · **Repo:** [github.com/orbitalfoundation/fish](https://github.com/orbitalfoundation/fish)
> Progress so far: the demo is deployed and shareable (fish encode into the URL), the
> water/ambiance has a first pass, and the exe.dev build+deploy pipeline is done.
> The active work is **head/face resolution** (see cross-cutting) before wider sharing.

**Guiding principle:** keep it real-time and game-like (a hero fish, or a modest
school, in front of you), accurate where it's cheap to be accurate, and beautiful.
Not a museum sim. Every feature should survive the test of "one fish in the middle of
the screen at 60 fps."

Legend: ⭐ recommended next · 🟢 cheap (infra exists) · 🟡 medium · 🔴 large/architectural

---

## Phase 1 — The genome & breeding game ⭐ 🟢
*The demo becomes a toy. Almost entirely built already: a fish already **is** its
parameter tree, and `morphParams`/`lerpTree` already blend two of them.*

- [ ] **Gene schema.** A metadata layer over `core/params.js`: for each numeric leaf,
      a `{ min, max, mutable, label }`. Makes bred/mutated fish stay viable (clamp to
      plausible ranges) and auto-generates GUI bounds instead of hand-typed ones.
- [x] ✅ **Serialize genome → shareable code.** The URL hash encodes the baseline
      preset/morph plus only the tweaked leaves (`src/genome.js`), so a typical link is
      under 100 chars (`#fish=orca~swim.speedBL=2.75`); hand-sculpted fish fall back to a
      deflate-compressed full tree (~1.5 KB). Old ~5 KB whole-tree links still decode and
      are promoted to the compact form on load.
- [x] ✅ **Load genome** from the URL hash on boot.
- [ ] **Breeding.** `breed(a, b, rng)` = per-gene pick-from-either-parent (Mendelian) +
      small bounded mutation. Reuses the tree walker from `lerpTree`.
- [ ] **Mutation slider** + "spawn variant" and "cross these two" UI. A small tank of
      2–8 candidate fish to pick parents from.
- [ ] **Named traits.** Surface a few "genes" as human-readable (body form, tail shape,
      pattern family, colour) so breeding feels legible, not just numbers.

*Payoff: exploration, save/share, and cross-breeding — three of your five ideas — from
one small, self-contained system with no backend.*

## Phase 2 — Ambiance & polish 🟡
*Make the water feel alive. Marine snow already exists as a base.*

- [x] ✅ **Caustics & god-rays** — animated caustic shimmer + light shafts in the sky-dome
      shader; the dome follows the camera and is sized to the frustum.
- [x] ✅ **Marine snow** — drifting motes with depth parallax.
- [ ] Rising bubbles and a couple more particle layers for parallax.
- [ ] A gentle water current that sways fins and drifts particles.
- [ ] Post: subtle depth-of-field + colour grade.
- [ ] Seabed / kelp / coral backdrop option (still one hero fish in front).

## Phase 3 — Schooling & flocking 🔴
*The interesting fork. The bone rig is perfect for a hero fish and a small group, but
CPU skinning per fish caps the count.*

- [ ] Boids for species that school (separation / alignment / cohesion) with per-fish
      swim-phase offsets so the school doesn't pulse in unison.
- [ ] **Decide the hybrid:** keep the bone rig for the foreground (dozens), and add a
      GPU vertex-shader traveling-wave path (the mesh bends in the shader, no bones) for
      background schools (hundreds+). Share the same genome/params so a background fish
      can be "promoted" to a hero fish seamlessly.
- [ ] Instanced rendering for the GPU-wave fish.
- [ ] Simple predator/prey or startle response for life.

## Phase 4 — Persistence & sharing 🟡
*Grows out of Phase 1's serialization.*

- [ ] Local: `localStorage` collection ("my aquarium") — zero backend.
- [ ] Shareable links already work from Phase 1; add a public gallery of shared genomes.
- [ ] **Accounts** (only when the gallery needs ownership): keep it serverless-friendly
      — a lightweight auth + a genomes table. Genomes are tiny (a few hundred bytes), so
      storage is trivial.

## Phase 5 — Deployment on exe.dev ✅ (done)
- [x] ✅ **exe.dev model confirmed** — Caddy-in-Docker on a VM, exposed via the HTTPS
      proxy. See `deploy/DEPLOYMENT.md`.
- [x] ✅ **esbuild build step** — `npm run build` bundles a self-contained `dist/`
      (index.html + app.js, ~630 KB).
- [x] ✅ **Deployed & public** at [fishes.exe.xyz](https://fishes.exe.xyz); genome-in-URL
      sharing works with no server. Redeploy with `deploy/deploy.sh fishes`.
- [ ] *(Optional)* mirror to a CDN host as primary (better availability for a static site).

---

## North star — expressiveness 🔴
*Reference: the [Yellow Tang on Sketchfab](https://sketchfab.com/3d-models/yellow-tang-coral-fish-1465b11201464ccb97e88c048c4656ba).
Not one task — the bar for how alive a fish should feel. Broken into what's reachable
from the current rig vs what needs new machinery:*

- [ ] **Non-robotic motion (reachable).** Layer burst-and-glide timing + micro-twitches
      onto the swim so it isn't a clean metronome. Speed/frequency jitter driven by
      layered noise; occasional startle darts.
- [ ] **Ductile fin flutter (reachable).** Add non-linear, phase-varied ripple along the
      fin rays (per-ray noise) instead of a single trailing curl.
- [ ] **Saccadic eyes (reachable-ish).** Eyes that dart and settle (independent small
      rotations), maybe converging toward the camera.
- [ ] **Expressive head (needs new machinery).** A mouth that opens/closes, working gill
      covers, real eye sockets — a single procedural tube can't express these. Likely a
      **dedicated parametric head module** (or blendshapes) grafted at the neck. This is
      the honest limit of the current head model; see the head-resolution note below.

## Cross-cutting / tech debt
*Worth doing alongside features, not as a phase.*

- [ ] 🔨 **Head/face resolution (ACTIVE).** Bodies taper to a point at the snout; heads are
      where people look. Add a rounded snout cap, a melon/forehead parameter (orca &
      dolphin bulge, angelfish steep brow), and bias vertex density toward the head. This
      also unlocks believable **dolphin** and **shark** presets.
- [ ] **Per-ray fin splay & fold** — erect/collapse the dorsal, spread the caudal lobes.
      Currently fins trail but don't fan. (Noted in README.)
- [ ] **Reaction-diffusion on the mesh surface** with a curvature-aligned flow field
      (Krause et al. 2024) to remove the last UV-seam stretch near the tail.
- [ ] **Per-species pattern presets in the genome** — RD is finicky to tune by hand; bake
      known-good `{feed, kill, anisotropy, seed}` sets as selectable "pattern genes."
- [ ] **Performance pass** for multi-fish: the per-frame fin vertex writes and CPU
      skinning are fine for one fish, not for fifty. Profile before Phase 3.
- [x] ✅ **Mobile UI** — pull-up bottom-sheet panel, one-tap species chips, camera pans up
      so the fish clears the panel. *(Still want: pinch-zoom tuning, DPR robustness pass.)*
- [ ] **CI/CD (lower priority).** Port water-atlas's autodeploy: an on-VM systemd timer
      polling GitHub `main` every ~2 min → rebuild + redeploy, so pushing is the deploy.
      Plus a tiny GitHub Action running `npm run smoke` on PRs.
- [ ] Multilayer thin-film iridescence instead of the current fresnel approximation.

---

## Suggested order
1. ✅ **Phase 5 deployment** — done; it's live and shareable.
2. 🔨 **Head/face resolution** — the current quality gap; unlocks dolphin + shark.
3. **Phase 1 breeding** — the genome already serializes; add mutation + crossing next.
4. **Phase 2 ambiance** in parallel — pure polish, independent of everything.
5. **Phase 3 schooling** — the big one; do the hybrid-architecture spike first.
6. **Phase 4 accounts** last, only when the shared-gallery demand is real.
