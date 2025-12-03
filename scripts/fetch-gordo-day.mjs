#!/usr/bin/env node
import 'dotenv/config';
import mariadb from 'mariadb';
import { getISOWeek } from 'date-fns';
import { scrapeResultadoGordoDia } from '../src/modules/scrapers/gordo.js';
import { ensureAppTimezone, todayISO, parseISODateLocal } from '../src/helpers/fechas.js';

ensureAppTimezone();

const fecha = process.argv.find(a=>a.startsWith('--fecha='))?.split('=')[1] || todayISO();
if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha)) { console.error('Uso: fetch-gordo-day --fecha=YYYY-MM-DD'); process.exit(1); }

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
    const items = await scrapeResultadoGordoDia(fecha);
    if (!items.length) { console.error('No se pudo obtener resultado para', fecha); process.exit(2); }
    for (const r of items) {
      const week = getISOWeek(parseISODateLocal(fecha));
      const sorteo = (r.sorteo && r.sorteo.trim()) ? r.sorteo : String(week).padStart(3, '0');
      await conn.query(
        `INSERT INTO r_gordo (semana, sorteo, fecha, numeros, numeroClave)
         VALUES (?, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE numeros=VALUES(numeros), numeroClave=VALUES(numeroClave)`,
        [week, sorteo, fecha, r.numeros.join(','), r.numeroClave]
      );
      console.log('Resultado guardado:', { semana: week, sorteo, fecha, numeros: r.numeros.join(','), numeroClave: r.numeroClave });
    }
  } catch (e) {
    console.error('Error:', e.message);
    process.exit(3);
  } finally {
    try { conn.release(); await pool.end(); } catch {}
  }
})();
