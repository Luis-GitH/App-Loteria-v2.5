import dotenv from "dotenv";
import mariadb from "mariadb";
import { obtenerJokerPrimitivaPorFecha } from "../src/modules/scrapers/primitiva.js";

const variants = process.argv.slice(2).filter((arg) => !arg.startsWith("--"));
const targets = variants.length ? variants : ["cre", "family"];
const dryRun = process.argv.includes("--dry-run");

for (const variant of targets) {
  const env = {};
  dotenv.config({ path: `.env_${variant}`, processEnv: env, override: true, quiet: true });
  const pool = mariadb.createPool({
    host: env.DB_HOST === "localhost" ? "127.0.0.1" : env.DB_HOST,
    socketPath: env.DB_SOCKET || "/run/mysqld/mysqld.sock",
    user: env.DB_USER,
    password: env.DB_PASSWORD,
    database: env.DB_DATABASE,
    connectionLimit: 1,
  });

  let conn;
  try {
    conn = await pool.getConnection();
    const rows = await conn.query(
      `SELECT id, sorteo, fecha
         FROM r_primitiva
        WHERE joker IS NULL OR joker NOT REGEXP '^[0-9]{7}$'
        ORDER BY fecha`
    );
    let updated = 0;
    const unresolved = [];

    for (const row of rows) {
      const fecha = row.fecha instanceof Date
        ? [
            row.fecha.getFullYear(),
            String(row.fecha.getMonth() + 1).padStart(2, "0"),
            String(row.fecha.getDate()).padStart(2, "0"),
          ].join("-")
        : String(row.fecha).slice(0, 10);
      const joker = await obtenerJokerPrimitivaPorFecha(fecha);
      if (!joker) {
        unresolved.push(`${fecha} (sorteo ${row.sorteo})`);
        continue;
      }
      if (!dryRun) {
        await conn.query("UPDATE r_primitiva SET joker=? WHERE id=?", [joker, row.id]);
      }
      updated += 1;
      console.log(`${variant}: ${fecha} (sorteo ${row.sorteo}) -> ${joker}${dryRun ? " [simulación]" : ""}`);
    }

    console.log(`${variant}: ${updated}/${rows.length} Joker recuperados.`);
    if (unresolved.length) console.log(`${variant}: sin resolver: ${unresolved.join(", ")}`);
  } finally {
    if (conn) conn.release();
    await pool.end();
  }
}
