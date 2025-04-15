// WPL 15.04.2025 v1.3
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

// Direction vectors
const directions = {
    up: { x: 0, y: -1 },
    right: { x: 1, y: 0 },
    down: { x: 0, y: 1 },
    left: { x: -1, y: 0 }
};

// Debug helper function
function debugLog(message) {
    console.log(`[DEBUG] ${message}`);
}

// Initialize connection to server
function connectToServer() {
    // Use the correct server URL
    socket = io('https://amarmax.duckdns.org:10556');

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
        
        updateScores();
        startAnimationLoop();
        
        // Update UI based on game running state
        updateButtonStates();

        // Force an immediate render to avoid initial flicker
        draw();
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
        
        updateScores();
        
        // Show grace period message if we're in the grace period
        if (gameRunning && gameState.graceSeconds > 0) {
            showGracePeriodIndicator(gameState.graceSeconds);
        } else {
            hideGracePeriodIndicator();
        }
    });

    socket.on('playerJoined', (data) => {
        debugLog('Player joined event received');
        previousGameState = JSON.parse(JSON.stringify(gameState)); // Deep copy for comparison
        gameState.players = data.players;
        if (data.running !== undefined) {
            gameState.running = data.running;
            gameRunning = data.running;
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
    });
    
    socket.on('gameReset', (state) => {
        debugLog('Game reset event received');
        previousGameState = JSON.parse(JSON.stringify(gameState)); // Deep copy for comparison
        gameState = state;
        gameRunning = false;
        isGameOver = false; // Clear game over state on reset
        
        // Set grace period seconds from server
        if (state.graceSeconds !== undefined) {
            gameState.graceSeconds = state.graceSeconds;
        } else {
            gameState.graceSeconds = GRACE_PERIOD_SECONDS;
        }
        
        updateButtonStates();
        hideGracePeriodIndicator();
        updateScores();
        
        // Force an immediate render for reset
        draw();
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
        updateButtonStates();
        hideGracePeriodIndicator();

        // Update game state
        previousGameState = JSON.parse(JSON.stringify(gameState)); // Deep copy for comparison
        gameState.players = data.players;

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
    startBtn.disabled = gameRunning || !(Object.keys(gameState.players).length > 0) || 
                        (isGameOver && !gameRunning);
    
    // Reset button is enabled only if:
    // - Game is running OR
    // - Game is in "game over" state
    resetBtn.disabled = !gameRunning && !isGameOver;
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

// Show the countdown before starting the game
function showCountdown(callback) {
    let countdownOverlay = document.getElementById('countdown-overlay');
    
    if (!countdownOverlay) {
        // Create the overlay element
        countdownOverlay = document.createElement('div');
        countdownOverlay.id = 'countdown-overlay';
        countdownOverlay.className = 'countdown-overlay';
        document.body.appendChild(countdownOverlay);
        
        // Add styles
        const style = document.createElement('style');
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
    
    // Create the countdown number element
    const countdownNumber = document.createElement('div');
    countdownNumber.className = 'countdown-number';
    countdownOverlay.appendChild(countdownNumber);
    
    // Start from 5
    let seconds = 5;
    countdownNumber.textContent = seconds;
    
    // Update the countdown every second
    const interval = setInterval(() => {
        seconds--;
        
        if (seconds <= 0) {
            clearInterval(interval);
            countdownOverlay.remove();
            if (callback) callback();
        } else {
            countdownNumber.textContent = seconds;
        }
    }, 1000);
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

// Draw the game using double buffering to reduce flickering
function draw() {
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
        
        animationFrame = requestAnimationFrame(animate);
    }

    // Start the animation loop
    animationFrame = requestAnimationFrame(animate);
}

// Send direction change to server
function sendDirectionChange(direction) {
    if (!socket) return;

    // Only send if direction is different from last sent
    if (direction !== lastDirection) {
        debugLog(`Sending direction change: ${direction}`);
        socket.emit('changeDirection', direction);
        lastDirection = direction;
    }
}

// Handle direction changes based on keyboard input
function handleDirectionChange(key) {
    if (!gameRunning) {
        debugLog('Game not running, ignoring direction change');
        return;
    }
    
    // Check if player exists and is alive
    if (!gameState.players || !gameState.players[socket.id] || !gameState.players[socket.id].snake.alive) {
        debugLog('Player not alive, ignoring direction change');
        return;
    }
    
    let direction = null;
    
    switch (key) {
        case 'ArrowUp':
            direction = 'up';
            break;
        case 'ArrowRight':
            direction = 'right';
            break;
        case 'ArrowDown':
            direction = 'down';
            break;
        case 'ArrowLeft':
            direction = 'left';
            break;
        default:
            return; // Not an arrow key
    }
    
    if (direction) {
        sendDirectionChange(direction);
    }
}

// Event listeners
joinBtn.addEventListener('click', joinGame);

startBtn.addEventListener('click', () => {
    debugLog('Start button clicked');
    
    // Disable button during countdown
    startBtn.disabled = true;
    
    // Show countdown first, then start the game
    showCountdown(() => {
        socket.emit('startGame');
    });
});

resetBtn.addEventListener('click', () => {
    debugLog('Reset button clicked');
    isGameOver = false; // Clear game over state when reset is clicked
    socket.emit('resetGame');
    
    // Hide game over overlay if visible
    if (gameOverOverlay.classList.contains('visible')) {
        gameOverOverlay.classList.remove('visible');
    }
});

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
    
    // If the game is over, reset it rather than just rejoining
    socket.emit('resetGame');

    // Keep the same room but rejoin
    socket.emit('joinGame', {
        gameId: gameId,
        playerName: playerName
    });
});

// Update player snake direction on arrow key press
document.addEventListener('keydown', function(e) {
    // Prevent default behavior for arrow keys to avoid page scrolling
    if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.key)) {
        e.preventDefault();
        handleDirectionChange(e.key);
    }
});

// Add touch controls for mobile devices
function addTouchControls() {
    const touchControls = document.createElement('div');
    touchControls.className = 'touch-controls';
    touchControls.innerHTML = `
        <div class="touch-control up">▲</div>
        <div class="touch-control-row">
            <div class="touch-control left">◀</div>
            <div class="touch-control right">▶</div>
        </div>
        <div class="touch-control down">▼</div>
    `;
    
    document.body.appendChild(touchControls);
    
    // Add touch events
    document.querySelector('.touch-control.up').addEventListener('click', () => handleDirectionChange('ArrowUp'));
    document.querySelector('.touch-control.right').addEventListener('click', () => handleDirectionChange('ArrowRight'));
    document.querySelector('.touch-control.down').addEventListener('click', () => handleDirectionChange('ArrowDown'));
    document.querySelector('.touch-control.left').addEventListener('click', () => handleDirectionChange('ArrowLeft'));
    
    // Add styles
    const style = document.createElement('style');
    style.textContent = `
        .touch-controls {
            position: fixed;
            bottom: 20px;
            left: 50%;
            transform: translateX(-50%);
            display: flex;
            flex-direction: column;
            align-items: center;
            gap: 10px;
            z-index: 100;
        }
        .touch-control-row {
            display: flex;
            gap: 50px;
        }
        .touch-control {
            width: 60px;
            height: 60px;
            background-color: rgba(76, 175, 80, 0.7);
            border-radius: 50%;
            display: flex;
            justify-content: center;
            align-items: center;
            font-size: 24px;
            color: white;
            user-select: none;
            cursor: pointer;
        }
        .touch-control:active {
            background-color: rgba(76, 175, 80, 1);
        }
        @media (min-width: 769px) {
            .touch-controls {
                display: none;
            }
        }
    `;
    document.head.appendChild(style);
}

// Check if on mobile device
const isMobileDevice = () => {
    return /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
};

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
    
    // Add mobile controls if on a mobile device
    if (isMobileDevice()) {
        addTouchControls();
    }
    
    // Force initial draw
    draw();
});

// Handle browser resize
window.addEventListener('resize', () => {
    // Force a redraw on resize
    draw();
});

// Handle visibility change - pause animation when tab is not visible
document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
        // Stop animation loop when tab is not visible to save resources
        stopAnimationLoop();
    } else {
        // Resume animation when tab becomes visible again
        startAnimationLoop();
    }
});
