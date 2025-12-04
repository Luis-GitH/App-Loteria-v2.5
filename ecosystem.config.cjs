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
        'scr/uploads',
        'src/historico-cre/**',
        'src/historico-family/**',
        'src/procesadosQR/**',
        'src/data/**',
        'src/scans/**',
        '*.log',
        '*.tmp'],
      cwd: './', // raíz del proyecto
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
        'uploads',
        'src/historico-cre/**',
        'src/historico-family/**',
        'src/procesadosQR/**',
        'src/data/**',
        'src/scans/**',
        '*.log',
        '*.tmp'],
      cwd: './',
      error_file: "./logs/family-errores.log",
      out_file: "./logs/family-out.log",
      env: {
        NODE_ENV: 'production',
        ENV_FILE: '.env_family',
        APP_VARIANT: 'family'
      }
    },
    ],
};
