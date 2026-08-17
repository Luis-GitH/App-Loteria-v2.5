import mariadb from 'mariadb';
import dotenv from 'dotenv';
const envPath = process.env.ENV_FILE || '.env_family';
dotenv.config({ path: envPath });
const [,, fecha, joker] = process.argv;
if (!fecha || !joker) {
  console.error('Uso: node set_joker_r_primitiva.js YYYY-MM-DD JOKER_VALUE');
  process.exit(1);
}
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
    const res = await conn.query("UPDATE r_primitiva SET joker=? WHERE fecha=?", [joker, fecha]);
    console.log('updated:', res);
    const rows = await conn.query("SELECT id,sorteo,fecha,joker FROM r_primitiva WHERE fecha=?", [fecha]);
    console.log('rows:', rows);
  } catch (e) { console.error(e); }
  finally { try { conn.release(); await pool.end(); } catch {} }
})();
