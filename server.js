// WPL 11.04.2025 v1.2
const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const path = require('path');
const cors = require('cors');
const fs = require('fs');
const https = require('https');

// Create Express app
const app = express();
app.use(cors());
app.use(express.static(path.join(__dirname, 'public')));

// Set up HTTPS server (required for your domain)
const options = {
  key: fs.readFileSync('/home/stecher/multiplayer-snake/certificates/privkey.pem'),
  cert: fs.readFileSync('/home/stecher/multiplayer-snake/certificates/fullchain.pem')
};

const server = https.createServer(options, app);

// Initialize Socket.IO
const io = socketIo(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

// Game constants
const GRID_SIZE = 30;
const GAME_SPEED = 100; // ms
const MAX_PLAYERS = 3;
const GRACE_PERIOD_SECONDS = 3; // Grace period in seconds
const GRACE_PERIOD_TICKS = GRACE_PERIOD_SECONDS * (1000 / GAME_SPEED); // Convert seconds to ticks
const MAX_FOOD = 3; // Maximum food items on the grid at once

// Color constants - specifically set to these colors
const PLAYER_COLORS = ['#6EE766', '#FF5252', '#42AAFF']; // Green, Red, Blue

// Game state
const games = {};
const playerSockets = {};

// Helper functions
function createNewGame(gameId) {
  return {
    id: gameId,
    players: {},
    food: [],
    running: false,
    playerCount: 0,
    interval: null,
    colorAssignments: {}, // Track which colors are assigned
    ticksSinceStart: 0,   // Track ticks since game started for grace period
    lastUpdateTime: Date.now(), // Track last update time for consistent update rate
    dirtyState: true,     // Flag to track if state has changed and needs to be sent
    gameOver: false,      // Track if the game is in game over state
    gameFullCounter: 0    // Counter to track reconnection attempts
  };
}

function createFood(gameState) {
  // Limit food creation if we already have enough
  if (gameState.food.length >= MAX_FOOD) return null; 

  let x, y;
  let attempts = 0;
  const maxAttempts = 100;
  let newFood = null;

  do {
    x = Math.floor(Math.random() * GRID_SIZE);
    y = Math.floor(Math.random() * GRID_SIZE);
    attempts++;

    if (isEmptyCell(gameState, x, y) && attempts < maxAttempts) {
      newFood = {
        x: x,
        y: y,
        color: `hsl(${Math.floor(Math.random() * 360)}, 80%, 60%)`
      };
      
      gameState.food.push(newFood);
      gameState.dirtyState = true; // Mark state as changed
      break;
    }
  } while (attempts < maxAttempts);
  
  return newFood;
}

function isEmptyCell(gameState, x, y) {
  // Check if cell is occupied by food
  for (const f of gameState.food) {
    if (f.x === x && f.y === y) {
      return false;
    }
  }

  // Check if cell is occupied by any snake
  for (const playerId in gameState.players) {
    const player = gameState.players[playerId];
    for (const segment of player.snake.body) {
      if (segment.x === x && segment.y === y) {
        return false;
      }
    }
  }

  return true;
}

// Get the first available color index
function getAvailableColorIndex(game) {
  for (let i = 0; i < PLAYER_COLORS.length; i++) {
    let colorTaken = false;
    
    // Check if this color is already assigned
    for (const playerId in game.players) {
      if (game.players[playerId].colorIndex === i) {
        colorTaken = true;
        break;
      }
    }
    
    if (!colorTaken) return i;
  }
  
  // If all colors are taken (shouldn't happen with MAX_PLAYERS = 3), return 0
  return 0;
}

function createPlayerSnake(playerId, playerName, colorIndex) {
  // Use more spaced out positions to avoid early collisions
  const basePositions = [
    { x: Math.floor(GRID_SIZE / 5), y: Math.floor(GRID_SIZE / 5), dir: 'right' },
    { x: Math.floor(GRID_SIZE * 4/5), y: Math.floor(GRID_SIZE / 5), dir: 'left' },
    { x: Math.floor(GRID_SIZE / 2), y: Math.floor(GRID_SIZE * 4/5), dir: 'up' }
  ];

  const position = basePositions[colorIndex % basePositions.length];

  return {
    id: playerId,
    name: playerName,
    colorIndex: colorIndex, // Store the color index
    snake: {
      body: [
        { x: position.x, y: position.y },
        { x: position.x - (position.dir === 'right' ? 1 : position.dir === 'left' ? -1 : 0), 
          y: position.y - (position.dir === 'up' ? -1 : position.dir === 'down' ? 1 : 0) },
        { x: position.x - (position.dir === 'right' ? 2 : position.dir === 'left' ? -2 : 0), 
          y: position.y - (position.dir === 'up' ? -2 : position.dir === 'down' ? 2 : 0) }
      ],
      direction: position.dir,
      pendingDirection: position.dir,
      color: PLAYER_COLORS[colorIndex],
      alive: true,
      score: 0,
      hasMovedSinceStart: false // Track if the snake has moved since game start
    }
  };
}

// Count active players
function countActivePlayers(game) {
  return Object.keys(game.players).length;
}

// Safely get player by ID (handles if player ID doesn't exist)
function getPlayerById(game, playerId) {
  if (!game || !game.players || !game.players[playerId]) {
    return null;
  }
  return game.players[playerId];
}

// Update player data without creating a new player
function updateExistingPlayer(game, playerId, playerName) {
  const player = game.players[playerId];
  if (!player) return false;
  
  // Update player name if it changed
  if (player.name !== playerName) {
    player.name = playerName;
  }
  
  return true;
}

// Calculate remaining grace period in seconds
function getRemainingGraceSeconds(ticksSinceStart) {
  const ticksRemaining = Math.max(0, GRACE_PERIOD_TICKS - ticksSinceStart);
  return Math.ceil(ticksRemaining * (GAME_SPEED / 1000)); // Convert ticks to seconds and round up
}

// Log the game state (for debugging)
function logGameState(game) {
  console.log("Game state:");
  console.log("- Players:", Object.keys(game.players).length);
  console.log("- Running:", game.running);
  console.log("- Game Over:", game.gameOver);
  console.log("- Ticks since start:", game.ticksSinceStart);
  console.log("- Grace period remaining:", getRemainingGraceSeconds(game.ticksSinceStart) + " seconds");
  console.log("- Food count:", game.food.length);
  
  for (const playerId in game.players) {
    const player = game.players[playerId];
    console.log(`- Player ${player.name}:`, 
                `Color: ${player.snake.color}`,
                `Direction: ${player.snake.direction}`,
                `Has moved: ${player.snake.hasMovedSinceStart}`,
                `Alive: ${player.snake.alive}`);
  }
}

// Socket connection handling
io.on('connection', (socket) => {
  console.log('New client connected:', socket.id);

  // Handle player joining a game
  socket.on('joinGame', (data) => {
    const { gameId, playerName } = data;

    // Create new game if it doesn't exist
    if (!games[gameId]) {
      games[gameId] = createNewGame(gameId);
    }

    const game = games[gameId];
    
    // Check if player is already in the game (reconnection)
    const existingPlayer = getPlayerById(game, socket.id);
    if (existingPlayer) {
      console.log(`Player ${playerName} (${socket.id}) is reconnecting to game ${gameId}`);
      updateExistingPlayer(game, socket.id, playerName);
      socket.join(gameId);
      playerSockets[socket.id] = gameId;
      
      // Send current game state to reconnected player
      socket.emit('gameState', {
        players: game.players,
        food: game.food,
        running: game.running,
        ticksSinceStart: game.ticksSinceStart,
        graceSeconds: getRemainingGraceSeconds(game.ticksSinceStart)
      });
      
      // If game is already running, notify this player
      if (game.running) {
        socket.emit('gameStarted');
      }
      
      return;
    }
    
    // Check if game is full - only for new players, not reconnections
    const activePlayerCount = countActivePlayers(game);
    if (activePlayerCount >= MAX_PLAYERS && !game.gameOver) {
      socket.emit('gameFull');
      return;
    }
    
    // If the game is in "game over" state, allow rejoining
    if (game.gameOver) {
      // Allow rejoining in game over state regardless of player count
      game.gameFullCounter++; // Increment the counter to track rejoin attempts
      
      // If we have enough rejoin attempts, consider doing a reset
      if (game.gameFullCounter >= activePlayerCount) {
        console.log(`Auto-resetting game ${gameId} after all players rejoined`);
        resetGameState(game, gameId);
      }
    }

    // Get the first available color
    const colorIndex = getAvailableColorIndex(game);
    
    // Create player and add to game
    const player = createPlayerSnake(socket.id, playerName, colorIndex);
    game.players[socket.id] = player;
    game.playerCount = countActivePlayers(game);
    game.dirtyState = true; // Mark state as changed

    // Associate socket with game
    playerSockets[socket.id] = gameId;

    // Join socket room for this game
    socket.join(gameId);

    console.log(`Player ${playerName} joined game ${gameId} with color index ${colorIndex}`);

    // Notify all players about the new player
    io.to(gameId).emit('playerJoined', {
      players: game.players,
      running: game.running
    });

    // Create initial food if this is the first player
    if (game.playerCount === 1 && game.food.length === 0) {
      createFood(game);
      createFood(game);
    }

    // Send current game state to new player
    socket.emit('gameState', {
      players: game.players,
      food: game.food,
      running: game.running,
      ticksSinceStart: game.ticksSinceStart,
      graceSeconds: getRemainingGraceSeconds(game.ticksSinceStart)
    });
    
    // If game is already running, notify this player
    if (game.running) {
      socket.emit('gameStarted');
    }
    
    // Log the current game state
    logGameState(game);
  });

  // Handle player direction change
  socket.on('changeDirection', (direction) => {
    const gameId = playerSockets[socket.id];
    if (!gameId || !games[gameId]) return;

    const game = games[gameId];
    if (!game.running) return; // Don't process input if game isn't running
    
    const player = game.players[socket.id];
    if (!player || !player.snake.alive) return;

    // Check if direction is valid (not opposite of current)
    const currentDir = player.snake.direction;
    if ((currentDir === 'up' && direction === 'down') ||
        (currentDir === 'down' && direction === 'up') ||
        (currentDir === 'left' && direction === 'right') ||
        (currentDir === 'right' && direction === 'left')) {
      return;
    }

    // Only mark state as dirty if direction is actually changing
    if (player.snake.pendingDirection !== direction) {
      player.snake.pendingDirection = direction;
      player.snake.hasMovedSinceStart = true; // Mark that player has moved
      game.dirtyState = true; // Mark state as changed since direction changed
    }
  });

  // Handle game start request
  socket.on('startGame', () => {
    const gameId = playerSockets[socket.id];
    if (!gameId || !games[gameId]) return;

    const game = games[gameId];

    // Don't start if already running
    if (game.running) return;
    
    // Reset game over state if start is requested
    if (game.gameOver) {
      game.gameOver = false;
      game.gameFullCounter = 0;
    }

    // Reset tick counter for grace period
    game.ticksSinceStart = 0;
    
    // Reset the "hasMovedSinceStart" flag for all players
    for (const playerId in game.players) {
      game.players[playerId].snake.hasMovedSinceStart = false;
    }

    game.running = true;
    game.dirtyState = true; // Mark state as changed
    game.lastUpdateTime = Date.now();

    // Start game update loop
    game.interval = setInterval(() => updateGame(gameId), GAME_SPEED);

    console.log(`Game ${gameId} started by ${socket.id}`);

    // Notify all players that game has started
    io.to(gameId).emit('gameStarted', {
      graceSeconds: GRACE_PERIOD_SECONDS
    });
  });
  
  // Function to reset game state (used by resetGame and after game over)
  function resetGameState(game, gameId) {
    // Stop the game loop if it's running
    if (game.interval) {
      clearInterval(game.interval);
      game.interval = null;
    }
    
    // Reset player snakes to starting positions while keeping their colors
    let index = 0;
    for (const playerId in game.players) {
      const player = game.players[playerId];
      const colorIndex = player.colorIndex;
      
      const basePositions = [
        { x: Math.floor(GRID_SIZE / 5), y: Math.floor(GRID_SIZE / 5), dir: 'right' },
        { x: Math.floor(GRID_SIZE * 4/5), y: Math.floor(GRID_SIZE / 5), dir: 'left' },
        { x: Math.floor(GRID_SIZE / 2), y: Math.floor(GRID_SIZE * 4/5), dir: 'up' }
      ];
      
      const position = basePositions[colorIndex % basePositions.length];
      
      // Reset the snake
      player.snake = {
        body: [
          { x: position.x, y: position.y },
          { x: position.x - (position.dir === 'right' ? 1 : position.dir === 'left' ? -1 : 0), 
            y: position.y - (position.dir === 'up' ? -1 : position.dir === 'down' ? 1 : 0) },
          { x: position.x - (position.dir === 'right' ? 2 : position.dir === 'left' ? -2 : 0), 
            y: position.y - (position.dir === 'up' ? -2 : position.dir === 'down' ? 2 : 0) }
        ],
        direction: position.dir,
        pendingDirection: position.dir,
        color: PLAYER_COLORS[colorIndex],
        alive: true,
        score: 0,
        hasMovedSinceStart: false
      };
      
      index++;
    }
    
    // Reset game state
    game.food = [];
    game.running = false;
    game.gameOver = false; // Clear game over flag
    game.gameFullCounter = 0; // Reset counter
    game.ticksSinceStart = 0;
    game.dirtyState = true; // Mark state as changed
    
    // Create new food
    createFood(game);
    createFood(game);
    
    // Notify all players of the reset
    io.to(gameId).emit('gameReset', {
      players: game.players,
      food: game.food,
      running: false,
      ticksSinceStart: 0,
      graceSeconds: GRACE_PERIOD_SECONDS
    });
    
    // Log the reset game state
    logGameState(game);
  }
  
  // Handle game reset request
  socket.on('resetGame', () => {
    const gameId = playerSockets[socket.id];
    if (!gameId || !games[gameId]) return;

    const game = games[gameId];
    
    console.log(`Game ${gameId} reset requested by ${socket.id}`);
    
    resetGameState(game, gameId);
  });

  // Handle player disconnection
  socket.on('disconnect', () => {
    const gameId = playerSockets[socket.id];
    if (!gameId || !games[gameId]) return;

    const game = games[gameId];

    console.log(`Player ${socket.id} disconnected from game ${gameId}`);

    // Remove player from game
    delete game.players[socket.id];
    const activePlayerCount = countActivePlayers(game);
    game.playerCount = activePlayerCount;
    game.dirtyState = true; // Mark state as changed

    // Delete game if no players left
    if (activePlayerCount === 0) {
      if (game.interval) {
        clearInterval(game.interval);
      }
      delete games[gameId];
      console.log(`Game ${gameId} removed - no players left`);
    } else {
      // Notify remaining players
      io.to(gameId).emit('playerLeft', socket.id);
    }

    // Clean up socket mapping
    delete playerSockets[socket.id];
  });
});

// Game update logic
function updateGame(gameId) {
  const game = games[gameId];
  if (!game || !game.running) return;

  // Increment tick counter
  game.ticksSinceStart++;
  
  // Check if we need to create food (with reduced probability to avoid flickering)
  if (game.food.length < MAX_FOOD && Math.random() < 0.02) {
    createFood(game);
  }

  // Get directions
  const directions = {
    up: { x: 0, y: -1 },
    right: { x: 1, y: 0 },
    down: { x: 0, y: 1 },
    left: { x: -1, y: 0 }
  };

  // Flag to track if any state has changed that requires an update
  let stateChanged = game.dirtyState;

  // Only check for game over after the grace period
  if (game.ticksSinceStart > GRACE_PERIOD_TICKS) {
    // Check if game is over (0-1 players alive)
    const livingPlayers = Object.values(game.players).filter(p => p.snake.alive);
    
    // Only end the game if there's more than 1 player, and only 0-1 players are alive
    if (livingPlayers.length <= 1 && countActivePlayers(game) > 1) {
      // Game over
      const winner = livingPlayers.length === 1 ? livingPlayers[0] : null;

      // Set game over state
      game.gameOver = true;
      game.gameFullCounter = 0; // Reset counter for rejoins

      io.to(gameId).emit('gameOver', {
        winner: winner ? winner.id : null,
        winnerName: winner ? winner.name : null,
        players: game.players,
        ticksSinceStart: game.ticksSinceStart
      });

      game.running = false;
      clearInterval(game.interval);
      game.interval = null;
      console.log(`Game ${gameId} over. Winner: ${winner ? winner.name : 'None'}`);
      return;
    }
  }

  // Process each player's move
  for (const playerId in game.players) {
    const player = game.players[playerId];
    if (!player.snake.alive) continue;

    // Check if direction changed
    if (player.snake.direction !== player.snake.pendingDirection) {
      player.snake.direction = player.snake.pendingDirection;
      stateChanged = true;
    }

    // Calculate new head position
    const head = { ...player.snake.body[0] };
    const dir = directions[player.snake.direction];
    const newHead = {
      x: head.x + dir.x,
      y: head.y + dir.y
    };

    // Check for wall collisions
    if (newHead.x < 0 || newHead.x >= GRID_SIZE || 
        newHead.y < 0 || newHead.y >= GRID_SIZE) {
      player.snake.alive = false;
      console.log(`Player ${player.name} hit wall and died`);
      stateChanged = true;
      continue;
    }

    // Check for collisions with other snakes
    // Skip collision check during grace period or if player hasn't moved yet
    let collision = false;
    if (game.ticksSinceStart > GRACE_PERIOD_TICKS) {
      for (const otherId in game.players) {
        const other = game.players[otherId];
        if (!other.snake.alive) continue;

        // Don't check collision with self during initial movement
        if (otherId === playerId && !player.snake.hasMovedSinceStart) continue;

        for (let i = 0; i < other.snake.body.length; i++) {
          // Skip the tail of the same snake as it will move (unless eating food)
          if (otherId === playerId && i === other.snake.body.length - 1) continue;

          if (newHead.x === other.snake.body[i].x &&
              newHead.y === other.snake.body[i].y) {
            collision = true;
            break;
          }
        }

        if (collision) break;
      }
    }

    if (collision) {
      player.snake.alive = false;
      console.log(`Player ${player.name} collided with snake and died`);
      stateChanged = true;
      continue;
    }

    // Check for food collision
    let ate = false;
    for (let i = 0; i < game.food.length; i++) {
      if (newHead.x === game.food[i].x && newHead.y === game.food[i].y) {
        // Remove the eaten food
        game.food.splice(i, 1);
        ate = true;
        player.snake.score += 10;
        console.log(`Player ${player.name} ate food, score: ${player.snake.score}`);
        stateChanged = true;
        
        // Create new food with a slight delay to avoid immediate rendering issues
        setTimeout(() => {
          if (game && game.running && game.food.length < MAX_FOOD) {
            createFood(game);
          }
        }, 200);
        
        break;
      }
    }
 
    // Move the snake (always changes state)
    player.snake.body.unshift(newHead);
    if (!ate) {
      // Remove tail if no food was eaten
      player.snake.body.pop();
    }
    stateChanged = true;
  }

  // Only send update if state has changed
  if (stateChanged) {
    // Reset dirty state flag
    game.dirtyState = false;
    
    // Calculate remaining grace period in seconds for client UI
    const graceSeconds = getRemainingGraceSeconds(game.ticksSinceStart);
    
    // Send updated game state to all players
    io.to(gameId).emit('gameUpdate', {
      players: game.players,
      food: game.food,
      running: game.running,
      ticksSinceStart: game.ticksSinceStart,
      graceSeconds: graceSeconds
    });
  }
}

// Start server
const PORT = process.env.PORT || 10555;
server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  console.log(`Grace period set to ${GRACE_PERIOD_SECONDS} seconds (${GRACE_PERIOD_TICKS} ticks)`);
});
