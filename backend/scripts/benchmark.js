/**
 * Reproducible timing benchmark. See docs/PERFORMANCE_METHOD.md.
 *
 *   node scripts/benchmark.js [--iterations 200] [--out ../docs/benchmarks]
 *
 * Boundaries measured separately (monotonic process.hrtime.bigint()):
 *   parse      parseFeatureText only                      (batched)
 *   plan       planSeam only                               (batched)
 *   compile    compileRapidModule incl. precheck           (batched)
 *   pipeline   parse + plan + compile, no I/O              (batched)
 *   service    jobService.createJob: read stored source from disk, pipeline,
 *              write revision files (temp data dir)        (per call)
 *   http       POST /api/jobs over loopback from the same process, incl. JSON
 *              and the service boundary above               (per call)
 * Not measured: browser rendering, user-observed workflow time, RobotStudio.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execSync } = require('child_process');
const { parseFeatureText } = require('../services/parsers/curveParser');
const { resolveProfile } = require('../services/kinematics/profiles');
const { planSeam } = require('../services/kinematics/pathPlanner');
const { compileRapidModule } = require('../services/compiler/rapidCompiler');
const { runPipeline } = require('../services/jobs/jobService');
const { loadRuntimeConfig } = require('../services/config/runtimeConfig');
const { createApp, buildServices } = require('../app');
const { sha256 } = require('../services/util/hash');

const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : fallback;
};
const ITER = Number(arg('iterations', 200));
const OUT = path.resolve(__dirname, arg('out', '../../docs/benchmarks'));
const SAMPLES = path.join(__dirname, '../../samples');

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

async function main() {
  const { profile } = resolveProfile({});
  const cases = ['Feature_Straight_Sample.txt', 'Feature_Arc_Sample.txt'].map((file) => {
    const buf = fs.readFileSync(path.join(SAMPLES, file));
    const text = buf.toString('utf-8');
    const parsed = parseFeatureText(text);
    const plan = planSeam(parsed.seam, profile);
    return { file, buf, text, parsed, plan, sha: sha256(buf) };
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
  const project = await services.store.createProject({ name: 'benchmark' });

  const results = [];
  for (const c of cases) {
    const { source } = await services.store.putSource({ content: c.buf, kind: 'manual_upload', name: c.file, contentType: 'feature-text' });
    const meta = source;
    const compileInput = { waypoints: c.plan.waypoints, segments: c.plan.segments, profile, provenance: { sourceSha256: c.sha, profileId: 'fixed-base-quaternion@1' } };

    const parse = batched(() => parseFeatureText(c.text), 200, ITER);
    const plan = batched(() => planSeam(c.parsed.seam, profile), 200, ITER);
    const compile = batched(() => compileRapidModule(compileInput), 100, ITER);
    const pipeline = batched(() => runPipeline(meta, c.buf, {}), 50, ITER);
    const service = await perCall(() => services.jobService.createJob({ projectId: project.id, sourceId: source.id }), ITER);
    const http = await perCall(async () => {
      const r = await fetch(`${base}/jobs`, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: 'http://localhost:3000', 'X-VD-CSRF': csrfToken }, body: JSON.stringify({ projectId: project.id, sourceId: source.id }) });
      if (r.status !== 201) throw new Error(`unexpected status ${r.status}`);
      await r.arrayBuffer();
    }, ITER);

    results.push({
      input: { file: c.file, sizeBytes: c.buf.length, sha256: c.sha, targets: c.plan.waypoints.length },
      stages: {
        parse: { boundary: 'parseFeatureText', batchSize: parse.batchSize, stats: stats(parse.perCallMs), raw: parse.perCallMs },
        plan: { boundary: 'planSeam (incl. arc fit for arcs)', batchSize: plan.batchSize, stats: stats(plan.perCallMs), raw: plan.perCallMs },
        compile: { boundary: 'compileRapidModule (validation + serialisation + precheck + SHA-256)', batchSize: compile.batchSize, stats: stats(compile.perCallMs), raw: compile.perCallMs },
        pipeline: { boundary: 'runPipeline: profile + parse + plan + compile, no I/O', batchSize: pipeline.batchSize, stats: stats(pipeline.perCallMs), raw: pipeline.perCallMs },
        service: { boundary: 'jobService.createJob: disk read of source, pipeline, atomic writes of job/revision/module/review files', stats: stats(service), raw: service },
        http: { boundary: 'POST /api/jobs over 127.0.0.1 from the same Node process (client + server share the event loop)', stats: stats(http), raw: http },
      },
    });
  }

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
    },
    settings: { iterations: ITER, warmupMicro: 500, warmupIo: 20 },
    results,
    notUsedFor: 'These numbers are software timings on one machine. They are not user-observed workflow time, not setup time, and not RobotStudio or controller time.',
  };

  fs.mkdirSync(OUT, { recursive: true });
  const file = path.join(OUT, `benchmark-${report.generatedAt.replace(/[:.]/g, '-')}.json`);
  fs.writeFileSync(file, JSON.stringify(report, null, 2));

  const fmt = (x) => x.toFixed(4);
  console.log(`Node ${report.environment.node} · ${report.environment.platform} · ${report.environment.cpu} · iterations ${ITER}`);
  console.log('input                         stage     median ms   mean ms     p95 ms      min ms      max ms');
  for (const r of results) {
    for (const [name, s] of Object.entries(r.stages)) {
      console.log(`${r.input.file.padEnd(30)}${name.padEnd(10)}${fmt(s.stats.medianMs).padStart(10)}  ${fmt(s.stats.meanMs).padStart(10)}  ${fmt(s.stats.p95Ms).padStart(10)}  ${fmt(s.stats.minMs).padStart(10)}  ${fmt(s.stats.maxMs).padStart(10)}`);
    }
  }
  console.log(`raw results: ${path.relative(process.cwd(), file)}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
