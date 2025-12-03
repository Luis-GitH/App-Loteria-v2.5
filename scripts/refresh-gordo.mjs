#!/usr/bin/env node
import 'dotenv/config';
import mariadb from 'mariadb';
import { scrapePremiosGordoByFecha } from '../src/modules/scrapers/gordo.js';
import { getArg } from './lib/cli.mjs';

const sorteoArg = getArg('sorteo');
const fechaArg = getArg('fecha');
if (!fechaArg){
  console.error('Uso: refresh-gordo --fecha=YYYY-MM-DD [--sorteo=NNN]');
  process.exit(1);
}

const pool = mariadb.createPool({
  host: process.env.DB_HOST,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_DATABASE,
  connectionLimit: 5,
});

(async()=>{
  const conn = await pool.getConnection();
  try {
    const premios = await scrapePremiosGordoByFecha(fechaArg);
    if (!premios || premios.length===0){
      console.error('No se pudieron obtener premios del scrape.');
      process.exit(2);
    }
    let sorteoKey = sorteoArg;
    if (!sorteoKey){
      const [row] = await conn.query("SELECT sorteo FROM r_gordo WHERE fecha=? LIMIT 1", [fechaArg]);
      sorteoKey = (row?.sorteo || '').toString().padStart(3,'0');
    }
    if (!sorteoKey){
      console.error('No se pudo determinar el sorteo (NNN). Use --sorteo=NNN');
      process.exit(3);
    }
    await conn.query("DELETE FROM premios_sorteos WHERE tipoApuesta='gordo' AND (sorteo=? OR fecha=?)", [sorteoKey, fechaArg]);
    for (const it of premios){
      await conn.query(
        `INSERT INTO premios_sorteos (tipoApuesta, sorteo, fecha, categoria, aciertos, premio, premio_text)
         VALUES (?, ?, ?, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE premio=VALUES(premio), premio_text=VALUES(premio_text)`,
        ['gordo', sorteoKey, fechaArg, it.categoria, it.aciertos || '', Number(it.premio || it.premio_num || 0), it.premio_text || String(it.premio || it.premio_num || 0)]
      );
    }
    console.log(`Actualizado gordo sorteo=${sorteoKey} fecha=${fechaArg} con ${premios.length} filas.`);
  } catch (e) {
    console.error('Error:', e.message);
  } finally {
    try{ conn.release(); await pool.end(); }catch{}
  }
})();
