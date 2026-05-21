/**
 * ecosystem.config.cjs — PM2 process configuration for Railway / production
 *
 * Usage:
 *   pm2 start ecosystem.config.cjs          # start
 *   pm2 restart justice-gavel-api           # restart
 *   pm2 logs justice-gavel-api              # tail logs
 *   pm2 monit                                # live monitor
 *
 * Railway uses this automatically when RAILWAY_ENVIRONMENT=production
 * and "start": "pm2-runtime start ecosystem.config.cjs" is set in package.json.
 */

module.exports = {
  apps: [{
    name:             'justice-gavel-api',
    script:           './src/server.js',
    interpreter:      'node',
    interpreter_args: '--experimental-vm-modules',

    // ── Clustering ───────────────────────────────────────────
    // Railway Starter: 1 vCPU → instances: process.env.NODE_CLUSTER_WORKERS ? parseInt(process.env.NODE_CLUSTER_WORKERS) : 1, // set NODE_CLUSTER_WORKERS=max on multi-core Railway plan
    // Railway Pro:     2 vCPU → instances: 2
    // Railway Team:    4 vCPU → instances: 'max'
    instances:        1,
    exec_mode:        'fork',   // use 'cluster' when instances > 1

    // ── Restart policy ────────────────────────────────────────
    autorestart:      true,
    watch:            false,    // never watch in production
    max_memory_restart: '512M', // restart if memory exceeds 512MB (Railway Starter limit)
    restart_delay:    2000,     // 2s between restart attempts
    exp_backoff_restart_delay: 100,

    // ── Environment ───────────────────────────────────────────
    env_production: {
      NODE_ENV:    'production',
      NODE_OPTIONS: '--experimental-vm-modules',
      LOG_LEVEL:   'warn',      // suppress info logs in production
      LOG_FORMAT:  'json',      // structured JSON for Railway log drain
    },
    env_development: {
      NODE_ENV:    'development',
      NODE_OPTIONS: '--experimental-vm-modules',
      LOG_LEVEL:   'debug',
    },

    // ── Logging ───────────────────────────────────────────────
    // Railway pipes stdout/stderr to its log system automatically
    // These paths are only used for local PM2 runs
    out_file:   './logs/out.log',
    error_file: './logs/error.log',
    merge_logs: true,
    log_date_format: 'YYYY-MM-DD HH:mm:ss Z',

    // ── Graceful shutdown ─────────────────────────────────────
    // Match the graceful shutdown handler in server.js
    kill_timeout:  10000,   // 10s to finish in-flight requests
    listen_timeout: 5000,   // 5s to bind port before PM2 considers it failed
    shutdown_with_message: true,

    // ── Health check ──────────────────────────────────────────
    // PM2 pings /health every 10s; if no response in 5s → restart
    // Requires: pm2 module pm2-health (optional)
    // min_uptime: '10s',   // must stay up 10s to count as "started"
  }],

  // ── Deploy config (for pm2 deploy — optional, Railway uses Git deploy) ─────
  deploy: {
    production: {
      user:       'railway',
      host:       'RAILWAY_HOST',    // set via Railway env
      ref:        'origin/main',
      repo:       'git@github.com:YOUR_ORG/justice-gavel.git',
      path:       '/app',
      'post-deploy': 'cd backend && npm ci && pm2 reload ecosystem.config.cjs --env production',
    },
  },
};
