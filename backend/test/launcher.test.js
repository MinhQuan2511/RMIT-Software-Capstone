const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('events');
const { createLauncher } = require('../services/robotstudio/launcher');

const PF86 = 'C:\\Program Files (x86)';
const PF = 'C:\\Program Files';

function fakeFs(files, dirs) {
  const dirent = (name, isDir) => ({ name, isDirectory: () => isDir, isFile: () => !isDir });
  return {
    statSync: (p) => { if (files.has(p)) return { isFile: () => true }; const e = new Error('nope'); e.code = 'ENOENT'; throw e; },
    readdirSync: (p) => { if (dirs[p]) return dirs[p].map((n) => dirent(n, true)); const e = new Error('nope'); e.code = 'ENOENT'; throw e; },
  };
}

function fakeSpawn(behaviour, calls) {
  return (exe, args, opts) => {
    calls.push({ exe, args, opts });
    const child = new EventEmitter();
    child.pid = 999;
    child.unref = () => { child.unrefCalled = true; };
    setImmediate(() => {
      if (behaviour === 'spawn') child.emit('spawn');
      else if (behaviour === 'error') { const e = new Error('ENOENT'); e.code = 'ENOENT'; child.emit('error', e); }
    });
    return child;
  };
}

const env = { 'ProgramFiles(x86)': PF86, ProgramFiles: PF };

test('T25 launcher: unsupported OS and invalid overrides are distinct states', async () => {
  assert.equal(createLauncher({ platform: 'linux', env }).discover().status, 'unsupported_os');
  assert.equal((await createLauncher({ platform: 'darwin', env }).launch('/tmp/x.mod')).status, 'unsupported_os');
  assert.equal(createLauncher({ platform: 'win32', env, overrideExe: 'RobotStudio.exe', fsImpl: fakeFs(new Set(), {}) }).discover().status, 'override_invalid');
  assert.equal(createLauncher({ platform: 'win32', env, overrideExe: 'C:\\Windows\\System32\\cmd.exe', fsImpl: fakeFs(new Set(['C:\\Windows\\System32\\cmd.exe']), {}) }).discover().status, 'override_invalid');
  assert.equal(createLauncher({ platform: 'win32', env, overrideExe: 'D:\\Tools\\RobotStudio.exe', fsImpl: fakeFs(new Set(), {}) }).discover().status, 'override_invalid');
  const ok = createLauncher({ platform: 'win32', env, overrideExe: 'D:\\Tools\\RobotStudio.exe', fsImpl: fakeFs(new Set(['D:\\Tools\\RobotStudio.exe']), {}) }).discover();
  assert.deepEqual([ok.status, ok.method], ['found', 'config_override']);
});

test('T25 launcher: discovery scans Program Files\\ABB\\RobotStudio*\\Bin and prefers the newest year', () => {
  const files = new Set([`${PF86}\\ABB\\RobotStudio 2024\\Bin\\RobotStudio.exe`, `${PF86}\\ABB\\RobotStudio 2026\\Bin\\RobotStudio.exe`]);
  const dirs = { [`${PF86}\\ABB`]: ['RobotStudio 2024', 'RobotStudio 2026', 'Other Tool'] };
  const d = createLauncher({ platform: 'win32', env, fsImpl: fakeFs(files, dirs) }).discover();
  assert.equal(d.status, 'found');
  assert.equal(d.exePath, `${PF86}\\ABB\\RobotStudio 2026\\Bin\\RobotStudio.exe`);
  assert.equal(createLauncher({ platform: 'win32', env, fsImpl: fakeFs(new Set(), { [`${PF}\\ABB`]: ['RobotStudio 2025'] }) }).discover().status, 'not_found');
});

test('T25 launcher: spawn uses shell:false with one server-generated argument; start and error map to distinct statuses', async () => {
  const exe = `${PF86}\\ABB\\RobotStudio 2026\\Bin\\RobotStudio.exe`;
  const fsImpl = fakeFs(new Set([exe]), { [`${PF86}\\ABB`]: ['RobotStudio 2026'] });
  const calls = [];
  const started = await createLauncher({ platform: 'win32', env, fsImpl, spawnImpl: fakeSpawn('spawn', calls) }).launch('C:\\exports\\VD_x_r1_y.mod');
  assert.equal(started.status, 'process_started');
  assert.match(started.message, /does not confirm/);
  assert.deepEqual(calls[0].args, ['C:\\exports\\VD_x_r1_y.mod']);
  assert.equal(calls[0].opts.shell, false);
  assert.equal(calls[0].exe, exe);

  const failed = await createLauncher({ platform: 'win32', env, fsImpl, spawnImpl: fakeSpawn('error', []) }).launch('C:\\exports\\a.mod');
  assert.equal(failed.status, 'spawn_error');
  const silent = await createLauncher({ platform: 'win32', env, fsImpl, spawnImpl: fakeSpawn('never', []), timeoutMs: 20 }).launch('C:\\exports\\a.mod');
  assert.equal(silent.status, 'spawn_timeout');
  const relative = await createLauncher({ platform: 'win32', env, fsImpl, spawnImpl: fakeSpawn('spawn', []) }).launch('a.mod');
  assert.equal(relative.status, 'invalid_module_path');
  const thrown = await createLauncher({ platform: 'win32', env, fsImpl, spawnImpl: () => { const e = new Error('x'); e.code = 'EACCES'; throw e; } }).launch('C:\\exports\\a.mod');
  assert.equal(thrown.status, 'spawn_error');
});
