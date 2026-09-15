/**
 * Mathematical check of a stored target orientation against a joint frame.
 *
 * Deliberately independent of jointOrientation.js: it does not build a rotation
 * matrix or reuse the planner's construction. It rotates the declared tool axes
 * by the STORED (rounded) quaternion and measures the angles with dot products.
 *
 * A passing result means the numbers are self-consistent. It is not evidence
 * that the torch attitude is correct on a robot ("mathematical check", never
 * "robot verified").
 */

const { rotateVector } = require('../validation/quaternion');

const AXIS = { '+X': [1, 0, 0], '-X': [-1, 0, 0], '+Y': [0, 1, 0], '-Y': [0, -1, 0], '+Z': [0, 0, 1], '-Z': [0, 0, -1] };
const DEFAULT_TOLERANCE_DEG = 1e-5;

const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const deg = (r) => (r * 180) / Math.PI;
const clamp1 = (x) => Math.max(-1, Math.min(1, x));

/**
 * @param {{quaternion: number[], frame: {travel, normalA, normalB}, toolConvention: object, requested?: {workAngleDeg, pushAngleDeg}, toleranceDeg?: number}} input
 */
function recoverOrientationAngles({ quaternion, frame, toolConvention, requested, toleranceDeg = DEFAULT_TOLERANCE_DEG }) {
  const a = rotateVector(quaternion, AXIS[toolConvention.approachAxis]);
  const roll = rotateVector(quaternion, AXIS[toolConvention.rollAxis]);
  const t = frame.travel;

  const pushAngleDeg = deg(Math.asin(clamp1(dot(a, t))));
  const body = a.map((c) => -c);
  const along = dot(body, t);
  const bt = body.map((c, i) => c - along * t[i]);
  const workAngleDeg = deg(Math.atan2(dot(bt, frame.normalA), dot(bt, frame.normalB)));
  const openSide = dot(bt, frame.normalA) > 0 && dot(bt, frame.normalB) > 0;

  // Roll: the declared roll axis should lie along ±(travel minus its approach component).
  // atan2(|u×v|, u·v) keeps full precision near 0°, where acos does not.
  const sign = toolConvention.rollReference === 'travel' ? 1 : -1;
  const expected = t.map((c, i) => sign * (c - dot(t, a) * a[i]));
  const rollErrorDeg = deg(Math.atan2(Math.hypot(...cross(roll, expected)), dot(roll, expected)));

  const result = {
    method: 'mathematical check: stored quaternion applied to the declared tool axes; angles measured against the declared joint frame',
    workAngleDeg,
    pushAngleDeg,
    rollErrorDeg,
    openSide,
    toleranceDeg,
  };
  if (requested) {
    result.workAngleErrorDeg = Math.abs(workAngleDeg - requested.workAngleDeg);
    result.pushAngleErrorDeg = Math.abs(pushAngleDeg - requested.pushAngleDeg);
    result.status = openSide && result.workAngleErrorDeg <= toleranceDeg && result.pushAngleErrorDeg <= toleranceDeg && rollErrorDeg <= toleranceDeg
      ? 'mathematical_check_passed'
      : 'mathematical_check_failed';
  }
  return result;
}

module.exports = { recoverOrientationAngles, DEFAULT_TOLERANCE_DEG };
