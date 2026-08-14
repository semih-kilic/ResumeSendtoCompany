// PM2 Ecosystem Configuration — 7/24 Immortal Mode
// Ensures the Autonomous Outreach Engine never stops running.

module.exports = {
  apps: [
    {
      name: 'autonomous-outreach-system',
      script: 'server.js',
      cwd: __dirname,
      
      // === Auto-Restart & Recovery ===
      autorestart: true,
      watch: false,
      max_restarts: 50,
      min_uptime: '10s',
      restart_delay: 3000,
      
      // === Memory Protection ===
      max_memory_restart: '512M',
      
      // === Environment ===
      node_args: '--max-old-space-size=512',
      env: {
        NODE_ENV: 'production',
        PORT: 3002
      },

      // === Logging ===
      error_file: './data/logs/pm2-error.log',
      out_file: './data/logs/pm2-out.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
      merge_logs: true,
      
      // === Crash Recovery ===
      exp_backoff_restart_delay: 1000,
      
      // === Graceful Shutdown ===
      kill_timeout: 10000,
      listen_timeout: 15000,
    }
  ]
};
