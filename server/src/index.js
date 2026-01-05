const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const playerManager = require('./player');
const roomManager = require('./rooms');
const gameEngine = require('./gameEngine');
const wordEngine = require('./wordEngine');
const timerEngine = require('./timerEngine');
const drawingEngine = require('./drawingEngine');
const guessEngine = require('./guessEngine');
const scoreEngine = require('./scoreEngine');

// Read port from environment variable, fallback to 3000 for local development
const PORT = process.env.PORT || 3000;

// Create Express application instance
const app = express();

// Create HTTP server using Node's built-in http module
const server = http.createServer(app);

app.use(express.static('../client'));

// Attach Socket.IO to the HTTP server with CORS configuration
const io = new Server(server, {
  cors: {
    origin: "*", // Allow all origins
    methods: ["GET", "POST"], // Standard methods for WebSocket handshake
    credentials: false // No credentials needed for this application
  }
});

// =============================================================================
// HELPER FUNCTIONS FOR SOCKET OPERATIONS
// =============================================================================

/**
 * Broadcast room update to all players in a room
 * @param {string} roomId - Room ID to broadcast to
 */
function broadcastRoomUpdate(roomId) {
  const room = roomManager.getRoom(roomId);
  if (!room) return;

  const serialized = roomManager.serializeRoom(room, playerManager.getPlayerById);

  // Emit to all players in the room
  room.players.forEach(playerId => {
    const player = playerManager.getPlayerById(playerId);
    if (player && player.socketId) {
      io.to(player.socketId).emit('room_updated', { room: serialized });
    }
  });
}

/**
 * Broadcast settings update to all players in a room
 * @param {string} roomId - Room ID to broadcast to
 * @param {Object} settings - Updated settings object
 */
function broadcastSettingsUpdate(roomId, settings) {
  const room = roomManager.getRoom(roomId);
  if (!room) return;

  // Emit to all players in the room
  room.players.forEach(playerId => {
    const player = playerManager.getPlayerById(playerId);
    if (player && player.socketId) {
      io.to(player.socketId).emit('room_settings_updated', { settings });
    }
  });
}

/**
 * Broadcast game state to all players in a room
 * @param {string} roomId - Room ID to broadcast to
 * @param {string} eventName - Event name to emit
 * @param {Object} payload - Event payload
 */
function broadcastToRoom(roomId, eventName, payload) {
  const room = roomManager.getRoom(roomId);
  if (!room) return;

  // Emit to all players in the room
  room.players.forEach(playerId => {
    const player = playerManager.getPlayerById(playerId);
    if (player && player.socketId) {
      io.to(player.socketId).emit(eventName, payload);
    }
  });
}

/**
 * Serialize game state for client (never includes selectedWord)
 * @param {Object} room - Room object with game
 * @returns {Object|null} Serialized game state or null
 */
function serializeGameState(room) {
  if (!room.game) {
    return null;
  }

  const game = room.game;
  return {
    phase: game.phase,
    currentRound: game.currentRound,
    totalRounds: game.totalRounds,
    drawerId: game.drawerId,
    drawerIndex: game.drawerIndex,
    guessedPlayers: game.guessedPlayers || [],
    maskedWord: game.maskedWord || null
    // selectedWord is intentionally excluded - server-only
  };
}

// =============================================================================
// SOCKET CONNECTION HANDLERS
// =============================================================================

// Listen for new socket connections on the default namespace '/'
io.on('connection', (socket) => {
  // Log successful connection with socket ID for debugging/monitoring
  console.log(`[CONNECT] Socket connected: ${socket.id}`);

  // Create player identity and store in memory
  const player = playerManager.createPlayer(socket.id);

  // Send confirmation event back to client with connection details
  // This allows the client to confirm successful connection and store socket ID
  socket.emit('connected', {
    socketId: socket.id,
    status: 'ok'
  });

  // Send initial player data to client
  socket.emit('player_updated', {
    id: player.id,
    name: player.name
  });

  // =============================================================================
  // PLAYER NAME UPDATE HANDLER
  // =============================================================================

  // Listen for player name update requests from client
  socket.on('set_player_name', (payload) => {
    // Validate payload structure
    if (!payload || typeof payload !== 'object') {
      console.log(`[PLAYER] Invalid payload from ${socket.id}: payload must be an object`);
      return;
    }

    const { name } = payload;

    // Update player name with validation
    const result = playerManager.updatePlayerName(socket.id, name);

    if (result.success) {
      // Send updated player data back to client
      socket.emit('player_updated', {
        id: result.player.id,
        name: result.player.name
      });

      // If player is in a room, broadcast update to room
      const room = roomManager.getRoomByPlayer(result.player.id);
      if (room) {
        broadcastRoomUpdate(room.id);
      }
    } else {
      // Send error back to client (optional - helps with debugging)
      console.log(`[PLAYER] Name update failed for ${socket.id}: ${result.error}`);
    }
  });

  // =============================================================================
  // ROOM CREATION HANDLER
  // =============================================================================

  socket.on('create_room', (payload) => {
    const player = playerManager.getPlayer(socket.id);
    if (!player) {
      socket.emit('room_error', { error: 'Player not found' });
      return;
    }

    // Check if player is already in a room
    const existingRoom = roomManager.getRoomByPlayer(player.id);
    if (existingRoom) {
      socket.emit('room_error', { error: 'Already in a room' });
      return;
    }

    // Validate payload
    const settings = payload && typeof payload === 'object' ? payload.settings : null;

    // Create room
    const result = roomManager.createRoom(player.id, settings);

    if (result.success) {
      // Update player's roomId
      playerManager.updatePlayerRoom(player.id, result.room.id);

      // Serialize room data for client
      const serialized = roomManager.serializeRoom(result.room, playerManager.getPlayerById);

      // Send confirmation to creator
      socket.emit('room_created', {
        roomId: result.room.id,
        room: serialized
      });
    } else {
      socket.emit('room_error', { error: result.error });
    }
  });

  // =============================================================================
  // ROOM JOIN HANDLER
  // =============================================================================

  socket.on('join_room', (payload) => {
    const player = playerManager.getPlayer(socket.id);
    if (!player) {
      socket.emit('room_error', { error: 'Player not found' });
      return;
    }

    // Check if player is already in a room
    const existingRoom = roomManager.getRoomByPlayer(player.id);
    if (existingRoom) {
      socket.emit('room_error', { error: 'Already in a room' });
      return;
    }

    // Validate payload
    if (!payload || typeof payload !== 'object' || !payload.roomId) {
      socket.emit('room_error', { error: 'Invalid room ID' });
      return;
    }

    const { roomId } = payload;

    // Join room
    const result = roomManager.joinRoom(player.id, roomId);

    if (result.success) {
      // Update player's roomId
      playerManager.updatePlayerRoom(player.id, result.room.id);

      // Serialize room data for client
      const serialized = roomManager.serializeRoom(result.room, playerManager.getPlayerById);

      // Send confirmation to joining player
      socket.emit('room_joined', { room: serialized });

      // Broadcast room update to all players in room
      broadcastRoomUpdate(result.room.id);
    } else {
      socket.emit('room_error', { error: result.error });
    }
  });

  // =============================================================================
  // ROOM LEAVE HANDLER
  // =============================================================================

  socket.on('leave_room', () => {
    const player = playerManager.getPlayer(socket.id);
    if (!player) {
      return;
    }

    // Check if player is in a room
    if (!player.roomId) {
      return;
    }

    const roomId = player.roomId;
    const room = roomManager.getRoom(roomId);
    
    // Check if game is active and handle player leaving during game
    const wasInGame = room && room.status === gameEngine.ROOM_STATUS.IN_GAME;

    // Leave room
    const result = roomManager.leaveRoom(player.id, roomId);

    if (result.success) {
      // Update player's roomId to null
      playerManager.updatePlayerRoom(player.id, null);

      if (result.deleted) {
        // Room was deleted (empty)
        socket.emit('room_left', { roomId: roomId });
      } else {
        // Room still exists
        const updatedRoom = roomManager.getRoom(roomId);
        
        // If game was active, handle player leaving during game
        if (wasInGame && updatedRoom && updatedRoom.game) {
          handlePlayerLeaveDuringGame(updatedRoom, player.id);
        }
        
        // Broadcast update to remaining players
        socket.emit('room_left', { roomId: roomId });
        broadcastRoomUpdate(roomId);
      }
    }
  });

  // =============================================================================
  // ROOM SETTINGS UPDATE HANDLER
  // =============================================================================

  socket.on('update_room_settings', (payload) => {
    const player = playerManager.getPlayer(socket.id);
    if (!player) {
      socket.emit('room_settings_error', { message: 'Player not found' });
      return;
    }

    // Check if player is in a room
    if (!player.roomId) {
      socket.emit('room_settings_error', { message: 'Not in a room' });
      return;
    }

    // Validate payload structure
    if (!payload || typeof payload !== 'object' || !payload.settings) {
      socket.emit('room_settings_error', { message: 'Invalid settings payload' });
      return;
    }

    const { settings } = payload;

    // Update room settings
    const result = roomManager.updateRoomSettings(player.id, player.roomId, settings);

    if (result.success) {
      // Broadcast settings update to all players in room
      broadcastSettingsUpdate(player.roomId, result.settings);
    } else {
      // Send error back to requesting client
      socket.emit('room_settings_error', { message: result.error });
    }
  });

  // =============================================================================
  // GAME START HANDLER
  // =============================================================================

  socket.on('start_game', () => {
    const player = playerManager.getPlayer(socket.id);
    if (!player) {
      socket.emit('game_error', { error: 'Player not found' });
      return;
    }

    // Check if player is in a room
    if (!player.roomId) {
      socket.emit('game_error', { error: 'Not in a room' });
      return;
    }

    // Get room
    const room = roomManager.getRoom(player.roomId);
    if (!room) {
      socket.emit('game_error', { error: 'Room not found' });
      return;
    }

    console.log(`[SOCKET] start_game from socket ${socket.id}`);
    // Start game
    const result = gameEngine.startGame(room, player.id);

    if (result.success) {
      // Reset player scores for new game
      playerManager.resetPlayerScores(room.players);

      // Serialize latest room state (status will now be "in_game")
      const serializedRoom = roomManager.serializeRoom(
        room,
        playerManager.getPlayerById
      );

      console.log(`[GAME] Emitting game_started | room=${room.id} | drawer=${room.game.drawerId}`);
      // Broadcast game started with both game + room so clients stay in sync
      broadcastToRoom(room.id, 'game_started', {
        game: serializeGameState(room),
        room: serializedRoom,
        players: serializedRoom.players
      });
      
      // Start first round
      startRoundForRoom(room);
    } else {
      // Send error back to requesting client
      socket.emit('game_error', { error: result.error });
    }
  });

  // =============================================================================
  // WORD SELECTION HANDLERS (MODULE 6)
  // =============================================================================

  /**
   * Start round and handle word selection
   * Called when game starts or round progresses
   */
  function startRoundForRoom(room) {
    const result = gameEngine.startRound(room);
    if (!result.success) {
      console.error(`[GAME] Failed to start round: ${room.id} | Error: ${result.error}`);
      return;
    }

    // Initialize round start time for scoring
    const roundStartTime = Date.now();
    scoreEngine.initializeRoundStartTime(room, roundStartTime);
    room.game.roundStartTime = roundStartTime; // Store for scoring calculations
    
    // Initialize drawer's round start score for incremental updates
    const drawer = playerManager.getPlayerById(room.game.drawerId);
    if (drawer) {
      room.game.drawerRoundStartScore = drawer.score || 0;
    }

    console.log(`[GAME] Round start | room=${room.id} | round=${room.game.currentRound} | drawer=${room.game.drawerId}`);
    // Generate word options for drawer
    const wordOptionsResult = wordEngine.generateOptionsForDrawer(room);
    if (!wordOptionsResult.success) {
      console.error(`[WORD] Failed to generate options: ${room.id} | Error: ${wordOptionsResult.error}`);
      return;
    }

    const drawerId = room.game.drawerId;
    // Reuse drawer variable from above (line 433)
    
    // Send word options to drawer only
    if (drawer && drawer.socketId) {
      console.log(
        `[WORD] Emitting word_options to drawer socket=${drawer.socketId} | room=${room.id} | options=${JSON.stringify(
          wordOptionsResult.options
        )}`
      );
      io.to(drawer.socketId).emit('word_options', {
        game: serializeGameState(room),
        options: wordOptionsResult.options,
        timeout: wordEngine.WORD_SELECTION_TIMEOUT
      });
    }

    // Broadcast round start to all players
    console.log(`[GAME] Emitting round_started to room=${room.id}`);
    broadcastToRoom(room.id, 'round_started', {
      game: serializeGameState(room),
      drawerId: drawerId
    });

    // Start word selection timer
    timerEngine.startWordSelectionTimer(
      room,
      (roomId, remaining) => {
        // Timer tick - broadcast to room
        broadcastToRoom(roomId, 'timer_tick', {
          remaining: remaining,
          type: 'word_selection'
        });
      },
      (roomId) => {
        // Timer timeout - auto-select word
        const room = roomManager.getRoom(roomId);
        if (!room) return;

        const autoSelectResult = wordEngine.autoSelectWord(room);
        if (autoSelectResult.success) {
          // Broadcast word selected (include game state so frontend can update drawer)
          broadcastToRoom(roomId, 'word_selected', {
            game: serializeGameState(room),
            maskedWord: autoSelectResult.maskedWord,
            autoSelected: true
          });

          // Start drawing phase
          startDrawingPhase(room);
        }
      }
    );
  }

  /**
   * Handle word selection from drawer
   */
  socket.on('select_word', (payload) => {
    console.log(`[SOCKET] select_word from socket ${socket.id} payload=${JSON.stringify(payload)}`);
    const player = playerManager.getPlayer(socket.id);
    if (!player) {
      socket.emit('game_error', { error: 'Player not found' });
      return;
    }

    if (!player.roomId) {
      socket.emit('game_error', { error: 'Not in a room' });
      return;
    }

    const room = roomManager.getRoom(player.roomId);
    if (!room) {
      socket.emit('game_error', { error: 'Room not found' });
      return;
    }

    // Validate payload
    if (!payload || typeof payload !== 'object' || !payload.word) {
      socket.emit('game_error', { error: 'Invalid word selection' });
      return;
    }

    const { word } = payload;

    // Select word
    const result = wordEngine.selectWord(room, player.id, word);
    if (result.success) {
      // Stop word selection timer
      timerEngine.stopTimer(room.id);

      console.log(
        `[WORD] Emitting word_selected | room=${room.id} | maskedWord=${result.maskedWord}`
      );
      // Broadcast word selected to room (include game state so frontend can update drawer)
      broadcastToRoom(room.id, 'word_selected', {
        game: serializeGameState(room),
        maskedWord: result.maskedWord,
        autoSelected: false
      });

      // Start drawing phase
      startDrawingPhase(room);
    } else {
      socket.emit('game_error', { error: result.error });
    }
  });

  /**
   * Start drawing phase
   */
  function startDrawingPhase(room) {
    // Initialize round start time if missing
    if (!room.game.roundStartTime) {
      scoreEngine.initializeRoundStartTime(room, Date.now());
    }
  
    // Clear drawing state
    drawingEngine.clearDrawingState(room.id);
  
    const maskedWord = wordEngine.getMaskedWord(room);
    const drawerId = room.game.drawerId;
  
    console.log(
      `[DRAW] Starting drawing phase | room=${room.id} | drawer=${drawerId} | maskedWord=${maskedWord}`
    );
  
    // Broadcast drawing phase started
    room.players.forEach(playerId => {
      const player = playerManager.getPlayerById(playerId);
      if (!player || !player.socketId) return;
  
      if (playerId === drawerId) {
        io.to(player.socketId).emit('drawing_started', {
          game: serializeGameState(room),
          drawerId: drawerId,
          word: wordEngine.getSelectedWord(room)
        });
      } else {
        io.to(player.socketId).emit('drawing_started', {
          game: serializeGameState(room),
          drawerId: drawerId,
          maskedWord: maskedWord
        });
      }
    });
  
    // Initialize hint level for progressive hints (reset for new round)
    room.game.hintLevel = 0;
    
    // Start drawing timer with progressive hints
    const drawTime = room.settings.drawTime;
    const selectedWord = wordEngine.getSelectedWord(room);
    const wordLength = selectedWord ? selectedWord.replace(/\s/g, '').length : 5;
    
    // Calculate hint reveal: max 30-40% of letters, reveal every 15 seconds
    const maxHints = Math.max(1, Math.floor(wordLength * 0.35)); // Max 35% of letters
    const hintInterval = 15; // Fixed 15 second intervals
    const maxHintTime = maxHints * hintInterval; // Total time for all hints
    
    timerEngine.startDrawingTimer(
      room,
      (roomId, remaining) => {
        // Calculate hint level based on elapsed time
        const elapsed = drawTime - remaining;
        
        // Only reveal hints if within the hint reveal window
        if (elapsed <= maxHintTime) {
          const newHintLevel = Math.min(
            Math.floor(elapsed / hintInterval) + 1,
            maxHints
          );
          
          // Update hint if level changed and hints are enabled
          if (newHintLevel > room.game.hintLevel && room.settings.hints) {
            room.game.hintLevel = newHintLevel;
            const hintWord = wordEngine.generateHint(selectedWord, newHintLevel);
            
            // Broadcast hint update to guessers only
            room.players.forEach(playerId => {
              if (playerId !== drawerId) {
                const player = playerManager.getPlayerById(playerId);
                if (player && player.socketId) {
                  io.to(player.socketId).emit('hint_update', {
                    hintWord: hintWord
                  });
                }
              }
            });
          }
        }
        
        broadcastToRoom(roomId, 'timer_tick', {
          remaining: remaining,
          type: 'drawing'
        });
      },
      (roomId) => {
        const room = roomManager.getRoom(roomId);
        if (!room) return;
        endRoundForRoom(room);
      }
    );
  }
  

  /**
   * End round and handle scoring
   */
  function endRoundForRoom(room) {
    // Stop drawing timer
    timerEngine.stopTimer(room.id);

    // Award drawer score
    scoreEngine.awardDrawerScore(
      room,
      playerManager.getPlayerById,
      playerManager.updatePlayerScore
    );

    // End round
    const result = gameEngine.endRound(room);
    if (!result.success) {
      console.error(`[GAME] Failed to end round: ${room.id} | Error: ${result.error}`);
      return;
    }

    // Get leaderboard
    const leaderboard = scoreEngine.getLeaderboard(room, playerManager.getPlayerById);

    const isLastDrawer = gameEngine.drawerIndex === room.players.length - 1;

    // Broadcast round end (reveal word to all)
    broadcastToRoom(room.id, 'round_ended', {
      game: serializeGameState(room),
      leaderboard: leaderboard,
      selectedWord: wordEngine.getSelectedWord(room), // Reveal word at end of round
      roundCompleted: isLastDrawer,
    });

    // Clear word selection and drawing state
    wordEngine.clearWordSelection(room);
    drawingEngine.clearDrawingState(room.id);
    scoreEngine.clearRoundScoring(room.id);

    // Check if game should end
    if (result.gameEnded) {
      // End game
      endGameForRoom(room);
    } else {
      // Progress to next drawer
      setTimeout(() => {
        progressToNextDrawer(room);
      }, 3000); // 3 second delay before next round
    }
  }

  /**
   * Handle player leaving during an active game
   * Adjusts game state, ends game if only 1 player remains
   */
  function handlePlayerLeaveDuringGame(room, leavingPlayerId) {
    if (!room.game || room.status !== gameEngine.ROOM_STATUS.IN_GAME) {
      return;
    }

    const game = room.game;
    const remainingPlayers = room.players.length;

    // If only 1 player remains, end the game immediately
    if (remainingPlayers <= 1) {
      console.log(`[GAME] Ending game early: ${room.id} | Only ${remainingPlayers} player(s) remaining`);
      
      // Stop any active timers
      timerEngine.stopTimer(room.id);
      
      // Award final drawer score if applicable
      if (game.drawerId && game.phase === gameEngine.PHASES.DRAWING) {
        scoreEngine.awardDrawerScore(
          room,
          playerManager.getPlayerById,
          playerManager.updatePlayerScore
        );
      }
      
      // End the game
      endGameForRoom(room);
      return;
    }

    // Adjust drawerIndex if the leaving player was before current drawer in rotation
    // Find the index of the leaving player in the original rotation
    // Since players array has already been updated, we need to check if drawerIndex needs adjustment
    const currentDrawerId = game.drawerId;
    const currentDrawerIndex = room.players.indexOf(currentDrawerId);
    
    // If current drawer is not found in players (shouldn't happen, but safety check)
    if (currentDrawerIndex === -1) {
      // Reset to first player
      game.drawerIndex = 0;
      game.drawerId = room.players[0];
    } else {
      // Update drawerIndex to match current position in updated players array
      game.drawerIndex = currentDrawerIndex;
    }

    // Remove leaving player from guessed players if they had guessed
    if (game.guessedPlayers && game.guessedPlayers.includes(leavingPlayerId)) {
      game.guessedPlayers = game.guessedPlayers.filter(id => id !== leavingPlayerId);
    }

    // If the leaving player was the current drawer, we need to move to next drawer
    if (leavingPlayerId === currentDrawerId) {
      console.log(`[GAME] Current drawer left: ${room.id} | Moving to next drawer`);
      // End current round and move to next drawer
      endRoundForRoom(room);
    } else {
      // Just update the game state and broadcast
      broadcastToRoom(room.id, 'game_started', {
        game: serializeGameState(room),
        room: roomManager.serializeRoom(room, playerManager.getPlayerById),
        players: roomManager.serializeRoom(room, playerManager.getPlayerById).players
      });
    }
  }

  /**
   * Progress to next drawer
   */
  function progressToNextDrawer(room) {
    // Update drawer score for previous round before moving to next drawer
    if (room.game && room.game.drawerId) {
      scoreEngine.awardDrawerScore(
        room,
        playerManager.getPlayerById,
        playerManager.updatePlayerScore
      );
      
      // Broadcast updated leaderboard with drawer score
      const leaderboard = scoreEngine.getLeaderboard(room, playerManager.getPlayerById);
      broadcastToRoom(room.id, 'leaderboard_update', {
        leaderboard: leaderboard
      });
    }
    
    const result = gameEngine.progressToNextDrawer(room);
    if (result.success) {
      // Start new round
      startRoundForRoom(room);
    } else {
      console.error(`[GAME] Failed to progress drawer: ${room.id} | Error: ${result.error}`);
    }
  }

  /**
   * End game and show final results
   */
  function endGameForRoom(room) {
    // Stop any active timers
    timerEngine.stopTimer(room.id);

    // End game
    const result = gameEngine.endGame(room);
    if (!result.success) {
      console.error(`[GAME] Failed to end game: ${room.id} | Error: ${result.error}`);
      return;
    }

    // Get final leaderboard
    const leaderboard = scoreEngine.getLeaderboard(room, playerManager.getPlayerById);

    // Broadcast game ended
    broadcastToRoom(room.id, 'game_ended', {
      roundsPlayed: result.roundsPlayed,
      leaderboard: leaderboard
    });

    // Clear game state
    wordEngine.clearWordSelection(room);
    drawingEngine.clearDrawingState(room.id);
    scoreEngine.clearRoundScoring(room.id);
  }

  // =============================================================================
  // DRAWING HANDLERS (MODULE 8)
  // =============================================================================

  socket.on('draw_start', (payload) => {
    const player = playerManager.getPlayer(socket.id);
    if (!player || !player.roomId) {
      socket.emit('game_error', { error: 'Not in a room' });
      return;
    }

    const room = roomManager.getRoom(player.roomId);
    if (!room) {
      socket.emit('game_error', { error: 'Room not found' });
      return;
    }

    const result = drawingEngine.handleDrawStart(room, player.id, payload);
    if (result.success) {
      // Broadcast to guessers only (not drawer)
      const drawerId = room.game.drawerId;
      room.players.forEach(playerId => {
        if (playerId !== drawerId) {
          const guesser = playerManager.getPlayerById(playerId);
          if (guesser && guesser.socketId) {
            io.to(guesser.socketId).emit('draw_start', result.data);
          }
        }
      });
    } else {
      socket.emit('game_error', { error: result.error });
    }
  });

  socket.on('draw_move', (payload) => {
    const player = playerManager.getPlayer(socket.id);
    if (!player || !player.roomId) {
      return; // Silently ignore if not in room
    }

    const room = roomManager.getRoom(player.roomId);
    if (!room) {
      return;
    }

    const result = drawingEngine.handleDrawMove(room, player.id, payload);
    if (result.success) {
      if (result.shouldBatch) {
        // Event was batched, will be sent when batch is flushed
        // Flush batch periodically (every 50ms)
        setTimeout(() => {
          const batch = drawingEngine.flushBatch(room.id);
          if (batch && batch.length > 0) {
            const drawerId = room.game.drawerId;
            room.players.forEach(playerId => {
              if (playerId !== drawerId) {
                const guesser = playerManager.getPlayerById(playerId);
                if (guesser && guesser.socketId) {
                  io.to(guesser.socketId).emit('draw_move', batch);
                }
              }
            });
          }
        }, drawingEngine.BATCH_WINDOW_MS);
        return;
      }

      // Broadcast to guessers only (not drawer)
      const drawerId = room.game.drawerId;
      room.players.forEach(playerId => {
        if (playerId !== drawerId) {
          const guesser = playerManager.getPlayerById(playerId);
          if (guesser && guesser.socketId) {
            // Send batched or single event
            io.to(guesser.socketId).emit('draw_move', Array.isArray(result.data) ? result.data : [result.data]);
          }
        }
      });
    }
  });

  socket.on('draw_end', (payload) => {
    const player = playerManager.getPlayer(socket.id);
    if (!player || !player.roomId) {
      return;
    }

    const room = roomManager.getRoom(player.roomId);
    if (!room) {
      return;
    }

    const result = drawingEngine.handleDrawEnd(room, player.id, payload);
    if (result.success) {
      // Broadcast to guessers only (not drawer)
      const drawerId = room.game.drawerId;
      room.players.forEach(playerId => {
        if (playerId !== drawerId) {
          const guesser = playerManager.getPlayerById(playerId);
          if (guesser && guesser.socketId) {
            io.to(guesser.socketId).emit('draw_end', result.data);
          }
        }
      });
    }
  });

  socket.on('clear_canvas', () => {
    const player = playerManager.getPlayer(socket.id);
    if (!player || !player.roomId) {
      socket.emit('game_error', { error: 'Not in a room' });
      return;
    }

    const room = roomManager.getRoom(player.roomId);
    if (!room) {
      socket.emit('game_error', { error: 'Room not found' });
      return;
    }

    const result = drawingEngine.handleClearCanvas(room, player.id);
    if (result.success) {
      // Broadcast to guessers only (not drawer)
      const drawerId = room.game.drawerId;
      room.players.forEach(playerId => {
        if (playerId !== drawerId) {
          const guesser = playerManager.getPlayerById(playerId);
          if (guesser && guesser.socketId) {
            io.to(guesser.socketId).emit('clear_canvas');
          }
        }
      });
    } else {
      socket.emit('game_error', { error: result.error });
    }
  });

  // =============================================================================
  // GUESS HANDLERS (MODULE 9)
  // =============================================================================

  socket.on('guess', (payload) => {
    const player = playerManager.getPlayer(socket.id);
    if (!player) {
      socket.emit('game_error', { error: 'Player not found' });
      return;
    }

    if (!player.roomId) {
      socket.emit('game_error', { error: 'Not in a room' });
      return;
    }

    const room = roomManager.getRoom(player.roomId);
    if (!room) {
      socket.emit('game_error', { error: 'Room not found' });
      return;
    }

    // Validate payload
    if (!payload || typeof payload !== 'object' || typeof payload.guess !== 'string') {
      socket.emit('game_error', { error: 'Invalid guess format' });
      return;
    }

    const { guess } = payload;
    const guessTimestamp = Date.now();

    // Validate guess
    const result = guessEngine.validateGuess(room, player.id, guess);
    if (!result.success) {
      socket.emit('game_error', { error: result.error });
      return;
    }

    // Broadcast guess as chat message
    // If correct: will be replaced by correct_guess event
    // If incorrect: show as regular chat message (unmasked)
    const normalizedGuess = guessEngine.normalizeGuess(guess);
    
    if (!result.isCorrect) {
      // Show incorrect guesses as regular chat messages (unmasked)
      broadcastToRoom(room.id, 'chat_message', {
        playerId: player.id,
        playerName: player.name,
        message: normalizedGuess,
        isCorrect: false
      });
    }
    // Correct guesses are handled below and will show "✔️ guessed the word!"

    if (result.isCorrect) {
      // Award score
      const scoreResult = scoreEngine.awardGuessScore(
        room,
        player.id,
        guessTimestamp,
        playerManager.getPlayerById,
        playerManager.updatePlayerScore
      );

      if (scoreResult.success) {
        // Update drawer score instantly when someone guesses correctly
        const drawerScoreResult = scoreEngine.updateDrawerScoreForGuess(room, playerManager.getPlayerById, playerManager.updatePlayerScore);
        
        // Broadcast correct guess
        broadcastToRoom(room.id, 'correct_guess', {
          playerId: player.id,
          playerName: player.name,
          word: wordEngine.getSelectedWord(room), // Reveal word
          score: scoreResult.score,
          totalScore: scoreResult.totalScore
        });

        // Update leaderboard (includes updated drawer score)
        const leaderboard = scoreEngine.getLeaderboard(room, playerManager.getPlayerById);
        broadcastToRoom(room.id, 'leaderboard_update', {
          leaderboard: leaderboard
        });

        // Check if all guessers have guessed
        if (guessEngine.allGuessersGuessed(room)) {
          // End round early
          endRoundForRoom(room);
        }
      }
    }
  });

  // =============================================================================
  // GAME REPLAY HANDLER (MODULE 11)
  // =============================================================================

  socket.on('play_again', () => {
    const player = playerManager.getPlayer(socket.id);
    if (!player) {
      socket.emit('game_error', { error: 'Player not found' });
      return;
    }

    if (!player.roomId) {
      socket.emit('game_error', { error: 'Not in a room' });
      return;
    }

    const room = roomManager.getRoom(player.roomId);
    if (!room) {
      socket.emit('game_error', { error: 'Room not found' });
      return;
    }

    // Check if player is room owner
    if (room.ownerId !== player.id) {
      socket.emit('game_error', { error: 'Only room owner can start a new game' });
      return;
    }

    // Check if game is finished
    if (room.status !== gameEngine.ROOM_STATUS.FINISHED) {
      socket.emit('game_error', { error: 'Game is not finished' });
      return;
    }

    // Reset game state back to lobby-style "waiting" as per authority model:
    // backend decides when a game exists, frontend only reflects state.
    const result = gameEngine.resetGame(room);
    if (result.success) {
      // Reset player scores for a fresh scoreboard next time the game starts
      playerManager.resetPlayerScores(room.players);

      // Re‑serialize room so clients see updated status/scores in lobby
      const serializedRoom = roomManager.serializeRoom(
        room,
        playerManager.getPlayerById
      );

      // Keep general room listeners in sync (owner, settings, status)
      broadcastRoomUpdate(room.id);

      // Notify clients that game state has been cleared and lobby is ready
      broadcastToRoom(room.id, 'game_reset', {
        room: serializedRoom
      });
    } else {
      socket.emit('game_error', { error: result.error });
    }
  });

  // =============================================================================
  // SOCKET DISCONNECTION HANDLER
  // =============================================================================

  // Listen for socket disconnection events
  // Reason parameter helps diagnose connection issues (e.g., 'transport close', 'client namespace disconnect')
  socket.on('disconnect', (reason) => {
    console.log(`[DISCONNECT] Socket disconnected: ${socket.id} | Reason: ${reason}`);
    
    const player = playerManager.getPlayer(socket.id);
    if (player && player.roomId) {
      // Player was in a room, remove them
      const roomId = player.roomId;
      const room = roomManager.getRoom(roomId);
      
      // Check if game is active
      const wasInGame = room && room.status === gameEngine.ROOM_STATUS.IN_GAME;
      
      const result = roomManager.leaveRoom(player.id, roomId);

      if (result.success && !result.deleted) {
        // Room still exists
        const updatedRoom = roomManager.getRoom(roomId);
        
        // If game was active, handle player leaving during game
        if (wasInGame && updatedRoom && updatedRoom.game) {
          handlePlayerLeaveDuringGame(updatedRoom, player.id);
        }
        
        // Broadcast update to remaining players
        broadcastRoomUpdate(roomId);
      }
    }

    // Remove player from memory
    // This function handles cases where player might not exist gracefully
    playerManager.removePlayer(socket.id);
  });

  // =============================================================================
  // SOCKET ERROR HANDLER
  // =============================================================================

  // Catch socket-level errors to prevent server crashes
  // Errors might include malformed packets, connection issues, etc.
  socket.on('error', (error) => {
    console.error(`[ERROR] Socket error for ${socket.id}:`, error.message);
  });
});


// Start the HTTP server and listen on the configured port
// Error handling ensures graceful failure with clear error messages
server.listen(PORT, (error) => {
  if (error) {
    console.error('[STARTUP ERROR] Failed to start server:', error.message);
    process.exit(1); // Exit with error code
  }
  
  console.log(`[SERVER] Backend server running on port ${PORT}`);
  console.log(`[SERVER] Socket.IO ready for connections`);
});


// Handle process termination signals for graceful shutdown
// This ensures connections are properly closed before the process exits
const gracefulShutdown = (signal) => {
  console.log(`\n[SHUTDOWN] Received ${signal}, closing server gracefully...`);
  
  server.close(() => {
    console.log('[SHUTDOWN] HTTP server closed');
    io.close(() => {
      console.log('[SHUTDOWN] Socket.IO server closed');
      process.exit(0);
    });
  });

  // Force shutdown after 10 seconds if graceful shutdown hangs
  setTimeout(() => {
    console.error('[SHUTDOWN] Forced shutdown after timeout');
    process.exit(1);
  }, 10000);
};

// Listen for termination signals
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));


// Catch unhandled promise rejections to prevent silent failures
process.on('unhandledRejection', (reason, promise) => {
  console.error('[UNHANDLED REJECTION]', reason);
});

// Catch uncaught exceptions as a last resort
process.on('uncaughtException', (error) => {
  console.error('[UNCAUGHT EXCEPTION]', error);
  process.exit(1);
});