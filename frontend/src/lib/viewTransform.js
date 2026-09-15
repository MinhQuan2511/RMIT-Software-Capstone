/**
 * Robot base frame → Three.js view frame.
 *
 * Robot: X forward, Y left, Z up (millimetres). View: Y up. The mapping
 * [x, y, z] → [x, z, −y] is a proper rotation of −90° about X, so it is applied
 * identically to positions, directions and orientations.
 *
 * Quaternions are ABB order [w, x, y, z]. A robtarget orientation q maps tool
 * frame vectors to robot base vectors. An object whose local axes ARE the tool
 * axes (the tool-axis indicator) therefore has view rotation M·q.
 *
 * Torch mesh convention: nozzle tip at the local origin, body along local +Y.
 * The tool +Z axis (the direction the torch points, from body to tip) is mesh
 * −Y; tool +X is mesh +X; tool +Y is mesh +Z. So the mesh rotation is M·q·C
 * with C = −90° about X.
 */

const H = Math.SQRT1_2;

/** Rotation −90° about X as [w,x,y,z]. */
export const ROBOT_TO_VIEW_Q = Object.freeze([H, -H, 0, 0]);
/** Tool frame expressed in torch-mesh axes, also −90° about X. */
export const MESH_TO_TOOL_Q = Object.freeze([H, -H, 0, 0]);

export function quatMul(a, b) {
  const [aw, ax, ay, az] = a;
  const [bw, bx, by, bz] = b;
  return [
    aw * bw - ax * bx - ay * by - az * bz,
    aw * bx + ax * bw + ay * bz - az * by,
    aw * by - ax * bz + ay * bw + az * bx,
    aw * bz + ax * by - ay * bx + az * bw,
  ];
}

export const quatConj = (q) => [q[0], -q[1], -q[2], -q[3]];

export function quatNormalize(q) {
  const n = Math.hypot(q[0], q[1], q[2], q[3]);
  if (!(n > 1e-9) || !Number.isFinite(n)) throw new Error("viewTransform: invalid quaternion");
  return [q[0] / n, q[1] / n, q[2] / n, q[3] / n];
}

export function rotateVec(q, v) {
  const u = quatNormalize(q);
  const r = quatMul(quatMul(u, [0, v[0], v[1], v[2]]), quatConj(u));
  return [r[1], r[2], r[3]];
}

export const robotToViewPosition = (p) => [p[0], p[2], -p[1]];
export const robotToViewDirection = robotToViewPosition;

/** View rotation of an object whose local axes are the tool axes. */
export const toolFrameViewQuaternion = (q) => quatNormalize(quatMul(ROBOT_TO_VIEW_Q, quatNormalize(q)));

/** View rotation of the torch mesh for robtarget orientation q. */
export const torchMeshViewQuaternion = (q) => quatNormalize(quatMul(quatMul(ROBOT_TO_VIEW_Q, quatNormalize(q)), MESH_TO_TOOL_Q));

/** ABB [w,x,y,z] → Three.js constructor order (x, y, z, w). */
export const toThreeOrder = (q) => [q[1], q[2], q[3], q[0]];

/** Shortest-path spherical interpolation between unit quaternions. */
export function slerp(a, b, t) {
  const qa = quatNormalize(a);
  let qb = quatNormalize(b);
  let dot = qa[0] * qb[0] + qa[1] * qb[1] + qa[2] * qb[2] + qa[3] * qb[3];
  if (dot < 0) { qb = qb.map((c) => -c); dot = -dot; }
  if (dot > 0.9995) return quatNormalize(qa.map((c, i) => c + t * (qb[i] - c)));
  const theta = Math.acos(Math.min(1, dot));
  const s = Math.sin(theta);
  const wa = Math.sin((1 - t) * theta) / s;
  const wb = Math.sin(t * theta) / s;
  return qa.map((c, i) => wa * c + wb * qb[i]);
}
