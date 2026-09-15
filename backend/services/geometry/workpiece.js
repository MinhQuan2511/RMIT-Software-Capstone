/**
 * Versioned workpiece definition (vd-workpiece@1) and the canonical plate model
 * derived from it. Pure functions; no I/O.
 *
 * One model serves the backend clearance checks and the browser preview: the
 * backend validates the definition, derives the plate boxes once and stores
 * them in the revision; the preview draws exactly those boxes.
 *
 * Supported: straight 90° fillet joints of two finite rectangular plates
 * (arrangement 'tee' or 'corner'), or 'unknown' (seam-only mode). Butt, lap,
 * non-orthogonal, curved and imported-CAD workpieces are rejected, never
 * approximated by this model.
 *
 * Frame. All vectors and points are in the frame the seam coordinates are
 * written in (the same frame as the generated robtargets, i.e. the object frame
 * of the work object named in the module). The application applies no transform
 * and does not know that frame's pose. Joint-local coordinates (u, a, b):
 *   j  = unit(nA × nB)     joint axis (physical; does not follow travel direction)
 *   nA = plate A joint-face normal, pointing out of plate A into the open region
 *   nB = plate B joint-face normal, pointing out of plate B into the open region
 *   origin: a point on the root line where the two joint faces meet
 * Open region: a > 0 and b > 0. Plate A material: a ∈ [−tA, 0]; plate B material:
 * b ∈ [−tB, 0], standing on plate A (a ∈ [0, hB]). Plate A spans b ∈ [−tB − overhang, wA]
 * for a tee and b ∈ [−tB, wA] for a corner. The solids share the face a = 0 under
 * plate B and do not overlap in volume.
 * Method: LocalUse/4/GEOMETRY_CLEARANCE_METHOD.md §2–3.
 */

'use strict';

const { canonicalJson, sha256 } = require('../util/hash');
const { add, sub, scale, dot, cross, norm, unit } = require('./distance');

const SCHEMA = 'vd-workpiece@1';
const COORDINATE_FRAME = 'seam_input_frame';

const LIMITS = Object.freeze({
  thicknessMm: [0.5, 200],
  plateSizeMm: [1, 5000],
  overhangMm: [0.5, 5000],
  extentLengthMm: [1, 20000],
  coordinateAbsMm: 100000,
  normalLengthTolerance: 1e-3,
  perpendicularToleranceDeg: 0.1,
  seamContainmentToleranceMm: 0.5,
  seamAxisToleranceDeg: 0.5,
  jointConsistencyToleranceDeg: 0.1,
});

const LABELS = Object.freeze({
  unknown: 'Workpiece geometry unavailable',
  illustrative: 'Illustrative geometry',
  operator_defined: 'Operator-defined geometry',
});

const ARRANGEMENTS = Object.freeze({
  tee: 'T-joint: plate B stands on plate A; plate A continues behind plate B by teeOverhangMm',
  corner: 'Corner (L) joint: plate B stands on the edge of plate A; plate A ends flush with the back face of plate B',
});

const UNSUPPORTED_KINDS = Object.freeze({
  butt: 'butt joints', lap: 'lap joints', edge: 'edge joints', fillet_non_orthogonal: 'non-90° fillet joints',
  curved: 'curved joints', imported_cad: 'imported CAD geometry',
});

const RAD = Math.PI / 180;
const deg = (r) => r / RAD;
const clamp1 = (x) => Math.max(-1, Math.min(1, x));
const NOTE = /^[\p{L}\p{N} .,;:()/#'@_+-]{0,300}$/u;

const problem = (code, message, field, details) => ({ code, severity: 'error', message, ...(field ? { field } : {}), ...(details ? { details } : {}) });

const UNKNOWN = Object.freeze({ schema: SCHEMA, kind: 'unknown' });

function finiteNumber(v) { return typeof v === 'number' && Number.isFinite(v); }

function readVector(value, field, out) {
  if (!Array.isArray(value) || value.length !== 3 || value.some((c) => !finiteNumber(c))) {
    out.push(problem('WORKPIECE_INVALID', `${field} must be three finite numbers.`, field));
    return null;
  }
  if (value.some((c) => Math.abs(c) > LIMITS.coordinateAbsMm)) {
    out.push(problem('WORKPIECE_OUT_OF_RANGE', `${field} components must be within ±${LIMITS.coordinateAbsMm}.`, field));
    return null;
  }
  return value.slice();
}

function readRange(value, [lo, hi], field, out) {
  if (!finiteNumber(value) || value < lo || value > hi) {
    out.push(problem('WORKPIECE_OUT_OF_RANGE', `${field} must be a finite number from ${lo} to ${hi} mm.`, field, { value }));
    return null;
  }
  return value;
}

function checkKeys(obj, allowed, prefix, out) {
  for (const k of Object.keys(obj)) if (!allowed.includes(k)) out.push(problem('WORKPIECE_INVALID', `Unknown field ${prefix}${k}.`, `${prefix}${k}`));
}

/**
 * Validates a workpiece definition and returns its canonical form. Nothing is
 * reshaped: inconsistent definitions are rejected with diagnostics.
 * @returns {{ok: boolean, definition?: object, diagnostics: object[]}}
 */
function validateWorkpieceDefinition(input) {
  if (input === undefined) return { ok: true, definition: { ...UNKNOWN }, diagnostics: [] };
  const d = [];
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return { ok: false, diagnostics: [problem('WORKPIECE_INVALID', 'workpiece must be an object.', 'workpiece')] };
  }
  if (input.schema !== undefined && input.schema !== SCHEMA) d.push(problem('WORKPIECE_INVALID', `workpiece.schema must be '${SCHEMA}'.`, 'workpiece.schema'));
  if (UNSUPPORTED_KINDS[input.kind]) {
    return { ok: false, diagnostics: [problem('WORKPIECE_KIND_UNSUPPORTED', `Workpiece kind '${input.kind}' (${UNSUPPORTED_KINDS[input.kind]}) is not supported. Only straight 90° fillet plate joints ('fillet90_plates') or 'unknown' can be declared; nothing is approximated.`, 'workpiece.kind')] };
  }
  if (input.kind === 'unknown') {
    checkKeys(input, ['schema', 'kind'], 'workpiece.', d);
    return d.length ? { ok: false, diagnostics: d } : { ok: true, definition: { ...UNKNOWN }, diagnostics: [] };
  }
  if (input.kind !== 'fillet90_plates') {
    return { ok: false, diagnostics: [problem('WORKPIECE_KIND_UNSUPPORTED', "workpiece.kind must be 'fillet90_plates' or 'unknown'.", 'workpiece.kind')] };
  }
  checkKeys(input, ['schema', 'kind', 'arrangement', 'provenance', 'coordinateFrame', 'units', 'origin', 'normalA', 'normalB', 'extentAlongAxisMm', 'plateA', 'plateB', 'teeOverhangMm', 'note'], 'workpiece.', d);
  if (!ARRANGEMENTS[input.arrangement]) d.push(problem('WORKPIECE_INVALID', "workpiece.arrangement must be 'tee' or 'corner'.", 'workpiece.arrangement'));
  if (input.provenance !== 'illustrative' && input.provenance !== 'operator_defined') {
    d.push(problem('WORKPIECE_INVALID', "workpiece.provenance must be 'illustrative' or 'operator_defined'.", 'workpiece.provenance'));
  }
  const coordinateFrame = input.coordinateFrame === undefined ? COORDINATE_FRAME : input.coordinateFrame;
  if (coordinateFrame !== COORDINATE_FRAME) {
    d.push(problem('WORKPIECE_FRAME_UNSUPPORTED', `workpiece.coordinateFrame must be '${COORDINATE_FRAME}': the plates are declared in the same frame as the seam coordinates. No other frame transform is known to this application.`, 'workpiece.coordinateFrame'));
  }
  const units = input.units === undefined ? 'mm' : input.units;
  if (units !== 'mm') d.push(problem('WORKPIECE_INVALID', "workpiece.units must be 'mm'.", 'workpiece.units'));
  const origin = readVector(input.origin, 'workpiece.origin', d);
  const nA = readVector(input.normalA, 'workpiece.normalA', d);
  const nB = readVector(input.normalB, 'workpiece.normalB', d);
  for (const [v, f] of [[nA, 'workpiece.normalA'], [nB, 'workpiece.normalB']]) {
    if (v && Math.abs(norm(v) - 1) > LIMITS.normalLengthTolerance) d.push(problem('WORKPIECE_NORMAL_NOT_UNIT', `${f} has length ${norm(v).toFixed(6)}; plate normals must be unit vectors (±${LIMITS.normalLengthTolerance}).`, f));
  }
  if (nA && nB && d.every((x) => x.code !== 'WORKPIECE_NORMAL_NOT_UNIT')) {
    const angle = deg(Math.acos(clamp1(dot(unit(nA), unit(nB)))));
    if (Math.abs(angle - 90) > LIMITS.perpendicularToleranceDeg) {
      d.push(problem('WORKPIECE_NOT_ORTHOGONAL', `The plate normals are ${angle.toFixed(3)}° apart. vd-workpiece@1 models 90° fillet joints only (±${LIMITS.perpendicularToleranceDeg}°).`, 'workpiece.normalB', { plateAngleDeg: angle }));
    }
  }
  let extent = null;
  if (!Array.isArray(input.extentAlongAxisMm) || input.extentAlongAxisMm.length !== 2 || input.extentAlongAxisMm.some((c) => !finiteNumber(c))) {
    d.push(problem('WORKPIECE_INVALID', 'workpiece.extentAlongAxisMm must be [uMin, uMax] finite numbers (mm along the joint axis from origin).', 'workpiece.extentAlongAxisMm'));
  } else {
    const [lo, hi] = input.extentAlongAxisMm;
    const length = hi - lo;
    if (length < LIMITS.extentLengthMm[0] || length > LIMITS.extentLengthMm[1] || Math.abs(lo) > LIMITS.coordinateAbsMm || Math.abs(hi) > LIMITS.coordinateAbsMm) {
      d.push(problem('WORKPIECE_OUT_OF_RANGE', `workpiece.extentAlongAxisMm must have uMax − uMin from ${LIMITS.extentLengthMm[0]} to ${LIMITS.extentLengthMm[1]} mm.`, 'workpiece.extentAlongAxisMm', { extent: input.extentAlongAxisMm }));
    } else extent = [lo, hi];
  }
  const plate = (key, sizeKey) => {
    const p = input[key];
    if (!p || typeof p !== 'object' || Array.isArray(p)) { d.push(problem('WORKPIECE_INVALID', `workpiece.${key} must be an object.`, `workpiece.${key}`)); return null; }
    checkKeys(p, ['thicknessMm', sizeKey], `workpiece.${key}.`, d);
    const t = readRange(p.thicknessMm, LIMITS.thicknessMm, `workpiece.${key}.thicknessMm`, d);
    const s = readRange(p[sizeKey], LIMITS.plateSizeMm, `workpiece.${key}.${sizeKey}`, d);
    return t === null || s === null ? null : { thicknessMm: t, [sizeKey]: s };
  };
  const plateA = plate('plateA', 'openSideWidthMm');
  const plateB = plate('plateB', 'openSideHeightMm');
  let teeOverhangMm = null;
  if (input.arrangement === 'tee') teeOverhangMm = readRange(input.teeOverhangMm, LIMITS.overhangMm, 'workpiece.teeOverhangMm', d);
  else if (input.arrangement === 'corner' && input.teeOverhangMm !== undefined) d.push(problem('WORKPIECE_INVALID', 'workpiece.teeOverhangMm applies to tee arrangements only.', 'workpiece.teeOverhangMm'));
  if (input.note !== undefined && (typeof input.note !== 'string' || !NOTE.test(input.note))) d.push(problem('WORKPIECE_INVALID', 'workpiece.note must be plain text of at most 300 characters.', 'workpiece.note'));
  if (d.length) return { ok: false, diagnostics: d };

  const definition = {
    schema: SCHEMA, kind: 'fillet90_plates', arrangement: input.arrangement, provenance: input.provenance,
    coordinateFrame, units, origin, normalA: nA, normalB: nB, extentAlongAxisMm: extent, plateA, plateB,
    ...(input.arrangement === 'tee' ? { teeOverhangMm } : {}),
    ...(input.note !== undefined ? { note: input.note.trim() } : {}),
  };
  return { ok: true, definition, diagnostics: [] };
}

const definitionSha256 = (definition) => sha256(canonicalJson(definition));

function boxFromLocalRanges(origin, axes, ranges) {
  const mid = ranges.map(([lo, hi]) => (lo + hi) / 2);
  const center = add(origin, add(scale(axes[0], mid[0]), add(scale(axes[1], mid[1]), scale(axes[2], mid[2]))));
  return { center, axes: axes.map((a) => a.slice()), half: ranges.map(([lo, hi]) => (hi - lo) / 2) };
}

/**
 * Canonical model of a VALID definition: orthonormal joint basis and the plate
 * boxes. For 'unknown' the model has no parts.
 */
function buildWorkpieceModel(definition) {
  const identity = { definitionSha256: definitionSha256(definition), schema: SCHEMA };
  if (definition.kind === 'unknown') {
    return { ...identity, kind: 'unknown', provenance: 'unknown', label: LABELS.unknown, definition, parts: [], frame: null, rootLine: null };
  }
  // Symmetric orthogonalisation within the validated 0.1° tolerance (bisector unchanged).
  let a = unit(definition.normalA);
  let b = unit(definition.normalB);
  const c = dot(a, b);
  const residualDeg = Math.abs(deg(Math.acos(clamp1(c))) - 90);
  if (c !== 0) {
    const e = unit(add(a, b));
    const f = unit(sub(a, b));
    a = unit(add(e, f));
    b = unit(sub(e, f));
  }
  const j = unit(cross(a, b));
  const axes = [j, a, b];
  const o = definition.origin;
  const tA = definition.plateA.thicknessMm;
  const tB = definition.plateB.thicknessMm;
  const [u0, u1] = definition.extentAlongAxisMm;
  const behind = definition.arrangement === 'tee' ? tB + definition.teeOverhangMm : tB;
  const plateA = boxFromLocalRanges(o, axes, [[u0, u1], [-tA, 0], [-behind, definition.plateA.openSideWidthMm]]);
  const plateB = boxFromLocalRanges(o, axes, [[u0, u1], [0, definition.plateB.openSideHeightMm], [-tB, 0]]);
  return {
    ...identity,
    kind: 'fillet90_plates',
    arrangement: definition.arrangement,
    arrangementDescription: ARRANGEMENTS[definition.arrangement],
    provenance: definition.provenance,
    label: LABELS[definition.provenance],
    definition,
    frame: {
      coordinateFrame: definition.coordinateFrame,
      coordinateFrameMeaning: 'The frame of the seam coordinates and of the generated robtargets (object frame of the named work object). No transform is applied or known.',
      origin: o.slice(), axis: j, normalA: a, normalB: b, openBisector: unit(add(a, b)),
      basis: 'columns [axis, normalA, normalB] = local (u, a, b); right-handed', orthogonalityResidualDeg: residualDeg,
    },
    parts: [
      { id: 'plateA', label: 'Plate A', ...plateA, localRanges: { u: [u0, u1], a: [-tA, 0], b: [-behind, definition.plateA.openSideWidthMm] }, jointFace: { localAxis: 1, sign: 1, normal: a, description: 'face a = 0 (plate A joint surface)' } },
      { id: 'plateB', label: 'Plate B', ...plateB, localRanges: { u: [u0, u1], a: [0, definition.plateB.openSideHeightMm], b: [-tB, 0] }, jointFace: { localAxis: 2, sign: 1, normal: b, description: 'face b = 0 (plate B joint surface)' } },
    ],
    rootLine: { point: o.slice(), direction: j, extentMm: [u0, u1], start: add(o, scale(j, u0)), end: add(o, scale(j, u1)) },
    // Plate B's footprint continued through plate A's thickness. It lies entirely inside the union of the two
    // plates and exists only so that a TCP point or path on the shared face a = 0 under plate B gets its true
    // depth in the joined material (each plate alone reports depth 0 there). Never drawn; no volume is added.
    depthProxies: [
      { id: 'plateA_plateB_shared_face', label: 'Plates A+B across their shared face (depth proxy)', ...boxFromLocalRanges(o, axes, [[u0, u1], [-tA, definition.plateB.openSideHeightMm], [-tB, 0]]), jointFace: { localAxis: 2, sign: 1, normal: b, description: 'face b = 0 (plate B joint surface)' } },
    ],
  };
}

/**
 * The measured seam must lie on the modeled root line, inside the plate extent.
 * @returns {{ok: boolean, containment?: object, diagnostics: object[]}}
 */
function checkSeamOnWorkpiece(model, start, end) {
  if (model.kind === 'unknown') return { ok: true, containment: null, diagnostics: [] };
  const { point, direction: j, extentMm } = model.rootLine;
  const measure = (p) => {
    const rel = sub(p, point);
    const u = dot(rel, j);
    return { u, distanceToRootLineMm: norm(sub(rel, scale(j, u))) };
  };
  const s = measure(start);
  const e = measure(end);
  const chord = sub(end, start);
  const axisDeg = deg(Math.acos(clamp1(Math.abs(dot(unit(chord), j)))));
  const tol = LIMITS.seamContainmentToleranceMm;
  const containment = {
    toleranceMm: tol,
    start: s, end: e,
    seamToAxisDeg: axisDeg,
    extentMm: extentMm.slice(),
  };
  const d = [];
  if (s.distanceToRootLineMm > tol || e.distanceToRootLineMm > tol) {
    d.push(problem('WORKPIECE_SEAM_NOT_ON_JOINT', `The measured seam is ${Math.max(s.distanceToRootLineMm, e.distanceToRootLineMm).toFixed(3)} mm from the modeled root line (tolerance ${tol} mm). The declared plates do not contain this seam; nothing was moved.`, 'workpiece', containment));
  }
  if (axisDeg > LIMITS.seamAxisToleranceDeg) {
    d.push(problem('WORKPIECE_SEAM_NOT_ON_JOINT', `The seam direction is ${axisDeg.toFixed(3)}° from the modeled joint axis (tolerance ${LIMITS.seamAxisToleranceDeg}°).`, 'workpiece', containment));
  }
  for (const [label, m] of [['start', s], ['end', e]]) {
    if (m.u < extentMm[0] - 1e-9 || m.u > extentMm[1] + 1e-9) {
      d.push(problem('WORKPIECE_SEAM_OUTSIDE_EXTENT', `The seam ${label} lies ${m.u.toFixed(3)} mm along the joint axis, outside the plate extent [${extentMm[0]}, ${extentMm[1]}] mm.`, 'workpiece.extentAlongAxisMm', containment));
    }
  }
  return { ok: d.length === 0, containment, diagnostics: d };
}

/** Largest angle (degrees) between corresponding plate normals of a joint frame and the model. */
function jointFrameDeviationDeg(model, frame) {
  const angle = (p, q) => deg(Math.acos(clamp1(dot(unit(p), unit(q)))));
  return Math.max(angle(frame.normalA, model.frame.normalA), angle(frame.normalB, model.frame.normalB));
}

module.exports = {
  SCHEMA, COORDINATE_FRAME, LIMITS, LABELS, ARRANGEMENTS, UNSUPPORTED_KINDS, UNKNOWN,
  validateWorkpieceDefinition, buildWorkpieceModel, checkSeamOnWorkpiece, jointFrameDeviationDeg, definitionSha256,
};
