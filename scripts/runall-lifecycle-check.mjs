/**
 * Normal start-up and shutdown of the launcher behind `npm run dev` (node run-all.js).
 *
 *   node scripts/runall-lifecycle-check.mjs [reportFile]
 *
 * - Uses temporary data, config, export and watch directories, so real user data are never touched
 *   (the repository's backend/data listing is compared before and after).
 * - Starts an unrelated "sentinel" listener first; the launcher must leave it running.
 * - Waits for the backend health endpoint and the frontend, then requests an orderly shutdown over
 *   IPC and checks that the launcher exits, both ports are released and (on Windows) every process
 *   in the launcher's tree is gone.
 * Refuses to run if port 3000 or 5000 is busy. No RobotStudio process can start (override points nowhere).
 */

import { spawn, execFileSync } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const REPORT = process.argv[2] || path.join(ROOT, "LocalUse", "3", "evidence", "runall-lifecycle.json");
// Same variables the launcher reads; defaults 3000/5000.
const FE_PORT = Number(process.env.VD_FRONTEND_PORT) || 3000;
const BE_PORT = Number(process.env.PORT) || 5000;
// Data directory whose listing must not change (default: this copy's backend/data).
const CHECK_DATA_DIR = process.env.VD_CHECK_DATA_DIR || path.join(ROOT, "backend", "data");
const SENTINEL_PORT = 5057;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const free = (port) => new Promise((resolve) => { const s = net.createServer(); s.once("error", () => resolve(false)); s.once("listening", () => s.close(() => resolve(true))); s.listen(port, "127.0.0.1"); });
const connectable = (port) => new Promise((resolve) => { const c = net.connect(port, "127.0.0.1"); c.once("connect", () => { c.destroy(); resolve(true); }); c.once("error", () => resolve(false)); });

async function waitHttp(url, ms) {
  const t = Date.now();
  while (Date.now() - t < ms) {
    try { const r = await fetch(url); if (r.status < 500) return Date.now() - t; } catch { /* retry */ }
    await sleep(500);
  }
  throw new Error(`timeout waiting for ${url}`);
}

function listing(dir) {
  const out = [];
  const walk = (d) => {
    let entries = [];
    try { entries = fs.readdirSync(d, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      const full = path.join(d, e.name);
      if (e.isDirectory()) walk(full);
      else { const st = fs.statSync(full); out.push(`${path.relative(dir, full)}|${st.size}|${st.mtimeMs}`); }
    }
  };
  walk(dir);
  return out.sort();
}

function processTree(rootPid) {
  if (process.platform !== "win32") return null;
  const json = execFileSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", "Get-CimInstance Win32_Process | Select-Object ProcessId,ParentProcessId,Name | ConvertTo-Json -Compress"], { encoding: "utf-8", maxBuffer: 32 * 1024 * 1024 });
  const all = JSON.parse(json);
  const tree = [];
  const walk = (pid) => { for (const p of all.filter((x) => x.ParentProcessId === pid)) { tree.push({ pid: p.ProcessId, name: p.Name }); walk(p.ProcessId); } };
  walk(rootPid);
  return { tree, alive: (pids) => pids.filter((pid) => all.some((x) => x.ProcessId === pid)) };
}

async function main() {
  const report = { startedAt: new Date().toISOString(), platform: `${os.platform()} ${os.release()}`, node: process.version, command: "node run-all.js (the script behind npm run dev)", root: path.basename(ROOT), ports: { frontend: FE_PORT, backend: BE_PORT }, steps: [] };
  const step = (name, ok, detail) => { report.steps.push({ name, ok: !!ok, detail }); console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail !== undefined ? ` — ${JSON.stringify(detail)}` : ""}`); };

  for (const p of [FE_PORT, BE_PORT]) if (!(await free(p))) throw new Error(`port ${p} is in use; refusing to run`);
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "vd-runall-"));
  for (const d of ["data", "exports", "watch/inbox"]) fs.mkdirSync(path.join(tmp, d), { recursive: true });
  const repoData = CHECK_DATA_DIR;
  const dataBefore = listing(repoData);

  const sentinel = spawn(process.execPath, ["-e", `require('net').createServer().listen(${SENTINEL_PORT}, '127.0.0.1')`], { stdio: "ignore" });
  await sleep(500);
  step("foreign sentinel listener started before the launcher", await connectable(SENTINEL_PORT), { port: SENTINEL_PORT, pid: sentinel.pid });

  const env = {
    ...process.env,
    VD_DATA_DIR: path.join(tmp, "data"),
    VD_CONFIG_PATH: path.join(tmp, "config.json"),
    VD_EXPORT_DIR: path.join(tmp, "exports"),
    VD_WATCH_ROOTS: path.join(tmp, "watch"),
    WATCH_FOLDER: path.join(tmp, "watch", "inbox"),
    VD_ROBOTSTUDIO_EXE: path.join(tmp, "not-installed", "RobotStudio.exe"),
  };
  const log = fs.createWriteStream(path.join(tmp, "run-all.log"));
  const t0 = Date.now();
  const launcher = spawn(process.execPath, [path.join(ROOT, "run-all.js")], { cwd: ROOT, env, stdio: ["ignore", "pipe", "pipe", "ipc"] });
  launcher.stdout.pipe(log);
  launcher.stderr.pipe(log);
  const exited = new Promise((resolve) => launcher.once("exit", (code, signal) => resolve({ code, signal, at: Date.now() })));

  try {
    const beMs = await waitHttp(`http://127.0.0.1:${BE_PORT}/api/health`, 120000);
    step("backend health reachable", true, { msFromLaunch: Date.now() - t0, waitedMs: beMs });
    step("backend uses the temporary data directory", fs.existsSync(path.join(tmp, "data", "projects")));
    const feMs = await waitHttp(`http://127.0.0.1:${FE_PORT}/`, 240000);
    step("frontend (next dev) reachable", true, { msFromLaunch: Date.now() - t0, waitedMs: feMs });

    const before = processTree(launcher.pid);
    if (before) step("launcher process tree recorded", before.tree.length > 0, before.tree.map((p) => p.name));

    const tStop = Date.now();
    launcher.send({ type: "shutdown" });
    const ex = await Promise.race([exited, sleep(30000).then(() => null)]);
    step("launcher exits after the shutdown request", !!ex, ex && { code: ex.code, ms: ex.at - tStop });

    let released = false;
    for (let i = 0; i < 60 && !released; i += 1) { released = (await free(FE_PORT)) && (await free(BE_PORT)); if (!released) await sleep(500); }
    step(`ports ${FE_PORT} and ${BE_PORT} released`, released, { msAfterRequest: Date.now() - tStop });
    if (before) {
      await sleep(1500);
      const after = processTree(process.pid);
      const survivors = after.alive(before.tree.map((p) => p.pid));
      step("no process of the launcher's own tree survives", survivors.length === 0, { survivors });
    }
    step("unrelated sentinel listener still running", sentinel.exitCode === null && (await connectable(SENTINEL_PORT)));
    step("repository backend/data unchanged", JSON.stringify(listing(repoData)) === JSON.stringify(dataBefore), { files: dataBefore.length });
  } catch (err) {
    step("run aborted", false, String(err));
    if (launcher.exitCode === null) launcher.send({ type: "shutdown" });
  } finally {
    sentinel.kill();
    report.finishedAt = new Date().toISOString();
    report.ok = report.steps.every((s) => s.ok);
    fs.mkdirSync(path.dirname(REPORT), { recursive: true });
    fs.writeFileSync(REPORT, `${JSON.stringify(report, null, 2)}\n`);
    await sleep(1000);
    try { fs.rmSync(tmp, { recursive: true, force: true }); } catch { /* files may still be released */ }
  }
  process.exit(report.ok ? 0 : 1);
}

main().catch((err) => { console.error(err); process.exit(1); });
