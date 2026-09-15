/**
 * Simplified torch envelope (vd-tool-envelope@1): capsules declared in the
 * TOOL frame, i.e. relative to the TCP and the tool axes that the stored
 * robtarget quaternion rotates into the target frame. Pure functions.
 *
 * A capsule is the set of points within radiusMm of the segment
 * fromToolMm → toToolMm. Declaring the segment in tool coordinates keeps the
 * nozzle and body where they are relative to the wire tip (the TCP) instead of
 * centring them on it, and a bent neck can be described with offsets.
 *
 * 'unknown' means no envelope: every envelope check is reported Not assessed.
 * Synthetic dimensions are labelled synthetic and never describe a real torch;
 * the decorative torch mesh in the browser is not an envelope.
 */

'use strict';

const { canonicalJson, sha256 } = require('../util/hash');
const { add, norm, segmentSegment } = require('./distance');
const { rotateVector } = require('../validation/quaternion');

const SCHEMA = 'vd-tool-envelope@1';
const LIMITS = Object.freeze({ maxCapsules: 8, coordinateAbsMm: 2000, radiusMm: [0.1, 500] });
const ID = /^[a-z][a-z0-9_]{0,23}$/;
const NOTE = /^[\p{L}\p{N} .,;:()/#'@_+-]{0,300}$/u;

const UNKNOWN = Object.freeze({ schema: SCHEMA, kind: 'unknown' });

/**
 * SYNTHETIC envelope for a tool whose +Z axis points along the torch (towards
 * the wire tip), e.g. synthetic-tool-z-approach@1. Invented dimensions.
 */
const SYNTHETIC_Z_APPROACH = Object.freeze({
  schema: SCHEMA,
  kind: 'tool_frame_capsules',
  provenance: 'synthetic_fixture',
  capsules: [
    { id: 'nozzle', fromToolMm: [0, 0, -15], toToolMm: [0, 0, -60], radiusMm: 9 },
    { id: 'body', fromToolMm: [0, 0, -60], toToolMm: [0, 0, -250], radiusMm: 14 },
  ],
  note: 'SYNTHETIC: invented 15 mm stick-out, 9 mm nozzle, 14 mm body along tool -Z',
});

const problem = (code, message, field) => ({ code, severity: 'error', message, ...(field ? { field } : {}) });

function validateToolEnvelope(input) {
  if (input === undefined) return { ok: true, definition: { ...UNKNOWN }, diagnostics: [] };
  if (!input || typeof input !== 'object' || Array.isArray(input)) return { ok: false, diagnostics: [problem('TOOL_ENVELOPE_INVALID', 'toolEnvelope must be an object.', 'toolEnvelope')] };
  const d = [];
  if (input.schema !== undefined && input.schema !== SCHEMA) d.push(problem('TOOL_ENVELOPE_INVALID', `toolEnvelope.schema must be '${SCHEMA}'.`, 'toolEnvelope.schema'));
  if (input.kind === 'unknown') {
    for (const k of Object.keys(input)) if (!['schema', 'kind'].includes(k)) d.push(problem('TOOL_ENVELOPE_INVALID', `Unknown field toolEnvelope.${k}.`, `toolEnvelope.${k}`));
    return d.length ? { ok: false, diagnostics: d } : { ok: true, definition: { ...UNKNOWN }, diagnostics: [] };
  }
  if (input.kind !== 'tool_frame_capsules') return { ok: false, diagnostics: [problem('TOOL_ENVELOPE_INVALID', "toolEnvelope.kind must be 'tool_frame_capsules' or 'unknown'.", 'toolEnvelope.kind')] };
  for (const k of Object.keys(input)) if (!['schema', 'kind', 'provenance', 'capsules', 'note'].includes(k)) d.push(problem('TOOL_ENVELOPE_INVALID', `Unknown field toolEnvelope.${k}.`, `toolEnvelope.${k}`));
  if (input.provenance !== 'synthetic_fixture' && input.provenance !== 'operator_defined') d.push(problem('TOOL_ENVELOPE_INVALID', "toolEnvelope.provenance must be 'synthetic_fixture' or 'operator_defined'.", 'toolEnvelope.provenance'));
  if (input.note !== undefined && (typeof input.note !== 'string' || !NOTE.test(input.note))) d.push(problem('TOOL_ENVELOPE_INVALID', 'toolEnvelope.note must be plain text of at most 300 characters.', 'toolEnvelope.note'));
  const capsules = [];
  if (!Array.isArray(input.capsules) || input.capsules.length < 1 || input.capsules.length > LIMITS.maxCapsules) {
    d.push(problem('TOOL_ENVELOPE_INVALID', `toolEnvelope.capsules must list 1 to ${LIMITS.maxCapsules} capsules.`, 'toolEnvelope.capsules'));
  } else {
    const ids = new Set();
    input.capsules.forEach((c, i) => {
      const at = `toolEnvelope.capsules[${i}]`;
      if (!c || typeof c !== 'object' || Array.isArray(c)) { d.push(problem('TOOL_ENVELOPE_INVALID', `${at} must be an object.`, at)); return; }
      for (const k of Object.keys(c)) if (!['id', 'fromToolMm', 'toToolMm', 'radiusMm'].includes(k)) d.push(problem('TOOL_ENVELOPE_INVALID', `Unknown field ${at}.${k}.`, `${at}.${k}`));
      if (typeof c.id !== 'string' || !ID.test(c.id) || ids.has(c.id)) d.push(problem('TOOL_ENVELOPE_INVALID', `${at}.id must be a unique lower-case identifier.`, `${at}.id`));
      ids.add(c.id);
      const vec = (v, f) => (Array.isArray(v) && v.length === 3 && v.every((x) => typeof x === 'number' && Number.isFinite(x) && Math.abs(x) <= LIMITS.coordinateAbsMm) ? v.slice() : (d.push(problem('TOOL_ENVELOPE_INVALID', `${at}.${f} must be three finite numbers within ±${LIMITS.coordinateAbsMm} mm (tool frame).`, `${at}.${f}`)), null));
      const from = vec(c.fromToolMm, 'fromToolMm');
      const to = vec(c.toToolMm, 'toToolMm');
      const [lo, hi] = LIMITS.radiusMm;
      if (typeof c.radiusMm !== 'number' || !Number.isFinite(c.radiusMm) || c.radiusMm < lo || c.radiusMm > hi) d.push(problem('TOOL_ENVELOPE_INVALID', `${at}.radiusMm must be from ${lo} to ${hi} mm.`, `${at}.radiusMm`));
      if (from && to) capsules.push({ id: c.id, fromToolMm: from, toToolMm: to, radiusMm: c.radiusMm });
    });
  }
  if (d.length) return { ok: false, diagnostics: d };
  const definition = { schema: SCHEMA, kind: 'tool_frame_capsules', provenance: input.provenance, capsules, ...(input.note !== undefined ? { note: input.note.trim() } : {}) };
  const warnings = capsules
    .filter((c) => segmentSegment([0, 0, 0], [0, 0, 0], c.fromToolMm, c.toToolMm).distance < c.radiusMm)
    .map((c) => ({ code: 'TOOL_ENVELOPE_CONTAINS_TCP', severity: 'warning', message: `Envelope capsule '${c.id}' contains the TCP. Every weld target will then report a torch-body intersection; check the declared offsets.`, field: 'toolEnvelope.capsules' }));
  return { ok: true, definition, diagnostics: warnings };
}

const envelopeSha256 = (definition) => sha256(canonicalJson(definition));

/** Capsule axis endpoints in the target frame for a stored pose (pos, ABB quaternion). */
function capsuleAtPose(capsule, pos, orient) {
  return {
    id: capsule.id,
    radiusMm: capsule.radiusMm,
    from: add(pos, rotateVector(orient, capsule.fromToolMm)),
    to: add(pos, rotateVector(orient, capsule.toToolMm)),
    lengthMm: norm([capsule.toToolMm[0] - capsule.fromToolMm[0], capsule.toToolMm[1] - capsule.fromToolMm[1], capsule.toToolMm[2] - capsule.fromToolMm[2]]),
  };
}

module.exports = { SCHEMA, LIMITS, UNKNOWN, SYNTHETIC_Z_APPROACH, validateToolEnvelope, envelopeSha256, capsuleAtPose };
