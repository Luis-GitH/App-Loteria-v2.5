// ==========    V2    ==================================================
// 📦 boletosToDB.js —
// MariaDB con 4 tablas (Primitiva, Euromillones, Gordo, Sorteos)
// ============================================================

import inicializaDB from "./inicializarDataBase.js";
import { ensureAppTimezone, nowDateTimeISO } from "../helpers/fechas.js";

ensureAppTimezone();

if (await !inicializaDB()) {
    console.error("❌ No se pudo inicializar la base de datos.");
    process.exit(1);
}
import fse from "fs-extra";
import path from "path";
// import { fileURLToPath } from "url";
import mariadb from "mariadb";
// --- Conexión MariaDB ---
const pool = mariadb.createPool({
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_DATABASE,
    connectionLimit: 5,
});
const ROOT = path.resolve();
const APP_VARIANT = (
    process.env.APP_VARIANT ||
    (process.env.PM2_APP_NAME &&
    process.env.PM2_APP_NAME.startsWith("app-")
        ? process.env.PM2_APP_NAME.slice(4)
        : process.env.PM2_APP_NAME) ||
    "cre"
).toLowerCase();
const PROCESADOS_DIR = path.join(ROOT, "src", "procesadosQR");
const HISTORICO_DIR = path.join(ROOT, "src", `historico-${APP_VARIANT}`);
await fse.ensureDir(HISTORICO_DIR);
// ============================================================
// 🧱 Inicializar BD con las 4 tablas
// ============================================================

// ============================================================
// 💾 Insertar boleto y sorteos asociados
// ============================================================
export async function guardarBoletoProcesado(boleto) {
    const conn = await pool.getConnection();
    try {
        await conn.beginTransaction();
        const ahora = nowDateTimeISO();
        switch (boleto.tipo.toLowerCase()) {
            case "primitiva":
                await conn.query(
                    `REPLACE INTO primitiva
          (identificador, sorteoCodigo, fechaLunes, combinacion, reintegro,
           semanas, terminal, joker, imagen)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                    [
                        boleto.identificador,
                        boleto.sorteoCodigo,
                        boleto.fechaLunes,
                        boleto.combinacion,
                        boleto.reintegro || null,
                        boleto.semanas || 1,
                        boleto.terminal || null,
                        boleto.joker || null,
                        boleto.imagen || null,
                    ]
                );
                break;

            case "euromillones":
                await conn.query(
                    `REPLACE INTO euromillones
          (identificador, sorteoCodigo, fechaLunes, combinacion, estrellas,
           millon, semanas, terminal, imagen)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                    [
                        boleto.identificador,
                        boleto.sorteoCodigo,
                        boleto.fechaLunes,
                        boleto.combinacion,
                        boleto.estrellas || null,
                        boleto.millon || null,
                        boleto.semanas || 1,
                        boleto.terminal || null,
                        boleto.imagen || null,
                    ]
                );
                break;

            case "gordo":
                await conn.query(
                    `REPLACE INTO gordo
          (identificador, sorteoCodigo, fechaLunes, combinacion, clave,
           semanas, terminal, imagen)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
                    [
                        boleto.identificador,
                        boleto.sorteoCodigo,
                        boleto.fechaLunes,
                        boleto.combinacion,
                        boleto.clave || null,
                        boleto.semanas || 1,
                        boleto.terminal || null,
                        boleto.imagen || null,
                    ]
                );
                break;

            default:
                throw new Error(`Tipo de boleto desconocido: ${boleto.tipo}`);
        }

        // --- Insertar sorteos asociados ---
        if (Array.isArray(boleto.sorteos)) {
            for (const s of boleto.sorteos) {
                await conn.query(
                    `INSERT INTO sorteos
            (identificadorBoleto, tipoApuesta, sorteo, fecha, dia, lunesSemana)
           VALUES (?, ?, ?, ?, ?, ?)
           ON DUPLICATE KEY UPDATE
             tipoApuesta=VALUES(tipoApuesta),
             sorteo=VALUES(sorteo),
             fecha=VALUES(fecha),
             dia=VALUES(dia),
             lunesSemana=VALUES(lunesSemana)`,
                    [
                        boleto.identificador,
                        boleto.tipo,
                        s.sorteo,
                        s.fecha,
                        s.dia,
                        s.lunesSemana,
                    ]
                );
            }
        }

        await conn.commit();
        console.log(
            `💾 Guardado boleto ${boleto.identificador} (${boleto.tipo})`
        );
    } catch (err) {
        await conn.rollback();
        console.error("❌ Error guardando boleto:", err.message);
    } finally {
        conn.release();
    }
}

// ============================================================
// 📂 Procesar boletos desde /procesados json to DB
// ============================================================
export async function procesarBoletosDesdeJSON(sendToDB, processQR) {
    const archivos = fse
        .readdirSync(PROCESADOS_DIR)
        .filter((f) => f.endsWith(".json"));
        if (archivos.length === 0) {
            console.log("⚠️ No hay boletos JSON en /procesadosQR.");
            return;
        }
        console.log("🚀 ~ procesarBoletosDesdeJSON ~ archivos:", archivos)
    // ====================================================================
    // 3️⃣ Inicializar DB (solo si se pasa --db sin --qr)
    // ====================================================================
    if (sendToDB && !processQR) {
        console.log("🧱 Inicializando base de datos MariaDB...");
        await inicializaDB();
        console.log("✅ Base de datos lista.");
    }
    console.log(
        `📄 Insertando ${archivos.length} boletos desde /procesadosQR...`
    );
    for (const file of archivos) {
        const filePath = path.join(PROCESADOS_DIR, file);
        const data = JSON.parse(fse.readFileSync(filePath, "utf8"));

        // Normalizar imagen a ruta web /historico/<nombre>
        const imgBase = path.basename((data.imagen || '').toString());
        if (imgBase) {
            data.imagen = /historico/;
        }

        await guardarBoletoProcesado(data);

        // Mover imagen si existe en /procesadosQR
        if (imgBase) {
            const srcImg = path.join(PROCESADOS_DIR, imgBase);
            const dstImg = path.join(HISTORICO_DIR, imgBase);
            try {
                if (fse.existsSync(srcImg)) {
                    await fse.move(srcImg, dstImg, { overwrite: true });
                }
            } catch (_) {}
        }

        // mover a histórico
        const destino = path.join(HISTORICO_DIR, file);
        await fse.move(filePath, destino, { overwrite: true });
    }

    console.log("🎯 Inserción completada. Archivos movidos a /historico.");
}

// ============================================================
// 🧹 Cerrar pool
// ============================================================
export async function cerrarPool() {
    await pool.end();
    console.log("🔒 Pool MariaDB cerrado.");
}
