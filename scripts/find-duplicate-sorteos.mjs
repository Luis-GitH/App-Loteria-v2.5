#!/usr/bin/env node
import dotenv from "dotenv";
import { existsSync } from "fs";
import mariadb from "mariadb";

function fmtRow(row) {
  return {
    tipoApuesta: row.tipoApuesta,
    sorteo: row.sorteo,
    fechas: row.fechas,
    años: row.anios,
    registros: Number(row.total_registros || 0),
    dias: Number(row.total_fechas || 0),
  };
}

function resolveEnvPaths() {
  const candidates = [];
  const explicit = process.env.ENV_FILE || process.env.DOTENV_CONFIG_PATH;
  if (explicit) candidates.push(explicit);
  if (existsSync(".env_cre")) candidates.push(".env_cre");
  if (existsSync(".env_family")) candidates.push(".env_family");
 // if (existsSync(".env")) candidates.push(".env");
  return Array.from(new Set(candidates));
}

async function runForEnv(envPath) {
  dotenv.config({ path: envPath, override: true });
  const pool = mariadb.createPool({
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_DATABASE,
    port: process.env.DB_PORT ? Number(process.env.DB_PORT) : 3306,
    connectionLimit: 2,
  });
  const conn = await pool.getConnection();
  try {
    const rows = await conn.query(
      `SELECT tipoApuesta,
              sorteo,
              COUNT(*) AS total_registros,
              COUNT(DISTINCT DATE(fecha)) AS total_fechas,
              GROUP_CONCAT(DISTINCT DATE_FORMAT(fecha, '%Y-%m-%d') ORDER BY fecha DESC SEPARATOR ', ') AS fechas,
              GROUP_CONCAT(DISTINCT YEAR(fecha) ORDER BY YEAR(fecha) DESC SEPARATOR ', ') AS anios
       FROM premios_sorteos
       GROUP BY tipoApuesta, sorteo
       HAVING COUNT(DISTINCT DATE(fecha)) > 1
       ORDER BY tipoApuesta, sorteo`
    );
    console.log(`\n== ${envPath} ==`);
    if (!rows.length) {
      console.log("No hay sorteos duplicados en premios_sorteos.");
    } else {
      console.log("Sorteos duplicados en premios_sorteos (mismo sorteo en varias fechas):");
      console.table(rows.map(fmtRow));
    }
  } finally {
    try {
      conn.release();
      await pool.end();
    } catch {}
  }
}

const envPaths = resolveEnvPaths();
if (!envPaths.length) {
  console.error("No se encontraron ficheros .env para cargar la configuracion.");
  process.exitCode = 1;
} else {
  for (const envPath of envPaths) {
    try {
      await runForEnv(envPath);
    } catch (err) {
      console.error(`Error detectando duplicados con ${envPath}:`, err.message || err);
      process.exitCode = 1;
    }
  }
}
