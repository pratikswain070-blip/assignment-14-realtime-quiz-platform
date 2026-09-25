/**
 * Unit Tests for Game Engine & Scoring Rules
 */

const assert = require('assert');
const { calculateScore } = require('../sockets/gameEngine');
const { LobbyManager } = require('../sockets/lobbyHandler');

console.log('--- Running Game Engine & Scoring Unit Tests ---');

// Test 1: Incorrect answer always returns 0
assert.strictEqual(calculateScore(false, 2000, 15000), 0, 'Incorrect answer must score 0');
assert.strictEqual(calculateScore(false, 0, 15000), 0, 'Incorrect instant answer must score 0');
console.log('✓ Test 1 Passed: Incorrect answers always score 0');

// Test 2: Instant correct answer awards max base score (1000)
const instantScore = calculateScore(true, 0, 15000, 0);
assert.strictEqual(instantScore, 1000, `Instant correct score should be 1000, got ${instantScore}`);
console.log('✓ Test 2 Passed: Instant answer awards maximum 1000 points');

// Test 3: Last-millisecond correct answer awards base score (500)
const lastSecondScore = calculateScore(true, 15000, 15000, 0);
assert.strictEqual(lastSecondScore, 500, `Last second score should be 500, got ${lastSecondScore}`);
console.log('✓ Test 3 Passed: Last second answer awards base 500 points');

// Test 4: Mid-time answer (7500ms / 15000ms) awards 750 points
const midScore = calculateScore(true, 7500, 15000, 0);
assert.strictEqual(midScore, 750, `Mid-point score should be 750, got ${midScore}`);
console.log('✓ Test 4 Passed: Half-time answer scores proportionally (750)');

// Test 5: Streak bonus applies properly
const streak2Score = calculateScore(true, 0, 15000, 2); // 1000 + 50
assert.strictEqual(streak2Score, 1050, `Streak 2 should be 1050, got ${streak2Score}`);

const streak5Score = calculateScore(true, 0, 15000, 5); // 1000 + 200 (capped at 200)
assert.strictEqual(streak5Score, 1200, `Streak 5 should be capped at +200 (1200), got ${streak5Score}`);
console.log('✓ Test 5 Passed: Streak multipliers calculate and cap accurately');

// Test 6: Invalid/Late timings (> totalTimeMs or < 0) return 0
assert.strictEqual(calculateScore(true, 16000, 15000), 0, 'Answer beyond time limit must score 0');
assert.strictEqual(calculateScore(true, -100, 15000), 0, 'Negative time must score 0');
assert.strictEqual(calculateScore(true, NaN, 15000), 0, 'NaN time must score 0');
console.log('✓ Test 6 Passed: Out-of-bounds / late submissions return 0');

// Test 7: PIN generation uniqueness and format
const fakeIo = { on: () => {}, to: () => ({ emit: () => {} }) };
const lobby = new LobbyManager(fakeIo);
const pins = new Set();
for (let i = 0; i < 500; i++) {
  const pin = lobby.generateUniquePin();
  assert.strictEqual(pin.length, 4, 'PIN must be 4 digits');
  assert(!isNaN(Number(pin)), 'PIN must be numeric');
  assert(!pins.has(pin), `PIN collision detected: ${pin}`);
  pins.add(pin);
  lobby.rooms.set(pin, { pin }); // simulate active room
}
console.log('✓ Test 7 Passed: 500 Collision-free 4-digit PINs generated successfully');

console.log('====================================================');
console.log(' ALL 7 UNIT TESTS PASSED WITH 100% SUCCESS ');
console.log('====================================================');
