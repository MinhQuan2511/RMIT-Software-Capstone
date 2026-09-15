/**
 * Workpiece model, exact distance primitives and clearance classification.
 * All geometry is SYNTHETIC.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { readSample } = require('./helpers');
const { SEAM_TEXT, SEAM, filletOnSeam, SYNTH_JOINT, SYNTHETIC_Z_APPROACH, pipeline, unit, dot } = require('./geometryFixtures');
const { validateWorkpieceDefinition, buildWorkpieceModel, checkSeamOnWorkpiece } = require('../services/geometry/workpiece');
const { validateToolEnvelope } = require('../services/geometry/toolEnvelope');
const { pointBox, segmentBox, segmentPenetration, hullBox } = require('../services/geometry/distance');
const { evaluateClearance, tcpPieceVsPart, STATUS, TOLERANCES } = require('../services/geometry/clearance');
const { planFilletOrientation } = require('../services/kinematics/jointOrientation');
const { recoverOrientationAngles, recoverActualPathAngles } = require('../services/kinematics/orientationCheck');
const q = require('../services/validation/quaternion');

const close = (a, b, eps, msg) => assert.ok(Math.abs(a - b) <= eps, `${msg || ''} ${a} ≉ ${b}`);
const codes = (d) => d.map((x) => x.code);
const model = (def) => { const v = validateWorkpieceDefinition(def); assert.equal(v.ok, true, JSON.stringify(v.diagnostics)); return buildWorkpieceModel(v.definition); };
const part = (m, id) => m.parts.find((p) => p.id === id);

test('tee and corner: plates meet at the root line, the seam lies on both joint surfaces, solids do not overlap', () => {
  for (const arrangement of ['tee', 'corner']) {
    const m = model(filletOnSeam({ ...SEAM, arrangement }));
    const A = part(m, 'plateA');
    const B = part(m, 'plateB');
    for (const p of [SEAM.start, SEAM.end, [500, 100, 300]]) {
      for (const box of [A, B]) { const r = pointBox(p, box); assert.equal(r.distance, 0); close(r.depth, 0, 1e-9, 'on the surface, not inside'); }
    }
    // Open quadrant (above the floor, in front of the wall at y < 100): outside both plates.
    assert.ok(pointBox([500, 90, 310], A).distance > 0 && pointBox([500, 90, 310], B).distance > 0);
    // Inside the wall (plate B thickness 8 mm towards +Y) and inside the floor.
    assert.ok(pointBox([500, 104, 350], B).depth > 3);
    assert.ok(pointBox([500, 50, 295], A).depth > 4);
    // Behind the wall on the floor level: material for a tee (overhang 60 mm), empty for a corner.
    const behind = pointBox([500, 150, 295], A);
    assert.equal(behind.distance === 0, arrangement === 'tee', arrangement);
    // The shared face a = 0 under plate B is contact, not volume overlap.
    assert.equal(hullBox([[500, 103, 300 + 1e-7]], A).distance > 0, true);
    assert.equal(checkSeamOnWorkpiece(m, SEAM.start, SEAM.end).ok, true);
    assert.equal(m.label, 'Operator-defined geometry');
  }
  assert.equal(model(filletOnSeam({ ...SEAM, provenance: 'illustrative' })).label, 'Illustrative geometry');
  assert.equal(buildWorkpieceModel(validateWorkpieceDefinition(undefined).definition).label, 'Workpiece geometry unavailable');
});

test('welding side: left and right mirror the wall across the seam; joint torch stays in the open quadrant', () => {
  for (const side of ['left', 'right']) {
    const def = filletOnSeam({ ...SEAM, side });
    const r = pipeline(SEAM_TEXT, SYNTH_JOINT({ workpiece: def, joint: { kind: 'workpiece' } }));
    assert.equal(r.ok, true, JSON.stringify(r.diagnostics));
    const m = r.workpiece;
    const wallY = part(m, 'plateB').center[1];
    assert.equal(wallY > 100, side === 'left', `${side}: wall centre y ${wallY}`);
    const b = r.plan.orientation.vectors.torchBody;
    assert.ok(dot(b, m.frame.normalA) > 0 && dot(b, m.frame.normalB) > 0, 'torch body in the open quadrant');
    assert.equal(r.clearance.categories.targetPositions, STATUS.CLEAR);
  }
});

test('invalid, inconsistent and unsupported workpiece definitions are rejected, never reshaped', () => {
  const base = filletOnSeam(SEAM);
  const bad = (patch) => codes(validateWorkpieceDefinition({ ...base, ...patch }).diagnostics);
  assert.ok(bad({ normalB: [0, -Math.cos(10 * Math.PI / 180), Math.sin(10 * Math.PI / 180)] }).includes('WORKPIECE_NOT_ORTHOGONAL'));
  assert.ok(bad({ normalA: [0, 0, 2] }).includes('WORKPIECE_NORMAL_NOT_UNIT'));
  assert.ok(bad({ origin: [400, Number.NaN, 300] }).includes('WORKPIECE_INVALID'));
  assert.ok(bad({ plateA: { thicknessMm: 0.2, openSideWidthMm: 100 } }).includes('WORKPIECE_OUT_OF_RANGE'));
  assert.ok(bad({ plateB: { thicknessMm: 8, openSideHeightMm: -5 } }).includes('WORKPIECE_OUT_OF_RANGE'));
  assert.ok(bad({ extentAlongAxisMm: [10, 10] }).includes('WORKPIECE_OUT_OF_RANGE'));
  assert.ok(bad({ teeOverhangMm: undefined }).includes('WORKPIECE_OUT_OF_RANGE'));
  assert.ok(bad({ coordinateFrame: 'robot_base_with_wobj_transform' }).includes('WORKPIECE_FRAME_UNSUPPORTED'));
  assert.ok(bad({ provenance: 'measured' }).includes('WORKPIECE_INVALID'));
  assert.ok(bad({ kind: 'butt' }).includes('WORKPIECE_KIND_UNSUPPORTED'));
  assert.ok(bad({ kind: 'lap' }).includes('WORKPIECE_KIND_UNSUPPORTED'));
  assert.ok(codes(validateWorkpieceDefinition({ ...filletOnSeam({ ...SEAM, arrangement: 'corner' }), teeOverhangMm: 5 }).diagnostics).includes('WORKPIECE_INVALID'));

  const m = model(base);
  const off = model({ ...base, origin: [400, 101, 300] });
  assert.deepEqual(codes(checkSeamOnWorkpiece(off, SEAM.start, SEAM.end).diagnostics), ['WORKPIECE_SEAM_NOT_ON_JOINT']);
  const short = model({ ...base, extentAlongAxisMm: [0, 150] });
  assert.ok(codes(checkSeamOnWorkpiece(short, SEAM.start, SEAM.end).diagnostics).includes('WORKPIECE_SEAM_OUTSIDE_EXTENT'));
  assert.equal(checkSeamOnWorkpiece(m, SEAM.start, SEAM.end).ok, true);

  // Through the pipeline: rejected with diagnostics, no module.
  const off1 = pipeline(SEAM_TEXT, SYNTH_JOINT({ workpiece: { ...base, origin: [400, 101, 300] } }));
  assert.equal(off1.ok, false);
  assert.ok(codes(off1.diagnostics).includes('WORKPIECE_SEAM_NOT_ON_JOINT'));
  const arc = pipeline(readSample('Feature_Arc_Sample.txt'), { workpiece: base });
  assert.ok(codes(arc.diagnostics).includes('WORKPIECE_SEAM_TYPE_UNSUPPORTED'));
  const mismatch = pipeline(SEAM_TEXT, SYNTH_JOINT({ workpiece: filletOnSeam({ ...SEAM, side: 'right' }) }));
  assert.ok(codes(mismatch.diagnostics).includes('WORKPIECE_JOINT_INCONSISTENT'), 'template wall-left against a wall-right workpiece');
  assert.ok(codes(pipeline(SEAM_TEXT, SYNTH_JOINT({ joint: { kind: 'workpiece' } })).diagnostics).includes('JOINT_WORKPIECE_REQUIRED'));
  assert.ok(codes(pipeline(SEAM_TEXT, SYNTH_JOINT({ traversal: 'backwards' })).diagnostics).includes('PARAM_INVALID'));
  assert.ok(codes(pipeline(readSample('Feature_Arc_Sample.txt'), { traversal: 'reversed' }).diagnostics).includes('TRAVERSAL_REVERSAL_UNSUPPORTED'));
});

test('reversal twice returns the same physical joint and the original traversal; a travel-relative template must be remapped', () => {
  const def = filletOnSeam(SEAM);
  const params = (traversal) => SYNTH_JOINT({ workpiece: def, joint: { kind: 'workpiece' }, toolEnvelope: SYNTHETIC_Z_APPROACH, traversal });
  const r1 = pipeline(SEAM_TEXT, params('as_measured'));
  const r2 = pipeline(SEAM_TEXT, params('reversed'));
  const r3 = pipeline(SEAM_TEXT, params('as_measured'));
  for (const r of [r1, r2, r3]) assert.equal(r.ok, true, JSON.stringify(r.diagnostics));
  const f1 = r1.plan.orientation.jointFrame;
  const f2 = r2.plan.orientation.jointFrame;
  assert.deepEqual(f2.normalA, f1.normalA);
  assert.deepEqual(f2.normalB, f1.normalB, 'wall not moved');
  f1.travel.forEach((c, i) => close(f2.travel[i], -c, 1e-12));
  assert.deepEqual(r2.plan.waypoints.find((w) => w.type === 'weld_start').pos, SEAM.end);
  assert.equal(r2.plan.geometry.traversal.mode, 'reversed');
  assert.deepEqual(r2.workpiece.parts, r1.workpiece.parts, 'same plates');
  const b2 = r2.plan.orientation.vectors.torchBody;
  assert.ok(dot(b2, f1.normalA) > 0 && dot(b2, f1.normalB) > 0, 'reversed torch still in the open quadrant');
  close(dot(r2.plan.orientation.vectors.approach, f2.travel), Math.sin(10 * Math.PI / 180), 1e-12, 'push follows the new travel');
  assert.equal(r3.compiled.outputSha256, r1.compiled.outputSha256, 'second reversal restores the original module');
  assert.equal(r3.configurationSha256, r1.configurationSha256);

  // Template relative to travel: reversing without remapping moves the wall and contradicts the workpiece.
  const tpl = (template, traversal) => SYNTH_JOINT({ workpiece: def, traversal, joint: { kind: 'template', template, referenceNormal: [0, 0, 1] } });
  assert.ok(codes(pipeline(SEAM_TEXT, tpl('fillet90_wall_left', 'reversed')).diagnostics).includes('WORKPIECE_JOINT_INCONSISTENT'));
  const remapped = pipeline(SEAM_TEXT, tpl('fillet90_wall_right', 'reversed'));
  assert.equal(remapped.ok, true, JSON.stringify(remapped.diagnostics));
  remapped.plan.orientation.jointFrame.normalB.forEach((c, i) => close(c, f1.normalB[i], 1e-12));
});

test('a crossing segment with both endpoints outside the plate is an intersection; thin plates are not missed between samples', () => {
  const m = model(filletOnSeam(SEAM));
  const wall = part(m, 'plateB');
  const a = [500, 90, 350];
  const b = [500, 120, 350];
  assert.ok(pointBox(a, wall).distance > 0 && pointBox(b, wall).distance > 0, 'endpoints outside');
  const r = tcpPieceVsPart(a, b, wall, false);
  assert.equal(r.result, STATUS.INTERSECTION);
  assert.equal(r.kind, 'through_crossing');

  // A 1e-4 mm plate between two 10 mm samples: every sample is outside, the analytic test still finds the crossing.
  const thin = { center: [0, 0, 0], axes: [[1, 0, 0], [0, 1, 0], [0, 0, 1]], half: [50, 50, 0.00005] };
  const samples = Array.from({ length: 11 }, (_, i) => [0, 0, -5.03 + i]);
  assert.ok(samples.every((p) => pointBox(p, thin).distance > 0), 'sampling would report clear');
  const crossing = tcpPieceVsPart([0, 0, -5.03], [0, 0, 4.97], thin, false);
  assert.equal(crossing.result, STATUS.INTERSECTION);
  assert.equal(crossing.kind, 'through_crossing');
  // Capsule swept across the thin plate.
  assert.equal(hullBox([[0, 0, -5], [0, 1, -5], [0, 1, 5], [0, 0, 5]], thin).distance, 0);

  // Grazing: dipping 0.05 mm into a face without crossing is inconclusive; 0.05 mm outside too; 0.2 mm outside is clear with an exact distance.
  const block = { center: [0, 0, -10], axes: [[1, 0, 0], [0, 1, 0], [0, 0, 1]], half: [50, 50, 10] };
  assert.equal(tcpPieceVsPart([-10, 0, 1], [0, 0, -0.05], block, false).result, STATUS.INCONCLUSIVE);
  assert.equal(tcpPieceVsPart([-10, 0, 0.05], [10, 0, 0.05], block, false).result, STATUS.INCONCLUSIVE);
  assert.equal(tcpPieceVsPart([-10, 0, 0], [10, 0, 0], block, false).result, STATUS.INCONCLUSIVE, 'touching the face exactly');
  const clear = tcpPieceVsPart([-10, 0, 0.2], [10, 0, 0.2], block, false);
  assert.equal(clear.result, STATUS.CLEAR);
  close(clear.distanceMm, 0.2, 1e-9);
  const deep = tcpPieceVsPart([-10, 0, 1], [0, 0, -3], block, false);
  assert.equal(deep.result, STATUS.INTERSECTION);
  close(deep.maxDepthMm, 3, 1e-9);
  assert.equal(segmentPenetration([-60, 0, -5], [60, 0, -5], block).throughCrossing.axis, 0, 'crossing along the long axis');
  close(segmentBox([0, 0, 5], [10, 0, 5], block).distance, 5, 1e-12);
});

test('intended seam contact is accepted while a torch body penetrating nearby plates is detected', () => {
  const def = filletOnSeam(SEAM);
  const wide = { schema: 'vd-tool-envelope@1', kind: 'tool_frame_capsules', provenance: 'synthetic_fixture', capsules: [{ id: 'nozzle', fromToolMm: [0, 0, -15], toToolMm: [0, 0, -60], radiusMm: 30 }] };
  const r = pipeline(SEAM_TEXT, SYNTH_JOINT({ workpiece: def, joint: { kind: 'workpiece' }, toolEnvelope: wide }));
  assert.equal(r.ok, true, JSON.stringify(r.diagnostics));
  const c = r.clearance;
  const start = c.targets.find((t) => t.type === 'weld_start');
  assert.equal(start.position.result, STATUS.CLEAR);
  assert.deepEqual(start.position.parts.map((p) => p.part), ['plateA', 'plateB', 'plateA_plateB_shared_face']);
  assert.ok(start.position.parts.every((p) => p.kind === 'intended_joint_surface_contact'), JSON.stringify(start.position.parts));
  const weld = c.segments.find((s) => s.role === 'weld');
  assert.equal(weld.tcpPath.result, STATUS.CLEAR, 'tip along the root line');
  assert.equal(weld.tcpPath.coverage, 'assessed', 'fine stop points: whole weld segment assessed');
  assert.equal(weld.toolEnvelope.result, STATUS.INTERSECTION, 'nozzle radius 30 mm cannot fit 15 mm from a 90° root');
  assert.equal(start.toolEnvelope.result, STATUS.INTERSECTION);
  assert.equal(c.overall.result, STATUS.INTERSECTION);
  assert.equal(c.overall.blocksExport, true);
  assert.equal(c.categories.tcpPath, STATUS.CLEAR);

  // The synthetic default envelope (9 mm nozzle from 15 mm) clears the same joint.
  const ok = pipeline(SEAM_TEXT, SYNTH_JOINT({ workpiece: def, joint: { kind: 'workpiece' }, toolEnvelope: SYNTHETIC_Z_APPROACH }));
  assert.equal(ok.clearance.categories.toolEnvelope, STATUS.CLEAR, JSON.stringify(ok.clearance.findings));
  assert.equal(ok.clearance.overall.result, STATUS.CLEAR);
  const weldEnv = ok.clearance.segments.find((s) => s.role === 'weld').toolEnvelope;
  const nozzle = weldEnv.portions[0].capsules.find((x) => x.capsule === 'nozzle');
  // Exact: axis start 15 mm along b (45° work, 10° push) is 15·cos10°·sin45° from each face, minus the 9 mm radius.
  close(Math.min(...nozzle.parts.map((p) => p.clearanceMm)), 15 * Math.cos(10 * Math.PI / 180) * Math.SQRT1_2 - 9, 1e-5);

  // A tip 0.3 mm inside the wall is intended contact; 0.8 mm inside is an intersection (planner bypassed to place it there).
  const m = model(def);
  const wall = part(m, 'plateB');
  const shared = m.depthProxies[0];
  const along = (y, box) => tcpPieceVsPart([420, y, 300], [580, y, 300], box, true);
  assert.equal(along(100.3, shared).result, STATUS.CLEAR);
  assert.equal(along(100.3, shared).kind, 'intended_joint_surface_contact');
  // On the shared face under the wall each plate alone reports depth 0; the depth proxy gives the true 0.8 mm.
  assert.equal(along(100.8, wall).result, STATUS.INCONCLUSIVE);
  assert.equal(along(100.8, shared).result, STATUS.INTERSECTION);
  assert.equal(tcpPieceVsPart([420, 100.3, 300], [580, 100.3, 300], shared, false).result, STATUS.INTERSECTION, 'no allowance away from the weld');
  const handPlaced = evaluateClearance({
    waypoints: [
      { name: 'a', type: 'weld_start', pos: [420, 100.8, 300], orient: [1, 0, 0, 0], conf: [0, 0, 0, 0] },
      { name: 'b', type: 'weld_end', pos: [580, 100.8, 300], orient: [1, 0, 0, 0], conf: [0, 0, 0, 0] },
    ],
    segments: [{ index: 0, instruction: 'MoveL', role: 'weld', from: 'a', to: 'b', speed: 'v100', zone: 'fine' }],
    workpiece: m, toolEnvelope: { kind: 'unknown' },
  });
  assert.equal(handPlaced.categories.targetPositions, STATUS.INTERSECTION);
  assert.equal(handPlaced.categories.tcpPath, STATUS.INTERSECTION);
});

test('unknown geometry, unknown envelope and schematic MoveJ transfers never produce a clearance pass', () => {
  const unknown = pipeline(SEAM_TEXT, SYNTH_JOINT());
  assert.equal(unknown.clearance.overall.result, STATUS.NOT_ASSESSED);
  assert.equal(unknown.clearance.overall.realWorkpiece, STATUS.NOT_ASSESSED);
  assert.equal(unknown.clearance.counts.tcpPathSegments.assessed, 0);
  assert.ok(unknown.clearance.unassessed.some((u) => u.reasonCode === 'WORKPIECE_GEOMETRY_UNAVAILABLE'));
  assert.equal(unknown.compiled.outputSha256, pipeline(SEAM_TEXT, SYNTH_JOINT()).compiled.outputSha256);

  const noEnvelope = pipeline(SEAM_TEXT, SYNTH_JOINT({ workpiece: filletOnSeam(SEAM), joint: { kind: 'workpiece' } }));
  assert.equal(noEnvelope.clearance.categories.toolEnvelope, STATUS.NOT_ASSESSED);
  assert.ok(noEnvelope.clearance.unassessed.some((u) => u.reasonCode === 'TOOL_ENVELOPE_UNKNOWN'));

  const illustrative = pipeline(SEAM_TEXT, SYNTH_JOINT({ workpiece: filletOnSeam({ ...SEAM, provenance: 'illustrative' }), joint: { kind: 'workpiece' }, toolEnvelope: SYNTHETIC_Z_APPROACH }));
  assert.equal(illustrative.clearance.overall.result, STATUS.CLEAR);
  assert.equal(illustrative.clearance.overall.realWorkpiece, STATUS.NOT_ASSESSED, 'illustrative plates never assess the real workpiece');
  assert.ok(codes(illustrative.diagnostics).includes('WORKPIECE_GEOMETRY_ILLUSTRATIVE'));

  // A MoveJ between two targets far from the plates: the straight connector is clear, the motion stays unassessed.
  const m = model(filletOnSeam(SEAM));
  const qd = [1, 0, 0, 0];
  const waypoints = [
    { name: 'pA', type: 'point', pos: [500, -300, 900], orient: qd, conf: [0, 0, 0, 0] },
    { name: 'pB', type: 'point', pos: [700, -300, 900], orient: qd, conf: [0, 0, 0, 0] },
  ];
  const segments = [
    { index: 0, instruction: 'MoveJ', role: 'air', from: null, to: 'pA', speed: 'v100', zone: 'fine' },
    { index: 1, instruction: 'MoveJ', role: 'air', from: 'pA', to: 'pB', speed: 'v100', zone: 'fine' },
    { index: 2, instruction: 'MoveL', role: 'air', from: 'pB', to: 'pA', speed: 'v100', zone: 'fine' },
  ];
  assert.ok(segmentBox(waypoints[0].pos, waypoints[1].pos, part(m, 'plateB')).distance > 300);
  const c = evaluateClearance({ waypoints, segments, workpiece: m, toolEnvelope: SYNTHETIC_Z_APPROACH });
  assert.equal(c.segments[0].motionModel, 'unknown_start');
  assert.equal(c.segments[1].connector, 'schematic');
  assert.equal(c.segments[1].tcpPath.result, STATUS.NOT_ASSESSED);
  assert.equal(c.segments[1].tcpPath.reasonCode, 'JOINT_SPACE_MOTION_NOT_RECONSTRUCTED');
  assert.equal(c.segments[1].toolEnvelope.result, STATUS.NOT_ASSESSED);
  assert.equal(c.segments[2].tcpPath.result, STATUS.CLEAR);
  assert.equal(c.counts.tcpPathSegments.notAssessed, 2);
  assert.ok(!JSON.stringify(c).match(/"(safe|collision[_-]free|robot[_-]validated|passed)"/i));
});

test('corner zones and changing orientation are reported as unassessed portions, not silently cleared', () => {
  const r = pipeline(readSample('Feature_Straight_Sample.txt'), {
    workpiece: filletOnSeam({ start: [414.69, 1112.75, 320.342], end: [338.531, 1333.74, 322.068], side: 'right' }),
    toolEnvelope: SYNTHETIC_Z_APPROACH,
  });
  assert.equal(r.ok, true, JSON.stringify(r.diagnostics));
  const seg1 = r.clearance.segments[1]; // MoveL home → approach, z100 corner at home, z10 at approach, orientation changes
  assert.equal(seg1.tcpPath.coverage, 'partially_assessed');
  assert.deepEqual(seg1.tcpPath.portions.map((p) => p.portion), ['corner_start', 'linear', 'corner_end']);
  assert.equal(seg1.tcpPath.portions[0].toMm, 100);
  assert.equal(seg1.toolEnvelope.reasonCode, 'ORIENTATION_INTERPOLATION_NOT_RECONSTRUCTED');
  assert.ok(r.clearance.unassessed.some((u) => u.reasonCode === 'CORNER_PATH_NOT_RECONSTRUCTED'));
  assert.equal(r.clearance.segments[3].tcpPath.coverage, 'assessed', 'weld between fine stop points');
});

test('observed preview issue reproduced: the legacy approach/retract lines cross the illustrative T-joint web placed on the other side', () => {
  // The former browser mesh: 12 mm web on the LEFT of travel, 70 mm high, 140 mm flange centred on the seam, 15 mm past both ends.
  const seam = { start: [414.69, 1112.75, 320.342], end: [338.531, 1333.74, 322.068] };
  const oldMesh = filletOnSeam({ ...seam, side: 'left', provenance: 'illustrative', tA: 12, wA: 70, tB: 12, hB: 70, overhang: 58, margin: 15 });
  const r = pipeline(readSample('Feature_Straight_Sample.txt'), { workpiece: oldMesh });
  assert.equal(r.ok, true, JSON.stringify(r.diagnostics));
  assert.equal(r.compiled.outputSha256, '30791efbb5d8e7221752f79869e1f31898226934dbcd84c84414d8a1b25fe613', 'module bytes unchanged by a diagnostic workpiece');
  const approach = r.clearance.segments.find((s) => s.role === 'approach');
  const retract = r.clearance.segments.find((s) => s.role === 'retract');
  const wallHit = (s) => s.tcpPath.portions.flatMap((p) => p.parts || []).find((p) => p.part === 'plateB' && p.result === STATUS.INTERSECTION);
  assert.ok(wallHit(approach), JSON.stringify(approach.tcpPath));
  assert.ok(wallHit(retract), JSON.stringify(retract.tcpPath));
  assert.equal(r.clearance.overall.result, STATUS.INTERSECTION);
  assert.equal(r.clearance.overall.blocksExport, false, 'illustrative geometry never blocks or passes');
  // The legacy offsets put approach/retract 35 mm LEFT of travel; with the wall on the right they cross no plate.
  const right = pipeline(readSample('Feature_Straight_Sample.txt'), { workpiece: { ...oldMesh, ...filletOnSeam({ ...seam, side: 'right', provenance: 'illustrative', tA: 12, wA: 70, tB: 12, hB: 70, overhang: 58, margin: 15 }) } });
  assert.equal(right.clearance.categories.tcpPath, STATUS.CLEAR, JSON.stringify(right.clearance.findings));
});

test('rigid rotation and translation of the whole fixture preserve classifications and distances', () => {
  const def = filletOnSeam(SEAM);
  const base = pipeline(SEAM_TEXT, SYNTH_JOINT({ workpiece: def, joint: { kind: 'workpiece' }, toolEnvelope: SYNTHETIC_Z_APPROACH, clearances: { approachStandoffMm: 60, retractStandoffMm: 60, homeStandoffMm: 350 } }));
  const wide = { ...SYNTHETIC_Z_APPROACH, capsules: [{ id: 'nozzle', fromToolMm: [0, 0, -12], toToolMm: [0, 0, -60], radiusMm: 12 }] };
  for (const envelope of [SYNTHETIC_Z_APPROACH, wide]) {
    const plan = pipeline(SEAM_TEXT, SYNTH_JOINT({ workpiece: def, joint: { kind: 'workpiece' }, toolEnvelope: envelope })).plan;
    const g = q.normalizeQuaternion(q.quatFromAxisAngle(unit([1, 2, 3]), 0.7));
    const shift = [-1234.5, 310.25, 77];
    const move = (p) => q.rotateVector(g, p).map((c, i) => c + shift[i]);
    const turn = (v) => q.rotateVector(g, v);
    const moved = { ...def, origin: move(def.origin), normalA: unit(turn(def.normalA)), normalB: unit(turn(def.normalB)) };
    const waypoints = plan.waypoints.map((w) => ({ ...w, pos: move(w.pos), orient: q.quatMultiply(g, w.orient) }));
    const a = evaluateClearance({ waypoints: plan.waypoints, segments: plan.segments, workpiece: model(def), toolEnvelope: envelope });
    const b = evaluateClearance({ waypoints, segments: plan.segments, workpiece: model(moved), toolEnvelope: envelope });
    assert.deepEqual(b.categories, a.categories);
    assert.deepEqual(b.findings.map((f) => [f.scope, f.part, f.result, f.kind]), a.findings.map((f) => [f.scope, f.part, f.result, f.kind]));
    const numbers = (c) => c.targets.flatMap((t) => [...t.position.parts.map((p) => p.distanceMm ?? p.depthBelowJointSurfaceMm ?? 0), ...t.toolEnvelope.capsules.flatMap((k) => k.parts.map((p) => p.clearanceMm ?? p.overlapDepthLowerBoundMm ?? 0))]);
    numbers(b).forEach((v, i) => close(v, numbers(a)[i], 1e-4, 'distance'));
  }
  assert.equal(base.ok, true);
});

test('0.4° chord/axis discrepancy: declared-axis check reproduces 10° push, the actual path gives ≈9.717° and is reported', () => {
  const RAD = Math.PI / 180;
  const L = 200;
  const start = [0, 0, 0];
  const end = [L * Math.cos(0.4 * RAD), 0, L * Math.sin(0.4 * RAD)];
  const tc = { approachAxis: '+Z', rollAxis: '+X', rollReference: 'travel' };
  const planned = planFilletOrientation({ start, end, joint: { kind: 'explicit_normals', normalA: [0, 0, 1], normalB: [0, -1, 0] }, toolConvention: tc, workAngleDeg: 45, pushAngleDeg: 10 });
  assert.equal(planned.ok, true, JSON.stringify(planned.diagnostics));
  close(planned.frame.seamToJointAxisDeg, 0.4, 1e-9);
  const qd = q.roundQuaternion(planned.quaternion, 9).q;
  const declared = recoverOrientationAngles({ quaternion: qd, frame: planned.frame, toolConvention: tc, requested: { workAngleDeg: 45, pushAngleDeg: 10 } });
  assert.equal(declared.status, 'mathematical_check_passed');
  const actual = recoverActualPathAngles({ quaternion: qd, frame: planned.frame, toolConvention: tc, start, end, requested: { workAngleDeg: 45, pushAngleDeg: 10 } });
  const expected = Math.asin(Math.sin(10 * RAD) * Math.cos(0.4 * RAD) - Math.cos(10 * RAD) * Math.SQRT1_2 * Math.sin(0.4 * RAD)) / RAD;
  close(actual.pushAngleDeg, expected, 1e-6);
  close(actual.pushAngleDeg, 9.717, 0.001);
  close(actual.axisDisagreementDeg, 0.4, 1e-9);
  assert.ok(Math.abs(actual.workDeviationDeg) < 0.4, `work deviation ${actual.workDeviationDeg}`);

  // Through the pipeline the deviation is stored and needs acknowledgement; positions stay on the measured chord.
  const text = `units: mm\n# SYNTHETIC 0.4 degree fixture\ncurve: 0, 0, 0, ${end[0].toFixed(6)}, 0, ${end[2].toFixed(6)}, 5\n`;
  const r = pipeline(text, SYNTH_JOINT({ joint: { kind: 'explicit_normals', normalA: [0, 0, 1], normalB: [0, -1, 0] } }));
  assert.equal(r.ok, true, JSON.stringify(r.diagnostics));
  const dev = r.diagnostics.find((d) => d.code === 'ORIENTATION_ACTUAL_PATH_DEVIATION');
  assert.ok(dev && dev.requiresAcknowledgement);
  close(r.plan.orientation.actualPath.pushAngleDeg, 9.717, 0.001);
  assert.equal(r.plan.orientation.recovered.status, 'mathematical_check_passed');
  assert.deepEqual(r.plan.waypoints.find((w) => w.type === 'weld_end').pos, end.map((c) => Number(c.toFixed(4))));
  // A workpiece needs the seam within 0.5 mm of its root line: 200 mm at 0.4° is 1.4 mm off, so it is rejected, not moved.
  const wp = { schema: 'vd-workpiece@1', kind: 'fillet90_plates', arrangement: 'corner', provenance: 'operator_defined', origin: [0, 0, 0], normalA: [0, 0, 1], normalB: [0, -1, 0], extentAlongAxisMm: [-10, 210], plateA: { thicknessMm: 5, openSideWidthMm: 100 }, plateB: { thicknessMm: 5, openSideHeightMm: 100 } };
  assert.ok(codes(pipeline(text, SYNTH_JOINT({ workpiece: wp, joint: { kind: 'workpiece' } })).diagnostics).includes('WORKPIECE_SEAM_NOT_ON_JOINT'));
});

test('tool envelope validation: finite capsules in the tool frame; a capsule containing the TCP is flagged', () => {
  assert.equal(validateToolEnvelope(SYNTHETIC_Z_APPROACH).ok, true);
  assert.equal(validateToolEnvelope(undefined).definition.kind, 'unknown');
  const bad = (capsules) => validateToolEnvelope({ ...SYNTHETIC_Z_APPROACH, capsules });
  assert.equal(bad([]).ok, false);
  assert.equal(bad([{ id: 'a', fromToolMm: [0, 0, Number.NaN], toToolMm: [0, 0, -5], radiusMm: 3 }]).ok, false);
  assert.equal(bad([{ id: 'a', fromToolMm: [0, 0, 0], toToolMm: [0, 0, -5], radiusMm: 0 }]).ok, false);
  const tcp = bad([{ id: 'a', fromToolMm: [0, 0, 5], toToolMm: [0, 0, -50], radiusMm: 3 }]);
  assert.equal(tcp.ok, true);
  assert.deepEqual(codes(tcp.diagnostics), ['TOOL_ENVELOPE_CONTAINS_TCP']);
  assert.equal(TOLERANCES.grazingToleranceMm < TOLERANCES.weldContactToleranceMm, true);
});
