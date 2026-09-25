# The Trivia Arena — Production-Grade Real-Time Multiplayer Trivia

An editorial-grade, server-authoritative real-time multiplayer trivia platform built with Node.js, Express.js, Socket.io, and Vanilla JS/CSS. Designed like a dark luxury broadcast graphic (think a cross between a late-night championship scoreboard and an editorial magazine spread).

---

## 🏛️ Architecture & File Structure

```text
assignment-14-quiz-socket/
├── data/
│   └── questions.json      # 10 editorial trivia questions across history, science, art, cinema
├── public/
│   ├── index.html          # Luxury landing page & dual-portal entry
│   ├── host.html           # Full-bleed projector stage & host control deck
│   ├── player.html         # Mobile-first gamepad with tactile 2x2 luxury option pads
│   ├── css/
│   │   ├── tokens.css      # Design tokens (near-black warm charcoal, gold accents, typography)
│   │   ├── base.css        # Resets, typography rules, buttons, toasts, reduced-motion
│   │   ├── host.css        # Radial timer, glowing billboard PIN, FLIP leaderboard, podium
│   │   └── player.css      # Segmented PIN input, 2x2 geometric pads, reveal shake/glow
│   └── js/
│       ├── socket-client.js# Web Audio API sound synthesizer, toasts, number interpolators
│       ├── host.js         # Host state machine, radial timer renderer, FLIP DOM animations
│       └── player.js       # Auto-advancing segmented PIN input, answer lock, score counters
├── sockets/
│   ├── gameEngine.js       # Server-authoritative timer, round transitions, pure scoring function
│   └── lobbyHandler.js     # Collision-free 4-digit PIN generator, join/leave, disconnect resilience
├── test/
│   └── gameEngine.test.js  # Automated unit tests for scoring, boundaries, late answers, and PINs
├── server.js               # Express app, Socket.io initialization, static assets, health routes
├── package.json
└── README.md
```

---

## ⏱️ Server-Authoritative Architecture & Anti-Cheat

### 1. Zero Client-Clock Reliance
- **Server Timer Loop**: All round deadlines are set on the server (`room.questionDeadline = questionStartedAt + timeLimitMs`).
- **250ms Broadcast Ticks**: The server broadcasts `question:tick` containing `{ remainingMs, totalMs, percent }` every 250 milliseconds. Clients merely render what the server authoritatively commands and never execute independent driftable timers.
- **Early Conclude Trigger**: If all active connected players submit their answers before the timer runs out, the server gracefully concludes the round without unnecessary waiting.

### 2. Anti-Cheat & Late Answer Rejection
- **Single Submission Guarantee**: Once a player submits an answer for question index `i`, subsequent submissions for the same question are rejected.
- **Strict Timestamp Cutoff**: If an `answer:submit` packet arrives after `room.questionDeadline` (beyond a 150ms network jitter grace buffer), it is **silently rejected on the server** and awarded **0 points**. The server logs the rejection:
  ```text
  [LATE ANSWER REJECTED] Player "Athena" answer arrived 240ms after server deadline in room 4829
  ```
- **Payload Sanitization**: When emitting `question:start`, the correct answer ID and explanation are strictly omitted from the client payload. They are only sent in `question:time_up` after the round ends.

---

## 🧮 Scoring Algorithm

The scoring formula is implemented as a pure, unit-tested function in `sockets/gameEngine.js`:

$$\text{Score} = \begin{cases} 
0 & \text{if } \text{isCorrect} = \text{false} \lor t > T \lor t < 0 \\
\left( 500 + \left\lfloor 500 \cdot \frac{T - t}{T} \right\rfloor \right) + \text{StreakBonus} & \text{if } \text{isCorrect} = \text{true}
\end{cases}$$

Where:
- $T = \text{totalTimeMs}$ (default $15{,}000\text{ ms}$)
- $t = \text{timeTakenMs} = \text{serverReceivedAt} - \text{questionStartedAt}$
- $\text{StreakBonus} = \min((\text{streak} - 1) \times 50, 200)$ for $\text{streak} \ge 2$.

### Score Examples:
| Time Taken | Correct? | Streak | Base Points | Speed Bonus | Streak Bonus | Total Score |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| **0 ms** (Instant) | Yes | 1 | 500 | +500 | 0 | **1000 pts** |
| **7,500 ms** (Half-time) | Yes | 1 | 500 | +250 | 0 | **750 pts** |
| **15,000 ms** (Last ms) | Yes | 1 | 500 | 0 | 0 | **500 pts** |
| **2,000 ms** (Fast + Streak 3) | Yes | 3 | 500 | +433 | +100 | **1033 pts** |
| **Any time** | No | 0 | 0 | 0 | 0 | **0 pts** |
| **> 15,000 ms** (Late) | Yes | 1 | 0 | 0 | 0 | **0 pts (Rejected)** |

---

## 📡 Socket Event Protocol Matrix

| Event Name | Direction | Payload Shape | Description |
| :--- | :--- | :--- | :--- |
| `quiz:create` | Host → Server | `{}` | Host requests new room generation. |
| `quiz:created` | Server → Host | `{ pin, roomCode, hostId, state }` | Returns unique 4-digit PIN. |
| `quiz:join` | Player → Server | `{ pin, nickname }` | Player requests entry to room. |
| `quiz:joined` | Server → Player | `{ pin, playerId, nickname, state }` | Confirms player join. |
| `lobby:update` | Server → Room | `{ pin, playerCount, totalRegistered, players: [...] }` | Broadcasts roster updates. |
| `quiz:start` | Host → Server | `{ pin }` | Host launches the match. |
| `quiz:started` | Server → Room | `{ pin, totalQuestions }` | Signals game start sequence. |
| `question:start` | Server → Room | `{ pin, questionIndex, totalQuestions, question, options, timeLimitMs }` | Broadcasts sanitized question. |
| `question:tick` | Server → Room | `{ remainingMs, totalMs, percent }` | 250ms authoritative timer tick. |
| `player:answered` | Server → Host | `{ answeredCount, totalPlayers, playerId, nickname }` | Real-time answer counter for host only. |
| `answer:submit` | Player → Server | `{ pin, questionIndex, answerId }` | Player submits option choice. |
| `answer:acknowledged` | Server → Player | `{ answerId, timeTakenMs, isReceived }` | Immediate client receipt ack. |
| `question:time_up` | Server → Room | `{ questionIndex, correctOptionId, explanation, optionStats, totalAnswers }` | Broadcasts results & answer stats. |
| `round:result` | Server → Player | `{ isCorrect, deltaScore, totalScore, streak, explanation }` | Personalized score delta per player. |
| `leaderboard:update` | Server → Room | `{ questionIndex, isLastQuestion, leaderboard: [...] }` | Broadcasts ranked standings. |
| `quiz:next` | Host → Server | `{ pin }` | Host advances to next round. |
| `quiz:ended` | Server → Room | `{ winner: {...}, podium: [...], finalLeaderboard: [...] }` | Concludes match with full standings. |
| `quiz:error` | Server → Client | `{ code, message }` | Handles room missing, full, or late input errors. |

---

## 🎨 Design System & Editorial Aesthetics

- **Color Foundation**: Near-black warm charcoal (`#0a0908` / `#12110f`) paired with metallic deep amber (`#c9a15a` / `#e8c57e`) and blood garnet (`#8a1f2b`).
- **Typography**: Display headlines set in `Fraunces` editorial serif; all numeric data (PINs, scores, timers, ranks) set in `JetBrains Mono` with `tabular-nums`.
- **Host Dashboard**:
  - Huge glowing 4-digit billboard PIN with copyable share link.
  - SVG radial countdown ring shifting color dynamically (`#c9a15a` → `#f59e0b` → `#ef4444`).
  - FLIP-animated leaderboard where player bars slide smoothly past each other upon rank changes.
  - HTML5 Canvas particle confetti physics for the champion reveal.
- **Player Gamepad**:
  - Mobile-first layout with auto-advancing segmented PIN inputs.
  - 2×2 dark luxury geometric shape buttons (▲ Triangle, ◆ Diamond, ● Circle, ■ Square) with micro-press physics.
  - Web Audio API real-time synthesized sound effects (ticks, chimes, thuds, fanfare) with zero external audio assets.

---

## 🚀 Quickstart & Setup

### Prerequisites
- Node.js (v18+ recommended)
- npm

### Installation
```bash
# Clone or enter directory
cd assignment-14-quiz-socket

# Install dependencies
npm install

# Run unit test suite
npm test

# Launch the server
npm start
```

### Accessing the Application
- **Landing Hub**: [http://localhost:3000](http://localhost:3000)
- **Host Control Deck**: [http://localhost:3000/host.html](http://localhost:3000/host.html)
- **Player Gamepad**: [http://localhost:3000/player.html](http://localhost:3000/player.html)

---

## 🧪 Verification & Multi-Client Testing Flow

1. Open [http://localhost:3000/host.html](http://localhost:3000/host.html) in one browser tab. Note the generated 4-digit PIN (e.g. `5832`).
2. Open [http://localhost:3000/player.html](http://localhost:3000/player.html) in two separate incognito tabs or mobile devices.
3. Enter the 4-digit PIN and nicknames (e.g., `Athena` and `Leonardo`).
4. Watch the host stage roster update dynamically with animated contender badges.
5. Click **"Launch Match"** on the Host Deck.
6. Submit answers on player pads:
   - Observe instantaneous tap feedback and locked state.
   - Observe the live "N / total answered" counter on the host screen.
   - Observe the radial timer color shift and synchronised 250ms ticks.
7. Upon round expiration, verify the answer distribution bar chart, explanation banner, and personalized score count-up animations.
8. View the FLIP-animated leaderboard as rankings update.
9. Complete all rounds to trigger the Grand Champion podium and canvas confetti celebration!
