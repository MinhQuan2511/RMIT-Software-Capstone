const yaml = require('js-yaml');

/**
 * OpenCV YAML Hand-Eye Matrix Parser
 * Parses OpenCV YAML file format (handeye_result.yaml)
 * Extracts the 16-element 'data' array and reshapes it into a 4x4 Float64 Matrix.
 */
function parseHandEyeYaml(yamlText) {
  if (!yamlText || typeof yamlText !== 'string') {
    throw new Error("Invalid or empty YAML content provided");
  }

  // Pre-process text to strip OpenCV specific YAML directives and tags if present
  let cleanText = yamlText
    .replace(/%YAML:\d+\.\d+/g, '')
    .replace(/!!opencv-matrix/g, '')
    .trim();

  let parsedDoc;
  try {
    // Attempt standard js-yaml load with DEFAULT_SCHEMA
    parsedDoc = yaml.load(cleanText, { schema: yaml.DEFAULT_SCHEMA });
  } catch (e) {
    // Fallback: Use custom regex extraction for 'data' array
    const dataMatch = yamlText.match(/data:\s*\[([^\]]+)\]/s) || yamlText.match(/data:\s*\n((?:\s*-[^\n]+\n?)+)/s);
    if (dataMatch) {
      const rawDataString = dataMatch[1];
      const numbers = rawDataString
        .replace(/[\s\n\r\-]/g, ' ')
        .split(',')
        .map((s) => parseFloat(s.trim()))
        .filter((n) => !isNaN(n));
      if (numbers.length >= 16) {
        return reshapeTo4x4Matrix(numbers.slice(0, 16));
      }
    }
    throw new Error(`Failed to parse OpenCV YAML: ${e.message}`);
  }

  // Find matrix object inside parsed yaml
  let dataArray = null;
  if (parsedDoc) {
    if (Array.isArray(parsedDoc.data)) {
      dataArray = parsedDoc.data;
    } else if (parsedDoc.HandEyeMatrix && Array.isArray(parsedDoc.HandEyeMatrix.data)) {
      dataArray = parsedDoc.HandEyeMatrix.data;
    } else if (parsedDoc.handeye_result && Array.isArray(parsedDoc.handeye_result.data)) {
      dataArray = parsedDoc.handeye_result.data;
    } else {
      // Search recursively for 'data' array
      for (const key of Object.keys(parsedDoc)) {
        if (parsedDoc[key] && Array.isArray(parsedDoc[key].data)) {
          dataArray = parsedDoc[key].data;
          break;
        }
      }
    }
  }

  if (!dataArray || dataArray.length < 16) {
    // Check if raw numbers exist anywhere in parsed document
    throw new Error("YAML missing valid 16-element 'data' array for 4x4 hand-eye transformation matrix");
  }

  const numericArray = dataArray.map((v) => Float64Array.from([parseFloat(v)])[0]);
  return reshapeTo4x4Matrix(numericArray.slice(0, 16));
}

function reshapeTo4x4Matrix(elements) {
  const matrix = [];
  for (let i = 0; i < 4; i++) {
    const row = [];
    for (let j = 0; j < 4; j++) {
      row.push(elements[i * 4 + j]);
    }
    matrix.push(row);
  }
  return matrix;
}

module.exports = {
  parseHandEyeYaml,
  reshapeTo4x4Matrix
};
