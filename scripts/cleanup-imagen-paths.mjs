#!/usr/bin/env node
/**
 * 🧹 cleanup-imagen-paths.mjs
 * Limpia rutas de imagen en BD (elimina /historico/ prefix, deja solo basename)
 * Ejecuta en ambas variantes: cre y family
 */

import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import mariadb from 'mariadb';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, '..');

// Cargar .env base
dotenv.config({ path: path.join(ROOT, '.env'), override: false });

// Variantes a procesar
const VARIANTS = ['cre', 'family'];

// ============================================================
// SQLs de limpieza
// ============================================================
const CLEANUP_QUERIES = [
  {
    name: 'primitiva',
    query: `UPDATE primitiva
      SET imagen = SUBSTRING_INDEX(REPLACE(imagen, CHAR(92), '/'), '/', -1)
      WHERE imagen IS NOT NULL 
        AND imagen <> '' 
        AND (imagen LIKE '/historico/%' OR imagen LIKE '%/%');`
  },
  {
    name: 'euromillones',
    query: `UPDATE euromillones
      SET imagen = SUBSTRING_INDEX(REPLACE(imagen, CHAR(92), '/'), '/', -1)
      WHERE imagen IS NOT NULL 
        AND imagen <> '' 
        AND (imagen LIKE '/historico/%' OR imagen LIKE '%/%');`
  },
  {
    name: 'gordo',
    query: `UPDATE gordo
      SET imagen = SUBSTRING_INDEX(REPLACE(imagen, CHAR(92), '/'), '/', -1)
      WHERE imagen IS NOT NULL 
        AND imagen <> '' 
        AND (imagen LIKE '/historico/%' OR imagen LIKE '%/%');`
  }
];

// ============================================================
// Verificación post-limpieza
// ============================================================
const VERIFY_QUERIES = [
  {
    name: 'primitiva_verify',
    query: `SELECT COUNT(*) AS total, 
           SUM(CASE WHEN imagen IS NOT NULL AND imagen <> '' THEN 1 ELSE 0 END) AS con_imagen,
           GROUP_CONCAT(DISTINCT imagen LIMIT 3) AS sample
           FROM primitiva;`
  },
  {
    name: 'euromillones_verify',
    query: `SELECT COUNT(*) AS total, 
           SUM(CASE WHEN imagen IS NOT NULL AND imagen <> '' THEN 1 ELSE 0 END) AS con_imagen,
           GROUP_CONCAT(DISTINCT imagen LIMIT 3) AS sample
           FROM euromillones;`
  },
  {
    name: 'gordo_verify',
    query: `SELECT COUNT(*) AS total, 
           SUM(CASE WHEN imagen IS NOT NULL AND imagen <> '' THEN 1 ELSE 0 END) AS con_imagen,
           GROUP_CONCAT(DISTINCT imagen LIMIT 3) AS sample
           FROM gordo;`
  }
];

// ============================================================
// Funciones
// ============================================================

function readEnvFile(filePath) {
  try {
    const raw = require('fs').readFileSync(filePath);
    return dotenv.parse(raw);
  } catch {
    return {};
  }
}

function buildEnvForVariant(variant) {
  const base = readEnvFile(path.join(ROOT, '.env'));
  const variantFile = path.join(ROOT, `.env_${variant}`);
  const variantEnv = readEnvFile(variantFile);
  return {
    ...base,
    ...process.env,
    ...variantEnv,
    APP_VARIANT: variant,
  };
}

async function createPoolForVariant(variant) {
  const env = buildEnvForVariant(variant);
  return mariadb.createPool({
    host: env.DB_HOST,
    user: env.DB_USER,
    password: env.DB_PASSWORD,
    database: env.DB_DATABASE,
    dateStrings: true,
    connectionLimit: 2,
  });
}

async function cleanupVariant(variant) {
  console.log(`\n${'='.repeat(60)}`);
  console.log(`🧹 Limpiando variante: ${variant.toUpperCase()}`);
  console.log('='.repeat(60));

  const pool = await createPoolForVariant(variant);
  const conn = await pool.getConnection();

  try {
    await conn.beginTransaction();

    // Ejecutar updates
    for (const { name, query } of CLEANUP_QUERIES) {
      console.log(`\n📝 Ejecutando limpieza en tabla: ${name}...`);
      try {
        const result = await conn.query(query);
        console.log(`✅ Filas afectadas: ${result.affectedRows}`);
      } catch (err) {
        console.error(`❌ Error en ${name}:`, err.message);
        throw err;
      }
    }

    await conn.commit();
    console.log('\n✅ Transacción confirmada (COMMIT)');

    // Verificación
    console.log('\n📊 VERIFICACIÓN POST-LIMPIEZA:');
    console.log('-'.repeat(60));
    for (const { name, query } of VERIFY_QUERIES) {
      try {
        const results = await conn.query(query);
        const row = results[0];
        console.log(`\n📋 ${name.replace('_verify', '').toUpperCase()}:`);
        console.log(`   Total registros: ${row.total}`);
        console.log(`   Con imagen: ${row.con_imagen}`);
        console.log(`   Sample: ${row.sample || 'N/A'}`);
      } catch (err) {
        console.error(`❌ Error verificando ${name}:`, err.message);
      }
    }
  } catch (err) {
    await conn.rollback();
    console.error('\n❌ Error - Rollback ejecutado');
    throw err;
  } finally {
    conn.release();
    await pool.end();
  }
}

async function main() {
  console.log('\n╔════════════════════════════════════════════════════════════╗');
  console.log('║  🧹 LIMPIEZA DE RUTAS DE IMAGEN EN BD                      ║');
  console.log('║     Elimina /historico/ prefix, deja solo basename          ║');
  console.log('╚════════════════════════════════════════════════════════════╝');

  const startTime = Date.now();

  try {
    for (const variant of VARIANTS) {
      try {
        await cleanupVariant(variant);
      } catch (err) {
        console.error(`\n❌ FALLO EN VARIANTE ${variant}:`, err.message);
        process.exit(1);
      }
    }

    const elapsed = ((Date.now() - startTime) / 1000).toFixed(2);
    console.log(`\n${'='.repeat(60)}`);
    console.log('✅ ¡LIMPIEZA COMPLETADA EXITOSAMENTE!');
    console.log(`⏱️  Tiempo total: ${elapsed}s`);
    console.log('='.repeat(60) + '\n');
  } catch (err) {
    console.error('\n❌ ERROR FATAL:', err.message);
    process.exit(1);
  }
}

// Ejecutar
main().catch(err => {
  console.error(err);
  process.exit(1);
});
