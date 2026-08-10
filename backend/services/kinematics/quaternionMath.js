/**
 * Torch Orientation & Quaternion Math Module
 * Converts torch tilt angles and path tangent vectors into ABB RAPID Quaternions [q1, q2, q3, q4]
 * In ABB RAPID: q1 = scalar (qw), q2 = qx, q3 = qy, q4 = qz
 */

/**
 * Converts Euler angles (in degrees) to ABB RAPID Quaternion [q1, q2, q3, q4]
 */
function eulerToQuaternion(rxDeg, ryDeg, rzDeg) {
  const toRad = (deg) => (deg * Math.PI) / 180;
  const rx = toRad(rxDeg);
  const ry = toRad(ryDeg);
  const rz = toRad(rzDeg);

  const cx = Math.cos(rx / 2);
  const sx = Math.sin(rx / 2);
  const cy = Math.cos(ry / 2);
  const sy = Math.sin(ry / 2);
  const cz = Math.cos(rz / 2);
  const sz = Math.sin(rz / 2);

  const qw = cx * cy * cz + sx * sy * sz;
  const qx = sx * cy * cz - cx * sy * sz;
  const qy = cx * sy * cz + sx * cy * sz;
  const qz = cx * cy * sz - sx * sy * cz;

  // Normalize
  const norm = Math.sqrt(qw * qw + qx * qx + qy * qy + qz * qz) || 1.0;

  return [
    parseFloat((qw / norm).toFixed(9)),
    parseFloat((qx / norm).toFixed(9)),
    parseFloat((qy / norm).toFixed(9)),
    parseFloat((qz / norm).toFixed(9)),
  ];
}

/**
 * Calculates ABB Quaternions for a sequence of 3D points based on path tangents and torch tilt angle (degrees)
 */
function computePathQuaternions(points, torchAngleDeg = 45) {
  if (!Array.isArray(points) || points.length === 0) return [];

  const quaternions = [];

  for (let i = 0; i < points.length; i++) {
    let dx = 1, dy = 0, dz = 0;

    if (i < points.length - 1) {
      dx = points[i + 1].x - points[i].x;
      dy = points[i + 1].y - points[i].y;
      dz = points[i + 1].z - points[i].z;
    } else if (i > 0) {
      dx = points[i].x - points[i - 1].x;
      dy = points[i].y - points[i - 1].y;
      dz = points[i].z - points[i - 1].z;
    }

    const len = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1.0;
    const tx = dx / len;
    const ty = dy / len;
    const tz = dz / len;

    // Calculate heading (yaw) and pitch from tangent
    const yaw = Math.atan2(ty, tx) * (180 / Math.PI);
    const pitch = Math.atan2(-tz, Math.sqrt(tx * tx + ty * ty)) * (180 / Math.PI);
    const roll = torchAngleDeg; // Applied torch angle

    const q = eulerToQuaternion(roll, pitch, yaw);
    quaternions.push(q);
  }

  return quaternions;
}

module.exports = {
  eulerToQuaternion,
  computePathQuaternions
};
