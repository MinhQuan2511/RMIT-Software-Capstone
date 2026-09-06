/**
 * Feature Curve String Parser
 * Parses 'Feature.txt' into a structured weld seam descriptor.
 *
 * Two formats are accepted:
 *
 *   Straight seam (legacy, unchanged):
 *     curve:x1,y1,z1,x2,y2,z2,width
 *
 *   Curved seam (labelled keys), three points ON the arc:
 *     type: arc
 *     arc_start:  x, y, z
 *     arc_via:    x, y, z
 *     arc_end:    x, y, z
 *     seam_width: 5.54
 *
 * A file carrying only a 'curve:' line stays a straight seam and parses exactly
 * as it always did. A file carrying the three arc keys gains an optional
 * viaPoint, which is what tells the path planner to plan a curved motion.
 *
 * Coordinates from Feature.txt are already in the physical robot workspace.
 * No additional coordinate transformations are needed.
 */

const DEFAULT_SEAM_WIDTH = 5.54;

/** Pulls every number out of a string (negative, decimal, scientific). */
function extractNumbers(text) {
  const matches = text.match(/-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?/g);
  return matches ? matches.map(Number) : [];
}

/**
 * Reads a `key: x, y, z` line and returns the point it names.
 * @returns {{x:number,y:number,z:number} | null}
 */
function readPointKey(text, key) {
  const line = text
    .split(/\r?\n/)
    .find((l) => l.trim().toLowerCase().startsWith(`${key}:`));

  if (!line) return null;

  const afterKey = line.slice(line.indexOf(':') + 1);
  const nums = extractNumbers(afterKey);
  if (nums.length < 3 || nums.slice(0, 3).some((n) => !Number.isFinite(n))) {
    console.warn(`curveParser: '${key}' needs 3 coordinates, got ${nums.length}`);
    return null;
  }

  return { x: nums[0], y: nums[1], z: nums[2] };
}

/** Reads a scalar `key: value` line. */
function readNumberKey(text, key) {
  const line = text
    .split(/\r?\n/)
    .find((l) => l.trim().toLowerCase().startsWith(`${key}:`));

  if (!line) return null;

  const nums = extractNumbers(line.slice(line.indexOf(':') + 1));
  return nums.length > 0 && Number.isFinite(nums[0]) ? nums[0] : null;
}

/**
 * Parses the legacy single-line straight seam format.
 * Expected format: curve:x1,y1,z1,x2,y2,z2,width
 */
function parseStraightSeam(text) {
  // Find the first line starting with "curve:"
  const curveLines = text
    .split(/\r?\n/)
    .filter((line) => line.trim().toLowerCase().startsWith('curve:'));

  if (curveLines.length === 0) {
    return null;
  }

  const line = curveLines[0];

  // Extract everything after 'curve:'
  const contentMatch = line.match(/curve:\s*(.*)/i);
  if (!contentMatch || !contentMatch[1]) {
    return null;
  }

  // Parse all numeric values (supports negative, decimal, scientific notation)
  const nums = extractNumbers(contentMatch[1]);
  if (nums.length < 7) {
    console.warn(
      `curveParser: Expected at least 7 values (x1,y1,z1,x2,y2,z2,width), got ${nums.length}`
    );
    return null;
  }

  return {
    startPoint: { x: nums[0], y: nums[1], z: nums[2] },
    endPoint:   { x: nums[3], y: nums[4], z: nums[5] },
    seamWidth:  nums[6],
    isArc:      false,
  };
}

/**
 * Parses the labelled three-point arc format.
 * All three points must be present and well formed; a partial arc block is
 * reported and rejected rather than being silently downgraded, so a typo in a
 * key name does not quietly weld a straight line through a curved workpiece.
 */
function parseArcSeam(text) {
  const startPoint = readPointKey(text, 'arc_start');
  const viaPoint = readPointKey(text, 'arc_via');
  const endPoint = readPointKey(text, 'arc_end');

  const present = [startPoint, viaPoint, endPoint].filter(Boolean).length;
  if (present === 0) return null;

  if (present < 3) {
    console.warn(
      'curveParser: incomplete arc block — arc_start, arc_via and arc_end are all required'
    );
    return null;
  }

  const seamWidth = readNumberKey(text, 'seam_width');

  return {
    startPoint,
    viaPoint,
    endPoint,
    seamWidth: seamWidth !== null ? seamWidth : DEFAULT_SEAM_WIDTH,
    isArc: true,
  };
}

/**
 * Parses a Feature.txt into a structured weld seam descriptor.
 *
 * @param {string} text - Raw text content of Feature.txt
 * @returns {{
 *   startPoint: {x,y,z},
 *   endPoint: {x,y,z},
 *   viaPoint?: {x,y,z},
 *   seamWidth: number,
 *   isArc: boolean
 * } | null}
 */
function parseFeatureCurve(text) {
  if (!text || typeof text !== 'string') {
    return null;
  }

  // The arc format is checked first so that a file carrying both an arc block
  // and a legacy curve: line is treated as the arc it declares itself to be.
  const arc = parseArcSeam(text);
  if (arc) return arc;

  return parseStraightSeam(text);
}

module.exports = {
  parseFeatureCurve,
};
