module.exports = {
  apps: [
    {
      name: 'marketplayer-mcp',
      script: 'dist/mcp/server.js',
      cwd: '/Users/zhengzefeng/.openclaw/workspace/MarketPlayer',
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: '500M',
      env: {
        NODE_ENV: 'production',
        MCP_SERVER_PORT: '3100'
      },
      error_file: './logs/pm2-mcp-error.log',
      out_file: './logs/pm2-mcp-out.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss',
      max_restarts: 10,
      min_uptime: '10s',
      restart_delay: 1000
    }
  ]
};