/**
 * Path Planner & Waypoint Generation Service
 * Dynamically computes the 5 motion waypoints from Feature.txt seam geometry.
 *
 * Mathematical basis:
 *   d       = P_end - P_start
 *   L_xy    = sqrt(dx² + dy²)
 *   u_xy    = [dx/L_xy, dy/L_xy]  (unit tangent in XY plane)
 *
 * Waypoint sequence (robot physical motion order):
 *   1. home        – Industrial observation pose: retracted toward robot base, Z_max + 400 mm
 *   2. Target_30   – Approach: back off 40 mm along tangent, lift Z +30 mm
 *   3. Target_40   – Weld Start: exact P_start
 *   4. Target_20_5 – Weld End:   exact P_end
 *   5. Target_20   – Retract:    vertical lift Z +40 mm at P_end
 *
 * All coordinates are used directly — no extra matrix transforms are applied.
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
 * Generates the 5 RAPID waypoints dynamically from a parsed weld seam.
 *
 * @param {{ startPoint: {x,y,z}, endPoint: {x,y,z}, seamWidth?: number }} seam
 * @returns {RobotWaypoint[]}
 */
function planWaypoints(seam) {
  if (!seam || !seam.startPoint || !seam.endPoint) {
    throw new Error('pathPlanner: seam must contain startPoint and endPoint');
  }

  const { startPoint: P1, endPoint: P2 } = seam;

  // --- Direction vector & unit tangent in XY plane ---
  const dx = P2.x - P1.x;
  const dy = P2.y - P1.y;
  const Lxy = Math.sqrt(dx * dx + dy * dy);

  // Guard against degenerate zero-length seam in XY
  let ux = 0;
  let uy = 0;
  if (Lxy > 1e-9) {
    ux = dx / Lxy;
    uy = dy / Lxy;
  }

  // --- Shared orientation for all weld-related targets (verified in RobotStudio) ---
  const weldOrient = [0, 0, 0.965925826, -0.258819045];

  // --- Approach point: back off 40 mm along tangent, lift Z +30 mm ---
  const approachX = P1.x - ux * 40;
  const approachY = P1.y - uy * 40;
  const approachZ = P1.z + 30.0;

  // --- Retract point: vertical lift Z +40 mm at P_end ---
  const retractX = P2.x;
  const retractY = P2.y;
  const retractZ = P2.z + 40.0;

  // --- Industrial observation pose: retracted toward robot base, Z_max + 400 mm ---
  const homeX = (P1.x + P2.x) / 2 - 150;
  const homeY = (P1.y + P2.y) / 2 - 200;
  const homeZ = Math.max(P1.z, P2.z) + 400.0;

  return [
    // 1. Home position (dynamic safe standby above seam)
    {
      id:     'home',
      name:   'home',
      pos:    [homeX, homeY, homeZ],
      orient: [0.069756473, 0, 0.99756405, 0],
      conf:   [0, 0, 0, 0],
      type:   'home',
      speed:  'v100',
      zone:   'z100',
    },

    // 2. Target_30 – Approach (back off 40 mm tangent, +30 mm Z)
    {
      id:     'Target_30',
      name:   'Target_30',
      pos:    [approachX, approachY, approachZ],
      orient: weldOrient,
      conf:   [-1, 0, -1, 0],
      type:   'approach',
      speed:  'v80',
      zone:   'fine',
    },

    // 3. Target_40 – Weld Start (exact P_start)
    {
      id:     'Target_40',
      name:   'Target_40',
      pos:    [P1.x, P1.y, P1.z],
      orient: weldOrient,
      conf:   [0, 0, 0, 0],
      type:   'weld_start',
      speed:  'v100',
      zone:   'fine',
    },

    // 4. Target_20_5 – Weld End (exact P_end)
    {
      id:     'Target_20_5',
      name:   'Target_20_5',
      pos:    [P2.x, P2.y, P2.z],
      orient: weldOrient,
      conf:   [0, -1, 0, 0],
      type:   'weld_end',
      speed:  'v100',
      zone:   'fine',
    },

    // 5. Target_20 – Retract (vertical lift +40 mm at P_end)
    {
      id:     'Target_20',
      name:   'Target_20',
      pos:    [retractX, retractY, retractZ],
      orient: weldOrient,
      conf:   [-1, 0, -1, 0],
      type:   'retract',
      speed:  'v100',
      zone:   'fine',
    },
  ];
}

module.exports = {
  planWaypoints,
};