# 🐍 Multiplayer Snake Competition

<p align="center">
  <img src="./assets/lucky_duck_2.png" alt="Snake Game Logo" width="200">
</p>

<p align="center">
  <strong>A real-time multiplayer Snake game with room-based competition</strong>
</p>

<p align="center">
  <a href="https://nodejs.org/en/"><img src="https://img.shields.io/badge/node-v16.x-brightgreen.svg" alt="Node.js"></a>
  <a href="https://socket.io/"><img src="https://img.shields.io/badge/socket.io-v4.6.0-blue.svg" alt="Socket.IO"></a>
  <a href="https://expressjs.com/"><img src="https://img.shields.io/badge/express-v4.x-lightgrey.svg" alt="Express"></a>
  <a href="#license"><img src="https://img.shields.io/badge/license-MIT-orange.svg" alt="License"></a>
</p>

<p align="center">
  <a href="https://amarmax.duckdns.org:10556">🎮 <strong>Play Now!</strong></a> •
  <a href="#features">Features</a> •
  <a href="#how-to-play">How to Play</a> •
  <a href="#installation">Installation</a> •
  <a href="#deployment">Deployment</a>
</p>

## 📋 Table of Contents

- [About](#about)
- [Features](#features)
- [Demo](#demo)
- [How to Play](#how-to-play)
- [Tech Stack](#tech-stack)
- [Getting Started](#getting-started)
  - [Prerequisites](#prerequisites)
  - [Installation](#installation)
  - [Development](#development)
- [Production Deployment](#production-deployment)
- [Project Structure](#project-structure)
- [Contributing](#contributing)
- [Team](#team)
- [License](#license)

## 📖 About

Multiplayer Snake Competition is a modern take on the classic Snake game, featuring real-time multiplayer gameplay using WebSockets. Players can create or join custom game rooms and compete against up to 2 other players simultaneously. The game includes responsive design, mobile support with touch controls, and synchronized gameplay across all clients.

## ✨ Features

### Core Gameplay
- **Real-time Multiplayer**: Up to 3 players per game room
- **Room System**: Create or join specific game rooms with custom IDs
- **Synchronized Gameplay**: All players see the same game state in real-time
- **Grace Period**: 3-second immunity after game start to prevent early collisions
- **Countdown Timer**: 5-second synchronized countdown before each game

### User Experience
- **Responsive Design**: Fully playable on desktop and mobile devices
- **Touch Controls**: Intuitive touch controls for mobile gameplay
- **Visual Feedback**: Clear game over screens and winner announcements
- **Live Scoreboard**: Real-time score tracking for all players
- **Reconnection Support**: Automatically reconnect if connection is lost

### Technical Features
- **WebSocket Communication**: Low-latency real-time updates
- **Client-side Prediction**: Smooth and responsive controls
- **Anti-cheat Measures**: Server-authoritative game state
- **HTTPS Support**: Secure connection via Caddy reverse proxy

## 🎮 Demo

<p align="center">
  <img src="./assets/game_screenshot.png" alt="Gameplay Screenshot" width="600">
</p>

**🔗 Live Demo: [https://amarmax.duckdns.org:10556](https://amarmax.duckdns.org:10556)**

## 🎯 How to Play

1. **Join a Game**
   - Enter your name (or use auto-generated name)
   - Enter a room ID or use the default room
   - Click "Join Game" to enter the lobby

2. **Start Playing**
   - Wait for other players or click "Start Game" when ready
   - Watch the 5-second countdown
   - Use arrow keys (desktop) or touch controls (mobile) to move
   - Avoid walls and other snakes after the grace period

3. **Win Conditions**
   - Collect food to grow your snake and increase your score
   - Last snake standing wins the round
   - Play again or create a new room for another match

### Controls
- **Desktop**: Arrow keys (↑ ↓ ← →)
- **Mobile**: On-screen directional buttons

## 🛠️ Tech Stack

### Frontend
- HTML5 Canvas for game rendering
- Vanilla JavaScript for game logic
- CSS3 for responsive design
- Socket.IO Client for real-time communication

### Backend
- Node.js runtime environment
- Express.js web framework
- Socket.IO for WebSocket handling
- PM2 for process management

### Infrastructure
- Caddy as reverse proxy with automatic HTTPS
- DuckDNS for dynamic DNS
- Let's Encrypt for SSL certificates

## 🚀 Getting Started

### Prerequisites

- Node.js v14 or higher
- npm (comes with Node.js)
- Git

### Installation

#### 1. Install Node.js using NVM (Recommended)

```bash
# Install NVM
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.7/install.sh | bash

# Load NVM
source ~/.bashrc

# Install latest LTS Node.js
nvm install --lts

# Verify installation
node -v  # Should show v22.17.x or similar
npm -v   # Should show v10.9.x or similar
```

#### 2. Clone the Repository

```bash
cd /home/stecher
git clone https://github.com/AINxtGenDev/amar_max2_multiplayer_snake.git
cd amar_max2_multiplayer_snake
```

#### 3. Install Dependencies

```bash
# Initialize package.json if not present
npm init -y

# Install required packages
npm install express socket.io cors --save

# Audit for vulnerabilities
npm audit
```

### Development

Start the development server:

```bash
# Basic start
node server.js

# With nodemon for auto-restart (install globally first: npm i -g nodemon)
nodemon server.js
```

The game will be available at `http://localhost:10555`

## 🏭 Production Deployment

### Using PM2 Process Manager

1. **Install PM2 globally**
   ```bash
   npm install pm2 -g
   ```

2. **Start the application**
   ```bash
   pm2 start server.js --name snake-game
   ```

3. **Enable startup on system boot**
   ```bash
   pm2 startup
   pm2 save
   ```

4. **Useful PM2 commands**
   ```bash
   pm2 status          # Check application status
   pm2 logs snake-game # View logs
   pm2 restart snake-game # Restart application
   pm2 monitor         # Real-time monitoring dashboard
   ```

### Caddy Configuration

For HTTPS support, configure Caddy as a reverse proxy:

```caddyfile
# /etc/caddy/Caddyfile
amarmax.duckdns.org:10556 {
    tls otto.kuegerl@gmail.com
    
    log {
        output file /var/log/caddy/snake-game.log
        level INFO
    }
    
    reverse_proxy localhost:10555 {
        header_up Host {http.request.host}
        header_up X-Real-IP {http.request.remote}
        header_up X-Forwarded-For {http.request.remote}
        header_up X-Forwarded-Proto {http.request.scheme}
    }
}
```

## 📁 Project Structure

```
amar_max2_multiplayer_snake/
├── server.js              # Main server file with game logic
├── package.json           # Node.js dependencies
├── README.md             # This file
├── public/               # Static files served to client
│   ├── index.html       # Game UI
│   ├── game.js          # Client-side game logic
│   ├── lucky_duck_2.png # Game logo
│   └── amar_max2_group.gif # Team photo
├── assets/              # Additional assets
└── duckdns/            # DuckDNS configuration
    ├── snakegame.sh
    └── ducksnakegame.log
```

## 🤝 Contributing

We welcome contributions! Please feel free to submit a Pull Request. For major changes, please open an issue first to discuss what you would like to change.

1. Fork the repository
2. Create your feature branch (`git checkout -b feature/AmazingFeature`)
3. Commit your changes (`git commit -m 'Add some AmazingFeature'`)
4. Push to the branch (`git push origin feature/AmazingFeature`)
5. Open a Pull Request

## 👥 Team

We're the enthusiastic developers behind this multiplayer Snake game!

<p align="center">
  <img src="assets/amar_max_max_3.png" alt="Team Photo - Developers with 'I like snake game' sign" width="600">
</p>

### Core Contributors

- **Max Steinbauer** - Frontend Development & UI Design
- **Amar Novalic** - Backend & Socket.IO Implementation  
- **Max Gradischnig** - Game Logic & Server Architecture

## 📄 License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## 🙏 Acknowledgements

- [Socket.IO](https://socket.io/) team for their excellent real-time communication library
- The classic Snake game for inspiration
- Our beta testers who helped identify bugs and improve gameplay
- [Node.js](https://nodejs.org/) and [Express](https://expressjs.com/) communities

---

<p align="center">
  Made with ❤️ by the Snake Game Team
</p>
