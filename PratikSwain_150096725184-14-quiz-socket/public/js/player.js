/**
 * Player Game Pad Logic — The Trivia Arena
 */

document.addEventListener('DOMContentLoaded', () => {
  const socket = createArenaSocket();

  // State
  let currentPin = '';
  let myNickname = '';
  let myScore = 0;
  let currentQuestionIndex = 0;
  let selectedOption = null;
  let hasSubmitted = false;

  // DOM Elements - Screens
  const screenJoin = document.getElementById('screen-join');
  const screenWaiting = document.getElementById('screen-waiting');
  const screenGamepad = document.getElementById('screen-gamepad');
  const screenResult = document.getElementById('screen-result');
  const screenFinal = document.getElementById('screen-final');

  // DOM Elements - Header
  const playerHeader = document.getElementById('player-header');
  const hdrNickname = document.getElementById('hdr-nickname');
  const hdrRank = document.getElementById('hdr-rank');
  const hdrScore = document.getElementById('hdr-score');

  // DOM Elements - Join Form & PIN inputs
  const joinForm = document.getElementById('join-form');
  const pinInputs = [
    document.getElementById('pin-1'),
    document.getElementById('pin-2'),
    document.getElementById('pin-3'),
    document.getElementById('pin-4')
  ];
  const nicknameInput = document.getElementById('nickname-input');

  // DOM Elements - Waiting Screen
  const waitingAvatar = document.getElementById('waiting-avatar');
  const waitingNickname = document.getElementById('waiting-nickname');
  const waitingPinBadge = document.getElementById('waiting-pin-badge');

  // DOM Elements - Game Pad Screen
  const padQIndex = document.getElementById('pad-q-index');
  const padTimerSec = document.getElementById('pad-timer-sec');
  const padButtons = document.querySelectorAll('.pad-btn');
  const padLockedOverlay = document.getElementById('pad-locked-overlay');
  const lockedChoiceMarker = document.getElementById('locked-choice-marker');

  // DOM Elements - Result Screen
  const resultCard = document.getElementById('result-card');
  const resultIcon = document.getElementById('result-icon');
  const resultTitle = document.getElementById('result-title');
  const resultDelta = document.getElementById('result-delta');
  const resultStreakBox = document.getElementById('result-streak-box');
  const resultStreakText = document.getElementById('result-streak-text');
  const resultExplanation = document.getElementById('result-explanation');

  // Helper: Switch screen
  function showScreen(screenEl) {
    [screenJoin, screenWaiting, screenGamepad, screenResult, screenFinal].forEach(s => {
      s.classList.remove('active');
    });
    screenEl.classList.add('active');
  }

  // =========================================================================
  // PIN AUTO-ADVANCE & INPUT HANDLING
  // =========================================================================
  pinInputs.forEach((input, index) => {
    input.addEventListener('input', (e) => {
      const val = e.target.value.replace(/[^0-9]/g, '');
      e.target.value = val ? val.slice(-1) : '';

      if (e.target.value && index < pinInputs.length - 1) {
        pinInputs[index + 1].focus();
      }
    });

    input.addEventListener('keydown', (e) => {
      if (e.key === 'Backspace' && !e.target.value && index > 0) {
        pinInputs[index - 1].focus();
      }
    });

    input.addEventListener('paste', (e) => {
      e.preventDefault();
      const pasteData = (e.clipboardData || window.clipboardData).getData('text').trim().replace(/[^0-9]/g, '');
      if (pasteData) {
        for (let i = 0; i < pinInputs.length; i++) {
          if (pasteData[i]) {
            pinInputs[i].value = pasteData[i];
          }
        }
        const nextIndex = Math.min(pasteData.length, pinInputs.length - 1);
        pinInputs[nextIndex].focus();
      }
    });
  });

  // Check URL query parameters for PIN (?pin=1234)
  const urlParams = new URLSearchParams(window.location.search);
  const paramPin = urlParams.get('pin');
  if (paramPin && paramPin.length === 4) {
    for (let i = 0; i < 4; i++) {
      pinInputs[i].value = paramPin[i];
    }
    if (nicknameInput) nicknameInput.focus();
  }

  // Handle Join Submission
  joinForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const pin = pinInputs.map(i => i.value).join('');
    const nickname = nicknameInput.value.trim();

    if (pin.length !== 4) {
      showToast('Please enter a 4-digit PIN', 'error');
      pinInputs[0].focus();
      return;
    }

    if (!nickname) {
      showToast('Please enter your challenger nickname', 'error');
      nicknameInput.focus();
      return;
    }

    currentPin = pin;
    myNickname = nickname;
    window.soundFx.playTap();

    socket.emit('quiz:join', { pin, nickname });
  });

  // =========================================================================
  // GAME PAD BUTTON INTERACTIONS
  // =========================================================================
  padButtons.forEach(btn => {
    btn.addEventListener('click', () => {
      if (hasSubmitted) return;
      
      const optionId = btn.dataset.option;
      selectedOption = optionId;
      hasSubmitted = true;

      window.soundFx.playTap();

      // Submit answer to server
      socket.emit('answer:submit', {
        pin: currentPin,
        questionIndex: currentQuestionIndex,
        answerId: optionId
      });

      // Show locked overlay
      const optText = btn.querySelector('.pad-text') ? btn.querySelector('.pad-text').textContent : optionId;
      lockedChoiceMarker.textContent = `Option ${optionId} (${optText})`;
      padLockedOverlay.classList.add('active');
    });
  });

  // =========================================================================
  // SOCKET EVENT LISTENERS
  // =========================================================================

  // Joined Room Confirmation
  socket.on('quiz:joined', (data) => {
    currentPin = data.pin;
    myNickname = data.nickname;

    // Show persistent header
    playerHeader.style.display = 'flex';
    hdrNickname.textContent = myNickname;
    hdrScore.textContent = '0';
    hdrRank.textContent = '#1';

    // Update waiting screen
    waitingAvatar.textContent = myNickname.charAt(0).toUpperCase();
    waitingNickname.textContent = myNickname;
    waitingPinBadge.textContent = `ROOM #${currentPin}`;

    showScreen(screenWaiting);
  });

  // Question Start
  socket.on('question:start', (data) => {
    currentQuestionIndex = data.questionIndex;
    hasSubmitted = false;
    selectedOption = null;

    showScreen(screenGamepad);
    padLockedOverlay.classList.remove('active');

    padQIndex.textContent = `QUESTION ${data.questionIndex + 1}`;
    padTimerSec.textContent = `${Math.round(data.timeLimitMs / 1000)}s`;

    // Populate option texts
    padButtons.forEach(btn => {
      btn.disabled = false;
      const optData = data.options.find(o => o.id === btn.dataset.option);
      const textEl = btn.querySelector('.pad-text');
      if (optData && textEl) {
        textEl.textContent = optData.text;
      }
    });
  });

  // Authoritative Tick
  socket.on('question:tick', (data) => {
    const sec = Math.ceil(data.remainingMs / 1000);
    padTimerSec.textContent = `${sec}s`;
  });

  // Personalized Round Result
  socket.on('round:result', (data) => {
    const { isCorrect, deltaScore, totalScore, streak, explanation } = data;
    showScreen(screenResult);

    // Update header score smoothly
    const prevScore = myScore;
    myScore = totalScore;
    animateNumber(hdrScore, prevScore, myScore, 900);

    // Style result card
    resultCard.className = isCorrect ? 'result-card state-correct' : 'result-card state-incorrect';
    resultIcon.textContent = isCorrect ? '✓' : '✕';
    resultTitle.textContent = isCorrect ? 'Excellence!' : 'Incorrect';
    resultDelta.textContent = isCorrect ? `+${deltaScore.toLocaleString()} PTS` : '+0 PTS';

    if (isCorrect) {
      window.soundFx.playCorrect();
    } else {
      window.soundFx.playIncorrect();
    }

    // Streak badge
    if (streak > 1) {
      resultStreakBox.style.display = 'inline-flex';
      resultStreakText.textContent = `🔥 ${streak} Answer Streak`;
    } else {
      resultStreakBox.style.display = 'none';
    }

    // Explanation
    resultExplanation.textContent = explanation || '';
  });

  // Global Time's Up (Fallback if no answers were submitted)
  socket.on('question:time_up', (data) => {
    if (!hasSubmitted) {
      showScreen(screenResult);
      resultCard.className = 'result-card state-incorrect';
      resultIcon.textContent = '⏱️';
      resultTitle.textContent = "Time's Up";
      resultDelta.textContent = '+0 PTS';
      resultStreakBox.style.display = 'none';
      resultExplanation.textContent = data.explanation || '';
      window.soundFx.playIncorrect();
    }
  });

  // Leaderboard Update -> update personal rank
  socket.on('leaderboard:update', (data) => {
    const myEntry = data.leaderboard.find(p => p.id === socket.id);
    if (myEntry) {
      hdrRank.textContent = `#${myEntry.rank}`;
    }
  });

  // Quiz Ended
  socket.on('quiz:ended', (data) => {
    if (data.reason === 'HOST_DISCONNECTED') {
      showToast('Host has left the arena. Match ended.', 'error');
      setTimeout(() => window.location.reload(), 3000);
      return;
    }

    showScreen(screenFinal);
    const { winner, finalLeaderboard } = data;
    const myEntry = (finalLeaderboard || []).find(p => p.id === socket.id);

    const finalRankBadge = document.getElementById('final-rank-badge');
    const finalRankTitle = document.getElementById('final-rank-title');
    const finalScoreVal = document.getElementById('final-score-val');
    const finalStatCorrect = document.getElementById('final-stat-correct');
    const finalStatStreak = document.getElementById('final-stat-streak');
    const finalTrophy = document.getElementById('final-trophy');

    if (myEntry) {
      finalRankBadge.textContent = `RANK #${myEntry.rank}`;
      animateNumber(finalScoreVal, 0, myEntry.score, 1000);
      finalStatCorrect.textContent = myEntry.correctCount || 0;
      finalStatStreak.textContent = myEntry.highestStreak || 0;

      if (myEntry.rank === 1) {
        finalRankTitle.textContent = 'Arena Champion';
        finalTrophy.textContent = '👑';
        window.soundFx.playFanfare();
      } else if (myEntry.rank <= 3) {
        finalRankTitle.textContent = 'Podium Finisher';
        finalTrophy.textContent = '🥉';
      } else {
        finalRankTitle.textContent = 'Match Finished';
        finalTrophy.textContent = '🎖️';
      }
    }
  });
});
