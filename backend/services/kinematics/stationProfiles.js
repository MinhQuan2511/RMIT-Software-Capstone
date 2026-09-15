/**
 * Versioned station / tool profiles for joint-relative planning.
 *
 * A station profile says which tool and work object the module references and
 * which tool axis is the torch approach axis. Provenance is a category, not
 * proof:
 *   synthetic_fixture                   invented for offline tests; never a real cell
 *   documented_unresolved               values quoted in project documents that disagree
 *   operator_declared                   typed by the operator; not verified by this app
 *   operator_reported_external_evidence operator declaration citing evidence held elsewhere
 *
 * The real station's tool convention and TCP are unknown. Three documents quote
 * different tWeldGun TCPs; none is selected, and no TCP value is ever used by
 * the generator (the module references the tool by name only).
 */

const { canonicalJson, sha256 } = require('../util/hash');
const { isValidIdentifier } = require('../validation/rapidSyntax');
const { validateToolConvention } = require('./jointOrientation');

const SCHEMA = 'vd-station-profile@1';

const BUILT_IN = Object.freeze({
  'real-station-unresolved': {
    id: 'real-station-unresolved',
    version: 1,
    label: 'Real welding station (unresolved: tool convention and TCP unknown)',
    provenance: 'documented_unresolved',
    description: 'The physical cell. Its tool-axis convention and TCP have not been confirmed, so joint-relative planning is blocked for it.',
    toolName: 'tWeldGun',
    wobjName: 'wobj0',
    toolConvention: null,
    tcp: {
      status: 'unknown',
      translationMm: null,
      conflictingDocumentedValues: [
        { source: 'archived station auto_calib.rspag (CalibData tWeldGun)', translationMm: [125.8, 0, 391.27] },
        { source: 'academic report', translationMm: [0, 0, 200] },
        { source: 'earlier README', translationMm: [0, 0, 380] },
      ],
      note: 'No value is selected. Resolve from the physical torch calibration record.',
    },
    workObjectDefinition: 'unknown',
    unresolved: ['toolConvention', 'tcp.translationMm', 'tcp.orientation', 'tool load', 'work object frame'],
    exportPolicy: 'blocked_until_resolved',
  },
  'synthetic-tool-z-approach': {
    id: 'synthetic-tool-z-approach',
    version: 1,
    label: 'SYNTHETIC fixture: tool +Z approach, +X roll towards travel',
    provenance: 'synthetic_fixture',
    description: 'Invented for offline mathematical tests. Not the convention of any real torch.',
    toolName: 'tSYNTH_Z_APPROACH',
    wobjName: 'wobjSYNTH',
    toolConvention: { approachAxis: '+Z', rollAxis: '+X', rollReference: 'travel' },
    tcp: { status: 'not_physical', translationMm: null, note: 'Synthetic profile; no TCP exists or is used.' },
    workObjectDefinition: 'synthetic: positions are treated as robot-base coordinates',
    unresolved: ['everything physical: this is a synthetic fixture'],
    exportPolicy: 'offline_evidence_package_only',
  },
  'synthetic-tool-x-approach': {
    id: 'synthetic-tool-x-approach',
    version: 1,
    label: 'SYNTHETIC fixture: tool +X approach, −Z roll against travel',
    provenance: 'synthetic_fixture',
    description: 'A second invented convention, used to show that the tool-axis declaration changes the quaternion.',
    toolName: 'tSYNTH_X_APPROACH',
    wobjName: 'wobjSYNTH',
    toolConvention: { approachAxis: '+X', rollAxis: '-Z', rollReference: 'against_travel' },
    tcp: { status: 'not_physical', translationMm: null, note: 'Synthetic profile; no TCP exists or is used.' },
    workObjectDefinition: 'synthetic: positions are treated as robot-base coordinates',
    unresolved: ['everything physical: this is a synthetic fixture'],
    exportPolicy: 'offline_evidence_package_only',
  },
});

const OPERATOR_DECLARED_ID = 'operator-declared';
const TEXT = /^[\p{L}\p{N} .,;:()/#'@_+-]{0,300}$/u;

const deepCopy = (o) => JSON.parse(JSON.stringify(o));
const fail = (code, message, field) => ({ code, severity: 'error', message, ...(field ? { field } : {}) });

function snapshot(profile) {
  const snap = { schema: SCHEMA, validationState: 'not_validated', ...deepCopy(profile) };
  return { ...snap, digestSha256: sha256(canonicalJson(snap)) };
}

/**
 * @param {object} param  { id } for a built-in profile, or
 *   { id: 'operator-declared', toolName, wobjName, toolConvention, note, evidenceReference? }
 * @returns {{ok: boolean, station?: object, diagnostics: object[]}}
 */
function resolveStation(param) {
  if (!param || typeof param !== 'object' || Array.isArray(param)) {
    return { ok: false, diagnostics: [fail('PARAM_STATION_REQUIRED', 'A station/tool profile is required for joint-relative planning (parameters.station).', 'station')] };
  }
  if (param.id !== OPERATOR_DECLARED_ID) {
    const base = BUILT_IN[param.id];
    if (!base) return { ok: false, diagnostics: [fail('PARAM_STATION_UNKNOWN', `Unknown station profile '${param.id}'.`, 'station.id')] };
    const extra = Object.keys(param).filter((k) => k !== 'id');
    if (extra.length) return { ok: false, diagnostics: [fail('PARAM_UNKNOWN', `Built-in station profiles take only an id (got ${extra.join(', ')}).`, 'station')] };
    if (!base.toolConvention) {
      return { ok: false, diagnostics: [fail('STATION_TOOL_CONVENTION_UNKNOWN',
        `Station profile '${base.id}' has no confirmed tool-axis convention, so joint-relative orientation cannot be computed for it. Declare the convention explicitly (operator-declared profile) once it is known.`, 'station.id')] };
    }
    return { ok: true, station: snapshot(base), diagnostics: [] };
  }

  const diagnostics = [];
  const allowed = ['id', 'toolName', 'wobjName', 'toolConvention', 'note', 'evidenceReference'];
  for (const k of Object.keys(param)) if (!allowed.includes(k)) diagnostics.push(fail('PARAM_UNKNOWN', `Unknown field station.${k}.`, `station.${k}`));
  for (const k of ['toolName', 'wobjName']) {
    if (!isValidIdentifier(param[k])) diagnostics.push(fail('PARAM_INVALID_IDENTIFIER', `station.${k} must be a RAPID identifier.`, `station.${k}`));
  }
  diagnostics.push(...validateToolConvention(param.toolConvention, 'station.toolConvention'));
  for (const k of ['note', 'evidenceReference']) {
    if (param[k] !== undefined && (typeof param[k] !== 'string' || !TEXT.test(param[k]))) {
      diagnostics.push(fail('PARAM_INVALID', `station.${k} must be plain text of at most 300 characters.`, `station.${k}`));
    }
  }
  if (typeof param.note !== 'string' || param.note.trim() === '') diagnostics.push(fail('PARAM_INVALID', 'station.note is required: say where the declared convention comes from.', 'station.note'));
  if (diagnostics.length) return { ok: false, diagnostics };

  const hasEvidence = typeof param.evidenceReference === 'string' && param.evidenceReference.trim() !== '';
  return {
    ok: true,
    station: snapshot({
      id: OPERATOR_DECLARED_ID,
      version: 1,
      label: hasEvidence ? 'Operator-declared station (cites external evidence; not verified by this application)' : 'Operator-declared station (not verified by this application)',
      provenance: hasEvidence ? 'operator_reported_external_evidence' : 'operator_declared',
      description: 'Tool-axis convention and names typed by the operator.',
      toolName: param.toolName,
      wobjName: param.wobjName,
      toolConvention: { approachAxis: param.toolConvention.approachAxis, rollAxis: param.toolConvention.rollAxis, rollReference: param.toolConvention.rollReference },
      tcp: { status: 'unknown', translationMm: null, note: 'The generator references the tool by name; the controller tooldata must match the declared convention.' },
      workObjectDefinition: 'unknown',
      declaration: { note: param.note.trim(), evidenceReference: hasEvidence ? param.evidenceReference.trim() : null },
      unresolved: ['tcp.translationMm', 'tcp.orientation', 'tool load', 'work object frame'],
      exportPolicy: 'ordinary_export_after_review',
    }),
    diagnostics: [],
  };
}

const isSyntheticStation = (station) => !!station && station.provenance === 'synthetic_fixture';

function listStationProfiles() {
  return Object.values(BUILT_IN).map((p) => ({ ...deepCopy(p), usableForJointRelative: !!p.toolConvention }));
}

module.exports = { SCHEMA, BUILT_IN, OPERATOR_DECLARED_ID, resolveStation, listStationProfiles, isSyntheticStation };
