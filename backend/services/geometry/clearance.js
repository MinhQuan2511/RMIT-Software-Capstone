/**
 * Workpiece-clearance diagnostics for a stored plan (vd-workpiece-clearance@1).
 * Pure and deterministic: the same waypoints, segments, workpiece model and
 * tool envelope always give the same record.
 *
 * Scope: the modeled plates of one declared workpiece only. No robot arm,
 * fixture, cell, cable, wire or clamp is modeled, so nothing here says a motion
 * is safe or collision-free. Statuses:
 *   intersection_detected                        definite, for the assessed geometry and motion
 *   no_intersection_detected_in_assessed_geometry  only for the portions that were assessed
 *   inconclusive                                 assessed, but within a tolerance band the method cannot resolve
 *   not_assessed                                 missing geometry/envelope, or motion that is not reconstructed
 *
 * Checks (method: LocalUse/4/GEOMETRY_CLEARANCE_METHOD.md §5–7):
 *   1 target_position        TCP of every stored target vs each plate
 *   2 tcp_path               TCP along MoveL segments (exact straight lines between corner zones)
 *   3 tool_envelope          capsules at every target and swept along MoveL portions with constant orientation
 *   4 unassessed motion      MoveJ, MoveC, motion from an unknown start, corner zones, changing orientation
 * All distances are exact for the modeled boxes and capsules (no sampling).
 */

'use strict';

const { sub, norm, lerp, toLocal, pointBox, segmentBox, segmentPenetration, hullBox } = require('./distance');
const { capsuleAtPose } = require('./toolEnvelope');
const { canonicalJson, sha256 } = require('../util/hash');

const METHOD_VERSION = 'vd-workpiece-clearance@1';

const TOLERANCES = Object.freeze({
  numericalEpsilonMm: 1e-6,
  grazingToleranceMm: 0.1,
  weldContactToleranceMm: 0.5,
  weldContactZoneMm: 2,
});

const STATUS = Object.freeze({
  INTERSECTION: 'intersection_detected',
  CLEAR: 'no_intersection_detected_in_assessed_geometry',
  INCONCLUSIVE: 'inconclusive',
  NOT_ASSESSED: 'not_assessed',
});

/**
 * ABB predefined zonedata radii in mm: TCP path zone (pzone_tcp) and tool
 * reorientation zone (pzone_ori). Source: ABB Technical reference manual RAPID
 * Instructions, Functions and Data types, 3HAC16581-1 rev. J, §3.78 zonedata.
 * fine is a stop point. The robot may reduce a zone (never enlarge it), so
 * treating the full radius as unreconstructed corner path is conservative.
 */
const ZONES = Object.freeze({
  fine: { tcp: 0, ori: 0 }, z0: { tcp: 0.3, ori: 0.3 }, z1: { tcp: 1, ori: 1 }, z5: { tcp: 5, ori: 8 },
  z10: { tcp: 10, ori: 15 }, z15: { tcp: 15, ori: 23 }, z20: { tcp: 20, ori: 30 }, z30: { tcp: 30, ori: 45 },
  z40: { tcp: 40, ori: 60 }, z50: { tcp: 50, ori: 75 }, z60: { tcp: 60, ori: 90 }, z80: { tcp: 80, ori: 120 },
  z100: { tcp: 100, ori: 150 }, z150: { tcp: 150, ori: 225 }, z200: { tcp: 200, ori: 300 },
});

const WELD_TYPES = new Set(['weld_start', 'weld_via', 'weld_end']);
const RANK = { [STATUS.NOT_ASSESSED]: 0, [STATUS.CLEAR]: 1, [STATUS.INCONCLUSIVE]: 2, [STATUS.INTERSECTION]: 3 };

const REASONS = Object.freeze({
  WORKPIECE_GEOMETRY_UNAVAILABLE: 'No workpiece geometry is declared for this revision (seam-only mode).',
  TOOL_ENVELOPE_UNKNOWN: 'No tool envelope is declared; the torch body is not checked.',
  START_POSITION_UNKNOWN: 'The move starts from the robot position at program start, which is unknown.',
  JOINT_SPACE_MOTION_NOT_RECONSTRUCTED: 'MoveJ interpolates joint angles: the TCP follows a non-linear path that depends on the robot kinematics, which are not modeled. Any drawn connector is schematic.',
  CIRCULAR_MOTION_NOT_ASSESSED: 'MoveC motion is not assessed by this method version.',
  INSTRUCTION_NOT_RECOGNISED: 'Motion instruction not recognised by this method.',
  CORNER_PATH_NOT_RECONSTRUCTED: 'Fly-by corner zone: the controller generates a corner path inside the zone that is not reconstructed here.',
  ZONES_COVER_SEGMENT: 'The corner zones at both ends cover the whole segment, so no portion is known to be linear.',
  ORIENTATION_INTERPOLATION_NOT_RECONSTRUCTED: 'The tool orientation changes along this move; the controller orientation interpolation is not reconstructed, so the swept torch envelope is not assessed.',
});

const round6 = (x) => (Number.isFinite(x) ? Math.round(x * 1e6) / 1e6 : x);
const r6v = (v) => (Array.isArray(v) ? v.map(round6) : v);

const worst = (results) => results.reduce((acc, r) => (RANK[r] > RANK[acc] ? r : acc), STATUS.NOT_ASSESSED);

function notAssessed(reasonCode) {
  return { result: STATUS.NOT_ASSESSED, reasonCode, message: REASONS[reasonCode] };
}

function motionModel(seg) {
  if (!seg.from) return { model: 'unknown_start', connector: 'none', assessable: false, reasonCode: 'START_POSITION_UNKNOWN' };
  if (seg.instruction === 'MoveL') return { model: 'linear_tcp', connector: 'linear', assessable: true };
  if (seg.instruction === 'MoveJ') return { model: 'joint_space', connector: 'schematic', assessable: false, reasonCode: 'JOINT_SPACE_MOTION_NOT_RECONSTRUCTED' };
  if (seg.instruction === 'MoveC') return { model: 'circular', connector: 'arc', assessable: false, reasonCode: 'CIRCULAR_MOTION_NOT_ASSESSED' };
  return { model: 'unrecognised', connector: 'schematic', assessable: false, reasonCode: 'INSTRUCTION_NOT_RECOGNISED' };
}

/** Same rotation (q ≡ −q), comparing normalised quaternions: stored values are rounded to 9 decimals. */
function sameOrientation(q1, q2) {
  const n = Math.hypot(...q1) * Math.hypot(...q2);
  const d = Math.abs(q1[0] * q2[0] + q1[1] * q2[1] + q1[2] * q2[2] + q1[3] * q2[3]) / n;
  return d >= 1 - 1e-12;
}

/** Depth below a plate's joint surface for a local-frame coordinate. */
const jointDepth = (part, local) => part.half[part.jointFace.localAxis] - part.jointFace.sign * local[part.jointFace.localAxis];

/** TCP point (a target) against one plate. */
function tcpPointVsPart(p, part, contactAllowed) {
  const t = TOLERANCES;
  const r = pointBox(p, part);
  if (r.distance > 0) {
    if (!contactAllowed && r.distance <= t.grazingToleranceMm) {
      return { result: STATUS.INCONCLUSIVE, kind: 'within_grazing_tolerance_outside', distanceMm: round6(r.distance), closestOnMaterial: r6v(r.closestOnBox), toleranceMm: t.grazingToleranceMm };
    }
    return { result: STATUS.CLEAR, kind: 'outside_material', distanceMm: round6(r.distance), distanceKind: 'exact_to_modeled_plate', closestOnMaterial: r6v(r.closestOnBox) };
  }
  const jd = jointDepth(part, r.local);
  if (contactAllowed && jd <= t.weldContactToleranceMm) {
    return { result: STATUS.CLEAR, kind: 'intended_joint_surface_contact', depthBelowJointSurfaceMm: round6(jd), toleranceMm: t.weldContactToleranceMm, point: r6v(p) };
  }
  if (r.depth > t.grazingToleranceMm) return { result: STATUS.INTERSECTION, kind: 'inside_material', depthMm: round6(r.depth), point: r6v(p), toleranceMm: t.grazingToleranceMm };
  return { result: STATUS.INCONCLUSIVE, kind: 'touching_within_grazing_tolerance', depthMm: round6(r.depth), point: r6v(p), toleranceMm: t.grazingToleranceMm };
}

/** Straight TCP piece a→b against one plate. */
function tcpPieceVsPart(a, b, part, contactAllowed) {
  const t = TOLERANCES;
  const pen = segmentPenetration(a, b, part, t.numericalEpsilonMm);
  if (pen.touches && contactAllowed && !pen.throughCrossing) {
    const la = toLocal(part, lerp(a, b, pen.interval[0]));
    const lb = toLocal(part, lerp(a, b, pen.interval[1]));
    const jd = Math.max(jointDepth(part, la), jointDepth(part, lb));
    if (jd <= t.weldContactToleranceMm) {
      return { result: STATUS.CLEAR, kind: 'intended_joint_surface_contact', maxDepthBelowJointSurfaceMm: round6(Math.max(0, jd)), toleranceMm: t.weldContactToleranceMm };
    }
  }
  if (pen.throughCrossing) {
    return { result: STATUS.INTERSECTION, kind: 'through_crossing', entryPoint: r6v(pen.throughCrossing.entryPoint), exitPoint: r6v(pen.throughCrossing.exitPoint), maxDepthMm: round6(pen.maxDepth) };
  }
  if (pen.touches && pen.maxDepth > t.grazingToleranceMm) {
    return { result: STATUS.INTERSECTION, kind: 'penetration', maxDepthMm: round6(pen.maxDepth), deepestPoint: r6v(pen.deepestPoint), toleranceMm: t.grazingToleranceMm };
  }
  if (pen.touches) {
    return { result: STATUS.INCONCLUSIVE, kind: 'contact_within_grazing_tolerance', maxDepthMm: round6(pen.maxDepth), point: r6v(pen.deepestPoint), toleranceMm: t.grazingToleranceMm };
  }
  const d = segmentBox(a, b, part);
  // Outside the material near a weld target (e.g. ending on the root line up to rounding) is not contact to resolve.
  if (d.distance <= t.grazingToleranceMm && !contactAllowed) {
    return { result: STATUS.INCONCLUSIVE, kind: 'within_grazing_tolerance_outside', distanceMm: round6(d.distance), closestOnMaterial: r6v(d.closestOnBox), toleranceMm: t.grazingToleranceMm };
  }
  return { result: STATUS.CLEAR, kind: 'outside_material', distanceMm: round6(d.distance), distanceKind: 'exact_to_modeled_plate', closestOnPath: r6v(d.closestOnShape), closestOnMaterial: r6v(d.closestOnBox) };
}

/** Convex hull of a capsule core (1, 2 or 4 points) with radius r against one plate. */
function capsuleHullVsPart(points, radiusMm, part) {
  const t = TOLERANCES;
  const r = hullBox(points, part);
  const d = r.distance;
  if (d < radiusMm - t.grazingToleranceMm) {
    return {
      result: STATUS.INTERSECTION,
      kind: d === 0 ? 'capsule_core_meets_material' : 'capsule_overlaps_material',
      overlapDepthLowerBoundMm: round6(radiusMm - d),
      witnessOnMaterial: r6v(r.closestOnBox),
      note: 'Intersection established; the reported depth is a lower bound, not an exact penetration depth.',
    };
  }
  if (d <= radiusMm + t.grazingToleranceMm) {
    return { result: STATUS.INCONCLUSIVE, kind: 'within_grazing_tolerance', coreDistanceMm: round6(d), radiusMm, toleranceMm: t.grazingToleranceMm, witnessOnMaterial: r6v(r.closestOnBox) };
  }
  return { result: STATUS.CLEAR, kind: 'outside_material', clearanceMm: round6(d - radiusMm), distanceKind: 'exact_for_capsule_model', closestOnMaterial: r6v(r.closestOnBox) };
}

const perParts = (parts, fn) => {
  const items = parts.map((part) => ({ part: part.id, ...fn(part) }));
  return { result: worst(items.map((i) => i.result)), parts: items };
};

function envelopeAtPose(envelope, pos, orient, parts) {
  const capsules = envelope.capsules.map((c) => {
    const k = capsuleAtPose(c, pos, orient);
    const res = perParts(parts, (part) => capsuleHullVsPart([k.from, k.to], c.radiusMm, part));
    return { capsule: c.id, radiusMm: c.radiusMm, ...res };
  });
  return { result: worst(capsules.map((c) => c.result)), capsules };
}

function envelopeSwept(envelope, p0, p1, orient, parts) {
  const capsules = envelope.capsules.map((c) => {
    const k0 = capsuleAtPose(c, p0, orient);
    const k1 = capsuleAtPose(c, p1, orient);
    const res = perParts(parts, (part) => capsuleHullVsPart([k0.from, k0.to, k1.to, k1.from], c.radiusMm, part));
    return { capsule: c.id, radiusMm: c.radiusMm, ...res };
  });
  return { result: worst(capsules.map((c) => c.result)), capsules };
}

/**
 * Splits [0, L] into corner portions (not assessed) and linear pieces. Pieces
 * within weldContactZoneMm of a weld target may make intended joint-surface contact.
 */
function portionsOf(L, rStart, rEnd, startWeld, endWeld, wholeContact) {
  const out = [];
  const s0 = Math.min(rStart, L);
  const s1 = Math.max(L - rEnd, s0);
  if (rStart > 0) out.push({ portion: 'corner_start', fromMm: 0, toMm: s0, ...notAssessed('CORNER_PATH_NOT_RECONSTRUCTED') });
  if (s1 - s0 <= TOLERANCES.numericalEpsilonMm) {
    out.push({ portion: 'linear', fromMm: s0, toMm: s1, ...notAssessed('ZONES_COVER_SEGMENT') });
  } else {
    const cuts = new Set([s0, s1]);
    const z = TOLERANCES.weldContactZoneMm;
    if (!wholeContact && startWeld && z > s0 && z < s1) cuts.add(z);
    if (!wholeContact && endWeld && L - z > s0 && L - z < s1) cuts.add(L - z);
    const sorted = [...cuts].sort((x, y) => x - y);
    for (let i = 0; i + 1 < sorted.length; i += 1) {
      const from = sorted[i];
      const to = sorted[i + 1];
      const contactAllowed = wholeContact || (startWeld && to <= z + 1e-9) || (endWeld && from >= L - z - 1e-9);
      out.push({ portion: 'linear', fromMm: from, toMm: to, contactAllowed, assess: true });
    }
  }
  if (rEnd > 0) out.push({ portion: 'corner_end', fromMm: s1, toMm: L, ...notAssessed('CORNER_PATH_NOT_RECONSTRUCTED') });
  return out;
}

function coverage(portions) {
  const assessed = portions.filter((p) => p.result !== STATUS.NOT_ASSESSED).length;
  return assessed === portions.length ? 'assessed' : assessed === 0 ? 'not_assessed' : 'partially_assessed';
}

function finalisePortions(portions) {
  const clean = portions.map((p) => {
    const { assess, ...rest } = p;
    return { ...rest, fromMm: round6(rest.fromMm), toMm: round6(rest.toMm) };
  });
  const assessed = clean.filter((p) => p.result !== STATUS.NOT_ASSESSED).map((p) => p.result);
  return { result: assessed.length ? worst(assessed) : STATUS.NOT_ASSESSED, coverage: coverage(clean), portions: clean };
}

/**
 * @param {{waypoints: object[], segments: object[], workpiece: object, toolEnvelope: object, identity?: object}} input
 *   workpiece: model from buildWorkpieceModel; toolEnvelope: validated definition
 */
function evaluateClearance({ waypoints, segments, workpiece, toolEnvelope, identity = {} }) {
  const byName = new Map(waypoints.map((w) => [w.name, w]));
  const geometryKnown = !!workpiece && workpiece.kind === 'fillet90_plates';
  const envelopeKnown = !!toolEnvelope && toolEnvelope.kind === 'tool_frame_capsules';
  const parts = geometryKnown ? workpiece.parts : [];
  // TCP depth is measured in each plate and in the depth proxy across their shared face (inside the union).
  const tcpParts = geometryKnown ? [...parts, ...(workpiece.depthProxies || [])] : [];
  const unassessed = [];
  const skip = (subject, check, reasonCode) => { unassessed.push({ subject, check, reasonCode, message: REASONS[reasonCode] }); return notAssessed(reasonCode); };

  const targets = waypoints.map((w) => {
    const subject = { kind: 'target', name: w.name, type: w.type };
    const weldPoint = WELD_TYPES.has(w.type);
    const position = geometryKnown
      ? perParts(tcpParts, (part) => tcpPointVsPart(w.pos, part, weldPoint))
      : skip(subject, 'target_position', 'WORKPIECE_GEOMETRY_UNAVAILABLE');
    let envelope;
    if (!geometryKnown) envelope = skip(subject, 'tool_envelope', 'WORKPIECE_GEOMETRY_UNAVAILABLE');
    else if (!envelopeKnown) envelope = skip(subject, 'tool_envelope', 'TOOL_ENVELOPE_UNKNOWN');
    else envelope = envelopeAtPose(toolEnvelope, w.pos, w.orient, parts);
    return { name: w.name, type: w.type, weldPoint, contactPolicy: weldPoint ? 'designated weld point: joint-surface contact within weldContactToleranceMm is intended' : 'no contact allowance', position, toolEnvelope: envelope };
  });

  const segmentResults = segments.map((seg, k) => {
    const mm = motionModel(seg);
    const subject = { kind: 'segment', index: seg.index, instruction: seg.instruction, role: seg.role, from: seg.from, to: seg.to };
    const base = { index: seg.index, instruction: seg.instruction, role: seg.role, from: seg.from, to: seg.to, ...(seg.via ? { via: seg.via } : {}), speed: seg.speed, zone: seg.zone, motionModel: mm.model, connector: mm.connector };
    if (!mm.assessable) {
      const r = skip(subject, 'motion', mm.reasonCode);
      return { ...base, tcpPath: { ...r, coverage: 'not_assessed', portions: [] }, toolEnvelope: { ...notAssessed(mm.reasonCode), coverage: 'not_assessed', portions: [] } };
    }
    const A = byName.get(seg.from);
    const B = byName.get(seg.to);
    const L = norm(sub(B.pos, A.pos));
    base.lengthMm = round6(L);
    if (!geometryKnown) {
      const r = skip(subject, 'tcp_path', 'WORKPIECE_GEOMETRY_UNAVAILABLE');
      return { ...base, tcpPath: { ...r, coverage: 'not_assessed', portions: [] }, toolEnvelope: { ...notAssessed('WORKPIECE_GEOMETRY_UNAVAILABLE'), coverage: 'not_assessed', portions: [] } };
    }
    const prev = k > 0 && segments[k - 1].to === seg.from ? segments[k - 1] : null;
    const zStart = prev ? (ZONES[prev.zone] || { tcp: Infinity, ori: Infinity }) : ZONES.fine;
    const zEnd = ZONES[seg.zone] || { tcp: Infinity, ori: Infinity };
    const startWeld = WELD_TYPES.has(A.type);
    const endWeld = WELD_TYPES.has(B.type);
    const at = (s) => lerp(A.pos, B.pos, L > 0 ? s / L : 0);

    const tcpPortions = portionsOf(L, zStart.tcp, zEnd.tcp, startWeld, endWeld, seg.role === 'weld').map((p) => {
      if (!p.assess) return p;
      return { ...p, ...perParts(tcpParts, (part) => tcpPieceVsPart(at(p.fromMm), at(p.toMm), part, p.contactAllowed)) };
    });
    const tcpPath = finalisePortions(tcpPortions);
    tcpPath.portions.filter((p) => p.result === STATUS.NOT_ASSESSED).forEach((p) => unassessed.push({ subject: { ...subject, portion: p.portion, fromMm: p.fromMm, toMm: p.toMm }, check: 'tcp_path', reasonCode: p.reasonCode, message: p.message }));

    let envelope;
    if (!envelopeKnown) envelope = { ...skip(subject, 'tool_envelope', 'TOOL_ENVELOPE_UNKNOWN'), coverage: 'not_assessed', portions: [] };
    else if (!sameOrientation(A.orient, B.orient)) envelope = { ...skip(subject, 'tool_envelope', 'ORIENTATION_INTERPOLATION_NOT_RECONSTRUCTED'), coverage: 'not_assessed', portions: [] };
    else {
      const envPortions = portionsOf(L, zStart.ori, zEnd.ori, false, false, true).map((p) => {
        if (!p.assess) return p;
        const { contactAllowed, ...rest } = p;
        return { ...rest, ...envelopeSwept(toolEnvelope, at(p.fromMm), at(p.toMm), A.orient, parts) };
      });
      envelope = finalisePortions(envPortions);
      envelope.portions.filter((p) => p.result === STATUS.NOT_ASSESSED).forEach((p) => unassessed.push({ subject: { ...subject, portion: p.portion, fromMm: p.fromMm, toMm: p.toMm }, check: 'tool_envelope', reasonCode: p.reasonCode, message: p.message }));
    }
    return {
      ...base,
      zones: { start: prev ? prev.zone : 'fine', end: seg.zone, startTcpRadiusMm: zStart.tcp, endTcpRadiusMm: zEnd.tcp, startOriRadiusMm: zStart.ori, endOriRadiusMm: zEnd.ori, radiiSource: 'ABB 3HAC16581-1 rev. J §3.78 predefined zonedata' },
      tcpPath,
      toolEnvelope: envelope,
    };
  });

  // Findings: every definite or inconclusive item, flattened for review.
  const findings = [];
  const addFindings = (scope, subject, check) => {
    if (!check || !check.parts) return;
    for (const item of check.parts) if (item.result === STATUS.INTERSECTION || item.result === STATUS.INCONCLUSIVE) findings.push({ scope, subject, ...item });
  };
  for (const t of targets) {
    const subject = { kind: 'target', name: t.name, type: t.type };
    addFindings('target_position', subject, t.position);
    if (t.toolEnvelope.capsules) for (const c of t.toolEnvelope.capsules) addFindings('tool_envelope_at_target', { ...subject, capsule: c.capsule }, c);
  }
  for (const s of segmentResults) {
    const subject = { kind: 'segment', index: s.index, instruction: s.instruction, role: s.role, from: s.from, to: s.to };
    for (const p of s.tcpPath.portions) addFindings('tcp_path', { ...subject, portion: p.portion, fromMm: p.fromMm, toMm: p.toMm }, p);
    for (const p of s.toolEnvelope.portions) if (p.capsules) for (const c of p.capsules) addFindings('tool_envelope_swept', { ...subject, portion: p.portion, fromMm: p.fromMm, toMm: p.toMm, capsule: c.capsule }, c);
  }
  findings.forEach((f, i) => { f.id = `F${String(i + 1).padStart(3, '0')}`; });

  const cat = (results) => (results.some((r) => r !== STATUS.NOT_ASSESSED) ? worst(results.filter((r) => r !== STATUS.NOT_ASSESSED)) : STATUS.NOT_ASSESSED);
  const categories = {
    targetPositions: cat(targets.map((t) => t.position.result)),
    tcpPath: cat(segmentResults.map((s) => s.tcpPath.result)),
    toolEnvelope: cat([...targets.map((t) => t.toolEnvelope.result), ...segmentResults.map((s) => s.toolEnvelope.result)]),
  };
  const all = Object.values(categories);
  const result = !geometryKnown ? STATUS.NOT_ASSESSED : all.includes(STATUS.INTERSECTION) ? STATUS.INTERSECTION : all.includes(STATUS.INCONCLUSIVE) ? STATUS.INCONCLUSIVE : STATUS.CLEAR;
  const count = (list) => ({
    total: list.length,
    assessed: list.filter((c) => c === 'assessed').length,
    partiallyAssessed: list.filter((c) => c === 'partially_assessed').length,
    notAssessed: list.filter((c) => c === 'not_assessed').length,
  });
  const provenance = geometryKnown ? workpiece.provenance : 'unknown';

  return {
    methodVersion: METHOD_VERSION,
    scope: 'Modeled workpiece plates only. The robot arm, fixtures, clamps, cables and cell are not modeled; no result here means safe, collision-free or robot-validated.',
    geometry: { kind: geometryKnown ? workpiece.kind : 'unknown', provenance, label: workpiece ? workpiece.label : 'Workpiece geometry unavailable', definitionSha256: workpiece ? workpiece.definitionSha256 : null },
    toolEnvelope: { kind: envelopeKnown ? toolEnvelope.kind : 'unknown', provenance: envelopeKnown ? toolEnvelope.provenance : 'unknown', definitionSha256: toolEnvelope ? sha256(canonicalJson(toolEnvelope)) : null },
    identity: { ...identity, pathSha256: sha256(canonicalJson({ waypoints, segments })) },
    tolerances: { ...TOLERANCES },
    statusVocabulary: { ...STATUS },
    assumptions: [
      'Positions, orientations, plates and envelope are expressed in one frame (the seam input frame = the robtarget frame); relative checks do not depend on that frame\'s unknown pose.',
      'MoveL moves the TCP on a straight line between its targets outside fly-by corner zones (ABB 3HAC16581-1 §1.98). Stop points (fine) are reached exactly.',
      'Inside a fly-by zone the controller generates a corner path (a parabola per ABB §3.78) whose exact shape is not reconstructed: that portion is Not assessed. The full programmed radius is treated as the zone; the controller may reduce it, never enlarge it.',
      'On a MoveL whose start and end orientations are identical the torch keeps that orientation, so each capsule sweeps a parallelogram plus its radius. When orientations differ the swept envelope is Not assessed.',
      'MoveJ paths are non-linear in Cartesian space (ABB §1.95) and are Not assessed; drawn connectors are schematic.',
    ],
    limitations: [
      'Plates are ideal rectangular boxes; welds, tack welds, bevels, gaps, clamps and part tolerances are not modeled.',
      'Distances are exact for the modeled boxes and capsules only. Penetration depth is reported exactly for TCP points and paths; for envelope overlap only a lower bound is reported.',
      'The first move of the program starts from an unknown robot position.',
    ],
    categories,
    overall: {
      result,
      geometryProvenance: provenance,
      realWorkpiece: provenance === 'operator_defined' ? result : STATUS.NOT_ASSESSED,
      realWorkpieceNote: provenance === 'operator_defined'
        ? 'Against operator-defined plate dimensions (declared, not measured).'
        : provenance === 'illustrative' ? 'Illustrative geometry: results describe the illustrative plates only; the real workpiece is not assessed.' : 'No workpiece geometry: nothing is assessed.',
      blocksExport: provenance === 'operator_defined' && result === STATUS.INTERSECTION,
      intersectionCount: findings.filter((f) => f.result === STATUS.INTERSECTION).length,
      inconclusiveCount: findings.filter((f) => f.result === STATUS.INCONCLUSIVE).length,
    },
    counts: {
      targets: { total: targets.length, assessed: targets.filter((t) => t.position.result !== STATUS.NOT_ASSESSED).length },
      tcpPathSegments: count(segmentResults.map((s) => s.tcpPath.coverage)),
      toolEnvelopeSegments: count(segmentResults.map((s) => s.toolEnvelope.coverage)),
    },
    targets,
    segments: segmentResults,
    findings,
    unassessed,
  };
}

module.exports = { METHOD_VERSION, TOLERANCES, STATUS, ZONES, REASONS, evaluateClearance, motionModel, tcpPieceVsPart, tcpPointVsPart, capsuleHullVsPart };
