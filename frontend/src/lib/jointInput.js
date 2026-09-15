/**
 * Joint-relative orientation form: draft ↔ API parameters, and client-side
 * validation that mirrors the backend rules. The backend re-validates every
 * value; this only gives the operator immediate, specific feedback.
 */

export const JOINT_PROFILE_ID = "joint-relative-fillet";
export const DEFAULT_LIMITS = Object.freeze({
  workAngleDeg: [15, 75],
  pushAngleDeg: [-30, 30],
  plateAngleToleranceDeg: 0.1,
  seamAlignmentToleranceDeg: 0.5,
  axisNormTolerance: 1e-3,
  minReferenceAngleDeg: 15,
});
export const AXES = ["+X", "-X", "+Y", "-Y", "+Z", "-Z"];
const AXIS_VEC = { "+X": [1, 0, 0], "-X": [-1, 0, 0], "+Y": [0, 1, 0], "-Y": [0, -1, 0], "+Z": [0, 0, 1], "-Z": [0, 0, -1] };
const IDENT = /^[A-Za-z][A-Za-z0-9_]{0,31}$/;

const RAD = Math.PI / 180;
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm = (v) => Math.hypot(v[0], v[1], v[2]);
const unit = (v) => v.map((c) => c / norm(v));

/** Workpiece, tool envelope and traversal of a stored revision, re-sent unchanged by forms that edit other parameters. */
export function geometryParametersOf(parameters) {
  const out = {};
  if (!parameters) return out;
  for (const key of ["workpiece", "toolEnvelope", "traversal"]) if (parameters[key] !== undefined) out[key] = parameters[key];
  return out;
}

export const hasFilletWorkpiece = (parameters) => !!(parameters && parameters.workpiece && parameters.workpiece.kind === "fillet90_plates");

export function defaultJointDraft() {
  return {
    stationId: "",
    declared: { toolName: "", wobjName: "", approachAxis: "+Z", rollAxis: "+X", rollReference: "travel", note: "", evidenceReference: "" },
    jointKind: "template",
    template: "fillet90_wall_left",
    referenceNormal: [0, 0, 1],
    normalA: [0, 0, 1],
    normalB: [0, -1, 0],
    xAxis: [1, 0, 0],
    yAxis: [0, Math.SQRT1_2, Math.SQRT1_2],
    zAxis: [0, -Math.SQRT1_2, Math.SQRT1_2],
    workAngleDeg: 45,
    pushAngleDeg: 10,
  };
}

/** Draft from a stored revision, so the form starts from exactly what produced it. */
export function draftFromRecord(record) {
  const d = defaultJointDraft();
  const p = record && record.parameters;
  if (!p || p.profileId !== JOINT_PROFILE_ID) return d;
  const st = p.station || {};
  if (st.id === "operator-declared") {
    d.stationId = "operator-declared";
    d.declared = {
      toolName: st.toolName, wobjName: st.wobjName, ...st.toolConvention,
      note: (st.declaration && st.declaration.note) || "", evidenceReference: (st.declaration && st.declaration.evidenceReference) || "",
    };
  } else {
    d.stationId = st.id || "";
  }
  const j = p.joint || {};
  d.jointKind = j.kind || "template";
  if (j.kind === "template") { d.template = j.template; d.referenceNormal = j.referenceNormal.slice(); }
  if (j.kind === "explicit_normals") { d.normalA = j.normalA.slice(); d.normalB = j.normalB.slice(); }
  if (j.kind === "explicit_frame") { d.xAxis = j.xAxis.slice(); d.yAxis = j.yAxis.slice(); d.zAxis = j.zAxis.slice(); }
  if (p.orientation) { d.workAngleDeg = p.orientation.workAngleDeg; d.pushAngleDeg = p.orientation.pushAngleDeg; }
  return d;
}

function vectorProblem(v, label) {
  if (!Array.isArray(v) || v.length !== 3 || v.some((c) => typeof c !== "number" || !Number.isFinite(c))) return `${label} needs three finite numbers.`;
  if (norm(v) < 1e-6) return `${label} has zero length, so it has no direction.`;
  return null;
}

/**
 * @param {object} draft
 * @param {{start: number[], end: number[]}|null} seam  stored weld start/end, for the consistency check
 * @param {object} [limits]
 * @returns {string[]} problems (empty when valid)
 */
export function validateJointDraft(draft, seam = null, limits = DEFAULT_LIMITS, context = {}) {
  const e = [];
  if (!draft.stationId) e.push("Choose a station/tool profile.");
  if (draft.stationId === "operator-declared") {
    const s = draft.declared;
    if (!IDENT.test(s.toolName || "")) e.push("Declared tool name must be a RAPID identifier.");
    if (!IDENT.test(s.wobjName || "")) e.push("Declared work object name must be a RAPID identifier.");
    if (!AXIS_VEC[s.approachAxis] || !AXIS_VEC[s.rollAxis]) e.push("Choose the approach and roll tool axes.");
    else if (dot(AXIS_VEC[s.approachAxis], AXIS_VEC[s.rollAxis]) !== 0) e.push("The roll axis must be perpendicular to the approach axis.");
    if (s.rollReference !== "travel" && s.rollReference !== "against_travel") e.push("Choose whether the roll axis points along or against travel.");
    if (!(s.note || "").trim()) e.push("Say where the declared tool convention comes from (note).");
  }
  for (const [key, label] of [["workAngleDeg", "Work angle"], ["pushAngleDeg", "Push angle"]]) {
    const [lo, hi] = limits[key];
    if (typeof draft[key] !== "number" || !Number.isFinite(draft[key]) || draft[key] < lo || draft[key] > hi) e.push(`${label} must be ${lo}° to ${hi}°.`);
  }

  const t = seam ? unit([seam.end[0] - seam.start[0], seam.end[1] - seam.start[1], seam.end[2] - seam.start[2]]) : null;
  if (draft.jointKind === "template") {
    const p = vectorProblem(draft.referenceNormal, "Floor reference normal");
    if (p) e.push(p);
    else if (t) {
      const r = unit(draft.referenceNormal);
      const perp = r.map((c, i) => c - dot(r, t) * t[i]);
      if (norm(perp) < Math.sin(limits.minReferenceAngleDeg * RAD)) e.push(`The floor reference normal is within ${limits.minReferenceAngleDeg}° of the seam direction.`);
    }
  } else if (draft.jointKind === "explicit_normals") {
    const pa = vectorProblem(draft.normalA, "Plate A normal");
    const pb = vectorProblem(draft.normalB, "Plate B normal");
    if (pa) e.push(pa);
    if (pb) e.push(pb);
    if (!pa && !pb) {
      const a = unit(draft.normalA);
      const b = unit(draft.normalB);
      const angle = Math.acos(Math.max(-1, Math.min(1, dot(a, b)))) / RAD;
      if (norm(cross(a, b)) < Math.sin(limits.plateAngleToleranceDeg * RAD)) e.push("Plate normals are parallel.");
      else if (Math.abs(angle - 90) > limits.plateAngleToleranceDeg) e.push(`Plate normals are ${angle.toFixed(2)}° apart; only 90° (±${limits.plateAngleToleranceDeg}°) fillet joints are supported.`);
      else if (t) {
        const dev = Math.acos(Math.min(1, Math.abs(dot(t, unit(cross(a, b)))))) / RAD;
        if (dev > limits.seamAlignmentToleranceDeg) e.push(`The seam is ${dev.toFixed(2)}° from the line where these plates meet (tolerance ${limits.seamAlignmentToleranceDeg}°).`);
      }
    }
  } else if (draft.jointKind === "explicit_frame") {
    const probs = [["xAxis", "X axis"], ["yAxis", "Y axis"], ["zAxis", "Z axis"]].map(([k, l]) => vectorProblem(draft[k], l)).filter(Boolean);
    e.push(...probs);
    if (!probs.length) {
      for (const [k, l] of [["xAxis", "X axis"], ["yAxis", "Y axis"], ["zAxis", "Z axis"]]) {
        if (Math.abs(norm(draft[k]) - 1) > limits.axisNormTolerance) e.push(`${l} must be a unit vector.`);
      }
      const [x, y, z] = [draft.xAxis, draft.yAxis, draft.zAxis].map(unit);
      const maxDot = Math.sin(limits.plateAngleToleranceDeg * RAD);
      if ([dot(x, y), dot(y, z), dot(x, z)].some((d) => Math.abs(d) > maxDot)) e.push("Frame axes must be mutually perpendicular.");
      else if (dot(cross(x, y), z) < 0) e.push("The frame is left-handed (X × Y points opposite Z).");
    }
  } else if (draft.jointKind === "workpiece") {
    if (!context.workpieceDeclared) e.push("Joint from the workpiece needs a declared fillet workpiece (workpiece editor).");
  } else {
    e.push("Choose how the joint is declared.");
  }
  return e;
}

/** API parameters for a joint-relative revision. Clearances and motion come from the current record when compatible. */
export function buildJointParameters(draft, record) {
  const station = draft.stationId === "operator-declared"
    ? {
      id: "operator-declared",
      toolName: draft.declared.toolName,
      wobjName: draft.declared.wobjName,
      toolConvention: { approachAxis: draft.declared.approachAxis, rollAxis: draft.declared.rollAxis, rollReference: draft.declared.rollReference },
      note: draft.declared.note.trim(),
      ...(draft.declared.evidenceReference && draft.declared.evidenceReference.trim() ? { evidenceReference: draft.declared.evidenceReference.trim() } : {}),
    }
    : { id: draft.stationId };
  const joint = draft.jointKind === "template"
    ? { kind: "template", template: draft.template, referenceNormal: draft.referenceNormal }
    : draft.jointKind === "explicit_normals"
      ? { kind: "explicit_normals", normalA: draft.normalA, normalB: draft.normalB }
      : draft.jointKind === "workpiece"
        ? { kind: "workpiece" }
        : { kind: "explicit_frame", xAxis: draft.xAxis, yAxis: draft.yAxis, zAxis: draft.zAxis };
  const params = { profileId: JOINT_PROFILE_ID, station, joint, orientation: { workAngleDeg: draft.workAngleDeg, pushAngleDeg: draft.pushAngleDeg }, ...geometryParametersOf(record && record.parameters) };
  const p = record && record.parameters;
  if (p && p.profileId === JOINT_PROFILE_ID) {
    params.clearances = p.clearances;
    params.motion = p.motion;
  } else if (p && p.motion) {
    params.motion = p.motion;
  }
  if (p && p.calibrationReference) params.calibrationReference = p.calibrationReference;
  return params;
}
