const { spawn, execSync } = require('child_process');

console.log('🚀 Starting VertexDynamics Monorepo (Backend + Frontend)...');

// Helper to free ports before starting services
const freePort = (port) => {
  if (process.platform === 'win32') {
    try {
      const output = execSync(`netstat -ano | findstr :${port}`, { encoding: 'utf8' });
      const lines = output.split('\n');
      const pids = new Set();
      for (const line of lines) {
        const parts = line.trim().split(/\s+/);
        if (parts.length >= 5 && (parts[1].endsWith(`:${port}`) || parts[1].includes(`:${port}`))) {
          const pid = parts[parts.length - 1];
          if (pid && pid !== '0' && pid !== `${process.pid}`) {
            pids.add(pid);
          }
        }
      }
      for (const pid of pids) {
        console.log(`🧹 Clearing existing process on port ${port} (PID: ${pid})...`);
        try { execSync(`taskkill /pid ${pid} /F /T`, { stdio: 'ignore' }); } catch {}
      }
    } catch {
      // Ignore if no process is listening on the port
    }
  }
};

// Clear ports 5000 (Backend HTTP), 7001 (Backend TCP Bridge), and 3000 (Frontend Next.js)
[5000, 7001, 3000].forEach(freePort);

// Use 'run dev' for backend to enable native 'node --watch' auto-reloading
const backend = spawn('npm', ['--prefix', 'backend', 'run', 'dev'], { stdio: 'inherit', shell: true });
const frontend = spawn('npm', ['--prefix', 'frontend', 'run', 'dev'], { stdio: 'inherit', shell: true });

let isExiting = false;

// Clean up processes on exit (Prevents port 5000/3000 zombie leaks on Windows)
const cleanExit = (signal) => {
  if (isExiting) return;
  isExiting = true;

  console.log(`\n🛑 Shutting down VertexDynamics services (${signal || 'exit'})...`);
  if (process.platform === 'win32') {
    try {
      if (backend.pid) execSync(`taskkill /pid ${backend.pid} /T /F`, { stdio: 'ignore' });
    } catch {}
    try {
      if (frontend.pid) execSync(`taskkill /pid ${frontend.pid} /T /F`, { stdio: 'ignore' });
    } catch {}
  } else {
    try { backend.kill('SIGINT'); } catch {}
    try { frontend.kill('SIGINT'); } catch {}
  }
  process.exit(0);
};

backend.on('exit', (code, signal) => {
  if (!isExiting) {
    console.log(`⚠️ Backend process exited (code: ${code}, signal: ${signal})`);
  }
});

frontend.on('exit', (code, signal) => {
  if (!isExiting) {
    console.log(`⚠️ Frontend process exited (code: ${code}, signal: ${signal})`);
  }
});

process.on('SIGINT', () => cleanExit('SIGINT'));
process.on('SIGTERM', () => cleanExit('SIGTERM'));
process.on('uncaughtException', (err) => {
  console.error('❌ Uncaught exception:', err);
  cleanExit('uncaughtException');
});
