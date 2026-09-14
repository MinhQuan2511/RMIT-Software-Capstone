const test = require('node:test');
const assert = require('node:assert/strict');
const q = require('../services/validation/quaternion');
const { eulerZyxDegToQuaternion } = require('../services/parsers/pointListAdapter');
const { FIXED_BASE_QUATERNION } = require('../services/kinematics/profiles');

const close = (a, b, eps = 1e-9) => assert.ok(Math.abs(a - b) <= eps, `${a} ≉ ${b}`);
const closeVec = (a, b, eps = 1e-9) => a.forEach((v, i) => close(v, b[i], eps));

test('T09 quaternion: reported WELD_QUAT norm is reproduced and normalised', () => {
  const src = FIXED_BASE_QUATERNION.weldQuaternionSource;
  close(q.quatNorm(src), 0.997434867, 5e-10);
  const n = q.normalizeQuaternion(src);
  close(q.quatNorm(n), 1, 1e-15);
  closeVec(q.roundQuaternion(n, 9).q, [0.383667588, 0.149822324, 0.889291982, -0.198776819], 0);
  // Normalisation keeps the rotation: same axis direction, same tool Z.
  assert.ok(q.sameRotation(src, n));
});

test('T09 quaternion: validation rejects wrong length, non-finite and near-zero', () => {
  assert.equal(q.validateQuaternion([1, 0, 0]).reason, 'not_four_components');
  assert.equal(q.validateQuaternion([1, NaN, 0, 0]).reason, 'non_finite');
  assert.equal(q.validateQuaternion([1, Infinity, 0, 0]).reason, 'non_finite');
  assert.equal(q.validateQuaternion([0, 0, 0, 1e-9]).reason, 'near_zero_norm');
  assert.equal(q.validateQuaternion([0.9, 0, 0, 0], { requireUnit: true }).reason, 'not_unit');
  assert.equal(q.validateQuaternion([1, 0, 0, 0], { requireUnit: true }).ok, true);
  assert.throws(() => q.normalizeQuaternion([0, 0, 0, 0]));
});

test('T09 quaternion: component order is ABB [w,x,y,z] and Hamilton product order is b then a', () => {
  // 90° about Z: w = cos45°, z = sin45°. Rotating +X must give +Y.
  const rz = q.quatFromAxisAngle([0, 0, 1], Math.PI / 2);
  closeVec(rz, [Math.SQRT1_2, 0, 0, Math.SQRT1_2]);
  closeVec(q.rotateVector(rz, [1, 0, 0]), [0, 1, 0]);
  const rx = q.quatFromAxisAngle([1, 0, 0], Math.PI / 2);
  // a ⊗ b applies b first: rz ⊗ rx maps +Y → (rx) +Z → (rz) +Z; rx ⊗ rz maps +Y → (rz) −X → (rx) −X.
  closeVec(q.rotateVector(q.quatMultiply(rz, rx), [0, 1, 0]), [0, 0, 1]);
  closeVec(q.rotateVector(q.quatMultiply(rx, rz), [0, 1, 0]), [-1, 0, 0]);
});

test('T09 quaternion: q and −q are the same rotation', () => {
  const a = q.normalizeQuaternion([0.3, -0.2, 0.9, 0.1]);
  assert.ok(q.sameRotation(a, a.map((c) => -c)));
  closeVec(q.rotateVector(a, [0.2, 0.5, -0.7]), q.rotateVector(a.map((c) => -c), [0.2, 0.5, -0.7]));
});

test('T09 quaternion: post-rounding norm stays within the precheck tolerance', () => {
  for (let i = 0; i < 500; i += 1) {
    const raw = [Math.sin(i), Math.cos(i * 1.7), Math.sin(i * 0.3 + 1), Math.cos(i * 2.1 + 0.4)];
    const { norm } = q.roundQuaternion(q.normalizeQuaternion(raw), 9);
    assert.ok(Math.abs(norm - 1) <= q.QUAT_NORM_TOLERANCE, `norm ${norm}`);
  }
});

test('T11 quaternion: Euler ZYX conversion equals Rz·Ry·Rx and the previous csvToRapid formula', () => {
  const legacy = (rx, ry, rz) => {
    const t = (d) => (d * Math.PI) / 180;
    const cx = Math.cos(t(rx) / 2); const sx = Math.sin(t(rx) / 2);
    const cy = Math.cos(t(ry) / 2); const sy = Math.sin(t(ry) / 2);
    const cz = Math.cos(t(rz) / 2); const sz = Math.sin(t(rz) / 2);
    return [cx * cy * cz + sx * sy * sz, sx * cy * cz - cx * sy * sz, cx * sy * cz + sx * cy * sz, cx * cy * sz - sx * sy * cz];
  };
  for (const [rx, ry, rz] of [[30, -20, 75], [90, 0, -90], [0, 0, 0], [-170, 45, 10]]) {
    closeVec(eulerZyxDegToQuaternion(rx, ry, rz), legacy(rx, ry, rz), 1e-12);
  }
});
