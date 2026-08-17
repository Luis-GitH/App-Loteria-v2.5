import mariadb from 'mariadb';
import dotenv from 'dotenv';

const envPath = process.env.ENV_FILE || (process.env.APP_VARIANT ? `.env_${process.env.APP_VARIANT}` : '.env_cre');
dotenv.config({ path: envPath, override: true });

(async () => {
  const pool = mariadb.createPool({
    host: process.env.DB_HOST === 'localhost' ? '127.0.0.1' : process.env.DB_HOST,
    socketPath: '/run/mysqld/mysqld.sock',
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_DATABASE,
    connectionLimit: 2,
  });
  const conn = await pool.getConnection();
  try {
    const rows = await conn.query("SELECT id, sorteo, fecha, numeros, complementario, reintegro, joker FROM r_primitiva WHERE fecha = ?", ['2026-04-06']);
    console.log('rows:', rows);
  } catch (e) {
    console.error(e);
  } finally {
    try { conn.release(); await pool.end(); } catch {}
  }
})();
