const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const fs = require('fs');
const { readCalibrationArchive } = require('../services/calibration/rspagReader');
const { startTestServer } = require('./helpers');

const ARCHIVE = path.join(__dirname, '../../frontend/public/stations/auto_calib.rspag');

test('C-01 calibration archive facts are extracted read-only and match the file', () => {
  const before = fs.statSync(ARCHIVE);
  const info = readCalibrationArchive(ARCHIVE);
  assert.equal(info.routine.robtargetCount, 17);
  assert.equal(info.routine.nonHomePoseCount, 16);
  assert.equal(info.routine.motionStatementCount, 19);
  assert.deepEqual(info.routine.motionInstructions, { MoveL: 18, MoveJ: 1 });
  assert.equal(info.routine.waitStatementCount, 18);
  assert.deepEqual(info.routine.waitSeconds, [3]);
  assert.equal(info.routine.programmedDwellSeconds, 54);
  assert.deepEqual(info.routine.repeatedDestinations, [{ target: 'Target_70', visits: 2 }]);
  assert.equal(info.routine.distinctDestinations, 17);
  assert.deepEqual(info.routine.tools, ['tWeldGun']);
  assert.deepEqual(info.routine.workObjects, ['wobj0']);
  assert.equal(info.tooldata.name, 'tWeldGun');
  assert.deepEqual(info.tooldata.translationMm, [125.800591275, 0, 391.268161315]);
  assert.deepEqual(info.tooldata.orientation, [0.898794046, 0, 0.438371147, 0]);
  assert.equal(info.archive.categories.licenceFiles, 2);
  // Nothing sensitive is returned by content.
  const json = JSON.stringify(info);
  assert.doesNotMatch(json, /passphrase\.txt|\.rlf/);
  const after = fs.statSync(ARCHIVE);
  assert.equal(after.mtimeMs, before.mtimeMs);
  assert.equal(after.size, before.size);
});

test('T28 calibration endpoint reports archive facts, not measurements', async (t) => {
  const s = await startTestServer();
  t.after(() => s.close());
  const r = await s.client.get('/calibration/routine');
  assert.equal(r.status, 200);
  const json = JSON.stringify(r.body);
  assert.doesNotMatch(json, /reprojection|pointsCaptured|0\.142/i);
  assert.match(r.body.routine.dwellNote, /not the duration of a calibration/);
});
