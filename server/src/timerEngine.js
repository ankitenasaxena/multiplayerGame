// =============================================================================
// TIMERS & PHASE CONTROL ENGINE MODULE
// Real-time Multiplayer Drawing Game Backend
// =============================================================================
// Purpose: Manage game timers, phase timeouts, and automatic round progression
// This module ensures server-authoritative timing with safe timer cleanup
// =============================================================================

const gameEngine = require('./gameEngine');
const wordEngine = require('./wordEngine');

// =============================================================================
// TIMER STORAGE
// =============================================================================

// Map structure: roomId -> timer object
// Each room can have only one active timer at a time
const activeTimers = new Map();

// =============================================================================
// CONFIGURATION CONSTANTS
// =============================================================================

const TIMER_TICK_INTERVAL = 1000; // 1 second tick interval
const WORD_SELECTION_TIMEOUT = wordEngine.WORD_SELECTION_TIMEOUT;

// =============================================================================
// TIMER OBJECT STRUCTURE
// =============================================================================

/**
 * Timer object structure:
 * {
 *   roomId: string,
 *   type: 'word_selection' | 'drawing',
 *   duration: number,      // Total duration in seconds
 *   remaining: number,     // Remaining time in seconds
 *   intervalId: NodeJS.Timeout,  // setInterval ID
 *   timeoutId: NodeJS.Timeout,   // setTimeout ID for final timeout
 *   onTick: Function,       // Called every second
 *   onTimeout: Function     // Called when timer expires
 * }
 */

// =============================================================================
// HELPER FUNCTIONS
// =============================================================================

/**
 * Clear timer safely
 * Removes all timer references and clears intervals/timeouts
 * @param {string} roomId - Room ID to clear timer for
 */
function clearTimer(roomId) {
  const timer = activeTimers.get(roomId);
  if (!timer) {
    return;
  }
  
  // Clear interval if exists
  if (timer.intervalId) {
    clearInterval(timer.intervalId);
  }
  
  // Clear timeout if exists
  if (timer.timeoutId) {
    clearTimeout(timer.timeoutId);
  }
  
  // Remove from storage
  activeTimers.delete(roomId);
  
  console.log(`[TIMER] Cleared timer: ${roomId} | Type: ${timer.type}`);
}

/**
 * Create timer object
 * @param {string} roomId - Room ID
 * @param {string} type - Timer type ('word_selection' | 'drawing')
 * @param {number} duration - Duration in seconds
 * @param {Function} onTick - Callback for each tick
 * @param {Function} onTimeout - Callback when timer expires
 * @returns {Object} Timer object
 */
function createTimer(roomId, type, duration, onTick, onTimeout) {
  return {
    roomId,
    type,
    duration,
    remaining: duration,
    intervalId: null,
    timeoutId: null,
    onTick,
    onTimeout
  };
}

// =============================================================================
// TIMER MANAGEMENT FUNCTIONS
// =============================================================================

/**
 * Start a timer for a room
 * Clears any existing timer first (one timer per room rule)
 * @param {string} roomId - Room ID
 * @param {string} type - Timer type ('word_selection' | 'drawing')
 * @param {number} duration - Duration in seconds
 * @param {Function} onTick - Callback called every second with (roomId, remaining)
 * @param {Function} onTimeout - Callback called when timer expires with (roomId)
 * @returns {Object} { success: boolean, error: string|null }
 */
function startTimer(roomId, type, duration, onTick, onTimeout) {
  // Validate inputs
  if (!roomId || typeof roomId !== 'string') {
    return { success: false, error: 'Invalid room ID' };
  }
  
  if (type !== 'word_selection' && type !== 'drawing') {
    return { success: false, error: 'Invalid timer type' };
  }
  
  if (typeof duration !== 'number' || duration <= 0) {
    return { success: false, error: 'Invalid duration' };
  }
  
  if (typeof onTick !== 'function' || typeof onTimeout !== 'function') {
    return { success: false, error: 'Invalid callbacks' };
  }
  
  // Clear any existing timer for this room
  clearTimer(roomId);
  
  // Create timer object
  const timer = createTimer(roomId, type, duration, onTick, onTimeout);
  
  // Set up interval for ticks (every second)
  timer.intervalId = setInterval(() => {
    timer.remaining--;
    
    // Call tick callback
    try {
      timer.onTick(roomId, timer.remaining);
    } catch (error) {
      console.error(`[TIMER] Error in tick callback for ${roomId}:`, error);
    }
    
    // Stop interval when time runs out
    if (timer.remaining <= 0) {
      clearInterval(timer.intervalId);
      timer.intervalId = null;
    }
  }, TIMER_TICK_INTERVAL);
  
  // Set up timeout for final expiration
  timer.timeoutId = setTimeout(() => {
    // Clear interval if still running
    if (timer.intervalId) {
      clearInterval(timer.intervalId);
      timer.intervalId = null;
    }
    
    // Remove from storage
    activeTimers.delete(roomId);
    
    // Call timeout callback
    try {
      timer.onTimeout(roomId);
    } catch (error) {
      console.error(`[TIMER] Error in timeout callback for ${roomId}:`, error);
    }
    
    console.log(`[TIMER] Timer expired: ${roomId} | Type: ${type}`);
  }, duration * 1000);
  
  // Store timer
  activeTimers.set(roomId, timer);
  
  console.log(`[TIMER] Started timer: ${roomId} | Type: ${type} | Duration: ${duration}s`);
  
  return { success: true, error: null };
}

/**
 * Stop timer for a room
 * @param {string} roomId - Room ID
 * @returns {boolean} True if timer was stopped, false if no timer existed
 */
function stopTimer(roomId) {
  const timer = activeTimers.get(roomId);
  if (!timer) {
    return false;
  }
  
  clearTimer(roomId);
  return true;
}

/**
 * Get remaining time for a room's timer
 * @param {string} roomId - Room ID
 * @returns {number|null} Remaining seconds or null if no timer
 */
function getRemainingTime(roomId) {
  const timer = activeTimers.get(roomId);
  if (!timer) {
    return null;
  }
  return timer.remaining;
}

/**
 * Check if room has active timer
 * @param {string} roomId - Room ID
 * @returns {boolean} True if timer is active
 */
function hasActiveTimer(roomId) {
  return activeTimers.has(roomId);
}

// =============================================================================
// GAME-SPECIFIC TIMER FUNCTIONS
// =============================================================================

/**
 * Start word selection timer
 * Auto-selects word if drawer doesn't select in time
 * @param {Object} room - Room object with active game
 * @param {Function} onTick - Callback for each tick
 * @param {Function} onTimeout - Callback when timer expires (optional, defaults to auto-select)
 * @returns {Object} { success: boolean, error: string|null }
 */
function startWordSelectionTimer(room, onTick, onTimeout) {
  // Validate game state
  const validation = gameEngine.hasActiveGame(room);
  if (!validation.valid) {
    return { success: false, error: validation.error };
  }
  
  const game = room.game;
  
  // Check if we're in word selection phase
  if (game.phase !== gameEngine.PHASES.WORD_SELECT) {
    return { success: false, error: 'Not in word selection phase' };
  }
  
  // Default timeout handler: auto-select word
  // Note: Actual implementation will be handled in index.js to avoid circular dependencies
  const defaultOnTimeout = (roomId) => {
    // This will be handled by the caller in index.js
    // Timer just signals that timeout occurred
  };
  
  // Use provided timeout or default
  const timeoutHandler = onTimeout || defaultOnTimeout;
  
  // Start timer
  return startTimer(
    room.id,
    'word_selection',
    WORD_SELECTION_TIMEOUT / 1000, // Convert to seconds
    onTick || (() => {}),
    timeoutHandler
  );
}

/**
 * Start drawing timer for current round
 * Ends round automatically when timer expires
 * @param {Object} room - Room object with active game
 * @param {Function} onTick - Callback for each tick
 * @param {Function} onTimeout - Callback when timer expires (optional, defaults to end round)
 * @returns {Object} { success: boolean, error: string|null }
 */
function startDrawingTimer(room, onTick, onTimeout) {
  // Validate game state
  const validation = gameEngine.hasActiveGame(room);
  if (!validation.valid) {
    return { success: false, error: validation.error };
  }
  
  const game = room.game;
  
  // Check if we're in drawing phase
  if (game.phase !== gameEngine.PHASES.DRAWING) {
    return { success: false, error: 'Not in drawing phase' };
  }
  
  // Get draw time from room settings
  const drawTime = room.settings.drawTime || 80; // Default 80 seconds
  
  // Default timeout handler: end round
  // Note: Actual implementation will be handled in index.js to avoid circular dependencies
  const defaultOnTimeout = (roomId) => {
    // This will be handled by the caller in index.js
    // Timer just signals that timeout occurred
  };
  
  // Use provided timeout or default
  const timeoutHandler = onTimeout || defaultOnTimeout;
  
  // Start timer
  return startTimer(
    room.id,
    'drawing',
    drawTime,
    onTick || (() => {}),
    timeoutHandler
  );
}

// =============================================================================
// CLEANUP FUNCTIONS
// =============================================================================

/**
 * Clear all timers (for server shutdown)
 */
function clearAllTimers() {
  const roomIds = Array.from(activeTimers.keys());
  roomIds.forEach(roomId => clearTimer(roomId));
  console.log(`[TIMER] Cleared all timers: ${roomIds.length} timers cleared`);
}

// =============================================================================
// MODULE EXPORTS
// =============================================================================

module.exports = {
  // Timer management
  startTimer,
  stopTimer,
  clearTimer,
  getRemainingTime,
  hasActiveTimer,
  
  // Game-specific timers
  startWordSelectionTimer,
  startDrawingTimer,
  
  // Cleanup
  clearAllTimers,
  
  // Constants
  TIMER_TICK_INTERVAL,
  WORD_SELECTION_TIMEOUT
};