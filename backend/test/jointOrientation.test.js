/**
 * Joint-relative orientation planner.
 *
 * Expected orientations are built analytically in this file (trigonometric
 * literals, axis-angle rotations and plain dot products), never by calling
 * planFilletOrientation to produce its own reference.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const J = require('../services/kinematics/jointOrientation');
const { recoverOrientationAngles } = require('../services/kinematics/orientationCheck');
const q = require('../services/validation/quaternion');

const Z_TOOL = { approachAxis: '+Z', rollAxis: '+X', rollReference: 'travel' };
const X_TOOL = { approachAxis: '+X', rollAxis: '-Z', rollReference: 'against_travel' };
const WALL_LEFT = { kind: 'template', template: 'fillet90_wall_left', referenceNormal: [0, 0, 1] };
const RAD = Math.PI / 180;

const close = (a, b, eps = 1e-9, msg = '') => assert.ok(Math.abs(a - b) <= eps, `${msg} ${a} ≉ ${b}`);
const closeVec = (a, b, eps = 1e-9, msg = '') => a.forEach((v, i) => close(v, b[i], eps, `${msg}[${i}]`));
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const codes = (r) => r.diagnostics.map((d) => d.code);

function plan(overrides = {}) {
  const r = J.planFilletOrientation({ start: [0, 0, 0], end: [200, 0, 0], joint: WALL_LEFT, toolConvention: Z_TOOL, workAngleDeg: 45, pushAngleDeg: 0, ...overrides });
  assert.equal(r.ok, true, JSON.stringify(r.diagnostics));
  return r;
}

/** Independent angle measurement with plain vector algebra. */
function measure(quat, tool, travel, nA, nB) {
  const axis = { '+X': [1, 0, 0], '-X': [-1, 0, 0], '+Y': [0, 1, 0], '-Y': [0, -1, 0], '+Z': [0, 0, 1], '-Z': [0, 0, -1] };
  const a = q.rotateVector(quat, axis[tool.approachAxis]);
  const b = a.map((c) => -c);
  const bt = b.map((c, i) => c - dot(b, travel) * travel[i]);
  return { work: Math.atan2(dot(bt, nA), dot(bt, nB)) / RAD, push: Math.asin(dot(a, travel)) / RAD, a };
}

test('canonical joint, work 45° push 0°: equals the hand-derived quaternion ±[cos67.5°, −sin67.5°, 0, 0]', () => {
  // Floor nA=+Z, wall on the left of +X travel has face normal nB=−Y. Torch body bisects: b=(0,−√½,√½),
  // approach a=(0,√½,−√½); tool X→(1,0,0), tool Y=Z×X→(0,−√½,−√½): a rotation of −135° about base X.
  const r = plan();
  const expected = [Math.cos(67.5 * RAD), -Math.sin(67.5 * RAD), 0, 0];
  assert.ok(q.sameRotation(r.quaternion, expected, 1e-12), JSON.stringify(r.quaternion));
  closeVec(r.frame.normalA, [0, 0, 1], 1e-12);
  closeVec(r.frame.normalB, [0, -1, 0], 1e-12);
  closeVec(q.rotateVector(r.quaternion, [0, 0, 1]), [0, Math.SQRT1_2, -Math.SQRT1_2], 1e-12);
  closeVec(q.rotateVector(r.quaternion, [1, 0, 0]), [1, 0, 0], 1e-12);
  assert.ok(r.quaternion[0] >= 0, 'canonical sign w ≥ 0');
});

test('work 45° / push 10°: equals the canonical attitude rotated +10° about unit(a0 × t); angles recovered independently', () => {
  const r = plan({ pushAngleDeg: 10 });
  const a0 = [0, Math.SQRT1_2, -Math.SQRT1_2];
  const k = [0, -Math.SQRT1_2, -Math.SQRT1_2]; // a0 × (1,0,0)
  const q0 = [Math.cos(67.5 * RAD), -Math.sin(67.5 * RAD), 0, 0];
  const expected = q.quatMultiply(q.quatFromAxisAngle(k, 10 * RAD), q0);
  assert.ok(q.sameRotation(r.quaternion, expected, 1e-12));
  const a = q.rotateVector(r.quaternion, [0, 0, 1]);
  closeVec(a, [Math.sin(10 * RAD), a0[1] * Math.cos(10 * RAD), a0[2] * Math.cos(10 * RAD)], 1e-12);
  const m = measure(r.quaternion, Z_TOOL, [1, 0, 0], [0, 0, 1], [0, -1, 0]);
  close(m.work, 45, 1e-9, 'work'); close(m.push, 10, 1e-9, 'push');
  assert.ok(m.a[0] > 0, 'push: the torch points towards travel (+X here)');
  // Adding push does not change the claimed work angle (transverse projection).
  close(measure(plan({ pushAngleDeg: 25 }).quaternion, Z_TOOL, [1, 0, 0], [0, 0, 1], [0, -1, 0]).work, 45, 1e-9);
});

test('wall on the right mirrors the work side; work angle 30° is measured from the floor', () => {
  const r = plan({ joint: { ...WALL_LEFT, template: 'fillet90_wall_right' }, workAngleDeg: 30 });
  closeVec(r.frame.normalB, [0, 1, 0], 1e-12);
  const m = measure(r.quaternion, Z_TOOL, [1, 0, 0], [0, 0, 1], [0, 1, 0]);
  close(m.work, 30, 1e-9);
  // Body direction 30° above the floor towards +Y (the open side away from a right-hand wall).
  closeVec(m.a.map((c) => -c), [0, Math.cos(30 * RAD), Math.sin(30 * RAD)], 1e-12);
});

test('rotation equivariance: rotating seam and joint by G rotates the tool frame by G', () => {
  const base = plan({ pushAngleDeg: 10, joint: { kind: 'explicit_normals', normalA: [0, 0, 1], normalB: [0, -1, 0] } });
  const rotations = [
    q.quatFromAxisAngle([0, 0, 1], 37 * RAD),
    q.quatFromAxisAngle([1, 2, 3], 111 * RAD),
    q.quatFromAxisAngle([-0.3, 0.9, 0.1], -64 * RAD),
    q.quatFromAxisAngle([0, 1, 0], 180 * RAD),
  ];
  for (const g of rotations) {
    const R = (v) => q.rotateVector(g, v);
    const r = J.planFilletOrientation({ start: R([0, 0, 0]), end: R([200, 0, 0]), joint: { kind: 'explicit_normals', normalA: R([0, 0, 1]), normalB: R([0, -1, 0]) }, toolConvention: Z_TOOL, workAngleDeg: 45, pushAngleDeg: 10 });
    assert.equal(r.ok, true, JSON.stringify(r.diagnostics));
    assert.ok(q.sameRotation(r.quaternion, q.quatMultiply(g, base.quaternion), 1e-9), 'q(G·joint) ≡ G ⊗ q(joint)');
  }
});

test('reversed travel: same open side, push sign follows the new travel direction', () => {
  const joint = { kind: 'explicit_normals', normalA: [0, 0, 1], normalB: [0, -1, 0] };
  const fwd = J.planFilletOrientation({ start: [0, 0, 0], end: [200, 0, 0], joint, toolConvention: Z_TOOL, workAngleDeg: 45, pushAngleDeg: 10 });
  const rev = J.planFilletOrientation({ start: [200, 0, 0], end: [0, 0, 0], joint, toolConvention: Z_TOOL, workAngleDeg: 45, pushAngleDeg: 10 });
  closeVec(rev.frame.travel, [-1, 0, 0], 1e-12);
  const mf = measure(fwd.quaternion, Z_TOOL, [1, 0, 0], [0, 0, 1], [0, -1, 0]);
  const mr = measure(rev.quaternion, Z_TOOL, [-1, 0, 0], [0, 0, 1], [0, -1, 0]);
  close(mr.work, 45, 1e-9); close(mr.push, 10, 1e-9);
  assert.ok(mf.a[0] > 0 && mr.a[0] < 0, 'each torch leans towards its own travel direction');
  // Transverse components (open side) are identical.
  close(mf.a[1], mr.a[1], 1e-12); close(mf.a[2], mr.a[2], 1e-12);
  // A template follows the reversal: the wall stays "left of travel", i.e. switches side in base coordinates.
  const tRev = J.planFilletOrientation({ start: [200, 0, 0], end: [0, 0, 0], joint: WALL_LEFT, toolConvention: Z_TOOL, workAngleDeg: 45, pushAngleDeg: 10 });
  closeVec(tRev.frame.normalB, [0, 1, 0], 1e-12);
});

test('sloped joint (30° rise): local work and push angles are preserved', () => {
  const s = Math.sin(30 * RAD);
  const c = Math.cos(30 * RAD);
  const t = [c, 0, s];
  const nA = [-s, 0, c]; // floor tilted with the seam, still pointing up
  const r = J.planFilletOrientation({ start: [0, 0, 0], end: [100 * c, 0, 100 * s], joint: WALL_LEFT, toolConvention: Z_TOOL, workAngleDeg: 45, pushAngleDeg: 10 });
  assert.equal(r.ok, true, JSON.stringify(r.diagnostics));
  closeVec(r.frame.normalA, nA, 1e-12);
  closeVec(r.frame.normalB, [0, -1, 0], 1e-12);
  const m = measure(r.quaternion, Z_TOOL, t, nA, [0, -1, 0]);
  close(m.work, 45, 1e-9); close(m.push, 10, 1e-9);
  close(r.frame.referenceDeviationDeg, 30, 1e-9);
});

test('declared tool conventions change the quaternion but not the physical approach direction', () => {
  const z = plan({ pushAngleDeg: 10 });
  const x = plan({ pushAngleDeg: 10, toolConvention: X_TOOL });
  assert.equal(q.sameRotation(z.quaternion, x.quaternion, 1e-6), false);
  const aZ = q.rotateVector(z.quaternion, [0, 0, 1]);
  const aX = q.rotateVector(x.quaternion, [1, 0, 0]);
  closeVec(aZ, aX, 1e-12);
  // X_TOOL: tool −Z is the roll axis pointing AGAINST travel projected ⟂ approach.
  const t = [1, 0, 0];
  const expectedRoll = t.map((c, i) => c - dot(t, aX) * aX[i]);
  const n = Math.hypot(...expectedRoll);
  closeVec(q.rotateVector(x.quaternion, [0, 0, -1]), expectedRoll.map((c) => -c / n), 1e-12);
  closeVec(q.rotateVector(z.quaternion, [1, 0, 0]), expectedRoll.map((c) => c / n), 1e-12);
});

test('explicit right-handed frame equals the equivalent explicit normals', () => {
  // x = travel, z = open bisector, y chosen so nA = unit(z+y) = floor (+Z) and nB = unit(z−y) = wall face (−Y).
  const h = Math.SQRT1_2;
  const frame = { kind: 'explicit_frame', xAxis: [1, 0, 0], yAxis: [0, h, h], zAxis: [0, -h, h] };
  const viaFrame = plan({ joint: frame, pushAngleDeg: 10 });
  const viaNormals = plan({ joint: { kind: 'explicit_normals', normalA: [0, 0, 1], normalB: [0, -1, 0] }, pushAngleDeg: 10 });
  assert.ok(q.sameRotation(viaFrame.quaternion, viaNormals.quaternion, 1e-12));
  assert.equal(viaFrame.frame.frameXAlignment, 'same_as_travel');
});

test('rejects zero, non-finite, parallel, non-orthogonal, inconsistent, left-handed and degenerate joint inputs', () => {
  const run = (joint, extra = {}) => J.planFilletOrientation({ start: [0, 0, 0], end: [200, 0, 0], joint, toolConvention: Z_TOOL, workAngleDeg: 45, pushAngleDeg: 10, ...extra });
  const h = Math.SQRT1_2;
  const cases = [
    [{ kind: 'explicit_normals', normalA: [0, 0, 0], normalB: [0, -1, 0] }, 'JOINT_VECTOR_ZERO'],
    [{ kind: 'explicit_normals', normalA: [0, 0, NaN], normalB: [0, -1, 0] }, 'JOINT_VECTOR_NON_FINITE'],
    [{ kind: 'explicit_normals', normalA: [0, 0, 1], normalB: [0, 0, -2] }, 'JOINT_NORMALS_PARALLEL'],
    [{ kind: 'explicit_normals', normalA: [0, 0, 1], normalB: [0, -Math.cos(10 * RAD), Math.sin(10 * RAD)] }, 'JOINT_ANGLE_UNSUPPORTED'],
    [{ kind: 'explicit_normals', normalA: [0, 0, 1], normalB: [1, 0, 0] }, 'JOINT_SEAM_INCONSISTENT'],
    [{ kind: 'explicit_normals', normalA: [0, Math.sin(2 * RAD), Math.cos(2 * RAD)], normalB: [0, -Math.cos(2 * RAD), Math.sin(2 * RAD)] }, null],
    [{ kind: 'explicit_normals', normalA: [Math.sin(2 * RAD), 0, Math.cos(2 * RAD)], normalB: [0, -1, 0] }, 'JOINT_SEAM_INCONSISTENT'],
    [{ kind: 'explicit_frame', xAxis: [1, 0, 0], yAxis: [0, h, h], zAxis: [0, h, -h] }, 'JOINT_FRAME_LEFT_HANDED'],
    [{ kind: 'explicit_frame', xAxis: [1, 0, 0], yAxis: [0, 1, 0], zAxis: [0, 0.1, 1] }, 'JOINT_FRAME_NOT_ORTHONORMAL'],
    [{ kind: 'explicit_frame', xAxis: [2, 0, 0], yAxis: [0, 1, 0], zAxis: [0, 0, 1] }, 'JOINT_FRAME_NOT_ORTHONORMAL'],
    [{ kind: 'template', template: 'fillet90_wall_left', referenceNormal: [1, 0, 0.1] }, 'JOINT_REFERENCE_DEGENERATE'],
    [{ kind: 'template', template: 'butt_joint', referenceNormal: [0, 0, 1] }, 'JOINT_TEMPLATE_UNKNOWN'],
    [{ kind: 'explicit_normals', normalA: [0, 0, 1] }, 'JOINT_SPEC_INVALID'],
    [{ kind: 'guess' }, 'JOINT_SPEC_INVALID'],
    [null, 'JOINT_SPEC_INVALID'],
  ];
  for (const [joint, code] of cases) {
    const r = run(joint);
    if (code === null) {
      // A rotated (tilted about the seam) but consistent joint is accepted: rotation about the joint axis is supported.
      assert.equal(r.ok, true, JSON.stringify(r.diagnostics));
    } else {
      assert.equal(r.ok, false, JSON.stringify(joint));
      assert.ok(codes(r).includes(code), `${code} not in ${codes(r)} for ${JSON.stringify(joint)}`);
    }
  }
  assert.ok(codes(run(WALL_LEFT, { workAngleDeg: 80 })).includes('ORIENTATION_ANGLE_OUT_OF_RANGE'));
  assert.ok(codes(run(WALL_LEFT, { pushAngleDeg: -31 })).includes('ORIENTATION_ANGLE_OUT_OF_RANGE'));
  assert.ok(codes(run(WALL_LEFT, { toolConvention: { approachAxis: '+Z', rollAxis: '-Z', rollReference: 'travel' } })).includes('TOOL_CONVENTION_INVALID'));
  assert.ok(codes(run(WALL_LEFT, { toolConvention: { approachAxis: '+Z', rollAxis: '+X', rollReference: 'up' } })).includes('TOOL_CONVENTION_INVALID'));
});

test('small non-orthogonality within 0.1° is orthogonalised and reported; the bisector is unchanged', () => {
  const e = 0.05 * RAD;
  const nB = [0, -Math.cos(e), Math.sin(e)]; // 89.95° from +Z
  const r = plan({ joint: { kind: 'explicit_normals', normalA: [0, 0, 1], normalB: nB } });
  assert.ok(codes(r).includes('JOINT_FRAME_ORTHOGONALIZED'));
  close(dot(r.frame.normalA, r.frame.normalB), 0, 1e-12);
  const bis = [0 + nB[0], nB[1], 1 + nB[2]];
  const n = Math.hypot(...bis);
  closeVec(r.frame.openBisector, bis.map((c) => c / n), 1e-12);
  close(r.frame.orthogonalityResidualDeg, 0.05, 1e-9);
});

test('unit quaternion before and after 9-dp rounding; independent recovery within 1e-5° after rounding', () => {
  for (const [work, push, tool] of [[45, 10, Z_TOOL], [15, -30, Z_TOOL], [75, 30, X_TOOL], [52.3, 7.7, X_TOOL]]) {
    const r = plan({ workAngleDeg: work, pushAngleDeg: push, toolConvention: tool });
    close(q.quatNorm(r.quaternion), 1, 1e-15);
    const rounded = q.roundQuaternion(r.quaternion, 9);
    assert.ok(Math.abs(rounded.norm - 1) <= q.QUAT_NORM_TOLERANCE);
    const rec = recoverOrientationAngles({ quaternion: rounded.q, frame: r.frame, toolConvention: tool, requested: { workAngleDeg: work, pushAngleDeg: push } });
    assert.equal(rec.status, 'mathematical_check_passed', JSON.stringify(rec));
    assert.equal(rec.openSide, true);
    // −q is the same rotation and recovers the same angles.
    const neg = recoverOrientationAngles({ quaternion: rounded.q.map((c) => -c), frame: r.frame, toolConvention: tool });
    close(neg.workAngleDeg, rec.workAngleDeg, 1e-12); close(neg.pushAngleDeg, rec.pushAngleDeg, 1e-12);
  }
  // The check fails when the frame does not match the quaternion. (Swapping A and B would not: 45° is the
  // bisector of both.) A wall on the other side puts the torch outside the open quadrant.
  const r = plan({ pushAngleDeg: 10 });
  const wrong = recoverOrientationAngles({ quaternion: r.quaternion, frame: { ...r.frame, normalB: [0, 1, 0] }, toolConvention: Z_TOOL, requested: { workAngleDeg: 45, pushAngleDeg: 10 } });
  assert.equal(wrong.status, 'mathematical_check_failed');
  assert.equal(wrong.openSide, false);
  const reversedTravel = recoverOrientationAngles({ quaternion: r.quaternion, frame: { ...r.frame, travel: [-1, 0, 0] }, toolConvention: Z_TOOL, requested: { workAngleDeg: 45, pushAngleDeg: 10 } });
  assert.equal(reversedTravel.status, 'mathematical_check_failed', 'push sign is relative to travel');
});

test('matrixToQuaternion covers all four numerical branches; sign alignment never changes the rotation', () => {
  for (const [axis, angle] of [[[0, 0, 1], 10], [[1, 0, 0], 179], [[0, 1, 0], 179], [[0, 0, 1], 179], [[1, 1, 1], 250]]) {
    const g = q.quatFromAxisAngle(axis, angle * RAD);
    const col = (v) => q.rotateVector(g, v);
    const [c0, c1, c2] = [col([1, 0, 0]), col([0, 1, 0]), col([0, 0, 1])];
    const m = [0, 1, 2].map((r) => [c0[r], c1[r], c2[r]]);
    const back = J.matrixToQuaternion(m);
    assert.ok(q.sameRotation(back, g, 1e-12), `${axis} ${angle}`);
  }
  const a = [0.5, 0.5, 0.5, 0.5];
  const flipped = J.alignQuaternionSign(a, [-0.5, -0.5, -0.5, -0.5]);
  assert.deepEqual(flipped, [0.5, 0.5, 0.5, 0.5]);
  assert.deepEqual(J.alignQuaternionSign(null, [-1, 0, 0, 0]), [-1, 0, 0, 0]);
});
