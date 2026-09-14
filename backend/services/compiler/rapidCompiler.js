/**
 * ABB RAPID (.mod) module generator — motion only.
 *
 * Input is the canonical waypoint list plus ordered motion segments. Every
 * value is validated before anything is serialised, and the generated text is
 * then re-read by an application precheck. Neither step is a RAPID compiler:
 * acceptance by a specific RobotWare controller is established only by
 * importing the module into that controller.
 *
 * Output is deterministic: identical waypoints, segments, profile and
 * provenance produce identical bytes. Nothing volatile (time, job ID, revision
 * number) is written into the module; those live in the job record.
 *
 * No welding, process or I/O instruction is ever emitted.
 */

const { diagnostic, hasErrors } = require('../util/errors');
const { sha256 } = require('../util/hash');
const { isValidIdentifier, isAllowedSpeed, isAllowedZone } = require('../validation/rapidSyntax');
const { validateQuaternion, QUAT_NORM_TOLERANCE } = require('../validation/quaternion');
const { precheckRapidModule } = require('./rapidPrecheck');

const GENERATOR_VERSION = 'vd-rapid-generator@2.0.0';
const MODULE_NAME = 'Module1';
const PATH_PROC = 'Path_10';
const EXTERNAL_AXES = '9E+09,9E+09,9E+09,9E+09,9E+09,9E+09';
const MAX_ABS_POSITION_MM = 1e6;
const PROVENANCE_VALUE = /^[A-Za-z0-9@._:-]{1,128}$/;
const INSTRUCTIONS = new Set(['MoveJ', 'MoveL', 'MoveC']);

/**
 * Fixed-notation decimal with trailing zeros trimmed. Never exponent notation.
 * Throws on non-finite input — callers validate first.
 */
function formatRapidNumber(n, dp) {
  if (typeof n !== 'number' || !Number.isFinite(n)) throw new Error(`rapid: non-finite number ${n}`);
  // toFixed switches to exponent notation from 1e21; stay far below that and
  // inside the exactly representable integer range.
  if (Math.abs(n) >= 1e15) throw new Error(`rapid: number ${n} is outside the formatting range`);
  let s = n.toFixed(dp);
  if (s.includes('.')) s = s.replace(/0+$/, '').replace(/\.$/, '');
  if (s === '-0') s = '0';
  if (!/^-?\d+(\.\d+)?$/.test(s)) throw new Error(`rapid: could not format ${n} as a plain decimal`);
  return s;
}

function validateInput({ waypoints, segments, profile, provenance }) {
  const d = [];
  const err = (code, message, extra) => d.push(diagnostic(code, 'error', message, extra));

  for (const key of ['toolName', 'wobjName']) {
    if (!isValidIdentifier(profile && profile[key])) err('RAPID_INVALID_IDENTIFIER', `Profile ${key} is not a valid RAPID identifier.`, { field: key });
  }
  for (const key of ['sourceSha256', 'profileId']) {
    if (!PROVENANCE_VALUE.test(String(provenance && provenance[key]))) err('RAPID_INVALID_PROVENANCE', `Provenance ${key} is missing or has unsupported characters.`, { field: key });
  }

  if (!Array.isArray(waypoints) || waypoints.length === 0) {
    err('RAPID_NO_WAYPOINTS', 'No waypoints to serialise.');
    return d;
  }
  if (!Array.isArray(segments) || segments.length === 0) {
    err('RAPID_NO_SEGMENTS', 'No motion segments to serialise.');
    return d;
  }

  const names = new Map();
  waypoints.forEach((wp, i) => {
    const at = `waypoints[${i}]`;
    if (!isValidIdentifier(wp.name)) err('RAPID_INVALID_IDENTIFIER', `${at}.name '${wp.name}' is not a valid RAPID identifier.`, { field: at });
    else if (names.has(wp.name)) err('RAPID_DUPLICATE_TARGET', `Target name '${wp.name}' is declared twice.`, { field: at });
    names.set(wp.name, wp);
    if (wp.name === PATH_PROC || wp.name === 'main' || wp.name === MODULE_NAME) err('RAPID_NAME_COLLISION', `Target name '${wp.name}' collides with a module or procedure name.`, { field: at });

    if (!Array.isArray(wp.pos) || wp.pos.length !== 3 || wp.pos.some((v) => typeof v !== 'number' || !Number.isFinite(v))) {
      err('RAPID_INVALID_POSITION', `${at}.pos must be three finite numbers.`, { field: at });
    } else if (wp.pos.some((v) => Math.abs(v) > MAX_ABS_POSITION_MM)) {
      err('RAPID_POSITION_OUT_OF_RANGE', `${at}.pos exceeds ±${MAX_ABS_POSITION_MM} mm.`, { field: at });
    }
    const q = validateQuaternion(wp.orient, { requireUnit: true, tolerance: QUAT_NORM_TOLERANCE });
    if (!q.ok) err('RAPID_INVALID_QUATERNION', `${at}.orient is invalid (${q.reason}${q.norm !== undefined ? `, norm ${q.norm}` : ''}).`, { field: at });
    if (!Array.isArray(wp.conf) || wp.conf.length !== 4 || wp.conf.some((c) => !Number.isInteger(c) || Math.abs(c) > 8)) {
      err('RAPID_INVALID_CONFIGURATION', `${at}.conf must be four integers.`, { field: at });
    }
  });

  const viaUse = new Map();
  const toUse = new Set();
  segments.forEach((seg, i) => {
    const at = `segments[${i}]`;
    if (!INSTRUCTIONS.has(seg.instruction)) err('RAPID_INVALID_INSTRUCTION', `${at}.instruction '${seg.instruction}' is not MoveJ, MoveL or MoveC.`, { field: at });
    if (!names.has(seg.to)) err('RAPID_UNKNOWN_TARGET', `${at}.to references undeclared target '${seg.to}'.`, { field: at });
    if (seg.from !== null && seg.from !== undefined && !names.has(seg.from)) err('RAPID_UNKNOWN_TARGET', `${at}.from references undeclared target '${seg.from}'.`, { field: at });
    if (!isAllowedSpeed(seg.speed)) err('RAPID_INVALID_SPEED', `${at}.speed '${seg.speed}' is not an allowed predefined speeddata.`, { field: at });
    if (!isAllowedZone(seg.zone)) err('RAPID_INVALID_ZONE', `${at}.zone '${seg.zone}' is not an allowed predefined zonedata.`, { field: at });
    if (seg.instruction === 'MoveC') {
      if (!names.has(seg.via)) err('RAPID_MOVEC_VIA', `${at} MoveC needs a declared via target.`, { field: at });
      else if (seg.via === seg.to || seg.via === seg.from) err('RAPID_MOVEC_VIA', `${at} MoveC via must differ from its start and end.`, { field: at });
      viaUse.set(seg.via, (viaUse.get(seg.via) || 0) + 1);
    } else if (seg.via !== undefined) {
      err('RAPID_UNEXPECTED_VIA', `${at} has a via target but is not a MoveC.`, { field: at });
    }
    toUse.add(seg.to);
  });
  for (const [via, count] of viaUse) {
    if (count > 1) err('RAPID_MOVEC_VIA', `Via target '${via}' is used by more than one MoveC.`);
    if (toUse.has(via)) err('RAPID_MOVEC_VIA', `Via target '${via}' is also used as a move destination.`);
  }
  for (const name of names.keys()) {
    if (!toUse.has(name) && !viaUse.has(name)) err('RAPID_UNUSED_TARGET', `Target '${name}' is declared but never used.`);
  }
  return d;
}

function robtargetLine(wp) {
  const pos = wp.pos.map((v) => formatRapidNumber(v, 4)).join(',');
  const orient = wp.orient.map((v) => formatRapidNumber(v, 9)).join(',');
  const conf = wp.conf.map((v) => formatRapidNumber(v, 0)).join(',');
  return `    CONST robtarget ${wp.name}:=[[${pos}],[${orient}],[${conf}],[${EXTERNAL_AXES}]];`;
}

/**
 * @param {{waypoints: object[], segments: object[], profile: object, provenance: {sourceSha256: string, profileId: string}}} input
 * @returns {{ok: boolean, diagnostics: object[], code?: string, outputSha256?: string, prechecks?: object[], generatorVersion: string}}
 */
function compileRapidModule(input) {
  const diagnostics = validateInput(input);
  if (hasErrors(diagnostics)) return { ok: false, diagnostics, generatorVersion: GENERATOR_VERSION };

  const { waypoints, segments, profile, provenance } = input;
  const home = waypoints.find((w) => w.type === 'home');
  const ordered = home ? [home, ...waypoints.filter((w) => w !== home)] : waypoints.slice();
  const suffix = `${profile.toolName}\\WObj:=${profile.wobjName}`;

  const lines = [
    `MODULE ${MODULE_NAME}`,
    '    !***********************************************************',
    `    ! Module: ${MODULE_NAME}`,
    '    ! Description: Candidate motion-only module (MoveJ/MoveL/MoveC).',
    '    !   No welding, process or I/O instructions are included.',
    `    ! Source SHA-256: ${provenance.sourceSha256}`,
    `    ! Profile: ${provenance.profileId}`,
    `    ! Generator: ${GENERATOR_VERSION}`,
    `    ! Tool/work object: ${profile.toolName} / ${profile.wobjName} (must already exist on the controller)`,
    '    ! Robot configuration: fixed values, not solved; verify in RobotStudio.',
    '    ! Status: application prechecks only. NOT validated in RobotStudio,',
    '    !   on a virtual controller or on a physical controller.',
    '    ! Author: VertexDynamics',
    '    !***********************************************************',
    ...ordered.map(robtargetLine),
    '',
    '    PROC main()',
    `        ${PATH_PROC};`,
    '    ENDPROC',
    '',
    `    PROC ${PATH_PROC}()`,
    ...segments.map((seg) => (seg.instruction === 'MoveC'
      ? `        MoveC ${seg.via}, ${seg.to}, ${seg.speed}, ${seg.zone}, ${suffix};`
      : `        ${seg.instruction} ${seg.to}, ${seg.speed}, ${seg.zone}, ${suffix};`)),
    '    ENDPROC',
    'ENDMODULE',
    '',
  ];
  const code = lines.join('\n');

  const prechecks = precheckRapidModule(code, {
    expectedInstructionCount: segments.length,
    expectedTargetCount: waypoints.length,
  });
  const failed = prechecks.filter((c) => c.status !== 'passed');
  for (const c of failed) diagnostics.push(diagnostic('RAPID_PRECHECK_FAILED', 'error', `Application precheck '${c.id}' failed: ${c.message}`));

  return {
    ok: failed.length === 0,
    diagnostics,
    code,
    outputSha256: sha256(code),
    prechecks,
    generatorVersion: GENERATOR_VERSION,
  };
}

module.exports = { compileRapidModule, formatRapidNumber, GENERATOR_VERSION, MODULE_NAME, PATH_PROC };
