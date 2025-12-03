#!/usr/bin/env node
import 'dotenv/config';
import mariadb from 'mariadb';
import fs from 'fs-extra';
import path from 'path';

async function runMigration() {
  const pool = mariadb.createPool({
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_DATABASE,
    connectionLimit: 3,
  });

  const tables = ['primitiva', 'euromillones', 'gordo'];
  const conn = await pool.getConnection();
  try {
    // Asegurar carpeta destino para estáticos
    const root = path.resolve();
    const historicoDir = path.join(root, 'src', 'historico');
    await fs.ensureDir(historicoDir);
    console.log('Normalizando rutas de imagen a formato /historico/<archivo>');
    for (const table of tables) {
      const [{ total }] = await conn.query(`SELECT COUNT(*) AS total FROM ${table}`);
      const [{ already }] = await conn.query(
        `SELECT COUNT(*) AS already FROM ${table} WHERE imagen LIKE '/historico/%'`
      );
      const [{ pending }] = await conn.query(
        `SELECT COUNT(*) AS pending FROM ${table} WHERE imagen IS NOT NULL AND imagen <> '' AND imagen NOT LIKE '/historico/%'`
      );
      console.log(`- ${table}: total=${total}, ya_normalizadas=${already}, pendientes=${pending}`);

      if (pending > 0) {
        const sql = `
          UPDATE ${table}
          SET imagen = CASE
            WHEN REPLACE(imagen, CHAR(92), '/') LIKE '%/historico/%'
              THEN CONCAT('/historico/', SUBSTRING_INDEX(REPLACE(imagen, CHAR(92), '/'), '/historico/', -1))
            ELSE CONCAT('/historico/', SUBSTRING_INDEX(REPLACE(imagen, CHAR(92), '/'), '/', -1))
          END
          WHERE imagen IS NOT NULL AND imagen <> '' AND imagen NOT LIKE '/historico/%'
        `;
        const result = await conn.query(sql);
        console.log(`  Actualizadas ${result.affectedRows} filas en ${table}`);
      }
    }
    console.log('Hecho.');
  } finally {
    conn.release();
    await pool.end();
  }
}

runMigration().catch((e) => {
  console.error('Error en migración:', e.message);
  process.exit(1);
});
