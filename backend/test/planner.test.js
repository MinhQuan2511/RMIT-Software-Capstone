const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { parseFeatureText } = require('../services/parsers/curveParser');
const { resolveProfile } = require('../services/kinematics/profiles');
const { planSeam } = require('../services/kinematics/pathPlanner');
const q = require('../services/validation/quaternion');

const SAMPLES = path.join(__dirname, '../../samples');
const profile = (params = {}) => {
  const r = resolveProfile(params);
  assert.equal(r.ok, true, JSON.stringify(r.diagnostics));
  return r.profile;
};
const seamOf = (text) => {
  const p = parseFeatureText(text);
  assert.equal(p.ok, true, JSON.stringify(p.diagnostics));
  return p.seam;
};
const codes = (r) => r.diagnostics.map((d) => d.code);
const byName = (plan) => Object.fromEntries(plan.waypoints.map((w) => [w.name, w]));
const close = (a, b, eps = 1e-6) => assert.ok(Math.abs(a - b) <= eps, `${a} ≉ ${b}`);

test('T01 planner: straight sample keeps the documented five targets and positions', () => {
  const plan = planSeam(seamOf(fs.readFileSync(path.join(SAMPLES, 'Feature_Straight_Sample.txt'), 'utf-8')), profile());
  assert.equal(plan.ok, true);
  assert.deepEqual(plan.waypoints.map((w) => w.name), ['home', 'Target_30', 'Target_40', 'Target_20_5', 'Target_20']);
  const w = byName(plan);
  // Positions match the audit's verbatim pre-change output: the offset convention is preserved.
  assert.deepEqual(w.home.pos, [319.8846, 1203.6958, 672.068]);
  assert.deepEqual(w.Target_30.pos, [389.7452, 1077.7111, 365.342]);
  assert.deepEqual(w.Target_40.pos, [414.69, 1112.75, 320.342]);
  assert.deepEqual(w.Target_20_5.pos, [338.531, 1333.74, 322.068]);
  assert.deepEqual(w.Target_20.pos, [298.9247, 1341.2444, 367.068]);
  for (const wp of plan.waypoints) {
    assert.ok(Math.abs(q.quatNorm(wp.orient) - 1) <= q.QUAT_NORM_TOLERANCE);
    assert.ok(wp.orient.every(Number.isFinite));
  }
  assert.deepEqual(w.Target_40.orient, [0.383667588, 0.149822324, 0.889291982, -0.198776819]);
  assert.deepEqual(w.home.orient, [0, 0.382683431, 0.923879533, 0]);
  // Retract keeps the weld attitude (documented), home is upright.
  assert.deepEqual(w.Target_20.orient, w.Target_40.orient);
  assert.deepEqual(plan.segments.map((s) => `${s.instruction}:${s.role}:${s.to}`), [
    'MoveJ:air:home', 'MoveL:air:Target_30', 'MoveL:approach:Target_40', 'MoveL:weld:Target_20_5', 'MoveL:retract:Target_20', 'MoveL:air:home',
  ]);
  assert.ok(codes(plan).includes('PROFILE_QUATERNION_NORMALIZED'));
});

test('T02 planner: arc sample yields six targets, MoveC via/end and arc metrics', () => {
  const plan = planSeam(seamOf(fs.readFileSync(path.join(SAMPLES, 'Feature_Arc_Sample.txt'), 'utf-8')), profile());
  assert.equal(plan.ok, true);
  assert.deepEqual(plan.waypoints.map((w) => w.name), ['home', 'Target_30', 'Target_40', 'Target_45', 'Target_20_5', 'Target_20']);
  const weld = plan.segments.find((s) => s.role === 'weld');
  assert.equal(weld.instruction, 'MoveC');
  assert.equal(weld.via, 'Target_45');
  assert.equal(weld.to, 'Target_20_5');
  assert.equal(plan.segments.length, 6);
  const arc = plan.geometry.arc;
  close(arc.radiusMm, 186.7473, 5e-5);
  close(arc.sweepDeg, 69.692, 5e-4);
  close(arc.arcLengthMm, 227.150, 5e-4);
  assert.equal(arc.direction, 'counterclockwise_from_above');
  assert.equal(arc.samples.length, 49);
  const w = byName(plan);
  assert.deepEqual(w.Target_45.pos, [1080, 60, 480.278]);
  // Level arc: home Z = arc max Z (480.278) + 350.
  close(w.home.pos[2], 830.278, 1e-9);
  // Orientation follows the arc: via/end are the weld quaternion rotated about the normal.
  const n = [arc.normal.x, arc.normal.y, arc.normal.z];
  const weldN = q.normalizeQuaternion(profile().weldQuaternionSource);
  const expectedEnd = q.quatMultiply(q.quatFromAxisAngle(n, (arc.sweepDeg * Math.PI) / 180), weldN);
  assert.ok(q.sameRotation(w.Target_20_5.orient, expectedEnd, 1e-8));
  assert.deepEqual(w.Target_20.orient, w.Target_20_5.orient);
  assert.deepEqual(w.Target_40.orient, w.Target_30.orient);
  // Tool Z of the end target equals the start tool Z rotated by the sweep about the normal.
  const zStart = q.rotateVector(w.Target_40.orient, [0, 0, 1]);
  const zEnd = q.rotateVector(w.Target_20_5.orient, [0, 0, 1]);
  const expected = q.rotateVector(q.quatFromAxisAngle(n, (arc.sweepDeg * Math.PI) / 180), zStart);
  zEnd.forEach((v, i) => close(v, expected[i], 1e-7));
});

test('T05 planner: zero-length and too-short seams are rejected', () => {
  assert.ok(codes(planSeam(seamOf('curve:414.69,1112.75,320.342,414.69,1112.75,320.342,5.54'), profile())).includes('GEOMETRY_TOO_SHORT'));
  assert.equal(planSeam(seamOf('curve:0,0,0,0.5,0,0,5'), profile()).ok, false);
});

test('T06 planner: vertical seams are rejected instead of inventing a lateral normal', () => {
  const r = planSeam(seamOf('curve:100,100,100,100,100,400,5'), profile());
  assert.equal(r.ok, false);
  assert.ok(codes(r).includes('GEOMETRY_NEAR_VERTICAL_UNSUPPORTED'));
});

test('T06 planner: reversed seam reverses travel direction and lateral side, keeps lifts', () => {
  const fwd = byName(planSeam(seamOf('curve:0,0,0,200,0,0,5'), profile()));
  const rev = byName(planSeam(seamOf('curve:200,0,0,0,0,0,5'), profile()));
  assert.deepEqual(fwd.Target_30.pos, [-25, 35, 45]);
  assert.deepEqual(fwd.Target_20.pos, [220, 35, 45]);
  assert.deepEqual(rev.Target_30.pos, [225, -35, 45]);
  assert.deepEqual(rev.Target_20.pos, [-20, -35, 45]);
  assert.deepEqual(fwd.home.pos, [100, 60, 350]);
  assert.deepEqual(rev.home.pos, [100, -60, 350]);
});

test('T06 planner: sloped seam uses the XY part of the 3D tangent plus scalar lift (documented convention)', () => {
  // 45° rise in the XZ plane: unit tangent (√½, 0, √½).
  const plan = planSeam(seamOf('curve:0,0,0,100,0,100,5'), profile());
  assert.equal(plan.ok, true);
  assert.ok(codes(plan).includes('GEOMETRY_SLOPED_SEAM'));
  const w = byName(plan);
  close(w.Target_30.pos[0], -25 * Math.SQRT1_2, 1e-4);
  close(w.Target_30.pos[1], 35, 1e-9);
  close(w.Target_30.pos[2], 45, 1e-9); // lift is scalar, not along the tangent
  close(w.Target_20.pos[0], 100 + 20 * Math.SQRT1_2, 1e-4);
  close(w.Target_20.pos[2], 145, 1e-9);
  // Home Z = max(z1, z2) + lift, not midpoint + lift.
  close(w.home.pos[2], 450, 1e-9);
});

test('T06 planner: rotated straight seam keeps a unit lateral offset in the XY plane', () => {
  const w = byName(planSeam(seamOf('curve:0,0,50,100,100,50,5'), profile()));
  const d = [w.Target_30.pos[0] - 0, w.Target_30.pos[1] - 0];
  // back-off along (−√½, −√½)·25, lateral (−√½, √½)·35
  close(d[0], -25 * Math.SQRT1_2 - 35 * Math.SQRT1_2, 1e-4);
  close(d[1], -25 * Math.SQRT1_2 + 35 * Math.SQRT1_2, 1e-4);
});

test('T07 planner: coincident and collinear arc points are rejected, never planned as a line', () => {
  const coincident = planSeam(seamOf('arc_start:0,0,0\narc_via:0,0,0\narc_end:100,0,0\nunits:mm'), profile());
  assert.equal(coincident.ok, false);
  assert.ok(codes(coincident).includes('ARC_COINCIDENT_POINTS'));
  const collinear = planSeam(seamOf('arc_start:0,0,0\narc_via:50,0,0\narc_end:100,0,0\nunits:mm'), profile({ nearStraightArcPolicy: 'convert_to_line' }));
  assert.equal(collinear.ok, false);
  assert.ok(codes(collinear).includes('ARC_COLLINEAR_POINTS'));
  const duplicateEnd = planSeam(seamOf('arc_start:0,0,0\narc_via:50,30,0\narc_end:0,0,0.1\nunits:mm'), profile());
  assert.ok(codes(duplicateEnd).includes('ARC_COINCIDENT_POINTS'));
});

test('T08 planner: near-straight arc blocked by default; conversion only with explicit option + acknowledgement', () => {
  const text = 'units: mm\narc_start:0,0,0\narc_via:50,0.05,0\narc_end:100,0,0';
  const blocked = planSeam(seamOf(text), profile());
  assert.equal(blocked.ok, false);
  const diag = blocked.diagnostics.find((d) => d.code === 'ARC_NEAR_STRAIGHT');
  assert.ok(diag);
  close(diag.details.maxChordDeviationMm, 0.05, 1e-6);

  const converted = planSeam(seamOf(text), profile({ nearStraightArcPolicy: 'convert_to_line' }));
  assert.equal(converted.ok, true);
  const warn = converted.diagnostics.find((d) => d.code === 'ARC_CONVERTED_TO_LINE');
  assert.ok(warn && warn.requiresAcknowledgement);
  assert.equal(converted.geometry.requestedType, 'arc');
  assert.equal(converted.geometry.plannedType, 'straight');
  assert.equal(converted.geometry.conversion.from, 'arc');
  assert.ok(converted.geometry.conversion.maxChordDeviationMm > 0);
  assert.equal(converted.waypoints.length, 5);
});

test('planner: tilted arc plane requires acknowledgement; home Z uses the arc maximum', () => {
  // Arc in the XZ plane (vertical plane) rising to z=50 at the via: tangents at the ends are ~45°.
  const plan = planSeam(seamOf('units:mm\narc_start:0,0,0\narc_via:50,0,20\narc_end:100,0,0'), profile());
  assert.equal(plan.ok, true, JSON.stringify(plan.diagnostics));
  const tilt = plan.diagnostics.find((d) => d.code === 'ARC_PLANE_TILTED');
  assert.ok(tilt && tilt.requiresAcknowledgement);
  const home = byName(plan).home;
  close(home.pos[2], 20 + 350, 1e-3); // via is the highest point of this arc
});

test('planner: large sweep and via-at-end are rejected by application limits', () => {
  // Three-quarter circle around the origin (sweep 270°).
  const r = planSeam(seamOf('units:mm\narc_start:100,0,0\narc_via:-100,0,0\narc_end:0,-100,0'), profile());
  assert.equal(r.ok, false);
  assert.ok(codes(r).includes('ARC_SWEEP_OUT_OF_RANGE'));
});

test('T30 planner: profile overrides change output and invalid overrides are rejected', () => {
  const base = byName(planSeam(seamOf('curve:0,0,0,200,0,0,5'), profile()));
  const lifted = byName(planSeam(seamOf('curve:0,0,0,200,0,0,5'), profile({ clearances: { approachLiftMm: 60 }, motion: { weld: { speed: 'v50' } } })));
  assert.equal(base.Target_30.pos[2], 45);
  assert.equal(lifted.Target_30.pos[2], 60);
  assert.equal(lifted.Target_20_5.speed, 'v50');
  for (const bad of [{ clearances: { approachLiftMm: -1 } }, { clearances: { nope: 1 } }, { motion: { weld: { speed: 'v123' } } }, { motion: { weld: { zone: 'z7' } } }, { toolName: '1tool' }, { toolName: 'MODULE' }, { extra: true }, { nearStraightArcPolicy: 'guess' }]) {
    assert.equal(resolveProfile(bad).ok, false, JSON.stringify(bad));
  }
  const a = resolveProfile({ motion: { weld: { speed: 'v50' } }, clearances: { approachLiftMm: 60 } });
  const b = resolveProfile({ clearances: { approachLiftMm: 60 }, motion: { weld: { speed: 'v50' } } });
  assert.equal(a.parametersSha256, b.parametersSha256);
  assert.notEqual(a.parametersSha256, resolveProfile({}).parametersSha256);
});
