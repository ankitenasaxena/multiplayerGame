// =============================================================================
// DRAWING SYNCHRONIZATION ENGINE MODULE
// Real-time Multiplayer Drawing Game Backend
// =============================================================================
// Purpose: Relay drawing strokes from drawer to guessers
// This module is stateless - does not persist strokes, only relays them
// =============================================================================

const gameEngine = require('./gameEngine');

// =============================================================================
// CONFIGURATION CONSTANTS
// =============================================================================

// Throttle drawing events to prevent spam
// Maximum events per second per room
const MAX_DRAW_EVENTS_PER_SECOND = 30;

// Batch window for batching draw events
const BATCH_WINDOW_MS = 50; // 50ms batching window

// =============================================================================
// BATCHING STORAGE
// =============================================================================

// Map structure: roomId -> batch object
// Used for batching draw_move events
const drawBatches = new Map();

// Map structure: roomId -> last event time
// Used for throttling
const lastEventTimes = new Map();

// =============================================================================
// HELPER FUNCTIONS
// =============================================================================

/**
 * Check if drawing event should be throttled
 * @param {string} roomId - Room ID
 * @returns {boolean} True if event should be throttled
 */
function shouldThrottle(roomId) {
  const now = Date.now();
  const lastTime = lastEventTimes.get(roomId) || 0;
  const minInterval = 1000 / MAX_DRAW_EVENTS_PER_SECOND;
  
  if (now - lastTime < minInterval) {
    return true;
  }
  
  lastEventTimes.set(roomId, now);
  return false;
}

/**
 * Clear batching data for a room
 * @param {string} roomId - Room ID
 */
function clearBatch(roomId) {
  drawBatches.delete(roomId);
  lastEventTimes.delete(roomId);
}

// =============================================================================
// DRAWING EVENT VALIDATION
// =============================================================================

/**
 * Validate drawing event from drawer
 * Ensures only drawer can send drawing events
 * @param {Object} room - Room object with active game
 * @param {string} playerId - Player ID sending the event
 * @param {string} eventType - Type of drawing event
 * @returns {Object} { valid: boolean, error: string|null }
 */
function validateDrawingEvent(room, playerId, eventType) {
  // Validate game state
  const validation = gameEngine.hasActiveGame(room);
  if (!validation.valid) {
    return { valid: false, error: validation.error };
  }
  
  const game = room.game;
  
  // Check if we're in drawing phase
  if (game.phase !== gameEngine.PHASES.DRAWING) {
    return { valid: false, error: 'Not in drawing phase' };
  }
  
  // Check if player is the drawer
  if (!gameEngine.isCurrentDrawer(room, playerId)) {
    return { valid: false, error: 'Only drawer can draw' };
  }
  
  // Validate event type
  const validEventTypes = ['draw_start', 'draw_move', 'draw_end', 'clear_canvas'];
  if (!validEventTypes.includes(eventType)) {
    return { valid: false, error: 'Invalid drawing event type' };
  }
  
  return { valid: true, error: null };
}

// =============================================================================
// DRAWING EVENT HANDLERS
// =============================================================================

/**
 * Handle draw start event
 * Drawer starts a new stroke
 * @param {Object} room - Room object with active game
 * @param {string} playerId - Drawer player ID
 * @param {Object} data - Drawing data (x, y, color, brushSize, etc.)
 * @returns {Object} { success: boolean, data: Object|null, error: string|null }
 */
function handleDrawStart(room, playerId, data) {
  // Validate event
  const validation = validateDrawingEvent(room, playerId, 'draw_start');
  if (!validation.valid) {
    return { success: false, data: null, error: validation.error };
  }
  
  // Clear any existing batch
  clearBatch(room.id);
  
  // Validate data structure
  if (!data || typeof data !== 'object') {
    return { success: false, data: null, error: 'Invalid drawing data' };
  }
  
  console.log(`[DRAWING] Draw start: ${room.id} | Drawer: ${playerId}`);
  
  return { success: true, data: data, error: null };
}

/**
 * Handle draw move event
 * Drawer continues a stroke (may be batched/throttled)
 * @param {Object} room - Room object with active game
 * @param {string} playerId - Drawer player ID
 * @param {Object} data - Drawing data (x, y, etc.)
 * @returns {Object} { success: boolean, data: Object|null, shouldBatch: boolean, error: string|null }
 */
function handleDrawMove(room, playerId, data) {
  // Validate event
  const validation = validateDrawingEvent(room, playerId, 'draw_move');
  if (!validation.valid) {
    return { success: false, data: null, shouldBatch: false, error: validation.error };
  }
  
  // Check throttling
  if (shouldThrottle(room.id)) {
    // Add to batch instead of immediate send
    if (!drawBatches.has(room.id)) {
      drawBatches.set(room.id, []);
    }
    drawBatches.get(room.id).push(data);
    
    return { success: true, data: null, shouldBatch: true, error: null };
  }
  
  // Validate data structure
  if (!data || typeof data !== 'object') {
    return { success: false, data: null, shouldBatch: false, error: 'Invalid drawing data' };
  }
  
  // Check if there's a batch to flush
  const batch = drawBatches.get(room.id);
  if (batch && batch.length > 0) {
    // Include current data in batch
    batch.push(data);
    return { success: true, data: batch, shouldBatch: false, error: null };
  }
  
  return { success: true, data: data, shouldBatch: false, error: null };
}

/**
 * Handle draw end event
 * Drawer finishes a stroke
 * @param {Object} room - Room object with active game
 * @param {string} playerId - Drawer player ID
 * @param {Object} data - Drawing data (x, y, etc.)
 * @returns {Object} { success: boolean, data: Object|null, error: string|null }
 */
function handleDrawEnd(room, playerId, data) {
  // Validate event
  const validation = validateDrawingEvent(room, playerId, 'draw_end');
  if (!validation.valid) {
    return { success: false, data: null, error: validation.error };
  }
  
  // Clear batch
  clearBatch(room.id);
  
  // Validate data structure
  if (!data || typeof data !== 'object') {
    return { success: false, data: null, error: 'Invalid drawing data' };
  }
  
  console.log(`[DRAWING] Draw end: ${room.id} | Drawer: ${playerId}`);
  
  return { success: true, data: data, error: null };
}

/**
 * Handle clear canvas event
 * Drawer clears the canvas
 * @param {Object} room - Room object with active game
 * @param {string} playerId - Drawer player ID
 * @returns {Object} { success: boolean, error: string|null }
 */
function handleClearCanvas(room, playerId) {
  // Validate event
  const validation = validateDrawingEvent(room, playerId, 'clear_canvas');
  if (!validation.valid) {
    return { success: false, error: validation.error };
  }
  
  // Clear batch
  clearBatch(room.id);
  
  console.log(`[DRAWING] Canvas cleared: ${room.id} | Drawer: ${playerId}`);
  
  return { success: true, error: null };
}

/**
 * Get batched draw moves for a room
 * Flushes and clears the batch
 * @param {string} roomId - Room ID
 * @returns {Array|null} Batched draw moves or null if no batch
 */
function flushBatch(roomId) {
  const batch = drawBatches.get(roomId);
  if (!batch || batch.length === 0) {
    return null;
  }
  
  // Clear batch after flushing
  drawBatches.delete(roomId);
  
  return batch;
}

/**
 * Clear drawing state for a room
 * Called when round ends or game resets
 * @param {string} roomId - Room ID
 */
function clearDrawingState(roomId) {
  clearBatch(roomId);
  console.log(`[DRAWING] Cleared drawing state: ${roomId}`);
}

// =============================================================================
// MODULE EXPORTS
// =============================================================================

module.exports = {
  // Drawing event handlers
  handleDrawStart,
  handleDrawMove,
  handleDrawEnd,
  handleClearCanvas,
  
  // Batching
  flushBatch,
  
  // State management
  clearDrawingState,
  
  // Validation
  validateDrawingEvent,
  
  // Constants
  MAX_DRAW_EVENTS_PER_SECOND,
  BATCH_WINDOW_MS
};

