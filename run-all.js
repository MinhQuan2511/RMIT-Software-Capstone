const { spawn } = require('child_process');

console.log('🚀 Starting VertexDynamics Monorepo (Backend + Frontend)...');

const backend = spawn('npm', ['--prefix', 'backend', 'start'], { stdio: 'inherit', shell: true });
const frontend = spawn('npm', ['--prefix', 'frontend', 'run', 'dev'], { stdio: 'inherit', shell: true });

process.on('SIGINT', () => {
  backend.kill();
  frontend.kill();
  process.exit(0);
});
