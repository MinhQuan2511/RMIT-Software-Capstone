/**
 * Path Planner & Waypoint Generation Service
 * Handles safe approach vector and strict vertical +Z retract.
 */

function planTrajectory(points, options = {}) {
  if (!Array.isArray(points) || points.length === 0) {
    return [];
  }

  const {
    approachOffsetMm = 50,
    zLiftMm = 50, 
    interpolateStepMm = null
  } = options;

  let path = [...points];

  if (interpolateStepMm && interpolateStepMm > 0) {
    path = interpolatePoints(path, interpolateStepMm);
  }

  const plannedWaypoints = [];

  // 1. Generate Approach Waypoint 
  const startPt = path[0];
  const secondPt = path.length > 1 ? path[1] : { x: startPt.x + 10, y: startPt.y, z: startPt.z };
  
  const dxStart = startPt.x - secondPt.x;
  const dyStart = startPt.y - secondPt.y;
  const lenXYStart = Math.sqrt(dxStart * dxStart + dyStart * dyStart) || 1.0;

  const approachPt = {
    x: parseFloat((startPt.x + (dxStart / lenXYStart) * approachOffsetMm).toFixed(4)),
    y: parseFloat((startPt.y + (dyStart / lenXYStart) * approachOffsetMm).toFixed(4)),
    z: parseFloat((startPt.z + zLiftMm).toFixed(4)), 
    type: 'approach',
    name: 'p_approach'
  };

  plannedWaypoints.push(approachPt);

  // 2. Main Weld Waypoints 
  path.forEach((pt, idx) => {
    plannedWaypoints.push({
      x: pt.x,
      y: pt.y,
      z: pt.z,
      type: 'weld',
      name: `Target_${(idx + 1) * 10}`
    });
  });

  // 3. Generate Retract Waypoint 
  const endPt = path[path.length - 1];

  const retractPt = {
    x: endPt.x, // Giữ nguyên vị trí XY điểm cuối
    y: endPt.y,
    z: parseFloat((endPt.z + zLiftMm).toFixed(4)), 
    type: 'retract',
    name: 'p_retract'
  };

  plannedWaypoints.push(retractPt);

  return plannedWaypoints;
}

function interpolatePoints(points, stepSize) {
  const result = [];
  for (let i = 0; i < points.length - 1; i++) {
    const p1 = points[i];
    const p2 = points[i + 1];
    const dist = Math.sqrt(
      Math.pow(p2.x - p1.x, 2) +
      Math.pow(p2.y - p1.y, 2) +
      Math.pow(p2.z - p1.z, 2)
    );

    result.push(p1);
    if (dist > stepSize) {
      const steps = Math.floor(dist / stepSize);
      for (let s = 1; s < steps; s++) {
        const t = s / steps;
        result.push({
          x: parseFloat((p1.x + t * (p2.x - p1.x)).toFixed(4)),
          y: parseFloat((p1.y + t * (p2.y - p1.y)).toFixed(4)),
          z: parseFloat((p1.z + t * (p2.z - p1.z)).toFixed(4)),
        });
      }
    }
  }
  if (points.length > 0) {
    result.push(points[points.length - 1]);
  }
  return result;
}

module.exports = {
  planTrajectory,
  interpolatePoints
};