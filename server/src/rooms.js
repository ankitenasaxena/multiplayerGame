// =============================================================================
// ROOM LIFECYCLE MANAGEMENT MODULE
// Real-time Multiplayer Drawing Game Backend
// =============================================================================
// Purpose: Manage room creation, joining, leaving, and cleanup
// This module handles the pre-game lobby state only
// =============================================================================

// =============================================================================
// IN-MEMORY ROOM STORAGE
// =============================================================================

// Map structure: roomId -> room object
// We use roomId as the key for O(1) lookup
const rooms = new Map();

// =============================================================================
// CONFIGURATION CONSTANTS
// =============================================================================

const ROOM_ID_LENGTH = 6;
const ROOM_ID_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';

// Default room settings
const DEFAULT_SETTINGS = {
  maxPlayers: 8,
  drawTime: 80,
  rounds: 3,
  hints: true,
  customWords: []
};

// Validation limits
const LIMITS = {
  maxPlayers: { min: 2, max: 12 },
  drawTime: { min: 30, max: 120 },
  rounds: { min: 1, max: 10 },
  customWords: { maxLength: 50, maxCount: 50 }
};

// =============================================================================
// HELPER FUNCTIONS
// =============================================================================

/**
 * Generate a unique room ID
 * Format: 6 uppercase alphanumeric characters (e.g., "A3B7K9")
 * @returns {string} Unique room ID
 */
function generateRoomId() {
  let roomId;
  let attempts = 0;
  const maxAttempts = 100;

  // Keep generating until we find a unique ID
  do {
    roomId = '';
    for (let i = 0; i < ROOM_ID_LENGTH; i++) {
      const randomIndex = Math.floor(Math.random() * ROOM_ID_CHARS.length);
      roomId += ROOM_ID_CHARS[randomIndex];
    }
    attempts++;

    // Safety check to prevent infinite loop
    if (attempts >= maxAttempts) {
      throw new Error('Failed to generate unique room ID after maximum attempts');
    }
  } while (rooms.has(roomId));

  return roomId;
}

/**
 * Normalize room ID to uppercase for case-insensitive lookup
 * @param {string} roomId - Raw room ID from client
 * @returns {string} Uppercase room ID
 */
function normalizeRoomId(roomId) {
  return typeof roomId === 'string' ? roomId.trim().toUpperCase() : '';
}

/**
 * Validate and sanitize room settings
 * Applies safe defaults for missing or invalid values
 * @param {Object} settings - Raw settings from client
 * @returns {Object} Validated settings object
 */
function validateSettings(settings) {
  // Start with defaults
  const validated = { ...DEFAULT_SETTINGS };

  // If no settings provided, return defaults
  if (!settings || typeof settings !== 'object') {
    return validated;
  }

  // Validate maxPlayers
  if (typeof settings.maxPlayers === 'number') {
    validated.maxPlayers = Math.max(
      LIMITS.maxPlayers.min,
      Math.min(LIMITS.maxPlayers.max, Math.floor(settings.maxPlayers))
    );
  }

  // Validate drawTime
  if (typeof settings.drawTime === 'number') {
    validated.drawTime = Math.max(
      LIMITS.drawTime.min,
      Math.min(LIMITS.drawTime.max, Math.floor(settings.drawTime))
    );
  }

  // Validate rounds
  if (typeof settings.rounds === 'number') {
    validated.rounds = Math.max(
      LIMITS.rounds.min,
      Math.min(LIMITS.rounds.max, Math.floor(settings.rounds))
    );
  }

  // Validate hints (boolean only)
  if (typeof settings.hints === 'boolean') {
    validated.hints = settings.hints;
  }

  // Validate customWords (array of strings)
  if (Array.isArray(settings.customWords)) {
    validated.customWords = settings.customWords
      .filter(word => typeof word === 'string' && word.trim().length > 0)
      .map(word => word.trim().toLowerCase()) // Normalize to lowercase
      .filter(word => word.length <= LIMITS.customWords.maxLength) // Enforce max word length
      .slice(0, LIMITS.customWords.maxCount); // Limit to max count
  }

  return validated;
}

/**
 * Serialize room data for client transmission
 * Includes all room information needed by frontend
 * @param {Object} room - Room object from storage
 * @param {Function} getPlayer - Function to retrieve player data
 * @returns {Object} Serialized room data
 */
function serializeRoom(room, getPlayer) {
  // Get full player objects for each player ID in room
  const playerData = room.players
    .map(playerId => getPlayer(playerId))
    .filter(player => player !== null) // Remove any null entries
    .map(player => ({
      id: player.id,
      name: player.name,
      isOwner: player.id === room.ownerId
    }));

  return {
    id: room.id,
    ownerId: room.ownerId,
    players: playerData,
    settings: room.settings,
    status: room.status
  };
}

// =============================================================================
// CORE ROOM MANAGEMENT FUNCTIONS
// =============================================================================

/**
 * Create a new room
 * @param {string} playerId - ID of player creating the room
 * @param {Object} settings - Room settings from client
 * @returns {Object} { success: boolean, room: Object|null, error: string|null }
 */
function createRoom(playerId, settings) {
  // Validate settings and apply defaults
  const validatedSettings = validateSettings(settings);

  // Generate unique room ID
  let roomId;
  try {
    roomId = generateRoomId();
  } catch (error) {
    return { success: false, room: null, error: 'Failed to generate room ID' };
  }

  // Create room object
  const room = {
    id: roomId,
    ownerId: playerId,
    players: [playerId], // Creator is first player
    settings: validatedSettings,
    status: 'waiting' // Pre-game lobby state
  };

  // Store room in memory
  rooms.set(roomId, room);

  console.log(`[ROOM] Created room: ${roomId} | Owner: ${playerId} | Max: ${validatedSettings.maxPlayers}`);

  return { success: true, room: room, error: null };
}

/**
 * Join an existing room
 * @param {string} playerId - ID of player joining
 * @param {string} roomId - Room ID to join
 * @returns {Object} { success: boolean, room: Object|null, error: string|null }
 */
function joinRoom(playerId, roomId) {
  // Normalize room ID for case-insensitive lookup
  const normalizedRoomId = normalizeRoomId(roomId);

  // Check if room exists
  const room = rooms.get(normalizedRoomId);
  if (!room) {
    return { success: false, room: null, error: 'Room not found' };
  }

  // Check room status
  if (room.status !== 'waiting') {
    return { success: false, room: null, error: 'Room is not accepting players' };
  }

  // Check if player is already in room
  if (room.players.includes(playerId)) {
    return { success: false, room: null, error: 'Already in this room' };
  }

  // Check if room is full
  if (room.players.length >= room.settings.maxPlayers) {
    return { success: false, room: null, error: 'Room is full' };
  }

  // Add player to room
  room.players.push(playerId);

  console.log(`[ROOM] Player joined: ${playerId} | Room: ${normalizedRoomId} | Count: ${room.players.length}/${room.settings.maxPlayers}`);

  return { success: true, room: room, error: null };
}

/**
 * Remove player from their current room
 * Handles owner reassignment and room cleanup
 * @param {string} playerId - ID of player leaving
 * @param {string} roomId - Room ID player is leaving from
 * @returns {Object} { success: boolean, room: Object|null, deleted: boolean, error: string|null }
 */
function leaveRoom(playerId, roomId) {
  // Normalize room ID
  const normalizedRoomId = normalizeRoomId(roomId);

  // Check if room exists
  const room = rooms.get(normalizedRoomId);
  if (!room) {
    return { success: false, room: null, deleted: false, error: 'Room not found' };
  }

  // Check if player is in room
  const playerIndex = room.players.indexOf(playerId);
  if (playerIndex === -1) {
    return { success: false, room: null, deleted: false, error: 'Player not in room' };
  }

  // Remove player from room
  room.players.splice(playerIndex, 1);

  console.log(`[ROOM] Player left: ${playerId} | Room: ${normalizedRoomId} | Remaining: ${room.players.length}`);

  // Check if room is now empty
  if (room.players.length === 0) {
    rooms.delete(normalizedRoomId);
    console.log(`[ROOM] Deleted empty room: ${normalizedRoomId}`);
    return { success: true, room: null, deleted: true, error: null };
  }

  // Reassign owner if the owner left
  if (room.ownerId === playerId) {
    // New owner is the first remaining player
    room.ownerId = room.players[0];
    console.log(`[ROOM] Owner reassigned: ${room.ownerId} | Room: ${normalizedRoomId}`);
  }

  return { success: true, room: room, deleted: false, error: null };
}

/**
 * Update room settings (owner only, waiting state only)
 * @param {string} playerId - ID of player updating settings
 * @param {string} roomId - Room ID to update
 * @param {Object} newSettings - New settings from client
 * @returns {Object} { success: boolean, settings: Object|null, error: string|null }
 */
function updateRoomSettings(playerId, roomId, newSettings) {
  // Normalize room ID
  const normalizedRoomId = normalizeRoomId(roomId);

  // Check if room exists
  const room = rooms.get(normalizedRoomId);
  if (!room) {
    return { success: false, settings: null, error: 'Room not found' };
  }

  // Check if player is the room owner
  if (room.ownerId !== playerId) {
    console.log(`[ROOM] Settings update rejected: ${playerId} is not owner of ${normalizedRoomId}`);
    return { success: false, settings: null, error: 'Only room owner can update settings' };
  }

  // Check if room is in waiting state (settings locked once game starts)
  if (room.status !== 'waiting') {
    console.log(`[ROOM] Settings update rejected: ${normalizedRoomId} is not in waiting state`);
    return { success: false, settings: null, error: 'Settings locked: game has started' };
  }

  // Validate new settings
  const validatedSettings = validateSettings(newSettings);

  // Special validation: maxPlayers cannot be less than current player count
  if (validatedSettings.maxPlayers < room.players.length) {
    console.log(`[ROOM] Settings update rejected: maxPlayers (${validatedSettings.maxPlayers}) < current players (${room.players.length})`);
    return { 
      success: false, 
      settings: null, 
      error: `Cannot set max players below current player count (${room.players.length})` 
    };
  }

  // Update room settings
  room.settings = validatedSettings;

  console.log(`[ROOM] Settings updated: ${normalizedRoomId} | Owner: ${playerId} | Settings: ${JSON.stringify(validatedSettings)}`);

  return { success: true, settings: validatedSettings, error: null };
}

/**
 * Get room by ID
 * @param {string} roomId - Room ID to lookup
 * @returns {Object|null} Room object or null if not found
 */
function getRoom(roomId) {
  const normalizedRoomId = normalizeRoomId(roomId);
  return rooms.get(normalizedRoomId) || null;
}

/**
 * Get room by player ID
 * Finds which room a player is currently in
 * @param {string} playerId - Player ID to lookup
 * @returns {Object|null} Room object or null if player not in any room
 */
function getRoomByPlayer(playerId) {
  for (const room of rooms.values()) {
    if (room.players.includes(playerId)) {
      return room;
    }
  }
  return null;
}

/**
 * Get all rooms
 * Useful for debugging and future lobby list feature
 * @returns {Array} Array of all room objects
 */
function getAllRooms() {
  return Array.from(rooms.values());
}

/**
 * Get room count
 * @returns {number} Number of active rooms
 */
function getRoomCount() {
  return rooms.size;
}

// =============================================================================
// MODULE EXPORTS
// =============================================================================

module.exports = {
  createRoom,
  joinRoom,
  leaveRoom,
  updateRoomSettings,
  getRoom,
  getRoomByPlayer,
  getAllRooms,
  getRoomCount,
  serializeRoom
};