/**
 * Path Planner & Waypoint Generation Service
 * Turns a parsed weld seam into the RAPID waypoint set the compiler emits.
 *
 * Feature.txt coordinates are already in the physical robot workspace, so the
 * weld start and weld end are used directly — there is no camera-to-robot
 * transform and no scaling of the seam onto a fixed table anchor. The approach,
 * retract and standby poses are derived from the seam itself: backed off along
 * the seam direction, lifted in Z, and pushed sideways along the lateral normal
 * so the torch escapes into open space rather than through the workpiece.
 *
 * Straight seam — five waypoints:
 *   1. home        – High-clearance overhead standby
 *   2. Target_30   – Approach: backed off behind the weld start
 *   3. Target_40   – Weld Start
 *   4. Target_20_5 – Weld End
 *   5. Target_20   – Retract: lifted clear of the weld end
 *
 * Arc seam — six waypoints, one extra between the weld ends:
 *   1. home
 *   2. Target_30   – Approach, backed off along the start tangent
 *   3. Target_40   – Weld Start
 *   4. Target_45   – Weld Via: the interpolation point of the MoveC
 *   5. Target_20_5 – Weld End
 *   6. Target_20   – Retract, lifted clear along the end tangent
 *
 * Orientation. A straight seam keeps the single fixed weld quaternion that the
 * known-good RobotStudio run was verified with. An arc cannot: the seam tangent
 * turns by the whole sweep angle, so holding one quaternion would leave the
 * torch pointing where the seam no longer goes. Arc waypoints therefore carry
 * the weld quaternion rotated about the arc's own plane normal by how far round
 * the arc they sit — the torch holds a constant attitude relative to the seam,
 * and at the start of the arc the orientation is still exactly the verified
 * quaternion.
 */

const { fitCircle3Pt } = require('./arcFitter');

/**
 * @typedef {Object} RobotWaypoint
 * @property {string}   id     - Unique waypoint identifier
 * @property {string}   name   - RAPID robtarget variable name
 * @property {number[]} pos    - [x, y, z]
 * @property {number[]} orient - [q1, q2, q3, q4]
 * @property {number[]} conf   - [cf1, cf4, cf6, cfx]
 * @property {string}   type   - 'home' | 'approach' | 'weld_start' | 'weld_via' | 'weld_end' | 'retract'
 * @property {string}   speed  - RAPID speed data (e.g. 'v100')
 * @property {string}   zone   - RAPID zone data (e.g. 'fine', 'z100')
 */

// --- Orientations ---
// 1. Default upright quaternion for home & Target_20
const UPRIGHT_QUAT = [0, 0.38268343, 0.92387953, 0];

// 2. 45-degree fillet weld quaternion for Target_30, Target_40, Target_20_5
const WELD_QUAT = [0.38268343, 0.14943801, 0.88701083, -0.19826693];

const round4 = (n) => parseFloat(n.toFixed(4));

/** Reads a point given as {x,y,z} or [x,y,z] into a numeric triple. */
function readPoint(p) {
  if (Array.isArray(p)) return [Number(p[0]) || 0, Number(p[1]) || 0, Number(p[2]) || 0];
  return [
    Number(p && p.x !== undefined ? p.x : 0),
    Number(p && p.y !== undefined ? p.y : 0),
    Number(p && p.z !== undefined ? p.z : 0),
  ];
}

/** Unit vector, with a safe fallback for a zero-length input. */
function unit(v, fallback = [1, 0, 0]) {
  const len = Math.hypot(v[0], v[1], v[2]);
  return len > 0.001 ? [v[0] / len, v[1] / len, v[2] / len] : fallback.slice();
}

/** Cross product of two triples. */
function cross(a, b) {
  return [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ];
}

/**
 * Lateral escape direction: the travel direction turned 90 degrees in the XY
 * plane, so approach and retract clear the workpiece sideways.
 */
function lateralNormal(dir) {
  const wx = -dir[1];
  const wy = dir[0];
  const len = Math.hypot(wx, wy);
  return len > 0.001 ? [wx / len, wy / len, 0] : [0, 1, 0];
}

/**
 * Hamilton product of two quaternions in ABB's [q1,q2,q3,q4] = [w,x,y,z] order.
 * The left operand is the rotation applied after the right one.
 */
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

/** Unit quaternion for a rotation of `angle` radians about `axis`. */
function quatFromAxisAngle(axis, angle) {
  const [x, y, z] = unit(axis, [0, 0, 1]);
  const half = angle / 2;
  const s = Math.sin(half);
  return [Math.cos(half), x * s, y * s, z * s];
}

/**
 * Rotates the verified weld quaternion round the arc so the torch keeps a
 * constant attitude relative to the turning seam.
 *
 * The rotation quaternion is a unit quaternion, so the product carries the same
 * magnitude as WELD_QUAT — no renormalisation is applied, and an angle of zero
 * reproduces WELD_QUAT exactly rather than a rounded copy of it.
 */
function weldQuatAlongArc(normal, angle) {
  if (!angle) return WELD_QUAT.slice();
  return quatMultiply(quatFromAxisAngle(normal, angle), WELD_QUAT);
}

/**
 * Builds the three framing poses (approach, retract, standby) around a seam.
 *
 * @param {number[]} pStart   - Weld start [x,y,z]
 * @param {number[]} pEnd     - Weld end [x,y,z]
 * @param {number[]} dirStart - Unit travel direction at the weld start
 * @param {number[]} dirEnd   - Unit travel direction at the weld end
 */
function buildFramingPoses(pStart, pEnd, dirStart, dirEnd) {
  const wStart = lateralNormal(dirStart);
  const wEnd = lateralNormal(dirEnd);
  // The standby pose sits over the middle of the seam, offset the same way.
  const wMid = lateralNormal(unit(
    [
      dirStart[0] + dirEnd[0],
      dirStart[1] + dirEnd[1],
      dirStart[2] + dirEnd[2],
    ],
    dirStart
  ));

  // Approach: -25mm back along travel, +45mm up, +35mm diagonal escape
  const approach = [
    round4(pStart[0] - 25 * dirStart[0] + 35 * wStart[0]),
    round4(pStart[1] - 25 * dirStart[1] + 35 * wStart[1]),
    round4(pStart[2] + 45),
  ];

  // Retract: +20mm forward along travel, +45mm up, +35mm diagonal escape
  const retract = [
    round4(pEnd[0] + 20 * dirEnd[0] + 35 * wEnd[0]),
    round4(pEnd[1] + 20 * dirEnd[1] + 35 * wEnd[1]),
    round4(pEnd[2] + 45),
  ];

  // Home: safe standby, +60mm lateral, +350mm up
  const home = [
    round4((pStart[0] + pEnd[0]) / 2 + 60 * wMid[0]),
    round4((pStart[1] + pEnd[1]) / 2 + 60 * wMid[1]),
    round4(Math.max(pStart[2], pEnd[2]) + 350),
  ];

  return { approach, retract, home };
}

/** Assembles a waypoint record. */
function makeWaypoint(name, pos, orient, type, speed, zone) {
  return {
    id: name,
    name,
    pos,
    orient,
    conf: [0, 0, 0, 0],
    type,
    speed,
    zone,
  };
}

/**
 * Plans the waypoints for a straight seam — the original five-waypoint
 * template, with output unchanged.
 */
function planStraightWaypoints(pStart, pEnd) {
  const dir = unit([pEnd[0] - pStart[0], pEnd[1] - pStart[1], pEnd[2] - pStart[2]]);
  const { approach, retract, home } = buildFramingPoses(pStart, pEnd, dir, dir);

  return [
    makeWaypoint('home', home, UPRIGHT_QUAT.slice(), 'home', 'v100', 'z100'),
    makeWaypoint('Target_30', approach, WELD_QUAT.slice(), 'approach', 'v60', 'z10'),
    makeWaypoint('Target_40', pStart.map(round4), WELD_QUAT.slice(), 'weld_start', 'v100', 'fine'),
    makeWaypoint('Target_20_5', pEnd.map(round4), WELD_QUAT.slice(), 'weld_end', 'v100', 'fine'),
    makeWaypoint('Target_20', retract, WELD_QUAT.slice(), 'retract', 'v80', 'z10'),
  ];
}

/**
 * Plans the waypoints for an arc seam: the straight set plus a via target,
 * with orientations that follow the seam round the curve.
 */
function planArcWaypoints(pStart, pVia, pEnd, fit) {
  const normal = readPoint(fit.normal);
  const center = readPoint(fit.center);

  // Travel direction on a circle is perpendicular to the radius, in the plane.
  const tangentAt = (point) => {
    const radial = unit([
      point[0] - center[0],
      point[1] - center[1],
      point[2] - center[2],
    ]);
    return unit(cross(normal, radial));
  };

  const dirStart = tangentAt(pStart);
  const dirEnd = tangentAt(pEnd);

  const { approach, retract, home } = buildFramingPoses(pStart, pEnd, dirStart, dirEnd);

  const viaQuat = weldQuatAlongArc(normal, fit.viaAngle);
  const endQuat = weldQuatAlongArc(normal, fit.sweepAngle);

  return [
    makeWaypoint('home', home, UPRIGHT_QUAT.slice(), 'home', 'v100', 'z100'),
    // The approach shares the weld-start attitude so the torch arrives ready.
    makeWaypoint('Target_30', approach, WELD_QUAT.slice(), 'approach', 'v60', 'z10'),
    makeWaypoint('Target_40', pStart.map(round4), WELD_QUAT.slice(), 'weld_start', 'v100', 'fine'),
    makeWaypoint('Target_45', pVia.map(round4), viaQuat, 'weld_via', 'v100', 'fine'),
    makeWaypoint('Target_20_5', pEnd.map(round4), endQuat, 'weld_end', 'v100', 'fine'),
    // Retract holds the final weld attitude so the torch lifts away cleanly
    // instead of snapping back to the start orientation.
    makeWaypoint('Target_20', retract, endQuat.slice(), 'retract', 'v80', 'z10'),
  ];
}

/**
 * Plans a seam and reports what was actually planned.
 *
 * An arc seam whose three points do not describe a usable circle — collinear,
 * coincident, or bowing so little off the chord that the radius runs away — is
 * planned as a straight seam instead, and the reason is returned so the caller
 * can say so rather than emitting arc motion the controller would reject.
 *
 * @param {{startPoint:{x,y,z}, endPoint:{x,y,z}, viaPoint?:{x,y,z}}} seam
 * @returns {{ waypoints: RobotWaypoint[], isArc: boolean, arc: object|null, fallbackReason: string|null }}
 */
function planSeamPath(seam) {
  if (!seam || !seam.startPoint || !seam.endPoint) {
    throw new Error('pathPlanner: seam must contain startPoint and endPoint');
  }

  const pStart = readPoint(seam.startPoint);
  const pEnd = readPoint(seam.endPoint);

  if (!seam.viaPoint) {
    return {
      waypoints: planStraightWaypoints(pStart, pEnd),
      isArc: false,
      arc: null,
      fallbackReason: null,
    };
  }

  const pVia = readPoint(seam.viaPoint);
  const fit = fitCircle3Pt(seam.startPoint, seam.viaPoint, seam.endPoint);

  if (!fit.ok) {
    return {
      waypoints: planStraightWaypoints(pStart, pEnd),
      isArc: false,
      arc: null,
      fallbackReason: 'Arc fit failed (' + fit.reason + ') — planned as a straight seam.',
    };
  }

  if (fit.nearlyStraight) {
    return {
      waypoints: planStraightWaypoints(pStart, pEnd),
      isArc: false,
      arc: fit,
      fallbackReason:
        'Via point bows only ' + fit.bow.toFixed(4) + 'mm off the chord — planned as a straight seam.',
    };
  }

  return {
    waypoints: planArcWaypoints(pStart, pVia, pEnd, fit),
    isArc: true,
    arc: fit,
    fallbackReason: null,
  };
}

/**
 * Generates the RAPID waypoints for a seam.
 *
 * @param {{ startPoint: {x,y,z}, endPoint: {x,y,z}, viaPoint?: {x,y,z}, seamWidth?: number }} seam
 * @returns {RobotWaypoint[]}
 */
function planWaypoints(seam) {
  return planSeamPath(seam).waypoints;
}

module.exports = {
  planWaypoints,
  planSeamPath,
};
