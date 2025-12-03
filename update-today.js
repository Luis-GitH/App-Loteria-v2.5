#!/usr/bin/env node
/**
 * update-today.js
 * Actualiza resultados y premios SOLO de los sorteos del día actual.
 * - Euromillones: martes y viernes (hoy)
 * - Primitiva: lunes, jueves y sábado (hoy)
 * - Gordo: domingo domingo(hoy))
 *
 * Requiere funciones scraper (ver notas más abajo):
 *   - euromillones.js: scrapeResultadosEuromillonesByFecha, scrapePremiosEuromillonesByFecha
 *   - primitiva.js  : scrapeResultadosPrimitivaByFecha,   scrapePremiosPrimitivaByFecha
 *   - gordo.js      : scrapeResultadosGordoByFecha,       scrapePremiosGordoByFecha
 * 
a revisar erorres aceptados por se avance. 402 etc se atrasa la fecha para todos los sorteos y ojo vigilar las horas despues de las 22.30 horas del dia se puede
.para que 
*/

import dotenv from "dotenv";
import mariadb from "mariadb";
import path from "path";
import fs from "fs";
import { fechaISO, addDays, weekday } from "./src/helpers/fechas.js";

// ?? scrapers (los añadimos en la entrega 4/6)
import {
    scrapeResultadosEuromillonesByFecha,
    scrapePremiosEuromillonesByFecha,
} from "./src/modules/scrapers/euromillones.js";
import {
    scrapeResultadosPrimitivaByFecha,
    scrapePremiosPrimitivaByFecha,
} from "./src/modules/scrapers/primitiva.js";
import {
    getResultadoGordo,
    scrapePremiosGordoByFecha,
} from "./src/modules/scrapers/gordo.js";

const ROOT = path.resolve();
const LOG_FILE = path.join(ROOT, "logs", "Update-today.log");
try {
    fs.mkdirSync(path.dirname(LOG_FILE), { recursive: true });
} catch {}
const origLog = console.log.bind(console);
const origErr = console.error.bind(console);
function appendLog(level, args) {
    const message = args
        .map((arg) =>
            typeof arg === "string"
                ? arg
                : (() => {
                      try {
                          return JSON.stringify(arg);
                      } catch {
                          return String(arg);
                      }
                  })()
        )
        .join(" ");
    const fechaHora = new Date();
    const line = `[${fechaHora.toLocaleDateString()} ${fechaHora.toLocaleTimeString()}] [${level}] ${message}\n`;
    try {
        fs.appendFileSync(LOG_FILE, line);
    } catch {}
}
console.log = (...args) => {
    origLog(...args);
    appendLog("INFO", args);
};
console.error = (...args) => {
    origErr(...args);
    appendLog("ERROR", args);
};

const ENV_BASE = path.join(ROOT, ".env");
function readEnvFile(filePath) {
    try {
        const raw = fs.readFileSync(filePath);
        return dotenv.parse(raw);
    } catch {
        return {};
    }
}
function buildEnvForVariant(variant) {
    const base = readEnvFile(ENV_BASE);
    const variantFile =
        variant && variant !== "default"
            ? path.join(ROOT, `.env_${variant}`)
            : process.env.ENV_FILE
            ? path.join(ROOT, process.env.ENV_FILE)
            : process.env.APP_VARIANT
            ? path.join(ROOT, `.env_${process.env.APP_VARIANT}`)
            : null;
    const variantEnv = variantFile ? readEnvFile(variantFile) : {};
    return {
        ...base,
        ...process.env,
        ...variantEnv,
        APP_VARIANT: variant || process.env.APP_VARIANT || "default",
    };
}

// =============== utils (unificados en helpers/fechas) ===============

async function existeResultado(conn, tabla, fechaISO) {
    const r = await conn.query(
        `SELECT COUNT(*) AS n FROM ${tabla} WHERE fecha = ?`,
        [fechaISO]
    );
    return (r[0]?.n || 0) > 0;
}

async function existePremios(conn, tipoApuesta, fechaISO) {
    // Desde r_xxx obtenemos sorteo y luego miramos premios.
    let tabla;
    if (tipoApuesta === "euromillones") tabla = "r_euromillones";
    else if (tipoApuesta === "primitiva") tabla = "r_primitiva";
    else if (tipoApuesta === "gordo") tabla = "r_gordo";
    else return false;

    const rows = await conn.query(
        `SELECT sorteo FROM ${tabla} WHERE fecha = ? LIMIT 1`,
        [fechaISO]
    );
    if (!rows.length) return false;

    const sorteo = rows[0].sorteo?.toString() || "";
    // premios_sorteos.sorteo está normalizado a NNN para eurom/gordo y a NNN (parte derecha) para primitiva
    const nnn = (sorteo.includes("/") ? sorteo.split("/")[1] : sorteo).padStart(
        3,
        "0"
    );

    const p = await conn.query(
        `SELECT COUNT(*) AS n FROM premios_sorteos WHERE tipoApuesta = ? AND sorteo = ? AND fecha = ?`,
        [tipoApuesta, nnn, fechaISO]
    );
    return (p[0]?.n || 0) > 0;
}

// =============== main ===============
async function runUpdateForVariant(variant) {
    const env = buildEnvForVariant(variant);
    Object.assign(process.env, env); // asegura que scrapers compartan el mismo env

    const pool = mariadb.createPool({
        host: env.DB_HOST,
        user: env.DB_USER,
        password: env.DB_PASSWORD,
        database: env.DB_DATABASE,
        connectionLimit: 5,
    });
    const conn = await pool.getConnection();
    const label = variant || "default";
    try {
        const hoy = fechaISO(new Date());
        const dow = weekday(hoy); // 0..6
        console.log(
            `Arrancamos Update-today [${label}] => ${hoy} día de la semana:(0 domingo) (dow=${dow})`
        );

        // Determinar qué juegos tocan hoy (y el lunes incluir el gordo de ayer)
        const planes = [];

        // Euromillones: martes(2) y viernes(5)
        if (dow === 2 || dow === 5) {
            planes.push({ tipo: "euromillones", fecha: hoy });
        }

        // Primitiva: lunes(1), jueves(4), sábado(6)
        if (dow === 1 || dow === 4 || dow === 6) {
            planes.push({ tipo: "primitiva", fecha: hoy });
        }

        // Gordo: domingo(0)
        if (dow === 0) {
            planes.push({ tipo: "gordo", fecha: hoy });
        }

        if (!planes.length) {
            console.log(
                "?? No hay sorteos que actualizar hoy según el calendario."
            );
            return;
        }

        for (const plan of planes) {
            const { tipo, fecha } = plan;

            let tablaResultados = "";
            if (tipo === "euromillones") tablaResultados = "r_euromillones";
            if (tipo === "primitiva") tablaResultados = "r_primitiva";
            if (tipo === "gordo") tablaResultados = "r_gordo";

            console.log(
                `\n?? [${label}] ${tipo.toUpperCase()} -> fecha ${fecha}`
            );

            // Verificación de hora mínima de publicación (22:00 del día analizado)
            const ahora = new Date();
            const limitePublicacion = new Date(`${fecha}T22:00:00`);
            if (ahora < limitePublicacion) {
                console.log(
                    `   todavia no se han publicado los resultados de ${tipo}`
                );
                continue; // saltar a siguiente plan sin intentar scrapeo
            }

            // 1) Resultados
            const tieneRes = await existeResultado(
                conn,
                tablaResultados,
                fecha
            );
            if (tieneRes) {
                console.log("   ?? Resultados ya existentes en BD.");
            } else {
                console.log("   ?? Descargando resultados del día...");
                if (tipo === "euromillones") {
                    await scrapeResultadosEuromillonesByFecha(fecha);
                } else if (tipo === "primitiva") {
                    await scrapeResultadosPrimitivaByFecha(fecha);
                } else if (tipo === "gordo") {
                    await getResultadoGordo(fecha);
                }
                const ok = await existeResultado(conn, tablaResultados, fecha);
                console.log(
                    ok
                        ? "   ? Resultados guardados."
                        : "   ? No se guardaron resultados."
                );
            }

            // 2) Premios (solo si ya hay resultado)
            const tieneResAhora = await existeResultado(
                conn,
                tablaResultados,
                fecha
            );
            if (tieneResAhora) {
                const tienePrem = await existePremios(conn, tipo, fecha);
                if (tienePrem) {
                    console.log("   ?? Premios ya existentes en BD.");
                } else {
                    console.log("   ?? Descargando tabla de premios...");
                    if (tipo === "euromillones") {
                        await scrapePremiosEuromillonesByFecha(fecha);
                    } else if (tipo === "primitiva") {
                        await scrapePremiosPrimitivaByFecha(fecha);
                    } else if (tipo === "gordo") {
                        await scrapePremiosGordoByFecha(fecha);
                    }
                    const okPrem = await existePremios(conn, tipo, fecha);
                    console.log(
                        okPrem
                            ? "   ? Premios guardados."
                            : "   ? No se guardaron premios (quizá aún no publicados)."
                    );
                }
            } else {
                console.log(
                    "   ?? Saltando premios: no hay resultados en BD para esta fecha."
                );
            }
        }

        console.log("\n?? Actualización diaria finalizada.");
    } finally {
        try {
            conn.release();
            await pool.end();
        } catch {}
    }
}

(async () => {
    const args = process.argv.slice(2).filter((a) => !a.startsWith("--"));
    const runAll = process.argv.some((a) => a === "--all" || a === "--both");
    const variants = runAll
        ? ["cre", "family"]
        : args.length
        ? args
        : [
              process.env.APP_VARIANT ||
                  (process.env.PM2_APP_NAME?.startsWith("app-")
                      ? process.env.PM2_APP_NAME.slice(4)
                      : process.env.PM2_APP_NAME) ||
                  "default",
          ];

    for (const variant of variants) {
        try {
            console.log(
                `\n================= update-today (${
                    variant || "default"
                }) =================`
            );
            await runUpdateForVariant(variant);
        } catch (err) {
            console.error(
                `? Error en update-today (${variant || "default"}):`,
                err.stack || err.message
            );
        }
    }
})();
