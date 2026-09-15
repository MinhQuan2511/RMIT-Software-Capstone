/**
 * SYNTHETIC geometry fixtures shared by the geometry/clearance tests. Nothing
 * here is a measurement of any workpiece, torch or cell.
 */
const { sha256 } = require('../services/util/hash');
const { runPipeline } = require('../services/jobs/jobService');
const { SYNTHETIC_Z_APPROACH } = require('../services/geometry/toolEnvelope');

// A straight 200 mm seam along +X (synthetic).
const SEAM_TEXT = 'units: mm\n# SYNTHETIC FIXTURE: straight fillet seam along +X (not a measurement)\ncurve: 400, 100, 300, 600, 100, 300, 5\n';
const SEAM = { start: [400, 100, 300], end: [600, 100, 300] };

const sub = (a, b) => a.map((v, i) => v - b[i]);
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const unit = (v) => { const n = Math.hypot(...v); return v.map((c) => c / n); };

/**
 * Fillet workpiece placed on a measured seam: floor normal = reference made
 * perpendicular to the chord, wall on the given side of the MEASURED travel.
 */
function filletOnSeam({ start, end, side = 'left', arrangement = 'tee', provenance = 'operator_defined', reference = [0, 0, 1], tA = 10, wA = 150, tB = 8, hB = 120, overhang = 60, margin = 20 }) {
  const t = unit(sub(end, start));
  const nA = unit(sub(reference, t.map((c) => c * dot(reference, t))));
  const left = cross(nA, t);
  const nB = side === 'left' ? left.map((c) => -c) : left;
  const j = cross(nA, nB);
  const uEnd = dot(sub(end, start), j);
  return {
    schema: 'vd-workpiece@1', kind: 'fillet90_plates', arrangement, provenance, coordinateFrame: 'seam_input_frame', units: 'mm',
    origin: start.slice(), normalA: nA, normalB: nB,
    extentAlongAxisMm: [Math.min(0, uEnd) - margin, Math.max(0, uEnd) + margin],
    plateA: { thicknessMm: tA, openSideWidthMm: wA }, plateB: { thicknessMm: tB, openSideHeightMm: hB },
    ...(arrangement === 'tee' ? { teeOverhangMm: overhang } : {}),
  };
}

const SYNTH_JOINT = (extra = {}) => ({
  profileId: 'joint-relative-fillet',
  station: { id: 'synthetic-tool-z-approach' },
  joint: { kind: 'template', template: 'fillet90_wall_left', referenceNormal: [0, 0, 1] },
  orientation: { workAngleDeg: 45, pushAngleDeg: 10 },
  ...extra,
});

function pipeline(text, parameters, kind = 'manual_upload') {
  const content = Buffer.from(text);
  return runPipeline({ id: 'src_manual_000000000000000000000000', sha256: sha256(content), contentType: 'feature-text', sourceKind: kind, displayName: 'fixture.txt' }, content, parameters);
}

module.exports = { SEAM_TEXT, SEAM, filletOnSeam, SYNTH_JOINT, SYNTHETIC_Z_APPROACH, pipeline, unit, cross, dot, sub };
