import dotenv from 'dotenv';
dotenv.config({ path: process.env.ENV_FILE || '.env' });
import mariadb from 'mariadb';

const pool = mariadb.createPool({
  host: process.env.DB_HOST,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_DATABASE,
  connectionLimit: 1,
});

async function main(){
  const conn = await pool.getConnection();
  try{
    const lunes='2026-06-15', domingo='2026-06-21';
    const id = 'TEST-PR-2026-06-15-1';
    const rows = await conn.query(
      `SELECT s.*, b.imagen, b.combinacion, b.estrellas, b.reintegro, b.clave, b.joker
       FROM sorteos s
       JOIN (
         SELECT identificador AS identificadorBoleto, imagen, combinacion, NULL AS estrellas, reintegro, NULL AS clave, joker
         FROM primitiva
         UNION ALL
         SELECT identificador, imagen, combinacion, estrellas, NULL AS reintegro, NULL AS clave, NULL AS joker
         FROM euromillones
         UNION ALL
         SELECT identificador, imagen, combinacion, NULL AS estrellas, NULL AS reintegro, clave, NULL AS joker
         FROM gordo
       ) b ON b.identificadorBoleto = s.identificadorBoleto
       WHERE s.identificadorBoleto=? AND s.fecha BETWEEN ? AND ?
       ORDER BY s.tipoApuesta, s.fecha, s.sorteo`,
      [id, lunes, domingo]
    );
    console.log(JSON.stringify(rows, null, 2));
  }catch(e){ console.error(e); }finally{ try{ await pool.end(); }catch(e){} }
}

main();
