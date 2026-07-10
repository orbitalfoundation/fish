import { envelopeAt, frequencyFromStrouhal } from '../core/params.js';
import { TAU } from '../core/math.js';

/**
 * Turns time into a backbone shape. This is the traveling-wave model
 *
 *     lateral(s,t) = 0.5 * A(s) * L * sin(2*pi*waves*s - omega*t)
 *
 * where A(s) is the peak-to-peak amplitude envelope (hence the 0.5 -> lateral is
 * half of peak-to-peak), `waves` is how many wavelengths sit on the body at once
 * (the anguilliform->thunniform knob), and omega comes from the Strouhal number
 * so the beat frequency scales sanely with size and speed.
 *
 * It also exposes lateralVel(s,t): the time derivative. Fins trail under drag
 * proportional to their socket's velocity, and velocity is a quarter cycle ahead
 * of displacement -- which is exactly the measured dorsal/anal fin phase lag, for
 * free, with no hand-tuned delay.
 */
export class Swimmer {
  constructor(params) {
    // `activity` (from a Behavior brain) scales the beat effort; `turnDyn` is a
    // dynamic heading bias. Both default to a plain steady swim.
    this.activity = 1;
    this.turnDyn = 0;
    this.set(params);
    this.t = 0;
    this.phaseAccum = 0; // integrated so frequency can change without a jump
  }

  set(params) {
    this.p = params;
    this.swim = params.swim;
    this.L = params.scale;
    this._recompute();
  }

  _recompute() {
    const sw = this.swim;
    // Strouhal-derived frequency blows up when the body-wave amplitude is near
    // zero (ostraciiform), so clamp to a plausible tail-beat band. Species that
    // scull with the tail rather than the body pin it with freqOverride.
    const f = sw.freqOverride > 0 ? sw.freqOverride : frequencyFromStrouhal(sw);
    this.baseFreq = Math.min(Math.max(f, 0.05), 6.5);
    // Behavioural effort scales frequency (a sprinting fish beats faster). The HUD
    // reads `freq`, so keep it the effective one.
    this.freq = Math.min(Math.max(this.baseFreq * this.activity, 0.03), 9);
    this.omega = TAU * this.freq;
    this.k = TAU * sw.waves;
    // Beat a little harder when active — amplitude rises modestly with effort.
    this.ampMul = 0.9 + 0.28 * Math.min(this.activity, 1.8);
  }

  advance(dt) {
    // Re-read in case the GUI / behaviour changed speed since last frame.
    this._recompute();
    this.phaseAccum += this.omega * dt;
    this.t += dt;
  }

  phase(s) {
    return this.k * s - this.phaseAccum;
  }

  /** Lateral (or dorsoventral) centreline offset in world units at coordinate s. */
  centreline(s) {
    const sw = this.swim;
    const amp = 0.5 * envelopeAt(sw.envelope, s) * this.L * this.ampMul;
    let y = amp * Math.sin(this.phase(s));

    // Steady steering bias plus the brain's dynamic wander, biased toward the tail.
    y += (sw.turn + this.turnDyn) * this.L * s * s * 0.5;

    // Slow idle drift: a whole-body sway an order of magnitude slower than the
    // swim beat, so even a "stationary" hovering fish is never rigid.
    if (sw.idle > 0) {
      y += sw.idle * 0.012 * this.L * Math.sin(this.t * 0.9 + s * 1.3);
    }
    return y;
  }

  /** d(centreline)/dt, used to drive fin trailing. */
  lateralVel(s) {
    const amp = 0.5 * envelopeAt(this.swim.envelope, s) * this.L * this.ampMul;
    return -amp * this.omega * Math.cos(this.phase(s));
  }

  /** Normalised drive in [-1,1]-ish for a fin socket at coordinate s: the socket's
   *  signed speed relative to the tail's peak speed. */
  finDrive(s) {
    const tailAmp = 0.5 * envelopeAt(this.swim.envelope, 1.0) * this.L * this.ampMul;
    const denom = tailAmp * this.omega || 1;
    return this.lateralVel(s) / denom;
  }
}
