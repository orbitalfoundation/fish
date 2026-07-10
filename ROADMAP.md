# Roadmap

Where the fish rig goes next. Ordered by leverage — earlier phases unlock later ones.

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
- [ ] **Serialize genome → shareable code.** Fixed-order float vector → base64 (or JSON
      → compressed). Round-trips a fish. Put it in the URL hash so any fish is a link.
- [ ] **Load genome** from code/URL on boot.
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

- [ ] Animated caustics (scrolling caustic texture projected as light / additive overlay).
- [ ] Rising bubbles and a couple of particle layers at different depths for parallax.
- [ ] A gentle water current that sways fins and drifts particles.
- [ ] Post: subtle depth-of-field + colour grade; god-ray shafts near the surface.
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

## Phase 5 — Deployment on exe.dev 🟡
- [ ] **Confirm exe.dev's model** (static host? container? build step? edge functions?)
      — this decides the packaging below. *(Need details or a link to their docs.)*
- [ ] **Add a build step.** Today the app runs unbundled and the importmap points at
      `/node_modules/...`, which is great for local dev but not for a clean static
      deploy. Options: (a) switch the importmap to a CDN (`three` from unpkg/jsdelivr)
      for a truly static drop-in, or (b) add esbuild/Vite to bundle+hash for production.
      Recommend a tiny esbuild step so we control the deployed bytes.
- [ ] Static hosting of `dist/` + the genome-in-URL sharing works with no server.

---

## Cross-cutting / tech debt
*Worth doing alongside features, not as a phase.*

- [ ] **Per-ray fin splay & fold** — erect/collapse the dorsal, spread the caudal lobes.
      Currently fins trail but don't fan. (Noted in README.)
- [ ] **Reaction-diffusion on the mesh surface** with a curvature-aligned flow field
      (Krause et al. 2024) to remove the last UV-seam stretch near the tail.
- [ ] **Per-species pattern presets in the genome** — RD is finicky to tune by hand; bake
      known-good `{feed, kill, anisotropy, seed}` sets as selectable "pattern genes."
- [ ] **Performance pass** for multi-fish: the per-frame fin vertex writes and CPU
      skinning are fine for one fish, not for fifty. Profile before Phase 3.
- [ ] **Mobile / touch controls** and a resize/DPR robustness pass.
- [ ] **A tiny CI** running `npm run smoke` (and ideally the headless render check) on PRs.
- [ ] Multilayer thin-film iridescence instead of the current fresnel approximation.

---

## Suggested order
1. **Phase 1 (genome + breeding).** Highest fun-per-hour, unlocks save/share, no backend.
2. **Phase 2 ambiance** in parallel — pure polish, independent of everything.
3. **Phase 5 deployment** once there's a genome to share (get it in front of people early).
4. **Phase 3 schooling** — the big one; do the hybrid-architecture spike first.
5. **Phase 4 accounts** last, only when the shared-gallery demand is real.
