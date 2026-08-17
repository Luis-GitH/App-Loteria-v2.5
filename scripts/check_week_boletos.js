import mariadb from 'mariadb';
import dotenv from 'dotenv';
const envPath = process.env.ENV_FILE || '.env_family';
dotenv.config({ path: envPath });
(async () => {
  const pool = mariadb.createPool({
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_DATABASE,
    connectionLimit: 2,
  });
  const conn = await pool.getConnection();
  try {
    const rows = await conn.query(
      `SELECT s.*, p.joker, p.combinacion FROM sorteos s LEFT JOIN primitiva p ON p.identificador = s.identificadorBoleto WHERE s.fecha BETWEEN ? AND ?`,
      ['2026-04-06','2026-04-12']
    );
    console.log('sorteos rows:', rows);
  } catch (e) { console.error(e); }
  finally { try { conn.release(); await pool.end(); } catch {} }
})();
