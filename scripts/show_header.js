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
    for (const s of rows) {
      const nums = (s.numeros||'').split(',').map(x=>x.trim()).filter(Boolean).join(' ');
      const comp = (s.complementario||'').toString();
      const rein = (s.reintegro||'').toString();
      const joker = (s.joker||'').toString().trim();
      const sorteo = (s.sorteo||'').toString().slice(-3).padStart(3,'0');
      const fechaStr = (s.fecha||'').toString().slice(0,10);
      const base = `Sorteo ${sorteo} (${fechaStr}): ${nums} · C:${comp} · R:${rein}`;
      console.log(joker ? `${base} · Joker: ${joker}` : base);
    }
  } catch(e){console.error(e);} finally{ try{ conn.release(); await pool.end(); }catch{} }
})();
