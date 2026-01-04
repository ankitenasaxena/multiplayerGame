// ========== GLOBAL STATE ==========
        const STATE = {
            socket: null,
            socketId: null,
            playerId: null,
            playerName: null,
            currentScreen: 'connect',
            room: null,
            isRoomOwner: false,
            game: null,
            isDrawer: false,
            canDraw: false,
            selectedWord: null,
            gameChat: [],
            gameLeaderboard: [],
            timerRemaining: 0,
            timerType: null,
            hasGuessed: false,
            roundEnded: false,
            gameEnded: false,
            drawingInProgress: false,
            drawingTool: 'pen' // 'pen' or 'eraser'
        };

        let canvas, ctx;
        const colors = ['#000000', '#FFFFFF', '#FF0000', '#00FF00', '#0000FF', '#FFFF00', '#FF8800', '#FF00FF'];

        // ========== SOCKET INITIALIZATION ==========
        function initSocket() {
            // Connect to backend server
            // If opened via file:// protocol, default to localhost:3000
            // Otherwise use the current origin (if served by backend) or localhost:3000
            let serverUrl = 'http://localhost:3000';
            
            if (window.location.protocol === 'http:' || window.location.protocol === 'https:') {
                // If served via HTTP/HTTPS, check if we're on localhost
                if (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1') {
                    // If already on localhost, use the same port or default to 3000
                    const port = window.location.port || '3000';
                    serverUrl = `http://${window.location.hostname}:${port}`;
                } else {
                    // If on a different host, use the current origin
                    serverUrl = window.location.origin;
                }
            }
            // If file:// protocol, serverUrl remains http://localhost:3000
            
            console.log('[SOCKET] Connecting to:', serverUrl);
            STATE.socket = io(serverUrl, {
                reconnection: true,
                reconnectionDelay: 1000,
                reconnectionDelayMax: 5000,
                reconnectionAttempts: 5
            });

            STATE.socket.on('connect', () => {
                STATE.socketId = STATE.socket.id;
                showScreen('playerName');
            });

            STATE.socket.on('player_updated', (data) => {
                STATE.playerId = data.id;
                STATE.playerName = data.name;
            });

            STATE.socket.on('room_created', (data) => {
                STATE.room = data.room;
                STATE.isRoomOwner = true;
                STATE.game = null;
                showScreen('lobby');
                updateLobbyUI();
            });

            STATE.socket.on('room_joined', (data) => {
                STATE.room = data.room;
                STATE.isRoomOwner = data.room.ownerId === STATE.playerId;
                STATE.game = null;
                showScreen('lobby');
                updateLobbyUI();
            });

            STATE.socket.on('room_updated', (data) => {
                STATE.room = data.room;
                updateLobbyUI();
            });

            STATE.socket.on('room_settings_updated', (data) => {
                STATE.room = data.room;
                updateSettingsUI();
            });

            STATE.socket.on('room_left', () => {
                showScreen('home');
                STATE.room = null;
                STATE.isRoomOwner = false;
            });

            STATE.socket.on('room_error', (data) => {
                showError(data.message);
            });

            STATE.socket.on('game_error', (data) => {
                showError(data.error || data.message || 'Game error occurred');
            });

            STATE.socket.on('game_started', (data) => {
                STATE.game = data.game;
                STATE.room = data.room;
                STATE.gameChat = [];
                STATE.gameLeaderboard = data.players || [];
                STATE.hasGuessed = false;
                STATE.roundEnded = false;
                STATE.gameEnded = false;
                STATE.isDrawer = data.game.drawerId === STATE.playerId;
                STATE.canDraw = STATE.isDrawer;
                STATE.selectedWord = null;
                showScreen('game');
                updateGameUI();
                handleGamePhase();
            });

            STATE.socket.on('word_options', (data) => {
                // Update game state with latest from server (includes updated drawerId)
                if (data.game) {
                    STATE.game = { ...STATE.game, ...data.game };
                }
                // Recalculate drawer status based on updated game state
                STATE.isDrawer = STATE.game.drawerId === STATE.playerId;
                STATE.canDraw = false; // Lock until word is selected
                updateWordSelection(data.options);
                handleGamePhase();
            });


            STATE.socket.on('word_selected', (data) => {
                // Update game state with latest from server (includes updated drawerId)
                if (data.game) {
                    STATE.game = { ...STATE.game, ...data.game };
                }
                STATE.game.maskedWord = data.maskedWord;
                STATE.game.phase = 'drawing';

                // Recalculate drawer status based on updated game state
                STATE.isDrawer = STATE.game.drawerId === STATE.playerId;
                STATE.canDraw = STATE.isDrawer;

                handleGamePhase();
                // Re-initialize canvas with correct permissions
                setTimeout(initCanvas, 0);
            });



            STATE.socket.on('drawing_started', (data) => {
                // Update game state with latest from server
                if (data.game) {
                    STATE.game = { ...STATE.game, ...data.game };
                }
                // Recalculate drawer status based on updated game state
                STATE.isDrawer = STATE.game.drawerId === STATE.playerId;
                STATE.canDraw = STATE.isDrawer;
                
                if (STATE.isDrawer) {
                    STATE.selectedWord = data.word;
                }
                updateGameUI();
                resetCanvasDisplay();
                // Re-initialize canvas with correct permissions
                setTimeout(initCanvas, 0);
            });

            STATE.socket.on('draw_start', (data) => {
                if (!STATE.isDrawer && ctx) {
                    ctx.beginPath();
                    ctx.moveTo(data.x, data.y);
                    const isEraser = data.tool === 'eraser' || data.color === 'eraser';
                    if (isEraser) {
                        ctx.globalCompositeOperation = 'destination-out';
                        ctx.strokeStyle = 'rgba(0,0,0,1)';
                    } else {
                        ctx.globalCompositeOperation = 'source-over';
                        ctx.strokeStyle = data.color;
                    }
                    ctx.lineWidth = data.lineWidth;
                }
            });

            STATE.socket.on('draw_move', (data) => {
                if (!STATE.isDrawer && ctx) {
                    const events = Array.isArray(data) ? data : [data];
                    events.forEach(evt => {
                        const isEraser = evt.tool === 'eraser' || evt.color === 'eraser';
                        if (isEraser) {
                            ctx.globalCompositeOperation = 'destination-out';
                            ctx.strokeStyle = 'rgba(0,0,0,1)';
                        } else {
                            ctx.globalCompositeOperation = 'source-over';
                            ctx.strokeStyle = evt.color;
                        }
                        ctx.lineWidth = evt.lineWidth;
                        ctx.lineTo(evt.x, evt.y);
                        ctx.stroke();
                    });
                }
            });

            STATE.socket.on('draw_end', (data) => {
                if (!STATE.isDrawer && ctx) {
                    ctx.closePath();
                }
            });

            STATE.socket.on('clear_canvas', () => {
                if (!STATE.isDrawer && ctx) {
                    ctx.clearRect(0, 0, canvas.width, canvas.height);
                }
            });

            STATE.socket.on('timer_tick', (data) => {
                STATE.timerRemaining = data.remaining;
                STATE.timerType = data.type;
                updateTimer();
            });

            STATE.socket.on('hint_update', (data) => {
                if (data.hintWord && !STATE.isDrawer) {
                    STATE.game.maskedWord = data.hintWord;
                    updateMaskedWordDisplay();
                }
            });

            STATE.socket.on('chat_message', (data) => {
                STATE.gameChat.push({
                    playerName: data.playerName,
                    message: data.message,
                    isCorrect: data.isCorrect
                });
                updateGameChat();
            });

            STATE.socket.on('correct_guess', (data) => {
                STATE.gameChat.push({
                    playerName: data.playerName,
                    message: `✔️ guessed the word! (+${data.score})`,
                    isCorrect: true
                });
                updateGameChat();
                if (data.leaderboard) {
                    STATE.gameLeaderboard = data.leaderboard;
                    updateGameLeaderboard();
                }
                
                // Play sound only for the player who guessed correctly
                if (data.playerId === STATE.playerId) {
                    playCorrectGuessSound();
                }

            });

            STATE.socket.on('leaderboard_update', (data) => {
                STATE.gameLeaderboard = data.leaderboard || [];
                updateGameLeaderboard();
            });

            STATE.socket.on('round_ended', (data) => {
                // Update game state with latest from server (includes new drawerId for next round)
                if (data.game) {
                    STATE.game = { ...STATE.game, ...data.game };
                }
                // Recalculate drawer status based on updated game state
                STATE.isDrawer = STATE.game.drawerId === STATE.playerId;
                STATE.canDraw = false; // IMPORTANT: lock until word_selected

                STATE.hasGuessed = false;
                STATE.selectedWord = null;
                STATE.game.maskedWord = null;

                if (data.roundCompleted) {
                    showScreen('roundEnd');
                    updateRoundEndUI(data);
                } else {
                    showScreen('game');
                }
            });




            STATE.socket.on('game_ended', (data) => {
                STATE.gameEnded = true;
                showScreen('gameEnd');
                updateGameEndUI(data);
            });

            STATE.socket.on('game_reset', (data) => {
                // Reset all game state
                STATE.room = data.room;
                STATE.game = null;
                STATE.gameChat = [];
                STATE.gameLeaderboard = data.room.players || [];
                STATE.hasGuessed = false;
                STATE.roundEnded = false;
                STATE.gameEnded = false;
                STATE.isDrawer = false;
                STATE.canDraw = false;
                STATE.selectedWord = null;
                STATE.isRoomOwner = data.room.ownerId === STATE.playerId;
                
                // Return to lobby screen
                showScreen('lobby');
                updateLobbyUI();
            });
        }

        // ========== UI HELPERS ==========
        function showScreen(screenName) {
            // Hide all screens first - remove active class and set display to none
            document.querySelectorAll('.screen').forEach(el => {
                el.classList.remove('active');
                el.style.display = 'none';
            });
            
            // Remove home-screen-active class from body
            document.body.classList.remove('home-screen-active');
            
            const screenMap = {
                'connect': 'connectScreen',
                'playerName': 'playerNameScreen',
                'home': 'homeScreen',
                'scribble': 'scribbleScreen',
                'lobby': 'lobbyScreen',
                'game': 'gameScreen',
                'roundEnd': 'roundEndScreen',
                'gameEnd': 'gameEndScreen'
            };
            
            const screen = document.getElementById(screenMap[screenName]);
            if (screen) {
                screen.classList.add('active');
                screen.style.display = 'block';
                
                // Add class to body when home screen is shown
                if (screenName === 'home') {
                    document.body.classList.add('home-screen-active');
                }
            } else {
                console.error(`Screen not found: ${screenName} (${screenMap[screenName]})`);
            }
            STATE.currentScreen = screenName;

            if (screenName === 'game' && STATE.canDraw) {
                setTimeout(initCanvas, 0);
            }
        }

        function showError(msg) {
            const err = document.createElement('div');
            err.className = 'error';
            err.textContent = msg;
            const activeScreen = document.querySelector('.screen.active');
            if (activeScreen) {
                activeScreen.insertBefore(err, activeScreen.firstChild);
                setTimeout(() => err.remove(), 3000);
            }
        }

        // ========== CANVAS SETUP ==========
        function initCanvas() {
            canvas = document.getElementById('canvas');
            if (!canvas) return;

            // HARD reset canvas to remove old listeners
            const newCanvas = canvas.cloneNode(true);
            canvas.parentNode.replaceChild(newCanvas, canvas);
            canvas = newCanvas;

            ctx = canvas.getContext('2d');

            // Proper sizing
            const rect = canvas.getBoundingClientRect();
            canvas.width = rect.width;
            canvas.height = 500;

            // Disable canvas if not drawer
            if (!STATE.canDraw) {
                canvas.classList.add('disabled');
                return;
            }

            canvas.classList.remove('disabled');

            // Mouse events
            canvas.addEventListener('mousedown', startDrawing);
            canvas.addEventListener('mousemove', draw);
            canvas.addEventListener('mouseup', stopDrawing);
            canvas.addEventListener('mouseout', stopDrawing);

            // Touch events
            canvas.addEventListener('touchstart', handleTouchStart, { passive: false });
            canvas.addEventListener('touchmove', handleTouchMove, { passive: false });
            canvas.addEventListener('touchend', stopDrawing);
        }


        let isDrawing = false;
        let lastX = 0, lastY = 0;
        let drawEvents = [];

        function startDrawing(e) {
            if (!STATE.canDraw) return;
            isDrawing = true;
            const rect = canvas.getBoundingClientRect();
            lastX = e.clientX - rect.left;
            lastY = e.clientY - rect.top;
            drawEvents = [];

            const lineWidth = parseInt(document.getElementById('lineWidth').value);
            const isEraser = STATE.drawingTool === 'eraser';
            
            if (isEraser) {
                // Eraser mode: use destination-out composite
                ctx.globalCompositeOperation = 'destination-out';
                ctx.strokeStyle = 'rgba(0,0,0,1)'; // Full opacity for eraser
            } else {
                // Pen mode: normal drawing
                ctx.globalCompositeOperation = 'source-over';
                const colorBtn = document.querySelector('.color-btn.active');
                ctx.strokeStyle = colorBtn ? colorBtn.style.backgroundColor : '#000000';
            }
            
            ctx.lineWidth = lineWidth;

            STATE.socket.emit('draw_start', {
                x: lastX,
                y: lastY,
                color: isEraser ? 'eraser' : ctx.strokeStyle,
                lineWidth: lineWidth,
                tool: STATE.drawingTool
            });

            ctx.beginPath();
            ctx.moveTo(lastX, lastY);
        }

        function draw(e) {
            if (!isDrawing || !STATE.canDraw) return;
            const rect = canvas.getBoundingClientRect();
            const x = e.clientX - rect.left;
            const y = e.clientY - rect.top;

            const lineWidth = parseInt(document.getElementById('lineWidth').value);
            const isEraser = STATE.drawingTool === 'eraser';
            
            if (isEraser) {
                ctx.globalCompositeOperation = 'destination-out';
                ctx.strokeStyle = 'rgba(0,0,0,1)';
            } else {
                ctx.globalCompositeOperation = 'source-over';
                const colorBtn = document.querySelector('.color-btn.active');
                ctx.strokeStyle = colorBtn ? colorBtn.style.backgroundColor : '#000000';
            }
            
            ctx.lineWidth = lineWidth;

            ctx.lineTo(x, y);
            ctx.stroke();

            drawEvents.push({ 
                x, 
                y, 
                color: isEraser ? 'eraser' : ctx.strokeStyle, 
                lineWidth,
                tool: STATE.drawingTool
            });

            if (drawEvents.length >= 5) {
                STATE.socket.emit('draw_move', drawEvents);
                drawEvents = [];
            }
        }

        function stopDrawing() {
            if (!isDrawing) return;
            isDrawing = false;
            if (drawEvents.length > 0) {
                STATE.socket.emit('draw_move', drawEvents);
                drawEvents = [];
            }
            STATE.socket.emit('draw_end', {});
        }

        function handleTouchStart(e) {
            if (!STATE.canDraw) return;
            const touch = e.touches[0];
            const rect = canvas.getBoundingClientRect();
            lastX = touch.clientX - rect.left;
            lastY = touch.clientY - rect.top;
            isDrawing = true;
            drawEvents = [];

            const lineWidth = parseInt(document.getElementById('lineWidth').value);
            const isEraser = STATE.drawingTool === 'eraser';
            
            if (isEraser) {
                ctx.globalCompositeOperation = 'destination-out';
                ctx.strokeStyle = 'rgba(0,0,0,1)';
            } else {
                ctx.globalCompositeOperation = 'source-over';
                const colorBtn = document.querySelector('.color-btn.active');
                ctx.strokeStyle = colorBtn ? colorBtn.style.backgroundColor : '#000000';
            }
            
            ctx.lineWidth = lineWidth;

            ctx.beginPath();
            ctx.moveTo(lastX, lastY);

            STATE.socket.emit('draw_start', { 
                x: lastX, 
                y: lastY, 
                color: isEraser ? 'eraser' : ctx.strokeStyle, 
                lineWidth,
                tool: STATE.drawingTool
            });
        }

        function handleTouchMove(e) {
            if (!isDrawing || !STATE.canDraw) return;
            e.preventDefault();
            const touch = e.touches[0];
            const rect = canvas.getBoundingClientRect();
            const x = touch.clientX - rect.left;
            const y = touch.clientY - rect.top;

            const lineWidth = parseInt(document.getElementById('lineWidth').value);
            const isEraser = STATE.drawingTool === 'eraser';
            
            if (isEraser) {
                ctx.globalCompositeOperation = 'destination-out';
                ctx.strokeStyle = 'rgba(0,0,0,1)';
            } else {
                ctx.globalCompositeOperation = 'source-over';
                const colorBtn = document.querySelector('.color-btn.active');
                ctx.strokeStyle = colorBtn ? colorBtn.style.backgroundColor : '#000000';
            }
            
            ctx.lineWidth = lineWidth;

            ctx.lineTo(x, y);
            ctx.stroke();
            drawEvents.push({ 
                x, 
                y, 
                color: isEraser ? 'eraser' : ctx.strokeStyle, 
                lineWidth,
                tool: STATE.drawingTool
            });

            if (drawEvents.length >= 5) {
                STATE.socket.emit('draw_move', drawEvents);
                drawEvents = [];
            }
        }

        function resetCanvasDisplay() {
            if (!ctx || !canvas) return;
            ctx.clearRect(0, 0, canvas.width, canvas.height);
        }

        // ========== APP ACTIONS ==========
        const app = {
            submitPlayerName() {
                const input = document.getElementById('playerNameInput');
                const name = input.value.trim();
                if (!name) {
                    showError('Please enter a name');
                    return;
                }
                STATE.socket.emit('set_player_name', { name });
                showScreen('home');
            },

            openScribble() {
                showScreen('scribble');
            },

            backToGames() {
                showScreen('home');
            },

            goToCreateRoom() {
                const dialog = document.createElement('div');
                dialog.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.5);display:flex;align-items:center;justify-content:center;z-index:1000;';
                dialog.innerHTML = `
          <div style="background:white;padding:40px;border-radius:12px;max-width:400px;width:90%;">
            <h2 style="margin-bottom:20px;color:#333;">Create Room</h2>
            <div class="form-group">
              <label style="display:block;margin-bottom:8px;color:#333;font-weight:500;">Max Players</label>
              <select id="maxPlayers" style="width:100%;padding:10px;border:2px solid #ddd;border-radius:6px;">
                <option value="2">2</option>
                <option value="4">4</option>
                <option value="6">6</option>
                <option value="8" selected>8</option>
              </select>
            </div>
            <div class="form-group">
              <label style="display:block;margin-bottom:8px;color:#333;font-weight:500;">Draw Time (seconds)</label>
              <input type="number" id="drawTime" value="80" min="30" max="300" style="width:100%;padding:10px;border:2px solid #ddd;border-radius:6px;">
            </div>
            <div class="form-group">
              <label style="display:block;margin-bottom:8px;color:#333;font-weight:500;">Rounds</label>
              <input type="number" id="rounds" value="3" min="1" max="10" style="width:100%;padding:10px;border:2px solid #ddd;border-radius:6px;">
            </div>
            <div class="form-group">
              <label style="display:flex;align-items:center;gap:8px;color:#333;font-weight:500;cursor:pointer;">
                <input type="checkbox" id="enableHints" checked style="width:18px;height:18px;cursor:pointer;">
                <span>Enable Hints</span>
              </label>
            </div>
            <div style="display:flex;gap:10px;margin-top:20px;">
              <button style="flex:1;background:#667eea;padding:12px;color:white;border:none;border-radius:6px;cursor:pointer;font-weight:600;" onclick="app.createRoom();this.closest('[style*=position]').remove();">Create</button>
              <button style="flex:1;background:#764ba2;padding:12px;color:white;border:none;border-radius:6px;cursor:pointer;font-weight:600;" onclick="this.closest('[style*=position]').remove();">Cancel</button>
            </div>
          </div>
        `;
                document.body.appendChild(dialog);
            },

            createRoom() {
                const maxPlayers = parseInt(document.getElementById('maxPlayers').value);
                const drawTime = parseInt(document.getElementById('drawTime').value);
                const rounds = parseInt(document.getElementById('rounds').value);
                const hints = document.getElementById('enableHints').checked;

                STATE.socket.emit('create_room', {
                    settings: {
                        maxPlayers,
                        drawTime,
                        rounds,
                        hints: hints,
                        customWords: []
                    }
                });
            },

            toggleJoinSection() {
                const section = document.getElementById('joinSection');
                section.style.display = section.style.display === 'none' ? 'block' : 'none';
            },

            joinRoom() {
                const roomId = document.getElementById('roomIdInput').value.trim().toUpperCase();
                if (!roomId) {
                    showError('Please enter a room code');
                    return;
                }
                STATE.socket.emit('join_room', { roomId });
            },

            leaveRoom() {
                STATE.socket.emit('leave_room');
            },

            startGame() {
                STATE.socket.emit('start_game');
            },

            selectWord(word, el) {
                document.querySelectorAll('.word-option').forEach(e => e.classList.remove('selected'));
                el.classList.add('selected');
                STATE.socket.emit('select_word', { word });
            },

            selectTool(tool) {
                STATE.drawingTool = tool;
                // Update UI
                document.querySelectorAll('.tool-btn').forEach(btn => btn.classList.remove('active'));
                if (tool === 'pen') {
                    document.getElementById('penTool').classList.add('active');
                } else if (tool === 'eraser') {
                    document.getElementById('eraserTool').classList.add('active');
                }
            },


            clearCanvas() {
                if (!ctx || !STATE.canDraw) return;
                ctx.clearRect(0, 0, canvas.width, canvas.height);
                STATE.socket.emit('clear_canvas', {});
            },

            submitGuess() {
                if (STATE.isDrawer) return;
                const input = document.getElementById('guessInput');
                const guess = input.value.trim();
                if (!guess) return;
                // Keep input enabled so players can keep guessing
                STATE.socket.emit('guess', { guess });
                input.value = '';
            },

            playAgain() {
                if (STATE.isRoomOwner) {
                    STATE.socket.emit('play_again');
                }
            },

            leaveRoomFromGame() {
                // Properly leave the room if in one
                if (STATE.room) {
                    STATE.socket.emit('leave_room');
                }
                // Reset all state
                STATE.room = null;
                STATE.game = null;
                STATE.isRoomOwner = false;
                STATE.gameChat = [];
                STATE.gameLeaderboard = [];
                STATE.hasGuessed = false;
                STATE.roundEnded = false;
                STATE.gameEnded = false;
                STATE.isDrawer = false;
                STATE.canDraw = false;
                STATE.selectedWord = null;
                showScreen('home');
            },

            goHome() {
                // Properly leave the room if in one
                if (STATE.room) {
                    STATE.socket.emit('leave_room');
                }
                // Reset all state
                STATE.room = null;
                STATE.game = null;
                STATE.isRoomOwner = false;
                STATE.gameChat = [];
                STATE.gameLeaderboard = [];
                STATE.hasGuessed = false;
                STATE.roundEnded = false;
                STATE.gameEnded = false;
                STATE.isDrawer = false;
                STATE.canDraw = false;
                STATE.selectedWord = null;
                showScreen('home');
            }
        };

        // ========== UI UPDATES ==========
        function updateLobbyUI() {
            document.getElementById('displayRoomCode').textContent = STATE.room.id;
            document.getElementById('playerCountDisplay').textContent = `${STATE.room.players.length}/${STATE.room.settings.maxPlayers} Players`;

            const playersList = document.getElementById('playersList');
            playersList.innerHTML = STATE.room.players.map(p => `
        <div class="player-item ${p.isOwner ? 'owner' : ''}">
          <div class="player-avatar">${p.name[0].toUpperCase()}</div>
          <div class="player-name">${p.name}</div>
          ${p.isOwner ? '<div class="owner-badge">Owner</div>' : ''}
        </div>
      `).join('');

            updateSettingsUI();

            const lobbyActions = document.getElementById('lobbyActions');
            if (STATE.isRoomOwner && STATE.room.players.length > 1) {
                lobbyActions.style.display = 'flex';
            } else {
                lobbyActions.style.display = 'none';
            }
        }

        function updateSettingsUI() {
            const s = STATE.room.settings;
            const settingsContainer = document.getElementById('settingsContainer');
            settingsContainer.innerHTML = `
        <div class="setting-item">
          <label>Max Players</label>
          <select ${!STATE.isRoomOwner ? 'disabled' : ''} onchange="STATE.room.settings.maxPlayers=this.value;updateRoomSettings()">
            <option value="2" ${s.maxPlayers == 2 ? 'selected' : ''}>2</option>
            <option value="4" ${s.maxPlayers == 4 ? 'selected' : ''}>4</option>
            <option value="6" ${s.maxPlayers == 6 ? 'selected' : ''}>6</option>
            <option value="8" ${s.maxPlayers == 8 ? 'selected' : ''}>8</option>
          </select>
        </div>
        <div class="setting-item">
          <label>Draw Time</label>
          <input type="number" value="${s.drawTime}" min="30" max="300" ${!STATE.isRoomOwner ? 'disabled' : ''} onchange="STATE.room.settings.drawTime=this.value;updateRoomSettings()">
        </div>
        <div class="setting-item">
          <label>Rounds</label>
          <input type="number" value="${s.rounds}" min="1" max="10" ${!STATE.isRoomOwner ? 'disabled' : ''} onchange="STATE.room.settings.rounds=this.value;updateRoomSettings()">
        </div>
        <div class="setting-item">
          <label style="display:flex;align-items:center;gap:8px;cursor:pointer;">
            <input type="checkbox" ${s.hints ? 'checked' : ''} ${!STATE.isRoomOwner ? 'disabled' : ''} onchange="STATE.room.settings.hints=this.checked;updateRoomSettings()" style="width:18px;height:18px;cursor:pointer;">
            <span>Enable Hints</span>
          </label>
        </div>
      `;
        }

        function updateRoomSettings() {
            if (!STATE.isRoomOwner) return;
            STATE.socket.emit('update_room_settings', { settings: STATE.room.settings });
        }

        function handleGamePhase() {
            const phase = STATE.game.phase;
            document.getElementById('wordSelectionPhase').style.display = phase === 'word_select' ? 'block' : 'none';
            document.getElementById('drawingPhase').style.display = phase === 'drawing' ? 'block' : 'none';

            if (phase === 'drawing') {
                updateMaskedWordDisplay();

                const input = document.getElementById('guessInput');
                const btn = input.parentElement.querySelector('button');

                if (STATE.isDrawer) {
                    input.disabled = true;
                    btn.disabled = true;
                    input.placeholder = 'You are drawing';
                } else {
                    input.disabled = false;
                    btn.disabled = false;
                    input.placeholder = 'Type your guess...';
                }
            }

        }

        function updateGameUI() {
            document.getElementById('currentRound').textContent = STATE.game.currentRound;
            document.getElementById('totalRounds').textContent = STATE.game.totalRounds;

            const drawerName = STATE.room.players.find(p => p.id === STATE.game.drawerId)?.name || 'Unknown';
            const drawerInfo = document.getElementById('drawerInfo');
            if (STATE.isDrawer) {
                drawerInfo.textContent = '🎨 You are drawing!';
            } else {
                drawerInfo.textContent = `${drawerName} is drawing`;
            }

            updateGameLeaderboard();
            initColorPicker();
            updateLineWidthDisplay();
        }

        function updateMaskedWordDisplay() {
            const display = document.getElementById('maskedWordDisplay');
            display.textContent = STATE.game.maskedWord || '_ _ _';
        }

        function updateGameLeaderboard() {
            const board = document.getElementById('gameLeaderboard');
            const sorted = [...STATE.gameLeaderboard].sort((a, b) => (b.score || 0) - (a.score || 0));
            board.innerHTML = sorted.map((p, i) => `
        <div class="leaderboard-item">
          <div class="rank">#${i + 1}</div>
          <div class="leaderboard-name">${p.name}</div>
          <div class="leaderboard-score">${p.score || 0}</div>
        </div>
      `).join('');
        }

        function updateGameChat() {
            const chat = document.getElementById('gameChat');
            chat.innerHTML = STATE.gameChat.map(msg => `
        <div class="chat-message ${msg.isCorrect ? 'correct' : 'normal'}">
          <span class="username">${msg.playerName}:</span> ${msg.message}
        </div>
      `).join('');
            chat.scrollTop = chat.scrollHeight;
        }

        function playCorrectGuessSound() {
            try {
                const audioContext = new (window.AudioContext || window.webkitAudioContext)();
                const oscillator = audioContext.createOscillator();
                const gainNode = audioContext.createGain();
                
                oscillator.connect(gainNode);
                gainNode.connect(audioContext.destination);
                
                // Create a pleasant success sound (ascending notes)
                const frequencies = [523.25, 659.25, 783.99]; // C, E, G (C major chord)
                let currentNote = 0;
                
                const playNote = (freq, startTime, duration) => {
                    const osc = audioContext.createOscillator();
                    const gain = audioContext.createGain();
                    
                    osc.type = 'sine';
                    osc.frequency.value = freq;
                    
                    gain.gain.setValueAtTime(0.3, startTime);
                    gain.gain.exponentialRampToValueAtTime(0.01, startTime + duration);
                    
                    osc.connect(gain);
                    gain.connect(audioContext.destination);
                    
                    osc.start(startTime);
                    osc.stop(startTime + duration);
                };
                
                // Play notes in sequence
                frequencies.forEach((freq, index) => {
                    playNote(freq, audioContext.currentTime + index * 0.1, 0.2);
                });
            } catch (error) {
                console.log('Could not play sound:', error);
            }
        }

        function updateTimer() {
            const timer = document.getElementById('gameTimer');
            timer.textContent = STATE.timerRemaining;
            timer.classList.toggle('warning', STATE.timerRemaining < 10);
        }

        function updateWordSelection(options) {
            const container = document.getElementById('wordOptionsContainer');
            container.innerHTML = '';
            options.forEach(word => {
                const div = document.createElement('div');
                div.className = 'word-option';
                div.textContent = word;
                div.onclick = () => app.selectWord(word, div);
                container.appendChild(div);
            });
        }


        function updateRoundEndUI(data) {
            document.getElementById('revealedWord').textContent = data.selectedWord;
            const leaderboard = document.getElementById('roundEndLeaderboard');
            const sorted = [...(data.leaderboard || [])].sort((a, b) => (b.score || 0) - (a.score || 0));
            leaderboard.innerHTML = sorted.map((p, i) => `
        <div class="round-end-item">
          <div class="rank">#${i + 1}</div>
          <div class="name">${p.name}</div>
          <div class="score">${p.score || 0}</div>
        </div>
      `).join('');
        }

        function updateGameEndUI(data) {
            const leaderboard = document.getElementById('finalLeaderboard');
            const sorted = [...(data.leaderboard || [])].sort((a, b) => (b.score || 0) - (a.score || 0));
            leaderboard.innerHTML = sorted.map((p, i) => `
        <div class="final-leaderboard-item ${i === 0 ? 'winner' : ''}">
          <div style="flex:1;text-align:left;">#${i + 1} ${p.name}</div>
          <div style="color:#27ae60;font-weight:600;">${p.score || 0} points</div>
        </div>
      `).join('');

            if (STATE.isRoomOwner) {
                document.getElementById('playAgainBtn').style.display = 'block';
            }
        }

        function initColorPicker() {
            const picker = document.getElementById('colorPicker');
            if (picker.children.length > 0) return;
            colors.forEach((color, i) => {
                const btn = document.createElement('button');
                btn.className = `color-btn ${i === 0 ? 'active' : ''}`;
                btn.style.backgroundColor = color;
                btn.style.border = '2px solid transparent';
                btn.style.width = '24px';
                btn.style.height = '24px';
                btn.style.borderRadius = '50%';
                btn.style.cursor = 'pointer';
                btn.style.transition = 'all 0.2s';
                btn.onclick = (e) => {
                    e.preventDefault();
                    document.querySelectorAll('.color-btn').forEach(b => b.classList.remove('active'));
                    btn.classList.add('active');
                };
                picker.appendChild(btn);
            });
        }

        function updateLineWidthDisplay() {
            const input = document.getElementById('lineWidth');
            const display = document.getElementById('sizeDisplay');
            input.addEventListener('input', () => {
                display.textContent = input.value;
                display.style.width = input.value + 'px';
                display.style.height = input.value + 'px';
            });
        }

        // ========== INIT ==========
        window.addEventListener('load', initSocket);