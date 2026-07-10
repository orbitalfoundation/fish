# Roadmap

Where the fish rig goes next. Ordered by leverage — earlier phases unlock later ones.

> **Live:** [marine.exe.xyz](https://marine.exe.xyz) · **Repo:** [github.com/orbitalfoundation/fish](https://github.com/orbitalfoundation/fish)
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
- [x] ✅ **Serialize genome → shareable code.** The whole parameter tree base64url-encodes
      into the URL hash; **🔗 copy link to this fish** copies it. *(Follow-up: the code is
      ~5 KB — compact it via the gene schema or gzip so links are shorter.)*
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
- [x] ✅ **Deployed & public** at [marine.exe.xyz](https://marine.exe.xyz); genome-in-URL
      sharing works with no server. Redeploy with `deploy/deploy.sh marine`.
- [ ] *(Optional)* mirror to a CDN host as primary (better availability for a static site).

---

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
