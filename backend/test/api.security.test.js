const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const http = require('http');
const { startTestServer, ORIGIN } = require('./helpers');
const { hostnameOf } = require('../services/security/requestGuard');
const { validateFileName, safeModuleFileName } = require('../services/robotstudio/exportWriter');

function rawRequest(port, { method = 'GET', path: p = '/api/health', headers = {} }) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, method, path: p, headers }, (res) => {
      let body = '';
      res.on('data', (c) => { body += c; });
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body }));
    });
    req.on('error', reject);
    req.end();
  });
}

test('T15 request guard: Host allowlist, Origin allowlist and CSRF token', async (t) => {
  const s = await startTestServer();
  t.after(() => s.close());
  assert.equal((await rawRequest(s.port, { headers: { Host: `evil.example:${s.port}` } })).status, 403);
  assert.equal((await rawRequest(s.port, { headers: { Host: `localhost:${s.port}` } })).status, 200);
  assert.equal((await rawRequest(s.port, { headers: { Host: `127.0.0.1:${s.port}`, Origin: 'https://evil.example' } })).status, 403);

  const preflight = await rawRequest(s.port, { method: 'OPTIONS', path: '/api/projects', headers: { Host: `127.0.0.1:${s.port}`, Origin: ORIGIN, 'Access-Control-Request-Method': 'POST', 'Access-Control-Request-Headers': 'content-type,x-vd-csrf' } });
  assert.equal(preflight.headers['access-control-allow-origin'], ORIGIN);

  const noToken = await s.client.raw('/projects', { method: 'POST', headers: { Origin: ORIGIN, 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'x' }) });
  assert.equal(noToken.status, 403);
  const badToken = await s.client.raw('/projects', { method: 'POST', headers: { Origin: ORIGIN, 'X-VD-CSRF': 'x'.repeat(64), 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'x' }) });
  assert.equal(badToken.status, 403);
  assert.equal((await s.client.post('/projects', { name: 'ok' })).status, 201);
  assert.equal(hostnameOf('[::1]:5000'), '[::1]');
  assert.equal(hostnameOf('LOCALHOST:5000'), 'localhost');
});

test('T15 watch folder: outside-root, traversal, missing and junction/symlink escapes are rejected', async (t) => {
  const s = await startTestServer();
  t.after(() => s.close());
  const outside = path.join(s.tmp, 'outside');
  fs.mkdirSync(outside);
  for (const candidate of [outside, path.join(s.inbox, '..', '..', 'outside'), 'C:\\Windows', path.join(s.watchRoot, 'nope'), '']) {
    const r = await s.client.put('/watch-folder', { watchFolder: candidate });
    assert.equal(r.status, 422, candidate);
  }
  let linked = false;
  const link = path.join(s.watchRoot, 'link-out');
  try { fs.symlinkSync(outside, link, 'junction'); linked = true; } catch { /* platform without junction support */ }
  if (linked) {
    const r = await s.client.put('/watch-folder', { watchFolder: link });
    assert.equal(r.status, 422, 'junction escaping the approved root');
    assert.match(r.body.error.message, /outside the approved watch roots/);
  }
  const ok = await s.client.put('/watch-folder', { watchFolder: s.inbox });
  assert.equal(ok.status, 200);
  assert.equal(ok.body.approved, true);
});

test('T15/T16 uploads: generated storage names, type filter, size and count limits, no partial files', async (t) => {
  const s = await startTestServer({ configOverrides: { limits: { maxUploadBytes: 1024, maxUploadFiles: 2, watchSettleMs: 0 } } });
  t.after(() => s.close());
  const sourcesDir = path.join(s.config.dataDir, 'sources');
  const before = fs.readdirSync(sourcesDir).length;

  const traversal = await s.client.upload([{ name: '../../escape.txt', content: 'units: mm\ncurve:0,0,0,100,0,0,5' }]);
  assert.equal(traversal.status, 201);
  const src = traversal.body.sources[0].source;
  assert.match(src.id, /^src_manual_[a-f0-9]{24}$/);
  assert.equal(src.displayName, 'escape.txt');
  assert.ok(!fs.existsSync(path.join(s.tmp, 'escape.txt')));
  assert.ok(!fs.existsSync(path.join(s.config.dataDir, 'escape.txt')));
  assert.deepEqual(fs.readdirSync(path.join(sourcesDir, src.id)).sort(), ['content', 'meta.json']);

  const colon = await s.client.upload([{ name: 'C:\\abs\\x.txt', content: 'units: mm\ncurve:0,0,0,100,0,0,6' }]);
  assert.equal(colon.status, 201);
  assert.ok(!fs.readdirSync(sourcesDir).some((n) => n.includes(':') || n === 'C'));

  const afterGood = fs.readdirSync(sourcesDir).length;
  const exe = await s.client.upload([{ name: 'payload.exe', content: 'MZ' }]);
  assert.equal(exe.status, 415);
  const big = await s.client.upload([{ name: 'big.txt', content: 'x'.repeat(4096) }]);
  assert.equal(big.status, 413);
  assert.equal(big.body.error.code, 'UPLOAD_TOO_LARGE');
  const many = await s.client.upload([1, 2, 3].map((i) => ({ name: `f${i}.txt`, content: `units: mm\ncurve:0,0,0,${100 + i},0,0,5` })));
  assert.equal(many.status, 413);
  assert.equal(fs.readdirSync(sourcesDir).length, afterGood, 'rejected uploads leave nothing behind');
  assert.equal(afterGood - before, 2);

  const json = await s.client.raw('/projects', { method: 'POST', headers: { Origin: ORIGIN, 'X-VD-CSRF': s.csrfToken, 'Content-Type': 'application/json' }, body: `{"name":"${'x'.repeat(3 * 1024 * 1024)}"}` });
  assert.equal(json.status, 413);
});

test('T16 rate limits return 429', async (t) => {
  const s = await startTestServer({ configOverrides: { rateLimits: { upload: { windowMs: 60000, max: 2 } } } });
  t.after(() => s.close());
  const statuses = [];
  for (let i = 0; i < 4; i += 1) statuses.push((await s.client.post('/sources/demo', { sample: 'straight' })).status);
  assert.deepEqual(statuses, [201, 201, 429, 429]);
});

test('T15 ids are validated before any path is built; export file names are generated and safe', async (t) => {
  const s = await startTestServer();
  t.after(() => s.close());
  for (const p of ['/jobs/..%2f..%2fetc', '/jobs/job_x/revisions/1', '/sources/..%5c..%5cwindows', '/jobs/job_00000000000000000000000000000000/revisions/abc']) {
    assert.equal((await s.client.get(p)).status, 404, p);
  }
  assert.equal(validateFileName('VD_abcdef12_r1_0123abcd.mod'), true);
  for (const bad of ['../x.mod', 'a/b.mod', 'a\\b.mod', 'CON.mod', 'nul.mod', 'x.bat', 'x.mod.exe', '', 'a b.mod']) {
    assert.equal(validateFileName(bad), false, bad);
  }
  assert.match(safeModuleFileName('job_0123456789abcdef0123456789abcdef', 3, 'f'.repeat(64)), /^VD_01234567_r3_ffffffff\.mod$/);
});
