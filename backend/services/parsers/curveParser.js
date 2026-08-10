/**
 * Feature Curve String Parser
 * Uses Regular Expressions to parse 'Feature.txt' containing 'curve:x1,y1,z1,x2,y2,z2...'
 * Outputs an array of 3D point objects: [{x, y, z}, ...]
 */
function parseFeatureCurve(text) {
  if (!text || typeof text !== 'string') {
    return [];
  }

  const points = [];

  // Match line or substring starting with "curve:" followed by numbers
  const curveLines = text.split(/\r?\n/).filter((line) => line.toLowerCase().includes('curve'));

  if (curveLines.length > 0) {
    for (const line of curveLines) {
      // Extract everything after 'curve:' or 'curve='
      const contentMatch = line.match(/curve[:=]\s*(.*)/i);
      const rawNumbers = contentMatch ? contentMatch[1] : line;
      
      // Find all float numbers (positive/negative, decimal or scientific notation)
      const numberMatches = rawNumbers.match(/-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?/g);
      if (numberMatches) {
        const nums = numberMatches.map(Number);
        for (let i = 0; i + 2 < nums.length; i += 3) {
          points.push({
            x: nums[i],
            y: nums[i + 1],
            z: nums[i + 2],
          });
        }
      }
    }
  } else {
    // General fallback: Extract all triplets from lines containing numbers
    const lines = text.split(/\r?\n/);
    for (const line of lines) {
      const nums = (line.match(/-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?/g) || []).map(Number);
      if (nums.length >= 3) {
        for (let i = 0; i + 2 < nums.length; i += 3) {
          points.push({
            x: nums[i],
            y: nums[i + 1],
            z: nums[i + 2],
          });
        }
      }
    }
  }

  return points;
}

module.exports = {
  parseFeatureCurve
};
