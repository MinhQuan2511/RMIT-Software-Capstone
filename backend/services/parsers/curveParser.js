/**
 * Feature Curve String Parser
 * Parses 'Feature.txt' containing 'curve:x1,y1,z1,x2,y2,z2,width'
 * Extracts startPoint, endPoint, and seamWidth for direct RAPID generation.
 *
 * Coordinates from Feature.txt are already in the physical robot workspace.
 * No additional coordinate transformations are needed.
 */

/**
 * Parses a Feature.txt curve line into a structured weld seam descriptor.
 * Expected format: curve:x1,y1,z1,x2,y2,z2,width
 *
 * @param {string} text - Raw text content of Feature.txt
 * @returns {{ startPoint: {x,y,z}, endPoint: {x,y,z}, seamWidth: number } | null}
 */
function parseFeatureCurve(text) {
  if (!text || typeof text !== 'string') {
    return null;
  }

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
  const numberMatches = contentMatch[1].match(/-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?/g);
  if (!numberMatches || numberMatches.length < 7) {
    console.warn(
      `curveParser: Expected at least 7 values (x1,y1,z1,x2,y2,z2,width), got ${
        numberMatches ? numberMatches.length : 0
      }`
    );
    return null;
  }

  const nums = numberMatches.map(Number);

  return {
    startPoint: { x: nums[0], y: nums[1], z: nums[2] },
    endPoint:   { x: nums[3], y: nums[4], z: nums[5] },
    seamWidth:  nums[6],
  };
}

module.exports = {
  parseFeatureCurve,
};
