/**
 * Path Planner & Waypoint Generation Service
 * Handles interpolation, approach waypoint insertion (offset before start), and retract waypoint insertion (offset after end).
 */

function planTrajectory(points, options = {}) {
  if (!Array.isArray(points) || points.length === 0) {
    return [];
  }

  const {
    approachOffsetMm = 50,
    retractOffsetMm = 50,
    zLiftMm = 30,
    interpolateStepMm = null
  } = options;

  let path = [...points];

  // Optional linear interpolation if step distance requested
  if (interpolateStepMm && interpolateStepMm > 0) {
    path = interpolatePoints(path, interpolateStepMm);
  }

  const plannedWaypoints = [];

  // 1. Generate Approach Waypoint
  const startPt = path[0];
  const secondPt = path.length > 1 ? path[1] : { x: startPt.x + 10, y: startPt.y, z: startPt.z };
  
  // Tangent vector at start
  const dxStart = startPt.x - secondPt.x;
  const dyStart = startPt.y - secondPt.y;
  const dzStart = startPt.z - secondPt.z;
  const lenStart = Math.sqrt(dxStart * dxStart + dyStart * dyStart + dzStart * dzStart) || 1.0;

  const approachPt = {
    x: parseFloat((startPt.x + (dxStart / lenStart) * approachOffsetMm).toFixed(4)),
    y: parseFloat((startPt.y + (dyStart / lenStart) * approachOffsetMm).toFixed(4)),
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
  const prevPt = path.length > 1 ? path[path.length - 2] : { x: endPt.x - 10, y: endPt.y, z: endPt.z };

  const dxEnd = endPt.x - prevPt.x;
  const dyEnd = endPt.y - prevPt.y;
  const dzEnd = endPt.z - prevPt.z;
  const lenEnd = Math.sqrt(dxEnd * dxEnd + dyEnd * dyEnd + dzEnd * dzEnd) || 1.0;

  const retractPt = {
    x: parseFloat((endPt.x + (dxEnd / lenEnd) * retractOffsetMm).toFixed(4)),
    y: parseFloat((endPt.y + (dyEnd / lenEnd) * retractOffsetMm).toFixed(4)),
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
