/**
 * Joint-relative torch orientation for STRAIGHT seams on idealised 90° fillet
 * joints (experimental profile). Pure functions; no I/O.
 *
 * The joint geometry is never read from the seam descriptor. It comes from an
 * operator-selected template or explicit plate normals / joint frame, and the
 * tool-axis convention comes from a declared station profile. Nothing here
 * establishes that either declaration matches a physical cell.
 *
 * Conventions (derivation in LocalUse/3/ORIENTATION_METHOD.md). All vectors are
 * unit vectors in the robot base frame.
 *   t    travel direction, seam start → end, snapped to the declared joint axis
 *   nA   face normal of plate A, pointing out of the plate into the open weld region
 *   nB   the same for plate B; nA ⟂ nB for the supported joint
 *   b    torch-body direction, from the wire tip back up the torch
 *   a    approach direction = −b (the direction the torch points)
 *   work angle θ  measured in the transverse plane (⟂ t) from plate A's surface
 *                 towards plate B:  b⊥ ∝ cosθ·nB + sinθ·nA   (θ = 45° bisects the joint)
 *   push angle τ  signed angle between b and the transverse plane; τ > 0 means push
 *                 (the tip leans towards the travel direction):  a·t = sin τ
 *   b = cosτ·(cosθ·nB + sinθ·nA) − sinτ·t
 *   roll reference  r = unit(t − (t·a)a) for 'travel', −r for 'against_travel'
 *   tool rotation R (tool frame → base frame): R·e_approach = a, R·e_roll = r,
 *                 R·(e_approach × e_roll) = a × r
 * Quaternions are ABB order [w, x, y, z]; the sign is chosen with w ≥ 0 and is
 * then aligned with the previous target for continuity (q and −q are the same rotation).
 */

const PLANNER_VERSION = 'vd-joint-orientation@1';

const LIMITS = Object.freeze({
  workAngleDeg: [15, 75],
  pushAngleDeg: [-30, 30],
  // Supported joint: plates at 90°. Residual non-orthogonality up to this bound is
  // removed by symmetric orthogonalisation (bisector preserved) and reported.
  plateAngleToleranceDeg: 0.1,
  // Maximum angle between the measured seam chord and the declared joint axis.
  seamAlignmentToleranceDeg: 0.5,
  // Explicit frame axes must have |v| within this of 1 before normalisation.
  axisNormTolerance: 1e-3,
  // Template reference must be at least this far from parallel to the seam.
  minReferenceAngleDeg: 15,
  minVectorNorm: 1e-6,
});

const TEMPLATES = Object.freeze({
  fillet90_wall_left: {
    label: 'Floor plate + wall plate on the LEFT of travel (seen from the floor normal side)',
    plateA: 'floor', plateB: 'wall', wallSide: 'left',
  },
  fillet90_wall_right: {
    label: 'Floor plate + wall plate on the RIGHT of travel (seen from the floor normal side)',
    plateA: 'floor', plateB: 'wall', wallSide: 'right',
  },
});

const AXES = Object.freeze({
  '+X': [1, 0, 0], '-X': [-1, 0, 0], '+Y': [0, 1, 0], '-Y': [0, -1, 0], '+Z': [0, 0, 1], '-Z': [0, 0, -1],
});
const ROLL_REFERENCES = ['travel', 'against_travel'];

const RAD = Math.PI / 180;
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const scale = (v, s) => [v[0] * s, v[1] * s, v[2] * s];
const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const norm = (v) => Math.hypot(v[0], v[1], v[2]);
const unit = (v) => scale(v, 1 / norm(v));
const clamp1 = (x) => Math.max(-1, Math.min(1, x));
const deg = (r) => r / RAD;

function problem(code, message, field, details) {
  const d = { code, severity: 'error', message };
  if (field) d.field = field;
  if (details) d.details = details;
  return d;
}

/** Three finite numbers with a usable length, or a diagnostic. */
function readVector(value, field) {
  if (!Array.isArray(value) || value.length !== 3) {
    return { error: problem('JOINT_SPEC_INVALID', `${field} must be an array of three numbers.`, field) };
  }
  if (value.some((c) => typeof c !== 'number' || !Number.isFinite(c))) {
    return { error: problem('JOINT_VECTOR_NON_FINITE', `${field} contains a non-finite value.`, field) };
  }
  const n = norm(value);
  if (!(n >= LIMITS.minVectorNorm)) {
    return { error: problem('JOINT_VECTOR_ZERO', `${field} has zero length, so it has no direction.`, field) };
  }
  return { vector: value.slice(), length: n };
}

/**
 * Checks a tool-axis convention declaration.
 * @returns {object[]} diagnostics (empty when valid)
 */
function validateToolConvention(tc, field = 'toolConvention') {
  if (!tc || typeof tc !== 'object' || Array.isArray(tc)) return [problem('TOOL_CONVENTION_INVALID', `${field} must be an object.`, field)];
  const out = [];
  for (const k of Object.keys(tc)) {
    if (!['approachAxis', 'rollAxis', 'rollReference'].includes(k)) out.push(problem('TOOL_CONVENTION_INVALID', `Unknown field ${field}.${k}.`, `${field}.${k}`));
  }
  if (!AXES[tc.approachAxis]) out.push(problem('TOOL_CONVENTION_INVALID', `${field}.approachAxis must be one of ${Object.keys(AXES).join(', ')}.`, `${field}.approachAxis`));
  if (!AXES[tc.rollAxis]) out.push(problem('TOOL_CONVENTION_INVALID', `${field}.rollAxis must be one of ${Object.keys(AXES).join(', ')}.`, `${field}.rollAxis`));
  if (AXES[tc.approachAxis] && AXES[tc.rollAxis] && dot(AXES[tc.approachAxis], AXES[tc.rollAxis]) !== 0) {
    out.push(problem('TOOL_CONVENTION_INVALID', `${field}.rollAxis must be perpendicular to approachAxis.`, `${field}.rollAxis`));
  }
  if (!ROLL_REFERENCES.includes(tc.rollReference)) out.push(problem('TOOL_CONVENTION_INVALID', `${field}.rollReference must be 'travel' or 'against_travel'.`, `${field}.rollReference`));
  return out;
}

/** Checks requested work/push angles against the supported ranges. */
function validateAngles({ workAngleDeg, pushAngleDeg }) {
  const out = [];
  for (const [key, value] of [['workAngleDeg', workAngleDeg], ['pushAngleDeg', pushAngleDeg]]) {
    const [lo, hi] = LIMITS[key];
    if (typeof value !== 'number' || !Number.isFinite(value) || value < lo || value > hi) {
      out.push(problem('ORIENTATION_ANGLE_OUT_OF_RANGE', `orientation.${key} must be a number from ${lo} to ${hi} degrees.`, `orientation.${key}`, { value, supported: [lo, hi] }));
    }
  }
  return out;
}

/**
 * Seam-independent validation and normalisation of a joint specification.
 *
 * @param {object} spec  { kind: 'template', template, referenceNormal }
 *                     | { kind: 'explicit_normals', normalA, normalB }
 *                     | { kind: 'explicit_frame', xAxis, yAxis, zAxis }
 * @returns {{ok: boolean, spec?: object, plates?: {nA?: number[], nB?: number[]}, diagnostics: object[]}}
 */
function validateJointSpec(spec) {
  const diagnostics = [];
  if (!spec || typeof spec !== 'object' || Array.isArray(spec)) {
    return { ok: false, diagnostics: [problem('JOINT_SPEC_INVALID', 'joint must be an object.', 'joint')] };
  }
  const allowed = { template: ['kind', 'template', 'referenceNormal'], explicit_normals: ['kind', 'normalA', 'normalB'], explicit_frame: ['kind', 'xAxis', 'yAxis', 'zAxis'], workpiece: ['kind'] };
  if (!allowed[spec.kind]) {
    return { ok: false, diagnostics: [problem('JOINT_SPEC_INVALID', "joint.kind must be 'template', 'explicit_normals', 'explicit_frame' or 'workpiece'.", 'joint.kind')] };
  }
  for (const k of Object.keys(spec)) if (!allowed[spec.kind].includes(k)) diagnostics.push(problem('JOINT_SPEC_INVALID', `Unknown field joint.${k} for kind '${spec.kind}'.`, `joint.${k}`));
  if (diagnostics.length) return { ok: false, diagnostics };

  // The plate normals come from the declared workpiece (physical, independent of travel direction).
  // The planner substitutes them as explicit normals; this function cannot resolve them on its own.
  if (spec.kind === 'workpiece') return { ok: true, spec: { kind: 'workpiece' }, plates: {}, diagnostics };

  if (spec.kind === 'template') {
    if (!TEMPLATES[spec.template]) {
      return { ok: false, diagnostics: [problem('JOINT_TEMPLATE_UNKNOWN', `joint.template must be one of ${Object.keys(TEMPLATES).join(', ')}.`, 'joint.template')] };
    }
    const ref = readVector(spec.referenceNormal, 'joint.referenceNormal');
    if (ref.error) return { ok: false, diagnostics: [ref.error] };
    return { ok: true, spec: { kind: 'template', template: spec.template, referenceNormal: ref.vector }, plates: {}, diagnostics };
  }

  if (spec.kind === 'explicit_normals') {
    const a = readVector(spec.normalA, 'joint.normalA');
    const b = readVector(spec.normalB, 'joint.normalB');
    for (const r of [a, b]) if (r.error) diagnostics.push(r.error);
    if (diagnostics.length) return { ok: false, diagnostics };
    const nA = unit(a.vector);
    const nB = unit(b.vector);
    const c = clamp1(dot(nA, nB));
    if (norm(cross(nA, nB)) < Math.sin(LIMITS.plateAngleToleranceDeg * RAD)) {
      return { ok: false, diagnostics: [problem('JOINT_NORMALS_PARALLEL', 'joint.normalA and joint.normalB are parallel (or opposite), so they do not define a joint line.', 'joint.normalB')] };
    }
    const plateAngleDeg = deg(Math.acos(c));
    if (Math.abs(plateAngleDeg - 90) > LIMITS.plateAngleToleranceDeg) {
      return { ok: false, diagnostics: [problem('JOINT_ANGLE_UNSUPPORTED',
        `The plate normals are ${plateAngleDeg.toFixed(3)}° apart. Only 90° fillet joints are supported (tolerance ±${LIMITS.plateAngleToleranceDeg}°); non-orthogonal joints are not planned.`,
        'joint.normalB', { plateAngleDeg })] };
    }
    return { ok: true, spec: { kind: 'explicit_normals', normalA: a.vector, normalB: b.vector }, plates: { nA, nB }, diagnostics };
  }

  // explicit_frame: right-handed orthonormal (x, y, z) with z the open-side bisector.
  const axes = ['xAxis', 'yAxis', 'zAxis'].map((k) => readVector(spec[k], `joint.${k}`));
  for (const r of axes) if (r.error) diagnostics.push(r.error);
  if (diagnostics.length) return { ok: false, diagnostics };
  for (const [i, k] of ['xAxis', 'yAxis', 'zAxis'].entries()) {
    if (Math.abs(axes[i].length - 1) > LIMITS.axisNormTolerance) {
      diagnostics.push(problem('JOINT_FRAME_NOT_ORTHONORMAL', `joint.${k} has length ${axes[i].length.toFixed(6)}; frame axes must be unit vectors (±${LIMITS.axisNormTolerance}).`, `joint.${k}`));
    }
  }
  const [x, y, z] = axes.map((r) => unit(r.vector));
  const maxDot = Math.sin(LIMITS.plateAngleToleranceDeg * RAD);
  for (const [p, q, label] of [[x, y, 'xAxis·yAxis'], [y, z, 'yAxis·zAxis'], [x, z, 'xAxis·zAxis']]) {
    if (Math.abs(dot(p, q)) > maxDot) diagnostics.push(problem('JOINT_FRAME_NOT_ORTHONORMAL', `${label} = ${dot(p, q).toFixed(6)}; the axes are not perpendicular within ${LIMITS.plateAngleToleranceDeg}°.`, 'joint'));
  }
  if (diagnostics.length) return { ok: false, diagnostics };
  const handedness = dot(cross(x, y), z);
  if (handedness < 0) {
    return { ok: false, diagnostics: [problem('JOINT_FRAME_LEFT_HANDED', 'The joint frame is left-handed (xAxis × yAxis points opposite zAxis). A right-handed frame is required; the application does not flip an axis for you.', 'joint', { handedness })] };
  }
  return {
    ok: true,
    spec: { kind: 'explicit_frame', xAxis: axes[0].vector, yAxis: axes[1].vector, zAxis: axes[2].vector },
    // Plate A normal = unit(z + y), plate B normal = unit(z − y).
    plates: { nA: unit(add(z, y)), nB: unit(sub(z, y)), frameXAxis: x },
    diagnostics,
  };
}

/**
 * Resolves the joint frame for a straight seam.
 * @param {object} spec  joint specification (validated here again)
 * @param {number[]} start
 * @param {number[]} end
 */
function resolveJointFrame(spec, start, end) {
  const checked = validateJointSpec(spec);
  if (!checked.ok) return { ok: false, diagnostics: checked.diagnostics };
  if (checked.spec.kind === 'workpiece') {
    return { ok: false, diagnostics: [problem('JOINT_WORKPIECE_REQUIRED', "joint.kind 'workpiece' takes the plate normals from a declared fillet workpiece; none was supplied to the joint resolver.", 'joint.kind')] };
  }
  const diagnostics = [];
  const chord = sub(end, start);
  if (!(norm(chord) > 0)) return { ok: false, diagnostics: [problem('GEOMETRY_TOO_SHORT', 'Seam start and end coincide.')] };
  const t = unit(chord);

  let nA;
  let nB;
  let travel;
  let seamToJointAxisDeg = 0;
  let orthogonalityResidualDeg = 0;
  let referenceDeviationDeg = null;
  let frameXAlignment = null;

  if (checked.spec.kind === 'template') {
    const tpl = TEMPLATES[checked.spec.template];
    const ref = unit(checked.spec.referenceNormal);
    const p = sub(ref, scale(t, dot(ref, t)));
    if (norm(p) < Math.sin(LIMITS.minReferenceAngleDeg * RAD)) {
      return { ok: false, diagnostics: [problem('JOINT_REFERENCE_DEGENERATE',
        `The floor reference normal is within ${LIMITS.minReferenceAngleDeg}° of the seam direction, so the floor plate is undefined.`, 'joint.referenceNormal')] };
    }
    travel = t;
    nA = unit(p);
    referenceDeviationDeg = deg(Math.acos(clamp1(dot(ref, nA))));
    const left = cross(nA, t);
    nB = tpl.wallSide === 'left' ? scale(left, -1) : left;
  } else {
    let pa = checked.plates.nA;
    let pb = checked.plates.nB;
    const c = dot(pa, pb);
    if (c !== 0) {
      // Symmetric orthogonalisation within the tolerance already enforced.
      const e = unit(add(pa, pb));
      const f = unit(sub(pa, pb));
      const nA2 = unit(add(e, f));
      const nB2 = unit(sub(e, f));
      orthogonalityResidualDeg = Math.abs(deg(Math.acos(clamp1(c))) - 90);
      pa = nA2;
      pb = nB2;
    }
    const axis = unit(cross(pa, pb));
    const along = dot(t, axis);
    seamToJointAxisDeg = deg(Math.acos(clamp1(Math.abs(along))));
    if (seamToJointAxisDeg > LIMITS.seamAlignmentToleranceDeg) {
      return { ok: false, diagnostics: [problem('JOINT_SEAM_INCONSISTENT',
        `The seam direction is ${seamToJointAxisDeg.toFixed(3)}° from the line where the declared plates meet (tolerance ${LIMITS.seamAlignmentToleranceDeg}°). The joint declaration does not match this seam; nothing is adjusted.`,
        'joint', { seamToJointAxisDeg })] };
    }
    travel = along >= 0 ? axis : scale(axis, -1);
    nA = pa;
    nB = pb;
    if (checked.plates.frameXAxis) frameXAlignment = dot(checked.plates.frameXAxis, travel) >= 0 ? 'same_as_travel' : 'opposite_to_travel';
    if (orthogonalityResidualDeg > 0) {
      diagnostics.push({ code: 'JOINT_FRAME_ORTHOGONALIZED', severity: 'info',
        message: `Plate normals were ${orthogonalityResidualDeg.toExponential(2)}° from perpendicular and were orthogonalised symmetrically (bisector unchanged).`,
        details: { orthogonalityResidualDeg } });
    }
  }

  const frame = {
    travel,
    normalA: nA,
    normalB: nB,
    openBisector: unit(add(nA, nB)),
    handedness: dot(cross(nA, nB), travel) >= 0 ? 'nA×nB=+travel' : 'nA×nB=−travel',
    plateAngleDeg: deg(Math.acos(clamp1(dot(nA, nB)))),
    seamToJointAxisDeg,
    orthogonalityResidualDeg,
    referenceDeviationDeg,
    frameXAlignment,
    source: checked.spec.kind === 'template' ? `template:${checked.spec.template}` : checked.spec.kind,
    plateLabels: checked.spec.kind === 'template' ? { A: 'floor', B: 'wall' } : { A: 'plate A', B: 'plate B' },
  };
  return { ok: true, frame, spec: checked.spec, diagnostics };
}

/** Robust rotation-matrix → unit quaternion [w,x,y,z]; m[row][col]. */
function matrixToQuaternion(m) {
  const tr = m[0][0] + m[1][1] + m[2][2];
  let q;
  if (tr > 0) {
    const s = 0.5 / Math.sqrt(tr + 1);
    q = [0.25 / s, (m[2][1] - m[1][2]) * s, (m[0][2] - m[2][0]) * s, (m[1][0] - m[0][1]) * s];
  } else if (m[0][0] >= m[1][1] && m[0][0] >= m[2][2]) {
    const s = 2 * Math.sqrt(1 + m[0][0] - m[1][1] - m[2][2]);
    q = [(m[2][1] - m[1][2]) / s, 0.25 * s, (m[1][0] + m[0][1]) / s, (m[0][2] + m[2][0]) / s];
  } else if (m[1][1] >= m[2][2]) {
    const s = 2 * Math.sqrt(1 - m[0][0] + m[1][1] - m[2][2]);
    q = [(m[0][2] - m[2][0]) / s, (m[1][0] + m[0][1]) / s, 0.25 * s, (m[2][1] + m[1][2]) / s];
  } else {
    const s = 2 * Math.sqrt(1 - m[0][0] - m[1][1] + m[2][2]);
    q = [(m[1][0] - m[0][1]) / s, (m[0][2] + m[2][0]) / s, (m[2][1] + m[1][2]) / s, 0.25 * s];
  }
  const n = Math.hypot(...q);
  q = q.map((c) => c / n);
  const lead = q.find((c) => Math.abs(c) > 1e-12);
  return lead < 0 ? q.map((c) => -c) : q;
}

/** Returns q or −q, whichever is closer to prev (same rotation, no hemisphere jump). */
function alignQuaternionSign(prev, q) {
  if (!prev) return q.slice();
  return prev[0] * q[0] + prev[1] * q[1] + prev[2] * q[2] + prev[3] * q[3] < 0 ? q.map((c) => -c) : q.slice();
}

/**
 * Plans the torch orientation for a straight fillet seam.
 *
 * @param {{start: number[], end: number[], joint: object, toolConvention: object, workAngleDeg: number, pushAngleDeg: number}} input
 * @returns {{ok: boolean, diagnostics: object[], quaternion?: number[], frame?: object, vectors?: object, spec?: object}}
 */
function planFilletOrientation({ start, end, joint, toolConvention, workAngleDeg, pushAngleDeg }) {
  const diagnostics = [...validateToolConvention(toolConvention), ...validateAngles({ workAngleDeg, pushAngleDeg })];
  if (diagnostics.length) return { ok: false, diagnostics };
  const resolved = resolveJointFrame(joint, start, end);
  if (!resolved.ok) return { ok: false, diagnostics: resolved.diagnostics };
  const { travel: t, normalA: nA, normalB: nB } = resolved.frame;

  const th = workAngleDeg * RAD;
  const tau = pushAngleDeg * RAD;
  const transverse = add(scale(nB, Math.cos(th)), scale(nA, Math.sin(th)));
  const body = unit(sub(scale(transverse, Math.cos(tau)), scale(t, Math.sin(tau))));
  const approach = scale(body, -1);
  const rawRoll = sub(t, scale(approach, dot(t, approach)));
  if (norm(rawRoll) < 1e-6) {
    return { ok: false, diagnostics: [problem('ORIENTATION_ROLL_UNDEFINED', 'The approach axis is parallel to travel, so the roll reference is undefined.')] };
  }
  const roll = toolConvention.rollReference === 'travel' ? unit(rawRoll) : scale(unit(rawRoll), -1);
  const third = cross(approach, roll);

  // R = [a r a×r] · [e_app e_roll e_app×e_roll]^T
  const eA = AXES[toolConvention.approachAxis];
  const eR = AXES[toolConvention.rollAxis];
  const eT = cross(eA, eR);
  const m = [0, 1, 2].map((row) => [0, 1, 2].map((col) => approach[row] * eA[col] + roll[row] * eR[col] + third[row] * eT[col]));

  return {
    ok: true,
    diagnostics: resolved.diagnostics,
    quaternion: matrixToQuaternion(m),
    frame: resolved.frame,
    spec: resolved.spec,
    vectors: { approach, torchBody: body, rollReference: roll },
  };
}

module.exports = {
  PLANNER_VERSION,
  LIMITS,
  TEMPLATES,
  AXES,
  ROLL_REFERENCES,
  validateJointSpec,
  validateToolConvention,
  validateAngles,
  resolveJointFrame,
  planFilletOrientation,
  matrixToQuaternion,
  alignQuaternionSign,
};
