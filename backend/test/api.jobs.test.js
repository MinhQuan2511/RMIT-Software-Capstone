const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { startTestServer, readSample } = require('./helpers');
const { sha256 } = require('../services/util/hash');

const STRAIGHT = readSample('Feature_Straight_Sample.txt');
const ARC = readSample('Feature_Arc_Sample.txt');
const B_TEXT = 'units: mm\ncurve: 0, 0, 100, 250, 0, 100, 4\n';

test('T03/T23 missing, empty and malformed sources produce 422 with diagnostics and no job or module', async (t) => {
  const s = await startTestServer();
  t.after(() => s.close());
  const project = await s.helpers.project();

  for (const content of ['', 'just some notes\n', 'curve:414.69,1112.75,320.342\n']) {
    const src = await s.helpers.uploadText('bad.txt', content);
    const r = await s.client.post('/jobs', { projectId: project.id, sourceId: src.id });
    assert.equal(r.status, 422, content);
    assert.equal(r.body.error.code, 'PROCESSING_FAILED');
    assert.ok(Array.isArray(r.body.error.diagnostics) && r.body.error.diagnostics.length > 0);
    assert.equal(r.body.rapidCode, undefined);
  }
  const missing = await s.client.post('/jobs', { projectId: project.id, sourceId: 'src_manual_000000000000000000000000' });
  assert.equal(missing.status, 404);
  const noSource = await s.client.post('/jobs', { projectId: project.id });
  assert.equal(noSource.status, 404);
  const p = await s.client.get(`/projects/${project.id}`);
  assert.equal(p.body.jobs.length, 0);
  assert.deepEqual(fs.readdirSync(s.config.exportDir), []);
});

test('legacy latest-file endpoints are gone (410) and staged files are not served publicly', async (t) => {
  const s = await startTestServer();
  t.after(() => s.close());
  for (const p of ['/process-pipeline', '/parse-map', '/rapid-code', '/ingest-files', '/scan-watch-folder']) {
    const r = await s.client.get(p);
    assert.equal(r.status, 410, p);
  }
  const up = await s.client.raw('/../uploads/latest_rapid.mod');
  assert.equal(up.status, 404);
});

test('T01/T02/T21 valid straight and arc jobs expose one canonical revision (targets, segments, module)', async (t) => {
  const s = await startTestServer();
  t.after(() => s.close());
  const project = await s.helpers.project();
  for (const [name, text, targets] of [['straight.txt', STRAIGHT, 5], ['arc.txt', ARC, 6]]) {
    const src = await s.helpers.uploadText(name, text);
    const r = await s.client.post('/jobs', { projectId: project.id, sourceId: src.id });
    assert.equal(r.status, 201, JSON.stringify(r.body));
    const rec = r.body.record;
    assert.equal(rec.revision, 1);
    assert.equal(rec.source.sha256, sha256(text));
    assert.equal(rec.path.targetCount, targets);
    assert.equal(rec.path.instructionCount, 6);
    assert.equal(rec.output.sha256, sha256(rec.output.code));
    assert.ok(rec.prechecks.every((c) => c.status === 'passed'));
    // Table/visualisation data and module agree: every declared robtarget position is a waypoint position.
    for (const wp of rec.path.waypoints) {
      assert.ok(rec.output.code.includes(`CONST robtarget ${wp.name}:=[[${wp.pos.join(',')}]`), wp.name);
    }
    assert.equal(r.body.gates.validation.robotStudio, 'not_run');
    assert.equal(r.body.gates.validation.reachability, 'not_evaluated');
    assert.equal(r.body.gates.export.allowed, false);
  }
});

test('T17 backend gates: export and module download are blocked until acknowledgements and both reviews exist', async (t) => {
  const s = await startTestServer();
  t.after(() => s.close());
  const project = await s.helpers.project();
  const src = await s.helpers.uploadText('straight.txt', STRAIGHT);
  const { record, gates } = (await s.client.post('/jobs', { projectId: project.id, sourceId: src.id })).body;
  const base = `/jobs/${record.jobId}/revisions/1`;
  assert.deepEqual(gates.acknowledgements.missing.sort(), ['COORDINATE_AND_TOOL_ASSUMPTIONS', 'UNITS_ASSUMED_MM']);

  const exportEarly = await s.client.post(`${base}/export`, { outputSha256: record.output.sha256, action: 'save', operator: s.operator });
  assert.equal(exportEarly.status, 403);
  assert.equal(exportEarly.body.error.code, 'EXPORT_BLOCKED');
  const codes = exportEarly.body.error.details.reasons.map((r) => r.code);
  assert.ok(codes.includes('ACKNOWLEDGEMENT_MISSING') && codes.includes('GEOMETRY_NOT_REVIEWED') && codes.includes('MODULE_NOT_REVIEWED'));
  assert.equal((await s.client.get(`${base}/module?outputSha256=${record.output.sha256}`)).status, 403);

  assert.equal((await s.client.post(`${base}/review`, { stage: 'module', operator: s.operator })).status, 422);
  const geoNoAck = await s.client.post(`${base}/review`, { stage: 'geometry', operator: s.operator });
  assert.equal(geoNoAck.status, 422);
  assert.equal(geoNoAck.body.error.code, 'ACKNOWLEDGEMENT_MISSING');
  assert.equal((await s.client.post(`${base}/acknowledgements`, { codes: ['NOT_A_CODE'], operator: s.operator })).status, 422);
  assert.equal((await s.client.post(`${base}/review`, { stage: 'geometry' })).status, 422, 'operator attribution required');

  await s.helpers.approve(record.jobId, 1);
  const wrongHash = await s.client.post(`${base}/export`, { outputSha256: 'a'.repeat(64), action: 'save', operator: s.operator });
  assert.equal(wrongHash.status, 409);
  const mod = await s.client.raw(`${base}/module?outputSha256=${record.output.sha256}`, { headers: { Origin: 'http://localhost:3000' } });
  assert.equal(mod.status, 200);
  const text = await mod.text();
  assert.equal(sha256(text), record.output.sha256);
  assert.equal(mod.headers.get('x-vd-output-sha256'), record.output.sha256);
});

test('T19 review A, ingest B, export A: A data and output hash are retained', async (t) => {
  const s = await startTestServer();
  t.after(() => s.close());
  const project = await s.helpers.project();
  const a = await s.helpers.uploadText('Feature.txt', STRAIGHT);
  const jobA = (await s.client.post('/jobs', { projectId: project.id, sourceId: a.id })).body.record;
  await s.helpers.approve(jobA.jobId, 1);

  // A newer file arrives (same display name, different bytes) and even becomes its own job.
  const b = await s.helpers.uploadText('Feature.txt', B_TEXT);
  assert.notEqual(b.id, a.id);
  const jobB = (await s.client.post('/jobs', { projectId: project.id, sourceId: b.id })).body.record;
  assert.notEqual(jobB.jobId, jobA.jobId);

  const viewA = (await s.client.get(`/jobs/${jobA.jobId}/revisions/1`)).body;
  assert.equal(viewA.record.source.id, a.id);
  assert.equal(viewA.record.output.sha256, jobA.output.sha256);
  assert.deepEqual(viewA.record.path.waypoints, jobA.path.waypoints);

  const exp = await s.client.post(`/jobs/${jobA.jobId}/revisions/1/export`, { outputSha256: jobA.output.sha256, action: 'save', operator: s.operator });
  assert.equal(exp.status, 200, JSON.stringify(exp.body));
  assert.equal(exp.body.outcome.saved.status, 'saved');
  const saved = fs.readFileSync(path.join(s.exportDir, exp.body.outcome.saved.fileName), 'utf-8');
  assert.equal(sha256(saved), jobA.output.sha256);
  assert.ok(!saved.includes('250,0,100'));
});

test('T20 two tabs: stale base revision conflicts, superseded revisions cannot be exported, concurrent reprocess yields one winner', async (t) => {
  const s = await startTestServer();
  t.after(() => s.close());
  const project = await s.helpers.project();
  const src = await s.helpers.uploadText('straight.txt', STRAIGHT);
  const rec1 = (await s.client.post('/jobs', { projectId: project.id, sourceId: src.id })).body.record;
  await s.helpers.approve(rec1.jobId, 1);

  // Tab 1 reprocesses with a changed clearance → revision 2, reviews invalidated.
  const tab1 = await s.client.post(`/jobs/${rec1.jobId}/revisions`, { baseRevision: 1, parameters: { clearances: { approachLiftMm: 60 } } });
  assert.equal(tab1.status, 201);
  assert.equal(tab1.body.record.revision, 2);
  assert.equal(tab1.body.gates.validation.operatorReview, 'not_reviewed');
  assert.notEqual(tab1.body.record.output.sha256, rec1.output.sha256);

  // Tab 2 still shows revision 1.
  const tab2 = await s.client.post(`/jobs/${rec1.jobId}/revisions`, { baseRevision: 1, parameters: { clearances: { approachLiftMm: 70 } } });
  assert.equal(tab2.status, 409);
  assert.equal(tab2.body.error.code, 'REVISION_CONFLICT');
  const stale = await s.client.post(`/jobs/${rec1.jobId}/revisions/1/export`, { outputSha256: rec1.output.sha256, action: 'save', operator: s.operator });
  assert.equal(stale.status, 403);
  assert.ok(stale.body.error.details.reasons.some((r) => r.code === 'REVISION_SUPERSEDED'));

  // Identical parameters are idempotent.
  const same = await s.client.post(`/jobs/${rec1.jobId}/revisions`, { baseRevision: 2, parameters: { clearances: { approachLiftMm: 60 } } });
  assert.equal(same.status, 200);
  assert.equal(same.body.reused, true);
  assert.equal(same.body.record.revision, 2);

  // Two concurrent reprocess requests from revision 2: exactly one succeeds.
  const results = await Promise.all([
    s.client.post(`/jobs/${rec1.jobId}/revisions`, { baseRevision: 2, parameters: { clearances: { approachLiftMm: 80 } } }),
    s.client.post(`/jobs/${rec1.jobId}/revisions`, { baseRevision: 2, parameters: { clearances: { approachLiftMm: 90 } } }),
  ]);
  assert.deepEqual(results.map((r) => r.status).sort(), [201, 409]);
  const job = (await s.client.get(`/jobs/${rec1.jobId}`)).body.job;
  assert.equal(job.latestRevision, 3);
  assert.deepEqual(job.revisions.map((r) => r.revision), [1, 2, 3]);
});

test('T08 near-straight arc: blocked by default; explicit conversion is revision-bound and needs acknowledgement', async (t) => {
  const s = await startTestServer();
  t.after(() => s.close());
  const project = await s.helpers.project();
  const src = await s.helpers.uploadText('near.txt', 'units: mm\narc_start: 0,0,0\narc_via: 50,0.05,0\narc_end: 100,0,0\nseam_width: 4\n');
  const blocked = await s.client.post('/jobs', { projectId: project.id, sourceId: src.id });
  assert.equal(blocked.status, 422);
  assert.ok(blocked.body.error.diagnostics.some((d) => d.code === 'ARC_NEAR_STRAIGHT'));

  const conv = await s.client.post('/jobs', { projectId: project.id, sourceId: src.id, parameters: { nearStraightArcPolicy: 'convert_to_line' } });
  assert.equal(conv.status, 201);
  assert.ok(conv.body.gates.acknowledgements.missing.includes('ARC_CONVERTED_TO_LINE'));
  assert.equal(conv.body.record.geometry.requestedType, 'arc');
  assert.equal(conv.body.record.geometry.plannedType, 'straight');
  const jobId = conv.body.record.jobId;
  await s.helpers.approve(jobId, 1);

  const next = await s.client.post(`/jobs/${jobId}/revisions`, { baseRevision: 1, parameters: { nearStraightArcPolicy: 'convert_to_line', motion: { weld: { speed: 'v50' } } } });
  assert.equal(next.status, 201);
  assert.ok(next.body.gates.acknowledgements.missing.includes('ARC_CONVERTED_TO_LINE'), 'acknowledgement does not carry over to a new revision');
});

test('demo samples are marked on every record and can never be exported', async (t) => {
  const s = await startTestServer();
  t.after(() => s.close());
  const project = await s.helpers.project();
  const demo = await s.client.post('/sources/demo', { sample: 'arc' });
  assert.equal(demo.status, 201);
  assert.equal(demo.body.source.sourceKind, 'demo');
  assert.match(demo.body.source.id, /^src_demo_/);
  // The same bytes uploaded manually get a different ID, so demo status never leaks.
  const manual = await s.helpers.uploadText('Feature_Arc_Sample.txt', ARC);
  assert.notEqual(manual.id, demo.body.source.id);

  const job = (await s.client.post('/jobs', { projectId: project.id, sourceId: demo.body.source.id })).body;
  assert.equal(job.record.source.kind, 'demo');
  await s.helpers.approve(job.record.jobId, 1);
  const exp = await s.client.post(`/jobs/${job.record.jobId}/revisions/1/export`, { outputSha256: job.record.output.sha256, action: 'save_and_launch', operator: s.operator });
  assert.equal(exp.status, 403);
  assert.ok(exp.body.error.details.reasons.some((r) => r.code === 'DEMO_SOURCE'));
  assert.equal(s.launcher.calls.length, 0);
  assert.equal((await s.client.post('/sources/demo', { sample: '../../etc' })).status, 422);
});

test('T24/T25 export outcomes are independent and truthful: save, idempotent save, conflict, missing folder, launch', async (t) => {
  const s = await startTestServer();
  t.after(() => s.close());
  const project = await s.helpers.project();
  const src = await s.helpers.uploadText('arc.txt', ARC);
  const rec = (await s.client.post('/jobs', { projectId: project.id, sourceId: src.id })).body.record;
  await s.helpers.approve(rec.jobId, 1);
  const url = `/jobs/${rec.jobId}/revisions/1/export`;

  const launched = await s.client.post(url, { outputSha256: rec.output.sha256, action: 'save_and_launch', operator: s.operator, fileName: '..\\..\\evil.bat', code: 'bad' });
  assert.equal(launched.status, 200, JSON.stringify(launched.body));
  assert.equal(launched.body.outcome.saved.status, 'saved');
  assert.equal(launched.body.outcome.launch.status, 'process_started');
  assert.match(launched.body.outcome.saved.fileName, /^VD_[a-f0-9]{8}_r1_[a-f0-9]{8}\.mod$/);
  assert.equal(launched.body.outcome.saved.absolutePath, undefined);
  assert.deepEqual(fs.readdirSync(s.exportDir), [launched.body.outcome.saved.fileName]);
  assert.equal(s.launcher.calls.length, 1);
  assert.equal(path.dirname(s.launcher.calls[0]), fs.realpathSync(s.exportDir));
  assert.equal(launched.body.gates.validation.robotStudio, 'not_run', 'a process start is not validation');

  const again = await s.client.post(url, { outputSha256: rec.output.sha256, action: 'save', operator: s.operator });
  assert.equal(again.body.outcome.saved.status, 'already_saved');
  assert.equal(again.body.outcome.launch, null);

  fs.writeFileSync(path.join(s.exportDir, launched.body.outcome.saved.fileName), 'someone else\'s file');
  const conflict = await s.client.post(url, { outputSha256: rec.output.sha256, action: 'save_and_launch', operator: s.operator });
  assert.equal(conflict.body.outcome.saved.status, 'failed');
  assert.equal(conflict.body.outcome.saved.code, 'EXPORT_FILE_CONFLICT');
  assert.equal(conflict.body.outcome.launch.status, 'not_attempted');
  assert.equal(fs.readFileSync(path.join(s.exportDir, launched.body.outcome.saved.fileName), 'utf-8'), 'someone else\'s file');

  fs.rmSync(s.exportDir, { recursive: true, force: true });
  const missing = await s.client.post(url, { outputSha256: rec.output.sha256, action: 'save', operator: s.operator });
  assert.equal(missing.body.outcome.saved.code, 'EXPORT_DIR_MISSING');

  // Evidence is bound to the output AND configuration identity (contract change in the offline milestone).
  const evidence = await s.client.post(`/jobs/${rec.jobId}/revisions/1/evidence`, { operator: s.operator, result: 'pass', outputSha256: rec.output.sha256, configurationSha256: launched.body.gates.identity.configurationSha256, robotStudioVersion: '2026.1', notes: 'Imported and syntax-checked manually.' });
  assert.equal(evidence.status, 200);
  assert.equal(evidence.body.gates.validation.robotStudio, 'operator_reported_pass');
  assert.equal((await s.client.post(`/jobs/${rec.jobId}/revisions/1/evidence`, { operator: s.operator, result: 'pass', outputSha256: 'b'.repeat(64) })).status, 409);
});

test('T11 point list (testing mode) goes through the canonical job and common compiler', async (t) => {
  const s = await startTestServer();
  t.after(() => s.close());
  const project = await s.helpers.project();
  const doc = { units: 'mm', orientationConvention: 'euler_zyx_deg', configurationPolicy: 'fixed_zero', rows: [
    { rowNumber: 2, name: 'home', x: '800', y: '0', z: '600', rx: '0', ry: '180', rz: '0' },
    { rowNumber: 3, name: 'P1', x: '450.5', y: '12.2', z: '400.1', rx: '90', ry: '0', rz: '-90' },
    { rowNumber: 4, name: 'P2', x: '472.1', y: '35.4', z: '395.2', rx: '90', ry: '0', rz: '-90', injected: 'x' },
  ] };
  const src = await s.client.post('/sources/point-list', { displayName: 'points.csv', document: doc });
  assert.equal(src.status, 201);
  assert.equal(src.body.preview.ok, true);
  const job = await s.client.post('/jobs', { projectId: project.id, sourceId: src.body.source.id });
  assert.equal(job.status, 201, JSON.stringify(job.body));
  assert.equal(job.body.record.mode, 'testing');
  assert.match(job.body.record.output.code, /PROC main\(\)\n {8}Path_10;/);
  assert.equal(job.body.record.profile.id, 'point-list-linear');
  const wrongProfile = await s.client.post('/jobs', { projectId: project.id, sourceId: src.body.source.id, parameters: { profileId: 'fixed-base-quaternion' } });
  assert.equal(wrongProfile.status, 422);
});

test('T30 projects and jobs are distinct and restorable', async (t) => {
  const s = await startTestServer();
  t.after(() => s.close());
  const p1 = await s.helpers.project('Line 1');
  const p2 = await s.helpers.project('Line 2');
  const src = await s.helpers.uploadText('straight.txt', STRAIGHT);
  const j1 = (await s.client.post('/jobs', { projectId: p1.id, sourceId: src.id })).body.record;
  const list = (await s.client.get('/projects')).body.projects;
  assert.equal(list.length, 2);
  assert.equal((await s.client.get(`/projects/${p1.id}`)).body.jobs[0].id, j1.jobId);
  assert.equal((await s.client.get(`/projects/${p2.id}`)).body.jobs.length, 0);
  assert.equal((await s.client.post('/projects', { name: '' })).status, 422);
  assert.equal((await s.client.get('/projects/prj_../../etc')).status, 404);
  // A fresh store instance on the same data directory restores the same records.
  const { createJobStore } = require('../services/jobs/jobStore');
  const reopened = createJobStore({ dataDir: s.config.dataDir });
  const rec = await reopened.getRevision(j1.jobId, 1);
  assert.equal(rec.output.sha256, j1.output.sha256);
});
