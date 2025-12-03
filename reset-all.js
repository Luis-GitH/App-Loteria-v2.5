// reset-all.v2.js last va ok
import dotenv from "dotenv";
import fs from "fs";
import path from "path";
import mariadb from "mariadb";
import { scrapeResultadosEuromillonesByFecha, 
         scrapePremiosEuromillonesByFecha
 } from "./src/modules/scrapers/euromillones.js";
import {
  scrapeResultadosPrimitivaByFecha,
  scrapePremiosPrimitivaByFecha,
} from "./src/modules/scrapers/primitiva.js";
import {
  scrapeResultadosGordoYear,
  scrapePremiosGordoByFecha,
} from "./src/modules/scrapers/gordo.js";
import { fechaISO, mondayOf, addDays, weekday } from "./src/helpers/fechas.js";

const ROOT = path.resolve();
const DATA_DIR = path.join(ROOT, "src", "data");

const args = process.argv.slice(2);
const yearArg = args.find((a) => a.startsWith("--year="));
const ANIO = yearArg ? Number(yearArg.split("=")[1]) : new Date().getFullYear();
const variantArgRaw = args.find((a) => ["--cre", "--family", "--all"].includes(a.toLowerCase()) || a.toLowerCase().startsWith("--variant="));
const variantsFromArg = (() => {
  if (!variantArgRaw) return null;
  if (variantArgRaw === "--all") return ["cre", "family"];
  if (variantArgRaw === "--cre") return ["cre"];
  if (variantArgRaw === "--family") return ["family"];
  if (variantArgRaw.startsWith("--variant=")) {
    const v = variantArgRaw.split("=")[1]?.trim().toLowerCase();
    if (v === "all") return ["cre", "family"];
    if (v === "cre" || v === "family") return [v];
  }
  return null;
})();

function printHelpAndExit() {
  console.log(`Uso: node reset-all.js --cre|--family|--all [--year=YYYY]

Opciones:
  --cre         Ejecuta el reset/scrape para la variante CRE (carga .env_cre)
  --family      Ejecuta para la variante FAMILY (carga .env_family)
  --all         Ejecuta para ambas variantes (cre y family) secuencialmente
  --year=YYYY   Año a procesar (por defecto, año actual)
  --help        Muestra esta ayuda
`);
  process.exit(1);
}

if (args.includes("--help") || !variantsFromArg) {
  printHelpAndExit();
}

let pool;

function loadEnvForVariant(variant) {
  dotenv.config({ path: ".env", override: false });
  const variantFile = `.env_${variant}`;
  if (fs.existsSync(variantFile)) {
    dotenv.config({ path: variantFile, override: true });
  }
  process.env.APP_VARIANT = variant;
}

function createPoolFromEnv() {
  return mariadb.createPool({
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_DATABASE,
    connectionLimit: 5,
  });
}

// ========= utils =========
function ensureDir(p) {
  if (!fs.existsSync(p)) fs.mkdirSync(p, { recursive: true });
}
function saveJSON(file, items) {
  ensureDir(DATA_DIR);
  fs.writeFileSync(file, JSON.stringify(items, null, 2), "utf8");
  console.log(`📁 JSON: ${path.basename(file)} (${items.length})`);
}
async function truncateTables(conn) {
  const tabs = ["r_euromillones", "r_primitiva", "r_gordo", "premios_sorteos"];
  for (const t of tabs) {
    try {
      await conn.query(`TRUNCATE TABLE ${t}`);
      console.log(`🧹 TRUNCATE ${t}`);
    } catch (e) {
      console.warn(`⚠️ No se pudo truncar ${t}: ${e.message}`);
    }
  }
}
function normalizarSorteoNNN(valor) {
  if (!valor) return "";
  const m = valor.toString().match(/\d+/);
  return m ? m[0].padStart(3, "0") : valor;
}
async function delay(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function ensureUltimosPrimiDelAnio(conn, anio, prArray) {
  // Asegura que los sorteos de la semana actual (dentro del año) queden en BD/array
  const hoy = new Date();
  const hoyISO = fechaISO(hoy);
  const lunes = mondayOf(hoyISO);
  const candidatas = [lunes, addDays(lunes, 3), addDays(lunes, 5)]; // lun, jue, sáb
  const faltan = [];
  for (const f of candidatas) {
    const y = Number(f.slice(0,4));
    if (y !== anio) continue;
    if (![1,4,6].includes(weekday(f))) continue;
    if (prArray.some(x => x.fecha === f)) continue;
    faltan.push(f);
  }
  const extras = [];
  for (const f of faltan) {
    try {
      const ok = await scrapeResultadosPrimitivaByFecha(f); // inserta en BD si existe
      if (!ok) continue;
      const rows = await conn.query(`SELECT semana, sorteo, fecha, numeros, complementario, reintegro FROM r_primitiva WHERE fecha = ? LIMIT 1`, [f]);
      if (!rows.length) continue;
      const r = rows[0];
      extras.push({
        semana: r.semana,
        sorteo: (r.sorteo || '').toString(),
        fecha: fechaISO(new Date(r.fecha)),
        numeros: (r.numeros || '').toString().split(',').map(x=>x.trim()).filter(Boolean),
        complementario: (r.complementario || '').toString(),
        reintegro: (r.reintegro || '').toString(),
      });
    } catch {}
  }
  // Merge sin duplicados por fecha
  const byFecha = new Map(prArray.map(x => [x.fecha, x]));
  for (const e of extras) byFecha.set(e.fecha, e);
  return Array.from(byFecha.values()).sort((a,b)=> (a.fecha < b.fecha ? -1 : a.fecha > b.fecha ? 1 : 0));
}

// ========= inserts resultados =========
async function insertEuromillones(conn, items) {
  for (const r of items) {
    await conn.query(
      `INSERT INTO r_euromillones (semana, sorteo, fecha, numeros, estrellas, elMillon)
       VALUES (?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE
         semana=VALUES(semana),
         sorteo=VALUES(sorteo),
         fecha=VALUES(fecha),
         numeros=VALUES(numeros),
         estrellas=VALUES(estrellas),
         elMillon=VALUES(elMillon)`,
      [r.semana, r.sorteo, r.fecha, r.numeros.join(","), r.estrellas.join(","), r.elMillon]
    );
  }
}
async function insertPrimitiva(conn, items) {
  for (const r of items) {
    await conn.query(
      `INSERT INTO r_primitiva (semana, sorteo, fecha, numeros, complementario, reintegro)
       VALUES (?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE
         semana=VALUES(semana),
         sorteo=VALUES(sorteo),
         fecha=VALUES(fecha),
         numeros=VALUES(numeros),
         complementario=VALUES(complementario),
         reintegro=VALUES(reintegro)`,
      [r.semana, r.sorteo, r.fecha, r.numeros.join(","), r.complementario, r.reintegro]
    );
  }
}
async function insertGordo(conn, items) {
  for (const r of items) {
    // Semana = nº de sorteo (no ISO)
    const semana = Number(r.sorteo);
    await conn.query(
      `INSERT INTO r_gordo (semana, sorteo, fecha, numeros, numeroClave)
       VALUES (?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE
         semana=VALUES(semana),
         sorteo=VALUES(sorteo),
         fecha=VALUES(fecha),
         numeros=VALUES(numeros),
         numeroClave=VALUES(numeroClave)`,
      [semana, r.sorteo, r.fecha, r.numeros.join(","), r.numeroClave]
    );
  }
}

// ========= inserts premios =========
async function insertPremiosLote(conn, tipoApuesta, sorteo, fechaISO, premios) {
  for (const p of premios) {
    await conn.query(
      `INSERT INTO premios_sorteos
       (tipoApuesta, sorteo, fecha, categoria, aciertos, premio, premio_text)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE
         categoria=VALUES(categoria),
         aciertos=VALUES(aciertos),
         premio=VALUES(premio),
         premio_text=VALUES(premio_text)`,
      [
        tipoApuesta,
        sorteo,
        fechaISO,
        p.categoria,
        p.aciertos,
        Number(p.premio || 0),
        p.premio_text || "",
      ]
    );
  }
}

// ========= scrape premios por cada resultado =========
async function precargarPremiosEuromillones(conn, resultados) {
  console.log(`💶 Premios Euromillones: ${resultados.length} sorteos...`);
  for (const s of resultados) {
    const fechaISO = s.fecha;              // "yyyy-MM-dd"
    const sorteoNNN = normalizarSorteoNNN(s.sorteo); // "NNN"
    try {
      const premios = await scrapePremiosEuromillonesByFecha(fechaISO);
      if (premios.length) {
        await insertPremiosLote(conn, "euromillones", sorteoNNN, fechaISO, premios);
        console.log(`   ✅ ${sorteoNNN} (${fechaISO}) → ${premios.length} categorías`);
      } else {
        console.log(`   ⚠️ ${sorteoNNN} (${fechaISO}) → 0 categorías`);
      }
    } catch (e) {
      console.warn(`   ❌ ${sorteoNNN} (${fechaISO}) → ${e.message}`);
    }
    await delay(150); // cortesía
  }
}

async function precargarPremiosPrimitiva(conn, resultados) {
  console.log(`💶 Premios Primitiva: ${resultados.length} sorteos...`);
  for (const s of resultados) {
    const fechaISO = s.fecha;     // "yyyy-MM-dd"
    const sorteoNNN = normalizarSorteoNNN(s.sorteo);  // "NNN"
    try {
      const premios = await scrapePremiosPrimitivaByFecha(fechaISO);
      if (premios.length) {
        await insertPremiosLote(conn, "primitiva", sorteoNNN, fechaISO, premios);
        console.log(`   ✅ ${sorteoNNN} (${fechaISO}) → ${premios.length} categorías`);
      } else {
        console.log(`   ⚠️ ${sorteoNNN} (${fechaISO}) → 0 categorías`);
      }
    } catch (e) {
      console.warn(`   ❌ ${sorteoNNN} (${fechaISO}) → ${e.message}`);
    }
    await delay(150);
  }
}

async function precargarPremiosGordo(conn, resultados) {
  console.log(`💶 Premios Gordo: ${resultados.length} sorteos...`);
  for (const s of resultados) {
    const fechaISO = s.fecha;              // "yyyy-MM-dd"
    const sorteoNNN = normalizarSorteoNNN(s.sorteo); // "NNN"
    try {
      const premios = await scrapePremiosGordoByFecha(fechaISO);
      if (premios.length) {
        await insertPremiosLote(conn, "gordo", sorteoNNN, fechaISO, premios);
        console.log(`   ✅ ${sorteoNNN} (${fechaISO}) → ${premios.length} categorías`);
      } else {
        console.log(`   ⚠️ ${sorteoNNN} (${fechaISO}) → 0 categorías`);
      }
    } catch (e) {
      console.warn(`   ❌ ${sorteoNNN} (${fechaISO}) → ${e.message}`);
    }
    await delay(150);
  }
}

// ========= main =========
async function runVariant(variant) {
  console.log('\n==> Variante ' + variant.toUpperCase() + ' · Año ' + ANIO);
  loadEnvForVariant(variant);
  pool = createPoolFromEnv();
  const conn = await pool.getConnection();
  try {
    await truncateTables(conn);

    console.log('?? Scrape RESULTADOS...');
    let [eu, pr, go] = await Promise.all([
      scrapeResultadosEuromillonesByFecha(ANIO),
      scrapeResultadosPrimitivaByFecha(ANIO),
      scrapeResultadosGordoYear(ANIO),
    ]);

    // Asegurar últimos sorteos de Primitiva si el histórico aún no los refleja
    pr = await ensureUltimosPrimiDelAnio(conn, ANIO, pr);

    // Guardar JSON de resultados
    saveJSON(path.join(DATA_DIR, 'resultados-euromillones-' + ANIO + '.json'), eu);
    saveJSON(path.join(DATA_DIR, 'resultados-primitiva-' + ANIO + '.json'), pr);
    saveJSON(path.join(DATA_DIR, 'resultados-gordo-' + ANIO + '.json'), go);

    console.log('?? Insertando RESULTADOS en BD...');
    await insertEuromillones(conn, eu);
    await insertPrimitiva(conn, pr);
    await insertGordo(conn, go);

    console.log('?? Scrape PREMIOS (todas las fechas del año)...');
    await precargarPremiosEuromillones(conn, eu);
    await precargarPremiosPrimitiva(conn, pr);
    await precargarPremiosGordo(conn, go);

    console.log('\n?? RESET + RESULTADOS + PREMIOS (ano completo) cargados. Listo.');
  } catch (e) {
    console.error('? Error reset-all:', e.stack || e.message);
  } finally {
    conn.release();
    try {
      await pool.end();
    } catch {}
  }
}

(async () => {
  for (const variant of variantsFromArg) {
    await runVariant(variant);
  }
  process.exit(0);
})();
