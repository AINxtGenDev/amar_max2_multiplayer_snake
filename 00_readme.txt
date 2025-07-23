
1) strongly recommend using nvm - Node Version Manager
   open terminal:
   curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.7/install.sh | bash
   
2) Load nvm into the current shell session
   source ~/.bashrc

3) install the latest LTS version of Node.js
   nvm install --lts

4) Verify the installation
   node -v  # Should show a version like v22.17.x
   npm -v   # Should show a version like v10.9.x
   npx -v   # Should show the same version as npm

5) cd /home/stecher
   git clone https://github.com/AINxtGenDev/amar_max2_multiplayer_snake.git

6) cd amar_max2_multiplayer_snake
   Create the package.json File
   npm init -y

   npm install express socket.io cors --save

   we need following directory structure:
   ======================================
   /home/stecher/amar_max2_multiplayer_snake/
   |
   |-- server.js
   |-- package.json
   |-- README.md
   |-- assets/          <-- this folder is still for multimedia and not necessary
   |-- ... (other files)
   |
   |-- public/
   |   |-- index.html
   |   |-- game.js
   |   |-- lucky_duck_2.png
   |   |-- amar_max2_group.gif
   |
   |-- duckdns/          <-- this folder is for duckdns domain amarmax.duckdns.org
       |-- snakegame.sh
       |-- ducksnakegame.log

7) Audit your dependencies for known vulnerabilities
   npm audit

8) For Production (Strongly Recommended):
   install PM2. It's a process manager that will keep your game running in the background,
   restart it automatically if it crashes, and enable it to restart after a system reboot.
   npm install pm2 -g
   
9) Start your application with PM2:
   pm2 start server.js --name snake-game
   
   pm2 restart snake-game
   
10) Ensure PM2 runs on system startup
    pm2 startup

11) Save the current process so it's restored after a reboot
    pm2 save
    
12) Monitor in production:
    pm2 monitor
    
    bucket: snake-game

    https://app.pm2.io/#/bucket/6880be570bfa918d9307bf80

13) pm2 logs snake-game

14) caddy
 /etc/caddy/Caddyfile
# =================================================================
# Caddyfile: Production Configuration
# Manages all services hosted on this server.
# =================================================================

# -----------------------------------------------------------------
# Service 1: Multiplayer Snake Game
# Domain: https://amarmax.duckdns.org:10556
# -----------------------------------------------------------------
amarmax.duckdns.org:10556 {
    # Automatic HTTPS using Let's Encrypt.
    # An email is best practice for certificate issuance and recovery.
    tls otto.kuegerl@gmail.com

    # Dedicated log file for the snake game for easier debugging.
    log {
        output file /var/log/caddy/snake-game.log
        level INFO
    }

    # Reverse proxy all requests to the Node.js application running on port 10555.
    reverse_proxy localhost:10555 {
        # These headers are critical for WebSocket proxying (used by Socket.IO).
        # They ensure the backend application receives the correct host and IP info.
        header_up Host {http.request.host}
        header_up X-Real-IP {http.request.remote}
        header_up X-Forwarded-For {http.request.remote}
        header_up X-Forwarded-Proto {http.request.scheme}
    }
}

15) https://amarmax.duckdns.org:10556
