require('dotenv').config();
const { loadRuntimeConfig, isLoopbackHost } = require('./services/config/runtimeConfig');
const { createApp, buildServices } = require('./app');

async function main() {
  const config = loadRuntimeConfig();

  if (!isLoopbackHost(config.host) && !config.allowNonLoopback) {
    console.error(`Refusing to bind to ${config.host}. This service writes files and can start a desktop application; it is intended for loopback only. Set VD_ALLOW_NON_LOOPBACK=1 only if you understand the consequences.`);
    process.exit(1);
  }

  const services = buildServices(config);
  await services.store.init();
  const app = createApp({ config, ...services });

  const server = app.listen(config.port, config.host, () => {
    console.log('=======================================================');
    console.log('VertexDynamics backend (local, single operator)');
    console.log(`API: http://${config.host}:${config.port}/api   data: ${config.dataDir}`);
    console.log(`Allowed frontend origins: ${config.allowedOrigins.join(', ')}`);
    console.log('=======================================================');
  });

  server.on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
      console.error(`Port ${config.port} on ${config.host} is already in use. Stop the other process or set PORT to a free port; this service does not stop other processes.`);
    } else {
      console.error('Backend failed to start:', err.message);
    }
    process.exit(1);
  });

  const shutdown = (signal) => {
    console.log(`${signal} received. Closing HTTP server...`);
    server.close(() => process.exit(0));
  };
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

if (require.main === module) {
  main().catch((err) => {
    console.error('Backend failed to start:', err);
    process.exit(1);
  });
}

module.exports = { main };
