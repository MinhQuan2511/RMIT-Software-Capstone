/**
 * Test harness: an isolated backend on 127.0.0.1:0 with temporary data, watch,
 * config and export directories, and a mocked RobotStudio launcher. Nothing
 * touches the repository's backend/data, config.json, the real Downloads
 * folder or a real RobotStudio installation.
 */

const fs = require('fs');
const fsp = fs.promises;
const os = require('os');
const path = require('path');
const { loadRuntimeConfig } = require('../services/config/runtimeConfig');
const { createApp, buildServices } = require('../app');

const SAMPLES = path.join(__dirname, '../../samples');
const ORIGIN = 'http://localhost:3000';

function fakeLauncher() {
  const calls = [];
  return {
    calls,
    discover: () => ({ status: 'found', method: 'test_double', exePath: 'C:\\fake\\RobotStudio.exe' }),
    launch: async (modulePath) => { calls.push(modulePath); return { status: 'process_started', pid: 4242, message: 'test double' }; },
  };
}

async function startTestServer({ configOverrides = {}, serviceOverrides = {} } = {}) {
  const tmp = await fsp.mkdtemp(path.join(os.tmpdir(), 'vd-test-'));
  const watchRoot = path.join(tmp, 'watch');
  const inbox = path.join(watchRoot, 'inbox');
  const exportDir = path.join(tmp, 'exports');
  await fsp.mkdir(inbox, { recursive: true });
  await fsp.mkdir(exportDir, { recursive: true });

  const config = loadRuntimeConfig({}, {
    dataDir: path.join(tmp, 'data'),
    watchConfigPath: path.join(tmp, 'config.json'),
    watchRoots: [watchRoot, SAMPLES],
    demoRoots: [SAMPLES],
    defaultWatchFolder: inbox,
    exportDir,
    limits: { watchSettleMs: 0 },
    rateLimits: {
      upload: { windowMs: 60000, max: 1000 },
      scan: { windowMs: 60000, max: 1000 },
      process: { windowMs: 60000, max: 1000 },
      export: { windowMs: 60000, max: 1000 },
      launch: { windowMs: 60000, max: 1000 },
    },
    ...configOverrides,
  });

  const launcher = serviceOverrides.launcher || fakeLauncher();
  const logger = { error: () => {}, log: () => {}, warn: () => {} };
  const services = buildServices(config, { launcher, logger, ...serviceOverrides });
  await services.store.init();
  const app = createApp({ config, ...services });
  const server = await new Promise((resolve) => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  const base = `http://127.0.0.1:${server.address().port}/api`;
  const { csrfToken } = await (await fetch(`${base}/session`)).json();

  const headers = (extra = {}) => ({ Origin: ORIGIN, 'X-VD-CSRF': csrfToken, ...extra });
  const asJson = async (res) => {
    const text = await res.text();
    let body = null;
    try { body = JSON.parse(text); } catch { body = text; }
    return { status: res.status, body, headers: res.headers };
  };

  const client = {
    get: (p) => fetch(base + p, { headers: headers() }).then(asJson),
    post: (p, body, extraHeaders) => fetch(base + p, { method: 'POST', headers: headers({ 'Content-Type': 'application/json', ...extraHeaders }), body: JSON.stringify(body ?? {}) }).then(asJson),
    put: (p, body) => fetch(base + p, { method: 'PUT', headers: headers({ 'Content-Type': 'application/json' }), body: JSON.stringify(body ?? {}) }).then(asJson),
    upload: (files) => {
      const form = new FormData();
      for (const f of files) form.append(f.field || 'files', new Blob([f.content]), f.name);
      return fetch(`${base}/sources`, { method: 'POST', headers: headers(), body: form }).then(asJson);
    },
    raw: (p, init) => fetch(base + p, init),
  };

  const operator = 'Test Operator';

  const helpers = {
    async project(name = 'Test project') {
      const r = await client.post('/projects', { name });
      return r.body.project;
    },
    async uploadText(name, content) {
      const r = await client.upload([{ name, content }]);
      if (r.status !== 201) throw new Error(`upload failed ${r.status} ${JSON.stringify(r.body)}`);
      return r.body.sources[0].source;
    },
    async approve(jobId, revision) {
      let v = await client.get(`/jobs/${jobId}/revisions/${revision}`);
      const codes = v.body.gates.acknowledgements.missing;
      if (codes.length) v = await client.post(`/jobs/${jobId}/revisions/${revision}/acknowledgements`, { codes, operator });
      v = await client.post(`/jobs/${jobId}/revisions/${revision}/review`, { stage: 'geometry', operator });
      if (v.status !== 200) throw new Error(`geometry review failed ${JSON.stringify(v.body)}`);
      v = await client.post(`/jobs/${jobId}/revisions/${revision}/review`, { stage: 'module', operator });
      if (v.status !== 200) throw new Error(`module review failed ${JSON.stringify(v.body)}`);
      return v.body;
    },
  };

  return {
    client, helpers, base, config, services, launcher, tmp, inbox, watchRoot, exportDir, operator, csrfToken,
    port: server.address().port,
    async close() {
      await new Promise((resolve) => server.close(resolve));
      await fsp.rm(tmp, { recursive: true, force: true });
    },
  };
}

const readSample = (name) => fs.readFileSync(path.join(SAMPLES, name), 'utf-8');

module.exports = { startTestServer, fakeLauncher, readSample, SAMPLES, ORIGIN };
