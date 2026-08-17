import mariadb from 'mariadb';
import dotenv from 'dotenv';
const envPath = process.env.ENV_FILE || '.env_family';
dotenv.config({ path: envPath });
const fecha = process.argv[2] || '2026-06-15';
(async () => {
  const pool = mariadb.createPool({ host: process.env.DB_HOST, user: process.env.DB_USER, password: process.env.DB_PASSWORD, database: process.env.DB_DATABASE, connectionLimit: 2 });
  const conn = await pool.getConnection();
  try {
    const rows = await conn.query('SELECT * FROM r_primitiva WHERE fecha=?', [fecha]);
    console.log(rows);
  } catch(e){console.error(e);} finally{ try{ conn.release(); await pool.end(); }catch{} }
})();
