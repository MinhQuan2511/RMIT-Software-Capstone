/**
 * HTTP API (v2). See docs/API_CONTRACT.md for the full contract.
 *
 * Every handler identifies its data explicitly (source ID, job ID, revision).
 * No handler reads "the newest file", and no GET changes stored state.
 */

const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { AppError } = require('../services/util/errors');
const { createRateLimiter } = require('../services/security/requestGuard');
const { listProfiles } = require('../services/kinematics/profiles');
const { SPEEDS, ZONES } = require('../services/validation/rapidSyntax');
const { displayName } = require('../services/jobs/jobStore');

const DEMO_SAMPLES = { straight: 'Feature_Straight_Sample.txt', arc: 'Feature_Arc_Sample.txt' };
const POINT_ROW_KEYS = ['rowNumber', 'name', 'x', 'y', 'z', 'q1', 'q2', 'q3', 'q4', 'rx', 'ry', 'rz', 'cf1', 'cf4', 'cf6', 'cfx'];

const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

function revisionParam(req) {
  const n = Number(req.params.revision);
  if (!Number.isInteger(n) || n < 1) throw new AppError(404, 'NOT_FOUND', 'Unknown revision.');
  return n;
}

function mapMulterError(err) {
  if (err instanceof AppError) return err;
  const map = {
    LIMIT_FILE_SIZE: [413, 'UPLOAD_TOO_LARGE', 'A file exceeds the upload size limit.'],
    LIMIT_FILE_COUNT: [413, 'UPLOAD_TOO_MANY_FILES', 'Too many files in one upload.'],
    LIMIT_PART_COUNT: [413, 'UPLOAD_TOO_MANY_PARTS', 'Too many parts in the upload.'],
    LIMIT_FIELD_COUNT: [413, 'UPLOAD_TOO_MANY_FIELDS', 'Too many form fields.'],
    LIMIT_UNEXPECTED_FILE: [400, 'UPLOAD_UNEXPECTED_FIELD', "Files must be sent in the 'files' field."],
  };
  const [status, code, message] = map[err.code] || [400, 'UPLOAD_INVALID', 'The upload could not be read.'];
  return new AppError(status, code, message);
}

function sanitizePointDocument(body, maxRows) {
  const doc = body && body.document;
  if (!doc || typeof doc !== 'object' || Array.isArray(doc)) throw new AppError(422, 'POINT_LIST_SCHEMA', 'document must be an object.');
  if (!Array.isArray(doc.rows)) throw new AppError(422, 'POINT_LIST_SCHEMA', 'document.rows must be an array.');
  if (doc.rows.length > maxRows) throw new AppError(413, 'POINT_LIST_TOO_MANY_ROWS', `At most ${maxRows} rows are accepted.`);
  const cell = (v) => (v === undefined || v === null ? undefined : typeof v === 'number' ? v : String(v).slice(0, 64));
  return {
    schemaVersion: 1,
    kind: 'point-list',
    units: typeof doc.units === 'string' ? doc.units : undefined,
    orientationConvention: typeof doc.orientationConvention === 'string' ? doc.orientationConvention : undefined,
    configurationPolicy: typeof doc.configurationPolicy === 'string' ? doc.configurationPolicy : undefined,
    rows: doc.rows.map((row) => Object.fromEntries(POINT_ROW_KEYS.filter((k) => row && row[k] !== undefined).map((k) => [k, cell(row[k])]))),
  };
}

function createApiRouter({ config, store, jobService, watchFolder, launcher, guard, readCalibrationArchive }) {
  const router = express.Router();
  const limiters = Object.fromEntries(Object.entries(config.rateLimits).map(([k, v]) => [k, createRateLimiter(v)]));

  const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: config.limits.maxUploadBytes, files: config.limits.maxUploadFiles, fields: 5, parts: config.limits.maxUploadFiles + 5, fieldNameSize: 64 },
    fileFilter: (req, file, cb) => {
      const base = displayName(file.originalname);
      if (!/\.txt$/i.test(base)) return cb(new AppError(415, 'UPLOAD_UNSUPPORTED_TYPE', `Only .txt seam descriptors are accepted (got '${base}').`));
      return cb(null, true);
    },
  });

  // ---- service ----------------------------------------------------------
  router.get('/health', (req, res) => {
    res.json({
      status: 'online',
      service: 'vertex-dynamics-backend',
      apiVersion: 2,
      time: new Date().toISOString(),
      meaning: 'The backend process answered this request. Camera and controller connections are not part of this application.',
      camera: 'not_integrated',
      controller: 'not_integrated',
    });
  });

  router.get('/session', (req, res) => {
    res.set('Cache-Control', 'no-store');
    res.json({
      csrfToken: guard.csrfToken,
      limits: { maxUploadBytes: config.limits.maxUploadBytes, maxUploadFiles: config.limits.maxUploadFiles, maxPointRows: config.limits.maxPointRows },
      note: 'Local single-operator session. Operator names are attribution only, not authentication.',
    });
  });

  router.get('/profiles', (req, res) => res.json({ profiles: listProfiles(), speeds: [...SPEEDS], zones: [...ZONES] }));

  // ---- projects -----------------------------------------------------------
  router.get('/projects', wrap(async (req, res) => {
    const projects = await store.listProjects();
    const withCounts = await Promise.all(projects.map(async (p) => ({ ...p, jobCount: (await store.listJobs(p.id)).length })));
    res.json({ projects: withCounts });
  }));
  router.post('/projects', wrap(async (req, res) => {
    const body = req.body || {};
    res.status(201).json({ project: await store.createProject({ name: body.name, description: body.description ?? '' }) });
  }));
  router.get('/projects/:projectId', wrap(async (req, res) => {
    const project = await store.getProject(req.params.projectId);
    const jobs = await store.listJobs(project.id);
    const summaries = await Promise.all(jobs.map(async (j) => {
      const latest = await store.getRevision(j.id, j.latestRevision).catch(() => null);
      return {
        id: j.id, createdAt: j.createdAt, updatedAt: j.updatedAt, latestRevision: j.latestRevision, revisionCount: j.revisions.length,
        source: latest && { id: latest.source.id, displayName: latest.source.displayName, kind: latest.source.kind, sha256: latest.source.sha256 },
        mode: latest && latest.mode,
        plannedType: latest && latest.geometry.plannedType,
        outputSha256: latest && latest.output.sha256,
      };
    }));
    res.json({ project, jobs: summaries });
  }));

  // ---- watched folder -----------------------------------------------------
  router.get('/watch-folder', wrap(async (req, res) => res.json(await watchFolder.status())));
  router.put('/watch-folder', wrap(async (req, res) => res.json(await watchFolder.setFolder((req.body || {}).watchFolder))));
  router.post('/watch-folder/scan', limiters.scan, wrap(async (req, res) => res.json(await watchFolder.scan())));

  // ---- sources ------------------------------------------------------------
  router.get('/sources', wrap(async (req, res) => {
    const limit = Math.min(Math.max(Number.parseInt(req.query.limit, 10) || 30, 1), 100);
    res.json({ sources: await store.listSources({ limit }) });
  }));

  router.post('/sources', limiters.upload, (req, res, next) => {
    upload.array('files')(req, res, (err) => (err ? next(mapMulterError(err)) : next()));
  }, wrap(async (req, res) => {
    const files = req.files || [];
    if (files.length === 0) throw new AppError(422, 'UPLOAD_EMPTY', 'Select at least one .txt file.');
    const results = [];
    for (const file of files) {
      const { source, created } = await store.putSource({ content: file.buffer, kind: 'manual_upload', name: file.originalname, contentType: 'feature-text' });
      results.push({ source, created, preview: jobService.previewSource(source, file.buffer) });
    }
    res.status(201).json({ sources: results });
  }));

  router.post('/sources/demo', limiters.upload, wrap(async (req, res) => {
    const sample = (req.body || {}).sample;
    if (!Object.prototype.hasOwnProperty.call(DEMO_SAMPLES, sample)) throw new AppError(422, 'DEMO_SAMPLE_UNKNOWN', "sample must be 'straight' or 'arc'.");
    const buf = await fs.promises.readFile(path.join(config.samplesDir, DEMO_SAMPLES[sample]));
    const { source, created } = await store.putSource({ content: buf, kind: 'demo', name: DEMO_SAMPLES[sample], contentType: 'feature-text', channelDetail: { sample } });
    res.status(201).json({ source, created, preview: jobService.previewSource(source, buf) });
  }));

  router.post('/sources/point-list', limiters.upload, wrap(async (req, res) => {
    const doc = sanitizePointDocument(req.body, config.limits.maxPointRows);
    const buf = Buffer.from(JSON.stringify(doc), 'utf-8');
    const name = displayName((req.body || {}).displayName || 'point-list.json');
    const { source, created } = await store.putSource({ content: buf, kind: 'testing_point_list', name, contentType: 'point-list' });
    res.status(201).json({ source, created, preview: jobService.previewSource(source, buf) });
  }));

  router.get('/sources/:sourceId', wrap(async (req, res) => {
    const { meta, content } = await store.getSourceContent(req.params.sourceId);
    const preview = jobService.previewSource(meta, content);
    res.json({ source: meta, preview, text: meta.contentType === 'feature-text' ? content.toString('utf-8') : null });
  }));

  // ---- jobs ---------------------------------------------------------------
  router.post('/jobs', limiters.process, wrap(async (req, res) => {
    const { projectId, sourceId, parameters } = req.body || {};
    res.status(201).json(await jobService.createJob({ projectId, sourceId, parameters }));
  }));

  router.get('/jobs/:jobId', wrap(async (req, res) => res.json({ job: await store.getJob(req.params.jobId) })));

  router.post('/jobs/:jobId/revisions', limiters.process, wrap(async (req, res) => {
    const { baseRevision, parameters, sourceId } = req.body || {};
    const result = await jobService.reprocess({ jobId: req.params.jobId, baseRevision, parameters, sourceId });
    res.status(result.reused ? 200 : 201).json(result);
  }));

  router.get('/jobs/:jobId/revisions/:revision', wrap(async (req, res) => {
    res.json(await jobService.view(req.params.jobId, revisionParam(req)));
  }));

  router.post('/jobs/:jobId/revisions/:revision/acknowledgements', wrap(async (req, res) => {
    const { codes, operator } = req.body || {};
    res.json(await jobService.acknowledge({ jobId: req.params.jobId, revision: revisionParam(req), codes, operator }));
  }));

  router.post('/jobs/:jobId/revisions/:revision/review', wrap(async (req, res) => {
    const { stage, operator } = req.body || {};
    res.json(await jobService.review({ jobId: req.params.jobId, revision: revisionParam(req), stage, operator }));
  }));

  router.post('/jobs/:jobId/revisions/:revision/evidence', wrap(async (req, res) => {
    res.json(await jobService.recordEvidence({ ...(req.body || {}), jobId: req.params.jobId, revision: revisionParam(req) }));
  }));

  router.get('/jobs/:jobId/revisions/:revision/module', limiters.export, wrap(async (req, res) => {
    const revision = revisionParam(req);
    const { code, view } = await jobService.moduleForExport({ jobId: req.params.jobId, revision, outputSha256: req.query.outputSha256 });
    res.set('Cache-Control', 'no-store');
    res.set('X-VD-Output-Sha256', view.record.output.sha256);
    res.set('X-VD-File-Name', `VD_${req.params.jobId.slice(4, 12)}_r${revision}_${view.record.output.sha256.slice(0, 8)}.mod`);
    res.type('text/plain; charset=utf-8').send(code);
  }));

  router.post('/jobs/:jobId/revisions/:revision/export', limiters.export,
    (req, res, next) => ((req.body || {}).action === 'save_and_launch' ? limiters.launch(req, res, next) : next()),
    wrap(async (req, res) => {
      const { outputSha256, action, operator } = req.body || {};
      res.json(await jobService.exportModule({ jobId: req.params.jobId, revision: revisionParam(req), outputSha256, action, operator }));
    }));

  // ---- RobotStudio and calibration -----------------------------------------
  router.get('/robotstudio/status', (req, res) => {
    const d = launcher.discover();
    res.json({ status: d.status, discovery: d.method || null, exeName: d.exePath ? path.basename(d.exePath) : null, message: d.message || null,
      meaning: 'Discovery only checks that an executable file exists. It does not start RobotStudio or check licences.' });
  });

  let calibrationCache = null;
  router.get('/calibration/routine', wrap(async (req, res) => {
    if (!calibrationCache) {
      try {
        calibrationCache = readCalibrationArchive(config.calibrationArchive);
      } catch (err) {
        if (err.code === 'ENOENT') throw new AppError(404, 'CALIBRATION_ARCHIVE_MISSING', 'The archived calibration station was not found.');
        throw new AppError(500, 'CALIBRATION_ARCHIVE_UNREADABLE', 'The archived calibration station could not be read.');
      }
    }
    res.json(calibrationCache);
  }));

  // ---- removed endpoints ----------------------------------------------------
  router.all(['/process-pipeline', '/parse-map', '/rapid-code', '/ingest-files', '/scan-watch-folder'], (req, res) => {
    res.status(410).json({ error: { code: 'ENDPOINT_REMOVED', message: 'This endpoint processed "the newest file" implicitly and has been removed. Use /api/sources and /api/jobs.' } });
  });

  return router;
}

module.exports = { createApiRouter, sanitizePointDocument, DEMO_SAMPLES };
