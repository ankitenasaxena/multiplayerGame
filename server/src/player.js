// =============================================================================
// PLAYER IDENTITY AND CONNECTION STATE MODULE
// Real-time Multiplayer Drawing Game Backend
// =============================================================================
// Purpose: Manage player identity, metadata, and lifecycle in memory
// This module handles player creation, updates, and cleanup
// =============================================================================

const { randomUUID } = require('crypto');

// =============================================================================
// IN-MEMORY PLAYER STORAGE
// =============================================================================

// Map structure: socketId -> player object
// We use socketId as the key for O(1) lookup and deletion
// This is critical for handling fast connects/disconnects
const players = new Map();

// Secondary index: playerId -> player object
// Allows lookup by player ID (needed for room management)
const playerById = new Map();

// =============================================================================
// CONFIGURATION CONSTANTS
// =============================================================================

const MAX_NAME_LENGTH = 20;
const MIN_NAME_LENGTH = 1;
const DEFAULT_NAME_PREFIX = 'Player';

// =============================================================================
// HELPER FUNCTIONS
// =============================================================================

/**
 * Generate a default player name with a random suffix
 * Format: "Player" + random 3-digit number (e.g., "Player042")
 * @returns {string} Default player name
 */
function generateDefaultName() {
  const randomSuffix = Math.floor(Math.random() * 1000).toString().padStart(3, '0');
  return `${DEFAULT_NAME_PREFIX}${randomSuffix}`;
}

/**
 * Validate and sanitize player name
 * @param {string} name - Raw name input from client
 * @returns {Object} { valid: boolean, sanitized: string, error: string }
 */
function validateName(name) {
  // Check if name exists and is a string
  if (typeof name !== 'string') {
    return { valid: false, sanitized: '', error: 'Name must be a string' };
  }

  // Trim whitespace from both ends
  const trimmed = name.trim();

  // Check minimum length (after trimming)
  if (trimmed.length < MIN_NAME_LENGTH) {
    return { valid: false, sanitized: '', error: 'Name cannot be empty' };
  }

  // Check maximum length
  if (trimmed.length > MAX_NAME_LENGTH) {
    return { valid: false, sanitized: '', error: `Name cannot exceed ${MAX_NAME_LENGTH} characters` };
  }

  return { valid: true, sanitized: trimmed, error: null };
}

// =============================================================================
// CORE PLAYER MANAGEMENT FUNCTIONS
// =============================================================================

/**
 * Create a new player object and store in memory
 * Called when a socket connects
 * @param {string} socketId - Socket ID from Socket.IO
 * @returns {Object} Created player object
 */
function createPlayer(socketId) {
  // Generate unique player ID using UUID v4
  const playerId = randomUUID();

  // Create player object with default values
  const player = {
    id: playerId,
    socketId: socketId,
    name: generateDefaultName(),
    roomId: null, // Will be used by room management module
    score: 0 // Initial score for scoring system
  };

  // Store player in memory using socketId as key
  players.set(socketId, player);
  
  // Store in secondary index using playerId as key
  playerById.set(playerId, player);

  console.log(`[PLAYER] Created player: ${playerId} | Socket: ${socketId} | Name: ${player.name}`);

  return player;
}

/**
 * Update player name
 * Validates input and updates player object if valid
 * @param {string} socketId - Socket ID to identify player
 * @param {string} newName - New name from client
 * @returns {Object} { success: boolean, player: Object|null, error: string|null }
 */
function updatePlayerName(socketId, newName) {
  // Check if player exists
  const player = players.get(socketId);
  if (!player) {
    return { success: false, player: null, error: 'Player not found' };
  }

  // Validate and sanitize the new name
  const validation = validateName(newName);
  if (!validation.valid) {
    return { success: false, player: null, error: validation.error };
  }

  // Store old name for logging
  const oldName = player.name;

  // Update player name
  player.name = validation.sanitized;

  console.log(`[PLAYER] Updated player: ${player.id} | Name: ${oldName} → ${player.name}`);

  return { success: true, player: player, error: null };
}

/**
 * Update player's room assignment
 * Called when player joins or leaves a room
 * @param {string} playerId - Player ID to update
 * @param {string|null} roomId - Room ID or null if leaving
 * @returns {boolean} True if updated successfully
 */
function updatePlayerRoom(playerId, roomId) {
  const player = playerById.get(playerId);
  if (!player) {
    return false;
  }

  player.roomId = roomId;
  
  if (roomId) {
    console.log(`[PLAYER] Player ${playerId} assigned to room: ${roomId}`);
  } else {
    console.log(`[PLAYER] Player ${playerId} removed from room`);
  }

  return true;
}

/**
 * Update player's score
 * Called by scoring system to update player's total score
 * @param {string} playerId - Player ID to update
 * @param {number} newScore - New total score
 * @returns {boolean} True if updated successfully
 */
function updatePlayerScore(playerId, newScore) {
  const player = playerById.get(playerId);
  if (!player) {
    return false;
  }

  if (typeof newScore !== 'number' || newScore < 0) {
    return false;
  }

  player.score = newScore;
  return true;
}

/**
 * Reset player scores for all players in a room
 * Called when starting a new game (play again)
 * @param {Array} playerIds - Array of player IDs to reset
 */
function resetPlayerScores(playerIds) {
  playerIds.forEach(playerId => {
    const player = playerById.get(playerId);
    if (player) {
      player.score = 0;
    }
  });
}

/**
 * Remove player from memory
 * Called when a socket disconnects
 * @param {string} socketId - Socket ID to identify player
 * @returns {boolean} True if player was removed, false if not found
 */
function removePlayer(socketId) {
  // Retrieve player before deletion for logging
  const player = players.get(socketId);

  if (!player) {
    // Player not found - this is not an error, just log it
    console.log(`[PLAYER] Attempted to remove non-existent player | Socket: ${socketId}`);
    return false;
  }

  // Delete from both indexes
  players.delete(socketId);
  playerById.delete(player.id);

  console.log(`[PLAYER] Removed player: ${player.id} | Socket: ${socketId} | Name: ${player.name}`);

  return true;
}

/**
 * Get player by socket ID
 * @param {string} socketId - Socket ID to lookup
 * @returns {Object|null} Player object or null if not found
 */
function getPlayer(socketId) {
  return players.get(socketId) || null;
}

/**
 * Get player by player ID
 * Used by room management to retrieve player data
 * @param {string} playerId - Player ID to lookup
 * @returns {Object|null} Player object or null if not found
 */
function getPlayerById(playerId) {
  return playerById.get(playerId) || null;
}

/**
 * Get all players
 * Useful for debugging and future modules (e.g., room management)
 * @returns {Array} Array of all player objects
 */
function getAllPlayers() {
  return Array.from(players.values());
}

/**
 * Get player count
 * @returns {number} Number of active players
 */
function getPlayerCount() {
  return players.size;
}

// =============================================================================
// MODULE EXPORTS
// =============================================================================

module.exports = {
  createPlayer,
  updatePlayerName,
  updatePlayerRoom,
  updatePlayerScore,
  resetPlayerScores,
  removePlayer,
  getPlayer,
  getPlayerById,
  getAllPlayers,
  getPlayerCount
};