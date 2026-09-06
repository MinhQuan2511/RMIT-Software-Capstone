const express = require('express');
const router = express.Router();
const fs = require('fs');
const path = require('path');
const multer = require('multer');
const { exec } = require('child_process');
const { parseFeatureCurve } = require('../services/parsers/curveParser');
const { planSeamPath } = require('../services/kinematics/pathPlanner');
const { generateRapidCode } = require('../services/compiler/rapidCompiler');
const { sampleArc } = require('../services/kinematics/arcFitter');

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
    // An arc feature file carries labelled keys and no curve: line at all.
    if (content.includes('curve:') || content.includes('arc_start:')) return file.path;
  }
  return null;
}

/* ------------------------------------------------------------------ *
 * Watched folder
 *
 * A real directory on disk, polled by the frontend. The path lives in
 * backend/config.json so it survives a restart, seeded from WATCH_FOLDER
 * in the environment on first run.
 *
 * Polling rather than fs.watch is deliberate: on Windows fs.watch fires
 * duplicate and partial events for a file that is still being written. A
 * poll comparing size and mtime is boringly predictable.
 * ------------------------------------------------------------------ */

const CONFIG_PATH = path.join(__dirname, '../config.json');
const REPO_ROOT = path.join(__dirname, '../..');

// samples/ ships with a straight and an arc feature file, so the watched
// folder demonstrates itself on a fresh checkout. Stored relative so
// config.json stays portable between machines.
const DEFAULT_WATCH_FOLDER = process.env.WATCH_FOLDER || 'samples';

/**
 * Watch folder paths may be absolute (what someone types on the Acquire page)
 * or relative to the repo root (what ships in config.json).
 */
function resolveWatchFolder(configured) {
  return path.isAbsolute(configured) ? configured : path.resolve(REPO_ROOT, configured);
}

function readConfig() {
  try {
    if (fs.existsSync(CONFIG_PATH)) {
      const parsed = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf-8'));
      if (parsed && typeof parsed.watchFolder === 'string' && parsed.watchFolder.trim()) {
        return parsed;
      }
    }
  } catch (err) {
    console.warn('watch-folder: config.json unreadable, falling back to default:', err.message);
  }
  return { watchFolder: DEFAULT_WATCH_FOLDER };
}

function writeConfig(config) {
  fs.writeFileSync(CONFIG_PATH, `${JSON.stringify(config, null, 2)}\n`, 'utf-8');
}

/** A feature file is a .txt carrying either seam format. */
function isFeatureFile(filePath) {
  try {
    const content = fs.readFileSync(filePath, 'utf-8');
    return content.includes('curve:') || content.includes('arc_start:');
  } catch {
    return false;
  }
}

// Size and mtime seen on the previous poll, keyed by absolute path. A file is
// only ingested once its size has held steady across two consecutive polls,
// otherwise a scan still being written gets read half-finished.
const lastSeen = new Map();

// Files already copied into uploads/, keyed by identity rather than name, so
// an edited-and-resaved scan is picked up again.
const ingested = new Set();

function scanWatchFolder(dir) {
  if (!fs.existsSync(dir)) {
    return {
      success: false,
      exists: false,
      watchFolder: dir,
      files: [],
      ingestedNow: [],
      message: `Folder not found: ${dir}`,
    };
  }

  let stat;
  try {
    stat = fs.statSync(dir);
  } catch (err) {
    return {
      success: false,
      exists: false,
      watchFolder: dir,
      files: [],
      ingestedNow: [],
      message: `Cannot read folder: ${err.message}`,
    };
  }

  if (!stat.isDirectory()) {
    return {
      success: false,
      exists: false,
      watchFolder: dir,
      files: [],
      ingestedNow: [],
      message: `Not a directory: ${dir}`,
    };
  }

  const files = [];
  const ingestedNow = [];

  for (const name of fs.readdirSync(dir)) {
    if (!name.toLowerCase().endsWith('.txt')) continue;

    const full = path.join(dir, name);
    let s;
    try {
      s = fs.statSync(full);
    } catch {
      continue;
    }
    if (!s.isFile()) continue;

    const feature = isFeatureFile(full);
    const previous = lastSeen.get(full);
    const stable = !!previous && previous.size === s.size;
    lastSeen.set(full, { size: s.size, mtimeMs: s.mtimeMs });

    const identity = `${name}:${s.size}:${s.mtimeMs}`;
    let status;

    if (!feature) {
      status = 'Ignored';
    } else if (!stable) {
      // Either brand new or still growing — wait for the next poll to confirm.
      status = 'Writing';
    } else if (ingested.has(identity)) {
      status = 'Ingested';
    } else {
      try {
        const dest = path.join(uploadsDir, name);
        fs.copyFileSync(full, dest);
        // Carry the source mtime across, so findLatestFeatureFile picks the
        // genuinely newest scan rather than whichever file copied last.
        fs.utimesSync(dest, s.atime, s.mtime);
        ingested.add(identity);
        ingestedNow.push(name);
        status = 'Ready';
      } catch (err) {
        console.warn(`watch-folder: could not copy ${name}:`, err.message);
        status = 'Error';
      }
    }

    files.push({
      name,
      size: s.size,
      modified: s.mtime.toISOString(),
      isFeatureFile: feature,
      status,
    });
  }

  files.sort((a, b) => new Date(b.modified) - new Date(a.modified));

  const featureCount = files.filter((f) => f.isFeatureFile).length;
  return {
    success: true,
    exists: true,
    watchFolder: dir,
    files,
    ingestedNow,
    message: `${files.length} file(s), ${featureCount} feature file(s)`,
  };
}

// Read the configured watch folder
router.get('/watch-folder', (req, res) => {
  const { watchFolder } = readConfig();
  const resolved = resolveWatchFolder(watchFolder);
  return res.json({
    success: true,
    watchFolder: resolved,
    configured: watchFolder,
    exists: fs.existsSync(resolved),
  });
});

// Change the configured watch folder
router.put('/watch-folder', (req, res) => {
  const { watchFolder } = req.body || {};

  if (typeof watchFolder !== 'string' || !watchFolder.trim()) {
    return res.status(400).json({ success: false, error: 'watchFolder must be a non-empty string.' });
  }

  const next = watchFolder.trim();
  const resolved = resolveWatchFolder(next);
  const exists = fs.existsSync(resolved);

  try {
    writeConfig({ ...readConfig(), watchFolder: next });
  } catch (err) {
    return res.status(500).json({ success: false, error: `Could not save config: ${err.message}` });
  }

  // The path is saved either way so it can be set before the folder exists,
  // but the caller is told the truth about it.
  return res.json({
    success: true,
    watchFolder: resolved,
    configured: next,
    exists,
    message: exists ? 'Watch folder saved.' : `Saved, but the folder does not exist yet: ${resolved}`,
  });
});

// Poll the watch folder, copying newly settled feature files into uploads/
router.post('/scan-watch-folder', (req, res) => {
  try {
    const { watchFolder } = readConfig();
    return res.json(scanWatchFolder(resolveWatchFolder(watchFolder)));
  } catch (err) {
    console.error('Scan watch folder error:', err);
    return res.status(500).json({ success: false, error: err.message });
  }
});

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
        startPoint: { x: 414.69, y: 1112.75, z: 320.342 },
        endPoint:   { x: 338.531, y: 1333.74, z: 322.068 },
        seamWidth:  5.54,
      };
    }

    // --- Step 2: Plan waypoints (no matrix transform needed) ---
    const plan = planSeamPath(seam);
    const waypoints = plan.waypoints;

    // Calculate physical feature metrics
    const dx = seam.endPoint.x - seam.startPoint.x;
    const dy = seam.endPoint.y - seam.startPoint.y;
    const dz = seam.endPoint.z - seam.startPoint.z;
    const chordLength = Math.sqrt(dx * dx + dy * dy + dz * dz);
    // An arc is measured along the curve; the chord would understate the weld
    // by however much the seam bows.
    const seamLength = plan.isArc ? plan.arc.arcLength : chordLength;
    const seamGapWidth = Math.abs(seam.seamWidth || 5.54);

    const featureData = {
      length: parseFloat(seamLength.toFixed(2)),
      width: parseFloat(seamGapWidth.toFixed(2)),
    };

    // Format waypoints with clean numbers
    const formattedWaypoints = waypoints.map((wp) => ({
      id: wp.id || wp.name,
      name: wp.name || wp.id,
      type: wp.type,
      pos: [
        parseFloat(wp.pos[0].toFixed(4)),
        parseFloat(wp.pos[1].toFixed(4)),
        parseFloat(wp.pos[2].toFixed(4)),
      ],
      orient: wp.orient,
      conf: wp.conf,
      speed: wp.speed,
      zone: wp.zone,
    }));

    // --- Step 3: Generate RAPID code ---
    // The viewport needs a point list to build a curved mesh; RAPID does not,
    // because MoveC interpolates the arc on the controller itself.
    const arcPoints = plan.isArc ? sampleArc(plan.arc, 48) : null;

    const rapidCode = generateRapidCode(waypoints);
    fs.writeFileSync(path.join(uploadsDir, 'latest_rapid.mod'), rapidCode, 'utf-8');

    return res.json({
      success: true,
      rapidCode,
      featureData,
      seam,
      isArc: plan.isArc,
      arc: plan.isArc
        ? {
            center: plan.arc.center,
            radius: parseFloat(plan.arc.radius.toFixed(4)),
            normal: plan.arc.normal,
            sweepAngle: plan.arc.sweepAngle,
            sweepDegrees: parseFloat(((plan.arc.sweepAngle * 180) / Math.PI).toFixed(3)),
            bow: parseFloat(plan.arc.bow.toFixed(4)),
            arcLength: parseFloat(plan.arc.arcLength.toFixed(3)),
          }
        : null,
      arcPoints,
      // Non-null when an arc was requested but could not be fitted, so the
      // UI can say why it is showing a straight seam.
      warning: plan.fallbackReason,
      waypoints: formattedWaypoints,
      pipeline: {
        sourceFile: featurePath ? path.basename(featurePath) : 'Default_Fallback',
        seam,
        featureData,
        totalWaypoints: formattedWaypoints.length,
        waypoints: formattedWaypoints,
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
router.get('/parse-map', handlePipeline);
router.post('/parse-map', handlePipeline);

// Get compiled RAPID code & waypoints unified payload
router.get('/rapid-code', handlePipeline);
router.post('/rapid-code', handlePipeline);

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