/**
 * Game Engine — Server-Authoritative Trivia Game State Machine & Timer Manager
 * Production-grade correctness, anti-cheat validation, and deterministic scoring.
 */

const questionsData = require('../data/questions.json');

/**
 * Pure scoring calculation function.
 * @param {boolean} isCorrect - Whether the player's answer matched the correct option.
 * @param {number} timeTakenMs - Time taken in milliseconds from question start to answer submission.
 * @param {number} totalTimeMs - Total time limit allowed for the question in ms.
 * @param {number} streak - Current consecutive correct answer streak (0-based or 1-based).
 * @returns {number} Integer score between 0 and 1250 (including streak bonus).
 */
function calculateScore(isCorrect, timeTakenMs, totalTimeMs = 15000, streak = 0) {
  if (!isCorrect) return 0;
  if (typeof timeTakenMs !== 'number' || isNaN(timeTakenMs)) return 0;
  if (timeTakenMs < 0 || timeTakenMs > totalTimeMs) return 0;

  // Base correct answer awards 500 points minimum.
  // Speed component awards up to 500 additional points proportionally.
  const timeRatio = Math.max(0, Math.min(1, (totalTimeMs - timeTakenMs) / totalTimeMs));
  const speedBonus = Math.round(500 * timeRatio);
  const baseScore = 500 + speedBonus;

  // Streak bonus: +50 points per streak level beyond 1 (capped at +200)
  const streakBonus = streak > 1 ? Math.min((streak - 1) * 50, 200) : 0;

  return baseScore + streakBonus;
}

class GameEngine {
  constructor(room, io) {
    this.room = room;
    this.io = io;
    this.questions = questionsData;
    this.currentQuestionIndex = -1;
    this.state = 'LOBBY'; // LOBBY | QUESTION_ACTIVE | REVEAL | LEADERBOARD | ENDED
    this.timerInterval = null;
    this.revealTimeout = null;
    this.nextRoundTimeout = null;
    this.questionStartedAt = 0;
    this.questionDeadline = 0;
    this.currentAnswers = new Map(); // playerId -> { answerId, timeTakenMs, isCorrect, receivedAt }
  }

  /**
   * Start the quiz match from the beginning.
   */
  startQuiz() {
    if (this.state !== 'LOBBY') {
      return { success: false, message: 'Game already started or finished' };
    }
    if (this.room.getActivePlayerCount() === 0) {
      return { success: false, message: 'At least one player is required to start' };
    }

    this.state = 'STARTING';
    this.currentQuestionIndex = -1;

    // Reset all player scores
    for (const player of this.room.players.values()) {
      player.score = 0;
      player.streak = 0;
      player.highestStreak = 0;
      player.correctAnswersCount = 0;
      player.lastDeltaScore = 0;
      player.lastIsCorrect = false;
      player.previousRank = 1;
      player.currentRank = 1;
    }

    this.io.to(this.room.pin).emit('quiz:started', {
      pin: this.room.pin,
      totalQuestions: this.questions.length
    });

    // Short 2-second countdown before first question
    setTimeout(() => {
      this.nextQuestion();
    }, 2000);

    return { success: true };
  }

  /**
   * Transition to the next question in the deck.
   */
  nextQuestion() {
    this.clearAllTimers();
    this.currentQuestionIndex++;

    if (this.currentQuestionIndex >= this.questions.length) {
      this.endQuiz();
      return;
    }

    const q = this.questions[this.currentQuestionIndex];
    this.state = 'QUESTION_ACTIVE';
    this.currentAnswers.clear();

    const timeLimitMs = q.timeLimitMs || 15000;
    this.questionStartedAt = Date.now();
    this.questionDeadline = this.questionStartedAt + timeLimitMs;

    // Sanitized payload (NO correct answer sent to clients)
    const questionPayload = {
      pin: this.room.pin,
      questionIndex: this.currentQuestionIndex,
      totalQuestions: this.questions.length,
      questionId: q.id,
      category: q.category,
      question: q.question,
      options: q.options,
      timeLimitMs: timeLimitMs,
      startedAt: this.questionStartedAt
    };

    console.log(`[ROOM ${this.room.pin}] Starting Question ${this.currentQuestionIndex + 1}/${this.questions.length}: "${q.question.slice(0, 40)}..."`);
    this.io.to(this.room.pin).emit('question:start', questionPayload);

    // Initial tick broadcast
    this.broadcastTick(timeLimitMs, timeLimitMs);

    // Server-Authoritative 250ms tick interval
    this.timerInterval = setInterval(() => {
      const now = Date.now();
      const remainingMs = Math.max(0, this.questionDeadline - now);
      this.broadcastTick(remainingMs, timeLimitMs);

      if (remainingMs <= 0) {
        this.clearAllTimers();
        this.handleTimeUp();
      }
    }, 250);
  }

  /**
   * Broadcast current server tick.
   */
  broadcastTick(remainingMs, totalMs) {
    const percent = Math.max(0, Math.min(100, (remainingMs / totalMs) * 100));
    this.io.to(this.room.pin).emit('question:tick', {
      remainingMs,
      totalMs,
      percent: Math.round(percent * 10) / 10
    });
  }

  /**
   * Process incoming answer submission with server-side validation.
   */
  submitAnswer(playerId, payload) {
    const { questionIndex, answerId } = payload;
    const player = this.room.players.get(playerId);

    if (!player) {
      return { success: false, reason: 'PLAYER_NOT_FOUND' };
    }

    if (this.state !== 'QUESTION_ACTIVE') {
      console.warn(`[LATE ANSWER REJECTED] Player "${player.nickname}" submitted outside active question state (current state: ${this.state}) in room ${this.room.pin}`);
      return { success: false, reason: 'QUESTION_NOT_ACTIVE' };
    }

    if (questionIndex !== this.currentQuestionIndex) {
      console.warn(`[INVALID QUESTION INDEX] Player "${player.nickname}" submitted for Q#${questionIndex}, but active Q is #${this.currentQuestionIndex}`);
      return { success: false, reason: 'QUESTION_INDEX_MISMATCH' };
    }

    if (this.currentAnswers.has(playerId)) {
      // Anti-cheat: prevent multi-submits in the same question
      return { success: false, reason: 'ALREADY_SUBMITTED' };
    }

    const now = Date.now();
    if (now > this.questionDeadline + 150) { // 150ms network grace period
      console.warn(`[LATE ANSWER REJECTED] Player "${player.nickname}" answer arrived ${now - this.questionDeadline}ms after server deadline in room ${this.room.pin}`);
      return { success: false, reason: 'TIME_EXPIRED' };
    }

    const currentQuestion = this.questions[this.currentQuestionIndex];
    const timeTakenMs = Math.max(0, now - this.questionStartedAt);
    const isCorrect = answerId === currentQuestion.correctOptionId;

    this.currentAnswers.set(playerId, {
      playerId,
      answerId,
      timeTakenMs,
      isCorrect,
      receivedAt: now
    });

    console.log(`[ANSWER] Player "${player.nickname}" -> Option "${answerId}" (${isCorrect ? 'CORRECT' : 'WRONG'}) in ${timeTakenMs}ms`);

    // Notify Host ONLY for live progress counter without spoiling to other players
    const activePlayersCount = this.room.getActivePlayerCount();
    const answeredCount = this.currentAnswers.size;

    if (this.room.hostSocketId) {
      this.io.to(this.room.hostSocketId).emit('player:answered', {
        answeredCount,
        totalPlayers: activePlayersCount,
        playerId,
        nickname: player.nickname
      });
    }

    // Acknowledge submission to the submitting player
    this.io.to(playerId).emit('answer:acknowledged', {
      answerId,
      timeTakenMs,
      isReceived: true
    });

    // If all active players have answered, conclude round early
    if (answeredCount >= activePlayersCount && activePlayersCount > 0) {
      this.clearAllTimers();
      // Brief 400ms pause so UI doesn't jarringly snap instantly
      setTimeout(() => {
        if (this.state === 'QUESTION_ACTIVE') {
          this.handleTimeUp();
        }
      }, 400);
    }

    return { success: true };
  }

  /**
   * Conclude the active question timer, compute scores, and reveal results.
   */
  handleTimeUp() {
    this.state = 'REVEAL';
    this.clearAllTimers();

    const currentQuestion = this.questions[this.currentQuestionIndex];
    const totalTimeMs = currentQuestion.timeLimitMs || 15000;

    // Calculate answer distribution stats
    const optionStats = { A: 0, B: 0, C: 0, D: 0 };
    for (const answer of this.currentAnswers.values()) {
      if (optionStats[answer.answerId] !== undefined) {
        optionStats[answer.answerId]++;
      }
    }

    // Process player scores
    for (const [playerId, player] of this.room.players.entries()) {
      const submission = this.currentAnswers.get(playerId);

      if (submission && submission.isCorrect) {
        player.streak = (player.streak || 0) + 1;
        player.highestStreak = Math.max(player.highestStreak || 0, player.streak);
        player.correctAnswersCount = (player.correctAnswersCount || 0) + 1;

        const deltaScore = calculateScore(true, submission.timeTakenMs, totalTimeMs, player.streak);
        player.lastDeltaScore = deltaScore;
        player.lastIsCorrect = true;
        player.score += deltaScore;
      } else {
        player.streak = 0;
        player.lastDeltaScore = 0;
        player.lastIsCorrect = false;
      }

      // Send personalized result directly to player
      this.io.to(playerId).emit('round:result', {
        questionIndex: this.currentQuestionIndex,
        isCorrect: player.lastIsCorrect,
        deltaScore: player.lastDeltaScore,
        totalScore: player.score,
        streak: player.streak,
        selectedOptionId: submission ? submission.answerId : null,
        correctOptionId: currentQuestion.correctOptionId,
        explanation: currentQuestion.explanation
      });
    }

    // Update ranks
    this.updatePlayerRanks();

    // Broadcast global time_up event to room
    this.io.to(this.room.pin).emit('question:time_up', {
      questionIndex: this.currentQuestionIndex,
      correctOptionId: currentQuestion.correctOptionId,
      explanation: currentQuestion.explanation,
      optionStats,
      totalAnswers: this.currentAnswers.size,
      totalPlayers: this.room.getActivePlayerCount()
    });

    // Schedule transition to Leaderboard reveal after 4 seconds of answer reveal
    this.revealTimeout = setTimeout(() => {
      this.showLeaderboard();
    }, 4500);
  }

  /**
   * Sort players and update rank histories for FLIP animation tracking.
   */
  updatePlayerRanks() {
    const playersArray = Array.from(this.room.players.values());
    playersArray.sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      return (b.correctAnswersCount || 0) - (a.correctAnswersCount || 0);
    });

    playersArray.forEach((player, index) => {
      player.previousRank = player.currentRank || (index + 1);
      player.currentRank = index + 1;
    });

    return playersArray;
  }

  /**
   * Broadcast leaderboard state.
   */
  showLeaderboard() {
    this.state = 'LEADERBOARD';
    const rankedPlayers = this.updatePlayerRanks();

    const leaderboardPayload = {
      questionIndex: this.currentQuestionIndex,
      totalQuestions: this.questions.length,
      isLastQuestion: this.currentQuestionIndex >= this.questions.length - 1,
      leaderboard: rankedPlayers.map(p => ({
        id: p.id,
        nickname: p.nickname,
        score: p.score,
        deltaScore: p.lastDeltaScore || 0,
        isCorrect: p.lastIsCorrect,
        rank: p.currentRank,
        previousRank: p.previousRank,
        streak: p.streak,
        isConnected: p.isConnected
      }))
    };

    console.log(`[ROOM ${this.room.pin}] Emitting Leaderboard after Q#${this.currentQuestionIndex + 1}`);
    this.io.to(this.room.pin).emit('leaderboard:update', leaderboardPayload);
  }

  /**
   * Host requests advance to next question or final podium.
   */
  advanceNext() {
    if (this.state !== 'LEADERBOARD') {
      return { success: false, message: 'Can only advance from leaderboard screen' };
    }

    if (this.currentQuestionIndex >= this.questions.length - 1) {
      this.endQuiz();
    } else {
      this.nextQuestion();
    }

    return { success: true };
  }

  /**
   * Conclude the match, determine winner and final podium.
   */
  endQuiz() {
    this.state = 'ENDED';
    this.clearAllTimers();

    const rankedPlayers = this.updatePlayerRanks();
    const winner = rankedPlayers.length > 0 ? rankedPlayers[0] : null;

    const payload = {
      winner: winner ? {
        id: winner.id,
        nickname: winner.nickname,
        score: winner.score,
        correctCount: winner.correctAnswersCount,
        highestStreak: winner.highestStreak
      } : null,
      podium: rankedPlayers.slice(0, 3).map(p => ({
        id: p.id,
        nickname: p.nickname,
        score: p.score,
        rank: p.currentRank
      })),
      finalLeaderboard: rankedPlayers.map(p => ({
        id: p.id,
        nickname: p.nickname,
        score: p.score,
        correctCount: p.correctAnswersCount,
        highestStreak: p.highestStreak,
        rank: p.currentRank,
        isConnected: p.isConnected
      }))
    };

    console.log(`[ROOM ${this.room.pin}] Quiz Ended. Winner: ${winner ? winner.nickname : 'None'} (${winner ? winner.score : 0} pts)`);
    this.io.to(this.room.pin).emit('quiz:ended', payload);
  }

  clearAllTimers() {
    if (this.timerInterval) {
      clearInterval(this.timerInterval);
      this.timerInterval = null;
    }
    if (this.revealTimeout) {
      clearTimeout(this.revealTimeout);
      this.revealTimeout = null;
    }
    if (this.nextRoundTimeout) {
      clearTimeout(this.nextRoundTimeout);
      this.nextRoundTimeout = null;
    }
  }

  destroy() {
    this.clearAllTimers();
    this.state = 'ENDED';
  }
}

module.exports = {
  calculateScore,
  GameEngine
};
