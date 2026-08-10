const { multiply, matrix } = require('mathjs');

/**
 * Homogeneous 4x4 Hand-Eye Matrix Transformation Module
 * Applies T_handeye to transform 3D points from Camera Frame (P_camera) to Robot Base Frame (P_robot)
 * Formula: P_robot = T_handeye * P_camera
 */

/**
 * Transforms a single 3D point {x, y, z} using 4x4 matrix T
 */
function transformPoint(point, T) {
  const { x, y, z } = point;
  const pCam = [x, y, z, 1.0];

  // If T is 4x4 array
  const xRobot = T[0][0] * pCam[0] + T[0][1] * pCam[1] + T[0][2] * pCam[2] + T[0][3] * pCam[3];
  const yRobot = T[1][0] * pCam[0] + T[1][1] * pCam[1] + T[1][2] * pCam[2] + T[1][3] * pCam[3];
  const zRobot = T[2][0] * pCam[0] + T[2][1] * pCam[1] + T[2][2] * pCam[2] + T[2][3] * pCam[3];
  const wRobot = T[3][0] * pCam[0] + T[3][1] * pCam[1] + T[3][2] * pCam[2] + T[3][3] * pCam[3];

  const scale = wRobot !== 0 ? wRobot : 1.0;

  return {
    x: parseFloat((xRobot / scale).toFixed(4)),
    y: parseFloat((yRobot / scale).toFixed(4)),
    z: parseFloat((zRobot / scale).toFixed(4)),
  };
}

/**
 * Transforms an array of 3D points [{x, y, z}, ...] using 4x4 Hand-Eye Matrix T
 */
function transformPoints(points, T) {
  if (!Array.isArray(points)) return [];
  
  // Default to identity matrix if T is missing/invalid
  const handEyeMatrix = (Array.isArray(T) && T.length === 4) ? T : [
    [1, 0, 0, 0],
    [0, 1, 0, 0],
    [0, 0, 1, 0],
    [0, 0, 0, 1]
  ];

  return points.map((p) => transformPoint(p, handEyeMatrix));
}

module.exports = {
  transformPoint,
  transformPoints
};
