/**
 * T14 permission-denied files and folders, reproduced on the host with real
 * access-control changes on TEMPORARY paths only (icacls deny entries on Windows,
 * chmod elsewhere). Each test first proves the denial took effect and skips —
 * saying so — when the host cannot reproduce it (for example when running as root).
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { startTestServer, readSample } = require('./helpers');

const isWin = process.platform === 'win32';
const principal = () => (isWin && process.env.USERDOMAIN ? `${process.env.USERDOMAIN}\\${os.userInfo().username}` : os.userInfo().username);

function deny(target, rights) {
  if (isWin) return spawnSync('icacls', [target, '/deny', `${principal()}:${rights}`], { encoding: 'utf-8' }).status === 0;
  fs.chmodSync(target, rights === 'write' ? 0o555 : 0o000);
  return true;
}
function restore(target) {
  if (isWin) spawnSync('icacls', [target, '/remove:d', principal()], { encoding: 'utf-8' });
  else fs.chmodSync(target, 0o755);
}
const denied = (fn) => { try { fn(); return false; } catch (e) { return e.code === 'EPERM' || e.code === 'EACCES'; } };

test('T14 permission-denied watched file: reported as Error with the OS code, not ingested; other files unaffected', async (t) => {
  const s = await startTestServer();
  const locked = path.join(s.inbox, 'locked.txt');
  fs.writeFileSync(locked, readSample('Feature_Straight_Sample.txt'));
  fs.writeFileSync(path.join(s.inbox, 'open.txt'), 'units: mm\ncurve: 0, 0, 100, 250, 0, 100, 4\n');
  const applied = deny(locked, isWin ? '(R)' : 'read') && denied(() => fs.readFileSync(locked));
  try {
    if (!applied) { t.skip('this host cannot deny read access to a file for the current user'); return; }
    await s.client.post('/watch-folder/scan');
    const r = await s.client.post('/watch-folder/scan');
    assert.equal(r.status, 200);
    const row = r.body.files.find((f) => f.name === 'locked.txt');
    assert.equal(row.status, 'Error', JSON.stringify(row));
    assert.match(row.message, /EPERM|EACCES/);
    assert.equal(row.sourceId, null);
    assert.equal(r.body.files.find((f) => f.name === 'open.txt').status, 'Ready');
    assert.equal((await s.client.get('/sources')).body.sources.length, 1, 'only the readable file was stored');
  } finally {
    restore(locked);
    await s.close();
  }
});

test('T14 permission-denied watched folder: the scan reports the folder cannot be read and stores nothing', async (t) => {
  const s = await startTestServer();
  fs.writeFileSync(path.join(s.inbox, 'a.txt'), readSample('Feature_Straight_Sample.txt'));
  const applied = deny(s.inbox, isWin ? '(RD)' : 'read') && denied(() => fs.readdirSync(s.inbox));
  try {
    if (!applied) { t.skip('this host cannot deny directory listing for the current user'); return; }
    const r = await s.client.post('/watch-folder/scan');
    assert.equal(r.status, 200);
    assert.equal(r.body.ok, false);
    assert.match(r.body.problem, /could not be read \((EPERM|EACCES)\)|does not exist/);
    assert.deepEqual(r.body.files, []);
    assert.equal((await s.client.get('/sources')).body.sources.length, 0);
  } finally {
    restore(s.inbox);
    await s.close();
  }
});

test('T14/T24 permission-denied export folder: save fails as EXPORT_PERMISSION_DENIED, launch is not attempted, nothing is left behind', async (t) => {
  const s = await startTestServer();
  const project = await s.helpers.project();
  const src = await s.helpers.uploadText('straight.txt', readSample('Feature_Straight_Sample.txt'));
  const rec = (await s.client.post('/jobs', { projectId: project.id, sourceId: src.id })).body.record;
  await s.helpers.approve(rec.jobId, 1);
  const applied = deny(s.exportDir, isWin ? '(W)' : 'write') && denied(() => fs.writeFileSync(path.join(s.exportDir, 'probe.txt'), 'x'));
  try {
    if (!applied) { t.skip('this host cannot deny write access to a folder for the current user'); return; }
    const r = await s.client.post(`/jobs/${rec.jobId}/revisions/1/export`, { outputSha256: rec.output.sha256, action: 'save_and_launch', operator: s.operator });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.equal(r.body.outcome.saved.status, 'failed');
    assert.equal(r.body.outcome.saved.code, 'EXPORT_PERMISSION_DENIED');
    assert.equal(r.body.outcome.launch.status, 'not_attempted');
    assert.equal(s.launcher.calls.length, 0);
    assert.equal(r.body.review.exports[0].saved, 'failed');
    // On Windows the write-deny entry also blocks listing, so inspect the folder after restoring access.
    restore(s.exportDir);
    assert.deepEqual(fs.readdirSync(s.exportDir), [], 'no partial or temporary file remains');
  } finally {
    restore(s.exportDir);
    await s.close();
  }
});
