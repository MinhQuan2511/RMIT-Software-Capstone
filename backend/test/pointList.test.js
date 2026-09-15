const test = require('node:test');
const assert = require('node:assert/strict');
const { planPointList } = require('../services/parsers/pointListAdapter');
const { resolveProfile } = require('../services/kinematics/profiles');
const { compileRapidModule } = require('../services/compiler/rapidCompiler');
const { sha256 } = require('../services/util/hash');

const profile = resolveProfile({ profileId: 'point-list-linear' }).profile;
const doc = (rows, extra = {}) => ({ schemaVersion: 1, kind: 'point-list', units: 'mm', orientationConvention: 'euler_zyx_deg', configurationPolicy: 'fixed_zero', rows, ...extra });
const codes = (r) => r.diagnostics.map((d) => d.code);

test('T11 point list: valid mapping compiles with main calling Path_10', () => {
  const rows = [
    { rowNumber: 2, name: 'home', x: '1178.89', y: '0', z: '809.42', rx: '0', ry: '172', rz: '0' },
    { rowNumber: 3, name: '', x: '450.5', y: '12.2', z: '400.1', rx: '90.0', ry: '0.0', rz: '-90.0' },
    { rowNumber: 4, name: 'P2', x: 472.1, y: 35.4, z: 395.2, rx: 90, ry: 0, rz: -90 },
  ];
  const plan = planPointList(doc(rows), profile);
  assert.equal(plan.ok, true, JSON.stringify(plan.diagnostics));
  assert.deepEqual(plan.waypoints.map((w) => w.name), ['home', 'Target_20', 'P2']);
  assert.ok(codes(plan).includes('POINT_NAMES_GENERATED'));
  assert.ok(codes(plan).includes('CONFIGURATION_FIXED_ZERO'));
  const r = compileRapidModule({ waypoints: plan.waypoints, segments: plan.segments, profile, provenance: { sourceSha256: sha256('x'), profileId: 'point-list-linear@1' } });
  assert.equal(r.ok, true, JSON.stringify(r.diagnostics));
  assert.match(r.code, /PROC main\(\)\n {8}Path_10;/);
  assert.match(r.code, /MoveL home, v100, z100,/);
  assert.match(r.code, /MoveL Target_20, v80, fine,/);
  assert.match(r.code, /MoveL P2, v100, fine,/);
  // No hidden home robtarget from the old generator.
  assert.doesNotMatch(r.code, /1178\.890158094/);
});

test('T11 point list: missing/invalid coordinates, bad names and non-unit quaternions are rejected, not zeroed', () => {
  const bad = planPointList(doc([
    { rowNumber: 2, name: 'A', x: '', y: '1', z: '2', rx: 0, ry: 0, rz: 0 },
    { rowNumber: 3, name: 'B', x: 'abc', y: '1', z: '2', rx: 0, ry: 0, rz: 0 },
    { rowNumber: 4, name: 'bad name!', x: '1', y: '1', z: '2', rx: 0, ry: 0, rz: 0 },
    { rowNumber: 5, name: 'D', x: '1', y: '1', z: '2', rx: 0, ry: '', rz: 0 },
  ]), profile);
  assert.equal(bad.ok, false);
  const c = codes(bad);
  assert.ok(c.includes('POINT_INVALID_NUMBER'));
  assert.ok(c.includes('POINT_INVALID_NAME'));
  const quat = planPointList(doc([{ rowNumber: 2, name: 'A', x: 1, y: 2, z: 3, q1: 0.5, q2: 0, q3: 0, q4: 0 }], { orientationConvention: 'quaternion_wxyz' }), profile);
  assert.ok(codes(quat).includes('POINT_QUATERNION_NOT_UNIT'));
  const dup = planPointList(doc([{ name: 'A', x: 1, y: 2, z: 3, rx: 0, ry: 0, rz: 0 }, { name: 'a', x: 1, y: 2, z: 4, rx: 0, ry: 0, rz: 0 }]), profile);
  assert.ok(codes(dup).includes('POINT_DUPLICATE_NAME'));
});

test('T11 point list: explicit choices are required; no home requires acknowledgement', () => {
  assert.ok(codes(planPointList(doc([{ x: 1, y: 2, z: 3 }], { orientationConvention: undefined }), profile)).includes('POINT_LIST_ORIENTATION'));
  assert.ok(codes(planPointList(doc([{ x: 1, y: 2, z: 3 }], { configurationPolicy: 'guess' }), profile)).includes('POINT_LIST_CONFIGURATION'));
  assert.ok(codes(planPointList(doc([]), profile)).includes('POINT_LIST_EMPTY'));
  const noHome = planPointList(doc([{ name: 'A', x: 1, y: 2, z: 3, rx: 0, ry: 180, rz: 0 }]), profile);
  assert.equal(noHome.ok, true);
  const d = noHome.diagnostics.find((x) => x.code === 'POINT_NO_HOME_TARGET');
  assert.ok(d && d.requiresAcknowledgement);
  assert.equal(noHome.segments.length, 1);
  const cols = planPointList(doc([{ name: 'A', x: 1, y: 2, z: 3, rx: 0, ry: 180, rz: 0, cf1: '-1', cf4: '0', cf6: '1.5', cfx: '0' }], { configurationPolicy: 'columns' }), profile);
  assert.ok(codes(cols).includes('POINT_INVALID_CONFIGURATION'));
});
