// =============================================================================
// GAME START & ROUND ENGINE MODULE
// Real-time Multiplayer Drawing Game Backend
// =============================================================================
// Purpose: Manage game lifecycle, round progression, and drawer rotation
// This module handles game state transitions (NOT drawing or guessing logic)
// =============================================================================

// =============================================================================
// GAME PHASE CONSTANTS
// =============================================================================

const PHASES = {
  IDLE: 'idle',
  WORD_SELECT: 'word_select',
  DRAWING: 'drawing',
  ROUND_END: 'round_end',
  GAME_END: 'game_end'
};

const ROOM_STATUS = {
  WAITING: 'waiting',
  IN_GAME: 'in_game',
  FINISHED: 'finished'
};

// =============================================================================
// VALIDATION FUNCTIONS
// =============================================================================

/**
 * Validate if game can be started
 * @param {Object} room - Room object
 * @param {string} playerId - Player attempting to start
 * @returns {Object} { valid: boolean, error: string|null }
 */
function canStartGame(room, playerId) {
  // Check if player is room owner
  if (room.ownerId !== playerId) {
    return { valid: false, error: 'Only room owner can start the game' };
  }

  // Check if room is in waiting state
  if (room.status !== ROOM_STATUS.WAITING) {
    return { valid: false, error: 'Game already in progress or finished' };
  }

  // Check minimum player count
  if (room.players.length < 2) {
    return { valid: false, error: 'Need at least 2 players to start' };
  }

  return { valid: true, error: null };
}

/**
 * Validate if game exists and is active
 * @param {Object} room - Room object
 * @returns {Object} { valid: boolean, error: string|null }
 */
function hasActiveGame(room) {
  if (!room.game) {
    return { valid: false, error: 'No active game in this room' };
  }

  if (room.status !== ROOM_STATUS.IN_GAME) {
    return { valid: false, error: 'Game is not active' };
  }

  return { valid: true, error: null };
}

// =============================================================================
// GAME INITIALIZATION
// =============================================================================

/**
 * Initialize game state for a room
 * Creates new game object and sets initial state
 * @param {Object} room - Room object
 * @returns {Object} Initialized game state
 */
function initializeGameState(room) {
  const game = {
    phase: PHASES.WORD_SELECT,
    currentRound: 1,
    totalRounds: room.settings.rounds,
    drawerIndex: 0,
    drawerId: room.players[0], // First player is first drawer
    guessedPlayers: [] // Will be used in guessing module
  };

  return game;
}

/**
 * Start the game
 * Initializes game state, locks settings, updates room status
 * @param {Object} room - Room object
 * @param {string} playerId - Player starting the game
 * @returns {Object} { success: boolean, game: Object|null, error: string|null }
 */
function startGame(room, playerId) {
  // Validate if game can start
  const validation = canStartGame(room, playerId);
  if (!validation.valid) {
    return { success: false, game: null, error: validation.error };
  }

  // Initialize game state
  const game = initializeGameState(room);

  // Attach game to room
  room.game = game;

  // Update room status to lock settings and indicate game is active
  room.status = ROOM_STATUS.IN_GAME;

  console.log(`[GAME] Started in room: ${room.id} | Round: ${game.currentRound}/${game.totalRounds} | Drawer: ${game.drawerId}`);

  return { success: true, game: game, error: null };
}

// =============================================================================
// DRAWER ROTATION
// =============================================================================

/**
 * Get the next drawer in rotation
 * Handles round increment when all players have drawn
 * @param {Object} room - Room object with active game
 * @returns {Object} { drawerId: string, drawerIndex: number, roundIncremented: boolean }
 */
function getNextDrawer(room) {
  const game = room.game;
  const playerCount = room.players.length;

  // Safety check: ensure drawerIndex is valid
  if (game.drawerIndex >= playerCount || game.drawerIndex < 0) {
    // Reset to first player if index is invalid
    game.drawerIndex = 0;
  }

  // Move to next player
  let nextIndex = game.drawerIndex + 1;
  let roundIncremented = false;

  // Check if we've cycled through all players
  if (nextIndex >= playerCount) {
    // Reset to first player
    nextIndex = 0;
    // Increment round only if we haven't exceeded total rounds
    if (game.currentRound < game.totalRounds) {
      game.currentRound++;
      roundIncremented = true;
    } else {
      // Already at max rounds, don't increment further
      // This prevents going beyond the set number of rounds
      console.log(`[GAME] Max rounds reached: ${room.id} | Round: ${game.currentRound}/${game.totalRounds}`);
    }
  }

  // Safety check: ensure nextIndex is valid
  if (nextIndex >= playerCount) {
    nextIndex = 0;
  }

  // Update game state
  game.drawerIndex = nextIndex;
  game.drawerId = room.players[nextIndex];

  return {
    drawerId: game.drawerId,
    drawerIndex: nextIndex,
    roundIncremented: roundIncremented
  };
}

// =============================================================================
// ROUND PROGRESSION
// =============================================================================

/**
 * Start a new round
 * Resets round-specific state and sets phase to word selection
 * @param {Object} room - Room object with active game
 * @returns {Object} { success: boolean, game: Object|null, error: string|null }
 */
function startRound(room) {
  const validation = hasActiveGame(room);
  if (!validation.valid) {
    return { success: false, game: null, error: validation.error };
  }

  const game = room.game;

  // Reset guessed players for new round
  game.guessedPlayers = [];

  // Set phase to word selection
  game.phase = PHASES.WORD_SELECT;

  console.log(`[GAME] Round started: ${room.id} | Round: ${game.currentRound}/${game.totalRounds} | Drawer: ${game.drawerId}`);

  return { success: true, game: game, error: null };
}

/**
 * End the current round
 * Progresses to next drawer or ends game if complete
 * @param {Object} room - Room object with active game
 * @returns {Object} { success: boolean, nextPhase: string, gameEnded: boolean, error: string|null }
 */
function endRound(room) {
  const validation = hasActiveGame(room);
  if (!validation.valid) {
    return { success: false, nextPhase: null, gameEnded: false, error: validation.error };
  }

  const game = room.game;

  // Set phase to round end for cleanup
  game.phase = PHASES.ROUND_END;

  console.log(`[GAME] Round ended: ${room.id} | Round: ${game.currentRound}/${game.totalRounds} | Drawer: ${game.drawerId}`);

  // Check if this was the last drawer of the last round
  // Use >= to handle cases where players left and drawerIndex might be at the end
  const isLastDrawer = game.drawerIndex >= room.players.length - 1;
  const isLastRound = game.currentRound >= game.totalRounds;

  if (isLastDrawer && isLastRound) {
    // Game is complete
    return { success: true, nextPhase: PHASES.GAME_END, gameEnded: true, error: null };
  } else {
    // More rounds to play
    return { success: true, nextPhase: PHASES.WORD_SELECT, gameEnded: false, error: null };
  }
}

/**
 * Progress to next drawer
 * Moves drawer rotation forward and starts new round if needed
 * @param {Object} room - Room object with active game
 * @returns {Object} { success: boolean, drawerInfo: Object, roundChanged: boolean, error: string|null }
 */
function progressToNextDrawer(room) {
  const validation = hasActiveGame(room);
  if (!validation.valid) {
    return { success: false, drawerInfo: null, roundChanged: false, error: validation.error };
  }

  // Get next drawer
  const drawerInfo = getNextDrawer(room);

  // Log drawer change
  if (drawerInfo.roundIncremented) {
    console.log(`[GAME] New round: ${room.id} | Round: ${room.game.currentRound}/${room.game.totalRounds}`);
  }
  console.log(`[GAME] Next drawer: ${room.id} | Drawer: ${drawerInfo.drawerId}`);

  // Start the new round
  startRound(room);

  return {
    success: true,
    drawerInfo: drawerInfo,
    roundChanged: drawerInfo.roundIncremented,
    error: null
  };
}

// =============================================================================
// GAME END
// =============================================================================

/**
 * End the game
 * Sets final game state and room status
 * @param {Object} room - Room object with active game
 * @returns {Object} { success: boolean, roundsPlayed: number, error: string|null }
 */
function endGame(room) {
  const validation = hasActiveGame(room);
  if (!validation.valid) {
    return { success: false, roundsPlayed: 0, error: validation.error };
  }

  const game = room.game;
  const roundsPlayed = game.currentRound;

  // Set game phase to game end
  game.phase = PHASES.GAME_END;

  // Update room status to finished
  room.status = ROOM_STATUS.FINISHED;

  console.log(`[GAME] Ended: ${room.id} | Rounds played: ${roundsPlayed}/${game.totalRounds}`);

  return { success: true, roundsPlayed: roundsPlayed, error: null };
}

/**
 * Reset game state for replay
 * Removes game object and resets room to waiting state
 * @param {Object} room - Room object
 * @returns {Object} { success: boolean, error: string|null }
 */
function resetGame(room) {
  // Remove game state
  room.game = null;

  // Reset room status to waiting
  room.status = ROOM_STATUS.WAITING;

  console.log(`[GAME] Reset: ${room.id} | Ready for new game`);

  return { success: true, error: null };
}

// =============================================================================
// STATE TRANSITION HELPERS
// =============================================================================

/**
 * Transition game phase
 * Validates and updates game phase
 * @param {Object} room - Room object with active game
 * @param {string} newPhase - Target phase
 * @returns {Object} { success: boolean, error: string|null }
 */
function transitionPhase(room, newPhase) {
  const validation = hasActiveGame(room);
  if (!validation.valid) {
    return { success: false, error: validation.error };
  }

  const game = room.game;
  const oldPhase = game.phase;

  // Validate phase transition (basic validation)
  const validPhases = Object.values(PHASES);
  if (!validPhases.includes(newPhase)) {
    return { success: false, error: `Invalid phase: ${newPhase}` };
  }

  // Update phase
  game.phase = newPhase;

  console.log(`[GAME] Phase transition: ${room.id} | ${oldPhase} → ${newPhase}`);

  return { success: true, error: null };
}

/**
 * Check if game should end
 * Determines if all rounds are complete
 * @param {Object} room - Room object with active game
 * @returns {boolean} True if game should end
 */
function shouldEndGame(room) {
  if (!room.game) return false;

  const game = room.game;
  // Use >= to handle cases where players left and drawerIndex might be at the end
  const isLastDrawer = game.drawerIndex >= room.players.length - 1;
  const isLastRound = game.currentRound >= game.totalRounds;

  return isLastDrawer && isLastRound;
}

// =============================================================================
// UTILITY FUNCTIONS
// =============================================================================

/**
 * Get current drawer player ID
 * @param {Object} room - Room object with active game
 * @returns {string|null} Drawer ID or null if no active game
 */
function getCurrentDrawer(room) {
  return room.game ? room.game.drawerId : null;
}

/**
 * Check if player is current drawer
 * @param {Object} room - Room object with active game
 * @param {string} playerId - Player ID to check
 * @returns {boolean} True if player is current drawer
 */
function isCurrentDrawer(room, playerId) {
  return room.game && room.game.drawerId === playerId;
}

/**
 * Get game progress information
 * @param {Object} room - Room object with active game
 * @returns {Object|null} Progress info or null if no active game
 */
function getGameProgress(room) {
  if (!room.game) return null;

  const game = room.game;

  return {
    phase: game.phase,
    currentRound: game.currentRound,
    totalRounds: game.totalRounds,
    drawerId: game.drawerId,
    playerCount: room.players.length,
    drawerIndex: game.drawerIndex
  };
}

// =============================================================================
// MODULE EXPORTS
// =============================================================================

module.exports = {
  // Constants
  PHASES,
  ROOM_STATUS,

  // Game lifecycle
  startGame,
  endGame,
  resetGame,

  // Round management
  startRound,
  endRound,
  progressToNextDrawer,

  // State transitions
  transitionPhase,

  // Validation
  canStartGame,
  hasActiveGame,
  shouldEndGame,

  // Utilities
  getCurrentDrawer,
  isCurrentDrawer,
  getGameProgress
};