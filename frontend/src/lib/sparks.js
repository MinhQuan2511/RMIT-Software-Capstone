/**
 * Decorative spark particles, integrated with elapsed time.
 *
 * Pooled typed arrays, no per-frame allocation. Lifetimes are decremented by
 * the real frame delta and velocities are in millimetres per second, so the
 * effect looks the same at 30 Hz and 144 Hz. Large gaps (a hidden tab, a
 * debugger pause) are clamped to MAX_DT_S so particles never jump.
 *
 * The velocity range reproduces the previous per-frame constants at 60 Hz
 * (0.25 × 60 = 15× the old per-frame numbers). It is not a physical model of
 * welding spatter.
 */

export const SPARK_COUNT = 60;
export const MAX_DT_S = 0.05;
export const SPAWN_JITTER_MM = 6;
export const LIFETIME_MIN_S = 0.25;
export const LIFETIME_SPAN_S = 0.45;
export const DRIFT_DOWN_MM_S = 72;

export function createSparkState(count = SPARK_COUNT) {
  return {
    count,
    positions: new Float32Array(count * 3),
    velocities: new Float32Array(count * 3),
    lifetimes: new Float32Array(count),
  };
}

/**
 * @param {ReturnType<typeof createSparkState>} s
 * @param {number} dtSeconds  elapsed time since the previous frame
 * @param {number[]|null} emitter  view-frame position of the torch tip
 * @param {boolean} active  arc gate from the playback timeline
 * @param {() => number} rng
 * @returns {boolean} whether the particles should be visible
 */
export function stepSparks(s, dtSeconds, emitter, active, rng = Math.random) {
  if (!active || !emitter) {
    s.lifetimes.fill(0);
    return false;
  }
  const dt = Math.min(Math.max(Number.isFinite(dtSeconds) ? dtSeconds : 0, 0), MAX_DT_S);
  for (let i = 0; i < s.count; i += 1) {
    const k = i * 3;
    s.lifetimes[i] -= dt;
    if (s.lifetimes[i] <= 0) {
      s.positions[k] = emitter[0] + (rng() - 0.5) * SPAWN_JITTER_MM;
      s.positions[k + 1] = emitter[1] + (rng() - 0.5) * SPAWN_JITTER_MM;
      s.positions[k + 2] = emitter[2] + (rng() - 0.5) * SPAWN_JITTER_MM;
      s.velocities[k] = (rng() - 0.5) * 675;
      s.velocities[k + 1] = rng() * 525 + 300;
      s.velocities[k + 2] = (rng() - 0.5) * 675;
      s.lifetimes[i] = LIFETIME_MIN_S + rng() * LIFETIME_SPAN_S;
    } else {
      s.positions[k] += s.velocities[k] * dt;
      s.positions[k + 1] += (s.velocities[k + 1] - DRIFT_DOWN_MM_S) * dt;
      s.positions[k + 2] += s.velocities[k + 2] * dt;
    }
  }
  return true;
}

/** Deterministic generator for tests (mulberry32). */
export function seededRng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
