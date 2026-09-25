/**
 * End-to-End Multi-Client Socket Simulation
 * Simulates Host + 2 Players over real WebSocket connections.
 */

const { io } = require('socket.io-client');
const assert = require('assert');

const SERVER_URL = 'http://localhost:3000';

async function runE2ETest() {
  console.log('--- Starting End-to-End Multi-Client Trivia Arena Simulation ---');

  const hostSocket = io(SERVER_URL);
  const player1Socket = io(SERVER_URL);
  const player2Socket = io(SERVER_URL);

  let roomPin = null;

  // 1. Host creates room
  await new Promise((resolve) => {
    hostSocket.on('connect', () => {
      console.log('Host socket connected');
      hostSocket.emit('quiz:create');
    });

    hostSocket.on('quiz:created', (data) => {
      roomPin = data.pin;
      console.log(`✓ Host created room with PIN: ${roomPin}`);
      assert.strictEqual(typeof roomPin, 'string');
      assert.strictEqual(roomPin.length, 4);
      resolve();
    });
  });

  // 2. Players Join
  await new Promise((resolve) => {
    let joinedCount = 0;

    player1Socket.emit('quiz:join', { pin: roomPin, nickname: 'Hypatia' });
    player2Socket.emit('quiz:join', { pin: roomPin, nickname: 'Aristotle' });

    player1Socket.on('quiz:joined', (data) => {
      console.log(`✓ Player 1 joined: ${data.nickname} in room ${data.pin}`);
      joinedCount++;
      if (joinedCount === 2) resolve();
    });

    player2Socket.on('quiz:joined', (data) => {
      console.log(`✓ Player 2 joined: ${data.nickname} in room ${data.pin}`);
      joinedCount++;
      if (joinedCount === 2) resolve();
    });
  });

  // 3. Host starts quiz
  await new Promise((resolve) => {
    hostSocket.emit('quiz:start', { pin: roomPin });

    hostSocket.on('question:start', (qData) => {
      console.log(`✓ Question 1 started: "${qData.question}" (Category: ${qData.category})`);
      assert.strictEqual(qData.options.length, 4);
      assert.strictEqual(qData.correctOptionId, undefined, 'Correct option MUST NOT be leaked to clients');
      resolve();
    });
  });

  // 4. Tick verification & Answering
  await new Promise((resolve) => {
    let answeredCounter = 0;
    hostSocket.on('player:answered', (data) => {
      console.log(`✓ Host received player:answered notification: ${data.answeredCount}/${data.totalPlayers}`);
    });

    // Player 1 answers B (Correct)
    player1Socket.emit('answer:submit', { pin: roomPin, questionIndex: 0, answerId: 'B' });
    // Player 2 answers A (Incorrect)
    player2Socket.emit('answer:submit', { pin: roomPin, questionIndex: 0, answerId: 'A' });

    let resultsReceived = 0;
    player1Socket.on('round:result', (res) => {
      console.log(`✓ Player 1 (Hypatia) round result: isCorrect=${res.isCorrect}, deltaScore=${res.deltaScore}, totalScore=${res.totalScore}`);
      assert.strictEqual(res.isCorrect, true);
      assert(res.deltaScore >= 500 && res.deltaScore <= 1000);
      resultsReceived++;
      if (resultsReceived === 2) resolve();
    });

    player2Socket.on('round:result', (res) => {
      console.log(`✓ Player 2 (Aristotle) round result: isCorrect=${res.isCorrect}, deltaScore=${res.deltaScore}`);
      assert.strictEqual(res.isCorrect, false);
      assert.strictEqual(res.deltaScore, 0);
      resultsReceived++;
      if (resultsReceived === 2) resolve();
    });
  });

  // 5. Leaderboard Update
  await new Promise((resolve) => {
    hostSocket.on('leaderboard:update', (lbData) => {
      console.log(`✓ Leaderboard broadcast received: Rank 1 is "${lbData.leaderboard[0].nickname}" with ${lbData.leaderboard[0].score} pts`);
      assert.strictEqual(lbData.leaderboard[0].nickname, 'Hypatia');
      assert.strictEqual(lbData.leaderboard[1].nickname, 'Aristotle');
      resolve();
    });
  });

  console.log('===========================================================');
  console.log(' END-TO-END MULTI-CLIENT SOCKET SIMULATION PASSED 100%! ');
  console.log('===========================================================');

  hostSocket.disconnect();
  player1Socket.disconnect();
  player2Socket.disconnect();
  process.exit(0);
}

runE2ETest().catch((err) => {
  console.error('Simulation failed:', err);
  process.exit(1);
});
