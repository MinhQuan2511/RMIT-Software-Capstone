/**
 * Starts the backend (127.0.0.1:5000) and frontend (127.0.0.1:3000) for local use.
 * Set PORT and/or VD_FRONTEND_PORT to use other ports.
 *
 * It checks that both ports are free first and refuses to start otherwise. It
 * never stops processes it did not start: the previous version killed
 * whatever held ports 3000/5000, which could terminate unrelated software.
 * On shutdown it stops only its own child process trees.
 */

const { spawn } = require('child_process');
const net = require('net');

const HOST = '127.0.0.1';
// Defaults 5000/3000. PORT and VD_FRONTEND_PORT move them (e.g. when another copy already runs);
// the frontend's API URL and the backend's origin allowlist follow unless set explicitly.
const BACKEND_PORT = Number(process.env.PORT) || 5000;
const FRONTEND_PORT = Number(process.env.VD_FRONTEND_PORT) || 3000;
const SERVICES = [
  {
    name: 'backend',
    port: BACKEND_PORT,
    args: ['--prefix', 'backend', 'run', 'dev'],
    env: { VD_ALLOWED_ORIGINS: process.env.VD_ALLOWED_ORIGINS || `http://localhost:${FRONTEND_PORT},http://127.0.0.1:${FRONTEND_PORT}` },
  },
  {
    name: 'frontend',
    port: FRONTEND_PORT,
    // A later --port overrides the one in the frontend's dev script.
    args: ['--prefix', 'frontend', 'run', 'dev', ...(FRONTEND_PORT !== 3000 ? ['--', '--port', String(FRONTEND_PORT)] : [])],
    env: { NEXT_PUBLIC_API_URL: process.env.NEXT_PUBLIC_API_URL || `http://127.0.0.1:${BACKEND_PORT}/api` },
  },
];

function portIsFree(port) {
  return new Promise((resolve) => {
    const probe = net.createServer();
    probe.once('error', () => resolve(false));
    probe.once('listening', () => probe.close(() => resolve(true)));
    probe.listen(port, HOST);
  });
}

function stopChild(child) {
  if (!child || child.exitCode !== null || !child.pid) return;
  if (process.platform === 'win32') {
    // The npm shell wrapper has its own children; stop exactly this tree.
    spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
  } else {
    child.kill('SIGINT');
  }
}

async function main() {
  for (const s of SERVICES) {
    if (!(await portIsFree(s.port))) {
      console.error(`Port ${s.port} on ${HOST} (${s.name}) is already in use. This launcher does not stop other processes; stop that process yourself or free the port, then retry.`);
      process.exit(1);
    }
  }

  console.log(`Starting VertexDynamics (local only): backend http://${HOST}:${BACKEND_PORT}/api, frontend http://${HOST}:${FRONTEND_PORT}`);
  const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
  // Fixed arguments only (ports are validated numbers); shell is required to run npm.cmd on Windows.
  const children = SERVICES.map((s) => ({ ...s, child: spawn(npm, s.args, { stdio: 'inherit', shell: process.platform === 'win32', env: { ...process.env, ...s.env } }) }));

  let exiting = false;
  const shutdown = (reason, code = 0) => {
    if (exiting) return;
    exiting = true;
    console.log(`\nStopping VertexDynamics services (${reason})...`);
    children.forEach(({ child }) => stopChild(child));
    setTimeout(() => process.exit(code), 500);
  };

  children.forEach(({ name, child }) => {
    child.on('exit', (code, signal) => {
      if (!exiting) {
        console.error(`${name} exited (code ${code}, signal ${signal}); stopping the other service.`);
        shutdown(`${name} exited`, code || 1);
      }
    });
  });

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));

  // A supervisor that started this launcher with an IPC channel (for example the lifecycle
  // check in scripts/) can request the same orderly shutdown. On Windows a programmatic
  // SIGINT terminates a Node process abruptly, so it cannot exercise this path.
  if (typeof process.send === 'function') {
    process.on('message', (msg) => { if (msg && msg.type === 'shutdown') shutdown('shutdown requested over IPC'); });
    process.on('disconnect', () => shutdown('supervisor disconnected'));
  }
}

main();
