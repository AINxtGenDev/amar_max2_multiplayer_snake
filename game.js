// WPL 15.04.2025 v1.4
// fix both issues - the positioning of touch controls and the non-working Reset Game button on mobile.
// Game constants
const GRID_SIZE = 30;
const CELL_SIZE = 20;
const GRACE_PERIOD_SECONDS = 3; // Fixed grace period to match server

// Game elements
const canvas = document.getElementById('game-canvas');
const ctx = canvas.getContext('2d');
const startBtn = document.getElementById('start-btn');
const resetBtn = document.getElementById('reset-btn');
const newRoomBtn = document.getElementById('new-room-btn');
const scoresContainer = document.getElementById('scores-container');
const gameOverOverlay = document.getElementById('game-over-overlay');
const gameOverMessage = document.getElementById('game-over-message');
const winnerMessage = document.getElementById('winner-message');
const playAgainBtn = document.getElementById('play-again-btn');
const joinGameOverlay = document.getElementById('join-game-overlay');
const joinBtn = document.getElementById('join-btn');
const playerNameInput = document.getElementById('player-name');
const gameIdInput = document.getElementById('game-id');
const connectionStatus = document.getElementById('connection-status');
const roomIdDisplay = document.getElementById('room-id-display');
const playerCountDisplay = document.getElementById('player-count');

// Optimize canvas rendering
canvas.width = 600;
canvas.height = 600;
ctx.imageSmoothingEnabled = false; // Disable anti-aliasing for pixel-perfect rendering

// Create an off-screen canvas for double buffering
const offscreenCanvas = document.createElement('canvas');
offscreenCanvas.width = canvas.width;
offscreenCanvas.height = canvas.height;
const offscreenCtx = offscreenCanvas.getContext('2d');
offscreenCtx.imageSmoothingEnabled = false;

// Game state
let socket;
let playerId;
let gameId;
let playerName;
let isGameOver = false; // Track if the game is in "game over" state
let gameState = {
    players: {},
    food: [],
    running: false,
    ticksSinceStart: 0,
    graceSeconds: 0 // Track remaining grace period in seconds
};
let previousGameState = null; // For state comparison to reduce unnecessary renders
let gameRunning = false;
let animationFrame;
let lastDirection = null;
let isAnimating = false; // Flag to ensure only one animation loop is running
let pendingStateUpdate = false; // Flag to indicate a state update is pending
let isReconnecting = false; // Flag to track if we're in a reconnection process
let isCountdownActive = false; // Flag to track if countdown is active
let touchControlsInitialized = false; // Track if touch controls are initialized
let resetRequestPending = false; // Track if a reset request is pending

// Client-side prediction for responsive controls
let localPlayerState = null; // Store local player state for prediction
let lastInputTime = 0; // Track when the last input was sent
const INPUT_BUFFER_SIZE = 3; // Maximum number of inputs to buffer
const inputQueue = []; // Queue to store pending inputs
const MIN_INPUT_INTERVAL = 20; // Minimum time (ms) between input sends to avoid flooding

// Direction vectors
const directions = {
    up: { x: 0, y: -1 },
    right: { x: 1, y: 0 },
    down: { x: 0, y: 1 },
    left: { x: -1, y: 0 }
};

// Input key state tracking for responsive controls
const keyState = {
    ArrowUp: false,
    ArrowDown: false,
    ArrowLeft: false,
    ArrowRight: false
};

// Debug helper function with timestamp
function debugLog(message) {
    const now = new Date();
    const timestamp = now.toLocaleTimeString() + '.' + now.getMilliseconds().toString().padStart(3, '0');
    console.log(`[DEBUG ${timestamp}] ${message}`);
}

// Mobile-specific debug helper
function mobileDebug(message) {
    debugLog(`[MOBILE] ${message}`);
    
    // On mobile, also display debug info in a small overlay for testing
    if (isMobileDevice()) {
        let debugOverlay = document.getElementById('mobile-debug-overlay');
        if (!debugOverlay) {
            debugOverlay = document.createElement('div');
            debugOverlay.id = 'mobile-debug-overlay';
            debugOverlay.style.position = 'fixed';
            debugOverlay.style.bottom = '80px';
            debugOverlay.style.left = '10px';
            debugOverlay.style.backgroundColor = 'rgba(0,0,0,0.7)';
            debugOverlay.style.color = 'white';
            debugOverlay.style.padding = '5px';
            debugOverlay.style.fontSize = '10px';
            debugOverlay.style.maxWidth = '150px';
            debugOverlay.style.zIndex = '1000';
            debugOverlay.style.overflowY = 'scroll';
            debugOverlay.style.maxHeight = '100px';
            document.body.appendChild(debugOverlay);
        }
        
        const entry = document.createElement('div');
        entry.textContent = `${message}`;
        
        // Keep only last 5 messages
        if (debugOverlay.childElementCount >= 5) {
            debugOverlay.removeChild(debugOverlay.firstChild);
        }
        
        debugOverlay.appendChild(entry);
    }
}

// Reset all key states - important for mobile
function resetKeyStates() {
    keyState.ArrowUp = false;
    keyState.ArrowDown = false;
    keyState.ArrowLeft = false;
    keyState.ArrowRight = false;
    lastDirection = null;
    inputQueue.length = 0; // Clear input queue
    
    mobileDebug("Key states reset");
}

// Initialize connection to server
function connectToServer() {
    // Use the correct server URL
    socket = io('https://amarmax.duckdns.org:10556', {
        transports: ['websocket'], // Force WebSocket for better performance
        reconnectionAttempts: 5,   // Limit reconnection attempts
        reconnectionDelay: 1000,   // Start with a 1s delay
        reconnectionDelayMax: 5000 // Max out at 5s delay
    });

    // Connection events
    socket.on('connect', () => {
        connectionStatus.textContent = 'Connected';
        connectionStatus.classList.remove('disconnected');
        connectionStatus.classList.add('connected');
        console.log('Connected to server with ID:', socket.id);
        playerId = socket.id;
        
        // If we were previously disconnected and reconnected
        if (isReconnecting && gameId && playerName) {
            // Attempt to rejoin the same game
            joinExistingGame();
            isReconnecting = false;
        }
    });

    socket.on('disconnect', () => {
        connectionStatus.textContent = 'Disconnected';
        connectionStatus.classList.remove('connected');
        connectionStatus.classList.add('disconnected');
        console.log('Disconnected from server');
        gameRunning = false; // Make sure to update the game state when disconnected
        isReconnecting = true; // Set flag to attempt reconnection
        stopAnimationLoop(); // Stop animation loop on disconnect
        
        // Reset input state
        resetKeyStates();
    });

    // Game state events
    socket.on('gameState', (state) => {
        debugLog('Received game state');
        previousGameState = JSON.parse(JSON.stringify(gameState)); // Deep copy for comparison
        gameState = state;
        gameRunning = state.running; // Sync game running state with server
        
        if (state.ticksSinceStart !== undefined) {
            gameState.ticksSinceStart = state.ticksSinceStart;
        } else {
            gameState.ticksSinceStart = 0;
        }
        
        // Set grace period seconds
        if (state.graceSeconds !== undefined) {
            gameState.graceSeconds = state.graceSeconds;
        } else {
            gameState.graceSeconds = 0;
        }
        
        // Update local player state for client-side prediction
        if (gameState.players && gameState.players[socket.id]) {
            localPlayerState = JSON.parse(JSON.stringify(gameState.players[socket.id]));
        }
        
        updateScores();
        startAnimationLoop();
        
        // Update UI based on game running state
        updateButtonStates();

        // Force an immediate render to avoid initial flicker
        draw();
        
        // Ensure touch controls are initialized if on mobile
        if (isMobileDevice() && !touchControlsInitialized) {
            initTouchControls();
        }
    });

    socket.on('gameUpdate', (state) => {
        // Set pending state update to avoid rendering before animation frame
        pendingStateUpdate = true;
        previousGameState = JSON.parse(JSON.stringify(gameState)); // Deep copy for comparison
        gameState = state;
        gameRunning = state.running; // Keep the running state in sync
        
        if (state.ticksSinceStart !== undefined) {
            gameState.ticksSinceStart = state.ticksSinceStart;
        }
        
        // Update grace period seconds from server
        if (state.graceSeconds !== undefined) {
            gameState.graceSeconds = state.graceSeconds;
        }
        
        // Update local player state for client-side prediction
        if (gameState.players && gameState.players[socket.id]) {
            localPlayerState = JSON.parse(JSON.stringify(gameState.players[socket.id]));
        }
        
        updateScores();
        
        // Show grace period message if we're in the grace period
        if (gameRunning && gameState.graceSeconds > 0) {
            showGracePeriodIndicator(gameState.graceSeconds);
        } else {
            hideGracePeriodIndicator();
        }
    });

    // Countdown event handling
    socket.on('gameCountdown', (data) => {
        debugLog('Countdown event received: ' + data.seconds);
        
        // Show the countdown UI
        showServerCountdown(data.seconds);
        
        // Set countdown active flag
        isCountdownActive = true;
        
        // Disable start button during countdown
        startBtn.disabled = true;
    });

    socket.on('playerJoined', (data) => {
        debugLog('Player joined event received');
        previousGameState = JSON.parse(JSON.stringify(gameState)); // Deep copy for comparison
        gameState.players = data.players;
        if (data.running !== undefined) {
            gameState.running = data.running;
            gameRunning = data.running;
        }
        
        // Update local player state for client-side prediction
        if (gameState.players && gameState.players[socket.id]) {
            localPlayerState = JSON.parse(JSON.stringify(gameState.players[socket.id]));
        }
        
        updateScores();

        // Update player count
        playerCountDisplay.textContent = Object.keys(gameState.players).length;

        // Update button states after player joins
        updateButtonStates();
    });

    socket.on('playerLeft', (leftPlayerId) => {
        if (gameState.players && gameState.players[leftPlayerId]) {
            previousGameState = JSON.parse(JSON.stringify(gameState)); // Deep copy for comparison
            delete gameState.players[leftPlayerId];
            updateScores();

            // Update player count
            playerCountDisplay.textContent = Object.keys(gameState.players).length;
        }
    });

    socket.on('gameStarted', (data) => {
        debugLog('Game started event received');
        gameRunning = true;
        gameState.running = true;
        gameState.ticksSinceStart = 0;
        isGameOver = false; // Clear game over state when a new game starts
        isCountdownActive = false; // Clear countdown flag
        resetRequestPending = false; // Reset the pending flag
        
        // Hide countdown if it's visible
        hideCountdown();
        
        // Initialize grace period with server value or fallback to default
        if (data && data.graceSeconds !== undefined) {
            gameState.graceSeconds = data.graceSeconds;
        } else {
            gameState.graceSeconds = GRACE_PERIOD_SECONDS;
        }
        
        updateButtonStates();
        
        // Show grace period indicator
        showGracePeriodIndicator(gameState.graceSeconds);
        
        // Show starting message
        showStartingMessage();
        
        // Reset input state when game starts
        resetKeyStates();
        
        // Force touch controls re-initialization for mobile
        if (isMobileDevice()) {
            cleanupTouchControls();
            initTouchControls();
        }
    });
    
    socket.on('gameReset', (state) => {
        debugLog('Game reset event received');
        previousGameState = JSON.parse(JSON.stringify(gameState)); // Deep copy for comparison
        gameState = state;
        gameRunning = false;
        isGameOver = false; // Clear game over state on reset
        isCountdownActive = false; // Clear countdown flag
        resetRequestPending = false; // Reset the pending flag
        
        // Hide countdown if it's visible
        hideCountdown();
        
        // Set grace period seconds from server
        if (state.graceSeconds !== undefined) {
            gameState.graceSeconds = state.graceSeconds;
        } else {
            gameState.graceSeconds = GRACE_PERIOD_SECONDS;
        }
        
        // Update local player state for client-side prediction
        if (gameState.players && gameState.players[socket.id]) {
            localPlayerState = JSON.parse(JSON.stringify(gameState.players[socket.id]));
        }
        
        // Reset input state when game resets
        resetKeyStates();
        
        updateButtonStates();
        hideGracePeriodIndicator();
        updateScores();
        
        mobileDebug("Game reset received from server");
        
        // Force an immediate render for reset
        draw();
        
        // Reinitialize touch controls for mobile
        if (isMobileDevice()) {
            mobileDebug("Reinitializing touch controls after reset");
            setTimeout(() => {
                cleanupTouchControls();
                initTouchControls();
            }, 100);
        }
    });

    socket.on('gameFull', () => {
        // Only show alert if not in game over state
        if (!isGameOver) {
            alert('This game room is full! Please try another room.');
        } else {
            // If in game over state, try to reset the game instead
            socket.emit('resetGame');
        }
    });

    socket.on('gameOver', (data) => {
        debugLog('Game over event received');
        gameRunning = false;
        gameState.running = false;
        isGameOver = true; // Set game over state
        isCountdownActive = false; // Clear countdown flag
        resetRequestPending = false; // Reset the pending flag
        
        // Hide countdown if it's visible
        hideCountdown();
        
        updateButtonStates();
        hideGracePeriodIndicator();

        // Update game state
        previousGameState = JSON.parse(JSON.stringify(gameState)); // Deep copy for comparison
        gameState.players = data.players;

        // Reset input state when game is over
        resetKeyStates();
        
        // Show game over message
        gameOverMessage.textContent = "Game Over";

        if (data.winner) {
            const winnerColor = data.players[data.winner].snake.color;
            winnerMessage.textContent = `${data.winnerName} wins!`;
            winnerMessage.style.color = winnerColor;
        } else {
            winnerMessage.textContent = "No winner!";
            winnerMessage.style.color = '#FFFFFF';
        }

        gameOverOverlay.classList.add('visible');

        // Update scores
        updateScores();
        
        // Force an immediate render for game over
        draw();
    });
}

// Update button states based on game state
function updateButtonStates() {
    // Start button is enabled only if:
    // - There's at least one player
    // - Game is not running
    // - Game is not in "game over" state, or has been reset
    // - Countdown is not active
    startBtn.disabled = gameRunning || isCountdownActive || !(Object.keys(gameState.players).length > 0) || 
                        (isGameOver && !gameRunning);
    
    // Reset button is enabled only if:
    // - Game is running OR
    // - Game is in "game over" state OR
    // - Countdown is active
    resetBtn.disabled = !gameRunning && !isGameOver && !isCountdownActive;
}

// Join existing game (used for reconnection)
function joinExistingGame() {
    socket.emit('joinGame', {
        gameId: gameId,
        playerName: playerName
    });
    
    // Update UI
    roomIdDisplay.textContent = gameId;
}

// Show the synchronized countdown from server
function showServerCountdown(seconds) {
    let countdownOverlay = document.getElementById('countdown-overlay');
    
    if (!countdownOverlay) {
        // Create the overlay element
        countdownOverlay = document.createElement('div');
        countdownOverlay.id = 'countdown-overlay';
        countdownOverlay.className = 'countdown-overlay';
        document.body.appendChild(countdownOverlay);
        
        // Add styles if not already added
        if (!document.getElementById('countdown-styles')) {
            const style = document.createElement('style');
            style.id = 'countdown-styles';
            style.textContent = `
                .countdown-overlay {
                    position: fixed;
                    top: 0;
                    left: 0;
                    width: 100%;
                    height: 100%;
                    background-color: rgba(0, 0, 0, 0.8);
                    display: flex;
                    justify-content: center;
                    align-items: center;
                    z-index: 2000;
                }
                
                .countdown-number {
                    font-size: 15rem;
                    color: white;
                    font-weight: bold;
                    text-shadow: 0 0 20px var(--primary), 0 0 40px var(--primary);
                    animation: pulse 0.8s infinite alternate;
                }
                
                @keyframes pulse {
                    0% { transform: scale(1); opacity: 1; }
                    100% { transform: scale(1.1); opacity: 0.8; }
                }
            `;
            document.head.appendChild(style);
        }
    }
    
    // Update or create the countdown number element
    let countdownNumber = document.getElementById('countdown-number');
    if (!countdownNumber) {
        countdownNumber = document.createElement('div');
        countdownNumber.id = 'countdown-number';
        countdownNumber.className = 'countdown-number';
        countdownOverlay.appendChild(countdownNumber);
    }
    
    // Update the countdown number
    countdownNumber.textContent = seconds;
    
    // Show the countdown
    countdownOverlay.style.display = 'flex';
}

// Hide the countdown overlay
function hideCountdown() {
    const countdownOverlay = document.getElementById('countdown-overlay');
    if (countdownOverlay) {
        countdownOverlay.style.display = 'none';
    }
}

// Show grace period indicator
function showGracePeriodIndicator(seconds) {
    let indicator = document.getElementById('grace-period-indicator');
    
    if (!indicator) {
        indicator = document.createElement('div');
        indicator.id = 'grace-period-indicator';
        indicator.className = 'grace-period-indicator';
        document.body.appendChild(indicator);
        
        // Add styles
        const style = document.createElement('style');
        style.textContent = `
            .grace-period-indicator {
                position: fixed;
                top: 20px;
                left: 50%;
                transform: translateX(-50%);
                background-color: rgba(76, 175, 80, 0.8);
                color: white;
                padding: 10px 20px;
                border-radius: 5px;
                font-weight: bold;
                z-index: 1000;
                text-align: center;
                transition: opacity 0.3s;
            }
            
            .grace-period-indicator.hidden {
                opacity: 0;
                pointer-events: none;
            }
        `;
        document.head.appendChild(style);
    }
    
    // Display the exact number of seconds remaining
    indicator.textContent = `Grace period: ${seconds} second${seconds !== 1 ? 's' : ''}`;
    indicator.classList.remove('hidden');
}

// Hide grace period indicator
function hideGracePeriodIndicator() {
    const indicator = document.getElementById('grace-period-indicator');
    if (indicator) {
        indicator.classList.add('hidden');
    }
}

// Show starting message
function showStartingMessage() {
    let message = document.getElementById('starting-message');
    
    if (!message) {
        message = document.createElement('div');
        message.id = 'starting-message';
        message.className = 'starting-message';
        document.body.appendChild(message);
        
        // Add styles
        const style = document.createElement('style');
        style.textContent = `
            .starting-message {
                position: fixed;
                top: 50%;
                left: 50%;
                transform: translate(-50%, -50%);
                background-color: rgba(0, 0, 0, 0.8);
                color: white;
                padding: 20px 40px;
                border-radius: 10px;
                font-size: 24px;
                font-weight: bold;
                z-index: 1000;
                text-align: center;
                animation: fadeOut 2s forwards;
            }
            
            @keyframes fadeOut {
                0% { opacity: 1; }
                70% { opacity: 1; }
                100% { opacity: 0; pointer-events: none; }
            }
        `;
        document.head.appendChild(style);
    }
    
    message.textContent = `Move your snake with arrow keys!`;
    setTimeout(() => {
        message.remove();
    }, 2000);
}

// Join a game room
function joinGame() {
    playerName = playerNameInput.value.trim() || `Player${Math.floor(Math.random() * 1000)}`;
    gameId = gameIdInput.value.trim() || 'default-room';

    socket.emit('joinGame', {
        gameId: gameId,
        playerName: playerName
    });

    // Update UI
    roomIdDisplay.textContent = gameId;
    joinGameOverlay.style.display = 'none';

    // Store game ID for reconnection
    localStorage.setItem('lastGameId', gameId);
    localStorage.setItem('playerName', playerName);
}

// Client-side prediction for immediate control response
function applyClientPrediction() {
    if (!gameRunning || !localPlayerState || !localPlayerState.snake || !localPlayerState.snake.alive) {
        return;
    }
    
    // Apply pending inputs from our queue to local state
    while (inputQueue.length > 0) {
        const direction = inputQueue[0];
        
        // Check if direction is valid (not opposite of current)
        const currentDir = localPlayerState.snake.direction;
        if (!((currentDir === 'up' && direction === 'down') ||
            (currentDir === 'down' && direction === 'up') ||
            (currentDir === 'left' && direction === 'right') ||
            (currentDir === 'right' && direction === 'left'))) {
            
            // Update our local snake's direction
            localPlayerState.snake.direction = direction;
            localPlayerState.snake.pendingDirection = direction;
        }
        
        // Remove this input from the queue
        inputQueue.shift();
    }
    
    // If we have a valid local player state, modify the gameState to use it
    // for rendering our snake before the server responds
    if (gameState.players && gameState.players[socket.id]) {
        const serverSnake = gameState.players[socket.id].snake;
        
        // Only apply prediction if server hasn't already updated the direction
        if (serverSnake.direction !== localPlayerState.snake.direction) {
            serverSnake.direction = localPlayerState.snake.direction;
            serverSnake.pendingDirection = localPlayerState.snake.pendingDirection;
        }
    }
}

// Draw the game using double buffering to reduce flickering
function draw() {
    // Apply client prediction before drawing
    applyClientPrediction();
    
    // Always draw to the offscreen canvas first
    offscreenCtx.fillStyle = '#1E1E1E';
    offscreenCtx.fillRect(0, 0, offscreenCanvas.width, offscreenCanvas.height);

    // Draw grid lines
    offscreenCtx.strokeStyle = '#333333';
    offscreenCtx.lineWidth = 0.5;

    for (let i = 0; i <= GRID_SIZE; i++) {
        // Vertical lines
        offscreenCtx.beginPath();
        offscreenCtx.moveTo(i * CELL_SIZE, 0);
        offscreenCtx.lineTo(i * CELL_SIZE, GRID_SIZE * CELL_SIZE);
        offscreenCtx.stroke();

        // Horizontal lines
        offscreenCtx.beginPath();
        offscreenCtx.moveTo(0, i * CELL_SIZE);
        offscreenCtx.lineTo(GRID_SIZE * CELL_SIZE, i * CELL_SIZE);
        offscreenCtx.stroke();
    }

    // Draw food
    if (gameState.food) {
        for (const f of gameState.food) {
            offscreenCtx.fillStyle = f.color || '#FF9800';
            offscreenCtx.beginPath();
            offscreenCtx.arc(
                f.x * CELL_SIZE + CELL_SIZE / 2,
                f.y * CELL_SIZE + CELL_SIZE / 2,
                CELL_SIZE / 2 - 2,
                0,
                Math.PI * 2
            );
            offscreenCtx.fill();

            // Add a shine effect
            offscreenCtx.fillStyle = 'rgba(255, 255, 255, 0.7)';
            offscreenCtx.beginPath();
            offscreenCtx.arc(
                f.x * CELL_SIZE + CELL_SIZE / 3,
                f.y * CELL_SIZE + CELL_SIZE / 3,
                CELL_SIZE / 6,
                0,
                Math.PI * 2
            );
            offscreenCtx.fill();
        }
    }

    // Draw snakes
    if (gameState.players) {
        for (const id in gameState.players) {
            const player = gameState.players[id];
            if (!player.snake.alive) continue;

            // Draw each segment
            for (let i = 0; i < player.snake.body.length; i++) {
                const segment = player.snake.body[i];

                offscreenCtx.fillStyle = player.snake.color;

                // Draw rounded segment
                offscreenCtx.beginPath();
                offscreenCtx.roundRect(
                    segment.x * CELL_SIZE + 1,
                    segment.y * CELL_SIZE + 1,
                    CELL_SIZE - 2,
                    CELL_SIZE - 2,
                    i === 0 ? 8 : 4 // Rounder corners for the head
                );
                offscreenCtx.fill();

                // Draw eyes for the head
                if (i === 0) {
                    // Eye positions based on direction
                    let eyeOffset = { x: 0, y: 0 };
                    let eye1 = { x: 0, y: 0 };
                    let eye2 = { x: 0, y: 0 };

                    switch (player.snake.direction) {
                        case 'up':
                            eye1 = { x: -4, y: -2 };
                            eye2 = { x: 4, y: -2 };
                            break;
                        case 'right':
                            eye1 = { x: 2, y: -4 };
                            eye2 = { x: 2, y: 4 };
                            break;
                        case 'down':
                            eye1 = { x: -4, y: 2 };
                            eye2 = { x: 4, y: 2 };
                            break;
                        case 'left':
                            eye1 = { x: -2, y: -4 };
                            eye2 = { x: -2, y: 4 };
                            break;
                    }

                    // Draw the eyes
                    offscreenCtx.fillStyle = 'white';

                    offscreenCtx.beginPath();
                    offscreenCtx.arc(
                        segment.x * CELL_SIZE + CELL_SIZE / 2 + eye1.x,
                        segment.y * CELL_SIZE + CELL_SIZE / 2 + eye1.y,
                        3,
                        0,
                        Math.PI * 2
                    );
                    offscreenCtx.fill();

                    offscreenCtx.beginPath();
                    offscreenCtx.arc(
                        segment.x * CELL_SIZE + CELL_SIZE / 2 + eye2.x,
                        segment.y * CELL_SIZE + CELL_SIZE / 2 + eye2.y,
                        3,
                        0,
                        Math.PI * 2
                    );
                    offscreenCtx.fill();

                    // Draw pupils
                    offscreenCtx.fillStyle = 'black';

                    offscreenCtx.beginPath();
                    offscreenCtx.arc(
                        segment.x * CELL_SIZE + CELL_SIZE / 2 + eye1.x + (player.snake.direction === 'right' ? 1 : player.snake.direction === 'left' ? -1 : 0),
                        segment.y * CELL_SIZE + CELL_SIZE / 2 + eye1.y + (player.snake.direction === 'down' ? 1 : player.snake.direction === 'up' ? -1 : 0),
                        1.5,
                        0,
                        Math.PI * 2
                    );
                    offscreenCtx.fill();

                    offscreenCtx.beginPath();
                    offscreenCtx.arc(
                        segment.x * CELL_SIZE + CELL_SIZE / 2 + eye2.x + (player.snake.direction === 'right' ? 1 : player.snake.direction === 'left' ? -1 : 0),
                        segment.y * CELL_SIZE + CELL_SIZE / 2 + eye2.y + (player.snake.direction === 'down' ? 1 : player.snake.direction === 'up' ? -1 : 0),
                        1.5,
                        0,
                        Math.PI * 2
                    );
                    offscreenCtx.fill();
                }
            }
        }
    }

    // Copy the offscreen canvas to the visible canvas in one operation
    ctx.drawImage(offscreenCanvas, 0, 0);
    
    // Reset pending state update flag after drawing
    pendingStateUpdate = false;
}

// Update the scores display
function updateScores() {
    scoresContainer.innerHTML = '';

    if (!gameState.players) return;

    // Sort players by score
    const sortedPlayers = Object.values(gameState.players).sort((a, b) =>
        b.snake.score - a.snake.score
    );

    for (const player of sortedPlayers) {
        const scoreElem = document.createElement('div');
        scoreElem.className = `snake-score${player.id === socket.id ? ' my-score' : ''}`;

        // Add status indicator
        const statusText = player.snake.alive ? 'Alive' : 'Dead';

        scoreElem.innerHTML = `
            <span class="snake-name" style="color: ${player.snake.color}">
                ${player.name} ${player.snake.alive ? '🟢' : '⚫'}
                ${player.id === socket.id ? ' (You)' : ''}
            </span>
            <span class="snake-score-value">
                ${player.snake.score}
            </span>
        `;

        scoresContainer.appendChild(scoreElem);
    }

    // Update player count
    playerCountDisplay.textContent = Object.keys(gameState.players).length;
}

// Stop animation loop safely
function stopAnimationLoop() {
    if (animationFrame) {
        cancelAnimationFrame(animationFrame);
        animationFrame = null;
    }
    isAnimating = false;
}

// Animation loop with optimized frame rendering
function startAnimationLoop() {
    // Cancel any existing animation loop
    stopAnimationLoop();
    
    // Set animating flag to prevent multiple loops
    if (isAnimating) return;
    isAnimating = true;
    
    // Use a fixed frame rate for more consistent rendering
    const targetFPS = 60;
    const frameInterval = 1000 / targetFPS;
    let lastFrameTime = 0;

    function animate(timestamp) {
        if (!isAnimating) return;
        
        // Calculate time since last frame
        const elapsed = timestamp - lastFrameTime;
        
        // Only render at target frame rate or if state has changed
        if (elapsed > frameInterval || pendingStateUpdate) {
            lastFrameTime = timestamp - (elapsed % frameInterval);
            draw();
        }
        
        // Process input every frame for responsive controls
        processInputs();
        
        animationFrame = requestAnimationFrame(animate);
    }

    // Start the animation loop
    animationFrame = requestAnimationFrame(animate);
}

// Process keyboard inputs every frame for responsive controls
function processInputs() {
    if (!gameRunning) return;
    
    // Check if player exists and is alive
    if (!gameState.players || !gameState.players[socket.id] || !gameState.players[socket.id].snake.alive) {
        return;
    }
    
    // Get current direction
    const currentDirection = gameState.players[socket.id].snake.direction;
    
    // Determine which key is pressed (prioritize newest key press)
    let newDirection = null;
    
    if (keyState.ArrowUp && currentDirection !== 'down') {
        newDirection = 'up';
    } else if (keyState.ArrowRight && currentDirection !== 'left') {
        newDirection = 'right';
    } else if (keyState.ArrowDown && currentDirection !== 'up') {
        newDirection = 'down';
    } else if (keyState.ArrowLeft && currentDirection !== 'right') {
        newDirection = 'left';
    }
    
    // Only send if the direction is different and we're not sending too frequently
    if (newDirection && 
        newDirection !== currentDirection && 
        newDirection !== lastDirection &&
        Date.now() - lastInputTime > MIN_INPUT_INTERVAL) {
        
        sendDirectionChange(newDirection);
        lastInputTime = Date.now();
        
        // Add to input queue for client prediction
        if (inputQueue.length < INPUT_BUFFER_SIZE) {
            inputQueue.push(newDirection);
        }
    }
}

// Send direction change to server
function sendDirectionChange(direction) {
    if (!socket || !gameRunning) return;

    // Only send if direction is different from last sent
    if (direction !== lastDirection) {
        debugLog(`Sending direction change: ${direction}`);
        socket.emit('changeDirection', direction);
        lastDirection = direction;
        
        // Mobile debug
        if (isMobileDevice()) {
            mobileDebug(`Sent direction: ${direction}`);
        }
    }
}

// Send reset game request to server with safeguards against duplicate requests
function sendResetGameRequest() {
    if (resetRequestPending) {
        mobileDebug("Reset already pending, ignoring");
        return;
    }
    
    mobileDebug("Sending reset game request");
    resetRequestPending = true;
    
    // Force all touch controls to release
    resetKeyStates();
    
    try {
        // Send the reset request to server
        socket.emit('resetGame');
        
        // On mobile, also add these extra steps to ensure reset works
        if (isMobileDevice()) {
            // Force UI update
            updateButtonStates();
            
            // Clean up any UI elements
            hideGracePeriodIndicator();
            hideCountdown();
            
            // Force touch controls cleanup
            cleanupTouchControls();
            
            // Reinitialize after a short delay
            setTimeout(() => {
                initTouchControls();
                resetRequestPending = false;
            }, 300);
        } else {
            // For desktop, reset pending flag after a short timeout
            setTimeout(() => {
                resetRequestPending = false;
            }, 300);
        }
    } catch (e) {
        console.error("Error sending reset request:", e);
        resetRequestPending = false;
    }
}

// Handle direction changes based on keyboard input (now updated for responsive controls)
function handleKeyDown(e) {
    if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.key)) {
        e.preventDefault(); // Prevent page scrolling
        keyState[e.key] = true; // Set key state to true
        
        // Mobile debug
        if (isMobileDevice()) {
            mobileDebug(`Key down: ${e.key}`);
        }
    }
}

function handleKeyUp(e) {
    if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.key)) {
        keyState[e.key] = false; // Reset key state
        
        // Mobile debug
        if (isMobileDevice()) {
            mobileDebug(`Key up: ${e.key}`);
        }
    }
}

// Check if on mobile device
const isMobileDevice = () => {
    return /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
};

// Clean up touch controls by removing event listeners
function cleanupTouchControls() {
    mobileDebug("Cleaning up touch controls");
    
    // First, remove the existing touch controls container if it exists
    const existingControls = document.querySelector('.touch-controls');
    if (existingControls) {
        existingControls.remove();
    }
    
    touchControlsInitialized = false;
}

// Initialize touch controls for mobile devices
function initTouchControls() {
    // First check if controls already exist and clean them up
    cleanupTouchControls();
    
    mobileDebug("Initializing touch controls");
    
    // Create new touch controls container
    const touchControls = document.createElement('div');
    touchControls.className = 'touch-controls';
    
    // Add the buttons with unique IDs
    touchControls.innerHTML = `
        <div class="touch-control up" id="touch-up">▲</div>
        <div class="touch-control-row">
            <div class="touch-control left" id="touch-left">◀</div>
            <div class="touch-control right" id="touch-right">▶</div>
        </div>
        <div class="touch-control down" id="touch-down">▼</div>
    `;
    
    // Add styles
    if (!document.getElementById('touch-controls-style')) {
        const style = document.createElement('style');
        style.id = 'touch-controls-style';
        style.textContent = `
            .touch-controls {
                position: fixed;
                top: 55%; /* Moved up from bottom */
                left: 50%;
                transform: translateX(-50%);
                display: flex;
                flex-direction: column;
                align-items: center;
                gap: 15px;
                z-index: 1000;
                padding-bottom: 20px;
            }
            .touch-control-row {
                display: flex;
                gap: 60px; /* Increased spacing */
            }
            .touch-control {
                width: 80px; /* Larger buttons */
                height: 80px;
                background-color: rgba(76, 175, 80, 0.8); /* More opaque */
                border-radius: 50%;
                display: flex;
                justify-content: center;
                align-items: center;
                font-size: 32px; /* Larger icons */
                color: white;
                user-select: none;
                cursor: pointer;
                touch-action: none; /* Prevent browser handling of touches */
                -webkit-tap-highlight-color: transparent; /* Remove touch highlight */
                box-shadow: 0 4px 8px rgba(0, 0, 0, 0.3); /* Add shadow for depth */
                border: 2px solid rgba(255, 255, 255, 0.3); /* Add subtle border */
            }
            .touch-control:active, .touch-control.active {
                background-color: rgba(76, 175, 80, 1);
                transform: scale(0.95);
                box-shadow: 0 2px 4px rgba(0, 0, 0, 0.3); /* Pressed shadow */
            }
            @media (min-width: 769px) {
                .touch-controls {
                    display: none;
                }
            }
            
            /* Fix for the Reset Game button on mobile */
            #reset-btn {
                -webkit-tap-highlight-color: transparent;
                -webkit-touch-callout: none;
                -webkit-user-select: none;
                user-select: none;
                position: relative;
                z-index: 100; /* Ensure it's above other elements */
                transform: translateZ(0); /* Force hardware acceleration */
            }
            
            #reset-btn:active::after {
                content: '';
                position: absolute;
                top: 0;
                left: 0;
                right: 0;
                bottom: 0;
                background-color: rgba(255, 255, 255, 0.2);
                border-radius: 5px;
            }
        `;
        document.head.appendChild(style);
    }
    
    // Append the controls to the document
    document.body.appendChild(touchControls);
    
    // Get elements after they're added to the DOM
    const upBtn = document.getElementById('touch-up');
    const rightBtn = document.getElementById('touch-right');
    const downBtn = document.getElementById('touch-down');
    const leftBtn = document.getElementById('touch-left');
    
    if (!upBtn || !rightBtn || !downBtn || !leftBtn) {
        mobileDebug("Error: Could not find touch control elements");
        return;
    }
    
    // Helper function for handling touch/mouse events
    const setupButton = (btn, direction, keyCode) => {
        // Touch events
        const touchStartHandler = (e) => {
            e.preventDefault();
            keyState[keyCode] = true;
            btn.classList.add('active');
            mobileDebug(`Touch start: ${direction}`);
        };
        
        const touchEndHandler = (e) => {
            e.preventDefault();
            keyState[keyCode] = false;
            btn.classList.remove('active');
            mobileDebug(`Touch end: ${direction}`);
        };
        
        const touchCancelHandler = (e) => {
            keyState[keyCode] = false;
            btn.classList.remove('active');
            mobileDebug(`Touch cancel: ${direction}`);
        };
        
        btn.addEventListener('touchstart', touchStartHandler, { passive: false });
        btn.addEventListener('touchend', touchEndHandler, { passive: false });
        btn.addEventListener('touchcancel', touchCancelHandler, { passive: false });
        
        // Mouse events for testing on desktop
        btn.addEventListener('mousedown', (e) => {
            e.preventDefault();
            keyState[keyCode] = true;
            btn.classList.add('active');
        });
        
        btn.addEventListener('mouseup', (e) => {
            e.preventDefault();
            keyState[keyCode] = false;
            btn.classList.remove('active');
        });
        
        btn.addEventListener('mouseleave', (e) => {
            if (keyState[keyCode]) {
                keyState[keyCode] = false;
                btn.classList.remove('active');
            }
        });
    };
    
    // Set up each button with proper events
    setupButton(upBtn, 'up', 'ArrowUp');
    setupButton(rightBtn, 'right', 'ArrowRight');
    setupButton(downBtn, 'down', 'ArrowDown');
    setupButton(leftBtn, 'left', 'ArrowLeft');
    
    // Add a trap to catch lost touch events on body
    document.body.addEventListener('touchend', (e) => {
        if (e.touches.length === 0) {
            // Reset all key states when no touches are on screen
            resetKeyStates();
            
            // Remove active class from all buttons
            document.querySelectorAll('.touch-control').forEach(btn => {
                btn.classList.remove('active');
            });
            
            mobileDebug("Body touchend: Reset all keys");
        }
    }, { passive: true });
    
    // Prevent page scrolling when touching controls
    touchControls.addEventListener('touchmove', (e) => {
        e.preventDefault();
    }, { passive: false });
    
    mobileDebug("Touch controls initialized");
    touchControlsInitialized = true;
    
    // Add a debug button
    if (!document.getElementById('mobile-debug-button')) {
        const debugBtn = document.createElement('button');
        debugBtn.id = 'mobile-debug-button';
        debugBtn.innerText = 'Reset Controls';
        debugBtn.style.position = 'fixed';
        debugBtn.style.bottom = '5px';
        debugBtn.style.right = '5px';
        debugBtn.style.fontSize = '10px';
        debugBtn.style.padding = '5px';
        debugBtn.style.zIndex = '1001';
        
        debugBtn.addEventListener('click', () => {
            resetKeyStates();
            cleanupTouchControls();
            initTouchControls();
            mobileDebug("Controls reset manually");
        });
        
        document.body.appendChild(debugBtn);
    }
}

// Fix Reset Game button on mobile by adding multiple event types
function fixResetButtonForMobile() {
    if (!isMobileDevice()) return;
    
    mobileDebug("Fixing Reset Game button for mobile");
    
    // First, remove any existing event listeners by cloning and replacing
    const originalBtn = document.getElementById('reset-btn');
    if (!originalBtn) return;
    
    const newBtn = originalBtn.cloneNode(true);
    originalBtn.parentNode.replaceChild(newBtn, originalBtn);
    
    // Add multiple event types for maximum reliability
    newBtn.addEventListener('touchstart', (e) => {
        e.preventDefault();
        mobileDebug("Reset button touchstart");
        newBtn.classList.add('pressed');
    }, { passive: false });
    
    newBtn.addEventListener('touchend', (e) => {
        e.preventDefault();
        mobileDebug("Reset button touchend");
        newBtn.classList.remove('pressed');
        sendResetGameRequest();
    }, { passive: false });
    
    // Also keep click listener for backward compatibility
    newBtn.addEventListener('click', (e) => {
        mobileDebug("Reset button clicked");
        sendResetGameRequest();
    });
    
    // Add additional mouse events
    newBtn.addEventListener('mousedown', () => {
        newBtn.classList.add('pressed');
    });
    
    newBtn.addEventListener('mouseup', () => {
        newBtn.classList.remove('pressed');
    });
}

// Event listeners
joinBtn.addEventListener('click', joinGame);

startBtn.addEventListener('click', () => {
    debugLog('Start button clicked');
    
    // Disable button during countdown
    startBtn.disabled = true;
    
    // Request a countdown from the server
    socket.emit('startCountdown');
});

// Reset button uses the enhanced handler for mobile compatibility
resetBtn.addEventListener('click', () => {
    debugLog('Reset button clicked');
    sendResetGameRequest();
});

// Mobile devices need extra handlers for the reset button
if (isMobileDevice()) {
    resetBtn.addEventListener('touchstart', (e) => {
        e.preventDefault();
        mobileDebug("Reset button touchstart");
    }, { passive: false });
    
    resetBtn.addEventListener('touchend', (e) => {
        e.preventDefault();
        mobileDebug("Reset button touchend");
        sendResetGameRequest();
    }, { passive: false });
}

newRoomBtn.addEventListener('click', () => {
    // Generate random room ID
    const newRoomId = 'room-' + Math.random().toString(36).substring(2, 8);
    gameIdInput.value = newRoomId;

    // Show join overlay
    joinGameOverlay.style.display = 'flex';
});

playAgainBtn.addEventListener('click', () => {
    gameOverOverlay.classList.remove('visible');
    isGameOver = false; // Clear game over state
    
    // Reset input state
    resetKeyStates();
    
    // If the game is over, reset it rather than just rejoining
    sendResetGameRequest();

    // Keep the same room but rejoin
    socket.emit('joinGame', {
        gameId: gameId,
        playerName: playerName
    });
    
    // Force touch controls re-initialization for mobile
    if (isMobileDevice()) {
        setTimeout(() => {
            mobileDebug("Reinitializing touch controls after play again");
            cleanupTouchControls();
            initTouchControls();
        }, 100);
    }
});

// Update player snake direction on arrow key press/release
document.addEventListener('keydown', handleKeyDown);
document.addEventListener('keyup', handleKeyUp);

// Load saved game ID and player name if available
window.addEventListener('load', () => {
    const savedGameId = localStorage.getItem('lastGameId');
    const savedPlayerName = localStorage.getItem('playerName');

    if (savedGameId) {
        gameIdInput.value = savedGameId;
    }

    if (savedPlayerName) {
        playerNameInput.value = savedPlayerName;
    }
    
    // Initialize reset button as disabled
    resetBtn.disabled = true;

    // Connect to server
    connectToServer();
    
    // Initialize touch controls if on mobile device
    if (isMobileDevice()) {
        mobileDebug("Mobile device detected");
        setTimeout(() => {
            initTouchControls();
            fixResetButtonForMobile();
        }, 1000); // Slight delay to ensure DOM is ready
    }
    
    // Force initial draw
    draw();
});

// Handle browser resize
window.addEventListener('resize', () => {
    // Force a redraw on resize
    draw();
    
    // Reinitialize touch controls on resize for mobile
    if (isMobileDevice() && touchControlsInitialized) {
        mobileDebug("Reinitializing touch controls after resize");
        cleanupTouchControls();
        initTouchControls();
        fixResetButtonForMobile();
    }
});

// Handle visibility change - optimize performance when tab is not visible
document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
        // Stop animation loop when tab is not visible to save resources
        stopAnimationLoop();
        
        // Reset key states to prevent stuck keys
        resetKeyStates();
    } else {
        // Resume animation when tab becomes visible again
        startAnimationLoop();
        
        // Reinitialize touch controls when tab becomes visible again
        if (isMobileDevice()) {
            mobileDebug("Reinitializing touch controls after visibility change");
            cleanupTouchControls();
            initTouchControls();
            fixResetButtonForMobile();
        }
    }
});

// Add additional safeguards for mobile
window.addEventListener('orientationchange', () => {
    if (isMobileDevice()) {
        mobileDebug("Orientation changed, reinitializing controls");
        
        // Reset key states
        resetKeyStates();
        
        // Delay to allow orientation to complete
        setTimeout(() => {
            cleanupTouchControls();
            initTouchControls();
            fixResetButtonForMobile();
        }, 500);
    }
});

// Address issue where mobile browsers sometimes don't properly handle touch events
window.addEventListener('touchstart', function onFirstTouch() {
    // Apply active touch class to body
    document.body.classList.add('touch-active');
    
    // Enable :active pseudo selectors
    document.addEventListener('touchstart', function() {}, { passive: false });
    
    // Remove this event listener
    window.removeEventListener('touchstart', onFirstTouch);
    
    mobileDebug("Touch initialized on document");
}, { once: true, passive: true });
