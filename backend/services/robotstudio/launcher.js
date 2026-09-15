/**
 * RobotStudio process launcher.
 *
 * What a successful result means: the operating system reported that a
 * RobotStudio.exe process started. It does NOT mean a station opened, the
 * module was imported, the RAPID compiled, or anything moved. Whether passing a
 * .mod path on the command line imports it into a virtual controller was not
 * tested in this project; the UI therefore always shows manual import steps.
 *
 * Discovery, in order:
 *   1. VD_ROBOTSTUDIO_EXE — a trusted local override set by the operator in the
 *      backend environment (never from HTTP). Must be an absolute path to an
 *      existing file named RobotStudio.exe.
 *   2. %ProgramFiles(x86)%\ABB\RobotStudio*\Bin\RobotStudio.exe and the same
 *      under %ProgramFiles%. This layout matches the installation found on the
 *      development machine (RobotStudio 2026 under Program Files (x86)); other
 *      layouts need the override.
 *
 * The process is started with spawn(..., { shell: false }) and a single
 * argument: the server-generated path of the saved module.
 */

const fs = require('fs');
const path = require('path');
const childProcess = require('child_process');

const EXE_NAME = /^robotstudio\.exe$/i;
const DIR_NAME = /^RobotStudio(?: (\d{4}))?$/;

function createLauncher({ platform = process.platform, env = process.env, fsImpl = fs, spawnImpl = childProcess.spawn, timeoutMs = 10000, overrideExe = env.VD_ROBOTSTUDIO_EXE } = {}) {
  function discover() {
    if (platform !== 'win32') return { status: 'unsupported_os', message: 'RobotStudio launch is only supported on Windows.' };

    if (overrideExe) {
      if (!path.isAbsolute(overrideExe) || !EXE_NAME.test(path.basename(overrideExe))) {
        return { status: 'override_invalid', message: 'VD_ROBOTSTUDIO_EXE must be an absolute path ending in RobotStudio.exe.' };
      }
      try {
        if (fsImpl.statSync(overrideExe).isFile()) return { status: 'found', exePath: overrideExe, method: 'config_override' };
      } catch { /* fall through */ }
      return { status: 'override_invalid', message: 'VD_ROBOTSTUDIO_EXE does not point to an existing file.' };
    }

    const bases = [env['ProgramFiles(x86)'], env.ProgramFiles].filter((b) => typeof b === 'string' && path.isAbsolute(b));
    const found = [];
    for (const base of bases) {
      const abb = path.join(base, 'ABB');
      let dirs = [];
      try { dirs = fsImpl.readdirSync(abb, { withFileTypes: true }); } catch { continue; }
      for (const d of dirs) {
        const m = d.isDirectory() && d.name.match(DIR_NAME);
        if (!m) continue;
        const exe = path.join(abb, d.name, 'Bin', 'RobotStudio.exe');
        try {
          if (fsImpl.statSync(exe).isFile()) found.push({ exe, year: m[1] ? Number(m[1]) : 0 });
        } catch { /* not installed here */ }
      }
    }
    if (found.length === 0) return { status: 'not_found', message: 'RobotStudio.exe was not found under Program Files\\ABB. Set VD_ROBOTSTUDIO_EXE to its location.' };
    found.sort((a, b) => b.year - a.year);
    return { status: 'found', exePath: found[0].exe, method: 'program_files_scan' };
  }

  /**
   * @param {string} modulePath  Absolute, server-generated path of the saved module
   * @returns {Promise<{status: string, message: string, pid?: number, exeName?: string}>}
   */
  function launch(modulePath) {
    const d = discover();
    if (d.status !== 'found') return Promise.resolve({ status: d.status, message: d.message });
    if (typeof modulePath !== 'string' || !path.isAbsolute(modulePath)) {
      return Promise.resolve({ status: 'invalid_module_path', message: 'Internal error: module path is not absolute.' });
    }

    return new Promise((resolve) => {
      let settled = false;
      let timer = null;
      const done = (result) => {
        if (settled) return;
        settled = true;
        if (timer !== null) clearTimeout(timer);
        resolve(result);
      };
      let child;
      try {
        child = spawnImpl(d.exePath, [modulePath], { shell: false, detached: true, stdio: 'ignore', windowsHide: false });
      } catch (err) {
        done({ status: 'spawn_error', message: `The process could not be started (${err.code || 'error'}).` });
        return;
      }
      timer = setTimeout(() => done({ status: 'spawn_timeout', message: 'No process start was observed within the timeout.' }), timeoutMs);
      child.once('spawn', () => {
        try { child.unref(); } catch { /* ignore */ }
        done({
          status: 'process_started',
          pid: child.pid,
          exeName: path.basename(d.exePath),
          discovery: d.method,
          message: 'RobotStudio process started. This does not confirm that a station opened or that the module was imported, compiled or run.',
        });
      });
      child.once('error', (err) => done({ status: 'spawn_error', message: `The process could not be started (${err.code || 'error'}).` }));
    });
  }

  return { discover, launch };
}

module.exports = { createLauncher };
