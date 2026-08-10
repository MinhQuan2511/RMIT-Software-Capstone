/**
 * Camera Depth ASCII Grid Parser
 * Parses 'CamerDepth.txt' space/tab/comma-delimited ASCII matrix into a 2D numerical array.
 */
function parseCameraDepthGrid(text) {
  if (!text || typeof text !== 'string') {
    return [];
  }

  const lines = text.split(/\r?\n/);
  const depthGrid = [];

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#') || trimmed.startsWith('//')) {
      continue;
    }

    // Split by spaces, tabs, or commas
    const rowValues = trimmed
      .split(/[\s,]+/)
      .map((val) => parseFloat(val))
      .filter((val) => !isNaN(val));

    if (rowValues.length > 0) {
      depthGrid.push(rowValues);
    }
  }

  return depthGrid;
}

module.exports = {
  parseCameraDepthGrid
};
