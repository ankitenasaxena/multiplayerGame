// =============================================================================
// GUESS VALIDATION ENGINE MODULE
// Real-time Multiplayer Drawing Game Backend
// =============================================================================
// Purpose: Validate guesses, track correct guesses, enforce rules
// This module ensures drawer cannot guess and prevents duplicate scoring
// =============================================================================

const gameEngine = require('./gameEngine');
const wordEngine = require('./wordEngine');

// =============================================================================
// CONFIGURATION CONSTANTS
// =============================================================================

// Minimum guess length (to prevent spam)
const MIN_GUESS_LENGTH = 1;

// Maximum guess length
const MAX_GUESS_LENGTH = 50;

// =============================================================================
// HELPER FUNCTIONS
// =============================================================================

/**
 * Normalize guess for comparison
 * Lowercase, trim whitespace
 * @param {string} guess - Raw guess from player
 * @returns {string} Normalized guess
 */
function normalizeGuess(guess) {
  if (!guess || typeof guess !== 'string') {
    return '';
  }
  return guess.trim().toLowerCase();
}

/**
 * Validate guess format
 * @param {string} guess - Raw guess from player
 * @returns {Object} { valid: boolean, normalized: string, error: string|null }
 */
function validateGuessFormat(guess) {
  if (!guess || typeof guess !== 'string') {
    return { valid: false, normalized: '', error: 'Guess must be a string' };
  }
  
  const normalized = normalizeGuess(guess);
  
  if (normalized.length < MIN_GUESS_LENGTH) {
    return { valid: false, normalized: '', error: 'Guess cannot be empty' };
  }
  
  if (normalized.length > MAX_GUESS_LENGTH) {
    return { valid: false, normalized: '', error: `Guess cannot exceed ${MAX_GUESS_LENGTH} characters` };
  }
  
  return { valid: true, normalized: normalized, error: null };
}

// =============================================================================
// GUESS VALIDATION FUNCTIONS
// =============================================================================

/**
 * Validate guess submission
 * Checks if player can guess, if guess is valid, and if it matches the word
 * @param {Object} room - Room object with active game
 * @param {string} playerId - Player ID submitting guess
 * @param {string} guess - Raw guess from player
 * @returns {Object} { success: boolean, isCorrect: boolean, error: string|null }
 */
function validateGuess(room, playerId, guess) {
  // Validate game state
  const validation = gameEngine.hasActiveGame(room);
  if (!validation.valid) {
    return { success: false, isCorrect: false, error: validation.error };
  }
  
  const game = room.game;
  
  // Check if we're in drawing phase (guessing only happens during drawing)
  if (game.phase !== gameEngine.PHASES.DRAWING) {
    return { success: false, isCorrect: false, error: 'Guessing is only allowed during drawing phase' };
  }
  
  // Check if player is the drawer (drawer cannot guess)
  if (gameEngine.isCurrentDrawer(room, playerId)) {
    return { success: false, isCorrect: false, error: 'Drawer cannot guess' };
  }
  
  // Check if player has already guessed correctly
  if (game.guessedPlayers && game.guessedPlayers.includes(playerId)) {
    return { success: false, isCorrect: false, error: 'You have already guessed correctly' };
  }
  
  // Validate guess format
  const formatValidation = validateGuessFormat(guess);
  if (!formatValidation.valid) {
    return { success: false, isCorrect: false, error: formatValidation.error };
  }
  
  // Get selected word (server-only)
  const selectedWord = wordEngine.getSelectedWord(room);
  if (!selectedWord) {
    return { success: false, isCorrect: false, error: 'No word selected for this round' };
  }
  
  // Compare guess with selected word (case-insensitive)
  const normalizedGuess = formatValidation.normalized;
  const normalizedWord = wordEngine.normalizeWord(selectedWord);
  
  const isCorrect = normalizedGuess === normalizedWord;
  
  if (isCorrect) {
    // Add player to guessed players list (prevents duplicate scoring)
    if (!game.guessedPlayers) {
      game.guessedPlayers = [];
    }
    game.guessedPlayers.push(playerId);
    
    console.log(`[GUESS] Correct guess: ${room.id} | Round: ${game.currentRound} | Player: ${playerId} | Word: ${selectedWord}`);
  }
  
  return { success: true, isCorrect: isCorrect, error: null };
}

/**
 * Check if player has guessed correctly
 * @param {Object} room - Room object with active game
 * @param {string} playerId - Player ID to check
 * @returns {boolean} True if player has guessed correctly
 */
function hasPlayerGuessed(room, playerId) {
  if (!room.game || !room.game.guessedPlayers) {
    return false;
  }
  return room.game.guessedPlayers.includes(playerId);
}

/**
 * Get list of players who have guessed correctly
 * @param {Object} room - Room object with active game
 * @returns {Array} Array of player IDs who guessed correctly
 */
function getGuessedPlayers(room) {
  if (!room.game || !room.game.guessedPlayers) {
    return [];
  }
  return [...room.game.guessedPlayers]; // Return copy
}

/**
 * Get count of players who have guessed correctly
 * @param {Object} room - Room object with active game
 * @returns {number} Count of correct guessers
 */
function getGuessedPlayersCount(room) {
  if (!room.game || !room.game.guessedPlayers) {
    return 0;
  }
  return room.game.guessedPlayers.length;
}

/**
 * Check if all guessers have guessed correctly
 * @param {Object} room - Room object with active game
 * @returns {boolean} True if all non-drawer players have guessed
 */
function allGuessersGuessed(room) {
  if (!room.game) {
    return false;
  }
  
  const drawerId = room.game.drawerId;
  const guessers = room.players.filter(playerId => playerId !== drawerId);
  const guessedCount = getGuessedPlayersCount(room);
  
  return guessedCount >= guessers.length;
}

/**
 * Clear guessed players list (for new round)
 * @param {Object} room - Room object with active game
 */
function clearGuessedPlayers(room) {
  if (room.game) {
    room.game.guessedPlayers = [];
  }
}

// =============================================================================
// MODULE EXPORTS
// =============================================================================

module.exports = {
  // Guess validation
  validateGuess,
  
  // Guess tracking
  hasPlayerGuessed,
  getGuessedPlayers,
  getGuessedPlayersCount,
  allGuessersGuessed,
  clearGuessedPlayers,
  
  // Utilities
  normalizeGuess,
  validateGuessFormat
};

