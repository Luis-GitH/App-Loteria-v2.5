#!/usr/bin/env node
import 'dotenv/config';
import axios from 'axios';
import * as cheerio from 'cheerio';
import mariadb from 'mariadb';
import { mondayOf, addDays, weekday } from '../src/helpers/fechas.js';

const HEADERS = { 'User-Agent':'Mozilla/5.0', 'Accept-Language':'es-ES,es;q=0.9' };
const meses = ['','enero','febrero','marzo','abril','mayo','junio','julio','agosto','septiembre','octubre','noviembre','diciembre'];
function fechaES(iso){ const [Y,M,D]=iso.split('-'); return `${Number(D)} de ${meses[Number(M)]} de ${Y}`; }

async function pageMatchesDate(iso){
  const [Y,M,D] = iso.split('-');
  const day = new Date(Number(Y),Number(M)-1,Number(D)).getDay();
  const slug = ['domingo','lunes','martes','miercoles','jueves','viernes','sabado'][day];
  const dia = `${D}-${M}-${Y}`;
  const urls = [
    `https://www.laprimitiva.info/loteriaprimitiva/Sorteo-${dia}-${slug}.html`,
    `https://www.laprimitiva.info/loteriaprimitiva/Sorteo-${dia}-lunes.html`,
    `https://www.laprimitiva.info/loteriaprimitiva/Sorteo-${dia}-jueves.html`,
    `https://www.laprimitiva.info/loteriaprimitiva/Sorteo-${dia}-sabado.html`,
  ];
  for (const u of urls){
    try {
      const {data:html} = await axios.get(u,{ headers: HEADERS, timeout: 15000 });
      const $ = cheerio.load(html);
      const meta = $('meta[name="Description"], meta[name="description"]').attr('content')||'';
      if (meta.toLowerCase().includes(fechaES(iso))) return true;
    } catch {}
  }
  return false;
}

const today = new Date();
const monday = mondayOf(today);
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
    const ok = await pageMatchesDate(f);
    console.log('Check', f, 'pageMatchesDate=', ok);
    if (!ok){
      const r = await conn.query(`DELETE FROM r_primitiva WHERE fecha = ?`, [f]);
      console.log('Purged', f, 'rows:', r.affectedRows);
    } else {
      console.log('OK date present', f);
    }
  }
} finally {
  try { conn.release(); await pool.end(); } catch {}
}
