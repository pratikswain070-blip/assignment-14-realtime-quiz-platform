/**
 * Host Control Deck Logic — The Trivia Arena
 */

document.addEventListener('DOMContentLoaded', () => {
  const socket = createArenaSocket();

  // State Variables
  let currentPin = null;
  let totalQuestions = 10;
  let currentQuestionIndex = 0;
  let isLastQuestion = false;
  let knownPlayers = new Set();
  let prevLeaderboardPositions = new Map(); // id -> boundingClientRect.top

  // DOM Elements - Screens
  const screenLobby = document.getElementById('screen-lobby');
  const screenQuestion = document.getElementById('screen-question');
  const screenLeaderboard = document.getElementById('screen-leaderboard');
  const screenPodium = document.getElementById('screen-podium');

  // DOM Elements - Header & Lobby
  const roomPinBadge = document.getElementById('room-pin-badge');
  const headerPlayerCount = document.getElementById('header-player-count');
  const lobbyPin = document.getElementById('lobby-pin');
  const lobbyUrlText = document.getElementById('lobby-url-text');
  const copyLinkBtn = document.getElementById('copy-link-btn');
  const startGameBtn = document.getElementById('start-game-btn');
  const startPlayerCount = document.getElementById('start-player-count');
  const rosterCountBadge = document.getElementById('roster-count-badge');
  const rosterGrid = document.getElementById('roster-grid');
  const rosterEmptyState = document.getElementById('roster-empty-state');
  const soundBtn = document.getElementById('sound-btn');

  // DOM Elements - Question Screen
  const qCategory = document.getElementById('q-category');
  const qTracker = document.getElementById('q-tracker');
  const qHeadline = document.getElementById('q-headline');
  const timerCircle = document.getElementById('timer-circle');
  const timerSec = document.getElementById('timer-sec');
  const qAnsweredCount = document.getElementById('q-answered-count');
  const qTotalCount = document.getElementById('q-total-count');
  const revealExplanation = document.getElementById('reveal-explanation');
  const explanationText = document.getElementById('explanation-text');
  const optionCards = document.querySelectorAll('.option-card');

  // DOM Elements - Leaderboard & Podium
  const leaderboardList = document.getElementById('leaderboard-list');
  const lbRoundInfo = document.getElementById('lb-round-info');
  const btnNextQuestion = document.getElementById('btn-next-question');

  // Sound Toggle
  let isMuted = false;
  soundBtn.addEventListener('click', () => {
    isMuted = !isMuted;
    window.soundFx.muted = isMuted;
    soundBtn.textContent = isMuted ? '🔇' : '🔊';
  });

  // Switch Screen Helper
  function showScreen(screenEl) {
    [screenLobby, screenQuestion, screenLeaderboard, screenPodium].forEach(s => {
      s.classList.remove('active');
    });
    screenEl.classList.add('active');
  }

  // Update join URL label
  const playerUrl = `${window.location.protocol}//${window.location.host}/player.html`;
  if (lobbyUrlText) lobbyUrlText.textContent = `${window.location.host}/player.html`;

  // Copy join link button
  copyLinkBtn.addEventListener('click', () => {
    const shareUrl = `${playerUrl}?pin=${currentPin}`;
    navigator.clipboard.writeText(shareUrl).then(() => {
      showToast('Player join link copied to clipboard!', 'success');
    }).catch(() => {
      showToast(`Join URL: ${shareUrl}`, 'info');
    });
  });

  // Start game button
  startGameBtn.addEventListener('click', () => {
    if (!currentPin) return;
    window.soundFx.playTap();
    socket.emit('quiz:start', { pin: currentPin });
  });

  // Advance to next question from leaderboard
  btnNextQuestion.addEventListener('click', () => {
    if (!currentPin) return;
    window.soundFx.playTap();
    socket.emit('quiz:next', { pin: currentPin });
  });

  // =========================================================================
  // SOCKET EVENT LISTENERS
  // =========================================================================

  // Initial connection -> Request room creation
  socket.on('connect', () => {
    if (!currentPin) {
      socket.emit('quiz:create');
    }
  });

  // Room created by server
  socket.on('quiz:created', (data) => {
    currentPin = data.pin;
    roomPinBadge.textContent = `PIN: ${data.pin}`;
    lobbyPin.textContent = data.pin;
    console.log(`[HOST] Room initialized with PIN ${currentPin}`);
  });

  // Lobby roster updates (players join/leave)
  socket.on('lobby:update', (data) => {
    const { players, playerCount } = data;
    
    headerPlayerCount.textContent = `${playerCount} Connected`;
    startPlayerCount.textContent = playerCount;
    rosterCountBadge.textContent = `${playerCount} REGISTERED`;

    // Enable start button if at least 1 player is connected
    startGameBtn.disabled = (playerCount === 0);

    // Render roster cards
    if (players.length === 0) {
      rosterGrid.innerHTML = '';
      rosterGrid.appendChild(rosterEmptyState);
    } else {
      if (rosterEmptyState.parentElement) {
        rosterEmptyState.remove();
      }

      // Diff and append new players
      players.forEach(p => {
        if (!p.isConnected) return;
        if (!knownPlayers.has(p.id)) {
          knownPlayers.add(p.id);
          window.soundFx.playTap();

          const card = document.createElement('div');
          card.className = 'roster-card';
          card.id = `roster-player-${p.id}`;
          card.innerHTML = `
            <div class="roster-avatar">${p.nickname.charAt(0).toUpperCase()}</div>
            <div class="roster-name">${p.nickname}</div>
          `;
          rosterGrid.appendChild(card);
        }
      });

      // Remove disconnected players from lobby grid
      const currentActiveIds = new Set(players.filter(p => p.isConnected).map(p => p.id));
      knownPlayers.forEach(id => {
        if (!currentActiveIds.has(id)) {
          knownPlayers.delete(id);
          const card = document.getElementById(`roster-player-${id}`);
          if (card) card.remove();
        }
      });
    }
  });

  // Quiz started
  socket.on('quiz:started', (data) => {
    totalQuestions = data.totalQuestions || 10;
    showToast('Match Launching — Prepare Contenders!', 'info');
  });

  // Question Start
  socket.on('question:start', (data) => {
    currentQuestionIndex = data.questionIndex;
    totalQuestions = data.totalQuestions;

    showScreen(screenQuestion);

    // Reset UI states
    qCategory.textContent = data.category || 'General Knowledge';
    qTracker.textContent = `QUESTION ${String(data.questionIndex + 1).padStart(2, '0')} OF ${String(totalQuestions).padStart(2, '0')}`;
    qHeadline.textContent = data.question;

    qAnsweredCount.textContent = '0';
    qTotalCount.textContent = knownPlayers.size || '0';

    revealExplanation.classList.remove('active');
    timerCircle.className.baseVal = 'timer-progress';

    // Populate Option Cards
    optionCards.forEach(card => {
      card.className = `option-card option-${card.dataset.option.toLowerCase()}`;
      const optData = data.options.find(o => o.id === card.dataset.option);
      const label = card.querySelector('.option-label');
      const statBar = card.querySelector('.option-stat-bar');
      const statFill = card.querySelector('.stat-fill');
      const statCount = card.querySelector('.stat-count');

      if (optData && label) {
        label.textContent = optData.text;
      }
      if (statFill) statFill.style.width = '0%';
      if (statCount) statCount.textContent = '0';
    });
  });

  // Authoritative Timer Ticks from Server
  const CIRCUMFERENCE = 339.292; // 2 * Math.PI * 54
  let lastSecondPlayed = -1;

  socket.on('question:tick', (data) => {
    const { remainingMs, totalMs, percent } = data;
    const offset = CIRCUMFERENCE * (1 - percent / 100);
    timerCircle.style.strokeDashoffset = offset;

    const seconds = Math.ceil(remainingMs / 1000);
    timerSec.textContent = seconds;

    // Color shift based on remaining time
    if (remainingMs <= 4000) {
      timerCircle.className.baseVal = 'timer-progress timer-urgent';
      if (seconds !== lastSecondPlayed && seconds > 0) {
        window.soundFx.playTick(true);
        lastSecondPlayed = seconds;
      }
    } else if (remainingMs <= 8000) {
      timerCircle.className.baseVal = 'timer-progress timer-warning';
      if (seconds !== lastSecondPlayed && seconds % 2 === 0) {
        window.soundFx.playTick(false);
        lastSecondPlayed = seconds;
      }
    } else {
      timerCircle.className.baseVal = 'timer-progress';
    }
  });

  // Live Answer Count Update (Host Only)
  socket.on('player:answered', (data) => {
    qAnsweredCount.textContent = data.answeredCount;
    qTotalCount.textContent = data.totalPlayers;
    window.soundFx.playTap();
  });

  // Time's Up & Answer Reveal
  socket.on('question:time_up', (data) => {
    const { correctOptionId, explanation, optionStats, totalAnswers } = data;

    window.soundFx.playCorrect();

    // Reveal options
    optionCards.forEach(card => {
      const optId = card.dataset.option;
      const count = (optionStats && optionStats[optId]) || 0;
      const pct = totalAnswers > 0 ? Math.round((count / totalAnswers) * 100) : 0;

      const statFill = card.querySelector('.stat-fill');
      const statCount = card.querySelector('.stat-count');

      card.classList.add('show-stats');
      if (statFill) statFill.style.width = `${pct}%`;
      if (statCount) statCount.textContent = `${count}`;

      if (optId === correctOptionId) {
        card.classList.add('option-correct');
      } else {
        card.classList.add('option-dimmed');
      }
    });

    // Show explanation
    if (explanation) {
      explanationText.textContent = explanation;
      revealExplanation.classList.add('active');
    }
  });

  // Leaderboard Update (with FLIP Animation)
  socket.on('leaderboard:update', (data) => {
    const { leaderboard, questionIndex, isLastQuestion: lastQ } = data;
    isLastQuestion = lastQ;

    showScreen(screenLeaderboard);
    lbRoundInfo.textContent = `After Question ${questionIndex + 1} of ${totalQuestions}`;
    btnNextQuestion.innerHTML = isLastQuestion 
      ? `<span>View Grand Champion</span> <span>👑</span>` 
      : `<span>Next Question</span> <span>→</span>`;

    renderLeaderboardFLIP(leaderboard);
  });

  // FLIP (First, Last, Invert, Play) Leaderboard Renderer
  function renderLeaderboardFLIP(leaderboard) {
    // 1. FIRST: Record current bounding rects of existing rows
    const firstPositions = new Map();
    document.querySelectorAll('.lb-row').forEach(row => {
      const id = row.dataset.playerId;
      if (id) {
        firstPositions.set(id, row.getBoundingClientRect().top);
      }
    });

    // 2. Build new DOM structure
    leaderboardList.innerHTML = '';
    leaderboard.forEach(player => {
      const row = document.createElement('div');
      row.className = `lb-row rank-${player.rank}`;
      row.dataset.playerId = player.id;
      row.id = `lb-row-${player.id}`;

      const deltaBadge = player.deltaScore > 0 
        ? `<span class="lb-delta mono">+${player.deltaScore.toLocaleString()}</span>`
        : `<span class="lb-delta mono" style="color:var(--text-muted);">+0</span>`;

      const streakBadge = player.streak > 1 
        ? `<span class="lb-streak">🔥 ${player.streak}</span>` 
        : '';

      row.innerHTML = `
        <div class="lb-rank mono">#${player.rank}</div>
        <div class="lb-player">
          <span class="lb-name">${player.nickname}</span>
          ${streakBadge}
        </div>
        ${deltaBadge}
        <div class="lb-score mono">${player.score.toLocaleString()}</div>
      `;

      leaderboardList.appendChild(row);
    });

    // 3. LAST & INVERT: Calculate delta and apply inverse transform
    document.querySelectorAll('.lb-row').forEach(row => {
      const id = row.dataset.playerId;
      const firstTop = firstPositions.get(id);

      if (firstTop !== undefined) {
        const lastTop = row.getBoundingClientRect().top;
        const deltaY = firstTop - lastTop;

        if (deltaY !== 0) {
          row.style.transform = `translateY(${deltaY}px)`;
          row.style.transition = 'none';

          // 4. PLAY: Animate to final position in next frame
          requestAnimationFrame(() => {
            row.style.transition = 'transform 0.7s cubic-bezier(0.16, 1, 0.3, 1)';
            row.style.transform = 'translateY(0)';
          });
        }
      } else {
        // New row fade in
        row.style.animation = 'rosterSlideIn 0.5s ease forwards';
      }
    });
  }

  // Quiz Ended / Winner Reveal Screen
  socket.on('quiz:ended', (data) => {
    if (data.reason === 'HOST_DISCONNECTED') {
      showToast(data.message, 'error');
      return;
    }

    const { winner, podium, finalLeaderboard } = data;
    showScreen(screenPodium);

    // Winner spotlight
    const winnerNameEl = document.getElementById('winner-name');
    const winnerScoreEl = document.getElementById('winner-score');
    const winnerStatsEl = document.getElementById('winner-stats');

    if (winner) {
      winnerNameEl.textContent = winner.nickname;
      animateNumber(winnerScoreEl, 0, winner.score, 1200);
      winnerStatsEl.textContent = `${winner.correctCount || 0} Correct Answers | Highest Streak: ${winner.highestStreak || 0}`;
    }

    // Top 3 Podium
    const p1 = podium.find(p => p.rank === 1);
    const p2 = podium.find(p => p.rank === 2);
    const p3 = podium.find(p => p.rank === 3);

    if (p1) {
      document.getElementById('podium-p1-name').textContent = p1.nickname;
      document.getElementById('podium-p1-score').textContent = `${p1.score.toLocaleString()} pts`;
    }
    if (p2) {
      document.getElementById('podium-p2-name').textContent = p2.nickname;
      document.getElementById('podium-p2-score').textContent = `${p2.score.toLocaleString()} pts`;
    }
    if (p3) {
      document.getElementById('podium-p3-name').textContent = p3.nickname;
      document.getElementById('podium-p3-score').textContent = `${p3.score.toLocaleString()} pts`;
    }

    // Full match standings
    const finalStandingsList = document.getElementById('final-standings-list');
    finalStandingsList.innerHTML = '';
    (finalLeaderboard || []).forEach(p => {
      const row = document.createElement('div');
      row.className = 'final-row';
      row.innerHTML = `
        <span class="mono" style="color:var(--accent-gold);">#${p.rank} <strong>${p.nickname}</strong></span>
        <span class="mono">${p.score.toLocaleString()} PTS</span>
      `;
      finalStandingsList.appendChild(row);
    });

    // Sound fanfare & Canvas Confetti
    window.soundFx.playFanfare();
    launchConfetti();
  });

  // Particle Confetti Simulation on Canvas
  function launchConfetti() {
    const canvas = document.getElementById('confetti-canvas');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');

    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;

    const particles = [];
    const colors = ['#c9a15a', '#e8c57e', '#ffffff', '#8a1f2b', '#2ecc71', '#3498db', '#d97706'];

    for (let i = 0; i < 180; i++) {
      particles.push({
        x: canvas.width / 2,
        y: canvas.height / 2,
        vx: (Math.random() - 0.5) * 22,
        vy: (Math.random() - 0.8) * 24 - 4,
        size: Math.random() * 8 + 4,
        color: colors[Math.floor(Math.random() * colors.length)],
        rotation: Math.random() * 360,
        rotSpeed: (Math.random() - 0.5) * 12,
        alpha: 1,
        gravity: 0.38
      });
    }

    function renderConfetti() {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      let aliveCount = 0;

      particles.forEach(p => {
        p.x += p.vx;
        p.y += p.vy;
        p.vy += p.gravity;
        p.rotation += p.rotSpeed;
        p.alpha -= 0.005;

        if (p.alpha > 0) {
          aliveCount++;
          ctx.save();
          ctx.globalAlpha = Math.max(0, p.alpha);
          ctx.translate(p.x, p.y);
          ctx.rotate((p.rotation * Math.PI) / 180);
          ctx.fillStyle = p.color;
          ctx.fillRect(-p.size / 2, -p.size / 2, p.size, p.size * 0.6);
          ctx.restore();
        }
      });

      if (aliveCount > 0) {
        requestAnimationFrame(renderConfetti);
      }
    }

    renderConfetti();
  }
});
