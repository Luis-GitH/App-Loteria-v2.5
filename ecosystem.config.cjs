// ecosystem.config.js
module.exports = {
  apps: [
    {
      name: 'app-cre',
      script: './server.js',
      watch: ['server.js'], //, 'src', 'views', 'public'],
      ignore_watch: [
        'node_modules',
        'logs',
        'data',
        '*.log',
        '*.tmp'],
      cwd: './', // raíz del proyecto
      time: true,
      wait_ready: true,
      listen_timeout: 10000,
      kill_timeout: 5000,
      error_file: "./logs/cre-errores.log",
      out_file: "./logs/cre-out.log",
      env: {
        NODE_ENV: 'production',
        ENV_FILE: '.env_cre',      // para que la app cargue este env específico
        APP_VARIANT: 'cre'
      }
    },
    {
      name: 'app-family',
      script: './server.js',
      watch: ['server.js'],  // 'src', 'views', 'public'],
      ignore_watch: [
        'node_modules',
        'logs',
        'data',
        '*.log',
        '*.tmp'],
      cwd: './',
      time: true,
      wait_ready: true,
      listen_timeout: 10000,
      kill_timeout: 5000,
      error_file: "./logs/family-errores.log",
      out_file: "./logs/family-out.log",
      env: {
        NODE_ENV: 'production',
        ENV_FILE: '.env_family',
        APP_VARIANT: 'family'
      }
    },
    {
      name: "update-today",
      script: "update-today.js",
      args: "--all",
      cwd: './',
      cron_restart: "30 22 * * *", // todos los disa  a las 22:30
      autorestart: false,
      
    },

  ],
};
