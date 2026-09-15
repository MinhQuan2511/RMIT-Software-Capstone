/**
 * Frame-tagged rigid transforms for offline mathematical tests.
 *
 * Every transform names the frame it maps FROM and the frame it maps TO, and
 * every point or direction carries the frame it is expressed in. Applying a
 * transform to data in any other frame is an error, so robot-base data can never
 * be transformed "again", and composition refuses chains whose frames do not
 * meet. Directions and surface normals use the rotation only.
 *
 * Nothing in the application applies an imported (real) transform; this module
 * is exercised with synthetic fixtures only.
 */

const ROTATION_TOLERANCE = 1e-6;

class TransformError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

const FRAME = /^[A-Za-z][A-Za-z0-9_:@.-]{0,63}$/;
const isVec3 = (v) => Array.isArray(v) && v.length === 3 && v.every((c) => typeof c === 'number' && Number.isFinite(c));
const mulRv = (R, v) => [0, 1, 2].map((r) => R[r][0] * v[0] + R[r][1] * v[1] + R[r][2] * v[2]);
const transpose = (R) => [0, 1, 2].map((r) => [0, 1, 2].map((c) => R[c][r]));
const mulRR = (A, B) => [0, 1, 2].map((r) => [0, 1, 2].map((c) => A[r][0] * B[0][c] + A[r][1] * B[1][c] + A[r][2] * B[2][c]));

function checkRotation(R) {
  let frob = 0;
  const rtr = mulRR(transpose(R), R);
  for (let a = 0; a < 3; a += 1) for (let b = 0; b < 3; b += 1) frob += (rtr[a][b] - (a === b ? 1 : 0)) ** 2;
  const det = R[0][0] * (R[1][1] * R[2][2] - R[1][2] * R[2][1]) - R[0][1] * (R[1][0] * R[2][2] - R[1][2] * R[2][0]) + R[0][2] * (R[1][0] * R[2][1] - R[1][1] * R[2][0]);
  if (Math.sqrt(frob) > ROTATION_TOLERANCE || Math.abs(det - 1) > ROTATION_TOLERANCE) {
    throw new TransformError('TRANSFORM_NOT_RIGID', `Rotation block is not a proper rotation (‖RᵀR−I‖_F=${Math.sqrt(frob)}, det=${det}).`);
  }
}

/**
 * @param {{matrix: number[][], from: string, to: string, units: string, capturePoseId?: string|null}} spec  matrix is 4×4, row-major
 */
function createTransform({ matrix, from, to, units, capturePoseId = null }) {
  if (!FRAME.test(from || '') || !FRAME.test(to || '')) throw new TransformError('TRANSFORM_FRAME_REQUIRED', 'from and to frame names are required.');
  if (from === to) throw new TransformError('TRANSFORM_FRAME_REQUIRED', 'from and to frames must differ.');
  if (typeof units !== 'string' || !/^(mm|m)$/.test(units)) throw new TransformError('TRANSFORM_UNITS_REQUIRED', "units must be declared explicitly ('mm' or 'm').");
  if (!Array.isArray(matrix) || matrix.length !== 4 || matrix.some((row) => !Array.isArray(row) || row.length !== 4 || row.some((c) => typeof c !== 'number' || !Number.isFinite(c)))) {
    throw new TransformError('TRANSFORM_MATRIX_INVALID', 'matrix must be 4×4 finite numbers.');
  }
  if (matrix[3].some((c, j) => Math.abs(c - (j === 3 ? 1 : 0)) > ROTATION_TOLERANCE)) throw new TransformError('TRANSFORM_MATRIX_INVALID', 'The last row must be [0,0,0,1].');
  const R = [0, 1, 2].map((r) => matrix[r].slice(0, 3));
  checkRotation(R);
  return Object.freeze({ from, to, units, capturePoseId, R, t: [matrix[0][3], matrix[1][3], matrix[2][3]] });
}

function matrixOf(T) {
  return [...[0, 1, 2].map((r) => [...T.R[r], T.t[r]]), [0, 0, 0, 1]];
}

function assertInput(T, datum, kind) {
  if (!datum || !isVec3(datum.xyz)) throw new TransformError('TRANSFORM_INPUT_INVALID', `${kind} must be { frame, xyz: [x,y,z] }.`);
  if (datum.frame !== T.from) {
    throw new TransformError('TRANSFORM_FRAME_MISMATCH',
      datum.frame === T.to
        ? `The ${kind} is already in '${T.to}'; it must not be transformed again.`
        : `The ${kind} is in '${datum.frame}', but the transform maps from '${T.from}'.`);
  }
  if (T.capturePoseId && datum.capturePoseId !== T.capturePoseId) {
    throw new TransformError('TRANSFORM_CAPTURE_MISMATCH', `The ${kind} belongs to capture '${datum.capturePoseId}', but the transform uses the pose of capture '${T.capturePoseId}'.`);
  }
}

function applyToPoint(T, point) {
  assertInput(T, point, 'point');
  if (point.units !== T.units) throw new TransformError('TRANSFORM_UNITS_MISMATCH', `Point units '${point.units}' differ from transform units '${T.units}'.`);
  const r = mulRv(T.R, point.xyz);
  return { frame: T.to, units: T.units, xyz: [r[0] + T.t[0], r[1] + T.t[1], r[2] + T.t[2]] };
}

/** Directions and surface normals: rotation only, no translation, no units. */
function applyToDirection(T, direction) {
  assertInput(T, direction, 'direction');
  return { frame: T.to, xyz: mulRv(T.R, direction.xyz) };
}

function invert(T) {
  const Rt = transpose(T.R);
  const t = mulRv(Rt, T.t).map((c) => -c);
  return Object.freeze({ from: T.to, to: T.from, units: T.units, capturePoseId: T.capturePoseId, R: Rt, t });
}

/** outer ∘ inner: apply inner first. Requires inner.to === outer.from. */
function compose(outer, inner) {
  if (inner.to !== outer.from) throw new TransformError('TRANSFORM_CHAIN_MISMATCH', `Cannot compose: inner maps to '${inner.to}' but outer maps from '${outer.from}'.`);
  if (inner.units !== outer.units) throw new TransformError('TRANSFORM_UNITS_MISMATCH', 'Cannot compose transforms with different units.');
  if (inner.capturePoseId && outer.capturePoseId && inner.capturePoseId !== outer.capturePoseId) {
    throw new TransformError('TRANSFORM_CAPTURE_MISMATCH', 'Cannot compose transforms from different captures.');
  }
  const t = mulRv(outer.R, inner.t).map((c, i) => c + outer.t[i]);
  return Object.freeze({ from: inner.from, to: outer.to, units: outer.units, capturePoseId: outer.capturePoseId || inner.capturePoseId, R: mulRR(outer.R, inner.R), t });
}

/**
 * Eye-in-hand chain for ONE capture: base_T_camera = base_T_flange(capture) ∘ flange_T_camera.
 * The capture pose carries its id and timestamp explicitly; nothing is assumed synchronised.
 */
function eyeInHandChain({ baseFromFlange, flangeFromCamera, capture }) {
  if (!capture || typeof capture.id !== 'string' || !capture.id || typeof capture.timestamp !== 'string' || !capture.timestamp) {
    throw new TransformError('TRANSFORM_CAPTURE_REQUIRED', 'An eye-in-hand chain needs the capture id and the timestamp of the robot pose.');
  }
  if (baseFromFlange.capturePoseId !== capture.id) {
    throw new TransformError('TRANSFORM_CAPTURE_MISMATCH', `The flange pose belongs to capture '${baseFromFlange.capturePoseId}', not '${capture.id}'.`);
  }
  if (flangeFromCamera.capturePoseId) throw new TransformError('TRANSFORM_CAPTURE_MISMATCH', 'The hand-eye transform must not be tied to a single capture.');
  return { transform: compose(baseFromFlange, flangeFromCamera), capture: { id: capture.id, timestamp: capture.timestamp } };
}

module.exports = { createTransform, applyToPoint, applyToDirection, invert, compose, eyeInHandChain, matrixOf, TransformError, ROTATION_TOLERANCE };
