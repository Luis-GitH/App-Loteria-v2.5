import dotenv from 'dotenv';
dotenv.config({ path: process.env.ENV_FILE || '.env' });
import mariadb from 'mariadb';
const pool = mariadb.createPool({ host: process.env.DB_HOST, user: process.env.DB_USER, password: process.env.DB_PASSWORD, database: process.env.DB_DATABASE, connectionLimit: 1 });
(async ()=>{
  const conn = await pool.getConnection();
  try{
    console.log('Query premios_sorteos for tipo=primitiva aciertos=J and sorteo=072 or like \'%/072\'\n');
    let rows = await conn.query("SELECT * FROM premios_sorteos WHERE tipoApuesta='primitiva' AND aciertos='J' ORDER BY fecha DESC, premio DESC LIMIT 50");
    console.log('Found', rows.length);
    console.log(JSON.stringify(rows, null, 2));
    const rows2 = await conn.query("SELECT * FROM premios_sorteos WHERE tipoApuesta='primitiva' AND (sorteo='072' OR sorteo LIKE '%/072') AND aciertos='J' ORDER BY fecha DESC, premio DESC LIMIT 50");
    console.log('Specific sorteo=072 or like %/072 ->', rows2.length);
    console.log(JSON.stringify(rows2, null, 2));
  }catch(e){ console.error(e); }finally{ try{ await pool.end(); }catch(e){} }
})();
