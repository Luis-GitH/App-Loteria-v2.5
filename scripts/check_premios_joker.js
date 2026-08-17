import mariadb from 'mariadb';
import dotenv from 'dotenv';
const envPath = process.env.ENV_FILE || '.env_family';
dotenv.config({ path: envPath });
const sorteoNNN = process.argv[2] || '072';
const year = process.argv[3] || '2026';
(async () => {
  const pool = mariadb.createPool({ host: process.env.DB_HOST, user: process.env.DB_USER, password: process.env.DB_PASSWORD, database: process.env.DB_DATABASE, connectionLimit: 2 });
  const conn = await pool.getConnection();
  try {
    console.log('Query: premios_sorteos tipo=primitiva, aciertos=J, sorteo exact', sorteoNNN);
    const rows1 = await conn.query("SELECT id,fecha,sorteo,aciertos,categoria,premio,premio_text FROM premios_sorteos WHERE tipoApuesta='primitiva' AND aciertos='J' AND sorteo=? ORDER BY fecha DESC", [sorteoNNN]);
    console.log('Exact sorteo rows:', rows1);
    console.log('Query: premios_sorteos tipo=primitiva, aciertos=J, sorteo LIKE %/NNN, year', year);
    const rows2 = await conn.query("SELECT id,fecha,sorteo,aciertos,categoria,premio,premio_text FROM premios_sorteos WHERE tipoApuesta='primitiva' AND aciertos='J' AND sorteo LIKE ? AND YEAR(fecha)=? ORDER BY fecha DESC", [`%/${sorteoNNN}`, year]);
    console.log('Like rows:', rows2);
    console.log('Query: any primitiva aciertos=J overall');
    const rows3 = await conn.query("SELECT id,fecha,sorteo,aciertos,categoria,premio,premio_text FROM premios_sorteos WHERE tipoApuesta='primitiva' AND aciertos='J' ORDER BY fecha DESC LIMIT 50");
    console.log('Recent J rows:', rows3);
  } catch(e){ console.error(e);} finally { try{ conn.release(); await pool.end(); } catch {} }
})();
