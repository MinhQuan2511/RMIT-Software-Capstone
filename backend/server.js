require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const apiRoutes = require('./routes/apiRoutes');
const { initTcpBridge } = require('./services/network/tcpBridge');

const app = express();
const HTTP_PORT = process.env.PORT || 5000;
const TCP_PORT = process.env.TCP_PORT || 7001;

// Middleware Configuration
app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// Static uploads serving
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// REST API Routes
app.use('/api', apiRoutes);

// Root health check endpoint
app.get('/', (req, res) => {
  res.json({
    service: 'VertexDynamics Robotics Backend Service',
    status: 'online',
    version: '1.0.0',
    endpoints: {
      ingestFiles: 'POST /api/ingest-files',
      processPipeline: 'POST /api/process-pipeline',
      rapidCode: 'GET /api/rapid-code',
      bridgeStatus: 'GET /api/bridge/status',
    },
    tcpBridgePort: TCP_PORT,
    timestamp: new Date().toISOString(),
  });
});

// Start Express HTTP Server
const server = app.listen(HTTP_PORT, () => {
  console.log(`=======================================================`);
  console.log(`🤖 VertexDynamics Robotics Backend Server`);
  console.log(`🌐 HTTP REST API listening on http://localhost:${HTTP_PORT}`);
  console.log(`=======================================================`);

  // Initialize TCP Socket Bridge Server
  initTcpBridge(TCP_PORT);
});

// Graceful Shutdown
process.on('SIGTERM', () => {
  console.log('SIGTERM signal received. Closing HTTP server...');
  server.close(() => {
    console.log('HTTP server closed.');
  });
});

module.exports = app;
