/**
 * Browser-side mathematical check of a stored joint-relative revision.
 *
 * Recomputes the work and push angles from the STORED weld-start quaternion,
 * the stored joint frame and the declared tool convention, using the same
 * rotation helper the 3D preview uses. It never re-plans. Labelled
 * "mathematical check": it is not robot verification.
 */

import { rotateVec } from "./viewTransform.js";

export const TOOL_AXIS = { "+X": [1, 0, 0], "-X": [-1, 0, 0], "+Y": [0, 1, 0], "-Y": [0, -1, 0], "+Z": [0, 0, 1], "-Z": [0, 0, -1] };
export const CHECK_TOLERANCE_DEG = 1e-5;

const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const deg = (r) => (r * 180) / Math.PI;

export const isJointRelative = (record) => !!(record && record.orientation && record.orientation.mode === "joint_relative_straight_fillet");

/** @returns {null | {workAngleDeg, pushAngleDeg, openSide, sameOrientationOnAllTargets, requested, agrees, toleranceDeg}} */
export function recomputeOrientation(record) {
  if (!isJointRelative(record)) return null;
  const o = record.orientation;
  const start = record.path.waypoints.find((w) => w.type === "weld_start");
  if (!start) return null;
  const a = rotateVec(start.orient, TOOL_AXIS[o.toolConvention.approachAxis]);
  const { travel: t, normalA: nA, normalB: nB } = o.jointFrame;
  const pushAngleDeg = deg(Math.asin(Math.max(-1, Math.min(1, dot(a, t)))));
  const body = a.map((c) => -c);
  const bt = body.map((c, i) => c - dot(body, t) * t[i]);
  const workAngleDeg = deg(Math.atan2(dot(bt, nA), dot(bt, nB)));
  const openSide = dot(bt, nA) > 0 && dot(bt, nB) > 0;
  const sameOrientationOnAllTargets = record.path.waypoints.every((w) => w.orient.every((c, i) => c === start.orient[i]));
  const agrees = openSide
    && Math.abs(workAngleDeg - o.requested.workAngleDeg) <= CHECK_TOLERANCE_DEG
    && Math.abs(pushAngleDeg - o.requested.pushAngleDeg) <= CHECK_TOLERANCE_DEG;
  return { workAngleDeg, pushAngleDeg, openSide, sameOrientationOnAllTargets, requested: o.requested, agrees, toleranceDeg: CHECK_TOLERANCE_DEG };
}

/**
 * Vectors for the 3D joint-frame and torch-axis indicators, in the robot base
 * frame. The torch axis comes from each stored target quaternion.
 */
export function jointIndicators(record) {
  if (!isJointRelative(record)) return null;
  const o = record.orientation;
  const weld = record.path.waypoints.filter((w) => w.type === "weld_start" || w.type === "weld_end");
  if (weld.length === 0) return null;
  return {
    origin: weld[0].pos,
    travel: o.jointFrame.travel,
    normalA: o.jointFrame.normalA,
    normalB: o.jointFrame.normalB,
    plateLabels: o.jointFrame.plateLabels,
    torchAxes: weld.map((w) => ({ name: w.name, pos: w.pos, approach: rotateVec(w.orient, TOOL_AXIS[o.toolConvention.approachAxis]) })),
  };
}
