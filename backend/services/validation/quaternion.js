/**
 * Quaternion utilities in ABB component order [q1, q2, q3, q4] = [w, x, y, z].
 *
 * Normalisation repairs a mathematical property only. It does not establish
 * that the orientation is the correct torch attitude, reachable, or safe.
 */

// Application precheck tolerance on |q| after output rounding. Serialising to
// 9 decimal places changes the norm by at most ~2e-9, so a 1e-6 tolerance
// catches any genuinely unnormalised value while ignoring print rounding. This
// is an application choice, not a figure taken from ABB documentation.
const QUAT_NORM_TOLERANCE = 1e-6;

// Below this norm a quaternion carries no usable direction.
const MIN_QUAT_NORM = 1e-6;

const quatNorm = (q) => Math.hypot(q[0], q[1], q[2], q[3]);

/**
 * @param {number[]} q
 * @param {{requireUnit?: boolean, tolerance?: number}} [opts]
 * @returns {{ok: boolean, norm?: number, reason?: string}}
 */
function validateQuaternion(q, opts = {}) {
  if (!Array.isArray(q) || q.length !== 4) return { ok: false, reason: 'not_four_components' };
  if (q.some((c) => typeof c !== 'number' || !Number.isFinite(c))) return { ok: false, reason: 'non_finite' };
  const norm = quatNorm(q);
  if (norm < MIN_QUAT_NORM) return { ok: false, norm, reason: 'near_zero_norm' };
  if (opts.requireUnit && Math.abs(norm - 1) > (opts.tolerance ?? QUAT_NORM_TOLERANCE)) {
    return { ok: false, norm, reason: 'not_unit' };
  }
  return { ok: true, norm };
}

function normalizeQuaternion(q) {
  const check = validateQuaternion(q);
  if (!check.ok) throw new Error(`quaternion: cannot normalise (${check.reason})`);
  return q.map((c) => c / check.norm);
}

/** Hamilton product a ⊗ b. Applied to a vector, b rotates first, then a. */
function quatMultiply(a, b) {
  const [aw, ax, ay, az] = a;
  const [bw, bx, by, bz] = b;
  return [
    aw * bw - ax * bx - ay * by - az * bz,
    aw * bx + ax * bw + ay * bz - az * by,
    aw * by - ax * bz + ay * bw + az * bx,
    aw * bz + ax * by - ay * bx + az * bw,
  ];
}

const quatConjugate = (q) => [q[0], -q[1], -q[2], -q[3]];

/** Unit quaternion for a rotation of `angle` radians about a non-zero `axis`. */
function quatFromAxisAngle(axis, angle) {
  const len = Math.hypot(axis[0], axis[1], axis[2]);
  if (!(len > 1e-12) || !Number.isFinite(angle)) throw new Error('quaternion: invalid axis-angle');
  const s = Math.sin(angle / 2) / len;
  return [Math.cos(angle / 2), axis[0] * s, axis[1] * s, axis[2] * s];
}

/** Rotates vector v by quaternion q (normalised internally). */
function rotateVector(q, v) {
  const u = normalizeQuaternion(q);
  const r = quatMultiply(quatMultiply(u, [0, v[0], v[1], v[2]]), quatConjugate(u));
  return [r[1], r[2], r[3]];
}

/** Rounds each component to `dp` decimals and returns the result with its norm. */
function roundQuaternion(q, dp = 9) {
  const f = 10 ** dp;
  const rounded = q.map((c) => {
    const r = Math.round(c * f) / f;
    return Object.is(r, -0) ? 0 : r;
  });
  return { q: rounded, norm: quatNorm(rounded) };
}

/** True when q and p describe the same rotation (q ≡ −q). */
function sameRotation(q, p, eps = 1e-9) {
  const a = normalizeQuaternion(q);
  const b = normalizeQuaternion(p);
  const dot = Math.abs(a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3]);
  return Math.abs(dot - 1) <= eps;
}

module.exports = {
  QUAT_NORM_TOLERANCE,
  MIN_QUAT_NORM,
  quatNorm,
  validateQuaternion,
  normalizeQuaternion,
  quatMultiply,
  quatConjugate,
  quatFromAxisAngle,
  rotateVector,
  roundQuaternion,
  sameRotation,
};
