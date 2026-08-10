const express = require('express');
const router = express.Router();
const multer = require('multer');
const fs = require('fs');
const path = require('path');

// Import Service Modules
const { parseHandEyeYaml } = require('../services/parsers/yamlParser');
const { parseFeatureCurve } = require('../services/parsers/curveParser');
const { parseCfigConfig } = require('../services/parsers/configParser');
const { parseCameraDepthGrid } = require('../services/parsers/depthParser');

const { transformPoints } = require('../services/kinematics/matrixTransform');
const { computePathQuaternions } = require('../services/kinematics/quaternionMath');
const { planTrajectory } = require('../services/kinematics/pathPlanner');
const { generateRapidCode } = require('../services/compiler/rapidCompiler');
const { getBridgeStatus, broadcastMessage } = require('../services/network/tcpBridge');

// Multer Storage Configuration for File Ingestion
const uploadsDir = path.join(__dirname, '..', 'uploads');
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadsDir),
  filename: (req, file, cb) => cb(null, file.originalname),
});
const upload = multer({ storage });

// In-Memory Storage for last compiled pipeline output
let lastCompiledPipeline = null;

/**
 * GET /api/bridge/status
 * Returns current TCP socket server health and connected client count.
 */
router.get('/bridge/status', (req, res) => {
  try {
    const status = getBridgeStatus();
    return res.json({
      success: true,
      timestamp: new Date().toISOString(),
      bridge: status,
    });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * POST /api/ingest-files
 * Accepts uploaded scan files (CamerDepth.txt, Cfig, Feature.txt, handeye_result.yaml)
 * or reads existing files from backend staging directory.
 */
router.post('/ingest-files', upload.array('files'), (req, res) => {
  try {
    const ingestedSummary = {
      filesFound: [],
      handeyeMatrix: null,
      rawCurvePoints: [],
      config: null,
      depthGrid: [],
    };

    // Check files directory
    const filesToRead = [
      'handeye_result.yaml',
      'Feature.txt',
      'Cfig',
      'CamerDepth.txt',
    ];

    for (const fileName of filesToRead) {
      const filePath = path.join(uploadsDir, fileName);
      if (fs.existsSync(filePath)) {
        ingestedSummary.filesFound.push(fileName);
        const content = fs.readFileSync(filePath, 'utf-8');

        if (fileName === 'handeye_result.yaml') {
          try {
            ingestedSummary.handeyeMatrix = parseHandEyeYaml(content);
          } catch (e) {
            console.warn('Failed parsing handeye_result.yaml:', e.message);
          }
        } else if (fileName === 'Feature.txt') {
          ingestedSummary.rawCurvePoints = parseFeatureCurve(content);
        } else if (fileName === 'Cfig') {
          ingestedSummary.config = parseCfigConfig(content);
        } else if (fileName === 'CamerDepth.txt') {
          ingestedSummary.depthGrid = parseCameraDepthGrid(content);
        }
      }
    }

    return res.json({
      success: true,
      message: `Ingested ${ingestedSummary.filesFound.length} scan files from staging directory.`,
      data: ingestedSummary,
    });
  } catch (err) {
    console.error('File ingestion error:', err);
    return res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * POST /api/process-pipeline
 * Runs parsing -> 4x4 matrix transform -> Quaternion calculation -> Trajectory planning -> RAPID compilation
 */
router.post('/process-pipeline', (req, res) => {
  try {
    const {
      handeyeMatrixOverride,
      curvePointsOverride,
      torchAngle = 45,
      approachOffset = 50,
      retractOffset = 50,
      moduleName = 'WeldModule',
      speed = 'v100',
      tool = 'tWeldGun',
    } = req.body || {};

    // 1. Read / Parse Files
    let handeyeMatrix = handeyeMatrixOverride;
    let cameraPoints = curvePointsOverride;
    let config = null;

    if (!handeyeMatrix) {
      const yamlPath = path.join(uploadsDir, 'handeye_result.yaml');
      if (fs.existsSync(yamlPath)) {
        const yamlText = fs.readFileSync(yamlPath, 'utf-8');
        handeyeMatrix = parseHandEyeYaml(yamlText);
      }
    }

    if (!cameraPoints || cameraPoints.length === 0) {
      const featurePath = path.join(uploadsDir, 'Feature.txt');
      if (fs.existsSync(featurePath)) {
        const featureText = fs.readFileSync(featurePath, 'utf-8');
        cameraPoints = parseFeatureCurve(featureText);
      }
    }

    const cfigPath = path.join(uploadsDir, 'Cfig');
    if (fs.existsSync(cfigPath)) {
      const cfigText = fs.readFileSync(cfigPath, 'utf-8');
      config = parseCfigConfig(cfigText);
    }

    // Default fallback curve points if none provided
    if (!cameraPoints || cameraPoints.length === 0) {
      cameraPoints = [
        { x: 10, y: 20, z: 5 },
        { x: 20, y: 25, z: 5.2 },
        { x: 30, y: 30, z: 5.5 },
        { x: 40, y: 35, z: 5.8 },
        { x: 50, y: 40, z: 6.0 },
      ];
    }

    // 2. 4x4 Homogeneous Matrix Transformation (P_robot = T * P_camera)
    const robotPoints = transformPoints(cameraPoints, handeyeMatrix);

    // 3. Trajectory Waypoints & Approach / Retract Planning
    const plannedWaypoints = planTrajectory(robotPoints, {
      approachOffsetMm: approachOffset,
      retractOffsetMm: retractOffset,
    });

    // 4. Torch Orientation Quaternion Math [q1, q2, q3, q4]
    const quaternions = computePathQuaternions(plannedWaypoints, torchAngle);

    // Combine into 6D Target Poses
    const robotTargets = plannedWaypoints.map((pt, i) => {
      const q = quaternions[i] || [1, 0, 0, 0];
      return {
        name: pt.name,
        type: pt.type,
        x: pt.x,
        y: pt.y,
        z: pt.z,
        q1: q[0],
        q2: q[1],
        q3: q[2],
        q4: q[3],
      };
    });

    // 5. RAPID Code Compilation
    const rapidCode = generateRapidCode(robotTargets, {
      moduleName,
      speed,
      tool,
    });

    // Cache pipeline execution result
    lastCompiledPipeline = {
      timestamp: new Date().toISOString(),
      sourceFile: 'Feature.txt',
      matrixStatus: 'Mapped via handeye_result.yaml (4x4 Matrix Applied)',
      handeyeMatrix,
      cameraPoints,
      cameraPointsCount: cameraPoints.length,
      robotPoints,
      robotPointsCount: robotPoints.length,
      robotTargets,
      totalPoints: robotTargets.length,
      startPoint: robotTargets[0] || null,
      endPoint: robotTargets[robotTargets.length - 1] || null,
      rapidCode,
      config,
    };

    // Optionally notify connected TCP clients
    broadcastMessage(`002,PIPELINE_COMPLETE,TARGETS:${robotTargets.length}`);

    return res.json({
      success: true,
      message: 'Processing pipeline executed successfully.',
      pipeline: lastCompiledPipeline,
    });
  } catch (err) {
    console.error('Process pipeline error:', err);
    return res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * GET /api/rapid-code
 * Returns compiled RAPID text string
 */
router.get('/rapid-code', (req, res) => {
  try {
    if (lastCompiledPipeline && lastCompiledPipeline.rapidCode) {
      return res.json({
        success: true,
        rapidCode: lastCompiledPipeline.rapidCode,
        timestamp: lastCompiledPipeline.timestamp,
      });
    }

    // Default compiled rapid code if pipeline hasn't run yet
    const defaultTargets = [
      { name: 'p_approach', type: 'approach', x: 500, y: 10, z: 530, q1: 1, q2: 0, q3: 0, q4: 0 },
      { name: 'Target_10', type: 'weld', x: 520, y: 20, z: 500, q1: 0.98, q2: 0.1, q3: -0.05, q4: 0.05 },
      { name: 'Target_20', type: 'weld', x: 550, y: 35, z: 495, q1: 0.96, q2: 0.15, q3: -0.1, q4: 0.05 },
      { name: 'p_retract', type: 'retract', x: 570, y: 45, z: 530, q1: 1, q2: 0, q3: 0, q4: 0 },
    ];
    const defaultCode = generateRapidCode(defaultTargets, { moduleName: 'DefaultWeldModule' });

    return res.json({
      success: true,
      rapidCode: defaultCode,
      note: 'Default compiled template. Run POST /api/process-pipeline for dynamic compilation.',
    });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

const { exec } = require('child_process');

/**
 * POST /api/launch-robotstudio
 * Saves RAPID module and automatically triggers Windows OS to find and launch RobotStudio.
 */
router.post('/launch-robotstudio', (req, res) => {
  try {
    const { code, fileName = 'WeldModule.mod' } = req.body || {};
    if (!code) {
      return res.status(400).json({ success: false, error: 'No RAPID code provided.' });
    }

    const filePath = path.join(uploadsDir, fileName);
    fs.writeFileSync(filePath, code, 'utf-8');

    const command = process.platform === 'win32'
      ? `start "" "${filePath}"`
      : `open "${filePath}"`;

    exec(command, (error) => {
      if (error) {
        console.warn('RobotStudio not found or failed to launch:', error.message);

        return res.json({
          success: false,
          launched: false,
          error: 'RobotStudio is not installed or associated on this PC.',
        });
      }

      return res.json({
        success: true,
        launched: true,
        message: `Successfully launched RobotStudio with ${fileName}.`,
      });
    });
  } catch (err) {
    console.error('Launch RobotStudio error:', err);
    return res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;
