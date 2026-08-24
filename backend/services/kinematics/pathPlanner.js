/**
 * Path Planner & Waypoint Generation Service
 * Computes the 5 motion waypoints from startPoint and endPoint for ABB RAPID.
 *
 * Waypoint sequence (matches verified RAPID template):
 *   1. home           – Fixed home position
 *   2. Target_40      – Weld Start (startPoint)
 *   3. Target_30      – Approach Point (offset from startPoint)
 *   4. Target_20_5    – Weld End (endPoint)
 *   5. Target_20      – Retract Point (offset from endPoint)
 *
 * All coordinates are used directly — no extra matrix transforms are applied.
 */

/**
 * @typedef {Object} RobotWaypoint
 * @property {string}   name   - RAPID robtarget variable name
 * @property {number[]} pos    - [x, y, z]
 * @property {number[]} orient - [q1, q2, q3, q4]
 * @property {number[]} conf   - [cf1, cf4, cf6, cfx]
 * @property {string}   type   - 'home' | 'weld_start' | 'approach' | 'weld_end' | 'retract'
 */

/**
 * Generates the 5 fixed RAPID waypoints from a parsed weld seam.
 *
 * @param {{ startPoint: {x,y,z}, endPoint: {x,y,z} }} seam
 * @returns {RobotWaypoint[]}
 */
function planWaypoints(seam) {
  if (!seam || !seam.startPoint || !seam.endPoint) {
    throw new Error('pathPlanner: seam must contain startPoint and endPoint');
  }

  const { startPoint, endPoint } = seam;

  // Shared orientation for all weld-related targets (verified in RobotStudio)
  const weldOrient = [0, 0, 0.965925826, -0.258819045];

  return [
    // 1. Home position (fixed)
    {
      name:   'home',
      pos:    [1178.890158094, 0, 809.419411487],
      orient: [0.069756473, 0, 0.99756405, 0],
      conf:   [0, 0, 0, 0],
      type:   'home',
    },

    // 2. Target_40 – Weld Start (at startPoint)
    {
      name:   'Target_40',
      pos:    [startPoint.x, startPoint.y, startPoint.z],
      orient: weldOrient,
      conf:   [0, 0, 0, 0],
      type:   'weld_start',
    },

    // 3. Target_30 – Approach Point (offset from startPoint: Y+10, Z+23.026)
    {
      name:   'Target_30',
      pos:    [startPoint.x, startPoint.y + 10, startPoint.z + 23.026],
      orient: weldOrient,
      conf:   [-1, 0, -1, 0],
      type:   'approach',
    },

    // 4. Target_20_5 – Weld End (at endPoint)
    {
      name:   'Target_20_5',
      pos:    [endPoint.x, endPoint.y, endPoint.z],
      orient: weldOrient,
      conf:   [0, -1, 0, 0],
      type:   'weld_end',
    },

    // 5. Target_20 – Retract Point (offset from endPoint: Y+11, Z+31.936)
    {
      name:   'Target_20',
      pos:    [endPoint.x, endPoint.y + 11, endPoint.z + 31.936],
      orient: weldOrient,
      conf:   [-1, 0, -1, 0],
      type:   'retract',
    },
  ];
}

module.exports = {
  planWaypoints,
};