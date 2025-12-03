#!/usr/bin/env node
import 'dotenv/config';

import mariadb from 'mariadb';
import { mondayOf, addDays, weekday } from '../src/helpers/fechas.js';

const monday = mondayOf(new Date());
const fechas = [monday, addDays(monday,3), addDays(monday,5)];

const pool = mariadb.createPool({
  host: process.env.DB_HOST,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_DATABASE,
  connectionLimit: 2,
});
const conn = await pool.getConnection();
try {
  for (const f of fechas){
    if (![1,4,6].includes(weekday(f))) continue;
    const rows = await conn.query(`SELECT id, fecha, sorteo FROM r_primitiva WHERE DATE(fecha) = ? ORDER BY id`, [f]);
    if (rows.length <= 1) continue;
    // elegir sorteo máximo por valor numérico
    let best = rows[0];
    for (const r of rows){
      const n = parseInt((r.sorteo||'').toString().replace(/^0+/,''), 10);
      const bn = parseInt((best.sorteo||'').toString().replace(/^0+/,''), 10);
      if (Number.isFinite(n) && (!Number.isFinite(bn) || n > bn)) best = r;
    }
    const keepNNN = (best.sorteo||'').toString().padStart(3,'0');
    // actualizar premios a NNN elegido
    await conn.query(`UPDATE premios_sorteos SET sorteo=? WHERE tipoApuesta='primitiva' AND DATE(fecha)=?`, [keepNNN, f]);
    // eliminar otros rows de esa fecha
    for (const r of rows){
      const nnn = (r.sorteo||'').toString().padStart(3,'0');
      if (nnn !== keepNNN){
        await conn.query(`DELETE FROM r_primitiva WHERE id = ?`, [r.id]);
        console.log('Deleted duplicate r_primitiva id', r.id, 'fecha', f, 'sorteo', nnn);
      }
    }
    console.log('Kept fecha', f, 'sorteo', keepNNN);
  }
} finally { try{ conn.release(); await pool.end(); } catch{} }
