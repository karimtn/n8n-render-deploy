// server.js
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');

const app = express();
const server = http.createServer(app);

// Configure CORS
app.use(cors());

// Initialize Socket.IO with CORS
const io = new Server(server, {
  cors: {
    origin: '*', // In production, specify your domains
    methods: ['GET', 'POST']
  }
});

// Store active sessions: { code: { mobileSocket, webSocket } }
const activeSessions = new Map();

// Store mobile devices waiting for connection: { code: socketId }
const mobileDevices = new Map();

io.on('connection', (socket) => {
  console.log(`Client connected: ${socket.id}`);

  // Mobile device registers with a code
  socket.on('register-mobile', ({ code }) => {
    console.log(`Mobile device registered with code: ${code}`);
    
    // Store mobile device
    mobileDevices.set(code, socket.id);
    socket.code = code;
    socket.deviceType = 'mobile';

    // Initialize session if doesn't exist
    if (!activeSessions.has(code)) {
      activeSessions.set(code, { mobileSocket: socket, webSocket: null });
    } else {
      activeSessions.get(code).mobileSocket = socket;
    }

    socket.emit('registered', { code });
  });

  // Web client tries to verify code
  socket.on('verify-code', ({ code }) => {
    console.log(`Web client attempting to verify code: ${code}`);

    if (mobileDevices.has(code)) {
      const session = activeSessions.get(code);
      
      if (session && session.mobileSocket) {
        // Link web socket to session
        session.webSocket = socket;
        socket.code = code;
        socket.deviceType = 'web';

        // Notify web client
        socket.emit('code-verified', { 
          message: 'Connected successfully!',
          code 
        });

        // Notify mobile device
        session.mobileSocket.emit('web-connected', { 
          message: 'Web client connected' 
        });

        console.log(`Session established for code: ${code}`);
      } else {
        socket.emit('code-invalid', { message: 'Mobile device not available' });
      }
    } else {
      socket.emit('code-invalid', { message: 'Invalid code' });
    }
  });

  // Mobile sends message to web
  socket.on('mobile-to-web', ({ message }) => {
    if (socket.deviceType === 'mobile' && socket.code) {
      const session = activeSessions.get(socket.code);
      
      if (session && session.webSocket) {
        session.webSocket.emit('mobile-message', { message });
        console.log(`Message from mobile to web [${socket.code}]: ${message}`);
      }
    }
  });

  // Web sends message to mobile
  socket.on('web-to-mobile', ({ message }) => {
    if (socket.deviceType === 'web' && socket.code) {
      const session = activeSessions.get(socket.code);
      
      if (session && session.mobileSocket) {
        session.mobileSocket.emit('web-message', { message });
        console.log(`Message from web to mobile [${socket.code}]: ${message}`);
      }
    }
  });

  // Handle disconnect
  socket.on('disconnect', () => {
    console.log(`Client disconnected: ${socket.id}`);

    if (socket.code) {
      const session = activeSessions.get(socket.code);

      if (session) {
        if (socket.deviceType === 'mobile') {
          // Notify web client that mobile disconnected
          if (session.webSocket) {
            session.webSocket.emit('mobile-disconnected');
          }
          mobileDevices.delete(socket.code);
          activeSessions.delete(socket.code);
        } else if (socket.deviceType === 'web') {
          // Notify mobile that web disconnected
          if (session.mobileSocket) {
            session.mobileSocket.emit('web-disconnected');
          }
          session.webSocket = null;
        }
      }
    }
  });
});

// API endpoint to check server status
app.get('/status', (req, res) => {
  res.json({
    status: 'running',
    activeSessions: activeSessions.size,
    mobileDevices: mobileDevices.size,
    timestamp: new Date().toISOString()
  });
});

// API endpoint to get active codes (for debugging)
app.get('/codes', (req, res) => {
  res.json({
    codes: Array.from(mobileDevices.keys())
  });
});

const PORT = process.env.PORT || 3001;

server.listen(PORT, () => {
  console.log(`Socket.IO server running on port ${PORT}`);
  console.log(`Status endpoint: http://localhost:${PORT}/status`);
});

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('SIGTERM signal received: closing HTTP server');
  server.close(() => {
    console.log('HTTP server closed');
  });
});