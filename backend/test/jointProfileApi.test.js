/**
 * Joint-relative profile through the real API: revisions, gates, synthetic
 * restrictions, evidence binding, source provenance and offline evidence packages.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync, spawnSync } = require('child_process');
const { startTestServer, readSample, ORIGIN } = require('./helpers');
const { sha256 } = require('../services/util/hash');
const q = require('../services/validation/quaternion');

const VERIFIER = path.join(__dirname, '..', '..', 'scripts', 'verify-evidence-package.mjs');
// SYNTHETIC FIXTURE: a straight 200 mm seam along +X in the robot base frame. Not a measurement.
const FIXTURE = 'units: mm\n# SYNTHETIC FIXTURE: straight fillet seam along +X (not a measurement)\ncurve: 400, 100, 300, 600, 100, 300, 5\n';
const WALL_LEFT = { kind: 'template', template: 'fillet90_wall_left', referenceNormal: [0, 0, 1] };
const SYNTH = { profileId: 'joint-relative-fillet', station: { id: 'synthetic-tool-z-approach' }, joint: WALL_LEFT, orientation: { workAngleDeg: 45, pushAngleDeg: 10 } };
const declared = (note, extra = {}) => ({
  profileId: 'joint-relative-fillet',
  station: { id: 'operator-declared', toolName: 'tWeldGun', wobjName: 'wobj0', toolConvention: { approachAxis: '+Z', rollAxis: '+X', rollReference: 'travel' }, note, ...extra },
  joint: WALL_LEFT,
  orientation: { workAngleDeg: 45, pushAngleDeg: 10 },
});
const codesOf = (r) => (r.body.error && r.body.error.diagnostics ? r.body.error.diagnostics.map((d) => d.code) : []);

async function uploadWithProvenance(s, name, content, provenance) {
  const form = new FormData();
  form.append('files', new Blob([content]), name);
  if (provenance) { form.append('provenance', provenance); form.append('operator', s.operator); form.append('note', 'test fixture'); }
  const r = await fetch(`${s.base}/sources`, { method: 'POST', headers: { Origin: ORIGIN, 'X-VD-CSRF': s.csrfToken }, body: form });
  const body = await r.json();
  assert.equal(r.status, 201, JSON.stringify(body));
  return body.sources[0];
}

async function postPackage(s, rec, gates, overrides = {}, headers = {}) {
  const r = await fetch(`${s.base}/jobs/${rec.jobId}/revisions/${rec.revision}/evidence-package`, {
    method: 'POST',
    headers: { Origin: ORIGIN, 'X-VD-CSRF': s.csrfToken, 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify({ outputSha256: rec.output.sha256, configurationSha256: gates.identity.configurationSha256, operator: s.operator, ...overrides }),
  });
  const buf = Buffer.from(await r.arrayBuffer());
  let json = null;
  try { json = JSON.parse(buf.toString('utf-8')); } catch { /* zip */ }
  return { status: r.status, buf, json, headers: r.headers };
}

test('joint-relative revision: tables, preview data and module consume the same stored targets; mathematical check recorded', async (t) => {
  const s = await startTestServer();
  t.after(() => s.close());
  const project = await s.helpers.project();
  const src = await uploadWithProvenance(s, 'fixture.txt', FIXTURE, 'synthetic_fixture');
  const r = await s.client.post('/jobs', { projectId: project.id, sourceId: src.source.id, parameters: SYNTH });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  const rec = r.body.record;
  for (const wp of rec.path.waypoints) {
    assert.ok(rec.output.code.includes(`CONST robtarget ${wp.name}:=[[${wp.pos.join(',')}],[${wp.orient.join(',')}],`), wp.name);
  }
  assert.equal(rec.orientation.recovered.status, 'mathematical_check_passed');
  assert.deepEqual(rec.orientation.recovered.quaternion, rec.path.waypoints.find((w) => w.type === 'weld_start').orient);
  assert.equal(r.body.gates.validation.orientationCheck, 'mathematical_check_passed');
  assert.equal(r.body.gates.validation.robotStudio, 'not_run');
  assert.match(rec.output.code, /! SYNTHETIC FIXTURE CONFIGURATION/);
  assert.match(rec.output.code, /tSYNTH_Z_APPROACH\\WObj:=wobjSYNTH;/);
  assert.ok(!rec.output.code.includes(rec.output.sha256), 'module never contains its own hash');
  assert.ok(!rec.output.code.includes(rec.configurationSha256), 'configuration digest is not written into the module either');
  // Approach, retract and standby lie in the open quadrant of the declared joint (above the floor, away from the wall).
  const start = rec.path.waypoints.find((w) => w.type === 'weld_start').pos;
  for (const type of ['approach', 'retract', 'home']) {
    const p = rec.path.waypoints.find((w) => w.type === type).pos;
    const ref = type === 'retract' ? rec.path.waypoints.find((w) => w.type === 'weld_end').pos : start;
    assert.ok(p[2] - ref[2] > 0 && p[1] - ref[1] < 0, `${type} ${p}`);
  }
  // Independent check from the stored quaternion: approach tilted +10° towards travel (+X).
  const a = q.rotateVector(rec.path.waypoints[2].orient, [0, 0, 1]);
  assert.ok(Math.abs(Math.asin(a[0]) * 180 / Math.PI - 10) < 1e-5);
  assert.deepEqual(r.body.gates.acknowledgements.missing.sort(), ['COORDINATE_AND_TOOL_ASSUMPTIONS', 'JOINT_FRAME_OPERATOR_DECLARED', 'STATION_PROFILE_SYNTHETIC']);
  assert.equal(rec.source.provenance.value, 'synthetic_fixture');
  assert.equal(rec.source.transport, 'manual_upload');
});

test('unsupported combinations are rejected explicitly: arcs, unresolved real station, missing joint, bad frames', async (t) => {
  const s = await startTestServer();
  t.after(() => s.close());
  const project = await s.helpers.project();
  const arc = await s.helpers.uploadText('arc.txt', readSample('Feature_Arc_Sample.txt'));
  const straight = await s.helpers.uploadText('fixture.txt', FIXTURE);
  const post = (sourceId, parameters) => s.client.post('/jobs', { projectId: project.id, sourceId, parameters });
  assert.ok(codesOf(await post(arc.id, SYNTH)).includes('ORIENTATION_ARC_UNSUPPORTED'));
  assert.ok(codesOf(await post(straight.id, { ...SYNTH, station: { id: 'real-station-unresolved' } })).includes('STATION_TOOL_CONVENTION_UNKNOWN'));
  assert.ok(codesOf(await post(straight.id, { ...SYNTH, joint: undefined })).includes('PARAM_JOINT_REQUIRED'));
  assert.ok(codesOf(await post(straight.id, { ...SYNTH, station: undefined })).includes('PARAM_STATION_REQUIRED'));
  assert.ok(codesOf(await post(straight.id, { ...SYNTH, joint: { kind: 'explicit_normals', normalA: [0, 0, 1], normalB: [1, 0, 0] } })).includes('JOINT_SEAM_INCONSISTENT'));
  assert.ok(codesOf(await post(straight.id, { ...SYNTH, joint: { kind: 'explicit_frame', xAxis: [1, 0, 0], yAxis: [0, 1, 0], zAxis: [0, 0, -1] } })).includes('JOINT_FRAME_LEFT_HANDED'));
  assert.ok(codesOf(await post(straight.id, { ...SYNTH, toolName: 'tWeldGun' })).includes('PARAM_UNKNOWN'));
  assert.ok(codesOf(await post(straight.id, { ...SYNTH, orientation: { workAngleDeg: 5 } })).includes('ORIENTATION_ANGLE_OUT_OF_RANGE'));
  assert.equal((await s.client.get(`/projects/${project.id}`)).body.jobs.length, 0, 'no job created by any rejected request');
});

test('synthetic configuration and fixture: ordinary export blocked, offline package allowed and independently verifiable', async (t) => {
  const s = await startTestServer();
  t.after(() => s.close());
  const project = await s.helpers.project();
  const src = await uploadWithProvenance(s, 'fixture.txt', FIXTURE, 'synthetic_fixture');
  const { record: rec } = (await s.client.post('/jobs', { projectId: project.id, sourceId: src.source.id, parameters: SYNTH })).body;

  const early = await postPackage(s, rec, (await s.client.get(`/jobs/${rec.jobId}/revisions/1`)).body.gates);
  assert.equal(early.status, 403);
  assert.equal(early.json.error.code, 'PACKAGE_BLOCKED');

  const approved = await s.helpers.approve(rec.jobId, 1);
  const reasons = approved.gates.export.reasons.map((x) => x.code);
  assert.deepEqual(reasons.sort(), ['SYNTHETIC_CONFIGURATION', 'SYNTHETIC_SOURCE']);
  assert.equal(approved.gates.package.allowed, true);
  const exp = await s.client.post(`/jobs/${rec.jobId}/revisions/1/export`, { outputSha256: rec.output.sha256, action: 'save_and_launch', operator: s.operator });
  assert.equal(exp.status, 403);
  assert.equal((await s.client.get(`/jobs/${rec.jobId}/revisions/1/module?outputSha256=${rec.output.sha256}`)).status, 403);
  assert.equal(s.launcher.calls.length, 0);
  assert.deepEqual(fs.readdirSync(s.exportDir), []);

  assert.equal((await postPackage(s, rec, approved.gates, {}, { 'X-VD-CSRF': 'x'.repeat(64) })).status, 403, 'CSRF protected');
  assert.equal((await postPackage(s, rec, approved.gates, {}, { Origin: 'https://evil.example' })).status, 403, 'origin protected');
  assert.equal((await postPackage(s, rec, approved.gates, { configurationSha256: 'c'.repeat(64) })).status, 409);
  assert.equal((await postPackage(s, rec, approved.gates, { outputSha256: 'd'.repeat(64) })).status, 409);
  assert.equal((await postPackage(s, rec, approved.gates, { operator: '' })).status, 422);

  const pkg = await postPackage(s, rec, approved.gates);
  assert.equal(pkg.status, 200, pkg.json && JSON.stringify(pkg.json));
  assert.equal(pkg.headers.get('content-type'), 'application/zip');
  assert.equal(pkg.headers.get('x-vd-package-sha256'), sha256(pkg.buf));
  assert.match(pkg.headers.get('x-vd-file-name'), /^VD_evidence_[a-f0-9]{8}_r1_[a-f0-9]{8}\.zip$/);
  // No absolute private paths anywhere in the (stored, uncompressed) archive.
  const latin = pkg.buf.toString('latin1');
  for (const p of [s.tmp, os.homedir(), path.resolve(__dirname, '..', '..')]) assert.ok(!latin.includes(p) && !latin.includes(p.replace(/\\/g, '\\\\')), p);

  const zipPath = path.join(s.tmp, 'package.zip');
  fs.writeFileSync(zipPath, pkg.buf);
  const report = JSON.parse(execFileSync(process.execPath, [VERIFIER, zipPath, '--json'], { encoding: 'utf-8' }));
  assert.equal(report.ok, true, JSON.stringify(report.checks.filter((c) => !c.ok)));
  assert.equal(report.identity.outputSha256, rec.output.sha256);
  assert.equal(report.identity.configurationSha256, rec.configurationSha256);
  assert.equal(report.identity.sourceSha256, sha256(FIXTURE));
  assert.deepEqual(report.synthetic, { source: true, configuration: true });
  assert.match(latin, /\*\*Result\*\* \| \*\*NOT RUN\*\*/);
  assert.match(latin, /"status": "NOT RUN"/);

  // Tampering with the module inside the archive is detected by the independent verifier.
  const tampered = Buffer.from(pkg.buf);
  const at = tampered.indexOf(Buffer.from('MoveL Target_40'));
  tampered[at + 6] = 'X'.charCodeAt(0);
  fs.writeFileSync(zipPath, tampered);
  assert.equal(spawnSync(process.execPath, [VERIFIER, zipPath]).status, 1);

  const log = (await s.client.get(`/jobs/${rec.jobId}/revisions/1`)).body.review.exports;
  assert.equal(log[log.length - 1].action, 'offline_evidence_package');
  assert.equal(log[log.length - 1].packageSha256, sha256(pkg.buf));
});

test('demo restriction is separate: demo sources cannot be exported or packaged', async (t) => {
  const s = await startTestServer();
  t.after(() => s.close());
  const project = await s.helpers.project();
  const demo = (await s.client.post('/sources/demo', { sample: 'straight' })).body.source;
  const { record: rec } = (await s.client.post('/jobs', { projectId: project.id, sourceId: demo.id })).body;
  const approved = await s.helpers.approve(rec.jobId, 1);
  assert.deepEqual(approved.gates.export.reasons.map((x) => x.code), ['DEMO_SOURCE']);
  assert.deepEqual(approved.gates.package.reasons.map((x) => x.code), ['DEMO_SOURCE']);
  const pkg = await postPackage(s, rec, approved.gates);
  assert.equal(pkg.status, 403);
  assert.ok(pkg.json.error.details.reasons.some((x) => x.code === 'DEMO_SOURCE'));
});

test('operator-declared station: metadata-only change gives identical module bytes but a new configuration identity; reviews and evidence do not carry over', async (t) => {
  const s = await startTestServer();
  t.after(() => s.close());
  const project = await s.helpers.project();
  const src = await s.helpers.uploadText('fixture.txt', FIXTURE);
  const r1 = (await s.client.post('/jobs', { projectId: project.id, sourceId: src.id, parameters: declared('Declared from team notes, draft 1') })).body;
  assert.ok(r1.gates.acknowledgements.missing.includes('STATION_PROFILE_OPERATOR_DECLARED'));
  const v1 = await s.helpers.approve(r1.record.jobId, 1);
  assert.equal(v1.gates.export.allowed, true, JSON.stringify(v1.gates.export.reasons));
  const base = `/jobs/${r1.record.jobId}/revisions/1`;

  const noConfig = await s.client.post(`${base}/evidence`, { operator: s.operator, result: 'pass', outputSha256: r1.record.output.sha256 });
  assert.equal(noConfig.status, 409);
  assert.equal(noConfig.body.error.code, 'CONFIGURATION_HASH_MISMATCH');
  const ev = await s.client.post(`${base}/evidence`, { operator: s.operator, result: 'pass', outputSha256: r1.record.output.sha256, configurationSha256: v1.gates.identity.configurationSha256, notes: 'hypothetical test record' });
  assert.equal(ev.status, 200);
  assert.equal(ev.body.gates.validation.robotStudio, 'operator_reported_pass');
  assert.equal(ev.body.review.externalEvidence[0].evidenceProvenance, 'operator_reported');

  // Same numbers, different declaration note → same bytes, new configuration → new revision.
  const r2 = await s.client.post(`/jobs/${r1.record.jobId}/revisions`, { baseRevision: 1, parameters: declared('Declared from team notes, draft 2') });
  assert.equal(r2.status, 201, JSON.stringify(r2.body));
  assert.equal(r2.body.reused, false);
  assert.equal(r2.body.record.output.sha256, r1.record.output.sha256, 'module bytes identical');
  assert.notEqual(r2.body.record.configurationSha256, r1.record.configurationSha256);
  assert.notEqual(r2.body.record.parametersSha256, r1.record.parametersSha256);
  assert.equal(r2.body.review.geometryReview, null);
  assert.equal(r2.body.review.externalEvidence.length, 0);
  assert.equal(r2.body.gates.validation.robotStudio, 'not_run');
  const stale = await s.client.post(`/jobs/${r1.record.jobId}/revisions/2/evidence`, { operator: s.operator, result: 'pass', outputSha256: r1.record.output.sha256, configurationSha256: r1.record.configurationSha256 });
  assert.equal(stale.status, 409, 'rev-1 configuration identity cannot validate rev 2');

  // Citing external evidence changes the provenance category. The category is printed in the module header
  // (so a reader of the .mod sees it), therefore the bytes change too; targets and quaternions do not.
  const r3 = await s.client.post(`/jobs/${r1.record.jobId}/revisions`, { baseRevision: 2, parameters: declared('Declared from team notes, draft 2', { evidenceReference: 'Torch calibration sheet TC-01 (held by the team)' }) });
  assert.equal(r3.status, 201);
  assert.equal(r3.body.record.configuration.station.provenance, 'operator_reported_external_evidence');
  assert.match(r3.body.record.output.code, /\(operator_reported_external_evidence\)/);
  assert.notEqual(r3.body.record.output.sha256, r1.record.output.sha256);
  assert.deepEqual(r3.body.record.path.waypoints, r1.record.path.waypoints);

  // A joint change produces a different module and again fresh reviews.
  const r4 = await s.client.post(`/jobs/${r1.record.jobId}/revisions`, { baseRevision: 3, parameters: { ...declared('Declared from team notes, draft 2'), joint: { ...WALL_LEFT, template: 'fillet90_wall_right' } } });
  assert.equal(r4.status, 201);
  assert.notEqual(r4.body.record.output.sha256, r1.record.output.sha256);
  assert.equal(r4.body.gates.validation.operatorReview, 'not_reviewed');

  // Identical parameters are still idempotent.
  const same = await s.client.post(`/jobs/${r1.record.jobId}/revisions`, { baseRevision: 4, parameters: { ...declared('Declared from team notes, draft 2'), joint: { ...WALL_LEFT, template: 'fillet90_wall_right' } } });
  assert.equal(same.status, 200);
  assert.equal(same.body.reused, true);
  assert.equal((await s.client.post(`${base}/export`, { outputSha256: r1.record.output.sha256, action: 'save', operator: s.operator })).status, 403, 'rev 1 superseded');
});

test('source provenance is separate from transport, append-only, and a changed declaration creates a new revision', async (t) => {
  const s = await startTestServer();
  t.after(() => s.close());
  const project = await s.helpers.project();
  const src = await s.helpers.uploadText('Feature.txt', readSample('Feature_Straight_Sample.txt'));
  const detail = await s.client.get(`/sources/${src.id}`);
  assert.equal(detail.body.provenance.effective.value, 'user_supplied_unverified');
  assert.equal(detail.body.provenance.effective.declared, false);
  assert.equal(detail.body.provenance.transport, 'manual_upload');

  const j1 = (await s.client.post('/jobs', { projectId: project.id, sourceId: src.id })).body.record;
  // Legacy straight module bytes are unchanged by this milestone (baseline hash recorded before any edit).
  assert.equal(j1.output.sha256, '30791efbb5d8e7221752f79869e1f31898226934dbcd84c84414d8a1b25fe613');

  assert.equal((await s.client.post(`/sources/${src.id}/provenance`, { provenance: 'recorded_device_export', note: 'x' })).status, 422, 'operator required');
  assert.equal((await s.client.post(`/sources/${src.id}/provenance`, { provenance: 'camera_verified', operator: s.operator })).status, 422);
  const dec = await s.client.post(`/sources/${src.id}/provenance`, { provenance: 'recorded_device_export', operator: s.operator, note: 'Exported by the team from TracerStudio on the lab PC (operator statement)' });
  assert.equal(dec.status, 200, JSON.stringify(dec.body));
  assert.equal(dec.body.provenance.effective.value, 'recorded_device_export');
  assert.equal(dec.body.provenance.effective.declaredBy, s.operator);
  assert.equal(dec.body.provenance.transport, 'manual_upload', 'transport unchanged');

  const again = await s.client.post(`/jobs/${j1.jobId}/revisions`, { baseRevision: 1 });
  assert.equal(again.status, 201, 'provenance change is not silently reused');
  assert.equal(again.body.record.source.provenance.value, 'recorded_device_export');
  assert.equal(again.body.record.output.sha256, j1.output.sha256);
  const revisit = (await s.client.get(`/jobs/${j1.jobId}/revisions/1`)).body.record;
  assert.equal(revisit.source.provenance.value, 'user_supplied_unverified', 'revision 1 keeps its snapshot');
  assert.equal((await s.client.post(`/jobs/${j1.jobId}/revisions`, { baseRevision: 2 })).body.reused, true);

  // Copying bytes into the watched folder never implies device acquisition.
  fs.writeFileSync(path.join(s.inbox, 'copied.txt'), readSample('Feature_Straight_Sample.txt').replace('5.53833', '5.5'));
  await s.client.post('/watch-folder/scan');
  const scanned = await s.client.post('/watch-folder/scan');
  const watched = scanned.body.files.find((f) => f.name === 'copied.txt');
  const w = await s.client.get(`/sources/${watched.sourceId}`);
  assert.equal(w.body.provenance.transport, 'watch_folder');
  assert.equal(w.body.provenance.effective.value, 'user_supplied_unverified');
});
