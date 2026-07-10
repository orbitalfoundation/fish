import { mulberry32 } from '../core/math.js';

/**
 * A tiny "brain": it doesn't decide *where* to go (the fish swims in place), it
 * decides how HARD and how twitchily. Each frame it evolves an `activity`
 * (a speed/effort multiplier the Swimmer scales its beat by) and a slow `turn`
 * bias, by scheduling behavioural events — glides, bursts, sudden darts — from a
 * few numbers. Those numbers are part of the genome, so temperament morphs and
 * shares like everything else.
 *
 *   base   mean effort
 *   calm   effort during a glide
 *   burst  extra effort during an active bout / dart
 *   rate   behavioural events per second (how restless)
 *   dart   probability an event is a sudden short sprint (skittish fish)
 *   wander how much the heading drifts
 */
export const BRAINS = {
  cruiser: { base: 1.0, calm: 0.8, burst: 0.35, rate: 0.35, dart: 0.0, wander: 0.5 },
  burstGlide: { base: 1.0, calm: 0.28, burst: 1.4, rate: 0.5, dart: 0.0, wander: 0.4 },
  hover: { base: 0.35, calm: 0.16, burst: 0.5, rate: 0.25, dart: 0.0, wander: 0.35 },
  skittish: { base: 0.55, calm: 0.4, burst: 2.4, rate: 0.6, dart: 0.7, wander: 0.7 },
  steady: { base: 1.0, calm: 0.88, burst: 0.18, rate: 0.12, dart: 0.0, wander: 0.22 },
};

export class Behavior {
  constructor(spec, seed = 1) {
    this.set(spec || BRAINS.cruiser);
    this.rng = mulberry32((seed | 0) * 2654435761 + 99);
    this.activity = this.spec.base;
    this.target = this.spec.base;
    this.turn = 0;
    this.turnTarget = 0;
    this.timer = 0.2;
  }

  set(spec) {
    this.spec = spec;
  }

  /** Advance the brain. Returns nothing; read `activity` and `turn`. */
  update(dt) {
    this.timer -= dt;
    if (this.timer <= 0) this._schedule();

    // Critically-damped-ish approach to the targets. Darts snap faster than the
    // heading drifts, which reads as "twitch, then settle".
    this.activity += (this.target - this.activity) * (1 - Math.exp(-dt * 6.0));
    this.turn += (this.turnTarget - this.turn) * (1 - Math.exp(-dt * 1.1));
  }

  _schedule() {
    const s = this.spec;
    const r = this.rng();
    const interval = 1 / Math.max(0.05, s.rate);

    if (s.dart > 0 && this.rng() < s.dart) {
      // sudden short sprint
      this.target = s.base + s.burst;
      this.timer = 0.12 + this.rng() * 0.2;
    } else if (r < 0.45) {
      // glide / coast
      this.target = s.calm;
      this.timer = interval * (0.7 + this.rng() * 1.3);
    } else {
      // active bout
      this.target = s.base + s.burst * this.rng();
      this.timer = interval * (0.6 + this.rng() * 1.0);
    }
    // occasionally pick a new gentle heading drift
    if (this.rng() < 0.6) this.turnTarget = (this.rng() * 2 - 1) * s.wander;
  }
}
