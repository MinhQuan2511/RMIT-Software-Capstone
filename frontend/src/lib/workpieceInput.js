/**
 * Workpiece editor helpers: draft ↔ vd-workpiece@1 / vd-tool-envelope@1
 * definitions, traversal reversal and welding-side switching. Pure functions.
 *
 * The browser only builds the operator's DECLARATION. The backend validates it,
 * derives the plate boxes and runs the clearance checks; nothing here computes
 * geometry that the preview draws.
 *
 * Placement helper: plate A's normal is the floor reference made perpendicular
 * to the MEASURED seam chord; the wall (plate B) is on the chosen side of the
 * MEASURED travel direction. The result is stored as explicit physical vectors,
 * so a later traversal reversal never moves the wall.
 */

import { JOINT_PROFILE_ID, buildJointParameters, draftFromRecord, geometryParametersOf } from "./jointInput.js";

export const DEFAULT_DIMENSIONS = Object.freeze({ tA: 10, wA: 150, tB: 8, hB: 120, overhang: 60, margin: 20 });
export const WORKPIECE_MODES = ["unknown", "illustrative", "operator_defined"];

const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm = (v) => Math.hypot(v[0], v[1], v[2]);
const unit = (v) => { const n = norm(v); return v.map((c) => c / n); };
const round = (v, dp = 9) => v.map((c) => { const r = Number(c.toFixed(dp)); return Object.is(r, -0) ? 0 : r; });
const finite = (x) => typeof x === "number" && Number.isFinite(x);

/** The seam as measured in the file, independent of the stored traversal. */
export function measuredSeam(record) {
  const g = record && record.geometry;
  if (!g || g.plannedType !== "straight") return null;
  const tr = g.traversal;
  const p = (pt) => [pt.x, pt.y, pt.z];
  if (tr && tr.measuredStartPoint) return { start: p(tr.measuredStartPoint), end: p(tr.measuredEndPoint) };
  return g.startPoint && g.endPoint ? { start: p(g.startPoint), end: p(g.endPoint) } : null;
}

/**
 * Explicit fillet definition placed on the measured seam.
 * @returns {object} vd-workpiece@1 definition (not yet validated by the backend)
 */
export function constructFillet({ start, end, side = "left", arrangement = "tee", provenance = "operator_defined", reference = [0, 0, 1], dims = DEFAULT_DIMENSIONS }) {
  const t = unit(sub(end, start));
  const r = reference;
  const nA = unit(sub(r, t.map((c) => c * dot(r, t))));
  const left = cross(nA, t);
  const nB = side === "left" ? left.map((c) => -c) : left;
  const j = cross(nA, nB);
  const uEnd = dot(sub(end, start), j);
  return {
    schema: "vd-workpiece@1",
    kind: "fillet90_plates",
    arrangement,
    provenance,
    coordinateFrame: "seam_input_frame",
    units: "mm",
    origin: start.slice(),
    normalA: round(nA),
    normalB: round(nB),
    extentAlongAxisMm: [Number((Math.min(0, uEnd) - dims.margin).toFixed(4)), Number((Math.max(0, uEnd) + dims.margin).toFixed(4))],
    plateA: { thicknessMm: dims.tA, openSideWidthMm: dims.wA },
    plateB: { thicknessMm: dims.tB, openSideHeightMm: dims.hB },
    ...(arrangement === "tee" ? { teeOverhangMm: dims.overhang } : {}),
  };
}

/** Which side of the MEASURED travel the wall of a stored definition is on. */
export function wallSideOf(definition, seam) {
  if (!definition || definition.kind !== "fillet90_plates" || !seam) return null;
  const t = unit(sub(seam.end, seam.start));
  const left = cross(definition.normalA, t);
  return dot(definition.normalB, left) < 0 ? "left" : "right";
}

export function draftFromParameters(parameters, seam) {
  const wp = parameters && parameters.workpiece;
  const env = parameters && parameters.toolEnvelope;
  const fillet = wp && wp.kind === "fillet90_plates";
  return {
    mode: fillet ? wp.provenance : "unknown",
    arrangement: fillet ? wp.arrangement : "tee",
    side: (fillet && wallSideOf(wp, seam)) || "left",
    reference: fillet ? wp.normalA.slice() : [0, 0, 1],
    dims: fillet
      ? { tA: wp.plateA.thicknessMm, wA: wp.plateA.openSideWidthMm, tB: wp.plateB.thicknessMm, hB: wp.plateB.openSideHeightMm, overhang: wp.teeOverhangMm ?? DEFAULT_DIMENSIONS.overhang, margin: DEFAULT_DIMENSIONS.margin }
      : { ...DEFAULT_DIMENSIONS },
    envelopeMode: env && env.kind === "tool_frame_capsules" ? env.provenance : "unknown",
    capsules: env && env.kind === "tool_frame_capsules" ? env.capsules.map((c) => ({ ...c, fromToolMm: c.fromToolMm.slice(), toToolMm: c.toToolMm.slice() })) : [],
    note: fillet && wp.note ? wp.note : "",
  };
}

/** Client-side input problems (finite, positive, required). The backend re-validates everything. */
export function validateWorkpieceDraft(draft, seam) {
  const e = [];
  if (draft.mode !== "unknown") {
    if (!seam) e.push("A fillet workpiece can only be placed on a straight seam.");
    if (!Array.isArray(draft.reference) || draft.reference.length !== 3 || !draft.reference.every(finite) || norm(draft.reference) < 1e-6) e.push("Floor reference normal needs three finite numbers and a direction.");
    const { tA, wA, tB, hB, overhang, margin } = draft.dims;
    for (const [v, label, lo] of [[tA, "Plate A thickness", 0.5], [tB, "Plate B thickness", 0.5], [wA, "Plate A open-side width", 1], [hB, "Plate B open-side height", 1], [margin, "Extent beyond the seam ends", 0]]) {
      if (!finite(v) || v < lo) e.push(`${label} must be a finite number ≥ ${lo} mm.`);
    }
    if (draft.arrangement === "tee" && (!finite(overhang) || overhang < 0.5)) e.push("Tee overhang behind plate B must be ≥ 0.5 mm.");
    if (seam && Array.isArray(draft.reference) && draft.reference.every(finite) && norm(draft.reference) > 1e-6) {
      const t = unit(sub(seam.end, seam.start));
      if (norm(sub(draft.reference, t.map((c) => c * dot(draft.reference, t)))) / norm(draft.reference) < Math.sin((15 * Math.PI) / 180)) {
        e.push("The floor reference normal is within 15° of the seam direction.");
      }
    }
  }
  if (draft.envelopeMode === "operator_defined") {
    if (!draft.capsules.length) e.push("Declare at least one envelope capsule.");
    draft.capsules.forEach((c, i) => {
      if (![...c.fromToolMm, ...c.toToolMm].every(finite)) e.push(`Capsule ${i + 1}: offsets need finite numbers.`);
      if (!finite(c.radiusMm) || c.radiusMm <= 0) e.push(`Capsule ${i + 1}: radius must be positive.`);
    });
  }
  return e;
}

export function definitionsFromDraft(draft, seam, syntheticEnvelope) {
  const workpiece = draft.mode === "unknown"
    ? { schema: "vd-workpiece@1", kind: "unknown" }
    : { ...constructFillet({ ...seam, side: draft.side, arrangement: draft.arrangement, provenance: draft.mode, reference: draft.reference, dims: draft.dims }), ...(draft.note && draft.note.trim() ? { note: draft.note.trim() } : {}) };
  const toolEnvelope = draft.envelopeMode === "unknown"
    ? { schema: "vd-tool-envelope@1", kind: "unknown" }
    : draft.envelopeMode === "synthetic_fixture"
      ? syntheticEnvelope
      : { schema: "vd-tool-envelope@1", kind: "tool_frame_capsules", provenance: "operator_defined", capsules: draft.capsules };
  return { workpiece, toolEnvelope };
}

/** Request parameters that reproduce a stored feature revision (point lists return null). */
export function requestParametersFromRecord(record) {
  const p = record && record.parameters;
  if (!p || p.profileId === "point-list-linear") return null;
  if (p.profileId === JOINT_PROFILE_ID) return buildJointParameters(draftFromRecord(record), record);
  return {
    profileId: p.profileId,
    toolName: p.toolName,
    wobjName: p.wobjName,
    clearances: p.clearances,
    motion: p.motion,
    nearStraightArcPolicy: p.nearStraightArcPolicy,
    ...(p.calibrationReference ? { calibrationReference: p.calibrationReference } : {}),
    ...geometryParametersOf(p),
  };
}

const SWAP_TEMPLATE = { fillet90_wall_left: "fillet90_wall_right", fillet90_wall_right: "fillet90_wall_left" };

/**
 * Reverse the traversal only. Physical plates stay where they are: explicit
 * normals and the workpiece are physical; a travel-relative template has its
 * side remapped so the wall does not move.
 * @returns {{parameters: object, templateRemapped: boolean}}
 */
export function reverseTraversal(parameters) {
  const next = JSON.parse(JSON.stringify(parameters));
  next.traversal = parameters.traversal === "reversed" ? "as_measured" : "reversed";
  let templateRemapped = false;
  if (next.joint && next.joint.kind === "template" && SWAP_TEMPLATE[next.joint.template]) {
    next.joint.template = SWAP_TEMPLATE[next.joint.template];
    templateRemapped = true;
  }
  return { parameters: next, templateRemapped };
}

/** Opposite welding side: the wall is mirrored across the seam (a different declared workpiece). Traversal is unchanged. */
export function switchWeldingSide(draft) {
  return { ...draft, side: draft.side === "left" ? "right" : "left" };
}
