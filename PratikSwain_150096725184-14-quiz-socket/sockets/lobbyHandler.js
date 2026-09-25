/**
 * Lobby Handler — Room lifecycle, PIN collision prevention, and Disconnect resilience
 */

const { GameEngine } = require('./gameEngine');

class Room {
  constructor(pin, hostSocketId, io) {
    this.pin = pin;
    this.hostSocketId = hostSocketId;
    this.io = io;
    this.createdAt = Date.now();
    this.players = new Map(); // socketId -> { id, nickname, score, streak, isConnected, ... }
    this.gameEngine = new GameEngine(this, io);
  }

  getActivePlayerCount() {
    let count = 0;
    for (const player of this.players.values()) {
      if (player.isConnected) count++;
    }
    return count;
  }

  getLobbyPayload() {
    const playerList = [];
    for (const p of this.players.values()) {
      playerList.push({
        id: p.id,
        nickname: p.nickname,
        isConnected: p.isConnected,
        score: p.score || 0
      });
    }

    return {
      pin: this.pin,
      playerCount: playerList.filter(p => p.isConnected).length,
      totalRegistered: playerList.length,
      players: playerList,
      state: this.gameEngine.state
    };
  }

  cleanup() {
    if (this.gameEngine) {
      this.gameEngine.destroy();
    }
    this.players.clear();
  }
}

class LobbyManager {
  constructor(io) {
    this.io = io;
    this.rooms = new Map(); // pin -> Room
    this.socketToRoomMap = new Map(); // socketId -> { pin, role: 'HOST' | 'PLAYER' }
  }

  /**
   * Generate a 4-digit PIN guaranteed to not collide with active rooms.
   */
  generateUniquePin() {
    let pin;
    let attempts = 0;
    const maxAttempts = 9000;

    do {
      // 1000 to 9999
      pin = Math.floor(1000 + Math.random() * 9000).toString();
      attempts++;
      if (attempts > maxAttempts) {
        throw new Error('Room capacity reached; unable to generate unique PIN');
      }
    } while (this.rooms.has(pin));

    return pin;
  }

  /**
   * Register all socket event listeners for a connected client.
   */
  registerSocketEvents(socket) {
    console.log(`[SOCKET CONNECT] ${socket.id}`);

    // HOST: Create a new game room
    socket.on('quiz:create', () => {
      try {
        const pin = this.generateUniquePin();
        const room = new Room(pin, socket.id, this.io);
        this.rooms.set(pin, room);
        this.socketToRoomMap.set(socket.id, { pin, role: 'HOST' });

        socket.join(pin);

        console.log(`[ROOM CREATED] PIN: ${pin} by Host ${socket.id}`);

        socket.emit('quiz:created', {
          pin,
          roomCode: pin,
          hostId: socket.id,
          state: room.gameEngine.state
        });
      } catch (err) {
        console.error('[ROOM CREATE ERROR]', err);
        socket.emit('quiz:error', {
          code: 'CREATE_FAILED',
          message: 'Unable to initialize a new room. Please try again.'
        });
      }
    });

    // PLAYER: Join an existing game room with PIN and Nickname
    socket.on('quiz:join', (payload = {}) => {
      const { pin, nickname } = payload;
      const cleanPin = (pin || '').toString().trim();
      const cleanNickname = (nickname || '').toString().trim().slice(0, 24);

      if (!cleanPin || !cleanNickname) {
        return socket.emit('quiz:error', {
          code: 'INVALID_INPUT',
          message: 'Room PIN and player nickname are required.'
        });
      }

      const room = this.rooms.get(cleanPin);
      if (!room) {
        return socket.emit('quiz:error', {
          code: 'ROOM_NOT_FOUND',
          message: `Room #${cleanPin} does not exist. Please check the PIN.`
        });
      }

      if (room.gameEngine.state !== 'LOBBY') {
        return socket.emit('quiz:error', {
          code: 'GAME_IN_PROGRESS',
          message: 'This match has already begun. You cannot join mid-game.'
        });
      }

      // Check duplicate nickname in active players
      for (const p of room.players.values()) {
        if (p.isConnected && p.nickname.toLowerCase() === cleanNickname.toLowerCase()) {
          return socket.emit('quiz:error', {
            code: 'NICKNAME_TAKEN',
            message: `The name "${cleanNickname}" is already taken in this room. Please choose another.`
          });
        }
      }

      // Add player to room
      const playerObj = {
        id: socket.id,
        nickname: cleanNickname,
        score: 0,
        streak: 0,
        highestStreak: 0,
        correctAnswersCount: 0,
        lastDeltaScore: 0,
        lastIsCorrect: false,
        previousRank: 1,
        currentRank: 1,
        isConnected: true,
        joinedAt: Date.now()
      };

      room.players.set(socket.id, playerObj);
      this.socketToRoomMap.set(socket.id, { pin: cleanPin, role: 'PLAYER' });
      socket.join(cleanPin);

      console.log(`[PLAYER JOINED] "${cleanNickname}" (${socket.id}) joined room ${cleanPin}`);

      // Emit join confirmation to player
      socket.emit('quiz:joined', {
        pin: cleanPin,
        playerId: socket.id,
        nickname: cleanNickname,
        state: room.gameEngine.state
      });

      // Broadcast updated lobby to all in the room
      this.io.to(cleanPin).emit('lobby:update', room.getLobbyPayload());
    });

    // HOST: Start the quiz match
    socket.on('quiz:start', (payload = {}) => {
      const mapping = this.socketToRoomMap.get(socket.id);
      const pin = payload.pin || (mapping && mapping.pin);

      if (!pin) {
        return socket.emit('quiz:error', { code: 'NO_PIN', message: 'No active room specified' });
      }

      const room = this.rooms.get(pin);
      if (!room) {
        return socket.emit('quiz:error', { code: 'ROOM_NOT_FOUND', message: 'Room not found' });
      }

      if (room.hostSocketId !== socket.id) {
        return socket.emit('quiz:error', { code: 'UNAUTHORIZED', message: 'Only the host can start the quiz' });
      }

      const startResult = room.gameEngine.startQuiz();
      if (!startResult.success) {
        return socket.emit('quiz:error', {
          code: 'START_FAILED',
          message: startResult.message || 'Cannot start quiz'
        });
      }
    });

    // PLAYER: Submit answer
    socket.on('answer:submit', (payload = {}) => {
      const mapping = this.socketToRoomMap.get(socket.id);
      const pin = payload.pin || (mapping && mapping.pin);

      if (!pin) {
        return socket.emit('quiz:error', { code: 'NO_PIN', message: 'Not in a room' });
      }

      const room = this.rooms.get(pin);
      if (!room) {
        return socket.emit('quiz:error', { code: 'ROOM_NOT_FOUND', message: 'Room not found' });
      }

      room.gameEngine.submitAnswer(socket.id, payload);
    });

    // HOST: Advance to next question or conclude from leaderboard
    socket.on('quiz:next', (payload = {}) => {
      const mapping = this.socketToRoomMap.get(socket.id);
      const pin = payload.pin || (mapping && mapping.pin);

      if (!pin) return;
      const room = this.rooms.get(pin);
      if (!room || room.hostSocketId !== socket.id) return;

      room.gameEngine.advanceNext();
    });

    // DISCONNECT HANDLER
    socket.on('disconnect', () => {
      console.log(`[SOCKET DISCONNECT] ${socket.id}`);
      const mapping = this.socketToRoomMap.get(socket.id);
      if (!mapping) return;

      const { pin, role } = mapping;
      const room = this.rooms.get(pin);

      if (!room) {
        this.socketToRoomMap.delete(socket.id);
        return;
      }

      if (role === 'HOST') {
        console.log(`[HOST DISCONNECTED] Room ${pin} ending gracefully`);
        this.io.to(pin).emit('quiz:ended', {
          reason: 'HOST_DISCONNECTED',
          message: 'The host has disconnected. The match has ended.'
        });
        this.io.to(pin).emit('quiz:error', {
          code: 'HOST_DISCONNECTED',
          message: 'Host has left the arena. Game ended.'
        });

        room.cleanup();
        this.rooms.delete(pin);
      } else if (role === 'PLAYER') {
        const player = room.players.get(socket.id);
        if (player) {
          console.log(`[PLAYER DISCONNECTED] "${player.nickname}" left room ${pin}`);
          player.isConnected = false;

          if (room.gameEngine.state === 'LOBBY') {
            room.players.delete(socket.id);
            this.io.to(pin).emit('lobby:update', room.getLobbyPayload());
          } else {
            // Mid-game: don't crash the round. If this player was needed to finish round early, check:
            if (room.gameEngine.state === 'QUESTION_ACTIVE') {
              const activeCount = room.getActivePlayerCount();
              const answeredCount = room.gameEngine.currentAnswers.size;
              if (activeCount > 0 && answeredCount >= activeCount) {
                room.gameEngine.clearAllTimers();
                setTimeout(() => room.gameEngine.handleTimeUp(), 300);
              }
            }
          }
        }
      }

      this.socketToRoomMap.delete(socket.id);
    });
  }
}

module.exports = {
  Room,
  LobbyManager
};
