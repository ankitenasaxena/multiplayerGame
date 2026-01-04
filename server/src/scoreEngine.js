// =============================================================================
// SCORING SYSTEM ENGINE MODULE
// Real-time Multiplayer Drawing Game Backend
// =============================================================================
// Purpose: Server-authoritative scoring system
// Faster guesses = higher score, drawer gets partial points
// =============================================================================

const gameEngine = require('./gameEngine');
const guessEngine = require('./guessEngine');

// =============================================================================
// CONFIGURATION CONSTANTS
// =============================================================================

// Scoring formula constants
const BASE_SCORE = 100; // Base score for correct guess
const DRAWER_SCORE_MULTIPLIER = 0.5; // Drawer gets 50% of base score
const TIME_BONUS_MULTIPLIER = 1.0; // Bonus multiplier for fast guesses

// Maximum time bonus (guessing immediately)
const MAX_TIME_BONUS = 100;

// Minimum score (guessing at the last second)
const MIN_SCORE = 10;

// =============================================================================
// ROUND SCORING STORAGE
// =============================================================================

// Map structure: roomId -> round scores
// Tracks when each player guessed correctly for scoring calculation
// Format: { roomId: { round: number, guessTimes: Map<playerId, timestamp> } }
const roundGuessTimes = new Map();

// =============================================================================
// HELPER FUNCTIONS
// =============================================================================

/**
 * Calculate score for a correct guess
 * Faster guesses = higher score
 * Uses millisecond precision for better timing differentiation
 * @param {number} roundTime - Total round time in seconds
 * @param {number} guessTime - Time when player guessed (seconds elapsed, can be fractional)
 * @param {boolean} isDrawer - Whether player is the drawer
 * @returns {number} Calculated score
 */
function calculateScore(roundTime, guessTime, isDrawer) {
  // Ensure valid inputs
  if (roundTime <= 0 || guessTime < 0 || guessTime > roundTime) {
    return MIN_SCORE;
  }
  
  // Use high precision calculation (keep fractional seconds)
  // Calculate time ratio (0 = guessed immediately, 1 = guessed at end)
  const timeRatio = guessTime / roundTime;
  
  // Calculate time bonus (higher for faster guesses)
  // Use exponential decay for more dramatic difference between fast and slow guesses
  // This ensures even fraction-of-second differences matter
  const timeBonus = MAX_TIME_BONUS * Math.pow(1 - timeRatio, 1.5);
  
  // Base score calculation with high precision
  let score = BASE_SCORE + timeBonus;
  
  // Apply drawer multiplier if drawer
  if (isDrawer) {
    score = score * DRAWER_SCORE_MULTIPLIER;
  }
  
  // Ensure minimum score, but use Math.round for better precision handling
  score = Math.max(MIN_SCORE, Math.round(score * 100) / 100);
  
  return Math.floor(score);
}

/**
 * Record guess time for scoring
 * @param {string} roomId - Room ID
 * @param {number} round - Round number
 * @param {string} playerId - Player ID
 * @param {number} timestamp - Timestamp when guess was made (milliseconds)
 */
function recordGuessTime(roomId, round, playerId, timestamp) {
  if (!roundGuessTimes.has(roomId)) {
    roundGuessTimes.set(roomId, {});
  }
  
  const roomData = roundGuessTimes.get(roomId);
  if (!roomData[round]) {
    roomData[round] = new Map();
  }
  
  roomData[round].set(playerId, timestamp);
}

/**
 * Get guess time for a player in a round
 * @param {string} roomId - Room ID
 * @param {number} round - Round number
 * @param {string} playerId - Player ID
 * @returns {number|null} Timestamp or null if not found
 */
function getGuessTime(roomId, round, playerId) {
  const roomData = roundGuessTimes.get(roomId);
  if (!roomData || !roomData[round]) {
    return null;
  }
  return roomData[round].get(playerId) || null;
}

/**
 * Clear round guess times for a room
 * @param {string} roomId - Room ID
 */
function clearRoundGuessTimes(roomId) {
  roundGuessTimes.delete(roomId);
}

// =============================================================================
// SCORING FUNCTIONS
// =============================================================================

/**
 * Award score to player for correct guess
 * Calculates score based on guess time and updates player's total score
 * @param {Object} room - Room object with active game
 * @param {string} playerId - Player ID who guessed correctly
 * @param {number} guessTimestamp - Timestamp when guess was made (milliseconds)
 * @param {Function} getPlayer - Function to get player object
 * @param {Function} updatePlayerScore - Function to update player score
 * @returns {Object} { success: boolean, score: number, totalScore: number, error: string|null }
 */
function awardGuessScore(room, playerId, guessTimestamp, getPlayer, updatePlayerScore) {
  // Validate game state
  const validation = gameEngine.hasActiveGame(room);
  if (!validation.valid) {
    return { success: false, score: 0, totalScore: 0, error: validation.error };
  }
  
  const game = room.game;
  
  // Check if player has already been scored for this round
  const existingTime = getGuessTime(room.id, game.currentRound, playerId);
  if (existingTime !== null) {
    // Already scored, return existing score
    const player = getPlayer(playerId);
    if (!player) {
      return { success: false, score: 0, totalScore: 0, error: 'Player not found' };
    }
    const roundScore = calculateScore(
      room.settings.drawTime,
      (existingTime - game.roundStartTime) / 1000,
      gameEngine.isCurrentDrawer(room, playerId)
    );
    return { success: true, score: roundScore, totalScore: player.score || 0, error: null };
  }
  
  // Record guess time
  recordGuessTime(room.id, game.currentRound, playerId, guessTimestamp);
  
  // Calculate score with millisecond precision
  const roundStartTime = game.roundStartTime || Date.now();
  // Keep fractional seconds for better precision (millisecond accuracy)
  const guessTimeSeconds = (guessTimestamp - roundStartTime) / 1000.0;
  const isDrawer = gameEngine.isCurrentDrawer(room, playerId);
  const roundScore = calculateScore(room.settings.drawTime, guessTimeSeconds, isDrawer);
  
  // Update player score
  const player = getPlayer(playerId);
  if (!player) {
    return { success: false, score: 0, totalScore: 0, error: 'Player not found' };
  }
  
  // Initialize score if not exists
  if (typeof player.score !== 'number') {
    player.score = 0;
  }
  
  // Add round score to total
  const newTotalScore = player.score + roundScore;
  updatePlayerScore(playerId, newTotalScore);
  
  console.log(`[SCORE] Awarded score: ${room.id} | Round: ${game.currentRound} | Player: ${playerId} | Round Score: ${roundScore} | Total: ${newTotalScore}`);
  
  return { success: true, score: roundScore, totalScore: newTotalScore, error: null };
}

/**
 * Update drawer score incrementally when someone guesses correctly
 * This allows drawer score to update instantly as players guess
 * @param {Object} room - Room object with active game
 * @param {Function} getPlayer - Function to get player object
 * @param {Function} updatePlayerScore - Function to update player score
 * @returns {Object} { success: boolean, drawerScore: number, error: string|null }
 */
function updateDrawerScoreForGuess(room, getPlayer, updatePlayerScore) {
  // Validate game state
  const validation = gameEngine.hasActiveGame(room);
  if (!validation.valid) {
    return { success: false, drawerScore: 0, error: validation.error };
  }
  
  const game = room.game;
  const drawerId = game.drawerId;
  
  // Calculate drawer score based on current number of correct guessers
  const guessedCount = guessEngine.getGuessedPlayersCount(room);
  
  // Drawer gets points for each correct guesser
  const scorePerGuesser = Math.floor(BASE_SCORE * DRAWER_SCORE_MULTIPLIER);
  
  // Get current drawer score
  const drawer = getPlayer(drawerId);
  if (!drawer) {
    return { success: false, drawerScore: 0, error: 'Drawer not found' };
  }
  
  // Calculate what the drawer's score should be for this round
  const expectedRoundScore = guessedCount * scorePerGuesser;
  
  // Get the drawer's current total score
  const currentTotalScore = drawer.score || 0;
  
  // We need to track the drawer's round score separately to avoid double counting
  // For now, we'll calculate the incremental score (just the new guesser's points)
  // This is a simplified approach - in a more complex system, we'd track round scores separately
  
  // Since we're calling this incrementally, we just add one guesser's worth of points
  // But we need to make sure we don't double count
  // For simplicity, we'll recalculate the drawer's total based on current guess count
  // and subtract what was already awarded
  
  // Get the drawer's score at the start of this round (we'll track this)
  if (!game.drawerRoundStartScore) {
    game.drawerRoundStartScore = currentTotalScore;
  }
  
  // Calculate new total: start score + (guessedCount * scorePerGuesser)
  const newTotalScore = game.drawerRoundStartScore + expectedRoundScore;
  
  // Only update if it's different (to avoid unnecessary updates)
  if (newTotalScore !== currentTotalScore) {
    updatePlayerScore(drawerId, newTotalScore);
    console.log(`[SCORE] Updated drawer score incrementally: ${room.id} | Round: ${game.currentRound} | Drawer: ${drawerId} | New Total: ${newTotalScore}`);
  }
  
  return { success: true, drawerScore: expectedRoundScore, error: null };
}

/**
 * Award drawer score at end of round
 * Drawer gets points based on how many players guessed correctly
 * Drawer cannot guess, so this is separate from guesser scoring
 * @param {Object} room - Room object with active game
 * @param {Function} getPlayer - Function to get player object
 * @param {Function} updatePlayerScore - Function to update player score
 * @returns {Object} { success: boolean, drawerScore: number, error: string|null }
 */
function awardDrawerScore(room, getPlayer, updatePlayerScore) {
  // Validate game state
  const validation = gameEngine.hasActiveGame(room);
  if (!validation.valid) {
    return { success: false, drawerScore: 0, error: validation.error };
  }
  
  const game = room.game;
  const drawerId = game.drawerId;
  
  // Check if drawer has already been scored for this round
  const existingTime = getGuessTime(room.id, game.currentRound, drawerId);
  if (existingTime !== null) {
    // Already scored, return existing score
    const drawer = getPlayer(drawerId);
    if (!drawer) {
      return { success: false, drawerScore: 0, error: 'Drawer not found' };
    }
    // Calculate what the drawer score was
    const guessedCount = guessEngine.getGuessedPlayersCount(room);
    const scorePerGuesser = Math.floor(BASE_SCORE * DRAWER_SCORE_MULTIPLIER);
    const drawerScore = guessedCount * scorePerGuesser;
    return { success: true, drawerScore: drawerScore, error: null };
  }
  
  // Calculate drawer score based on number of correct guessers
  const guessedCount = guessEngine.getGuessedPlayersCount(room);
  
  // Drawer gets points for each correct guesser
  // Base score per guesser, with multiplier
  const scorePerGuesser = Math.floor(BASE_SCORE * DRAWER_SCORE_MULTIPLIER);
  const drawerScore = guessedCount * scorePerGuesser;
  
  // Record that drawer has been scored (using special marker)
  recordGuessTime(room.id, game.currentRound, drawerId, Date.now());
  
  // Update drawer score
  const drawer = getPlayer(drawerId);
  if (drawer) {
    if (typeof drawer.score !== 'number') {
      drawer.score = 0;
    }
    const newTotalScore = drawer.score + drawerScore;
    updatePlayerScore(drawerId, newTotalScore);
    
    console.log(`[SCORE] Awarded drawer score: ${room.id} | Round: ${game.currentRound} | Drawer: ${drawerId} | Score: ${drawerScore} | Total: ${newTotalScore}`);
  }
  
  return { success: true, drawerScore: drawerScore, error: null };
}

/**
 * Get leaderboard for a room
 * Returns players sorted by score (descending)
 * @param {Object} room - Room object
 * @param {Function} getPlayer - Function to get player object
 * @returns {Array} Array of { playerId, name, score } sorted by score
 */
function getLeaderboard(room, getPlayer) {
  const leaderboard = room.players
    .map(playerId => {
      const player = getPlayer(playerId);
      if (!player) return null;
      
      return {
        playerId: player.id,
        name: player.name,
        score: player.score || 0
      };
    })
    .filter(entry => entry !== null)
    .sort((a, b) => b.score - a.score); // Sort descending by score
  
  return leaderboard;
}

/**
 * Initialize round start time for scoring
 * @param {Object} room - Room object with active game
 * @param {number} startTime - Round start timestamp (milliseconds)
 */
function initializeRoundStartTime(room, startTime) {
  if (room.game) {
    room.game.roundStartTime = startTime;
    // Reset drawer round start score for incremental updates
    room.game.drawerRoundStartScore = null;
  }
}

/**
 * Clear round scoring data
 * @param {string} roomId - Room ID
 */
function clearRoundScoring(roomId) {
  const roomData = roundGuessTimes.get(roomId);
  if (roomData) {
    // Clear all rounds for this room
    roundGuessTimes.delete(roomId);
  }
}

// =============================================================================
// MODULE EXPORTS
// =============================================================================

module.exports = {
  // Scoring
  awardGuessScore,
  awardDrawerScore,
  updateDrawerScoreForGuess,
  
  // Leaderboard
  getLeaderboard,
  
  // Round management
  initializeRoundStartTime,
  clearRoundScoring,
  
  // Utilities
  calculateScore,
  recordGuessTime,
  getGuessTime
};

