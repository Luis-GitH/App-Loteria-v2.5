import dotenv from 'dotenv';
dotenv.config({ path: process.env.ENV_FILE || '.env' });

const fecha = process.argv[2] || '2026-06-15';

const mariadb = await import('mariadb');
const pool = mariadb.createPool({
  host: process.env.DB_HOST,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_DATABASE,
  connectionLimit: 1,
});

const { getPremios } = await import('../src/helpers/scraperPremios.js');

(async () => {
  const conn = await pool.getConnection();
  try {
    // leer sorteo desde r_primitiva si existe
    const r = await conn.query('SELECT sorteo FROM r_primitiva WHERE fecha=? LIMIT 1', [fecha]);
    const sorteo = (r && r[0] && (r[0].sorteo || r[0].SORTEO)) ? r[0].sorteo : '';
    if (!sorteo) {
      console.error('No se encontró sorteo en r_primitiva para fecha', fecha);
      process.exit(1);
    }

    console.log('Usando sorteo:', sorteo, 'fecha:', fecha);

    const map = await getPremios('primitiva', { sorteo, fecha }, conn);
    console.log('Premios obtenidos en memoria (claves):', Array.from(map.keys()));

    const rows = await conn.query("SELECT categoria, aciertos, premio, premio_text FROM premios_sorteos WHERE tipoApuesta='primitiva' AND sorteo=? AND fecha=? ORDER BY categoria", [sorteo, fecha]);
    console.log('Filas en DB:');
    console.log(rows);
  } catch (e) {
    console.error('ERROR', e);
  } finally {
    try { await conn.release(); await pool.end(); } catch (e) {}
  }
})();
