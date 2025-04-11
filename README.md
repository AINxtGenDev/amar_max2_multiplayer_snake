# Important PM2 Commands

## Basic Commands
#### Start your application
pm2 start server.js --name snake-game

#### Restart your application
pm2 restart snake-game

#### Stop your application
pm2 stop snake-game

### Delete/remove application from PM2
pm2 delete snake-game

### List all running applications
pm2 list

### Display detailed information about a specific application
pm2 show snake-game


## Monitoring & Logs
### Monitor all applications in real-time
pm2 monit

### Display logs of all applications
pm2 logs

### Display only snake-game logs
pm2 logs snake-game

### Display limited number of lines
pm2 logs snake-game --lines 100

### Flush all log data
pm2 flush


## Startup & Auto-Restart
### Generate startup script to automatically start PM2 on system boot
pm2 startup

### Save current PM2 process list for automatic restart
pm2 save

### Restore previously saved processes
pm2 resurrect

## Updates & Reloads
### Reload application with zero downtime
pm2 reload snake-game

### Restart all applications
pm2 restart all

### Update PM2 to the latest version
pm2 update


## Troubleshooting
### Kill PM2 daemon
pm2 kill

### Reset PM2 metadata
pm2 reset snake-game

### View information about your PM2 installation
pm2 env snake-game

