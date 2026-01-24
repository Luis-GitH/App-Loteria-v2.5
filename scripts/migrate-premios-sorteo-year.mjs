#!/usr/bin/env node
import dotenv from "dotenv";
import { existsSync } from "fs";
import mariadb from "mariadb";

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
    const [countRow] = await conn.query(
      `SELECT COUNT(*) AS n
       FROM premios_sorteos
       WHERE sorteo REGEXP '^[0-9]{1,3}$'`
    );
    const total = Number(countRow?.n || 0);
    console.log(`\n== ${envPath} ==`);
    if (!total) {
      console.log("No hay sorteos numericos para migrar.");
      return;
    }
    console.log(`Filas a migrar: ${total}`);
    const res = await conn.query(
      `UPDATE premios_sorteos
       SET sorteo = CONCAT(YEAR(fecha), '/', LPAD(sorteo, 3, '0'))
       WHERE sorteo REGEXP '^[0-9]{1,3}$'`
    );
    console.log(`Actualizadas: ${res.affectedRows || 0}`);
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
      console.error(`Error migrando con ${envPath}:`, err.message || err);
      process.exitCode = 1;
    }
  }
}
