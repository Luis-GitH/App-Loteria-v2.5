// src/config/dbConfig.js

import 'dotenv/config';

export const dbConfig = {
  host: process.env.DB_HOST === 'localhost' ? '127.0.0.1' : process.env.DB_HOST,
  socketPath: '/run/mysqld/mysqld.sock',
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_DATABASE,
  connectionLimit: 5,
};
