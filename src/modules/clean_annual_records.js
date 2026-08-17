import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import mariadb from 'mariadb';

function normalizeVariant(variant) {
  return String(variant || 'cre').toLowerCase();
}

function resolveEnvPath(variant) {
  const normalized = normalizeVariant(variant);
  if (normalized === 'family') return '.env_family';
  return '.env_cre';
}

function buildCutoffDate(year) {
  const normalizedYear = Number(year);
  if (!Number.isInteger(normalizedYear) || normalizedYear < 2000) {
    throw new Error('El año debe ser un entero válido (por ejemplo 2025).');
  }
  return `${normalizedYear}-12-31`;
}

function collectHistoricDirs(rootDir, variant) {
  const normalized = normalizeVariant(variant);
  return [
    path.join(rootDir, 'data', `historico-${normalized}`),
    path.join(rootDir, 'data', 'historico'),
  ].filter((dir, index, arr) => dir && arr.indexOf(dir) === index);
}

function deleteHistoricFiles(rootDir, variant, year) {
  const removed = [];
  const cutoffYear = Number(year);
  for (const dir of collectHistoricDirs(rootDir, variant)) {
    if (!fs.existsSync(dir)) continue;
    for (const entry of fs.readdirSync(dir)) {
      const fullPath = path.join(dir, entry);
      if (!fs.statSync(fullPath).isFile()) continue;
      const match = entry.match(/^Boleto_(\d{4})-/);
      if (match && Number(match[1]) <= cutoffYear) {
        fs.unlinkSync(fullPath);
        removed.push(fullPath);
      }
    }
  }
  return removed;
}

export async function limpiarRegistrosAnteriores({
  year = 2025,
  variants = null,
  rootDir = path.resolve(),
  dryRun = false,
} = {}) {
  const targetVariants = Array.isArray(variants) && variants.length
    ? variants.map(normalizeVariant)
    : [normalizeVariant(process.env.APP_VARIANT || 'cre')];

  const cutoffDate = buildCutoffDate(year);
  const results = [];

  for (const variant of targetVariants) {
    const envPath = resolveEnvPath(variant);
    dotenv.config({ path: envPath, override: true });

    const pool = mariadb.createPool({
      host: process.env.DB_HOST,
      user: process.env.DB_USER,
      password: process.env.DB_PASSWORD,
      database: process.env.DB_DATABASE,
      connectionLimit: 2,
    });

    const conn = await pool.getConnection();
    try {
      const tables = [
        {
          table: 'sorteos',
          query: 'DELETE FROM sorteos WHERE fecha <= ? OR lunesSemana <= ?',
          params: [cutoffDate, cutoffDate],
        },
        {
          table: 'primitiva',
          query: 'DELETE FROM primitiva WHERE fechaLunes <= ?',
          params: [cutoffDate],
        },
        {
          table: 'euromillones',
          query: 'DELETE FROM euromillones WHERE fechaLunes <= ?',
          params: [cutoffDate],
        },
        {
          table: 'gordo',
          query: 'DELETE FROM gordo WHERE fechaLunes <= ?',
          params: [cutoffDate],
        },
      ];

      const affectedByTable = {};
      for (const item of tables) {
        if (dryRun) {
          affectedByTable[item.table] = 0;
          continue;
        }
        const res = await conn.query(item.query, item.params);
        affectedByTable[item.table] = Number(res?.affectedRows || 0);
      }

      const removedFiles = dryRun
        ? []
        : deleteHistoricFiles(rootDir, variant, year);

      results.push({
        variant,
        database: process.env.DB_DATABASE,
        cutoffDate,
        affectedByTable,
        filesRemoved: removedFiles,
        dryRun,
      });
    } finally {
      conn.release();
      await pool.end();
    }
  }

  return results;
}
