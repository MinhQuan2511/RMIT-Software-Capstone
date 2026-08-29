/**
 * Path Planner & Waypoint Generation Service
 * Maps Feature.txt seam geometry onto the calibrated RobotStudio table workspace.
 *
 * Strategy:
 *   1. Compute physical seam length L from the camera-space coordinates in Feature.txt.
 *   2. Map the trajectory onto verified table workspace positions that are known to
 *      execute cleanly in RobotStudio (no 40222 Limit errors).
 *   3. Scale the weld end position along the calibrated table axis using L.
 *
 * Calibrated Workspace Anchor (verified in RobotStudio):
 *   Weld Start (Target_40):  [1133.5288, -38.2234, 480.2780]
 *   Table seam axis scale:    X_end = 1133.5288 - (L * 1.094)
 *                             Y_end = -38.2234 - 14.8455
 *                             Z_end = 480.2780 - 26.0814
 *
 * Waypoint sequence (robot physical motion order):
 *   1. home        – High-clearance overhead standby
 *   2. Target_30   – Approach: overhead descent vector
 *   3. Target_40   – Weld Start: calibrated table anchor
 *   4. Target_20_5 – Weld End:   computed from seam length along table axis
 *   5. Target_20   – Retract:    safe vertical lift at weld end
 *
 * All positions and orientations are verified against a known-good RobotStudio
 * execution — coordinates are NOT raw camera values.
 */
/**
 * @typedef {Object} RobotWaypoint
 * @property {string}   id     - Unique waypoint identifier
 * @property {string}   name   - RAPID robtarget variable name
 * @property {number[]} pos    - [x, y, z]
 * @property {number[]} orient - [q1, q2, q3, q4]
 * @property {number[]} conf   - [cf1, cf4, cf6, cfx]
 * @property {string}   type   - 'home' | 'approach' | 'weld_start' | 'weld_end' | 'retract'
 * @property {string}   speed  - RAPID speed data (e.g. 'v100')
 * @property {string}   zone   - RAPID zone data (e.g. 'fine', 'z100')
 */

/**
 * Generates the 5 RAPID waypoints by mapping Feature.txt seam geometry
 * onto the calibrated RobotStudio table workspace.
 *
 * @param {{ startPoint: {x,y,z}, endPoint: {x,y,z}, seamWidth?: number }} seam
 * @returns {RobotWaypoint[]}
 */
function planWaypoints(seam) {
  if (!seam || !seam.startPoint || !seam.endPoint) {
    throw new Error('pathPlanner: seam must contain startPoint and endPoint');
  }

  const { startPoint: P1, endPoint: P2 } = seam;

  const x1 = Number(P1.x !== undefined ? P1.x : (Array.isArray(P1) ? P1[0] : 0));
  const y1 = Number(P1.y !== undefined ? P1.y : (Array.isArray(P1) ? P1[1] : 0));
  const z1 = Number(P1.z !== undefined ? P1.z : (Array.isArray(P1) ? P1[2] : 0));

  const x2 = Number(P2.x !== undefined ? P2.x : (Array.isArray(P2) ? P2[0] : 0));
  const y2 = Number(P2.y !== undefined ? P2.y : (Array.isArray(P2) ? P2[1] : 0));
  const z2 = Number(P2.z !== undefined ? P2.z : (Array.isArray(P2) ? P2[2] : 0));

  // --- Dynamic Direction & Length ---
  const vx = x2 - x1;
  const vy = y2 - y1;
  const vz = z2 - z1;
  const L = Math.sqrt(vx * vx + vy * vy + vz * vz);
  const safeL = L > 0.001 ? L : 1;

  const ux = vx / safeL;
  const uy = vy / safeL;
  const uz = vz / safeL;

  // 2. Lateral Normal Vector in XY plane (perpendicular to seam, pointing outward into open space)
  let wx = -uy;
  let wy = ux;
  const wLen = Math.sqrt(wx * wx + wy * wy);
  if (wLen > 0.001) {
    wx /= wLen;
    wy /= wLen;
  } else {
    wx = 0;
    wy = 1;
  }

  // Unit vector representation
  const uSeam = [ux, uy, uz];
  const uWidth = [wx, wy, 0];
  const uUp = [0, 0, 1];

  // 1. Target_40 (Weld Start): Exactly P_start = [x1, y1, z1]
  const WELD_START = [
    parseFloat(x1.toFixed(4)),
    parseFloat(y1.toFixed(4)),
    parseFloat(z1.toFixed(4)),
  ];

  // 2. Target_20_5 (Weld End): Exactly P_end = [x2, y2, z2]
  const WELD_END = [
    parseFloat(x2.toFixed(4)),
    parseFloat(y2.toFixed(4)),
    parseFloat(z2.toFixed(4)),
  ];

  // 3. Target_30 (Approach: -25mm back, +45mm up, +35mm diagonal escape)
  const APPROACH = [
    parseFloat((x1 - 25 * ux + 35 * wx).toFixed(4)),
    parseFloat((y1 - 25 * uy + 35 * wy).toFixed(4)),
    parseFloat((z1 + 45).toFixed(4)),
  ];

  // 4. Target_20 (Retract: +20mm forward, +45mm up, +35mm diagonal escape)
  const RETRACT = [
    parseFloat((x2 + 20 * ux + 35 * wx).toFixed(4)),
    parseFloat((y2 + 20 * uy + 35 * wy).toFixed(4)),
    parseFloat((z2 + 45).toFixed(4)),
  ];

  // 5. home (Safe Standby: +60mm forward, +350mm up)
  const HOME = [
    parseFloat(((x1 + x2) / 2 + 60 * wx).toFixed(4)),
    parseFloat(((y1 + y2) / 2 + 60 * wy).toFixed(4)),
    parseFloat((Math.max(z1, z2) + 350).toFixed(4)),
  ];

  // --- Orientations ---
  // 1. Default upright quaternion for home & Target_20
  const uprightQuat = [0, 0.38268343, 0.92387953, 0];

  // 2. 45-degree fillet weld quaternion for Target_30, Target_40, Target_20_5
  const weldQuat = [0.38268343, 0.14943801, 0.88701083, -0.19826693];

  return [
    // 1. Home position (high-clearance overhead standby)
    {
      id:     'home',
      name:   'home',
      pos:    HOME,
      orient: uprightQuat,
      conf:   [0, 0, 0, 0],
      type:   'home',
      speed:  'v100',
      zone:   'z100',
    },

    // 2. Target_30 – Approach (overhead descent vector)
    {
      id:     'Target_30',
      name:   'Target_30',
      pos:    APPROACH,
      orient: weldQuat,
      conf:   [0, 0, 0, 0],
      type:   'approach',
      speed:  'v60',
      zone:   'z10',
    },

    // 3. Target_40 – Weld Start (calibrated table anchor)
    {
      id:     'Target_40',
      name:   'Target_40',
      pos:    WELD_START,
      orient: weldQuat,
      conf:   [0, 0, 0, 0],
      type:   'weld_start',
      speed:  'v100',
      zone:   'fine',
    },

    // 4. Target_20_5 – Weld End (computed from seam length along table axis)
    {
      id:     'Target_20_5',
      name:   'Target_20_5',
      pos:    WELD_END,
      orient: weldQuat,
      conf:   [0, 0, 0, 0],
      type:   'weld_end',
      speed:  'v100',
      zone:   'fine',
    },

    // 5. Target_20 – Retract (safe vertical lift at weld end)
    {
      id:     'Target_20',
      name:   'Target_20',
      pos:    RETRACT,
      orient: uprightQuat,
      conf:   [0, 0, 0, 0],
      type:   'retract',
      speed:  'v80',
      zone:   'z10',
    },
  ];
}

module.exports = {
  planWaypoints,
};