const net = require('net');

/**
 * TCP Socket Server Bridge
 * Native Node 'net' socket server for RobotStudio Add-In / TCP Bridge communication
 * Listens on Port 7001 (or 45000)
 */

let server = null;
const connectedClients = new Set();
let serverState = {
  running: false,
  port: 7001,
  activeConnections: 0,
  lastActivity: null,
  totalMessagesReceived: 0,
};

function initTcpBridge(port = 7001) {
  if (server) {
    console.log(`TCP Bridge server is already initialized on port ${serverState.port}`);
    return serverState;
  }

  serverState.port = port;

  server = net.createServer((socket) => {
    const clientIp = `${socket.remoteAddress}:${socket.remotePort}`;
    console.log(`[TCP Bridge] New RobotStudio client connected from ${clientIp}`);
    
    connectedClients.add(socket);
    serverState.activeConnections = connectedClients.size;
    serverState.lastActivity = new Date().toISOString();

    // Send initial handshake / welcome
    socket.write(`000,1,CONNECTED,TracerStudio-Bridge-v2.0\n`);

    socket.on('data', (buffer) => {
      serverState.lastActivity = new Date().toISOString();
      serverState.totalMessagesReceived++;

      const message = buffer.toString('utf-8').trim();
      console.log(`[TCP Bridge] Data received from ${clientIp}:`, message);

      // Handle simple TCP bridge protocol commands
      if (message.startsWith('PING') || message === '000,PING') {
        socket.write('000,PONG\n');
      } else if (message.startsWith('011')) {
        // Trajectory Request
        socket.write('002,ACK,TRAJECTORY_READY\n');
      } else {
        // Echo ACK
        socket.write(`900,ACK,${message.substring(0, 32)}\n`);
      }
    });

    socket.on('close', () => {
      console.log(`[TCP Bridge] Client ${clientIp} disconnected`);
      connectedClients.delete(socket);
      serverState.activeConnections = connectedClients.size;
    });

    socket.on('error', (err) => {
      console.error(`[TCP Bridge] Socket error (${clientIp}):`, err.message);
      connectedClients.delete(socket);
      serverState.activeConnections = connectedClients.size;
    });
  });

  server.on('error', (err) => {
    console.error(`[TCP Bridge] Server error:`, err.message);
    if (err.code === 'EADDRINUSE') {
      console.warn(`[TCP Bridge] Port ${port} in use. Attempting fallback to port 45000...`);
      serverState.running = false;
      setTimeout(() => initTcpBridge(45000), 1000);
    }
  });

  server.listen(port, '0.0.0.0', () => {
    serverState.running = true;
    console.log(`🚀 [TCP Bridge] Socket Server active and listening on 0.0.0.0:${port}`);
  });

  return serverState;
}

function getBridgeStatus() {
  return {
    ...serverState,
    activeConnections: connectedClients.size,
  };
}

function broadcastMessage(payload) {
  if (!serverState.running || connectedClients.size === 0) {
    return false;
  }

  const messageStr = typeof payload === 'string' ? payload : JSON.stringify(payload);
  for (const client of connectedClients) {
    try {
      client.write(messageStr + '\n');
    } catch (err) {
      console.error('[TCP Bridge] Failed to send message to client socket:', err.message);
    }
  }
  return true;
}

module.exports = {
  initTcpBridge,
  getBridgeStatus,
  broadcastMessage,
};
