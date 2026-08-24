const express = require('express');
const router = express.Router();
const fs = require('fs');
const path = require('path');
const multer = require('multer');
const { exec } = require('child_process');
const { parseFeatureCurve } = require('../services/parsers/curveParser');
const { planWaypoints } = require('../services/kinematics/pathPlanner');
const { generateRapidCode } = require('../services/compiler/rapidCompiler');

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

    // --- Step 1: Parse Feature.txt ---
    let seam = null;
    if (featurePath) {
      const content = fs.readFileSync(featurePath, 'utf-8');
      seam = parseFeatureCurve(content);
    }

    // Fallback defaults if no valid Feature.txt was found
    if (!seam) {
      console.warn('Pipeline: No valid Feature.txt found, using fallback coordinates.');
      seam = {
        startPoint: { x: 673.9846, y: 1349.3547, z: 1173.0933 },
        endPoint:   { x: 552.5436, y: 1348.2062, z: 1372.8194 },
        seamWidth:  5,
      };
    }

    // --- Step 2: Plan waypoints (no matrix transform needed) ---
    const waypoints = planWaypoints(seam);

    // --- Step 3: Generate RAPID code ---
    const rapidCode = generateRapidCode(waypoints);
    fs.writeFileSync(path.join(uploadsDir, 'latest_rapid.mod'), rapidCode, 'utf-8');

    return res.json({
      success: true,
      pipeline: {
        sourceFile: featurePath ? path.basename(featurePath) : 'Default_Fallback',
        seam,
        totalWaypoints: waypoints.length,
        waypoints,
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
    const { code, fileName = 'Module1.mod' } = req.body || {};
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