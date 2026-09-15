/**
 * Express application factory. Kept separate from server.js so tests can build
 * an app against temporary directories and a mocked launcher.
 */

const express = require('express');
const cors = require('cors');
const { createApiRouter } = require('./routes/apiRoutes');
const { createRequestGuard } = require('./services/security/requestGuard');
const { createJobStore } = require('./services/jobs/jobStore');
const { createJobService, previewSource } = require('./services/jobs/jobService');
const { createWatchFolderService } = require('./services/ingest/watchFolder');
const { createLauncher } = require('./services/robotstudio/launcher');
const exportWriter = require('./services/robotstudio/exportWriter');
const { readCalibrationArchive } = require('./services/calibration/rspagReader');
const { computeSourceIdentity } = require('./services/util/sourceIdentity');
const { AppError, newDiagnosticId } = require('./services/util/errors');

function safeSourceIdentity(repoRoot, logger) {
  try {
    return computeSourceIdentity(repoRoot);
  } catch (err) {
    logger.error('source identity unavailable', err);
    return null;
  }
}

function buildServices(config, overrides = {}) {
  const logger = overrides.logger || console;
  const store = overrides.store || createJobStore({ dataDir: config.dataDir });
  const launcher = overrides.launcher || createLauncher({ overrideExe: config.robotStudioExe || undefined });
  const guard = overrides.guard || createRequestGuard({ allowedOrigins: config.allowedOrigins, allowedHostnames: config.allowedHostnames });
  const sourceIdentity = overrides.sourceIdentity !== undefined ? overrides.sourceIdentity : safeSourceIdentity(config.repoRoot, logger);
  const jobService = createJobService({ store, exportWriter: overrides.exportWriter || exportWriter, launcher, config, logger, sourceIdentity });
  const watchFolder = createWatchFolderService({ store, previewSource, config, clock: overrides.clock, fsp: overrides.fsp });
  return { store, launcher, guard, jobService, watchFolder, logger, readCalibrationArchive: overrides.readCalibrationArchive || readCalibrationArchive };
}

function createApp({ config, store, launcher, guard, jobService, watchFolder, logger = console, readCalibrationArchive: reader = readCalibrationArchive }) {
  const app = express();
  app.disable('x-powered-by');
  app.set('etag', false);
  // Only flat query strings are used (?limit=, ?outputSha256=). The simple
  // parser (node:querystring) keeps qs out of the request path entirely.
  app.set('query parser', 'simple');

  app.use(guard.hostCheck);
  app.use(guard.originCheck);
  app.use(cors({
    origin: (origin, cb) => cb(null, origin === undefined || guard.isAllowedOrigin(origin)),
    methods: ['GET', 'POST', 'PUT', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'X-VD-CSRF'],
    exposedHeaders: ['X-VD-Output-Sha256', 'X-VD-File-Name', 'X-VD-Package-Sha256'],
    maxAge: 600,
  }));
  app.use(express.json({ limit: config.limits.maxJsonBody }));

  app.use('/api', guard.csrfCheck, createApiRouter({ config, store, jobService, watchFolder, launcher, guard, readCalibrationArchive: reader }));

  app.get('/', (req, res) => res.json({ service: 'vertex-dynamics-backend', apiVersion: 2, health: '/api/health' }));

  app.use((req, res) => res.status(404).json({ error: { code: 'NOT_FOUND', message: 'No such endpoint.' } }));

  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    if (err && err.type === 'entity.too.large') return res.status(413).json({ error: { code: 'BODY_TOO_LARGE', message: 'Request body is too large.' } });
    if (err && err.type === 'entity.parse.failed') return res.status(400).json({ error: { code: 'BODY_INVALID_JSON', message: 'Request body is not valid JSON.' } });
    if (err instanceof AppError) {
      return res.status(err.status).json({ error: { code: err.code, message: err.message, details: err.details, diagnostics: err.diagnostics } });
    }
    const diagnosticId = newDiagnosticId();
    logger.error(`[${diagnosticId}]`, err);
    return res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: 'Unexpected server error. Details are in the backend log.', diagnosticId } });
  });

  return app;
}

module.exports = { createApp, buildServices };
