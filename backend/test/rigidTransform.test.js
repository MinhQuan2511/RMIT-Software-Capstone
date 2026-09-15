/**
 * Frame-tagged rigid transforms with synthetic fixtures only. Expected values are
 * worked out by hand in the comments.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const T = require('../services/calibration/rigidTransform');

const close = (a, b, eps = 1e-12) => a.forEach((v, i) => assert.ok(Math.abs(v - b[i]) <= eps, `[${i}] ${v} ≉ ${b[i]}`));
const rotZ = (deg) => { const r = (deg * Math.PI) / 180; const c = Math.cos(r); const s = Math.sin(r); return [[c, -s, 0], [s, c, 0], [0, 0, 1]]; };
const rotX = (deg) => { const r = (deg * Math.PI) / 180; const c = Math.cos(r); const s = Math.sin(r); return [[1, 0, 0], [0, c, -s], [0, s, c]]; };
const I = [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
const m4 = (R, t) => [[...R[0], t[0]], [...R[1], t[1]], [...R[2], t[2]], [0, 0, 0, 1]];
const throwsCode = (fn, code) => assert.throws(fn, (e) => e.code === code, code);

test('identity, rotation and translation map points as worked out by hand', () => {
  const id = T.createTransform({ matrix: m4(I, [0, 0, 0]), from: 'camera', to: 'flange', units: 'mm' });
  assert.deepEqual(T.applyToPoint(id, { frame: 'camera', units: 'mm', xyz: [1, 2, 3] }), { frame: 'flange', units: 'mm', xyz: [1, 2, 3] });
  const rz = T.createTransform({ matrix: m4(rotZ(90), [0, 0, 0]), from: 'camera', to: 'flange', units: 'mm' });
  close(T.applyToPoint(rz, { frame: 'camera', units: 'mm', xyz: [1, 0, 0] }).xyz, [0, 1, 0]); // +X → +Y
  const tr = T.createTransform({ matrix: m4(I, [10, 20, 30]), from: 'camera', to: 'flange', units: 'mm' });
  close(T.applyToPoint(tr, { frame: 'camera', units: 'mm', xyz: [1, 1, 1] }).xyz, [11, 21, 31]);
});

test('inverse round trip and composition order (outer ∘ inner applies inner first)', () => {
  const a = T.createTransform({ matrix: m4(rotZ(30), [5, -7, 12]), from: 'camera', to: 'flange', units: 'mm' });
  const b = T.createTransform({ matrix: m4(rotX(-50), [400, 0, 900]), from: 'flange', to: 'robot_base', units: 'mm' });
  const p = { frame: 'camera', units: 'mm', xyz: [12.5, -3, 250] };
  const q = T.applyToPoint(a, p);
  const back = T.applyToPoint(T.invert(a), q);
  assert.equal(back.frame, 'camera');
  close(back.xyz, p.xyz, 1e-9);
  const ab = T.compose(b, a);
  assert.equal(ab.from, 'camera');
  assert.equal(ab.to, 'robot_base');
  close(T.applyToPoint(ab, p).xyz, T.applyToPoint(b, T.applyToPoint(a, p)).xyz, 1e-9);
  throwsCode(() => T.compose(a, b), 'TRANSFORM_CHAIN_MISMATCH');
  // Round trip through the composed chain.
  close(T.applyToPoint(T.invert(ab), T.applyToPoint(ab, p)).xyz, p.xyz, 1e-9);
});

test('normals and directions use the rotation only', () => {
  const tr = T.createTransform({ matrix: m4(rotX(90), [100, 200, 300]), from: 'camera', to: 'robot_base', units: 'mm' });
  const n = T.applyToDirection(tr, { frame: 'camera', xyz: [0, 0, 1] });
  close(n.xyz, [0, -1, 0]); // Rx(90°): +Z → −Y, no translation added
  assert.ok(Math.abs(Math.hypot(...n.xyz) - 1) < 1e-15);
});

test('robot-base data are never transformed again; units and frames must match', () => {
  const camToBase = T.createTransform({ matrix: m4(I, [1, 2, 3]), from: 'camera', to: 'robot_base', units: 'mm' });
  throwsCode(() => T.applyToPoint(camToBase, { frame: 'robot_base', units: 'mm', xyz: [0, 0, 0] }), 'TRANSFORM_FRAME_MISMATCH');
  assert.throws(() => T.applyToPoint(camToBase, { frame: 'robot_base', units: 'mm', xyz: [0, 0, 0] }), /already in 'robot_base'/);
  throwsCode(() => T.applyToDirection(camToBase, { frame: 'flange', xyz: [0, 0, 1] }), 'TRANSFORM_FRAME_MISMATCH');
  throwsCode(() => T.applyToPoint(camToBase, { frame: 'camera', units: 'm', xyz: [0, 0, 0] }), 'TRANSFORM_UNITS_MISMATCH');
  throwsCode(() => T.createTransform({ matrix: m4(I, [0, 0, 0]), from: 'camera', to: 'robot_base' }), 'TRANSFORM_UNITS_REQUIRED');
  throwsCode(() => T.createTransform({ matrix: m4(I, [0, 0, 0]), to: 'robot_base', units: 'mm' }), 'TRANSFORM_FRAME_REQUIRED');
  throwsCode(() => T.createTransform({ matrix: m4([[1, 0, 0], [0, 1, 0], [0, 0, -1]], [0, 0, 0]), from: 'a', to: 'b', units: 'mm' }), 'TRANSFORM_NOT_RIGID');
  throwsCode(() => T.createTransform({ matrix: [[1, 0, 0, 0], [0, 1, 0, 0], [0, 0, 1, 0], [0, 0, 1, 1]], from: 'a', to: 'b', units: 'mm' }), 'TRANSFORM_MATRIX_INVALID');
});

test('eye-in-hand chain for one capture carries explicit capture pose identity and timestamp', () => {
  // Synthetic: camera→flange = Rz(90°) with camera origin 100 mm along flange Z; flange pose at this capture:
  // translation [500, 0, 800] with no rotation. Camera point [10, 0, 0] → flange [0, 10, 100] → base [500, 10, 900].
  const flangeFromCamera = T.createTransform({ matrix: m4(rotZ(90), [0, 0, 100]), from: 'camera', to: 'flange', units: 'mm' });
  const baseFromFlange = T.createTransform({ matrix: m4(I, [500, 0, 800]), from: 'flange', to: 'robot_base', units: 'mm', capturePoseId: 'cap-001' });
  const { transform, capture } = T.eyeInHandChain({ baseFromFlange, flangeFromCamera, capture: { id: 'cap-001', timestamp: '2026-01-01T00:00:00.000Z' } });
  assert.deepEqual(capture, { id: 'cap-001', timestamp: '2026-01-01T00:00:00.000Z' });
  const out = T.applyToPoint(transform, { frame: 'camera', units: 'mm', capturePoseId: 'cap-001', xyz: [10, 0, 0] });
  assert.equal(out.frame, 'robot_base');
  close(out.xyz, [500, 10, 900], 1e-9);
  throwsCode(() => T.applyToPoint(transform, { frame: 'camera', units: 'mm', capturePoseId: 'cap-002', xyz: [10, 0, 0] }), 'TRANSFORM_CAPTURE_MISMATCH');
  throwsCode(() => T.eyeInHandChain({ baseFromFlange, flangeFromCamera, capture: { id: 'cap-002', timestamp: '2026-01-01T00:00:00Z' } }), 'TRANSFORM_CAPTURE_MISMATCH');
  throwsCode(() => T.eyeInHandChain({ baseFromFlange, flangeFromCamera, capture: { id: 'cap-001' } }), 'TRANSFORM_CAPTURE_REQUIRED');
  throwsCode(() => T.eyeInHandChain({ baseFromFlange, flangeFromCamera: baseFromFlange, capture: { id: 'cap-001', timestamp: 'x' } }), 'TRANSFORM_CAPTURE_MISMATCH');
});
