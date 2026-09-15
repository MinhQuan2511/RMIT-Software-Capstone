/**
 * Reproducible timing benchmark. See docs/PERFORMANCE_METHOD.md.
 *
 *   node scripts/benchmark.js [--iterations 200] [--out ../docs/benchmarks]
 *
 * Boundaries measured separately (monotonic process.hrtime.bigint()), per input:
 *   parse      parseFeatureText only                      (batched)
 *   plan       planSeam only                               (batched)
 *   compile    compileRapidModule incl. precheck           (batched)
 *   pipeline   profile + parse + plan + compile, no I/O    (batched)
 *   service    jobService.createJob: read stored source and provenance from disk,
 *              pipeline, write revision files (temp data dir)  (per call)
 *   http       POST /api/jobs over loopback from the same process, incl. JSON
 *              and the service boundary above               (per call)
 * Additional boundaries (offline milestone):
 *   orientation         planFilletOrientation (joint-relative planner only)  (batched)
 *   orientationCheck    recoverOrientationAngles on the stored quaternion    (batched)
 *   calibrationInspect  inspectCalibrationFile on the supplied 4×4 YAML      (batched)
 *   packageBuild        buildEvidencePackage from loaded inputs, no I/O      (batched)
 *   packageService      jobService.evidencePackage: disk reads + ZIP + review-log append (per call)
 *   packageHttp         POST …/evidence-package over loopback                (per call)
 * Not measured: browser rendering, user-observed workflow time, RobotStudio.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execSync } = require('child_process');
const { parseFeatureText } = require('../services/parsers/curveParser');
const { planSeam } = require('../services/kinematics/pathPlanner');
const { planFilletOrientation } = require('../services/kinematics/jointOrientation');
const { recoverOrientationAngles } = require('../services/kinematics/orientationCheck');
const { compileRapidModule } = require('../services/compiler/rapidCompiler');
const { inspectCalibrationFile } = require('../services/calibration/calibrationInspector');
const { buildEvidencePackage } = require('../services/packages/evidencePackage');
const { runPipeline, jointHeaderLines, configurationIdentity } = require('../services/jobs/jobService');
const { loadRuntimeConfig } = require('../services/config/runtimeConfig');
const { computeSourceIdentity } = require('../services/util/sourceIdentity');
const { createApp, buildServices } = require('../app');
const { sha256 } = require('../services/util/hash');

const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : fallback;
};
const ITER = Number(arg('iterations', 200));
const OUT = path.resolve(__dirname, arg('out', '../../docs/benchmarks'));
const SAMPLES = path.join(__dirname, '../../samples');
const REPO = path.join(__dirname, '../..');

// SYNTHETIC joint-relative input (not a measurement) and the supplied hand-eye YAML (copied verbatim from the task prompt).
const JOINT_TEXT = 'units: mm\n# SYNTHETIC FIXTURE: straight fillet seam along +X (not a measurement)\ncurve: 400, 100, 300, 600, 100, 300, 5\n';
const JOINT_PARAMS = { profileId: 'joint-relative-fillet', station: { id: 'synthetic-tool-z-approach' }, joint: { kind: 'template', template: 'fillet90_wall_left', referenceNormal: [0, 0, 1] }, orientation: { workAngleDeg: 45, pushAngleDeg: 10 } };
const HAND_EYE_YAML = Buffer.from('%YAML:1.0\n---\ninfo: "4 0 "\nhandEyeMatrix: !!opencv-matrix\n   rows: 4\n   cols: 4\n   dt: f\n   data: [ 5.20042360e-01, -3.76300484e-01, 7.66781509e-01,\n       6.31424316e+02, 8.52015495e-01, 2.91824520e-01, -4.34635490e-01,\n       8.10536682e+02, -6.02121167e-02, 8.79338622e-01, 4.72374976e-01,\n       6.82570953e+01, 0., 0., 0., 1. ]\n');

const now = () => process.hrtime.bigint();
const toMs = (ns) => Number(ns) / 1e6;

function stats(values) {
  const v = [...values].sort((a, b) => a - b);
  const q = (p) => v[Math.min(v.length - 1, Math.ceil(p * v.length) - 1)];
  const mean = v.reduce((a, b) => a + b, 0) / v.length;
  const sd = Math.sqrt(v.reduce((a, b) => a + (b - mean) ** 2, 0) / Math.max(1, v.length - 1));
  return { n: v.length, medianMs: q(0.5), meanMs: mean, p95Ms: q(0.95), minMs: v[0], maxMs: v[v.length - 1], stdevMs: sd };
}

/** Per-call time from batches, so sub-microsecond functions sit well above timer resolution. */
function batched(fn, batchSize, iterations, warmup = 500) {
  for (let i = 0; i < warmup; i += 1) fn();
  const perCall = [];
  for (let b = 0; b < iterations; b += 1) {
    const t0 = now();
    for (let i = 0; i < batchSize; i += 1) fn();
    perCall.push(toMs(now() - t0) / batchSize);
  }
  return { batchSize, perCallMs: perCall };
}

async function perCall(fn, iterations, warmup = 20) {
  for (let i = 0; i < warmup; i += 1) await fn();
  const out = [];
  for (let i = 0; i < iterations; i += 1) {
    const t0 = now();
    await fn();
    out.push(toMs(now() - t0));
  }
  return out;
}

function timerResolutionNs() {
  let min = Infinity;
  for (let i = 0; i < 100000; i += 1) {
    const a = now();
    const b = now();
    const d = Number(b - a);
    if (d > 0 && d < min) min = d;
  }
  return min;
}

function gitInfo() {
  try {
    const head = execSync('git rev-parse HEAD', { cwd: __dirname, encoding: 'utf-8' }).trim();
    const dirty = execSync('git status --porcelain', { cwd: __dirname, encoding: 'utf-8' }).trim().length > 0;
    return { head, dirtyWorkingTree: dirty };
  } catch {
    return { head: null, dirtyWorkingTree: null };
  }
}

const stage = (boundary, r) => (Array.isArray(r)
  ? { boundary, stats: stats(r), raw: r }
  : { boundary, batchSize: r.batchSize, stats: stats(r.perCallMs), raw: r.perCallMs });

async function main() {
  const cases = [
    { file: 'Feature_Straight_Sample.txt', buf: fs.readFileSync(path.join(SAMPLES, 'Feature_Straight_Sample.txt')), parameters: {} },
    { file: 'Feature_Arc_Sample.txt', buf: fs.readFileSync(path.join(SAMPLES, 'Feature_Arc_Sample.txt')), parameters: {} },
    { file: 'synthetic_joint_relative_fixture (inline)', buf: Buffer.from(JOINT_TEXT), parameters: JOINT_PARAMS },
  ].map((c) => {
    const text = c.buf.toString('utf-8');
    const probe = runPipeline({ id: 'src_manual_000000000000000000000000', sha256: sha256(c.buf), contentType: 'feature-text', sourceKind: 'manual_upload' }, c.buf, c.parameters);
    if (!probe.ok) throw new Error(`${c.file}: ${JSON.stringify(probe.diagnostics)}`);
    return { ...c, text, parsed: parseFeatureText(text), probe, sha: sha256(c.buf) };
  });

  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'vd-bench-'));
  const config = loadRuntimeConfig({}, {
    dataDir: path.join(tmp, 'data'), watchConfigPath: path.join(tmp, 'config.json'), exportDir: tmp,
    rateLimits: Object.fromEntries(['upload', 'scan', 'process', 'export', 'launch'].map((k) => [k, { windowMs: 60000, max: 1e9 }])),
  });
  const services = buildServices(config, { launcher: { discover: () => ({ status: 'not_found' }), launch: async () => ({ status: 'not_found' }) }, logger: { error() {} } });
  await services.store.init();
  const app = createApp({ config, ...services });
  const server = await new Promise((resolve) => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  const base = `http://127.0.0.1:${server.address().port}/api`;
  const { csrfToken } = await (await fetch(`${base}/session`)).json();
  const headers = { 'Content-Type': 'application/json', Origin: 'http://localhost:3000', 'X-VD-CSRF': csrfToken };
  const project = await services.store.createProject({ name: 'benchmark' });

  const results = [];
  let jointJob = null;
  for (const c of cases) {
    const { source } = await services.store.putSource({ content: c.buf, kind: 'manual_upload', name: c.file, contentType: 'feature-text' });
    const { profile } = c.probe;
    const provenance = { sourceSha256: c.sha, profileId: `${profile.id}@${profile.version}`, ...(profile.id === 'joint-relative-fillet' ? { headerLines: jointHeaderLines(profile, c.probe.plan) } : {}) };
    const compileInput = { waypoints: c.probe.plan.waypoints, segments: c.probe.plan.segments, profile, provenance };

    const parse = batched(() => parseFeatureText(c.text), 200, ITER);
    const plan = batched(() => planSeam(c.parsed.seam, profile), 200, ITER);
    const compile = batched(() => compileRapidModule(compileInput), 100, ITER);
    const pipeline = batched(() => runPipeline(source, c.buf, c.parameters), 50, ITER);
    const service = await perCall(() => services.jobService.createJob({ projectId: project.id, sourceId: source.id, parameters: c.parameters }), ITER);
    const http = await perCall(async () => {
      const r = await fetch(`${base}/jobs`, { method: 'POST', headers, body: JSON.stringify({ projectId: project.id, sourceId: source.id, parameters: c.parameters }) });
      if (r.status !== 201) throw new Error(`unexpected status ${r.status}`);
      await r.arrayBuffer();
    }, ITER);

    results.push({
      input: { file: c.file, sizeBytes: c.buf.length, sha256: c.sha, targets: c.probe.plan.waypoints.length, profile: `${profile.id}@${profile.version}`, synthetic: profile.id === 'joint-relative-fillet' },
      stages: {
        parse: stage('parseFeatureText', parse),
        plan: stage(profile.id === 'joint-relative-fillet' ? 'planSeam (joint-relative: chord checks + orientation planner + independent check)' : 'planSeam (incl. arc fit for arcs)', plan),
        compile: stage('compileRapidModule (validation + serialisation + precheck + SHA-256)', compile),
        pipeline: stage('runPipeline: profile + parse + plan + compile + configuration digest, no I/O', pipeline),
        service: stage('jobService.createJob: disk read of source and provenance, pipeline, atomic writes of job/revision/module/review files', service),
        http: stage('POST /api/jobs over 127.0.0.1 from the same Node process (client + server share the event loop)', http),
      },
    });
    if (profile.id === 'joint-relative-fillet') jointJob = { source, c };
  }

  // Additional boundaries on the synthetic joint-relative revision.
  const { c } = jointJob;
  const view = await services.jobService.createJob({ projectId: project.id, sourceId: jointJob.source.id, parameters: JOINT_PARAMS });
  const { jobId } = view.record;
  await services.jobService.acknowledge({ jobId, revision: 1, codes: view.gates.acknowledgements.missing, operator: 'benchmark' });
  await services.jobService.review({ jobId, revision: 1, stage: 'geometry', operator: 'benchmark' });
  const approved = await services.jobService.review({ jobId, revision: 1, stage: 'module', operator: 'benchmark' });
  const o = approved.record.orientation;
  const seam = [c.parsed.seam.startPoint, c.parsed.seam.endPoint].map((p) => [p.x, p.y, p.z]);
  const { code } = await services.store.getModuleBytes(jobId, 1);
  const provenanceNow = await services.store.getSourceProvenance(jointJob.source.id);
  const identity = configurationIdentity(approved.record);
  const sourceIdentity = computeSourceIdentity(REPO);
  const pkgInput = { job: approved.job, record: approved.record, review: approved.review, gates: approved.gates, sourceMeta: jointJob.source, sourceContent: c.buf, provenanceNow, moduleCode: code, calibration: null, identity, generator: sourceIdentity, operator: 'benchmark', generatedAt: new Date('2026-01-01T00:00:00Z') };
  const pkgBody = JSON.stringify({ outputSha256: approved.record.output.sha256, configurationSha256: identity.sha256, operator: 'benchmark' });

  const extra = {
    input: { file: 'synthetic_joint_relative_fixture (inline) + supplied hand-eye YAML', packageBytes: buildEvidencePackage(pkgInput).buffer.length },
    stages: {
      orientation: stage('planFilletOrientation', batched(() => planFilletOrientation({ start: seam[0], end: seam[1], joint: JOINT_PARAMS.joint, toolConvention: o.toolConvention, ...o.requested }), 200, ITER)),
      orientationCheck: stage('recoverOrientationAngles (stored rounded quaternion)', batched(() => recoverOrientationAngles({ quaternion: o.recovered.quaternion, frame: o.jointFrame, toolConvention: o.toolConvention, requested: o.requested }), 200, ITER)),
      calibrationInspect: stage('inspectCalibrationFile (strict YAML parse + 4×4 checks)', batched(() => inspectCalibrationFile({ content: HAND_EYE_YAML, displayName: 'handeye.yml' }), 100, ITER)),
      packageBuild: stage('buildEvidencePackage (JSON, hashes, stored ZIP), no I/O', batched(() => buildEvidencePackage(pkgInput), 10, ITER, 50)),
      packageService: stage('jobService.evidencePackage: disk reads, package build, review-log append (the log grows by one entry per call)', await perCall(() => services.jobService.evidencePackage({ jobId, revision: 1, outputSha256: approved.record.output.sha256, configurationSha256: identity.sha256, operator: 'benchmark' }), ITER)),
      packageHttp: stage('POST /api/jobs/:id/revisions/1/evidence-package over 127.0.0.1 (same process)', await perCall(async () => {
        const r = await fetch(`${base}/jobs/${jobId}/revisions/1/evidence-package`, { method: 'POST', headers, body: pkgBody });
        if (r.status !== 200) throw new Error(`unexpected status ${r.status}`);
        await r.arrayBuffer();
      }, ITER)),
    },
  };
  results.push(extra);

  server.close();
  fs.rmSync(tmp, { recursive: true, force: true });

  const report = {
    generatedAt: new Date().toISOString(),
    method: 'docs/PERFORMANCE_METHOD.md',
    environment: {
      node: process.version,
      platform: `${os.platform()} ${os.release()}`,
      cpu: os.cpus()[0] && os.cpus()[0].model,
      logicalCpus: os.cpus().length,
      totalMemGiB: +(os.totalmem() / 1024 ** 3).toFixed(1),
      timerResolutionNsObserved: timerResolutionNs(),
      ...gitInfo(),
      backendSourceDigestSha256: sourceIdentity.backendSourceDigestSha256,
    },
    settings: { iterations: ITER, warmupMicro: 500, warmupIo: 20, warmupPackageBuild: 50 },
    comparability: 'Earlier runs measured older backend code. The legacy cases use the same method, but the pipeline now also computes a configuration digest and the service boundary reads a provenance file, so results are not directly comparable.',
    results,
    notUsedFor: 'These numbers are software timings on one machine. They are not user-observed workflow time, not setup time, not RobotStudio or controller time, and not workpiece or robot trials.',
  };

  fs.mkdirSync(OUT, { recursive: true });
  const file = path.join(OUT, `benchmark-${report.generatedAt.replace(/[:.]/g, '-')}.json`);
  fs.writeFileSync(file, JSON.stringify(report, null, 2));

  const fmt = (x) => x.toFixed(4);
  console.log(`Node ${report.environment.node} · ${report.environment.platform} · ${report.environment.cpu} · iterations ${ITER}`);
  console.log('input                                         stage               median ms   mean ms     p95 ms      min ms      max ms');
  for (const r of results) {
    for (const [name, s] of Object.entries(r.stages)) {
      console.log(`${r.input.file.slice(0, 44).padEnd(46)}${name.padEnd(18)}${fmt(s.stats.medianMs).padStart(10)}  ${fmt(s.stats.meanMs).padStart(10)}  ${fmt(s.stats.p95Ms).padStart(10)}  ${fmt(s.stats.minMs).padStart(10)}  ${fmt(s.stats.maxMs).padStart(10)}`);
    }
  }
  console.log(`raw results: ${path.relative(process.cwd(), file)}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
