/**
 * Path Planner
 * Turns a parsed seam into canonical waypoints and ordered motion segments.
 *
 * Coordinates are used as given (robot base frame, millimetres, pre-calibrated by
 * assumption). Approach, retract and standby poses are a fixed clearance
 * heuristic derived from the seam; nothing here checks collisions, joint limits,
 * singularities or reachability.
 *
 * Offset convention (unchanged from the previous template, now explicit):
 *   approach = start − backoff·[tx, ty, 0] + lateral·w + [0, 0, lift]
 *   retract  = end   + forward·[tx, ty, 0] + lateral·w + [0, 0, lift]
 *   home     = chordMid + homeLateral·w_mid + [0, 0, maxWeldZ + homeLift − chordMid.z]
 * where t is the 3D unit travel tangent (its XY components only are used, so a
 * sloped seam gets a proportionally shorter back-off), w is t turned +90° about
 * Z in the XY plane and normalised (left of travel seen from above), and maxWeldZ
 * is the highest Z of the weld geometry (the arc's true maximum for curves).
 *
 * Straight seam: home, Target_30, Target_40, Target_20_5, Target_20 (5 targets).
 * Arc seam adds Target_45, the MoveC via target (6 targets). Both produce six
 * motion instructions including the closing return to home.
 */

const { fitCircle3Pt, sampleArc, pointOnArc, tangentOnArc } = require('./arcFitter');
const { diagnostic, hasErrors } = require('../util/errors');
const {
  normalizeQuaternion, quatMultiply, quatFromAxisAngle, roundQuaternion, quatNorm,
} = require('../validation/quaternion');
const { planFilletOrientation, PLANNER_VERSION } = require('./jointOrientation');
const { recoverOrientationAngles } = require('./orientationCheck');

const JOINT_PROFILE_ID = 'joint-relative-fillet';

const TARGETS = Object.freeze({
  home: 'home', approach: 'Target_30', weldStart: 'Target_40', weldVia: 'Target_45', weldEnd: 'Target_20_5', retract: 'Target_20',
});

const OFFSET_CONVENTION =
  'XY components of the 3D unit travel tangent scaled by the back-off/forward distance; lateral offset along the ' +
  'tangent turned +90° about Z in the XY plane; scalar Z lift. Not collision-checked.';

// The legacy lateral offset is not joint-aware (for a wall on the left of travel it
// points into the wall), so the joint-relative profile offsets along the torch body.
const JOINT_OFFSET_CONVENTION =
  'Approach = weld start + approachStandoffMm·b; retract = weld end + retractStandoffMm·b; standby = chord midpoint + ' +
  'homeStandoffMm·b, where b is the planned unit torch-body direction (from the wire tip back up the torch). Every ' +
  'target holds the planned weld orientation. Not collision-checked.';

const round4 = (n) => { const r = parseFloat(n.toFixed(4)); return Object.is(r, -0) ? 0 : r; };
const vec = (p) => [p.x, p.y, p.z];
const toPoint = (v) => ({ x: v[0], y: v[1], z: v[2] });
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const len = (v) => Math.hypot(v[0], v[1], v[2]);
const unit = (v) => { const l = len(v); return [v[0] / l, v[1] / l, v[2] / l]; };
const deg = (r) => (r * 180) / Math.PI;

/** Left-hand lateral in the XY plane, or null when the tangent is (near) vertical. */
function lateralNormal(dir, minHorizontal) {
  const h = Math.hypot(dir[0], dir[1]);
  return h >= minHorizontal ? [-dir[1] / h, dir[0] / h, 0] : null;
}

function outputQuaternion(q) {
  return roundQuaternion(normalizeQuaternion(q), 9).q;
}

function framingPoses(pStart, pEnd, dirStart, dirEnd, chordDir, maxWeldZ, c, minHorizontal) {
  const wStart = lateralNormal(dirStart, minHorizontal);
  const wEnd = lateralNormal(dirEnd, minHorizontal);
  const wMid = lateralNormal(chordDir, minHorizontal);
  if (!wStart || !wEnd || !wMid) return null;
  const approach = [
    round4(pStart[0] - c.approachBackoffMm * dirStart[0] + c.approachLateralMm * wStart[0]),
    round4(pStart[1] - c.approachBackoffMm * dirStart[1] + c.approachLateralMm * wStart[1]),
    round4(pStart[2] + c.approachLiftMm),
  ];
  const retract = [
    round4(pEnd[0] + c.retractForwardMm * dirEnd[0] + c.retractLateralMm * wEnd[0]),
    round4(pEnd[1] + c.retractForwardMm * dirEnd[1] + c.retractLateralMm * wEnd[1]),
    round4(pEnd[2] + c.retractLiftMm),
  ];
  const home = [
    round4((pStart[0] + pEnd[0]) / 2 + c.homeLateralMm * wMid[0]),
    round4((pStart[1] + pEnd[1]) / 2 + c.homeLateralMm * wMid[1]),
    round4(maxWeldZ + c.homeLiftMm),
  ];
  return { approach, retract, home };
}

function waypoint(name, type, pos, orient, conf, move) {
  return { name, type, pos, orient, conf: conf.slice(), speed: move ? move.speed : null, zone: move ? move.zone : null };
}

function buildSegments(profile, weldInstruction) {
  const m = profile.motion;
  const s = (index, instruction, role, from, to, move, via) => {
    const seg = { index, instruction, role, from, to, speed: move.speed, zone: move.zone };
    if (via) seg.via = via;
    return seg;
  };
  return [
    s(0, 'MoveJ', 'air', null, TARGETS.home, m.home),
    s(1, 'MoveL', 'air', TARGETS.home, TARGETS.approach, m.approach),
    s(2, 'MoveL', 'approach', TARGETS.approach, TARGETS.weldStart, m.weldStart),
    weldInstruction === 'MoveC'
      ? s(3, 'MoveC', 'weld', TARGETS.weldStart, TARGETS.weldEnd, m.weld, TARGETS.weldVia)
      : s(3, 'MoveL', 'weld', TARGETS.weldStart, TARGETS.weldEnd, m.weld),
    s(4, 'MoveL', 'retract', TARGETS.weldEnd, TARGETS.retract, m.retract),
    s(5, 'MoveL', 'air', TARGETS.retract, TARGETS.home, m.returnHome),
  ];
}

/** Exact maximum Z of a fitted arc over [0, sweep]. */
function arcMaxZ(fit) {
  const c = vec(fit.center);
  const n = vec(fit.normal);
  const e1 = unit(sub(vec(fit.start), c));
  const e2 = [n[1] * e1[2] - n[2] * e1[1], n[2] * e1[0] - n[0] * e1[2], n[0] * e1[1] - n[1] * e1[0]];
  const z = (t) => c[2] + fit.radius * (Math.cos(t) * e1[2] + Math.sin(t) * e2[2]);
  let best = Math.max(z(0), z(fit.sweepAngle));
  const crit = Math.atan2(e2[2], e1[2]);
  for (const t of [crit, crit + 2 * Math.PI, crit - 2 * Math.PI]) {
    if (t > 0 && t < fit.sweepAngle) best = Math.max(best, z(t));
  }
  return best;
}

/** Length and slope checks shared by every straight-seam plan; null when rejected. */
function straightChord(seam, limits, diagnostics, slopeNote) {
  const pStart = vec(seam.startPoint);
  const pEnd = vec(seam.endPoint);
  const chord = sub(pEnd, pStart);
  const lengthMm = len(chord);

  if (lengthMm < limits.minSeamLengthMm) {
    diagnostics.push(diagnostic('GEOMETRY_TOO_SHORT', 'error',
      `Seam length ${lengthMm.toFixed(4)} mm is below the ${limits.minSeamLengthMm} mm minimum. Start and end must be distinct.`,
      { details: { lengthMm, minSeamLengthMm: limits.minSeamLengthMm } }));
    return null;
  }
  const dir = unit(chord);
  const slopeDeg = deg(Math.atan2(Math.abs(chord[2]), Math.hypot(chord[0], chord[1])));
  const minHorizontal = Math.cos((limits.maxSlopeDeg * Math.PI) / 180);
  if (slopeDeg > limits.maxSlopeDeg) {
    diagnostics.push(diagnostic('GEOMETRY_NEAR_VERTICAL_UNSUPPORTED', 'error',
      `Seam slope ${slopeDeg.toFixed(2)}° exceeds ${limits.maxSlopeDeg}°. The lateral clearance direction is undefined for near-vertical seams, so no pose is invented.`,
      { details: { slopeDeg, maxSlopeDeg: limits.maxSlopeDeg } }));
    return null;
  }
  if (slopeDeg > 0.5) {
    diagnostics.push(diagnostic('GEOMETRY_SLOPED_SEAM', 'info', `Seam slope is ${slopeDeg.toFixed(2)}°. ${slopeNote}`, { details: { slopeDeg } }));
  }
  return { pStart, pEnd, lengthMm, dir, slopeDeg, minHorizontal };
}

function planStraight(seam, profile, diagnostics, extraGeometry = {}) {
  const chordInfo = straightChord(seam, profile.geometryLimits, diagnostics,
    'Approach/retract use the XY part of the travel tangent plus a vertical lift, so the back-off is shortened by cos(slope).');
  if (!chordInfo) return null;
  const { pStart, pEnd, lengthMm, dir, slopeDeg, minHorizontal } = chordInfo;

  const weldQ = outputQuaternion(profile.weldQuaternionSource);
  const homeQ = outputQuaternion(profile.homeQuaternionSource);
  const maxWeldZ = Math.max(pStart[2], pEnd[2]);
  const poses = framingPoses(pStart, pEnd, dir, dir, dir, maxWeldZ, profile.clearances, minHorizontal);
  const m = profile.motion;
  const conf = profile.configuration;

  const waypoints = [
    waypoint(TARGETS.home, 'home', poses.home, homeQ, conf, m.home),
    waypoint(TARGETS.approach, 'approach', poses.approach, weldQ, conf, m.approach),
    waypoint(TARGETS.weldStart, 'weld_start', pStart.map(round4), weldQ, conf, m.weldStart),
    waypoint(TARGETS.weldEnd, 'weld_end', pEnd.map(round4), weldQ, conf, m.weld),
    waypoint(TARGETS.retract, 'retract', poses.retract, weldQ, conf, m.retract),
  ];

  return {
    waypoints,
    segments: buildSegments(profile, 'MoveL'),
    geometry: {
      requestedType: seam.type,
      plannedType: 'straight',
      startPoint: seam.startPoint,
      endPoint: seam.endPoint,
      viaPoint: seam.viaPoint || null,
      seamWidthMm: seam.seamWidthMm,
      seamWidthProvenance: seam.seamWidthProvenance,
      chordLengthMm: lengthMm,
      lengthMm,
      slopeDeg,
      arc: null,
      homeZ: { formula: 'max weld-geometry Z + homeLiftMm', maxWeldZMm: maxWeldZ, homeLiftMm: profile.clearances.homeLiftMm },
      offsetConvention: OFFSET_CONVENTION,
      ...extraGeometry,
    },
  };
}

function planArc(seam, fit, profile, diagnostics) {
  const limits = profile.geometryLimits;
  const pStart = vec(seam.startPoint);
  const pVia = vec(seam.viaPoint);
  const pEnd = vec(seam.endPoint);
  const sweepDeg = deg(fit.sweepAngle);
  const viaDeg = deg(fit.viaAngle);

  if (fit.radius > limits.maxArcRadiusMm) {
    diagnostics.push(diagnostic('ARC_RADIUS_OUT_OF_RANGE', 'error',
      `Fitted radius ${fit.radius.toFixed(2)} mm exceeds the ${limits.maxArcRadiusMm} mm application limit.`,
      { details: { radiusMm: fit.radius, maxArcRadiusMm: limits.maxArcRadiusMm } }));
  }
  if (sweepDeg > limits.maxArcSweepDeg) {
    diagnostics.push(diagnostic('ARC_SWEEP_OUT_OF_RANGE', 'error',
      `Arc sweep ${sweepDeg.toFixed(2)}° exceeds the ${limits.maxArcSweepDeg}° application limit for a single MoveC (a conservative application choice, not an ABB-documented figure).`,
      { details: { sweepDeg, maxArcSweepDeg: limits.maxArcSweepDeg } }));
  }
  if (viaDeg < limits.minArcPointAngleDeg || sweepDeg - viaDeg < limits.minArcPointAngleDeg) {
    diagnostics.push(diagnostic('ARC_VIA_TOO_CLOSE', 'error',
      `The via point must be at least ${limits.minArcPointAngleDeg}° (seen from the centre) from both start and end; it is ${viaDeg.toFixed(3)}° from start and ${(sweepDeg - viaDeg).toFixed(3)}° from end.`,
      { field: 'arc_via', details: { viaAngleDeg: viaDeg, sweepDeg } }));
  }

  const minHorizontal = Math.cos((limits.maxSlopeDeg * Math.PI) / 180);
  const dirStart = tangentOnArc(fit, 0);
  const dirEnd = tangentOnArc(fit, fit.sweepAngle);
  const chordDir = unit(sub(pEnd, pStart));
  for (const [label, t] of [['start', dirStart], ['end', dirEnd]]) {
    const slope = deg(Math.atan2(Math.abs(t[2]), Math.hypot(t[0], t[1])));
    if (slope > limits.maxSlopeDeg) {
      diagnostics.push(diagnostic('GEOMETRY_NEAR_VERTICAL_UNSUPPORTED', 'error',
        `Arc tangent at the ${label} rises ${slope.toFixed(2)}°, above ${limits.maxSlopeDeg}°. The lateral clearance direction is undefined, so no pose is invented.`,
        { details: { at: label, slopeDeg: slope } }));
    }
  }
  if (fit.planeTiltDeg > limits.maxArcPlaneTiltDeg) {
    diagnostics.push(diagnostic('ARC_PLANE_TILTED', 'warning',
      `The arc plane is tilted ${fit.planeTiltDeg.toFixed(2)}° from horizontal. The fixed weld quaternion is rotated about this tilted normal and the clearance offsets remain horizontal; review the torch attitude in RobotStudio.`,
      { requiresAcknowledgement: true, details: { planeTiltDeg: fit.planeTiltDeg } }));
  }
  if (hasErrors(diagnostics)) return null;

  const weldQ = normalizeQuaternion(profile.weldQuaternionSource);
  const alongArc = (angle) => outputQuaternion(quatMultiply(quatFromAxisAngle(vec(fit.normal), angle), weldQ));
  const startQ = outputQuaternion(weldQ);
  const viaQ = alongArc(fit.viaAngle);
  const endQ = alongArc(fit.sweepAngle);
  const homeQ = outputQuaternion(profile.homeQuaternionSource);

  const maxWeldZ = arcMaxZ(fit);
  const poses = framingPoses(pStart, pEnd, dirStart, dirEnd, chordDir, maxWeldZ, profile.clearances, minHorizontal);
  const m = profile.motion;
  const conf = profile.configuration;

  const waypoints = [
    waypoint(TARGETS.home, 'home', poses.home, homeQ, conf, m.home),
    waypoint(TARGETS.approach, 'approach', poses.approach, startQ, conf, m.approach),
    waypoint(TARGETS.weldStart, 'weld_start', pStart.map(round4), startQ, conf, m.weldStart),
    waypoint(TARGETS.weldVia, 'weld_via', pVia.map(round4), viaQ, conf, null),
    waypoint(TARGETS.weldEnd, 'weld_end', pEnd.map(round4), endQ, conf, m.weld),
    // Retract holds the final weld attitude so the torch lifts away without re-orienting.
    waypoint(TARGETS.retract, 'retract', poses.retract, endQ, conf, m.retract),
  ];

  return {
    waypoints,
    segments: buildSegments(profile, 'MoveC'),
    geometry: {
      requestedType: 'arc',
      plannedType: 'arc',
      startPoint: seam.startPoint,
      endPoint: seam.endPoint,
      viaPoint: seam.viaPoint,
      seamWidthMm: seam.seamWidthMm,
      seamWidthProvenance: seam.seamWidthProvenance,
      chordLengthMm: fit.chordLength,
      lengthMm: fit.arcLength,
      slopeDeg: null,
      arc: {
        center: fit.center,
        radiusMm: fit.radius,
        normal: fit.normal,
        sweepDeg,
        viaAngleDeg: viaDeg,
        arcLengthMm: fit.arcLength,
        viaBowMm: fit.bow,
        maxChordDeviationMm: fit.maxChordDeviation,
        planeTiltDeg: fit.planeTiltDeg,
        direction: fit.direction,
        start: fit.start,
        samples: sampleArc(fit, limits.arcSampleSegments),
        sampling: `${limits.arcSampleSegments} equal-angle segments on the fitted circle (display only; the controller interpolates MoveC itself)`,
      },
      homeZ: { formula: 'max weld-geometry Z (exact arc maximum) + homeLiftMm', maxWeldZMm: maxWeldZ, homeLiftMm: profile.clearances.homeLiftMm },
      offsetConvention: OFFSET_CONVENTION,
    },
  };
}

/**
 * Straight seam, joint-relative orientation. The joint and tool convention are
 * declarations carried by the profile; the planner never infers them from the seam.
 */
function planStraightJointRelative(seam, profile, diagnostics) {
  const chordInfo = straightChord(seam, profile.geometryLimits, diagnostics,
    'The orientation follows the declared joint frame along the seam; offsets follow the planned torch-body direction.');
  if (!chordInfo) return null;
  const { pStart, pEnd, lengthMm, slopeDeg } = chordInfo;
  const { station } = profile;
  const planned = planFilletOrientation({
    start: pStart, end: pEnd, joint: profile.joint, toolConvention: station.toolConvention, ...profile.orientationRequest,
  });
  diagnostics.push(...planned.diagnostics);
  if (!planned.ok) return null;

  const weldQ = outputQuaternion(planned.quaternion);
  // Independent check on the value that is actually stored and serialised.
  const recovered = recoverOrientationAngles({ quaternion: weldQ, frame: planned.frame, toolConvention: station.toolConvention, requested: profile.orientationRequest });
  if (recovered.status !== 'mathematical_check_passed') {
    diagnostics.push(diagnostic('ORIENTATION_CHECK_FAILED', 'error',
      'The stored quaternion does not reproduce the requested work/push angles within tolerance. Nothing was generated.', { details: recovered }));
    return null;
  }

  const b = planned.vectors.torchBody;
  const c = profile.clearances;
  const along = (p, d) => p.map((v, i) => round4(v + d * b[i]));
  const mid = [0, 1, 2].map((i) => (pStart[i] + pEnd[i]) / 2);
  const m = profile.motion;
  const conf = profile.configuration;
  // One orientation for the whole straight seam, so no quaternion sign changes between targets.
  const waypoints = [
    waypoint(TARGETS.home, 'home', along(mid, c.homeStandoffMm), weldQ.slice(), conf, m.home),
    waypoint(TARGETS.approach, 'approach', along(pStart, c.approachStandoffMm), weldQ.slice(), conf, m.approach),
    waypoint(TARGETS.weldStart, 'weld_start', pStart.map(round4), weldQ.slice(), conf, m.weldStart),
    waypoint(TARGETS.weldEnd, 'weld_end', pEnd.map(round4), weldQ.slice(), conf, m.weld),
    waypoint(TARGETS.retract, 'retract', along(pEnd, c.retractStandoffMm), weldQ.slice(), conf, m.retract),
  ];

  return {
    waypoints,
    segments: buildSegments(profile, 'MoveL'),
    geometry: {
      requestedType: seam.type,
      plannedType: 'straight',
      startPoint: seam.startPoint,
      endPoint: seam.endPoint,
      viaPoint: null,
      seamWidthMm: seam.seamWidthMm,
      seamWidthProvenance: seam.seamWidthProvenance,
      chordLengthMm: lengthMm,
      lengthMm,
      slopeDeg,
      arc: null,
      homeZ: null,
      standby: { formula: 'chord midpoint + homeStandoffMm along the torch-body direction', homeStandoffMm: c.homeStandoffMm },
      offsetConvention: JOINT_OFFSET_CONVENTION,
      conversion: null,
    },
    orientation: {
      mode: 'joint_relative_straight_fillet',
      plannerVersion: PLANNER_VERSION,
      experimental: true,
      jointSpec: planned.spec,
      jointFrame: planned.frame,
      toolConvention: station.toolConvention,
      station: { id: station.id, version: station.version, provenance: station.provenance, label: station.label },
      requested: profile.orientationRequest,
      vectors: planned.vectors,
      recovered: { ...recovered, fromTarget: TARGETS.weldStart, quaternion: weldQ },
      appliesTo: 'every target of this straight seam (standby, approach, weld start, weld end, retract)',
      conventions: {
        workAngle: "Transverse-plane angle from plate A's surface towards plate B (45° bisects a 90° joint).",
        pushAngle: 'Signed angle of the torch body from the transverse plane; positive = push (tip leans towards travel start→end).',
        roll: 'Declared roll axis along travel (or against it) projected perpendicular to the approach axis.',
        quaternion: 'ABB order [w,x,y,z]; sign chosen with w ≥ 0.',
      },
    },
  };
}

const FIT_REASON_CODES = {
  coincident_points: ['ARC_COINCIDENT_POINTS', 'Two of the three arc points coincide (closer than the minimum separation). This is invalid input and is not treated as a line.'],
  collinear_points: ['ARC_COLLINEAR_POINTS', 'The three arc points are collinear, so no circle passes through them. Correct the via point or describe the seam as a straight curve: line.'],
  via_not_between: ['ARC_VIA_NOT_BETWEEN', 'The via point does not lie between start and end along the fitted circle.'],
  non_finite: ['GEOMETRY_NON_FINITE', 'Arc points contain non-finite values.'],
  missing_point: ['GEOMETRY_MISSING_POINT', 'An arc point is missing.'],
};

/**
 * @param {object} seam     Output of parseFeatureText().seam
 * @param {object} profile  Resolved profile (fixed-base-quaternion)
 * @returns {{ok: boolean, diagnostics: object[], waypoints?: object[], segments?: object[], geometry?: object}}
 */
function planSeam(seam, profile) {
  const diagnostics = [];
  if (profile.id === JOINT_PROFILE_ID) {
    if (seam.type !== 'straight') {
      diagnostics.push(diagnostic('ORIENTATION_ARC_UNSUPPORTED', 'error',
        'Joint-relative orientation is implemented for straight seams only. This arc was not planned and no fixed orientation was substituted; use the fixed-base-quaternion profile for arcs.',
        { field: 'profileId' }));
      return { ok: false, diagnostics };
    }
    const joint = planStraightJointRelative(seam, profile, diagnostics);
    if (!joint || hasErrors(diagnostics)) return { ok: false, diagnostics };
    return { ok: true, diagnostics, ...joint };
  }
  const sourceNorm = quatNorm(profile.weldQuaternionSource);
  if (Math.abs(sourceNorm - 1) > 1e-6) {
    diagnostics.push(diagnostic('PROFILE_QUATERNION_NORMALIZED', 'info',
      `The profile weld quaternion has norm ${sourceNorm.toFixed(9)} and was normalised before use. Normalisation does not validate the torch attitude.`,
      { details: { sourceNorm } }));
  }

  let result = null;
  if (seam.type === 'straight') {
    result = planStraight(seam, profile, diagnostics);
  } else {
    const limits = profile.geometryLimits;
    const fit = fitCircle3Pt(seam.startPoint, seam.viaPoint, seam.endPoint);
    if (!fit.ok) {
      const [code, message] = FIT_REASON_CODES[fit.reason] || ['ARC_FIT_FAILED', `Arc fit failed (${fit.reason}).`];
      diagnostics.push(diagnostic(code, 'error', message, { details: fit.details }));
    } else if (fit.maxChordDeviation < limits.nearStraightDeviationMm) {
      const details = { maxChordDeviationMm: fit.maxChordDeviation, viaBowMm: fit.bow, radiusMm: fit.radius, thresholdMm: limits.nearStraightDeviationMm };
      if (profile.nearStraightArcPolicy === 'convert_to_line') {
        diagnostics.push(diagnostic('ARC_CONVERTED_TO_LINE', 'warning',
          `The requested arc deviates at most ${fit.maxChordDeviation.toFixed(4)} mm from its chord and was converted to a straight seam because this revision selected that option. The via point is ignored.`,
          { requiresAcknowledgement: true, details }));
        result = planStraight({ ...seam, type: 'straight' }, profile, diagnostics, {
          requestedType: 'arc',
          viaPoint: seam.viaPoint,
          conversion: { from: 'arc', to: 'straight', ...details },
        });
      } else {
        diagnostics.push(diagnostic('ARC_NEAR_STRAIGHT', 'error',
          `The arc deviates at most ${fit.maxChordDeviation.toFixed(4)} mm from its chord (threshold ${limits.nearStraightDeviationMm} mm); its radius (${fit.radius.toFixed(1)} mm) is numerically fragile. Generation is blocked. Correct the input, or reprocess with the explicit near-straight conversion option.`,
          { details }));
      }
    } else {
      result = planArc(seam, fit, profile, diagnostics);
    }
  }

  if (!result || hasErrors(diagnostics)) return { ok: false, diagnostics };
  if (!result.geometry.conversion) result.geometry.conversion = null;
  return { ok: true, diagnostics, ...result };
}

module.exports = { planSeam, TARGETS, OFFSET_CONVENTION, JOINT_OFFSET_CONVENTION, JOINT_PROFILE_ID, lateralNormal, arcMaxZ, pointOnArc };
