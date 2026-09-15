/**
 * Numerical inspection of an imported calibration file and optional companion
 * metadata. INSPECTION ONLY.
 *
 * A matrix that passes these checks is a well-formed rigid transform in the
 * numerical sense. That says nothing about which frames it connects, in which
 * direction, in which units, or how accurate the calibration was. The physical
 * calibration status therefore stays 'not_validated' and application of the
 * transform stays disabled whatever the numbers are.
 */

const { parseOpenCvYaml } = require('./opencvYaml');
const { sha256 } = require('../util/hash');

const INSPECTOR_VERSION = 'vd-calibration-inspector@1';
const MAX_COMPANION_BYTES = 64 * 1024;

const TOLERANCES = Object.freeze({
  bottomRowMaxAbsDeviation: 1e-6,
  orthogonalityFrobenius: 1e-5,
  determinantAbsError: 1e-5,
});

const METRIC_DEFINITIONS = Object.freeze({
  bottomRowMaxAbsDeviation: 'max |M[3][j] − [0,0,0,1][j]| over the four elements of the last row',
  orthogonalityFrobenius: '‖RᵀR − I‖_F for the upper-left 3×3 block R (0 for an exact rotation)',
  determinant: 'det(R); +1 for a proper rotation, −1 for a reflection',
  columnNorms: 'Euclidean norm of each column of R (1 for an exact rotation)',
  translationNorm: 'Euclidean norm of the translation column in the file’s own (unknown) units',
  note: 'These are numerical consistency metrics of the stored matrix. They are not calibration residuals, reprojection errors or accuracy figures.',
});

const MISSING_FOR_ACTIVATION = Object.freeze([
  'Source frame of the matrix (for example camera, flange or robot base): not stated in the file.',
  'Destination frame: not stated in the file.',
  'Direction (source→destination or its inverse): neither the key name nor the OpenCV serialisation establishes it.',
  'Translation units: not stated; magnitudes alone do not establish them.',
  "Meaning of the 'info' field.",
  'Calibration identity, date, procedure and operator record.',
  'Whether the vision export (Feature.txt) already has this transform applied.',
  'For eye-in-hand use: the robot pose of each capture, its timestamp and its synchronisation with the images.',
  'An independent reference check (a point measured in both frames) with reported residuals.',
]);

const det3 = (R) => R[0][0] * (R[1][1] * R[2][2] - R[1][2] * R[2][1])
  - R[0][1] * (R[1][0] * R[2][2] - R[1][2] * R[2][0])
  + R[0][2] * (R[1][0] * R[2][1] - R[1][1] * R[2][0]);

/** Checks one parsed !!opencv-matrix entry as a candidate 4×4 rigid transform. */
function inspectRigidMatrix(entry) {
  const checks = [];
  const add = (id, ok, message) => checks.push({ id, status: ok ? 'passed' : 'failed', message });
  add('dimensions_4x4', entry.rows === 4 && entry.cols === 4, `rows × cols = ${entry.rows} × ${entry.cols}; 4 × 4 required.`);
  add('numeric_type', entry.dt === 'f' || entry.dt === 'd', `dt '${entry.dt}' (${entry.dtName}); float32 (f) or float64 (d) required.`);
  add('element_count', entry.values.length === 16 && entry.rows * entry.cols === entry.values.length, `${entry.values.length} data elements; exactly 16 required and rows × cols must match.`);
  add('finite_values', entry.values.every(Number.isFinite), 'Every element is a finite number.');
  const base = { key: entry.key, line: entry.line, rows: entry.rows, cols: entry.cols, dt: entry.dt, dtName: entry.dtName };
  if (checks.some((c) => c.status === 'failed')) return { ...base, checks, numericalStatus: 'failed', metrics: null };

  const v = entry.values;
  const M = [0, 1, 2, 3].map((r) => v.slice(r * 4, r * 4 + 4)); // OpenCV data is row-major
  const R = [0, 1, 2].map((r) => M[r].slice(0, 3));
  const t = [M[0][3], M[1][3], M[2][3]];
  const bottom = [0, 0, 0, 1];
  const bottomRowMaxAbsDeviation = Math.max(...M[3].map((x, j) => Math.abs(x - bottom[j])));
  let frob = 0;
  for (let a = 0; a < 3; a += 1) {
    for (let b = 0; b < 3; b += 1) {
      const rtr = R[0][a] * R[0][b] + R[1][a] * R[1][b] + R[2][a] * R[2][b];
      frob += (rtr - (a === b ? 1 : 0)) ** 2;
    }
  }
  const orthogonalityFrobenius = Math.sqrt(frob);
  const determinant = det3(R);
  const metrics = {
    bottomRowMaxAbsDeviation,
    orthogonalityFrobenius,
    determinant,
    determinantAbsError: Math.abs(determinant - 1),
    columnNorms: [0, 1, 2].map((c) => Math.hypot(R[0][c], R[1][c], R[2][c])),
    translation: t,
    translationNorm: Math.hypot(...t),
    translationUnits: 'unknown',
  };
  add('bottom_row', bottomRowMaxAbsDeviation <= TOLERANCES.bottomRowMaxAbsDeviation, `Last row is [0,0,0,1] within ${TOLERANCES.bottomRowMaxAbsDeviation}.`);
  add('rotation_orthogonal', orthogonalityFrobenius <= TOLERANCES.orthogonalityFrobenius, `‖RᵀR − I‖_F ≤ ${TOLERANCES.orthogonalityFrobenius}.`);
  add('rotation_proper', Math.abs(determinant - 1) <= TOLERANCES.determinantAbsError, `|det(R) − 1| ≤ ${TOLERANCES.determinantAbsError} (a reflection has det −1).`);
  return {
    ...base,
    matrix: M,
    rotation: R,
    metrics,
    checks,
    numericalStatus: checks.every((c) => c.status === 'passed') ? 'passed' : 'failed',
    precisionNote: entry.dt === 'f' ? 'Declared float32: stored values carry about 7 significant digits, so metrics near 1e-7 are at the precision limit.' : null,
  };
}

/** Lists leaves of a JSON document (bounded) without interpreting them. */
function inspectCompanion({ content, displayName }) {
  const out = { displayName, sha256: sha256(content), sizeBytes: content.length, kind: 'cfig_json', parse: 'failed', leaves: [], observations: [], interpretation: null };
  if (content.length > MAX_COMPANION_BYTES) return { ...out, problem: `Larger than ${MAX_COMPANION_BYTES / 1024} KB.` };
  let doc;
  try {
    doc = JSON.parse(content.toString('utf-8'));
  } catch {
    return { ...out, problem: 'Not valid JSON.' };
  }
  const leaves = [];
  const walk = (value, pathStr, depth) => {
    if (leaves.length >= 300) return;
    if (depth > 8) { leaves.push({ path: pathStr, type: 'too_deep' }); return; }
    if (value && typeof value === 'object') {
      for (const [k, child] of Object.entries(value)) walk(child, pathStr ? `${pathStr}.${k}` : k, depth + 1);
      return;
    }
    if (typeof value === 'number') leaves.push({ path: pathStr, type: 'number', value });
    else if (typeof value === 'string') leaves.push({ path: pathStr, type: 'string', value: value.slice(0, 120) });
    else leaves.push({ path: pathStr, type: typeof value, value });
  };
  walk(doc, '', 0);

  const find = (re) => leaves.filter((l) => re.test(l.path) && l.type === 'number');
  const frameScale = find(/(^|\.)FrameScale$/);
  const position = leaves.filter((l) => /(^|\.)RobotPose\./.test(l.path) && /position/i.test(l.path) && l.type === 'number');
  const orientation = ['alfa', 'beta', 'gamma', 'theta'].map((n) => find(new RegExp(`(^|\\.)RobotPose\\..*${n}$|(^|\\.)${n}$`))[0]).filter(Boolean);
  const observations = [];
  if (frameScale.length) observations.push({ field: frameScale[0].path, value: frameScale[0].value, note: 'Meaning and units of FrameScale are unknown; not applied.' });
  if (position.length) observations.push({ fields: position.map((p) => p.path), values: position.map((p) => p.value), note: 'Robot pose position: frame, units, timestamp and association with this calibration or any scan are unknown.' });
  if (orientation.length === 4) {
    const values = orientation.map((o) => o.value);
    observations.push({
      fields: orientation.map((o) => o.path), values, euclideanNorm: Math.hypot(...values),
      note: 'Four orientation-like fields. Their order and convention are unknown, so they are NOT treated as a quaternion (a norm near 1 is consistent with, but does not establish, a unit quaternion).',
    });
  }
  return {
    ...out,
    parse: 'ok',
    leaves,
    observations,
    interpretation: 'Not interpreted. No value from this file is used by planning, generation or any transform.',
  };
}

/**
 * @param {{content: Buffer, displayName: string, companions?: {content: Buffer, displayName: string}[]}} input
 */
function inspectCalibrationFile({ content, displayName, companions = [] }) {
  const parsed = parseOpenCvYaml(content);
  const matrices = parsed.ok ? parsed.entries.filter((e) => e.type === 'matrix').map(inspectRigidMatrix) : [];
  const scalars = parsed.ok ? parsed.entries.filter((e) => e.type !== 'matrix').map(({ key, type, value, quoted }) => ({ key, type, value, quoted: !!quoted, meaning: 'unknown' })) : [];
  const rigid = matrices.filter((m) => m.rows === 4 && m.cols === 4);
  let numericalCheck = 'not_applicable';
  if (!parsed.ok) numericalCheck = 'failed';
  else if (rigid.length === 1) numericalCheck = rigid[0].numericalStatus;
  else if (rigid.length > 1) numericalCheck = 'ambiguous_multiple_4x4_matrices';
  else if (matrices.length) numericalCheck = 'failed';

  return {
    inspectorVersion: INSPECTOR_VERSION,
    file: { displayName, sha256: sha256(content), sizeBytes: content.length, format: 'OpenCV FileStorage YAML (strict subset)' },
    parse: { ok: parsed.ok, directive: parsed.directive || null, diagnostics: parsed.diagnostics },
    scalars,
    matrices,
    candidateTransformKey: rigid.length === 1 ? rigid[0].key : null,
    numericalCheck,
    tolerances: TOLERANCES,
    metricDefinitions: METRIC_DEFINITIONS,
    physicalCalibrationStatus: 'not_validated',
    activation: {
      status: 'disabled',
      reason: 'The application does not apply imported transforms. Seam descriptors are still read as robot-base millimetres, unchanged.',
      missingForActivation: MISSING_FOR_ACTIVATION,
    },
    unresolved: {
      sourceFrame: null,
      destinationFrame: null,
      direction: null,
      translationUnits: null,
      infoField: scalars.find((s) => s.key === 'info') ? { raw: scalars.find((s) => s.key === 'info').value, meaning: 'unknown' } : null,
      calibrationIdentity: null,
      captureDate: null,
      exportAlreadyTransformed: 'unknown',
    },
    companions: companions.map(inspectCompanion),
    notes: [
      'Importing a matrix is not running a calibration solver and does not measure calibration accuracy.',
      'Neither the file name nor the key name nor the translation magnitude is used to infer direction or units.',
    ],
  };
}

module.exports = { inspectCalibrationFile, inspectRigidMatrix, inspectCompanion, INSPECTOR_VERSION, TOLERANCES, MISSING_FOR_ACTIVATION };
