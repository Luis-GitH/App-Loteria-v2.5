#!/usr/bin/env node
import 'dotenv/config';
import mariadb from 'mariadb';
import { mondayOf, addDays } from '../src/helpers/fechas.js';

const monday = mondayOf(new Date());
const sunday = addDays(monday,6);

const pool = mariadb.createPool({
  host: process.env.DB_HOST,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_DATABASE,
  connectionLimit: 2,
});
const conn = await pool.getConnection();
try {
  const rows = await conn.query(`SELECT fecha,sorteo,numeros,complementario,reintegro FROM r_primitiva WHERE fecha BETWEEN ? AND ? ORDER BY fecha`, [monday, sunday]);
  console.log(rows);
} finally { try{ conn.release(); await pool.end(); }catch{} }
