const { spawn, execSync } = require('child_process');

console.log(' Starting VertexDynamics Monorepo (Backend + Frontend)...');

// Use 'run dev' for backend to enable native 'node --watch' auto-reloading
const backend = spawn('npm', ['--prefix', 'backend', 'run', 'dev'], { stdio: 'inherit', shell: true });
const frontend = spawn('npm', ['--prefix', 'frontend', 'run', 'dev'], { stdio: 'inherit', shell: true });

// Clean up processes on exit (Prevents port 5000/3000 zombie leaks on Windows)
const cleanExit = () => {
  console.log('\n Shutting down VertexDynamics services...');
  if (process.platform === 'win32') {
    try {
      if (backend.pid) execSync(`taskkill /pid ${backend.pid} /T /F`, { stdio: 'ignore' });
      if (frontend.pid) execSync(`taskkill /pid ${frontend.pid} /T /F`, { stdio: 'ignore' });
    } catch {
      // Ignore taskkill errors if process already exited
    }
  } else {
    backend.kill('SIGINT');
    frontend.kill('SIGINT');
  }
  process.exit(0);
};

process.on('SIGINT', cleanExit);
process.on('SIGTERM', cleanExit);