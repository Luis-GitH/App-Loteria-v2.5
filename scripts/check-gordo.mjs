#!/usr/bin/env node
import 'dotenv/config';
import mariadb from 'mariadb';
import { scrapePremiosGordoByFecha } from '../src/modules/scrapers/gordo.js';
import { getArg } from './lib/cli.mjs';

const sorteoArg = getArg('sorteo', '041');
const fechaArg = getArg('fecha', '2025-10-12');

const pool = mariadb.createPool({
  host: process.env.DB_HOST,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_DATABASE,
  connectionLimit: 5,
});

function normalizeOrdinal(cat){
  return (cat||'').toString().replace(/\s+/g,' ').trim();
}

function keyOrdinal(cat){
  const s = (cat||'').toString().trim();
  const m = s.match(/^(\d+)[ªº]/);
  if (m) return `${m[1]}ª`;
  if (/^reintegro/i.test(s)) return 'Reintegro';
  return s;
}

(async()=>{
  const conn = await pool.getConnection();
  try {
    const dbRows = await conn.query(
      "SELECT categoria, aciertos, premio, premio_text, sorteo, DATE_FORMAT(fecha,'%Y-%m-%d') as fecha FROM premios_sorteos WHERE tipoApuesta='gordo' AND (sorteo=? OR fecha=?) ORDER BY categoria",
      [sorteoArg, fechaArg]
    );
    const scraped = await scrapePremiosGordoByFecha(fechaArg);

    const dbMap = new Map();
    dbRows.forEach(r=> dbMap.set(keyOrdinal(r.categoria), r));
    const scMap = new Map();
    scraped.forEach(it=> scMap.set(keyOrdinal(normalizeOrdinal(it.categoria)), it));

    const keys = new Set([...dbMap.keys(), ...scMap.keys()]);
    console.log(`\nGORDO sorteo=${sorteoArg} fecha=${fechaArg}`);
    for (const k of [...keys].sort()){
      const db = dbMap.get(k);
      const sc = scMap.get(k);
      const dbPrem = db? db.premio_text || db.premio: '-';
      const scPrem = sc? sc.premio_text || sc.premio: '-';
      const mark = (db && sc && (String(dbPrem)===String(scPrem))) ? 'OK' : 'DIFF';
      console.log(`${k.padEnd(12)} DB=${String(dbPrem).padEnd(12)} | SCRAPED=${String(scPrem).padEnd(12)}  ${mark}`);
    }
  } catch (e) {
    console.error('Error:', e.message);
  } finally {
    try{ conn.release(); await pool.end(); }catch{}
  }
})();
