/**
 * Testing-mode adapter: an operator-supplied point list (from CSV/XLSX, parsed
 * in the browser) → canonical waypoints and segments for the common compiler.
 *
 * Nothing is defaulted silently. Missing or malformed coordinates are errors,
 * orientation and configuration come from explicit operator choices recorded
 * in the source, target names are either valid RAPID identifiers or generated
 * with a visible diagnostic, and no hidden home target exists.
 */

const { diagnostic, hasErrors } = require('../util/errors');
const { parseStrictNumber } = require('../validation/numbers');
const { isValidIdentifier } = require('../validation/rapidSyntax');
const { normalizeQuaternion, roundQuaternion, quatNorm, quatMultiply, quatFromAxisAngle } = require('../validation/quaternion');

const ORIENTATION_CONVENTIONS = new Set(['quaternion_wxyz', 'euler_zyx_deg']);
const CONFIGURATION_POLICIES = new Set(['fixed_zero', 'columns']);
const MAX_ROW_DIAGNOSTICS = 50;
const MAX_ABS_COORDINATE_MM = 100000;

/**
 * Euler angles in degrees applied as R = Rz(rz) · Ry(ry) · Rx(rx) (rotate about
 * X first, then Y, then Z, all in the fixed base frame). Same composition as the
 * previous csvToRapid conversion; see validation tests for the equivalence.
 */
function eulerZyxDegToQuaternion(rx, ry, rz) {
  const r = Math.PI / 180;
  return quatMultiply(quatMultiply(quatFromAxisAngle([0, 0, 1], rz * r), quatFromAxisAngle([0, 1, 0], ry * r)), quatFromAxisAngle([1, 0, 0], rx * r));
}

function num(row, key, rowNumber, diagnostics) {
  const raw = row[key];
  const token = typeof raw === 'number' ? String(raw) : raw;
  const r = parseStrictNumber(token === undefined || token === null ? '' : String(token));
  if (!r.ok) {
    diagnostics.push(diagnostic('POINT_INVALID_NUMBER', 'error',
      `Row ${rowNumber}: '${key}' ${r.reason === 'empty' ? 'is missing' : `is not a valid finite number ('${String(token).slice(0, 32)}')`}.`,
      { line: rowNumber, field: key }));
    return null;
  }
  return r.value;
}

/**
 * Validates the stored point-list document.
 * @returns {{ok: boolean, diagnostics: object[], points?: object[]}}
 */
function validatePointList(doc, { maxRows = 2000 } = {}) {
  const diagnostics = [];
  if (!doc || typeof doc !== 'object' || doc.kind !== 'point-list' || doc.schemaVersion !== 1) {
    return { ok: false, diagnostics: [diagnostic('POINT_LIST_SCHEMA', 'error', 'Point list document has an unsupported schema.')] };
  }
  if (doc.units !== 'mm') diagnostics.push(diagnostic('POINT_LIST_UNITS', 'error', "Point list units must be 'mm'.", { field: 'units' }));
  if (!ORIENTATION_CONVENTIONS.has(doc.orientationConvention)) {
    diagnostics.push(diagnostic('POINT_LIST_ORIENTATION', 'error', 'Choose an orientation convention: quaternion_wxyz or euler_zyx_deg.', { field: 'orientationConvention' }));
  }
  if (!CONFIGURATION_POLICIES.has(doc.configurationPolicy)) {
    diagnostics.push(diagnostic('POINT_LIST_CONFIGURATION', 'error', 'Choose a configuration policy: fixed_zero or columns.', { field: 'configurationPolicy' }));
  }
  if (!Array.isArray(doc.rows) || doc.rows.length === 0) {
    diagnostics.push(diagnostic('POINT_LIST_EMPTY', 'error', 'The point list has no rows.'));
  } else if (doc.rows.length > maxRows) {
    diagnostics.push(diagnostic('POINT_LIST_TOO_MANY_ROWS', 'error', `The point list has ${doc.rows.length} rows; the limit is ${maxRows}.`));
  }
  if (hasErrors(diagnostics)) return { ok: false, diagnostics };

  const rowDiagnostics = [];
  const points = [];
  const names = new Set();
  let generated = 0;

  doc.rows.forEach((row, i) => {
    const rowNumber = Number.isInteger(row && row.rowNumber) ? row.rowNumber : i + 2;
    if (!row || typeof row !== 'object') {
      rowDiagnostics.push(diagnostic('POINT_ROW_INVALID', 'error', `Row ${rowNumber} is not an object.`, { line: rowNumber }));
      return;
    }
    const before = rowDiagnostics.length;
    const x = num(row, 'x', rowNumber, rowDiagnostics);
    const y = num(row, 'y', rowNumber, rowDiagnostics);
    const z = num(row, 'z', rowNumber, rowDiagnostics);
    for (const v of [x, y, z]) {
      if (v !== null && Math.abs(v) > MAX_ABS_COORDINATE_MM) {
        rowDiagnostics.push(diagnostic('POINT_COORDINATE_OUT_OF_RANGE', 'error', `Row ${rowNumber}: coordinate beyond the ±${MAX_ABS_COORDINATE_MM} mm input sanity limit.`, { line: rowNumber }));
        break;
      }
    }

    let orient = null;
    if (doc.orientationConvention === 'quaternion_wxyz') {
      const q = ['q1', 'q2', 'q3', 'q4'].map((k) => num(row, k, rowNumber, rowDiagnostics));
      if (!q.includes(null)) {
        const n = quatNorm(q);
        if (!(Math.abs(n - 1) <= 1e-3)) {
          rowDiagnostics.push(diagnostic('POINT_QUATERNION_NOT_UNIT', 'error',
            `Row ${rowNumber}: quaternion norm is ${n.toFixed(6)}; it must be within 0.001 of 1 before normalisation.`, { line: rowNumber }));
        } else {
          orient = normalizeQuaternion(q);
        }
      }
    } else {
      const e = ['rx', 'ry', 'rz'].map((k) => num(row, k, rowNumber, rowDiagnostics));
      if (!e.includes(null)) orient = normalizeQuaternion(eulerZyxDegToQuaternion(e[0], e[1], e[2]));
    }

    let conf = [0, 0, 0, 0];
    if (doc.configurationPolicy === 'columns') {
      conf = ['cf1', 'cf4', 'cf6', 'cfx'].map((k) => {
        const v = num(row, k, rowNumber, rowDiagnostics);
        if (v !== null && (!Number.isInteger(v) || Math.abs(v) > 8)) {
          rowDiagnostics.push(diagnostic('POINT_INVALID_CONFIGURATION', 'error', `Row ${rowNumber}: '${k}' must be an integer.`, { line: rowNumber, field: k }));
          return null;
        }
        return v;
      });
    }

    let name = typeof row.name === 'string' ? row.name.trim() : '';
    if (name === '') {
      generated += 1;
      name = `Target_${(i + 1) * 10}`;
    } else if (!isValidIdentifier(name)) {
      rowDiagnostics.push(diagnostic('POINT_INVALID_NAME', 'error',
        `Row ${rowNumber}: name '${name.slice(0, 40)}' is not a valid RAPID identifier (letter first; letters, digits, underscore; ≤ 32 characters). Names are not rewritten automatically.`,
        { line: rowNumber, field: 'name' }));
    }
    if (names.has(name.toLowerCase())) {
      rowDiagnostics.push(diagnostic('POINT_DUPLICATE_NAME', 'error', `Row ${rowNumber}: name '${name}' is used more than once.`, { line: rowNumber, field: 'name' }));
    }
    names.add(name.toLowerCase());

    if (rowDiagnostics.length === before && orient && !conf.includes(null)) {
      points.push({ rowNumber, name, pos: [x, y, z], orient, conf });
    }
  });

  if (rowDiagnostics.length > MAX_ROW_DIAGNOSTICS) {
    const extra = rowDiagnostics.length - MAX_ROW_DIAGNOSTICS;
    rowDiagnostics.length = MAX_ROW_DIAGNOSTICS;
    rowDiagnostics.push(diagnostic('POINT_MORE_ERRORS', 'error', `${extra} further row error(s) not shown.`));
  }
  diagnostics.push(...rowDiagnostics);
  if (generated > 0) {
    diagnostics.push(diagnostic('POINT_NAMES_GENERATED', 'info', `${generated} row(s) had no name; names Target_<row×10> were generated.`));
  }
  if (hasErrors(diagnostics)) return { ok: false, diagnostics };
  return { ok: true, diagnostics, points };
}

/**
 * @returns {{ok: boolean, diagnostics: object[], waypoints?: object[], segments?: object[], geometry?: object}}
 */
function planPointList(doc, profile) {
  const v = validatePointList(doc, { maxRows: profile.maxRows });
  if (!v.ok) return { ok: false, diagnostics: v.diagnostics };
  const diagnostics = v.diagnostics;

  const homes = v.points.filter((p) => p.name.toLowerCase() === 'home');
  if (homes.length > 1) {
    diagnostics.push(diagnostic('POINT_MULTIPLE_HOME', 'error', 'More than one row is named home.'));
    return { ok: false, diagnostics };
  }
  const home = homes[0] || null;
  const targets = v.points.filter((p) => p !== home);
  if (targets.length === 0) {
    diagnostics.push(diagnostic('POINT_NO_TARGETS', 'error', 'The point list contains no targets other than home.'));
    return { ok: false, diagnostics };
  }
  if (!home) {
    diagnostics.push(diagnostic('POINT_NO_HOME_TARGET', 'warning',
      'No row is named home, so the module has no standby move before or after the path. The robot starts the first MoveL from wherever it is.',
      { requiresAcknowledgement: true }));
  }
  if (doc.configurationPolicy === 'fixed_zero') {
    diagnostics.push(diagnostic('CONFIGURATION_FIXED_ZERO', 'warning',
      'Every target uses the fixed configuration [0,0,0,0], chosen explicitly. It is not solved and must be validated in RobotStudio.'));
  }

  const toWaypoint = (p, type) => ({
    name: p.name,
    type,
    pos: p.pos.map((c) => { const r = parseFloat(c.toFixed(4)); return Object.is(r, -0) ? 0 : r; }),
    orient: roundQuaternion(p.orient, 9).q,
    conf: p.conf,
    rowNumber: p.rowNumber,
    speed: null,
    zone: null,
  });

  const m = profile.motion;
  const waypoints = [];
  const segments = [];
  if (home) {
    const hw = toWaypoint(home, 'home');
    hw.speed = m.home.speed; hw.zone = m.home.zone;
    waypoints.push(hw);
    segments.push({ index: 0, instruction: 'MoveL', role: 'air', from: null, to: hw.name, speed: m.home.speed, zone: m.home.zone });
  }
  let prev = home ? home.name : null;
  targets.forEach((p, i) => {
    const w = toWaypoint(p, 'point');
    const move = i === 0 ? m.firstTarget : m.target;
    w.speed = move.speed; w.zone = move.zone;
    waypoints.push(w);
    segments.push({ index: segments.length, instruction: 'MoveL', role: 'point', from: prev, to: w.name, speed: move.speed, zone: move.zone });
    prev = w.name;
  });
  if (home) segments.push({ index: segments.length, instruction: 'MoveL', role: 'air', from: prev, to: home.name, speed: m.returnHome.speed, zone: m.returnHome.zone });

  let pathLengthMm = 0;
  for (let i = 1; i < targets.length; i += 1) {
    const a = targets[i - 1].pos;
    const b = targets[i].pos;
    pathLengthMm += Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
  }

  return {
    ok: true,
    diagnostics,
    waypoints,
    segments,
    geometry: {
      requestedType: 'point_list',
      plannedType: 'point_list',
      pointCount: targets.length,
      hasHome: !!home,
      pathLengthMm,
      orientationConvention: doc.orientationConvention,
      configurationPolicy: doc.configurationPolicy,
      arc: null,
      conversion: null,
    },
  };
}

module.exports = { validatePointList, planPointList, eulerZyxDegToQuaternion, ORIENTATION_CONVENTIONS, CONFIGURATION_POLICIES };
