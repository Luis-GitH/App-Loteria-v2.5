import dotenv from 'dotenv';
dotenv.config({ path: process.env.ENV_FILE || '.env' });
import mariadb from 'mariadb';
const pool = mariadb.createPool({ host: process.env.DB_HOST, user: process.env.DB_USER, password: process.env.DB_PASSWORD, database: process.env.DB_DATABASE, connectionLimit: 1 });
(async ()=>{
  const conn = await pool.getConnection();
  try{
    const rows = await conn.query(`SELECT * FROM r_primitiva WHERE fecha=?`, ['2026-06-15']);
    console.log(JSON.stringify(rows, null, 2));
  }catch(e){ console.error(e); }finally{ try{ await pool.end(); }catch(e){} }
})();
