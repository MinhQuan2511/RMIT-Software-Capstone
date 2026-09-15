/**
 * Workpiece geometry and clearance through the real API: revision identity,
 * job isolation, backend export gate, evidence package and legacy behaviour.
 * All geometry and fixtures are SYNTHETIC.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { startTestServer, readSample, ORIGIN } = require('./helpers');
const { SEAM_TEXT, SEAM, filletOnSeam, SYNTH_JOINT, SYNTHETIC_Z_APPROACH } = require('./geometryFixtures');
const { evaluate } = require('../services/jobs/jobService');
const { buildEvidencePackage } = require('../services/packages/evidencePackage');

const VERIFIER = path.join(__dirname, '..', '..', 'scripts', 'verify-evidence-package.mjs');
const LEGACY_SEAM = { start: [414.69, 1112.75, 320.342], end: [338.531, 1333.74, 322.068] };
const LEGACY_HASH = '30791efbb5d8e7221752f79869e1f31898226934dbcd84c84414d8a1b25fe613';

async function packageFor(s, rec, gates) {
  const r = await fetch(`${s.base}/jobs/${rec.jobId}/revisions/${rec.revision}/evidence-package`, {
    method: 'POST',
    headers: { Origin: ORIGIN, 'X-VD-CSRF': s.csrfToken, 'Content-Type': 'application/json' },
    body: JSON.stringify({ outputSha256: rec.output.sha256, configurationSha256: gates.identity.configurationSha256, operator: s.operator }),
  });
  return { status: r.status, buf: Buffer.from(await r.arrayBuffer()) };
}

function verify(tmp, buf, name = 'pkg.zip') {
  const file = path.join(tmp, name);
  fs.writeFileSync(file, buf);
  const run = spawnSync(process.execPath, [VERIFIER, file, '--json'], { encoding: 'utf-8' });
  return { exit: run.status, report: JSON.parse(run.stdout) };
}

test('geometry or envelope changes create a new revision with empty reviews even when the module bytes are identical', async (t) => {
  const s = await startTestServer();
  t.after(() => s.close());
  const project = await s.helpers.project();
  const src = await s.helpers.uploadText('fixture.txt', SEAM_TEXT);
  const params = SYNTH_JOINT({ workpiece: filletOnSeam(SEAM), joint: { kind: 'workpiece' }, toolEnvelope: SYNTHETIC_Z_APPROACH });
  const r1 = await s.client.post('/jobs', { projectId: project.id, sourceId: src.id, parameters: params });
  assert.equal(r1.status, 201, JSON.stringify(r1.body));
  const rec1 = r1.body.record;
  assert.equal(rec1.clearance.identity.configurationSha256, rec1.configurationSha256);
  assert.equal(rec1.clearance.identity.outputSha256, rec1.output.sha256);
  assert.equal(rec1.workpiece.label, 'Operator-defined geometry');
  assert.deepEqual(rec1.configuration.workpiece, rec1.workpiece.definition);
  const approved = await s.helpers.approve(rec1.jobId, 1);
  assert.ok(approved.review.moduleReview);
  const base = `/jobs/${rec1.jobId}`;

  const thicker = { ...params, workpiece: { ...params.workpiece, plateA: { thicknessMm: 12, openSideWidthMm: 150 } } };
  const r2 = await s.client.post(`${base}/revisions`, { baseRevision: 1, parameters: thicker });
  assert.equal(r2.status, 201, JSON.stringify(r2.body));
  assert.equal(r2.body.record.output.sha256, rec1.output.sha256, 'plate thickness does not change the module');
  assert.notEqual(r2.body.record.configurationSha256, rec1.configurationSha256);
  assert.notEqual(r2.body.record.workpiece.definitionSha256, rec1.workpiece.definitionSha256);
  assert.equal(r2.body.review.geometryReview, null);
  assert.equal(r2.body.review.moduleReview, null);
  assert.equal(r2.body.record.clearance.identity.configurationSha256, r2.body.record.configurationSha256);

  const envelope = { ...SYNTHETIC_Z_APPROACH, capsules: [{ id: 'body', fromToolMm: [0, 0, -20], toToolMm: [0, 0, -250], radiusMm: 11 }] };
  const r3 = await s.client.post(`${base}/revisions`, { baseRevision: 2, parameters: { ...thicker, toolEnvelope: envelope } });
  assert.equal(r3.status, 201);
  assert.equal(r3.body.record.output.sha256, rec1.output.sha256);
  assert.notEqual(r3.body.record.configurationSha256, r2.body.record.configurationSha256);
  assert.equal(r3.body.record.toolEnvelope.definition.capsules[0].radiusMm, 11);

  const same = await s.client.post(`${base}/revisions`, { baseRevision: 3, parameters: { ...thicker, toolEnvelope: envelope } });
  assert.equal(same.status, 200);
  assert.equal(same.body.reused, true);

  const stale = await s.client.post(`${base}/revisions/3/evidence`, { operator: s.operator, result: 'pass', outputSha256: rec1.output.sha256, configurationSha256: rec1.configurationSha256 });
  assert.equal(stale.status, 409, 'evidence for the rev-1 geometry cannot attach to rev 3');
  const again = (await s.client.get(`${base}/revisions/1`)).body.record;
  assert.deepEqual(again.clearance, rec1.clearance, 'revision 1 keeps its own clearance record');
});

test('a second job does not replace the first job\'s geometry or clearance evidence', async (t) => {
  const s = await startTestServer();
  t.after(() => s.close());
  const project = await s.helpers.project();
  const src = await s.helpers.uploadText('fixture.txt', SEAM_TEXT);
  const tee = SYNTH_JOINT({ workpiece: filletOnSeam(SEAM), joint: { kind: 'workpiece' }, toolEnvelope: SYNTHETIC_Z_APPROACH });
  const corner = SYNTH_JOINT({ workpiece: filletOnSeam({ ...SEAM, side: 'right', arrangement: 'corner' }), joint: { kind: 'workpiece' }, toolEnvelope: SYNTHETIC_Z_APPROACH });
  const [a, b] = await Promise.all([
    s.client.post('/jobs', { projectId: project.id, sourceId: src.id, parameters: tee }),
    s.client.post('/jobs', { projectId: project.id, sourceId: src.id, parameters: corner }),
  ]);
  assert.equal(a.status, 201);
  assert.equal(b.status, 201);
  assert.notEqual(a.body.record.jobId, b.body.record.jobId);
  const b2 = await s.client.post(`/jobs/${b.body.record.jobId}/revisions`, { baseRevision: 1, parameters: { ...corner, workpiece: { ...corner.workpiece, plateB: { thicknessMm: 20, openSideHeightMm: 40 } } } });
  assert.equal(b2.status, 201);
  const a1 = (await s.client.get(`/jobs/${a.body.record.jobId}/revisions/1`)).body;
  assert.equal(a1.job.latestRevision, 1);
  assert.equal(a1.record.workpiece.arrangement, 'tee');
  assert.deepEqual(a1.record.workpiece, a.body.record.workpiece);
  assert.deepEqual(a1.record.clearance, a.body.record.clearance);
  assert.equal(b2.body.record.workpiece.arrangement, 'corner');
  assert.notEqual(b2.body.record.workpiece.definitionSha256, a1.record.workpiece.definitionSha256);
});

test('a definite intersection with operator-defined plates blocks export in the backend; the package keeps the failure; correcting the side unblocks', async (t) => {
  const s = await startTestServer();
  t.after(() => s.close());
  const project = await s.helpers.project();
  const src = await s.helpers.uploadText('Feature.txt', readSample('Feature_Straight_Sample.txt'));
  // Legacy approach/retract offsets go 35 mm LEFT of travel; a declared wall on the left is crossed.
  const wrongSide = { workpiece: filletOnSeam({ ...LEGACY_SEAM, side: 'left' }) };
  const r1 = await s.client.post('/jobs', { projectId: project.id, sourceId: src.id, parameters: wrongSide });
  assert.equal(r1.status, 201, JSON.stringify(r1.body));
  const rec = r1.body.record;
  assert.equal(rec.output.sha256, LEGACY_HASH, 'the diagnostic plan keeps the exact module bytes');
  assert.equal(rec.clearance.overall.result, 'intersection_detected');
  assert.ok(rec.diagnostics.some((d) => d.code === 'WORKPIECE_INTERSECTION_DETECTED'));
  const approved = await s.helpers.approve(rec.jobId, 1);
  assert.deepEqual(approved.gates.export.reasons.map((r) => r.code), ['WORKPIECE_INTERSECTION_DETECTED']);
  assert.equal(approved.gates.validation.workpieceClearance, 'intersection_detected');
  assert.equal(approved.gates.validation.collision, 'not_evaluated', 'robot/cell collision is still not evaluated');
  assert.equal(approved.gates.package.allowed, true);
  const mod = await s.client.get(`/jobs/${rec.jobId}/revisions/1/module?outputSha256=${rec.output.sha256}`);
  assert.equal(mod.status, 403);
  assert.ok(mod.body.error.details.reasons.some((r) => r.code === 'WORKPIECE_INTERSECTION_DETECTED'));
  assert.equal((await s.client.post(`/jobs/${rec.jobId}/revisions/1/export`, { outputSha256: rec.output.sha256, action: 'save_and_launch', operator: s.operator })).status, 403);
  assert.equal(s.launcher.calls.length, 0);
  assert.deepEqual(fs.readdirSync(s.exportDir), []);

  const pkg = await packageFor(s, rec, approved.gates);
  assert.equal(pkg.status, 200);
  const { exit, report } = verify(s.tmp, pkg.buf);
  assert.equal(exit, 0, JSON.stringify(report.checks.filter((c) => !c.ok)));
  for (const id of ['clearance_bound_to_output_and_configuration', 'definite_intersection_recorded_as_export_block', 'workpiece_definition_digest_recomputed', 'findings_retained']) {
    assert.ok(report.checks.find((c) => c.id === id && c.ok), id);
  }
  assert.match(pkg.buf.toString('latin1'), /"result": "intersection_detected"/);

  // A manipulated record (status renamed to a pass) is rejected by the independent verifier.
  const view = (await s.client.get(`/jobs/${rec.jobId}/revisions/1`)).body;
  const forged = JSON.parse(JSON.stringify(view.record));
  forged.clearance.overall.result = 'safe';
  const { meta, content } = await s.services.store.getSourceContent(rec.source.id);
  const bad = buildEvidencePackage({
    job: view.job, record: forged, review: view.review, gates: evaluate(view.job, forged, view.review), sourceMeta: meta, sourceContent: content,
    provenanceNow: null, moduleCode: rec.output.code, calibration: null, identity: { sha256: rec.configurationSha256, derived: false, configuration: rec.configuration },
    generator: { note: 'test' }, operator: s.operator, generatedAt: new Date(),
  });
  const forgedReport = verify(s.tmp, bad.buffer, 'forged.zip');
  assert.equal(forgedReport.exit, 1);
  assert.ok(forgedReport.report.checks.some((c) => c.id === 'clearance_statuses_in_scoped_vocabulary' && !c.ok));

  // Correction through a new revision: the wall on the right is not crossed; export follows the ordinary gates again.
  const r2 = await s.client.post(`/jobs/${rec.jobId}/revisions`, { baseRevision: 1, parameters: { workpiece: filletOnSeam({ ...LEGACY_SEAM, side: 'right' }) } });
  assert.equal(r2.status, 201, JSON.stringify(r2.body));
  assert.notEqual(r2.body.record.clearance.overall.result, 'intersection_detected', JSON.stringify(r2.body.record.clearance.findings));
  const v2 = await s.helpers.approve(rec.jobId, 2);
  assert.equal(v2.gates.export.allowed, true, JSON.stringify(v2.gates.export.reasons));
  assert.equal((await s.client.get(`/jobs/${rec.jobId}/revisions/2/module?outputSha256=${LEGACY_HASH}`)).status, 200);
});

test('synthetic restrictions still apply with geometry; illustrative intersections never block or pass', async (t) => {
  const s = await startTestServer();
  t.after(() => s.close());
  const project = await s.helpers.project();
  const src = await s.helpers.uploadText('Feature.txt', readSample('Feature_Straight_Sample.txt'));
  const r = await s.client.post('/jobs', { projectId: project.id, sourceId: src.id, parameters: { workpiece: filletOnSeam({ ...LEGACY_SEAM, side: 'left', provenance: 'illustrative' }) } });
  assert.equal(r.status, 201);
  assert.equal(r.body.record.clearance.overall.result, 'intersection_detected');
  const v = await s.helpers.approve(r.body.record.jobId, 1);
  assert.equal(v.gates.export.allowed, true, 'illustrative geometry is not a declaration about the real part');
  assert.equal(v.gates.validation.workpieceClearance, 'not_assessed_illustrative_geometry');

  const fixture = await s.helpers.uploadText('fixture.txt', SEAM_TEXT);
  const j = await s.client.post('/jobs', { projectId: project.id, sourceId: fixture.id, parameters: SYNTH_JOINT({ workpiece: filletOnSeam(SEAM), joint: { kind: 'workpiece' }, toolEnvelope: SYNTHETIC_Z_APPROACH }) });
  const vj = await s.helpers.approve(j.body.record.jobId, 1);
  assert.deepEqual(vj.gates.export.reasons.map((x) => x.code), ['SYNTHETIC_CONFIGURATION']);
  assert.ok(vj.gates.acknowledgements.given.includes('TOOL_ENVELOPE_SYNTHETIC'));
  const pkg = await packageFor(s, j.body.record, vj.gates);
  assert.equal(pkg.status, 200);
  assert.equal(verify(s.tmp, pkg.buf).exit, 0);
});

test('legacy unknown-geometry workflow: same module, clearance not assessed, no new acknowledgement, older revisions report not recorded', async (t) => {
  const s = await startTestServer();
  t.after(() => s.close());
  const project = await s.helpers.project();
  const src = await s.helpers.uploadText('Feature.txt', readSample('Feature_Straight_Sample.txt'));
  const r = (await s.client.post('/jobs', { projectId: project.id, sourceId: src.id })).body;
  assert.equal(r.record.output.sha256, LEGACY_HASH);
  // The sample has no units line, so UNITS_ASSUMED_MM is required as before; nothing geometry-related is added.
  assert.deepEqual(r.gates.acknowledgements.required, ['COORDINATE_AND_TOOL_ASSUMPTIONS', 'UNITS_ASSUMED_MM']);
  assert.equal(r.record.workpiece.label, 'Workpiece geometry unavailable');
  assert.equal(r.record.clearance.overall.result, 'not_assessed');
  assert.equal(r.gates.validation.workpieceClearance, 'not_assessed');
  const v = await s.helpers.approve(r.record.jobId, 1);
  assert.equal(v.gates.export.allowed, true);

  const old = JSON.parse(JSON.stringify(v.record));
  delete old.clearance; delete old.workpiece; delete old.toolEnvelope;
  const g = evaluate(v.job, old, v.review);
  assert.equal(g.validation.workpieceClearance, 'not_recorded');
  assert.equal(g.export.allowed, true);
});
