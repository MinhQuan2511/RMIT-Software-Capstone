const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const fsp = fs.promises;
const os = require('os');
const path = require('path');
const { loadRuntimeConfig } = require('../services/config/runtimeConfig');
const { createJobStore } = require('../services/jobs/jobStore');
const { previewSource } = require('../services/jobs/jobService');
const { createWatchFolderService } = require('../services/ingest/watchFolder');
const { SAMPLES } = require('./helpers');

async function setup({ settleMs = 2000, fspImpl } = {}) {
  const tmp = await fsp.mkdtemp(path.join(os.tmpdir(), 'vd-watch-'));
  const root = path.join(tmp, 'root');
  const inbox = path.join(root, 'inbox');
  await fsp.mkdir(inbox, { recursive: true });
  let now = 1_000_000;
  const clock = () => now;
  const config = loadRuntimeConfig({}, {
    dataDir: path.join(tmp, 'data'), watchConfigPath: path.join(tmp, 'config.json'), watchRoots: [root, SAMPLES], demoRoots: [SAMPLES], defaultWatchFolder: inbox,
    limits: { watchSettleMs: settleMs },
  });
  const store = createJobStore({ dataDir: config.dataDir });
  await store.init();
  const svc = createWatchFolderService({ store, previewSource, config, clock, fsp: fspImpl || fsp });
  return { tmp, inbox, svc, store, advance: (ms) => { now += ms; }, cleanup: () => fsp.rm(tmp, { recursive: true, force: true }) };
}

const row = (scan, name) => scan.files.find((f) => f.name === name);
const STRAIGHT = 'units: mm\ncurve:0,0,0,100,0,0,5\n';

test('T12 a file is not ingested until size and mtime are stable for the settle interval', async (t) => {
  const w = await setup();
  t.after(w.cleanup);
  const file = path.join(w.inbox, 'scan.txt');
  await fsp.writeFile(file, 'units: mm\ncurve:0,0,');
  assert.equal(row(await w.svc.scan(), 'scan.txt').status, 'Writing');
  w.advance(3000);
  // Still being written: size grows between polls.
  await fsp.appendFile(file, '0,100,0,0,5\n');
  assert.equal(row(await w.svc.scan(), 'scan.txt').status, 'Writing');
  w.advance(1000); // unchanged but not yet settled for 2 s
  assert.equal(row(await w.svc.scan(), 'scan.txt').status, 'Writing');
  w.advance(1500);
  const ready = row(await w.svc.scan(), 'scan.txt');
  assert.equal(ready.status, 'Ready');
  assert.match(ready.sourceId, /^src_watch_/);
  assert.equal(ready.preview.ok, true);
});

test('T12 a change between the stat and the read is detected and deferred', async (t) => {
  let armed = false;
  const wrapped = { ...fsp,
    readFile: async (...args) => { const r = await fsp.readFile(...args); if (armed) { armed = false; await fsp.appendFile(args[0], '\n# late write\n'); } return r; },
  };
  const w = await setup({ settleMs: 0, fspImpl: wrapped });
  t.after(w.cleanup);
  await fsp.writeFile(path.join(w.inbox, 'late.txt'), STRAIGHT);
  await w.svc.scan();
  w.advance(10);
  armed = true;
  const r = row(await w.svc.scan(), 'late.txt');
  assert.equal(r.status, 'Writing');
  assert.equal(r.sourceId, null);
});

test('T13 unchanged files are idempotent; same-name changed bytes become a new source', async (t) => {
  const w = await setup({ settleMs: 0 });
  t.after(w.cleanup);
  const file = path.join(w.inbox, 'Feature.txt');
  await fsp.writeFile(file, STRAIGHT);
  await w.svc.scan();
  w.advance(10);
  const first = row(await w.svc.scan(), 'Feature.txt');
  assert.equal(first.status, 'Ready');
  w.advance(10);
  const again = row(await w.svc.scan(), 'Feature.txt');
  assert.equal(again.status, 'Ingested');
  assert.equal(again.sourceId, first.sourceId);

  // Same length, different bytes, later mtime.
  await fsp.writeFile(file, STRAIGHT.replace('100', '200'));
  const future = new Date(Date.now() + 5000);
  await fsp.utimes(file, future, future);
  assert.equal(row(await w.svc.scan(), 'Feature.txt').status, 'Writing');
  w.advance(10);
  const changed = row(await w.svc.scan(), 'Feature.txt');
  assert.equal(changed.status, 'Ready');
  assert.notEqual(changed.sourceId, first.sourceId);
  // The first source is still intact.
  const { meta } = await w.store.getSourceContent(first.sourceId);
  assert.equal(meta.sizeBytes, Buffer.byteLength(STRAIGHT));
});

test('T13 concurrent scans do not ingest twice', async (t) => {
  const w = await setup({ settleMs: 0 });
  t.after(w.cleanup);
  await fsp.writeFile(path.join(w.inbox, 'a.txt'), STRAIGHT);
  await w.svc.scan();
  w.advance(10);
  const [s1, s2] = await Promise.all([w.svc.scan(), w.svc.scan()]);
  const statuses = [row(s1, 'a.txt').status, row(s2, 'a.txt').status].sort();
  assert.deepEqual(statuses, ['Ingested', 'Ready']);
});

test('T14 notes, non-txt, oversize, missing folder and vanishing files give statuses without crashing', async (t) => {
  let vanish = null;
  const wrapped = { ...fsp, stat: async (p, ...rest) => { if (vanish && path.basename(p) === vanish) { const e = new Error('gone'); e.code = 'ENOENT'; throw e; } return fsp.stat(p, ...rest); } };
  const w = await setup({ settleMs: 0, fspImpl: wrapped });
  t.after(w.cleanup);
  await fsp.writeFile(path.join(w.inbox, 'notes.txt'), 'just some notes');
  await fsp.writeFile(path.join(w.inbox, 'data.csv'), 'x,y,z');
  await fsp.writeFile(path.join(w.inbox, 'big.txt'), `curve:${'1,'.repeat(200000)}`);
  await fsp.writeFile(path.join(w.inbox, 'vanish.txt'), STRAIGHT);
  await w.svc.scan();
  w.advance(10);
  vanish = 'vanish.txt';
  const scan = await w.svc.scan();
  assert.equal(row(scan, 'notes.txt').status, 'Ignored');
  assert.equal(row(scan, 'data.csv'), undefined);
  assert.equal(row(scan, 'big.txt').status, 'Error');
  assert.equal(row(scan, 'vanish.txt').status, 'Error');
  assert.match(row(scan, 'vanish.txt').message, /disappeared/);

  await fsp.rm(w.inbox, { recursive: true, force: true });
  const missing = await w.svc.scan();
  assert.equal(missing.ok, false);
  assert.match(missing.problem, /does not exist/);
  assert.deepEqual(missing.files, []);
});

test('T14 an invalid seam file is ingested with a failing preview (never substituted)', async (t) => {
  const w = await setup({ settleMs: 0 });
  t.after(w.cleanup);
  await fsp.writeFile(path.join(w.inbox, 'broken.txt'), 'curve:414.69,1112.75,320.342\n');
  await w.svc.scan();
  w.advance(10);
  const r = row(await w.svc.scan(), 'broken.txt');
  assert.equal(r.status, 'Ready');
  assert.equal(r.preview.ok, false);
  assert.match(r.preview.firstError, /exactly 7/);
});

test('files ingested from the bundled samples folder are demo sources', async (t) => {
  const w = await setup({ settleMs: 0 });
  t.after(w.cleanup);
  await w.svc.setFolder(SAMPLES);
  await w.svc.scan();
  w.advance(10);
  const scan = await w.svc.scan();
  assert.equal(scan.demoFolder, true);
  for (const f of scan.files.filter((x) => x.sourceId)) assert.equal(f.sourceKind, 'demo');
  // The samples folder itself is untouched.
  assert.deepEqual(fs.readdirSync(SAMPLES).sort(), ['Feature_Arc_Sample.txt', 'Feature_Straight_Sample.txt']);
});
