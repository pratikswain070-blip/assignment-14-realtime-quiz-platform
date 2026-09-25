/**
 * Production-Grade Trivia Arena Server
 * Node.js + Express + Socket.io (Server-Authoritative)
 */

require('dotenv').config();
const http = require('http');
const path = require('path');
const express = require('express');
const cors = require('cors');
const { Server } = require('socket.io');

const { LobbyManager } = require('./sockets/lobbyHandler');

const app = express();
const server = http.createServer(app);

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Socket.io initialization with CORS configuration
const io = new Server(server, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST']
  },
  pingTimeout: 20000,
  pingInterval: 10000
});

// Initialize Lobby and Socket Manager
const lobbyManager = new LobbyManager(io);

io.on('connection', (socket) => {
  lobbyManager.registerSocketEvents(socket);
});

// Health check and diagnostic endpoints
app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    activeRooms: lobbyManager.rooms.size
  });
});

app.get('/api/rooms', (req, res) => {
  const roomSummaries = [];
  for (const [pin, room] of lobbyManager.rooms.entries()) {
    roomSummaries.push({
      pin,
      state: room.gameEngine.state,
      playerCount: room.getActivePlayerCount(),
      createdAt: room.createdAt
    });
  }
  res.json({ rooms: roomSummaries });
});

// Default fallback to index.html
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

const PORT = process.env.PORT || 3000;

if (require.main === module) {
  server.listen(PORT, () => {
    console.log(`=======================================================`);
    console.log(` TRIVIA ARENA SERVER RUNNING ON PORT ${PORT}`);
    console.log(` Landing: http://localhost:${PORT}`);
    console.log(` Host:    http://localhost:${PORT}/host.html`);
    console.log(` Player:  http://localhost:${PORT}/player.html`);
    console.log(`=======================================================`);
  });
}

module.exports = { app, server, io, lobbyManager };
