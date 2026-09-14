/**
 * Starts the backend (127.0.0.1:5000) and frontend (127.0.0.1:3000) for local use.
 *
 * It checks that both ports are free first and refuses to start otherwise. It
 * never stops processes it did not start: the previous version killed
 * whatever held ports 3000/5000, which could terminate unrelated software.
 * On shutdown it stops only its own child process trees.
 */

const { spawn } = require('child_process');
const net = require('net');

const HOST = '127.0.0.1';
const SERVICES = [
  { name: 'backend', port: Number(process.env.PORT) || 5000, args: ['--prefix', 'backend', 'run', 'dev'] },
  { name: 'frontend', port: 3000, args: ['--prefix', 'frontend', 'run', 'dev'] },
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

  console.log('Starting VertexDynamics (local only): backend http://127.0.0.1:5000/api, frontend http://127.0.0.1:3000');
  const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
  // Fixed arguments only; shell is required to run npm.cmd on Windows.
  const children = SERVICES.map((s) => ({ ...s, child: spawn(npm, s.args, { stdio: 'inherit', shell: process.platform === 'win32' }) }));

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
}

main();
