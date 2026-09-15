/**
 * Runtime configuration from the environment. Every value has a local-only,
 * safe default. Nothing here is ever sent to the browser except the limits.
 */

const path = require('path');
const os = require('os');

const REPO_ROOT = path.resolve(__dirname, '../../..');

const list = (value, sep) => (typeof value === 'string' && value.trim()
  ? value.split(sep).map((s) => s.trim()).filter(Boolean)
  : []);

const int = (value, fallback) => {
  const n = Number.parseInt(value, 10);
  return Number.isInteger(n) && n >= 0 ? n : fallback;
};

function loadRuntimeConfig(env = process.env, overrides = {}) {
  const samplesDir = path.join(REPO_ROOT, 'samples');
  const config = {
    repoRoot: REPO_ROOT,
    port: int(env.PORT, 5000),
    host: env.VD_BIND_HOST || '127.0.0.1',
    allowNonLoopback: env.VD_ALLOW_NON_LOOPBACK === '1',
    dataDir: path.resolve(env.VD_DATA_DIR || path.join(REPO_ROOT, 'backend', 'data')),
    watchConfigPath: path.resolve(env.VD_CONFIG_PATH || path.join(REPO_ROOT, 'backend', 'config.json')),
    samplesDir,
    defaultWatchFolder: env.WATCH_FOLDER || 'samples',
    // Approved watch-folder roots. The bundled samples folder is the demo root:
    // anything ingested from inside it is marked sourceKind "demo".
    watchRoots: [samplesDir, path.join(REPO_ROOT, 'watch-inbox'), ...list(env.VD_WATCH_ROOTS, path.delimiter)].map((p) => path.resolve(p)),
    demoRoots: [samplesDir],
    allowedOrigins: list(env.VD_ALLOWED_ORIGINS, ',').length
      ? list(env.VD_ALLOWED_ORIGINS, ',')
      : ['http://localhost:3000', 'http://127.0.0.1:3000'],
    allowedHostnames: ['localhost', '127.0.0.1', '[::1]'],
    exportDir: path.resolve(env.VD_EXPORT_DIR || path.join(os.homedir(), 'Downloads')),
    robotStudioExe: env.VD_ROBOTSTUDIO_EXE || null,
    calibrationArchive: path.join(REPO_ROOT, 'frontend', 'public', 'stations', 'auto_calib.rspag'),
    limits: {
      maxUploadBytes: 256 * 1024,
      maxUploadFiles: 10,
      maxJsonBody: '2mb',
      maxPointRows: 2000,
      watchMaxEntries: 500,
      watchMaxFileBytes: 256 * 1024,
      watchSettleMs: int(env.VD_WATCH_SETTLE_MS, 2000),
    },
    rateLimits: {
      upload: { windowMs: 60000, max: 30 },
      scan: { windowMs: 60000, max: 120 },
      process: { windowMs: 60000, max: 60 },
      export: { windowMs: 60000, max: 20 },
      launch: { windowMs: 60000, max: 5 },
    },
  };
  return { ...config, ...overrides, limits: { ...config.limits, ...(overrides.limits || {}) }, rateLimits: { ...config.rateLimits, ...(overrides.rateLimits || {}) } };
}

const isLoopbackHost = (host) => ['127.0.0.1', '::1', 'localhost'].includes(host);

module.exports = { loadRuntimeConfig, isLoopbackHost, REPO_ROOT };
