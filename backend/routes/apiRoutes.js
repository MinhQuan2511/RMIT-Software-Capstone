const express = require('express');
const router = express.Router();
const fs = require('fs');
const path = require('path');
const multer = require('multer');
const { exec } = require('child_process');
const { transformPoints } = require('../services/kinematics/matrixTransform');
const { planTrajectory } = require('../services/kinematics/pathPlanner');
const { computePathQuaternions } = require('../services/kinematics/quaternionMath');

const uploadsDir = path.join(__dirname, '../uploads');
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}

// Multer disk storage configuration
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadsDir),
  filename: (req, file, cb) => cb(null, file.originalname),
});
const upload = multer({ storage });

/**
 * Helper: Find latest .txt file containing curve coordinates
 */
function findLatestFeatureFile(dir) {
  if (!fs.existsSync(dir)) return null;
  const files = fs.readdirSync(dir);
  const txtFiles = files
    .filter((f) => f.endsWith('.txt'))
    .map((f) => ({ name: f, path: path.join(dir, f), mtime: fs.statSync(path.join(dir, f)).mtime }))
    .sort((a, b) => b.mtime - a.mtime);

  for (const file of txtFiles) {
    const content = fs.readFileSync(file.path, 'utf-8');
    if (content.includes('curve:')) return file.path;
  }
  return null;
}

/**
 * Helper: Find latest .yaml file containing hand-eye matrix
 */
function findLatestYamlFile(dir) {
  if (!fs.existsSync(dir)) return null;
  const files = fs.readdirSync(dir);
  const yamlFiles = files
    .filter((f) => f.endsWith('.yaml') || f.endsWith('.yml'))
    .map((f) => ({ name: f, path: path.join(dir, f), mtime: fs.statSync(path.join(dir, f)).mtime }))
    .sort((a, b) => b.mtime - a.mtime);

  for (const file of yamlFiles) {
    const content = fs.readFileSync(file.path, 'utf-8');
    if (content.includes('handEyeMatrix') || content.includes('data:')) return file.path;
  }
  return null;
}

/**
 * Helper: Parse 4x4 matrix from YAML file
 */
function parseYamlMatrix(yamlPath) {
  if (!yamlPath || !fs.existsSync(yamlPath)) return null;
  try {
    const content = fs.readFileSync(yamlPath, 'utf-8');
    const match = content.match(/data:\s*\[([\s\S]*?)\]/);
    if (match && match[1]) {
      const numbers = match[1]
        .trim()
        .split(/[\s,]+/)
        .map((v) => parseFloat(v))
        .filter((v) => !isNaN(v));
      if (numbers.length === 16) {
        return [
          numbers.slice(0, 4),
          numbers.slice(4, 8),
          numbers.slice(8, 12),
          numbers.slice(12, 16),
        ];
      }
    }
  } catch (err) {
    console.error('YAML matrix parse error:', err.message);
  }
  return null;
}

/**
 * Helper: Parse 3D curve points from text file
 */
function parseFeaturePoints(featurePath) {
  if (!featurePath || !fs.existsSync(featurePath)) return [];
  try {
    const content = fs.readFileSync(featurePath, 'utf-8');
    const line = content.split('\n').find((l) => l.trim().startsWith('curve:'));
    if (line) {
      const rawCoords = line.replace('curve:', '').trim().split(',').map((v) => parseFloat(v));
      const points = [];
      for (let i = 0; i + 2 < rawCoords.length; i += 3) {
        if (!isNaN(rawCoords[i]) && !isNaN(rawCoords[i + 1]) && !isNaN(rawCoords[i + 2])) {
          points.push({ x: rawCoords[i], y: rawCoords[i + 1], z: rawCoords[i + 2] });
        }
      }
      return points;
    }
  } catch (err) {
    console.error('Feature points parse error:', err.message);
  }
  return [];
}

/**
 * Helper: Generate ABB RAPID code string
 */
function generateRapidCode(targets) {
  let code = `MODULE WeldModule\n`;
  code += `  !***********************************************************\n`;
  code += `  ! Module:      WeldModule\n`;
  code += `  ! Description: Automatically generated weld trajectory\n`;
  code += `  ! Generated:   ${new Date().toISOString()}\n`;
  code += `  !***********************************************************\n\n`;

  code += `  CONST robtarget p_home:=[[1178.89,0,809.42],[0.069756,0,0.997564,0],[0,0,0,0],[9E9,9E9,9E9,9E9,9E9,9E9]];\n\n`;

  targets.forEach((t) => {
    const q = t.q || [1, 0, 0, 0];
    code += `  CONST robtarget ${t.name}:=[[${t.x.toFixed(4)},${t.y.toFixed(4)},${t.z.toFixed(4)}],[${q[0].toFixed(6)},${q[1].toFixed(6)},${q[2].toFixed(6)},${q[3].toFixed(6)}],[0,0,0,0],[9E9,9E9,9E9,9E9,9E9,9E9]];\n`;
  });

  code += `\n  PROC main()\n`;
  code += `    MoveJ p_home,v500,fine,tool0\\WObj:=wobj0;\n\n`;

  targets.forEach((t) => {
    if (t.type === 'approach') {
      code += `    MoveJ ${t.name},v200,z50,tool0\\WObj:=wobj0;\n`;
    } else if (t.type === 'weld') {
      code += `    MoveL ${t.name},v100,fine,tool0\\WObj:=wobj0;\n`;
    } else if (t.type === 'retract') {
      code += `    MoveJ ${t.name},v200,fine,tool0\\WObj:=wobj0;\n`;
    }
  });

  code += `\n    MoveJ p_home,v500,fine,tool0\\WObj:=wobj0;\n`;
  code += `  ENDPROC\n`;
  code += `ENDMODULE\n`;

  return code;
}

// Ingest files endpoints (Both GET and POST to prevent 404)
const handleIngest = (req, res) => {
  const uploadedFiles = req.files || [];
  const existingFiles = fs.readdirSync(uploadsDir);
  return res.json({
    success: true,
    message: `Uploaded ${uploadedFiles.length} file(s). Total in staging: ${existingFiles.length}`,
    data: { filesFound: existingFiles },
  });
};
router.post('/ingest-files', upload.array('files'), handleIngest);
router.get('/ingest-files', handleIngest);

// Process pipeline endpoints (Both GET and POST)
const handlePipeline = (req, res) => {
  try {
    const featurePath = findLatestFeatureFile(uploadsDir);
    const yamlPath = findLatestYamlFile(uploadsDir);

    const matrix = parseYamlMatrix(yamlPath);
    const camPoints = parseFeaturePoints(featurePath);

    let robotPoints = [];
    if (camPoints.length > 0) {
      robotPoints = transformPoints(camPoints, matrix);
    } else {
      robotPoints = [
        { x: 673.9846, y: 1349.3547, z: 1173.0933 },
        { x: 552.5436, y: 1348.2062, z: 1372.8194 },
      ];
    }

    const plannedWaypoints = planTrajectory(robotPoints, { zLiftMm: 50 });
    const quaternions = computePathQuaternions(plannedWaypoints, 45);

    const robotTargets = plannedWaypoints.map((pt, i) => ({
      ...pt,
      q: quaternions[i] || [1, 0, 0, 0],
    }));

    const rapidCode = generateRapidCode(robotTargets);
    fs.writeFileSync(path.join(uploadsDir, 'latest_rapid.mod'), rapidCode, 'utf-8');

    return res.json({
      success: true,
      pipeline: {
        sourceFile: featurePath ? path.basename(featurePath) : 'Default_Fallback.txt',
        totalPoints: robotTargets.length,
        matrixStatus: matrix ? `Mapped via ${path.basename(yamlPath)} (4x4 Matrix Applied)` : 'Default Identity Matrix Applied',
        robotTargets,
        rapidCode,
      },
    });
  } catch (err) {
    console.error('Process pipeline error:', err);
    return res.status(500).json({ success: false, error: err.message });
  }
};
router.post('/process-pipeline', handlePipeline);
router.get('/process-pipeline', handlePipeline);

// Get compiled RAPID code
router.get('/rapid-code', (req, res) => {
  try {
    const rapidPath = path.join(uploadsDir, 'latest_rapid.mod');
    if (fs.existsSync(rapidPath)) {
      const rapidCode = fs.readFileSync(rapidPath, 'utf-8');
      return res.json({ success: true, rapidCode });
    }
  } catch (err) {
    console.error('Get RAPID code error:', err.message);
  }
  return handlePipeline(req, res);
});

// Launch RobotStudio
router.post('/launch-robotstudio', (req, res) => {
  try {
    const { code, fileName = 'WeldModule.mod' } = req.body || {};
    if (!code) return res.status(400).json({ success: false, error: 'No RAPID code provided.' });

    const filePath = path.join(uploadsDir, fileName);
    fs.writeFileSync(filePath, code, 'utf-8');

    const possiblePaths = [
      `C:\\Program Files (x86)\\ABB\\RobotStudio 2025\\Bin\\RobotStudio.exe`,
      `C:\\Program Files (x86)\\ABB\\RobotStudio 2026\\Bin\\RobotStudio.exe`,
      `C:\\Program Files\\ABB\\RobotStudio 2025\\Bin\\RobotStudio.exe`,
      `C:\\Program Files\\ABB\\RobotStudio 2024\\Bin\\RobotStudio.exe`,
      `C:\\Program Files (x86)\\ABB\\RobotStudio\\Bin\\RobotStudio.exe`,
    ];

    const robotStudioExe = possiblePaths.find((p) => fs.existsSync(p));

    if (robotStudioExe) {
      exec(`"${robotStudioExe}" "${filePath}"`, (err) => {
        if (err) console.warn('Error executing RobotStudio:', err.message);
      });
      return res.json({ success: true, launched: true });
    }

    return res.json({ success: false, launched: false });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;